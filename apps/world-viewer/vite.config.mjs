import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const gitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null;
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? null;

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
      },
    },
  },
});
