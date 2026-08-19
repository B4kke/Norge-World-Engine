import assert from 'node:assert/strict';
import {
  NetworkSpatialContractError,
  createNetworkSpatialFrame,
  decodeNetworkPosition,
  deserializeNetworkSpatialSnapshot,
  encodeNetworkPosition,
  networkSnapshotToWorldEntities,
  serializeNetworkSpatialSnapshot,
} from './network_state_contract.mjs';

const frame = Object.freeze({
  id: 'prototype0-nannestad-epsg25832-nn2000',
  horizontalCrs: 'EPSG:25832', horizontalUnit: 'metre',
  verticalDatum: 'NN2000', verticalUnit: 'metre',
});
const world = (easting, northing, height) => Object.freeze({ worldFrameId: frame.id, easting, northing, height });
const networkFrame = createNetworkSpatialFrame({
  networkFrameId: 'server-zone-a', worldFrame: frame, epoch: 4,
  anchorWorld: world(600000, 6700000, 180), positionQuantumMeters: 0.001,
});

{
  const source = world(600123.456789, 6700321.987654, 187.123456);
  const decoded = decodeNetworkPosition(encodeNetworkPosition(source, networkFrame), networkFrame);
  for (const axis of ['easting', 'northing', 'height']) assert.ok(Math.abs(decoded[axis] - source[axis]) <= 0.000500001);
}

{
  const entities = [{ id: 'b', position: world(600010.1, 6700010.2, 181.003) }, { id: 'a', position: world(600001.2, 6700003.4, 180.005) }];
  const baseline = serializeNetworkSpatialSnapshot({ worldFrame: frame, tick: 100, sequence: 7, networkFrame, entities });
  for (let epoch = 0; epoch < 1000; epoch += 1) {
    const ignoredRenderOrigin = { originSeriesId: 'view', epoch, anchorWorld: world(600000 + epoch * 250, 6700000 - epoch * 125, 180) };
    assert.ok(ignoredRenderOrigin.epoch >= 0);
    assert.equal(serializeNetworkSpatialSnapshot({ worldFrame: frame, tick: 100, sequence: 7, networkFrame, entities }), baseline);
  }
  assert.ok(!baseline.includes('renderOrigin') && !baseline.includes('originSeriesId') && !baseline.includes('originEpoch'));
}

{
  const source = world(600999.9996, 6700500.0004, 190.0004);
  const rebased = createNetworkSpatialFrame({
    networkFrameId: 'server-zone-a', worldFrame: frame, epoch: 5,
    anchorWorld: world(601000, 6700500, 190), positionQuantumMeters: 0.001,
  });
  const a = encodeNetworkPosition(source, networkFrame);
  const b = encodeNetworkPosition(source, rebased);
  assert.notDeepEqual(a.q, b.q);
  for (const [sample, nf] of [[a, networkFrame], [b, rebased]]) {
    const decoded = decodeNetworkPosition(sample, nf);
    for (const axis of ['easting', 'northing', 'height']) assert.ok(Math.abs(decoded[axis] - source[axis]) <= 0.000500001);
  }
}

{
  const sample = encodeNetworkPosition(world(600010, 6700010, 181), networkFrame);
  const stale = createNetworkSpatialFrame({ ...networkFrame, worldFrame: frame, epoch: 5 });
  assert.throws(() => decodeNetworkPosition(sample, stale), (error) => error instanceof NetworkSpatialContractError && error.code === 'NETWORK_EPOCH_MISMATCH');
  const foreign = createNetworkSpatialFrame({ ...networkFrame, worldFrame: frame, networkFrameId: 'other-zone' });
  assert.throws(() => decodeNetworkPosition(sample, foreign), (error) => error instanceof NetworkSpatialContractError && error.code === 'NETWORK_FRAME_MISMATCH');
}

{
  const otherFrame = Object.freeze({ ...frame, id: 'other-frame', horizontalCrs: 'EPSG:25833' });
  const otherNetwork = createNetworkSpatialFrame({ networkFrameId: 'other', worldFrame: otherFrame, epoch: 0, anchorWorld: { worldFrameId: otherFrame.id, easting: 300000, northing: 6700000, height: 180 }, positionQuantumMeters: 0.001 });
  assert.throws(() => encodeNetworkPosition(world(600000, 6700000, 180), otherNetwork), (error) => error instanceof NetworkSpatialContractError && error.code === 'WORLD_FRAME_MISMATCH');
}

{
  const tinyQuantum = createNetworkSpatialFrame({ networkFrameId: 'tiny', worldFrame: frame, epoch: 0, anchorWorld: world(0, 0, 0), positionQuantumMeters: 1e-12 });
  assert.throws(() => encodeNetworkPosition(world(600000, 6700000, 180), tinyQuantum), (error) => error instanceof NetworkSpatialContractError && error.code === 'QUANTIZED_RANGE_EXCEEDED');
}

{
  const snapshot = serializeNetworkSpatialSnapshot({
    worldFrame: frame, tick: 42, sequence: 9, networkFrame,
    entities: [{ id: 'z', position: world(600002.0014, 6700004.0024, 181.0034) }, { id: 'a', position: world(600001.0014, 6700003.0024, 180.0034) }],
  });
  const parsed = deserializeNetworkSpatialSnapshot(snapshot);
  assert.equal(parsed.entities[0].id, 'a');
  const decoded = networkSnapshotToWorldEntities(parsed);
  assert.equal(decoded[0].position.worldFrameId, frame.id);
  assert.equal(decoded[0].id, 'a');
}

{
  assert.throws(() => serializeNetworkSpatialSnapshot({
    worldFrame: frame, tick: 1, sequence: 1, networkFrame,
    entities: [{ id: 'x', position: world(600001, 6700001, 181), renderOriginEpoch: 12 }],
  }), (error) => error instanceof NetworkSpatialContractError && error.code === 'UNEXPECTED_FIELD');

  const good = JSON.parse(serializeNetworkSpatialSnapshot({ worldFrame: frame, tick: 1, sequence: 1, networkFrame, entities: [{ id: 'x', position: world(600001, 6700001, 181) }] }));
  good.renderOrigin = { epoch: 12 };
  assert.throws(() => deserializeNetworkSpatialSnapshot(JSON.stringify(good)), (error) => error instanceof NetworkSpatialContractError && error.code === 'UNEXPECTED_FIELD');
}

console.log(JSON.stringify({ status: 'PASS', contract: 'nwe.network-spatial-snapshot/0.1-candidate', cases: 8, quantumPolicy: 'OPEN', renderOriginAuthority: false }));
