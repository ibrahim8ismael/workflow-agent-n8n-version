import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for Jaafar — drive the real UI, no direct API calls.
 *
 * Required dev servers (run in separate terminals):
 *   engine → http://localhost:4000  (npm run dev in woops-agent-engine)
 *   client → http://localhost:3000  (npm run dev in woops-client)
 *
 * Overrides:
 *   PLAYWRIGHT_CLIENT_URL  default http://localhost:3000
 *   PLAYWRIGHT_API_URL     default http://localhost:4000
 *
 * Authenticated chat test needs a one-time recorded session:
 *   npm run test:browser:auth
 * then log in via OTP in the opened browser. Saved to tests/browser/.auth/user.json (gitignored).
 */
const CLIENT_URL = process.env.PLAYWRIGHT_CLIENT_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Jaafar runs can take a while (LLM + tools + n8n)
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: CLIENT_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
