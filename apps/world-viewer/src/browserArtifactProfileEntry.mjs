import { assertCompiledTransport, loadCompiledJsonArtifact } from '../artifact_consumer.mjs';
import {
  classifyProfileBuildIdentity,
  profileVerifiedJsonArtifact,
  normalizeProfileIterations,
} from './browserArtifactProfile.mjs';
import { monotonicNow } from './rendererObservability.mjs';

const DEFAULT_MANIFEST = 'https://raw.githubusercontent.com/B4kke/Norge-World-Engine/preview-runtime/nannestad-preview-1/manifest.json';
const output = document.querySelector('#output');
const runButton = document.querySelector('#run');

function absoluteUrl(reference, base) {
  return new URL(reference, base).href;
}

function browserContext() {
  return {
    user_agent: navigator.userAgent ?? null,
    user_agent_data: navigator.userAgentData ? {
      mobile: navigator.userAgentData.mobile ?? null,
      platform: navigator.userAgentData.platform ?? null,
      brands: Array.isArray(navigator.userAgentData.brands) ? navigator.userAgentData.brands : null,
    } : null,
    device_pixel_ratio: window.devicePixelRatio ?? null,
  };
}

function normalizeReportUrl(value) {
  if (!value) return null;
  const target = new URL(value, location.href);
  if (target.origin !== location.origin || target.pathname !== '/__profile_report') {
    throw new Error('PROFILE_REPORT_TARGET_REJECTED');
  }
  return target.href;
}

function queryConfig() {
  const params = new URLSearchParams(location.search);
  return {
    manifestUrl: params.get('manifest') || DEFAULT_MANIFEST,
    iterations: normalizeProfileIterations(params.get('iterations') || '5', { min: 1, max: 20 }),
    reportUrl: normalizeReportUrl(params.get('report')),
  };
}

function buildIdentity() {
  return classifyProfileBuildIdentity({
    gitCommitSha: import.meta.env.NWE_GIT_COMMIT_SHA ?? null,
    deploymentId: import.meta.env.NWE_DEPLOYMENT_ID ?? null,
  });
}

async function publishReport(report, reportUrl) {
  globalThis.__NWE_BROWSER_ARTIFACT_PROFILE__ = report;
  if (!reportUrl) return;
  const response = await fetch(reportUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`PROFILE_REPORT_POST_FAILED: ${response.status}`);
}

async function run() {
  runButton.disabled = true;
  output.textContent = 'Running…';
  let reportUrl = null;
  try {
    const config = queryConfig();
    const { manifestUrl, iterations } = config;
    reportUrl = config.reportUrl;
    const requests = [];
    const guardedFetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url;
      assertCompiledTransport(String(url ?? ''));
      requests.push(String(url));
      return fetch(input, init);
    };

    const startedAt = monotonicNow();
    assertCompiledTransport(manifestUrl);
    const manifestResponse = await guardedFetch(manifestUrl, { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error(`PROFILE_MANIFEST_FETCH_FAILED: ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    if (manifest?.schema !== 'nwe.world-preview-manifest/0.1') {
      throw new Error(`PROFILE_MANIFEST_SCHEMA: ${manifest?.schema ?? 'missing'}`);
    }

    const manifestBase = new URL(manifestUrl, location.href).href;
    const layers = [
      { name: 'roads', expectedRole: 'road-network', bundleUrl: absoluteUrl(manifest.roads?.bundle, manifestBase) },
      { name: 'buildings', expectedRole: 'building-footprints', bundleUrl: absoluteUrl(manifest.buildings?.bundle, manifestBase) },
    ];

    const layerReports = {};
    for (const layer of layers) {
      const productionStartedAt = monotonicNow();
      const loaded = await loadCompiledJsonArtifact({
        bundleUrl: layer.bundleUrl,
        expectedRole: layer.expectedRole,
        fetchImpl: guardedFetch,
      });
      const productionLoadMs = monotonicNow() - productionStartedAt;
      const replay = await profileVerifiedJsonArtifact({
        bundle: loaded.bundle,
        bytes: loaded.bytes,
        iterations,
      });
      layerReports[layer.name] = {
        bundle_url: layer.bundleUrl,
        artifact_url: loaded.artifactUrl,
        artifact_sha256: loaded.artifactRef.sha256,
        artifact_bytes: loaded.bytes.byteLength,
        production_load_ms: productionLoadMs,
        production_verification_code: loaded.verification.code,
        isolated_replay: replay,
      };
    }

    const report = {
      schema: 'nwe.browser-provenance-profile-report/0.2',
      status: 'PASS',
      claim_scope: 'hosted/browser verification+JSON-decode profiling only',
      manifest_url: manifestBase,
      tile_id: manifest.tile?.id ?? null,
      iterations,
      layers: layerReports,
      requests,
      raw_source_calls: 0,
      timing_ms: { total: monotonicNow() - startedAt },
      build: buildIdentity(),
      browser: browserContext(),
      note: 'Each production layer load still performs the normal full RuntimeVerificationBundle verification before JSON use. The isolated replay re-runs that same verifier on already-fetched compiled bytes so network cost is excluded; it is not a replacement or cache bypass. Build binding is reported separately: timing from an UNBOUND build must not be presented as exact-commit evidence.',
    };
    output.textContent = JSON.stringify(report, null, 2);
    await publishReport(report, reportUrl);
  } catch (error) {
    const report = {
      schema: 'nwe.browser-provenance-profile-report/0.2',
      status: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
      build: buildIdentity(),
    };
    output.textContent = JSON.stringify(report, null, 2);
    globalThis.__NWE_BROWSER_ARTIFACT_PROFILE__ = report;
    if (reportUrl) {
      try { await publishReport(report, reportUrl); } catch {}
    }
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', () => { void run(); });
void run();
