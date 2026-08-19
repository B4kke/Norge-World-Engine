import { createEnvironmentState, fallbackEnvironmentState } from './environmentState.mjs';

// Accepted Preview 1 tile center transformed from EPSG:25832 (611500,6677500) to WGS84.
// Keep this isolated to the single-tile preview; larger-world manifests should carry geographic center metadata.
export const NANNESTAD_PREVIEW_WGS84 = Object.freeze({ latitude: 60.21899101080523, longitude: 11.012531197026972 });

function canUseHostedWeather(locationLike = globalThis.location) {
  const hostname = String(locationLike?.hostname ?? '').toLowerCase();
  const protocol = String(locationLike?.protocol ?? '').toLowerCase();
  return protocol === 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1';
}

export async function loadPreviewEnvironment({ fetchImpl = globalThis.fetch, locationLike = globalThis.location } = {}) {
  const coordinates = NANNESTAD_PREVIEW_WGS84;
  if (typeof fetchImpl !== 'function' || !canUseHostedWeather(locationLike)) {
    return fallbackEnvironmentState({ ...coordinates, source: 'nwe-local-fallback-environment' });
  }

  const url = new URL('/api/weather', locationLike.href);
  url.searchParams.set('lat', coordinates.latitude.toFixed(5));
  url.searchParams.set('lon', coordinates.longitude.toFixed(5));
  try {
    const response = await fetchImpl(url.href, { cache: 'no-store' });
    if (!response.ok) throw new Error(`WEATHER_HTTP_${response.status}`);
    const body = await response.json();
    if (body?.schema !== 'nwe.environment-state/0.1') throw new Error('WEATHER_SCHEMA_INVALID');
    return createEnvironmentState(body);
  } catch {
    return fallbackEnvironmentState({ ...coordinates, source: 'nwe-weather-unavailable-fallback' });
  }
}
