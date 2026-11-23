import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Go scraper serves live readings at :8080 (`go run . -serve :8080`).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
})
