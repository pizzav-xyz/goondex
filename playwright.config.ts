import { defineConfig, devices } from '@playwright/test'

/**
 * E2E config. The specs run against the real dev stack — real Vite, real Python
 * proxy, real upstream APIs — because every behavior they guard was originally
 * invisible to unit tests: a request routed to the wrong board still returns
 * 200, and a silently dropped term still returns a valid page.
 *
 * `webServer` runs the combined boot script rather than `npm run dev`, since
 * Playwright kills only the process tree it started and Vite reads the proxy
 * port once at startup.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Upstream hosts pace us at roughly one request per second, and several specs
  // deliberately hit both boards. Running files in parallel would turn the
  // suite into a rate-limit generator, so specs run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: './scripts/e2e-dev.sh',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})