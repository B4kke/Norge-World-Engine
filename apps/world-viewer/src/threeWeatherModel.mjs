const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export const NANNESTAD_WEATHER_LOCATION = Object.freeze({
  id: 'epsg25832_611000_6677000_1000m-center',
  latitude_deg: 60.21899101080523,
  longitude_deg: 11.012531197026972,
  source: 'EPSG:25832 tile center transformed to WGS84 for presentation-only solar position',
});

export const WEATHER_PRESET_IDS = Object.freeze(['clear', 'partly-cloudy', 'overcast', 'rain', 'fog']);

export const WEATHER_PRESETS = Object.freeze({
  clear: Object.freeze({
    id: 'clear', label: 'Klar',
    skyColor: 0xb9d8ec, fogColor: 0xc5d8e4,
    cloudCoverage: 0.08, cloudDensity: 0.22, cloudElevation: 0.38, cloudScale: 0.00018, cloudSpeed: 0.000055,
    turbidity: 2.1, rayleigh: 1.75, mieCoefficient: 0.0035, mieDirectionalG: 0.79,
    sunIntensityScale: 1.0, hemisphereScale: 1.0, environmentScale: 1.0,
    fogNearScale: 1.28, fogFarScale: 1.22,
    rainRate: 0, windSpeedMps: 2.5, windDirectionDeg: 235,
  }),
  'partly-cloudy': Object.freeze({
    id: 'partly-cloudy', label: 'Delvis skyet',
    skyColor: 0xaec9d9, fogColor: 0xbacbd4,
    cloudCoverage: 0.42, cloudDensity: 0.5, cloudElevation: 0.48, cloudScale: 0.00022, cloudSpeed: 0.000085,
    turbidity: 3.0, rayleigh: 1.45, mieCoefficient: 0.006, mieDirectionalG: 0.82,
    sunIntensityScale: 0.83, hemisphereScale: 1.02, environmentScale: 0.9,
    fogNearScale: 1.0, fogFarScale: 1.0,
    rainRate: 0, windSpeedMps: 5.5, windDirectionDeg: 245,
  }),
  overcast: Object.freeze({
    id: 'overcast', label: 'Overskyet',
    skyColor: 0x97a7ad, fogColor: 0xaab4b7,
    cloudCoverage: 0.88, cloudDensity: 0.84, cloudElevation: 0.56, cloudScale: 0.0002, cloudSpeed: 0.0001,
    turbidity: 7.5, rayleigh: 0.78, mieCoefficient: 0.022, mieDirectionalG: 0.88,
    sunIntensityScale: 0.34, hemisphereScale: 0.92, environmentScale: 0.66,
    fogNearScale: 0.7, fogFarScale: 0.68,
    rainRate: 0, windSpeedMps: 7.5, windDirectionDeg: 250,
  }),
  rain: Object.freeze({
    id: 'rain', label: 'Regn',
    skyColor: 0x77868c, fogColor: 0x89979b,
    cloudCoverage: 0.97, cloudDensity: 0.94, cloudElevation: 0.62, cloudScale: 0.00019, cloudSpeed: 0.00015,
    turbidity: 10.0, rayleigh: 0.52, mieCoefficient: 0.035, mieDirectionalG: 0.9,
    sunIntensityScale: 0.18, hemisphereScale: 0.78, environmentScale: 0.45,
    fogNearScale: 0.5, fogFarScale: 0.46,
    rainRate: 1.0, windSpeedMps: 10.5, windDirectionDeg: 255,
  }),
  fog: Object.freeze({
    id: 'fog', label: 'Tåke',
    skyColor: 0xb1b8b8, fogColor: 0xb8bdbc,
    cloudCoverage: 0.72, cloudDensity: 0.66, cloudElevation: 0.72, cloudScale: 0.00017, cloudSpeed: 0.000045,
    turbidity: 12.5, rayleigh: 0.42, mieCoefficient: 0.055, mieDirectionalG: 0.92,
    sunIntensityScale: 0.12, hemisphereScale: 0.96, environmentScale: 0.4,
    fogNearScale: 0.13, fogFarScale: 0.23,
    rainRate: 0, windSpeedMps: 1.8, windDirectionDeg: 220,
  }),
});

export function resolveWeatherPreset(value = 'partly-cloudy') {
  return WEATHER_PRESETS[WEATHER_PRESET_IDS.includes(value) ? value : 'partly-cloudy'];
}

export function resolveWeatherPresetFromSearch(search = '') {
  try {
    const requested = new URLSearchParams(search).get('weather');
    return resolveWeatherPreset(requested || 'partly-cloudy');
  } catch {
    return resolveWeatherPreset('partly-cloudy');
  }
}

function dayOfYearUtc(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

/**
 * Fixed presentation solar clock for deterministic visual regression captures.
 * Ordinary gameplay remains live-time when the explicit UTC override is absent.
 * Never describe this URL parameter as observed weather or live clock data.
 */
export function resolveSolarClockFromSearch(search = '') {
  const value = new URLSearchParams(search).get('solarTime');
  if (value == null) return Object.freeze({
    mode: 'live-browser-time',
    fixed_time_ms: null,
    fixed_time_utc: null,
  });
  // Require unambiguous seconds and UTC. Date.parse silently normalizes
  // impossible dates such as February 30, so roundtrip-check the result.
  if (!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/.test(value)) {
    throw new RangeError('NWE_SOLAR_TIME_OVERRIDE_INVALID');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
      || new Date(milliseconds).toISOString().replace('.000Z', 'Z') !== value) {
    throw new RangeError('NWE_SOLAR_TIME_OVERRIDE_INVALID');
  }
  return Object.freeze({
    mode: 'fixed-utc-presentation-time',
    fixed_time_ms: milliseconds,
    fixed_time_utc: value,
  });
}

/** NOAA-style solar approximation, sufficient for daylight direction/rendering. */
export function solarPositionForDate(dateInput, location = NANNESTAD_WEATHER_LOCATION) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (!Number.isFinite(date.getTime())) throw new TypeError('solar date must be valid');
  const latitudeDeg = Number(location?.latitude_deg);
  const longitudeDeg = Number(location?.longitude_deg);
  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) throw new TypeError('solar location must contain finite latitude_deg/longitude_deg');

  const day = dayOfYearUtc(date);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const fractionalHour = utcMinutes / 60;
  const gamma = TAU / 365 * (day - 1 + (fractionalHour - 12) / 24);
  const equationOfTimeMinutes = 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  );
  const declination = 0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.00148 * Math.sin(3 * gamma);

  const trueSolarMinutes = ((utcMinutes + equationOfTimeMinutes + 4 * longitudeDeg) % 1440 + 1440) % 1440;
  const hourAngleDeg = trueSolarMinutes / 4 - 180;
  const hourAngle = hourAngleDeg * DEG;
  const latitude = latitudeDeg * DEG;
  const altitude = Math.asin(
    Math.sin(latitude) * Math.sin(declination)
    + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azimuthFromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude),
  );
  const azimuth = ((azimuthFromSouth + Math.PI) % TAU + TAU) % TAU;

  return Object.freeze({
    altitude_radians: altitude,
    altitude_deg: altitude * RAD,
    azimuth_radians: azimuth,
    azimuth_deg: normalizeDegrees(azimuth * RAD),
    equation_of_time_minutes: equationOfTimeMinutes,
    solar_declination_radians: declination,
    day_of_year_utc: day,
  });
}

/** Render coordinates are +X east, +Y up, -Z north. */
export function renderSunDirection(solarPosition) {
  const altitude = Number(solarPosition?.altitude_radians);
  const azimuth = Number(solarPosition?.azimuth_radians);
  if (!Number.isFinite(altitude) || !Number.isFinite(azimuth)) throw new TypeError('solar position is required');
  const horizontal = Math.cos(altitude);
  const east = Math.sin(azimuth) * horizontal;
  const north = Math.cos(azimuth) * horizontal;
  return Object.freeze([east, Math.sin(altitude), -north]);
}

export function daylightFactor(altitudeDeg) {
  const t = Math.max(0, Math.min(1, (Number(altitudeDeg) + 6) / 18));
  return t * t * (3 - 2 * t);
}
