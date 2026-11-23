/**
 * Simulation-only mode: turns a scripted scenario (scenarios.js) into a
 * minute-by-minute run for one site type. Deterministic: the same scenario
 * and site always give the same numbers, so a restart replays exactly.
 *
 * Model (illustrative, not calibrated against real hardware):
 *   solar      PANEL_PEAK_W × clear-sky curve for the hour × scenario `sun`
 *   generator  GENERATOR_W, starts below GEN_START_PCT, stops at GEN_STOP_PCT
 *   storage    charge += (supply − load) over each minute ÷ site capacity
 *   voltage    48 V nominal pack, rises with charge
 *
 * The demo clock advances one demo minute per real TICK_MS.
 */
import { DURATION_MIN, MUNICIPALITY, at } from './scenarios.js'

export const TICK_MS = 500
const PANEL_PEAK_W = 2_000
const GENERATOR_W = 2_400
const GEN_START_PCT = 35
const GEN_STOP_PCT = 80

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Share of peak panel output for a clock hour (sunrise 06:00, sunset 18:00). */
const clearSky = (hour) => (hour <= 6 || hour >= 18 ? 0 : Math.sin((Math.PI * (hour - 6)) / 12) ** 1.2)

/** Today's date in Manila at `hour`:00, as a Date. */
export function demoStart(hour, today = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(today)
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00+08:00`)
}

/** Small deterministic wobble so the load line looks lived-in. */
const wobble = (minute) => 22 * Math.sin(minute / 7) + 12 * Math.sin(minute / 3.1)

export function simulate(scenario, site, start = demoStart(scenario.startHour)) {
  const storage = site.storage !== 'none'
  const points = []
  let charge = storage ? scenario.startCharge : null
  let genOn = false

  for (let minute = 0; minute <= DURATION_MIN; minute++) {
    const time = new Date(start.getTime() + minute * 60_000)
    const hour = scenario.startHour + minute / 60
    const load = Math.max(0, at(scenario.load, minute) + wobble(minute))

    let solar = null
    let generator = null
    if (site.source === 'solar') solar = PANEL_PEAK_W * clearSky(hour % 24) * at(scenario.sun, minute)
    if (site.source === 'generator') {
      if (charge < GEN_START_PCT) genOn = true
      else if (charge >= GEN_STOP_PCT) genOn = false
      generator = genOn ? GENERATOR_W : 0
    }

    let netW = 0
    let voltage = null
    if (storage) {
      let supply = (solar ?? 0) + (generator ?? 0)
      // A full battery cannot absorb surplus: the inverter throttles the panels.
      if (charge >= 100 && supply > load && solar !== null) {
        solar = Math.max(0, load - (generator ?? 0))
        supply = solar + (generator ?? 0)
      }
      netW = supply - load
      if (minute > 0) charge = clamp(charge + (netW / 60 / site.capacityWh) * 100, 0, 100)
      voltage = 47 + 0.065 * charge - (netW < 0 ? 0.25 : -0.35)
    }

    points.push({
      minute,
      time,
      load,
      solar,
      generator,
      charge,
      voltage,
      // %/h: positive while draining, negative while charging.
      drainPctH: storage ? (-netW / site.capacityWh) * 100 : null,
      outside: outsideAt(scenario, minute, time),
    })
  }
  return points
}

function outsideAt(scenario, minute, time) {
  return {
    municipality: MUNICIPALITY,
    temperature_c: at(scenario.outside.temp, minute),
    uv: Math.round(at(scenario.outside.uv, minute)),
    plume_index: at(scenario.outside.pi, minute),
    time,
  }
}

/** Scripted outside conditions for each of the next six hours. */
export function scriptedForecast(scenario, minute, time) {
  return [1, 2, 3, 4, 5, 6].map((hr) => {
    const o = outsideAt(scenario, minute + hr * 60, new Date(time.getTime() + hr * 3_600_000))
    return { timestamp: o.time.getTime(), temperature_c: o.temperature_c, uv: o.uv, plume_index: o.plume_index }
  })
}

/**
 * One playing scenario. `minute` advances one per tick until the run ends;
 * restart() rewinds to the start.
 */
export class DemoRun {
  constructor(scenario, site) {
    this.scenario = scenario
    this.site = site
    this.points = simulate(scenario, site)
    this.minute = 0
  }

  get done() {
    return this.minute >= DURATION_MIN
  }

  tick() {
    if (!this.done) this.minute += 1
  }

  restart() {
    this.minute = 0
  }

  current() {
    return this.points[this.minute]
  }

  /** The run so far, for the chart. */
  history() {
    return this.points.slice(0, this.minute + 1)
  }

  /** The point `minutes` ago, if the run has been going that long. */
  ago(minutes) {
    return this.minute >= minutes ? this.points[this.minute - minutes] : null
  }
}
