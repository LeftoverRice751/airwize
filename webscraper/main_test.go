package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Fixtures mirror the real (unquoted-attribute) markup served by air.plumelabs.com.
const countryHTML = `<html><body>
<a class=breadcrumb__link href=/en/> world air map </a>
<a class=country__city href=/air-quality-in-Calamba-7dCV> Calamba </a>
<a class=country__city href=/air-quality-in-Bi%C3%B1an-7eMr> Biñan </a>
<a class=country__city href=/air-quality-in-Manila-7aaa> Manila </a>
<a class=country__city href=/air-quality-in-Broken-7bbb> Broken </a>
<a class=country__city href=/air-quality-in-Calamba-7dCV> Calamba </a>
</body></html>`

func cityHTML(region, province, muni string, pi float64, level int) string {
	return fmt.Sprintf(`<html><script>
        window.forecast_data = [{"plume_index": 20.0, "plume_index_level": 2, "timestamp": 1795413600, "values": {}}, {"plume_index": 31.0, "plume_index_level": 2, "timestamp": 1795417200, "values": {"PM25": {"pi": 31.0, "value_upm": 8.5}}}];
        window.current_data = {"bg_position": 12.5, "plume_index": %v, "plume_index_level": %d, "timestamp": 1795417200, "values": {"NO2": {"pi": 6.0, "value_upm": 2.9}, "PM25": {"pi": 23.0, "value_upm": 6.16}}, "weather": {"icon": "cloudy", "temperature": 28.7, "uv": 2.0}};
        window.period = "live";
        window.activity_advice = ["The air is pure!","Moderately \"polluted\".","High, ok? [yes]",];
        window.zone = {"name": "X", "hierarchy": [{"code": "40", "name": "%s"}, {"code": "33", "name": "%s"}, {"code": "1", "name": "%s"}], "latitude": 14.2, "longitude": 121.1, "nearby_cities": [{"hierarchy": [{"name": "Nope"}]}]};
        window.time_frames = [];
</script></html>`, pi, level, region, province, muni)
}

func newTestServer(t *testing.T, hits *atomic.Int32) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/air-quality/Philippines", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, countryHTML)
	})
	pages := map[string]string{
		"/air-quality-in-Calamba-7dCV": cityHTML("Calabarzon", "Laguna", "City of Calamba", 25, 2),
		"/air-quality-in-Biñan-7eMr":   cityHTML("Calabarzon", "Laguna", "City of Biñan", 40, 3),
		"/air-quality-in-Manila-7aaa":  cityHTML("National Capital Region", "Manila", "Manila", 60, 4),
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if hits != nil {
			hits.Add(1)
		}
		if r.Header.Get("User-Agent") == "" {
			http.Error(w, "no UA", http.StatusForbidden)
			return
		}
		page, ok := pages[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, page)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestParseCityLinks(t *testing.T) {
	cities, err := ParseCityLinks(countryHTML, "https://air.plumelabs.com")
	if err != nil {
		t.Fatal(err)
	}
	if len(cities) != 4 {
		t.Fatalf("want 4 unique cities, got %d: %+v", len(cities), cities)
	}
	if cities[0].Name != "Calamba" || cities[0].URL != "https://air.plumelabs.com/air-quality-in-Calamba-7dCV" {
		t.Errorf("unexpected first city: %+v", cities[0])
	}
	if cities[1].Name != "Biñan" {
		t.Errorf("want Biñan, got %q", cities[1].Name)
	}
}

func TestParseCityLinksEmpty(t *testing.T) {
	if _, err := ParseCityLinks("<html></html>", "https://x"); err == nil {
		t.Fatal("expected error for page with no cities")
	}
}

func TestParseCityPage(t *testing.T) {
	p, err := ParseCityPage(cityHTML("Calabarzon", "Laguna", "City of Calamba", 25, 2))
	if err != nil {
		t.Fatal(err)
	}
	z, cd := p.Zone, p.Current
	if len(p.Forecast) != 2 || p.Forecast[1].PlumeIndex != 31 || p.Forecast[1].Values["PM25"].Value != 8.5 {
		t.Errorf("bad forecast: %+v", p.Forecast)
	}
	if len(p.Advice) != 3 || p.Advice[1] != `Moderately "polluted".` {
		t.Errorf("bad advice: %q", p.Advice)
	}
	if !z.InProvince("laguna") {
		t.Error("expected zone to be in Laguna (case-insensitive)")
	}
	if z.InProvince("Nope") {
		t.Error("nearby_cities hierarchy must not leak into the zone's own hierarchy")
	}
	if cd.PlumeIndex != 25 || cd.PlumeIndexLevel != 2 {
		t.Errorf("bad current data: %+v", cd)
	}
	if got := cd.Values["PM25"].Value; got != 6.16 {
		t.Errorf("PM25 value = %v, want 6.16", got)
	}
	if cd.Weather.Temperature != 28.7 {
		t.Errorf("temperature = %v", cd.Weather.Temperature)
	}
}

func TestParseCityPageMissingData(t *testing.T) {
	if _, err := ParseCityPage(`<script>window.zone = {"name":"x"};</script>`); err == nil {
		t.Fatal("expected error when current_data is missing")
	}
	if _, err := ParseCityPage(`<script>window.zone = {broken</script>`); err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

func TestLevelName(t *testing.T) {
	cases := map[int]string{1: "excellent", 2: "fair", 3: "poor", 4: "unhealthy", 5: "very unhealthy", 0: "unknown", 99: "unknown"}
	for in, want := range cases {
		if got := levelName(in); got != want {
			t.Errorf("levelName(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestScraperFetchAllFiltersProvince(t *testing.T) {
	srv := newTestServer(t, nil)
	s := NewScraper(srv.URL, "Laguna", 4)
	ctx := context.Background()

	cities, err := s.Cities(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.FetchAll(ctx, cities)
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Errorf("expected 404 error for Broken city, got %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 Laguna cities, got %d: %+v", len(got), got)
	}
	// Sorted by name: Biñan, Calamba.
	if got[0].City != "Biñan" || got[1].City != "Calamba" {
		t.Errorf("unexpected order: %s, %s", got[0].City, got[1].City)
	}
	c := got[1]
	if c.Municipality != "City of Calamba" || c.Region != "Calabarzon" || c.Province != "Laguna" {
		t.Errorf("bad admin fields: %+v", c)
	}
	if c.PlumeIndex != 25 || c.Level != "fair" {
		t.Errorf("bad AQI: %v %q", c.PlumeIndex, c.Level)
	}
	if c.Advice != `Moderately "polluted".` {
		t.Errorf("Advice = %q", c.Advice)
	}
	if len(c.Forecast) != 2 {
		t.Errorf("Forecast len = %d", len(c.Forecast))
	}
	if !c.MeasuredAt.Equal(time.Unix(1795417200, 0)) {
		t.Errorf("MeasuredAt = %v", c.MeasuredAt)
	}
}

func TestFetchAllIsConcurrent(t *testing.T) {
	var inFlight, peak atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		n := inFlight.Add(1)
		defer inFlight.Add(-1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
		fmt.Fprint(w, cityHTML("Calabarzon", "Laguna", "M", 10, 1))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	var cities []City
	for i := range 20 {
		cities = append(cities, City{Name: fmt.Sprintf("c%02d", i), URL: fmt.Sprintf("%s/c%d", srv.URL, i)})
	}
	s := NewScraper(srv.URL, "Laguna", 5)
	start := time.Now()
	got, err := s.FetchAll(context.Background(), cities)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 20 {
		t.Fatalf("want 20 results, got %d", len(got))
	}
	if p := peak.Load(); p < 2 || p > 5 {
		t.Errorf("peak concurrency = %d, want between 2 and 5 (worker limit)", p)
	}
	// Sequential would be ~1s; 5 workers should finish in ~200ms.
	if d := time.Since(start); d > 800*time.Millisecond {
		t.Errorf("FetchAll took %v; does not look concurrent", d)
	}
}

func TestFetchAllRespectsCancel(t *testing.T) {
	srv := newTestServer(t, nil)
	s := NewScraper(srv.URL, "Laguna", 2)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cities := []City{{Name: "Calamba", URL: srv.URL + "/air-quality-in-Calamba-7dCV"}}
	if _, err := s.FetchAll(ctx, cities); err == nil {
		t.Fatal("expected error from cancelled context")
	}
}

func TestCitiesOf(t *testing.T) {
	got := citiesOf([]AirQuality{{City: "A", URL: "u1"}, {City: "B", URL: "u2"}})
	if len(got) != 2 || got[0] != (City{"A", "u1"}) || got[1] != (City{"B", "u2"}) {
		t.Errorf("citiesOf = %+v", got)
	}
}

func TestStoreAndHandler(t *testing.T) {
	st := NewStore("Laguna")
	srv := httptest.NewServer(st.Handler(""))
	defer srv.Close()

	get := func() Snapshot {
		t.Helper()
		resp, err := http.Get(srv.URL + "/api/readings")
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q", ct)
		}
		var s Snapshot
		if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}

	if s := get(); s.UpdatedAt != nil || len(s.Municipalities) != 0 || s.Province != "Laguna" {
		t.Errorf("initial snapshot = %+v", s)
	}
	st.Update([]AirQuality{{City: "Calamba"}}, nil)
	if s := get(); s.UpdatedAt == nil || len(s.Municipalities) != 1 || s.Error != "" {
		t.Errorf("after update = %+v", s)
	}
	// A failed, empty pass keeps the previous data but reports the error.
	st.Update(nil, errors.New("boom"))
	if s := get(); len(s.Municipalities) != 1 || s.Error != "boom" {
		t.Errorf("after failed pass = %+v", s)
	}
}

func TestWebSocketSendsCurrentAndUpdatedSnapshots(t *testing.T) {
	st := NewStore("Laguna")
	srv := httptest.NewServer(st.Handler(""))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/readings"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}

	var initial Snapshot
	if err := conn.ReadJSON(&initial); err != nil {
		t.Fatal(err)
	}
	if initial.Province != "Laguna" || initial.UpdatedAt != nil || len(initial.Municipalities) != 0 {
		t.Fatalf("initial websocket snapshot = %+v", initial)
	}

	st.Update([]AirQuality{{City: "Calamba"}}, nil)
	var updated Snapshot
	if err := conn.ReadJSON(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.UpdatedAt == nil || len(updated.Municipalities) != 1 || updated.Municipalities[0].City != "Calamba" {
		t.Fatalf("updated websocket snapshot = %+v", updated)
	}
}

func TestPollOnce(t *testing.T) {
	srv := newTestServer(t, nil)
	s := NewScraper(srv.URL, "Laguna", 3)
	calls := 0
	err := s.Poll(context.Background(), 0, func(data []AirQuality, err error) {
		calls++
		if len(data) != 2 {
			t.Errorf("want 2 results, got %d", len(data))
		}
	})
	if err != nil || calls != 1 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}
