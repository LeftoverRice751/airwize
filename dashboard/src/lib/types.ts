/** Mirrors the JSON served by the Go scraper at /api/readings. */
export interface Pollutant {
  pi: number
  value_upm: number
}

export interface Weather {
  icon: string
  temperature: number
  uv: number
}

export interface ForecastPoint {
  plume_index: number
  plume_index_level: number
  timestamp: number
  values: Record<string, Pollutant>
  weather: Weather
}

export interface Municipality {
  city: string
  municipality: string
  province: string
  region: string
  url: string
  latitude: number
  longitude: number
  plume_index: number
  level: string
  pollutants: Record<string, Pollutant>
  weather: Weather
  advice: string
  forecast: ForecastPoint[] | null
  measured_at: string
  fetched_at: string
}

export interface Snapshot {
  province: string
  updated_at: string | null
  municipalities: Municipality[]
  error?: string
}

export interface AlertRule {
  id: string
  city: string
  threshold: number
}
