# Laguna air dashboard

Live air quality, 24-hour forecasts and threshold alerts for Laguna municipalities,
fed by the Go scraper in `../webscraper`.

```bash
# 1. Start the scraper API (polls Plume Labs every 5 minutes)
cd ../webscraper && go run . -serve :8080 -interval 5m

# 2. Start the dashboard (proxies /api to :8080)
cd ../dashboard && npm install && npm run dev      # http://localhost:5173

# Production: build, then let the Go server host it
npm run build && cd ../webscraper && go run . -serve :8080 -static ../dashboard/dist
```

## Structure

- `src/ui/` reusable primitives: `Button` (primary, secondary, ghost, icon), `FilterPill` + `FilterGroup`, `LevelBadge`, `AlertTrigger`, `Notice`, `Stat`, `Skeleton`, `Icon`
- `src/shell/TopBar.tsx` app header; collapses to a menu under 40rem
- `src/features/` screen sections: `ProvinceStrip`, `MunicipalityTable`, `DetailPanel`, `ForecastChart`, `Sparkline`, `AlertsView`
- `src/lib/` data and logic: API polling and URL state (`hooks.ts`), severity bands (`levels.ts`), forecast analysis (`outlook.ts`), alert rules (`alerts.ts`)
- `src/styles/` `tokens.css` holds every colour and font; components never use literal values
