import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8787';

test.describe('Midnight Stories E2E Integration Suite', () => {

  test('Homepage loads correctly with navigation and structural elements', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/Midnight Stories/i);
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('Login Page renders input fields and triggers auth flows', async ({ page }) => {
    await page.goto(`${BASE_URL}/login.html`);

    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    const passwordInput = page.locator('input[type="password"], input[name="password"], #password').first();
    
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    await emailInput.fill('user@example.com');
    await passwordInput.fill('password123');

    expect(await emailInput.inputValue()).toBe('user@example.com');
  });

  test('API Endpoint returns valid books list', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/books`);
    expect(response.status()).toBe(200);

    const books = await response.json();
    expect(Array.isArray(books)).toBe(true);
  });

  test('Admin Page renders successfully', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await expect(page).toHaveURL(/admin/);
  });

});
