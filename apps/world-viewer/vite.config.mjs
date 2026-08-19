import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const gitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA
  ?? process.env.GITHUB_SHA
  ?? process.env.RENDER_GIT_COMMIT
  ?? null;
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID
  ?? process.env.RENDER_SERVICE_ID
  ?? null;

export default defineConfig({
  define: {
    'import.meta.env.NWE_GIT_COMMIT_SHA': JSON.stringify(gitCommitSha),
    'import.meta.env.NWE_DEPLOYMENT_ID': JSON.stringify(deploymentId),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        'device-evidence': resolve(import.meta.dirname, 'device-evidence.html'),
        'webgpu-timestamp-probe': resolve(import.meta.dirname, 'webgpu-timestamp-probe.html'),
      },
    },
  },
});
