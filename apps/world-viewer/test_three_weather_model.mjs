import assert from 'node:assert/strict';
import {
  NANNESTAD_WEATHER_LOCATION,
  WEATHER_PRESET_IDS,
  daylightFactor,
  renderSunDirection,
  resolveWeatherPreset,
  resolveWeatherPresetFromSearch,
  solarPositionForDate,
} from './src/threeWeatherModel.mjs';

assert.equal(resolveWeatherPreset('rain').id, 'rain');
assert.equal(resolveWeatherPreset('unknown').id, 'partly-cloudy');
assert.equal(resolveWeatherPresetFromSearch('?weather=fog').id, 'fog');
assert.deepEqual(WEATHER_PRESET_IDS, ['clear', 'partly-cloudy', 'overcast', 'rain', 'fog']);

const summerNoon = solarPositionForDate(new Date('2026-06-21T11:00:00Z'));
assert.ok(summerNoon.altitude_deg > 45 && summerNoon.altitude_deg < 60, `summer noon altitude unexpected: ${summerNoon.altitude_deg}`);
assert.ok(summerNoon.azimuth_deg > 150 && summerNoon.azimuth_deg < 220, `summer noon azimuth unexpected: ${summerNoon.azimuth_deg}`);
const summerDirection = renderSunDirection(summerNoon);
assert.ok(summerDirection[1] > 0.7, 'summer-noon sun must be high above the horizon');
assert.ok(Math.abs(Math.hypot(...summerDirection) - 1) < 1e-12, 'render sun direction must be normalized');

const winterNight = solarPositionForDate(new Date('2026-12-21T00:00:00Z'));
assert.ok(winterNight.altitude_deg < -20, `winter midnight sun must be below horizon: ${winterNight.altitude_deg}`);
assert.equal(daylightFactor(-6), 0);
assert.equal(daylightFactor(12), 1);
assert.ok(daylightFactor(3) > 0 && daylightFactor(3) < 1);

assert.equal(NANNESTAD_WEATHER_LOCATION.latitude_deg, 60.21899101080523);
assert.equal(NANNESTAD_WEATHER_LOCATION.longitude_deg, 11.012531197026972);

console.log('THREE_WEATHER_MODEL_PASS');
