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
 * Authenticated chat tests log in through the real UI first:
 *   the `setup` project (tests/browser/auth.setup.ts) signs in as
 *   PLAYWRIGHT_TEST_EMAIL (default test@woops.cc) reading the OTP from
 *   the local Mailpit (PLAYWRIGHT_MAILPIT_URL, default :8025),
 *   then saves tests/browser/.auth/user.json (gitignored).
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
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/browser/.auth/user.json',
      },
    },
  ],
});
