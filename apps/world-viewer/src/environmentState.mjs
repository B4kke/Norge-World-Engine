export const ENVIRONMENT_STATE_SCHEMA = 'nwe.environment-state/0.1';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function createEnvironmentState(input = {}) {
  const cloudFraction = clamp(finiteOr(input.cloud_fraction, 0.35), 0, 1);
  const fogFraction = clamp(finiteOr(input.fog_fraction, 0), 0, 1);
  const precipitationMmPerHour = Math.max(0, finiteOr(input.precipitation_mm_per_hour, 0));
  const temperatureC = finiteOr(input.temperature_c, 8);
  const humidityFraction = clamp(finiteOr(input.humidity_fraction, 0.72), 0, 1);
  const windSpeedMps = Math.max(0, finiteOr(input.wind_speed_mps, 2));
  const wetness = clamp(Math.max(
    finiteOr(input.wetness, 0),
    precipitationMmPerHour > 0 ? 0.35 + Math.min(0.65, precipitationMmPerHour / 5) : 0,
  ), 0, 1);

  return Object.freeze({
    schema: ENVIRONMENT_STATE_SCHEMA,
    source: typeof input.source === 'string' ? input.source : 'fallback',
    source_timestamp: typeof input.source_timestamp === 'string' ? input.source_timestamp : null,
    fetched_at: typeof input.fetched_at === 'string' ? input.fetched_at : null,
    latitude: Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : null,
    longitude: Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : null,
    symbol_code: typeof input.symbol_code === 'string' ? input.symbol_code : null,
    temperature_c: temperatureC,
    humidity_fraction: humidityFraction,
    cloud_fraction: cloudFraction,
    fog_fraction: fogFraction,
    precipitation_mm_per_hour: precipitationMmPerHour,
    wind_speed_mps: windSpeedMps,
    wind_direction_deg: ((finiteOr(input.wind_direction_deg, 0) % 360) + 360) % 360,
    wetness,
    snow_fraction: clamp(finiteOr(input.snow_fraction, temperatureC <= 0 && precipitationMmPerHour > 0 ? 0.75 : 0), 0, 1),
  });
}

export function fallbackEnvironmentState(overrides = {}) {
  return createEnvironmentState({
    source: 'nwe-fallback-environment',
    temperature_c: 8,
    humidity_fraction: 0.72,
    cloud_fraction: 0.35,
    fog_fraction: 0,
    precipitation_mm_per_hour: 0,
    wind_speed_mps: 2,
    wind_direction_deg: 225,
    ...overrides,
  });
}
