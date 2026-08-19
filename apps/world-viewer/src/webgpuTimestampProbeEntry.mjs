import { runWebGpuTimestampProbe } from './webgpuTimestampProbe.mjs';

const output = document.querySelector('#output');
const runButton = document.querySelector('#run');

function browserContext() {
  return {
    user_agent: navigator.userAgent ?? null,
    user_agent_data: navigator.userAgentData ? {
      mobile: navigator.userAgentData.mobile ?? null,
      platform: navigator.userAgentData.platform ?? null,
      brands: Array.isArray(navigator.userAgentData.brands) ? navigator.userAgentData.brands : null,
    } : null,
    device_pixel_ratio: window.devicePixelRatio ?? null,
    screen: {
      width: screen.width ?? null,
      height: screen.height ?? null,
    },
  };
}

async function run() {
  runButton.disabled = true;
  output.textContent = 'Running…';
  const started = performance.now();
  const probe = await runWebGpuTimestampProbe();
  const report = {
    ...probe,
    captured_at: new Date().toISOString(),
    wall_clock_probe_ms: performance.now() - started,
    build: {
      git_commit_sha: import.meta.env.NWE_GIT_COMMIT_SHA ?? null,
      deployment_id: import.meta.env.NWE_DEPLOYMENT_ID ?? null,
    },
    browser: browserContext(),
  };
  output.textContent = JSON.stringify(report, null, 2);
  runButton.disabled = false;
  globalThis.__NWE_WEBGPU_TIMESTAMP_PROBE__ = report;
}

runButton.addEventListener('click', () => { void run(); });
void run();
