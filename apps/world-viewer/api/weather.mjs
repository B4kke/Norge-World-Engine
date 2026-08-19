import { environmentStateFromMetLocationforecast } from '../src/metWeatherAdapter.mjs';

const MET_ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const DEFAULT_USER_AGENT = 'NorgeWorldEngine/0.1 https://github.com/B4kke/Norge-World-Engine';

function numericQuery(value, { min, max, label }) {
  const number = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`INVALID_${label.toUpperCase()}`);
  return number;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  let latitude;
  let longitude;
  try {
    latitude = numericQuery(request.query?.lat, { min: -90, max: 90, label: 'lat' });
    longitude = numericQuery(request.query?.lon, { min: -180, max: 180, label: 'lon' });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }

  const url = new URL(MET_ENDPOINT);
  url.searchParams.set('lat', latitude.toFixed(5));
  url.searchParams.set('lon', longitude.toFixed(5));

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': process.env.NWE_MET_USER_AGENT || DEFAULT_USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (!upstream.ok) {
      response.setHeader('Cache-Control', 'no-store');
      return response.status(502).json({ error: 'MET_UPSTREAM_ERROR', status: upstream.status });
    }
    const payload = await upstream.json();
    const environment = environmentStateFromMetLocationforecast(payload, {
      latitude,
      longitude,
      fetchedAt: new Date().toISOString(),
    });

    response.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=300');
    response.setHeader('X-NWE-Weather-Source', 'met-locationforecast-2.0');
    if (upstream.headers.get('last-modified')) response.setHeader('X-NWE-Upstream-Last-Modified', upstream.headers.get('last-modified'));
    if (upstream.headers.get('expires')) response.setHeader('X-NWE-Upstream-Expires', upstream.headers.get('expires'));
    return response.status(200).json(environment);
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(502).json({ error: 'MET_PROXY_FAILURE', message: error instanceof Error ? error.message : String(error) });
  }
}
