/**
 * "Why is it behaving this way?": plain-language guesses at what is driving
 * the system right now. These are ESTIMATES built only from the readings,
 * scenario and forecast in the situation; a rule stays silent when a value it
 * needs is missing, and nothing here is ever presented as a confirmed event.
 *
 * Situation shape (built by features/energy/energy-view.js):
 *   site, mode, storage (bool)
 *   readings  { charge_pct, voltage_v, load_w, solar_w, generator_w }  null = not available
 *   drain     { state: 'draining'|'charging'|'stable'|'unknown', ratePctH, hoursLeft } | null
 *   previousLoadW   load about LOOKBACK_MIN minutes ago, or null
 *   outside   { municipality, temperature_c, uv, plume_index, level } | null
 *   forecast  [{ timestamp, temperature_c }] for the coming hours
 *   clock     Date
 */
import { fmtNumber, fmtWatts, localHour } from '../format.js'
import { levelLabel, rankForIndex } from '../levels.js'

export const LOOKBACK_MIN = 15
const HOT_C = 32
const HIGH_LOAD_W = 800
const LOAD_STEP_W = 300
const FORECAST_SWING_C = 1

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const deg = (c) => `${Math.round(c)} °C`

export function explain(s) {
  const out = []
  const r = s.readings ?? {}
  const o = s.outside
  const draining = s.drain?.state === 'draining'
  const solar = s.site.source === 'solar'

  // Heat and cooling load.
  if (o && num(o.temperature_c) && num(r.load_w) && o.temperature_c >= HOT_C && r.load_w >= HIGH_LOAD_W) {
    const effect = draining ? 'may be driving the drain' : s.storage ? 'may be keeping the load high' : 'may be driving the demand'
    out.push({
      id: 'heat',
      text: `It’s ${deg(o.temperature_c)} in ${o.municipality} and the load is ${fmtWatts(r.load_w)}, so fans or air conditioning ${effect}.`,
      basis: ['outside temperature', 'load'],
    })
  }

  // Haze and panel output (daytime only; at night there is nothing to dim).
  const daytime = s.clock ? localHour(s.clock) >= 7 && localHour(s.clock) < 17 : true
  if (solar && num(r.solar_w) && o && num(o.plume_index) && rankForIndex(o.plume_index) >= 3 && daytime) {
    out.push({
      id: 'haze',
      text: `Air quality in ${o.municipality} is ${levelLabel(rankForIndex(o.plume_index)).toLowerCase()}. Haze may be reducing the panels’ output.`,
      basis: ['air quality', 'solar output'],
    })
  }

  // No sunlight.
  if (solar && num(r.solar_w) && r.solar_w < 20 && (!daytime || (o && o.uv === 0)) && (draining || !s.storage)) {
    out.push({
      id: 'dark',
      text: s.storage ? 'There is no usable sunlight now, so the panels aren’t producing and stored energy is likely covering the load.' : 'There is no usable sunlight now, so the panels aren’t producing.',
      basis: ['solar output', 'time of day'],
    })
  }

  // Full battery: the inverter throttles the panels to match the load.
  if (solar && s.storage && num(r.charge_pct) && r.charge_pct >= 99 && num(r.solar_w) && r.solar_w > 20) {
    out.push({ id: 'full', text: 'Stored energy is full, so the panels are likely being throttled to match the load.', basis: ['stored energy', 'solar output'] })
  }

  // A change in appliance load.
  if (num(r.load_w) && num(s.previousLoadW)) {
    const delta = r.load_w - s.previousLoadW
    if (delta >= LOAD_STEP_W && r.load_w >= s.previousLoadW * 1.4) {
      out.push({
        id: 'load-up',
        text: `The load increased from ${fmtWatts(s.previousLoadW)} to ${fmtWatts(r.load_w)} in the last ${LOOKBACK_MIN} minutes, possibly because an appliance was switched on.`,
        basis: ['load history'],
      })
    } else if (-delta >= LOAD_STEP_W && r.load_w <= s.previousLoadW / 1.4) {
      out.push({
        id: 'load-down',
        text: `The load dropped from ${fmtWatts(s.previousLoadW)} to ${fmtWatts(r.load_w)} in the last ${LOOKBACK_MIN} minutes, possibly because an appliance was switched off.`,
        basis: ['load history'],
      })
    }
  }

  // Generator behaviour.
  if (s.site.source === 'generator' && num(r.generator_w)) {
    if (r.generator_w > 0 && s.storage) {
      out.push({ id: 'gen-on', text: `The generator is supplying ${fmtWatts(r.generator_w)}, which is likely why stored energy is ${s.drain?.state === 'charging' ? 'rising' : 'holding up'}.`, basis: ['generator output'] })
    } else if (r.generator_w === 0 && draining) {
      out.push({ id: 'gen-off', text: 'The generator is off, so stored energy is likely covering the whole load.', basis: ['generator output'] })
    }
  }

  // The outside forecast.
  if (o && num(o.temperature_c) && s.forecast?.length) {
    const temps = s.forecast.map((p) => p.temperature_c).filter(num)
    const hi = Math.max(...temps)
    const lo = Math.min(...temps)
    const hours = s.forecast.length
    if (temps.length && hi >= o.temperature_c + FORECAST_SWING_C && hi >= HOT_C) {
      out.push({ id: 'forecast-up', text: `The forecast reaches ${deg(hi)} within ${hours} hours, so cooling load may rise further.`, basis: ['forecast'] })
    } else if (temps.length && lo <= o.temperature_c - 2 * FORECAST_SWING_C) {
      out.push({ id: 'forecast-down', text: `The forecast drops to ${deg(lo)} within ${hours} hours, so cooling load may ease.`, basis: ['forecast'] })
    }
  }

  return out
}

/** Short status line for the panel when no rule applies. */
export function quietReason(s) {
  const r = s.readings ?? {}
  if (s.mode === 'live' && !Object.values(r).some(num)) return 'No readings from the solar system yet, so there is nothing to explain.'
  return `Nothing in the current readings points to a clear cause. Load is ${num(r.load_w) ? fmtNumber(r.load_w) + ' W' : 'not reported'}.`
}
