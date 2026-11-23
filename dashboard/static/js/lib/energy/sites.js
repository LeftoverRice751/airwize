/**
 * The four site types the Energy tab adapts to. `storage` says whether the
 * site has a battery: 'always', 'none', or 'optional' (a generator site may or
 * may not have one; in live mode it counts only if the device reports a charge).
 * `source` is the local supply shown in the Solar/Generator tile, if any.
 * `capacityWh` is used by the simulation only.
 */
export const SITES = {
  solar: { key: 'solar', label: 'Solar site', heading: 'Solar site energy', storage: 'always', source: 'solar', capacityWh: 14_000 },
  grid: { key: 'grid', label: 'Grid connection', heading: 'Grid connection energy', storage: 'none', source: null, capacityWh: 0 },
  generator: { key: 'generator', label: 'Generator site', heading: 'Generator site energy', storage: 'optional', source: 'generator', capacityWh: 5_000 },
  battery: { key: 'battery', label: 'Battery bank', heading: 'Battery bank energy', storage: 'always', source: null, capacityWh: 15_000 },
}

export const SITE_KEYS = Object.keys(SITES)
export const MODES = { simulation: 'Simulation only', live: 'Live' }

export const siteFor = (key) => SITES[key] ?? SITES.solar

/**
 * Whether storage tiles and the stored-energy chart apply.
 * Simulated generator sites always carry a battery; live ones only if the
 * device reports one.
 */
export function hasStorage(site, mode, reading) {
  if (site.storage === 'always') return true
  if (site.storage === 'none') return false
  if (mode === 'simulation') return true
  return reading?.charge_pct != null || reading?.voltage_v != null
}
