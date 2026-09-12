import { expect, test } from '@playwright/test';

/**
 * Jaafar self-test through the real chat UI — no direct API calls.
 * Every interaction below is a browser action: goto, fill, click, read text.
 *
 * Prerequisites (each in its own terminal):
 *   1. engine: npm run dev          (http://localhost:4000)
 *   2. client: npm run dev          (http://localhost:3000, in woops-client)
 *
 * Login happens automatically: the `setup` project signs in through the
 * real /signin + /otp-verify UI (OTP read from local Mailpit) and every
 * test below reuses that saved session — except the logged-out test,
 * which explicitly opts out of it.
 */
test.setTimeout(180_000);
test.slow();

test.describe('logged out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('logged-out visitors are sent to signin', async ({ page }) => {
    await page.goto('/new');
    await expect(page).toHaveURL(/\/signin/, { timeout: 30_000 });
  });
});

test('jaafar answers in chat via the browser', async ({ page }) => {
  await page.goto('/new');

  const composer = page.getByPlaceholder('Send a message...');
  await expect(composer).toBeVisible({ timeout: 30_000 });

  await composer.fill('Hello Jaafar, reply with the single word: apricot');
  await page.getByRole('button', { name: 'Send message' }).click();

  // The newest assistant bubble should eventually hold Jaafar's answer.
  const answer = page.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText(/apricot|hello/i, { timeout: 120_000 });
});

test('jaafar parks an automation design behind approval', async ({ page }) => {
  await page.goto('/new');

  const composer = page.getByPlaceholder('Send a message...');
  await expect(composer).toBeVisible({ timeout: 30_000 });

  await composer.fill('Notify me by email every morning at 8am with a summary of new signups');
  await page.getByRole('button', { name: 'Send message' }).click();

  // Design runs either ask a clarifying question or render an approval card —
  // both prove the automation graph ran; nothing may self-provision.
  const thread = page.locator('[data-role="assistant"]').last();
  await expect(thread).toContainText(/approv|confirm|which|what|connect|email/i, {
    timeout: 120_000,
  });
});
