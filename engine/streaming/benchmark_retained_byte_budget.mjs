import { RetainedByteBudgetGate } from './retained_byte_budget.mjs';

const TILE_BYTES = 4_456_448;
const profiles = [
  { name: '3-tile-accounting-cap', maxBytes: TILE_BYTES * 3 },
  { name: '2-tile-accounting-cap', maxBytes: TILE_BYTES * 2 },
  { name: '1-tile-accounting-cap', maxBytes: TILE_BYTES },
];

function run(profile) {
  const budget = new RetainedByteBudgetGate({ maxBytes: profile.maxBytes });
  const sequence = ['a', 'b', 'c', 'd', 'a', 'e', 'b', 'f'];
  let admitted = 0;
  let deferred = 0;
  const resident = [];

  for (const tileId of sequence) {
    budget.syncCommittedBytes(resident.length * TILE_BYTES);
    let reservation = budget.tryReserve(tileId, TILE_BYTES);
    if (!reservation && resident.length > 0) {
      resident.shift();
      budget.syncCommittedBytes(resident.length * TILE_BYTES);
      reservation = budget.tryReserve(tileId, TILE_BYTES);
    }
    if (!reservation) {
      deferred += 1;
      continue;
    }
    budget.commit(reservation, TILE_BYTES);
    resident.push(tileId);
    admitted += 1;
  }

  const snapshot = budget.snapshot();
  if (snapshot.overcommitBytes !== 0) throw new Error(`${profile.name} overcommitted`);
  return {
    profile: profile.name,
    maxBytes: profile.maxBytes,
    admitted,
    deferred,
    peakAccountedBytes: snapshot.metrics.peakAccountedBytes,
    reservationDeferrals: snapshot.metrics.reservationsDeferred,
    underestimateRejects: snapshot.metrics.underestimateRejects,
    overcommitBytes: snapshot.overcommitBytes,
  };
}

const result = profiles.map(run);
console.log(JSON.stringify({
  schema: 'nwe.retained-byte-budget-benchmark/0.1',
  tileBytes: TILE_BYTES,
  result,
}, null, 2));
