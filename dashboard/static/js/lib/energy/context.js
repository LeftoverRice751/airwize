/**
 * The input a future AI optimization service receives. The schema is
 * documented in webapp/services/energy_optimization.py; keep the two in step.
 * Only values present in the situation are included (null otherwise), so a
 * provider never sees invented readings.
 */
export function optimizationContext(s, explanations) {
  const r = s.readings ?? {}
  const val = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
  return {
    site_type: s.site.key,
    mode: s.mode,
    scenario: s.scenario ? { id: s.scenario.id, label: s.scenario.label, description: s.scenario.description } : null,
    clock: s.clock ? s.clock.toISOString() : null,
    readings: {
      charge_pct: val(r.charge_pct),
      voltage_v: val(r.voltage_v),
      load_w: val(r.load_w),
      solar_w: val(r.solar_w),
      generator_w: val(r.generator_w),
      drain_pct_per_h: val(s.drain?.ratePctH),
      hours_remaining: val(s.drain?.hoursLeft),
    },
    outside: s.outside
      ? {
          municipality: s.outside.municipality,
          temperature_c: val(s.outside.temperature_c),
          uv: val(s.outside.uv),
          plume_index: val(s.outside.plume_index),
          level: s.outside.level,
          source: s.mode === 'simulation' ? 'scripted' : 'live',
        }
      : null,
    forecast: (s.forecast ?? []).map((p) => ({
      timestamp: new Date(p.timestamp).toISOString(),
      temperature_c: val(p.temperature_c),
      uv: val(p.uv),
      plume_index: val(p.plume_index),
    })),
    explanations: explanations.map((e) => ({ id: e.id, text: e.text })),
  }
}
