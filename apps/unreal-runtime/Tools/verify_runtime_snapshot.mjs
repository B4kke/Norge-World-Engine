#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { verifyRuntimeBundle } from '../../../engine/streaming/runtime_verifier.mjs';

const snapshotRoot = process.argv[2];
if (!snapshotRoot) {
  console.error('usage: verify_runtime_snapshot.mjs SNAPSHOT_DIR');
  process.exit(2);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const root = resolve(snapshotRoot);
const manifest = readJson(resolve(root, 'manifest.json'));
const results = {};

for (const layer of ['terrain', 'roads', 'buildings']) {
  const descriptor = manifest[layer];
  if (!descriptor?.bundle?.startsWith('./') || !descriptor?.compiled_path?.startsWith('./')) {
    throw new Error(`manifest ${layer} paths must be local snapshot paths`);
  }
  const bundle = readJson(resolve(root, descriptor.bundle.slice(2)));
  const artifactBytes = new Uint8Array(readFileSync(resolve(root, descriptor.compiled_path.slice(2))));
  const result = verifyRuntimeBundle(bundle, artifactBytes);
  results[layer] = { ok: result.ok, decision: result.decision, code: result.code };
  if (!result.ok || result.decision !== 'READY_FOR_RUNTIME') {
    console.error(JSON.stringify({ status: 'REJECTED', layer, result }));
    process.exit(1);
  }
}

console.log(JSON.stringify({ status: 'PASS', results }));
