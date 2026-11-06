import { expect, test } from '@playwright/test';
import { addSticky, createBoard, signUp, waitUntilSaved } from './helpers';

test('a new user draws on a board and it is still there after a reload', async ({ page }) => {
  await signUp(page, 'Ada');
  await createBoard(page, 'Launch plan');

  await addSticky(page, 'Write the announcement');
  await waitUntilSaved(page);
  await page.reload();

  await expect(page.locator('.sticky-text', { hasText: 'Write the announcement' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Launch plan/ })).toBeVisible();
});

test('undo removes the last change', async ({ page }) => {
  await signUp(page, 'Grace');
  await createBoard(page, 'Undo');

  await addSticky(page, 'Oops');
  await page.keyboard.press('Control+z');

  await expect(page.locator('.sticky-text', { hasText: 'Oops' })).toHaveCount(0);
});

test('signed-out visitors are sent to sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
});
