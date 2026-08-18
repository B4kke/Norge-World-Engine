import assert from 'node:assert/strict';
import {
  createNetworkWorldFrame,
  serializeNetworkWorldSnapshot,
  deserializeNetworkWorldSnapshot,
  NetworkSnapshotError,
} from './network_snapshot_contract.mjs';

const worldFrame = Object.freeze({
  id: 'nannestad-25832-nn2000-v0.1',
  horizontalCrs: 'EPSG:25832',
  horizontalUnit: 'metre',
  verticalDatum: 'NN2000',
  verticalUnit: 'metre',
});

const position = (easting, northing, height) => ({
  worldFrameId: worldFrame.id,
  easting,
  northing,
  height,
});

const networkFrame = createNetworkWorldFrame({
  id: 'net-cell-a',
  worldFrame,
  anchorWorld: position(620000, 6660000, 200),
  resolutionMm: 1,
});

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`, error);
    process.exitCode = 1;
  }
}

function expectCode(code, fn) {
  assert.throws(fn, (error) => error instanceof NetworkSnapshotError && error.code === code);
}

test('large coordinates roundtrip stays within half quantization step', () => {
  const original = position(620123.4564, 6660789.0126, 211.9874);
  const serialized = serializeNetworkWorldSnapshot({
    worldFrame,
    networkFrame,
    tick: 10,
    sequence: 4,
    entities: [{ id: 'car', position: original }],
  });
  const decoded = deserializeNetworkWorldSnapshot(serialized).entities[0].position;
  assert.ok(Math.abs(decoded.easting - original.easting) <= 0.0005 + 1e-12);
  assert.ok(Math.abs(decoded.northing - original.northing) <= 0.0005 + 1e-12);
  assert.ok(Math.abs(decoded.height - original.height) <= 0.0005 + 1e-12);
});

test('render-origin data cannot enter wire snapshot', () => {
  const args = {
    worldFrame,
    networkFrame,
    tick: 11,
    sequence: 5,
    renderOrigin: {
      originSeriesId: 'render',
      epoch: 99,
      anchorWorld: position(623000, 6663000, 200),
    },
    entities: [{ id: 'car', position: position(620001.25, 6660002.5, 201) }],
  };
  const first = serializeNetworkWorldSnapshot(args);
  const second = serializeNetworkWorldSnapshot({
    ...args,
    renderOrigin: {
      originSeriesId: 'render',
      epoch: 1000,
      anchorWorld: position(900000, 7000000, 0),
    },
  });
  assert.equal(first, second);
  assert.equal(first.includes('originSeriesId'), false);
  assert.equal(first.includes('originEpoch'), false);
});

test('deterministic ordering supports replay', () => {
  const a = { id: 'a', position: position(620001, 6660001, 201) };
  const b = { id: 'b', position: position(620002, 6660002, 202) };
  const first = serializeNetworkWorldSnapshot({ worldFrame, networkFrame, tick: 12, sequence: 6, entities: [b, a] });
  const second = serializeNetworkWorldSnapshot({ worldFrame, networkFrame, tick: 12, sequence: 6, entities: [a, b] });
  assert.equal(first, second);
});

test('tile boundary crossing remains world-frame continuous', () => {
  const entities = [
    { id: 'before', position: position(621999.9994, 6660000, 200) },
    { id: 'after', position: position(622000.0006, 6660000, 200) },
  ];
  const decoded = deserializeNetworkWorldSnapshot(serializeNetworkWorldSnapshot({
    worldFrame,
    networkFrame,
    tick: 13,
    sequence: 7,
    entities,
  }));
  const before = decoded.entities.find((entity) => entity.id === 'before').position.easting;
  const after = decoded.entities.find((entity) => entity.id === 'after').position.easting;
  assert.ok(after > before);
});

test('frame metadata mismatch fails closed', () => {
  const bad = { ...networkFrame, verticalDatum: 'ELLIPSOID' };
  expectCode('FRAME_METADATA_MISMATCH', () => serializeNetworkWorldSnapshot({
    worldFrame,
    networkFrame: bad,
    tick: 1,
    sequence: 1,
    entities: [],
  }));
});

test('wrong entity world frame fails closed', () => {
  expectCode('WORLD_FRAME_MISMATCH', () => serializeNetworkWorldSnapshot({
    worldFrame,
    networkFrame,
    tick: 1,
    sequence: 1,
    entities: [{ id: 'x', position: { ...position(620000, 6660000, 200), worldFrameId: 'other' } }],
  }));
});

test('signed 32-bit quantization range is explicit', () => {
  expectCode('QUANTIZATION_RANGE_EXCEEDED', () => serializeNetworkWorldSnapshot({
    worldFrame,
    networkFrame,
    tick: 1,
    sequence: 1,
    entities: [{ id: 'far', position: position(3000000, 6660000, 200) }],
  }));
});

test('duplicate ids fail during decode', () => {
  const serialized = serializeNetworkWorldSnapshot({
    worldFrame,
    networkFrame,
    tick: 1,
    sequence: 1,
    entities: [{ id: 'a', position: position(620000, 6660000, 200) }],
  });
  const parsed = JSON.parse(serialized);
  parsed.entities.push(parsed.entities[0]);
  expectCode('DUPLICATE_ENTITY', () => deserializeNetworkWorldSnapshot(JSON.stringify(parsed)));
});

if (!process.exitCode) console.log(`PASS ${passed}/8 network snapshot contract regressions`);
