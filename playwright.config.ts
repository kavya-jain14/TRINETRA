import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', // Points Playwright to your e2e folder
  use: {
    baseURL: 'http://localhost:5173',
  },
});