import assert from 'node:assert/strict';
import {
  NANNESTAD_WEATHER_LOCATION,
  WEATHER_PRESET_IDS,
  daylightFactor,
  renderSunDirection,
  resolveWeatherPreset,
  resolveWeatherPresetFromSearch,
  resolveSolarClockFromSearch,
  solarPositionForDate,
  osloTimeOfDayMinutes,
  osloTimestampForTimeOfDay,
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

const liveClock = resolveSolarClockFromSearch('?weather=rain');
assert.equal(liveClock.mode, 'live-browser-time');
assert.equal(liveClock.fixed_time_ms, null);
const visualClock = resolveSolarClockFromSearch('?solarTime=2026-07-23T11%3A00%3A00Z');
assert.equal(visualClock.mode, 'fixed-utc-presentation-time');
assert.equal(visualClock.fixed_time_utc, '2026-07-23T11:00:00Z');
assert.equal(visualClock.fixed_time_ms, Date.parse('2026-07-23T11:00:00Z'));
assert.ok(solarPositionForDate(new Date(visualClock.fixed_time_ms)).altitude_deg > 40);
for (const invalid of ['2026-02-30T11:00:00Z', '2026-07-23T11:00:00+02:00', 'today', '2026-07-23T11:00:00.000Z']) {
  assert.throws(() => resolveSolarClockFromSearch(`?solarTime=${encodeURIComponent(invalid)}`), /NWE_SOLAR_TIME_OVERRIDE_INVALID/);
}

assert.equal(osloTimeOfDayMinutes(Date.parse('2026-06-21T10:30:00Z')), 750, 'Norwegian summer UTC+2');
assert.equal(osloTimeOfDayMinutes(Date.parse('2026-12-21T11:30:00Z')), 750, 'Norwegian winter UTC+1');
assert.equal(new Date(osloTimestampForTimeOfDay(720, Date.parse('2026-06-21T00:00:00Z'))).toISOString(),
  '2026-06-21T10:00:00.000Z', 'summer noon uses Oslo DST');
assert.equal(new Date(osloTimestampForTimeOfDay(720, Date.parse('2026-12-21T00:00:00Z'))).toISOString(),
  '2026-12-21T11:00:00.000Z', 'winter noon uses standard Oslo time');
assert.equal(new Date(osloTimestampForTimeOfDay(150, Date.parse('2026-03-29T00:00:00Z'))).toISOString(),
  '2026-03-29T01:00:00.000Z', 'nonexistent spring 02:30 advances to 03:00 CEST');
for (const invalidMinute of [-1, 1440, Number.NaN, 1.2, '720']) {
  assert.throws(() => osloTimestampForTimeOfDay(invalidMinute), /NWE_OSLO_TIME_OF_DAY_INVALID/);
}
console.log('THREE_WEATHER_MODEL_PASS');
