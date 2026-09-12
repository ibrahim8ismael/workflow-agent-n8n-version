import { expect, test } from '@playwright/test';

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:4000';

test('chromium can drive a page (install proof, no servers needed)', async ({ page }) => {
  await page.setContent('<main><h1>Jaafar</h1><p>orchestra</p></main>');
  await expect(page.getByRole('heading', { name: 'Jaafar' })).toBeVisible();
  await expect(page.getByText('orchestra')).toBeVisible();
});

test('engine swagger docs load in a real browser', async ({ page }) => {
  const response = await page
    .goto(`${API_URL}/api/docs`, { waitUntil: 'domcontentloaded', timeout: 10_000 })
    .catch(() => null);
  test.skip(!response, `engine not running at ${API_URL} — start it with: npm run dev`);
  await expect(page.locator('body')).toContainText(/swagger|woops/i);
});
