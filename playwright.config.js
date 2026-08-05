import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'e2e_playwright.spec.js',
  use: {
    headless: true,
    baseURL: 'http://localhost:8787',
  },
  webServer: {
    command: 'node dev-server.js',
    url: 'http://localhost:8787',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
