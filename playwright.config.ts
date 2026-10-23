import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/kitchen*.spec.ts', testIgnore: '**/._*', timeout: 480000, expect: { timeout: 10000 },
  workers: 1, retries: 0, outputDir: 'output/playwright/results',
  reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  use: { headless: false, baseURL: 'http://127.0.0.1:5174', viewport: { width: 1280, height: 720 }, actionTimeout: 10000, navigationTimeout: 30000, screenshot: 'only-on-failure', trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' },testIgnore:['**/kitchen-endurance.spec.ts'] }, { name:'native-chrome',use:{browserName:'chromium',channel:'chrome'},testMatch:['**/kitchen-endurance.spec.ts'] }, { name: 'webkit', use: { browserName: 'webkit' }, testMatch: ['**/kitchen-smoke.spec.ts'] }],
  webServer: { command: 'npx vite build --mode e2e --outDir output/e2e-build && npx vite preview --host 127.0.0.1 --port 5174 --outDir output/e2e-build', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 90000 },
});
