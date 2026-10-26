import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // One fixture backend; each test resets its scenario.
  retries: 0,
  outputDir: '/tmp/shai-freshness-e2e',
  reporter: 'list',
  use: { extraHTTPHeaders: { 'Cache-Control': 'no-cache' }, baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'node e2e/backend.mjs', url: 'http://127.0.0.1:18080/health', reuseExistingServer: false },
    {
      command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
      url: 'http://127.0.0.1:3100/scores', reuseExistingServer: false, timeout: 120_000,
      env: { NEXT_DIST_DIR: '.next-e2e', BACKEND_API_BASE_URL: 'http://127.0.0.1:18080', BACKEND_API_KEY: 'fixture-key', NBA_DEFAULT_SEASON: '2025-26', AUTH_SECRET: 'fixture-only-auth-secret', AUTH_TRUST_HOST: 'true', VERCEL: '', TRUSTED_CLIENT_IP_HEADER: 'x-fixture-client-ip' },
    },
  ],
});
