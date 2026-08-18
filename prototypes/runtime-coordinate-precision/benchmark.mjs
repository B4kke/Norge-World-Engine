import { performance } from 'node:perf_hooks';
import {
  absoluteFloat32RoundTrip,
  float32Ulp,
  rebasePositionsFloat64ToFloat32,
  rebasedFloat32RoundTrip,
} from './precision.mjs';

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function seededPositions(count) {
  const values = new Float64Array(count * 3);
  let seed = 0x12345678;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < count; i += 1) {
    values[i * 3] = 611_000 + (random() - 0.5) * 20_000;
    values[i * 3 + 1] = 6_677_000 + (random() - 0.5) * 20_000;
    values[i * 3 + 2] = 190 + (random() - 0.5) * 100;
  }
  return values;
}

const northing = 6_677_000;
const easting = 611_000;

// Fixed regional magnitude probes were derived once with pyproj/PROJ from the
// listed WGS84 test coordinates into the appropriate ETRS89 / UTM zone. They
// are benchmark inputs only: this does not select one UTM zone as Norway's
// final runtime CRS.
const regionalMagnitudeProbes = [
  {
    id: 'south_utm32',
    source_wgs84: [8.0, 58.0],
    target_epsg: 25832,
    easting_m: 440_892.1051744548,
    northing_m: 6_429_147.611009516,
  },
  {
    id: 'mid_utm32',
    source_wgs84: [10.4, 63.4],
    target_epsg: 25832,
    easting_m: 569_937.3816474526,
    northing_m: 7_030_921.370894932,
  },
  {
    id: 'north_utm33',
    source_wgs84: [18.95, 69.65],
    target_epsg: 25833,
    easting_m: 653_210.0894847008,
    northing_m: 7_731_796.8302624365,
  },
  {
    id: 'far_north_utm35',
    source_wgs84: [29.0, 70.0],
    target_epsg: 25835,
    easting_m: 576_330.6574114808,
    northing_m: 7_767_125.170835211,
  },
];

const regionalFloat32 = regionalMagnitudeProbes.map((probe) => {
  const storedEasting = absoluteFloat32RoundTrip(probe.easting_m);
  const storedNorthing = absoluteFloat32RoundTrip(probe.northing_m);
  const localProbe = 1_000.1234567;
  const worldNorthing = probe.northing_m + localProbe;
  const rebasedNorthing = rebasedFloat32RoundTrip(worldNorthing, probe.northing_m);
  return {
    ...probe,
    easting_ulp_m: float32Ulp(probe.easting_m),
    northing_ulp_m: float32Ulp(probe.northing_m),
    absolute_easting_error_mm: Math.abs(storedEasting - probe.easting_m) * 1_000,
    absolute_northing_error_mm: Math.abs(storedNorthing - probe.northing_m) * 1_000,
    rebased_1km_probe_error_mm: Math.abs(rebasedNorthing - worldNorthing) * 1_000,
  };
});

const absoluteOffsets = [0.001, 0.01, 0.05, 0.1, 0.2, 0.25, 0.49, 0.5, 0.75, 1.0];
const absolute = absoluteOffsets.map((offset) => {
  const world = northing + offset;
  const stored = absoluteFloat32RoundTrip(world);
  return {
    offset_m: offset,
    stored_offset_m: stored - northing,
    error_mm: Math.abs(stored - world) * 1_000,
  };
});

const probes = [0.001, 0.003, 0.007, 0.011, 0.037, 0.099, 0.1234567, 0.3333333, 0.7777777];
const radii = [1, 10, 100, 1_000, 10_000, 100_000, 250_000, 500_000, 1_000_000];
const radiusSweep = radii.map((radius) => {
  let maxError = 0;
  for (const probe of probes) {
    for (const sign of [-1, 1]) {
      const local = sign * (radius + probe);
      const world = northing + local;
      const reconstructed = rebasedFloat32RoundTrip(world, northing);
      maxError = Math.max(maxError, Math.abs(reconstructed - world));
    }
  }
  return {
    radius_m: radius,
    float32_ulp_mm: float32Ulp(radius) * 1_000,
    observed_max_error_mm: maxError * 1_000,
  };
});

const zPrecision = [0, 200, 2_000, 10_000].map((base) => {
  const world = base + 0.001;
  const stored = absoluteFloat32RoundTrip(world);
  return {
    z_base_m: base,
    error_mm: Math.abs(stored - world) * 1_000,
    float32_ulp_mm: float32Ulp(Math.max(base, 1)) * 1_000,
  };
});

const cpu = [];
for (const entities of [1_000, 10_000, 100_000]) {
  const source = seededPositions(entities);
  const output = new Float32Array(source.length);
  const origin = [611_000, 6_677_000, 180];
  for (let i = 0; i < 20; i += 1) {
    rebasePositionsFloat64ToFloat32(source, origin, output);
  }
  const samples = [];
  for (let i = 0; i < 80; i += 1) {
    const started = performance.now();
    rebasePositionsFloat64ToFloat32(source, origin, output);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  cpu.push({
    entities,
    median_ms: percentile(samples, 0.5),
    p95_ms: percentile(samples, 0.95),
    min_ms: samples[0],
    max_ms: samples.at(-1),
  });
}

console.log(JSON.stringify({
  schema: 'nwe.runtime-coordinate-precision-benchmark/0.1',
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  },
  probe_world: {
    horizontal_crs_context: 'Prototype-0 EPSG:25832 magnitude only',
    easting_m: easting,
    northing_m: northing,
  },
  regional_utm_magnitude_probes: regionalFloat32,
  absolute_float32: {
    easting_ulp_m: float32Ulp(easting),
    northing_ulp_m: float32Ulp(northing),
    offsets: absolute,
  },
  rebased_float32_radius_sweep: radiusSweep,
  z_float32: zPrecision,
  cpu_rebase_v8: cpu,
  interpretation_boundary: 'Regional probes test numeric magnitude only. CPU timings are Node/V8 host evidence only, not Android/browser/GPU performance.',
}, null, 2));
