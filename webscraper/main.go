// Command webscraper scrapes real-time air quality data from Plume Labs for
// every city/municipality in a given Philippine province (Laguna by default).
//
// The Philippines country page lists cities without their province, so the
// scraper fetches every city page concurrently, reads the administrative
// hierarchy embedded in each page (window.zone) and keeps those that belong
// to the requested province. Live readings come from window.current_data.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultBaseURL = "https://air.plumelabs.com"
	countryPath    = "/air-quality/Philippines"
	userAgent      = "Mozilla/5.0 (compatible; airwize-webscraper/1.0)"
)

// City is a city link found on the country page.
type City struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// Pollutant is a single pollutant reading.
type Pollutant struct {
	PlumeIndex float64 `json:"pi"`
	Value      float64 `json:"value_upm"`
}

// Weather holds the weather conditions reported alongside the reading.
type Weather struct {
	Icon        string  `json:"icon"`
	Temperature float64 `json:"temperature"`
	UV          float64 `json:"uv"`
}

// CurrentData mirrors window.current_data on a city page.
type CurrentData struct {
	PlumeIndex      float64              `json:"plume_index"`
	PlumeIndexLevel int                  `json:"plume_index_level"`
	Timestamp       int64                `json:"timestamp"`
	Values          map[string]Pollutant `json:"values"`
	Weather         Weather              `json:"weather"`
}

// ForecastPoint mirrors one hourly entry of window.forecast_data. The series
// covers the previous 24 hours and the next 24 hours.
type ForecastPoint struct {
	PlumeIndex      float64              `json:"plume_index"`
	PlumeIndexLevel int                  `json:"plume_index_level"`
	Timestamp       int64                `json:"timestamp"`
	Values          map[string]Pollutant `json:"values"`
	Weather         Weather              `json:"weather"`
}

// Zone mirrors the parts of window.zone we need.
type Zone struct {
	Name          string            `json:"name"`
	LocalizedName map[string]string `json:"localized_name"`
	Latitude      float64           `json:"latitude"`
	Longitude     float64           `json:"longitude"`
	Hierarchy     []struct {
		Code string `json:"code"`
		Name string `json:"name"`
	} `json:"hierarchy"`
}

// InProvince reports whether the zone's administrative hierarchy contains province.
func (z Zone) InProvince(province string) bool {
	for _, h := range z.Hierarchy {
		if strings.EqualFold(strings.TrimSpace(h.Name), province) {
			return true
		}
	}
	return false
}

// AirQuality is one scraped result.
type AirQuality struct {
	City         string               `json:"city"`
	Municipality string               `json:"municipality"` // most specific admin level (e.g. "City of Calamba")
	Province     string               `json:"province"`
	Region       string               `json:"region"`
	URL          string               `json:"url"`
	Latitude     float64              `json:"latitude"`
	Longitude    float64              `json:"longitude"`
	PlumeIndex   float64              `json:"plume_index"`
	Level        string               `json:"level"`
	Pollutants   map[string]Pollutant `json:"pollutants"`
	Weather      Weather              `json:"weather"`
	Advice       string               `json:"advice"` // Plume Labs' advice text for the current level
	Forecast     []ForecastPoint      `json:"forecast"`
	MeasuredAt   time.Time            `json:"measured_at"`
	FetchedAt    time.Time            `json:"fetched_at"`
}

var levels = []string{"excellent", "fair", "poor", "unhealthy", "very unhealthy", "dangerous", "dangerous"}

// levelName converts plume_index_level (1-based) to its label.
func levelName(l int) string {
	if l >= 1 && l <= len(levels) {
		return levels[l-1]
	}
	return "unknown"
}

var cityLinkRe = regexp.MustCompile(`class=["']?country__city["']?\s+href=["']?([^"'\s>]+)["']?[^>]*>\s*([^<]+?)\s*</a>`)

// ParseCityLinks extracts city links from the country page HTML.
func ParseCityLinks(html, baseURL string) ([]City, error) {
	base, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var cities []City
	for _, m := range cityLinkRe.FindAllStringSubmatch(html, -1) {
		ref, err := url.Parse(m[1])
		if err != nil {
			continue
		}
		u := base.ResolveReference(ref).String()
		if seen[u] {
			continue
		}
		seen[u] = true
		cities = append(cities, City{Name: m[2], URL: u})
	}
	if len(cities) == 0 {
		return nil, errors.New("no city links found on country page")
	}
	return cities, nil
}

// extractJSONVar decodes the JSON value assigned to `window.<name> =` in html.
func extractJSONVar(html, name string, v any) error {
	marker := "window." + name + " ="
	i := strings.Index(html, marker)
	if i < 0 {
		return fmt.Errorf("window.%s not found", name)
	}
	// json.Decoder stops after the first complete value, ignoring the trailing ";".
	if err := json.NewDecoder(strings.NewReader(html[i+len(marker):])).Decode(v); err != nil {
		return fmt.Errorf("decode window.%s: %w", name, err)
	}
	return nil
}

var jsStringRe = regexp.MustCompile(`"((?:[^"\\]|\\.)*)"`)

// extractStringArray reads a JS array of string literals assigned to
// `window.<name> =`. The site emits trailing commas, so it is not valid JSON.
func extractStringArray(html, name string) []string {
	marker := "window." + name + " ="
	i := strings.Index(html, marker)
	if i < 0 {
		return nil
	}
	rest := html[i+len(marker):]
	end := strings.Index(rest, "];")
	if end < 0 {
		return nil
	}
	var out []string
	for _, m := range jsStringRe.FindAllStringSubmatch(rest[:end], -1) {
		var v string
		if err := json.Unmarshal([]byte(`"`+m[1]+`"`), &v); err == nil {
			out = append(out, v)
		}
	}
	return out
}

// CityPage is everything parsed from one city page.
type CityPage struct {
	Zone     Zone
	Current  CurrentData
	Forecast []ForecastPoint
	Advice   []string // indexed by plume_index_level - 1
}

// ParseCityPage extracts zone, live and forecast data from a city page.
// zone and current_data are required; forecast and advice are optional.
func ParseCityPage(html string) (CityPage, error) {
	var p CityPage
	if err := extractJSONVar(html, "zone", &p.Zone); err != nil {
		return p, err
	}
	if err := extractJSONVar(html, "current_data", &p.Current); err != nil {
		return p, err
	}
	_ = extractJSONVar(html, "forecast_data", &p.Forecast)
	p.Advice = extractStringArray(html, "activity_advice")
	return p, nil
}

// Scraper fetches and parses Plume Labs pages.
type Scraper struct {
	BaseURL  string
	Province string
	Workers  int
	Client   *http.Client
}

// NewScraper returns a Scraper with sensible defaults.
func NewScraper(baseURL, province string, workers int) *Scraper {
	if workers < 1 {
		workers = 1
	}
	return &Scraper{
		BaseURL:  strings.TrimRight(baseURL, "/"),
		Province: province,
		Workers:  workers,
		Client:   &http.Client{Timeout: 20 * time.Second},
	}
}

func (s *Scraper) get(ctx context.Context, u string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := s.Client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s: status %d", u, resp.StatusCode)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// Cities returns every city listed on the Philippines country page.
func (s *Scraper) Cities(ctx context.Context) ([]City, error) {
	html, err := s.get(ctx, s.BaseURL+countryPath)
	if err != nil {
		return nil, err
	}
	return ParseCityLinks(html, s.BaseURL)
}

// FetchCity fetches one city page. ok is false if it isn't in the province.
func (s *Scraper) FetchCity(ctx context.Context, c City) (aq AirQuality, ok bool, err error) {
	html, err := s.get(ctx, c.URL)
	if err != nil {
		return aq, false, err
	}
	p, err := ParseCityPage(html)
	if err != nil {
		return aq, false, fmt.Errorf("%s: %w", c.Name, err)
	}
	z, cd := p.Zone, p.Current
	if !z.InProvince(s.Province) {
		return aq, false, nil
	}
	aq = AirQuality{
		City:       c.Name,
		Province:   s.Province,
		URL:        c.URL,
		Latitude:   z.Latitude,
		Longitude:  z.Longitude,
		PlumeIndex: cd.PlumeIndex,
		Level:      levelName(cd.PlumeIndexLevel),
		Pollutants: cd.Values,
		Weather:    cd.Weather,
		Forecast:   p.Forecast,
		MeasuredAt: time.Unix(cd.Timestamp, 0).UTC(),
		FetchedAt:  time.Now().UTC(),
	}
	if l := cd.PlumeIndexLevel; l >= 1 && l <= len(p.Advice) {
		aq.Advice = p.Advice[l-1]
	}
	if n := len(z.Hierarchy); n > 0 {
		aq.Region = z.Hierarchy[0].Name
		aq.Municipality = z.Hierarchy[n-1].Name
	}
	return aq, true, nil
}

// FetchAll fetches every city concurrently with a bounded pool of goroutines
// and returns the ones in the configured province, sorted by city name.
// Per-city errors are collected and returned joined; partial results are kept.
func (s *Scraper) FetchAll(ctx context.Context, cities []City) ([]AirQuality, error) {
	jobs := make(chan City)
	type result struct {
		aq  AirQuality
		ok  bool
		err error
	}
	results := make(chan result)

	var wg sync.WaitGroup
	for range min(s.Workers, len(cities)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for c := range jobs {
				aq, ok, err := s.FetchCity(ctx, c)
				results <- result{aq, ok, err}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, c := range cities {
			select {
			case jobs <- c:
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	var out []AirQuality
	var errs []error
	for r := range results {
		switch {
		case r.err != nil:
			errs = append(errs, r.err)
		case r.ok:
			out = append(out, r.aq)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].City < out[j].City })
	if err := ctx.Err(); err != nil {
		errs = append(errs, err)
	}
	return out, errors.Join(errs...)
}

// citiesOf returns the City entries for the given results (used to re-poll
// only the province's cities after the first full discovery pass).
func citiesOf(aqs []AirQuality) []City {
	cs := make([]City, len(aqs))
	for i, a := range aqs {
		cs[i] = City{Name: a.City, URL: a.URL}
	}
	return cs
}

// Poll lists the country's cities, then fetches the province's data every
// interval (once if interval <= 0), calling onResult after each pass. After a
// clean discovery pass only the province's cities are re-polled; if any fetch
// failed, the next pass rescans everything so no city is dropped.
func (s *Scraper) Poll(ctx context.Context, interval time.Duration, onResult func([]AirQuality, error)) error {
	all, err := s.Cities(ctx)
	if err != nil {
		return fmt.Errorf("listing cities: %w", err)
	}
	log.Printf("found %d cities in the Philippines; scanning for %s with %d goroutines", len(all), s.Province, s.Workers)

	targets := all
	for {
		data, err := s.FetchAll(ctx, targets)
		if ctx.Err() != nil {
			return nil
		}
		onResult(data, err)
		if interval <= 0 {
			return nil
		}
		if err == nil && len(data) > 0 && len(targets) == len(all) {
			targets = citiesOf(data)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(interval):
		}
	}
}

// Snapshot is the payload served at /api/readings.
type Snapshot struct {
	Province       string       `json:"province"`
	UpdatedAt      *time.Time   `json:"updated_at"` // nil until the first pass completes
	Municipalities []AirQuality `json:"municipalities"`
	Error          string       `json:"error,omitempty"` // last pass's partial-failure message
}

// Store holds the latest snapshot for concurrent readers.
type Store struct {
	mu   sync.RWMutex
	snap Snapshot
}

// NewStore returns an empty store for province.
func NewStore(province string) *Store {
	return &Store{snap: Snapshot{Province: province, Municipalities: []AirQuality{}}}
}

// Update records the result of a polling pass. Partial results replace the
// previous data only when they are non-empty, so one bad pass does not blank
// the dashboard.
func (st *Store) Update(data []AirQuality, err error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.snap.Error = ""
	if err != nil {
		st.snap.Error = err.Error()
	}
	if len(data) > 0 || st.snap.UpdatedAt == nil {
		now := time.Now().UTC()
		st.snap.UpdatedAt = &now
		if data == nil {
			data = []AirQuality{}
		}
		st.snap.Municipalities = data
	}
}

// Get returns the current snapshot.
func (st *Store) Get() Snapshot {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return st.snap
}

// Handler serves the snapshot as JSON at /api/readings and, when staticDir is
// set, the built dashboard at /.
func (st *Store) Handler(staticDir string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/readings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if err := json.NewEncoder(w).Encode(st.Get()); err != nil {
			log.Printf("encode snapshot: %v", err)
		}
	})
	if staticDir != "" {
		mux.Handle("/", http.FileServer(http.Dir(staticDir)))
	}
	return mux
}

func main() {
	baseURL := flag.String("base", defaultBaseURL, "Plume Labs base URL")
	province := flag.String("province", "Laguna", "province to filter cities/municipalities by")
	workers := flag.Int("workers", 10, "number of concurrent fetch goroutines")
	interval := flag.Duration("interval", 0, "poll interval for real-time updates (e.g. 5m); 0 fetches once")
	serve := flag.String("serve", "", "serve the latest readings over HTTP at this address (e.g. :8080); polls every -interval (default 5m)")
	static := flag.String("static", "", "with -serve, also serve the built dashboard from this directory")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	s := NewScraper(*baseURL, *province, *workers)

	if *serve != "" {
		if *interval <= 0 {
			*interval = 5 * time.Minute
		}
		store := NewStore(*province)
		go func() {
			err := s.Poll(ctx, *interval, func(data []AirQuality, err error) {
				if err != nil {
					log.Printf("some fetches failed: %v", err)
				}
				log.Printf("%d %s cities/municipalities fetched", len(data), *province)
				store.Update(data, err)
			})
			if err != nil {
				log.Printf("poller stopped: %v", err)
				store.Update(nil, err)
			}
		}()
		srv := &http.Server{Addr: *serve, Handler: store.Handler(*static), ReadHeaderTimeout: 5 * time.Second}
		go func() {
			<-ctx.Done()
			shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = srv.Shutdown(shutdown)
		}()
		log.Printf("serving %s readings on http://localhost%s/api/readings", *province, *serve)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
		return
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	err := s.Poll(ctx, *interval, func(data []AirQuality, err error) {
		if err != nil {
			log.Printf("some fetches failed: %v", err)
		}
		log.Printf("%d %s cities/municipalities fetched", len(data), *province)
		if err := enc.Encode(data); err != nil {
			log.Printf("encode: %v", err)
		}
	})
	if err != nil {
		log.Fatal(err)
	}
}
