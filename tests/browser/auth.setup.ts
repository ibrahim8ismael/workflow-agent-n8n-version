import * as path from 'node:path';
import { expect, test as setup } from '@playwright/test';

/**
 * One-time browser login for the Jaafar suite — no direct calls to the Woops API.
 * The browser itself: opens /signin, types the email, submits, types the OTP.
 * The 6-digit code is read from the local fake mailbox (Mailpit, :8025) the
 * same way a human would open their inbox — purely test plumbing.
 */
const AUTH_FILE = path.resolve(__dirname, '.auth/user.json');
const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL ?? 'test@woops.cc';
const MAILPIT = process.env.PLAYWRIGHT_MAILPIT_URL ?? 'http://localhost:8025';

async function latestOtp(since: Date): Promise<string | null> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=20`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    messages?: { ID: string; To?: { Address: string }[]; Created: string }[];
  };
  const fresh = (data.messages ?? [])
    .filter((m) => new Date(m.Created) > since)
    .filter((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === EMAIL.toLowerCase()))
    .sort((a, b) => +new Date(b.Created) - +new Date(a.Created));
  if (fresh.length === 0) return null;
  const full = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh[0].ID}`)).json()) as {
    Text?: string;
    HTML?: string;
    Subject?: string;
  };
  const match = `${full.Subject ?? ''}\n${full.Text ?? ''}\n${full.HTML ?? ''}`.match(/(\d{6})/);
  return match?.[1] ?? null;
}

setup('authenticate as test user', async ({ page }) => {
  const started = new Date();

  await page.goto('/signin');
  await page.getByPlaceholder('you@company.com').fill(EMAIL);
  await page.getByRole('button', { name: 'Continue with email' }).click();

  await expect(page).toHaveURL(/\/otp-verify/, { timeout: 30_000 });

  let code: string | null = null;
  for (let i = 0; i < 30 && !code; i++) {
    code = await latestOtp(started).catch(() => null);
    if (!code) await page.waitForTimeout(2_000);
  }
  expect(code, 'expected a fresh OTP in Mailpit for test@woops.cc').not.toBeNull();

  await page.locator('#otp').fill(code as string);

  // Successful verify replaces the route with the authenticated home.
  await expect(page).toHaveURL(/^.*\/$/, { timeout: 30_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
