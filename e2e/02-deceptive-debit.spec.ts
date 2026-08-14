import { test, expect } from '@playwright/test';

test.describe('TRINETRA Complete Scenario Suite (A to F)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Scenario A: Trusted Everyday Payment (ALLOW)', async ({ page }) => {
    await page.getByRole('button', { name: /Scenario A/i }).click();
    await expect(page.getByText(/ALLOW/i)).toBeVisible();

    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: /Proceed to Authorise Payment/i }).click();
  });

  test('Scenario B: Deceptive Collect Request (BLOCK)', async ({ page }) => {
    await page.getByRole('button', { name: /Scenario B/i }).click();
    await expect(page.getByText(/DECEPTIVE COLLECT DETECTED/i)).toBeVisible();

    await page.getByRole('button', { name: /Proceed to Authorise Payment/i }).click();
    await expect(page.getByText(/TRINETRA RISK WARNING/i)).toBeVisible();

    await page.getByRole('button', { name: /Cancel Payment \(Safe\)/i }).click();
    await expect(page.getByText(/Payment Safely Cancelled/i)).toBeVisible();
  });

  test('Scenario C: QR / Payee Mismatch (STEP_UP)', async ({ page }) => {
    await page.getByRole('button', { name: /Scenario C/i }).click();
    await page.getByRole('button', { name: /Proceed to Authorise Payment/i }).click();

    await page.getByPlaceholder('scammer99@vpa').fill('scammer99@vpa');
    
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: /Verify & Continue/i }).click();
  });

  test('Scenario D: Mule Network Proximity', async ({ page }) => {
    await page.getByRole('button', { name: /Scenario D/i }).click();
    await expect(page.getByText(/Mule Network Proximity/i)).toBeVisible();
  });

  test('Scenario E: Timeout & Status Inquiry', async ({ page }) => {
    await page.getByRole('button', { name: /Scenario E/i }).click();
    await page.getByRole('button', { name: /Proceed to Authorise Payment/i }).click();

    await expect(page.getByText(/Recovery & Dispute Center/i)).toBeVisible();
    
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: /Perform Status Inquiry/i }).click();
  });

  test('Scenario F: RBI T+5 Clock & ODR Dispute', async ({ page }) => {
    await page.getByRole('button', { name: /Recovery & Disputes/i }).click();
    await expect(page.getByText(/RBI T\+5 Days Auto-Reversal Clock/i)).toBeVisible();

    await page.getByPlaceholder(/Describe issue/i).fill('Merchant confirmation missing.');
    await page.getByRole('button', { name: /File Official ODR Dispute/i }).click();

    await expect(page.getByText(/DISP-2026-/i)).toBeVisible();
  });

});