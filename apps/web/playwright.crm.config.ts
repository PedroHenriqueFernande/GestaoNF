import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'crm-page.spec.ts', workers: 1, timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1000 }, browserName: 'chromium' },
  reporter: 'list',
});
