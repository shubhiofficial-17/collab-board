import { Page, expect } from '@playwright/test';

let counter = 0;

/** Signs up a fresh account in this page's browser context. */
export async function signUp(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(`${name.toLowerCase()}-${Date.now()}-${counter++}@example.com`);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();
}

/** Creates a board from the home page and opens it. */
export async function createBoard(page: Page, title: string): Promise<void> {
  await page.getByLabel('Board name').fill(title);
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(/\/b\/[a-z0-9]+$/);
  await expect(page.getByRole('application', { name: 'Whiteboard' })).toBeVisible();
}

/** Adds a sticky note with some text at a point on the canvas. */
export async function addSticky(page: Page, text: string, x = 400, y = 300): Promise<void> {
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await page.getByRole('application', { name: 'Whiteboard' }).click({ position: { x, y } });
  const editor = page.getByLabel('Sticky note text');
  await editor.fill(text);
  await editor.press('Control+Enter');
  await expect(page.locator('.sticky-text', { hasText: text })).toBeVisible();
}

export async function waitUntilSaved(page: Page): Promise<void> {
  await expect(page.getByRole('status')).toContainText('Saved');
}
