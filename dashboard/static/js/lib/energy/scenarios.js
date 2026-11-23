/**
 * The five scripted demo scenarios for simulation-only mode.
 *
 * Every figure here is illustrative: a plausible small household, NOT data
 * measured on a real system. Replace the keyframes with recorded values when
 * a real site's numbers are available (see README.md, "Energy tab").
 *
 * Keyframes are [minute from scenario start, value] pairs and are linearly
 * interpolated; a value holds after its last keyframe. Scenarios run for
 * DURATION_MIN demo minutes. The outside series runs a further 6 hours past
 * the end so the scripted forecast always has something to show.
 *
 *   outside.temp   °C       outside.uv  UV index
 *   outside.pi     Plume index (air quality)
 *   sun            share of clear-sky sunlight reaching the panels (haze, cloud)
 *   load           W drawn by appliances
 */
export const DURATION_MIN = 360
export const MUNICIPALITY = 'Calamba'

export const SCENARIOS = [
  {
    id: 'typical',
    label: 'Typical day',
    description: 'A clear, ordinary day: steady household load and good sun.',
    startHour: 10,
    startCharge: 62,
    outside: {
      temp: [[0, 30], [180, 32], [360, 31], [720, 27]],
      uv: [[0, 8], [120, 10], [300, 6], [420, 0]],
      pi: [[0, 32], [360, 38], [720, 30]],
    },
    sun: [[0, 0.95]],
    load: [[0, 420], [120, 480], [240, 450], [330, 560], [360, 600]],
  },
  {
    id: 'heat',
    label: 'Heat wave',
    description: 'The afternoon climbs to 36 °C and cooling load rises with it.',
    startHour: 11,
    startCharge: 70,
    outside: {
      temp: [[0, 33], [90, 35], [150, 36], [300, 36.5], [480, 37.5], [600, 33], [720, 30]],
      uv: [[0, 10], [120, 11], [300, 7], [420, 1], [480, 0]],
      pi: [[0, 40], [360, 47], [720, 38]],
    },
    sun: [[0, 0.9]],
    load: [[0, 600], [60, 720], [150, 1050], [300, 1100], [360, 1150]],
  },
  {
    id: 'haze',
    label: 'Hazy afternoon',
    description: 'Thick haze dims the sun, so the panels produce much less.',
    startHour: 12,
    startCharge: 55,
    outside: {
      temp: [[0, 31], [180, 32], [360, 30], [720, 27]],
      uv: [[0, 4], [180, 3], [300, 1], [360, 0]],
      pi: [[0, 95], [90, 120], [240, 130], [360, 110], [720, 70]],
    },
    sun: [[0, 0.4], [90, 0.3], [240, 0.28], [360, 0.35]],
    load: [[0, 480], [180, 500], [360, 620]],
  },
  {
    id: 'appliance',
    label: 'Appliance on',
    description: 'A large appliance switches on an hour in and runs for 90 minutes.',
    startHour: 13,
    startCharge: 60,
    outside: {
      temp: [[0, 31], [240, 30], [360, 29], [720, 26]],
      uv: [[0, 9], [180, 5], [300, 1], [360, 0]],
      pi: [[0, 36], [360, 40], [720, 34]],
    },
    sun: [[0, 0.9]],
    load: [[0, 400], [59, 410], [60, 1600], [150, 1620], [151, 430], [360, 520]],
  },
  {
    id: 'evening',
    label: 'Evening drain',
    description: 'The sun sets and stored energy carries the evening and night load.',
    startHour: 17,
    startCharge: 88,
    outside: {
      temp: [[0, 30], [120, 28.5], [360, 26.5], [720, 25]],
      uv: [[0, 2], [60, 0]],
      pi: [[0, 40], [240, 48], [720, 36]],
    },
    sun: [[0, 0.9]],
    load: [[0, 520], [60, 760], [180, 820], [270, 420], [300, 300], [360, 280]],
  },
]

export const scenarioFor = (id) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]

/** Linear interpolation over [minute, value] keyframes. */
export function at(keyframes, minute) {
  if (minute <= keyframes[0][0]) return keyframes[0][1]
  for (let i = 1; i < keyframes.length; i++) {
    const [m1, v1] = keyframes[i]
    if (minute <= m1) {
      const [m0, v0] = keyframes[i - 1]
      return v0 + ((v1 - v0) * (minute - m0)) / (m1 - m0 || 1)
    }
  }
  return keyframes.at(-1)[1]
}
