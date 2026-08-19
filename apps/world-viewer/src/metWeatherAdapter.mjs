import { createEnvironmentState } from './environmentState.mjs';

function firstTimeseries(payload) {
  const timeseries = payload?.properties?.timeseries;
  if (!Array.isArray(timeseries) || timeseries.length === 0) throw new Error('MET_LOCATIONFORECAST_TIMESERIES_MISSING');
  return timeseries[0];
}

export function environmentStateFromMetLocationforecast(payload, { latitude, longitude, fetchedAt = new Date().toISOString() } = {}) {
  const point = firstTimeseries(payload);
  const instant = point?.data?.instant?.details ?? {};
  const nextHour = point?.data?.next_1_hours ?? {};
  const precipitation = Number(nextHour?.details?.precipitation_amount ?? 0);
  const temperature = Number(instant.air_temperature);
  const snowFraction = Number.isFinite(temperature) && temperature <= 0 && precipitation > 0 ? 0.8 : 0;

  return createEnvironmentState({
    source: 'met-locationforecast-2.0',
    source_timestamp: point?.time ?? null,
    fetched_at: fetchedAt,
    latitude,
    longitude,
    symbol_code: nextHour?.summary?.symbol_code ?? null,
    temperature_c: instant.air_temperature,
    humidity_fraction: Number(instant.relative_humidity) / 100,
    cloud_fraction: Number(instant.cloud_area_fraction) / 100,
    fog_fraction: Number(instant.fog_area_fraction) / 100,
    precipitation_mm_per_hour: Number.isFinite(precipitation) ? precipitation : 0,
    wind_speed_mps: instant.wind_speed,
    wind_direction_deg: instant.wind_from_direction,
    snow_fraction: snowFraction,
  });
}
