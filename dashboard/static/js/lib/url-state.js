/**
 * View state mirrored in the query string (?view=alerts&level=poor&sort=name&m=Calamba)
 * so a link reopens the same screen. Written with replaceState, like the React version.
 */
export const URL_DEFAULTS = { view: 'monitor', level: 'all', sort: 'index', m: '' }

export function readUrl() {
  const params = new URLSearchParams(window.location.search)
  const out = {}
  for (const [k, fallback] of Object.entries(URL_DEFAULTS)) out[k] = params.get(k) ?? fallback
  return out
}

export function writeUrl(values) {
  const params = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(values)) {
    if (!(k in URL_DEFAULTS)) continue
    if (v === URL_DEFAULTS[k] || v === '') params.delete(k)
    else params.set(k, v)
  }
  const qs = params.toString()
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
}
