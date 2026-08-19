import assert from 'node:assert/strict';
import { buildCounterpartEvidenceUrl } from './src/deviceEvidence.mjs';

const original = 'https://preview.example/device-evidence.html?renderer=webgl2&graphics=balanced&frames=90&target=android-chrome&session=lumen-session-001&previewManifest=%2Fruntime%2Fpreview1-manifest.json';
const counterpart = new URL(buildCounterpartEvidenceUrl(original, { activeBackend: 'webgl2' }));
assert.equal(counterpart.searchParams.get('renderer'), 'webgpu');
assert.equal(counterpart.searchParams.get('graphics'), 'balanced');
assert.equal(counterpart.searchParams.get('frames'), '90');
assert.equal(counterpart.searchParams.get('target'), 'android-chrome');
assert.equal(counterpart.searchParams.get('session'), 'lumen-session-001');
assert.equal(counterpart.searchParams.get('previewManifest'), '/runtime/preview1-manifest.json');

const reverse = new URL(buildCounterpartEvidenceUrl(counterpart.href, { activeBackend: 'webgpu' }));
assert.equal(reverse.searchParams.get('renderer'), 'webgl2');
assert.equal(reverse.searchParams.get('session'), 'lumen-session-001');
assert.throws(() => buildCounterpartEvidenceUrl('https://preview.example/device-evidence.html?renderer=webgl2'), /DEVICE_EVIDENCE_COUNTERPART_SESSION_REQUIRED/);
assert.throws(() => buildCounterpartEvidenceUrl(`${original}&renderer=auto`, { activeBackend: 'auto' }), /DEVICE_EVIDENCE_COUNTERPART_BACKEND_INVALID/);
console.log('device counterpart regressions: PASS');
