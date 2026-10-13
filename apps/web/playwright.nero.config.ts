import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'nero-company-links.spec.ts', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 1440, height: 1000 }, browserName: 'chromium' },
  reporter: 'list',
  webServer: { command: 'corepack pnpm exec vite --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: true, timeout: 30000 },
});
