import { Browser, Page, expect, test } from '@playwright/test';
import { addSticky, createBoard, signUp } from './helpers';

/** Each person gets their own browser context: separate cookies, like separate computers. */
async function person(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, name);
  return page;
}

async function inviteLink(owner: Page, role: 'editor' | 'viewer'): Promise<string> {
  await owner.getByRole('button', { name: 'Share' }).click();
  const row = owner.locator(`[data-role=${role}]`);
  await row.getByRole('button', { name: 'Create link' }).click();
  const link = await row.locator('input').inputValue();
  await owner.getByRole('button', { name: 'Close' }).click();
  return link;
}

test('an invited editor sees changes live and can make their own', async ({ browser }) => {
  const owner = await person(browser, 'Olivia');
  await createBoard(owner, 'Retro');
  const link = await inviteLink(owner, 'editor');

  const friend = await person(browser, 'Femi');
  await friend.goto(link);
  await expect(friend).toHaveURL(owner.url());
  await expect(owner.locator('.avatar[title="Femi"]')).toBeVisible(); // presence

  await addSticky(owner, 'Went well: shipping');
  await expect(friend.locator('.sticky-text', { hasText: 'Went well: shipping' })).toBeVisible();

  await addSticky(friend, 'Improve: tests', 300, 450);
  await expect(owner.locator('.sticky-text', { hasText: 'Improve: tests' })).toBeVisible();
});

test('a viewer can look but not change anything', async ({ browser }) => {
  const owner = await person(browser, 'Omar');
  await createBoard(owner, 'Roadmap');
  await addSticky(owner, 'Q1: accounts');
  const link = await inviteLink(owner, 'viewer');

  const viewer = await person(browser, 'Vera');
  await viewer.goto(link);

  await expect(viewer.getByText('View only')).toBeVisible();
  await expect(viewer.locator('.sticky-text', { hasText: 'Q1: accounts' })).toBeVisible();
  await expect(viewer.getByRole('toolbar', { name: 'Drawing tools' })).toHaveCount(0);
});

test('a stranger cannot open someone else’s board', async ({ browser }) => {
  const owner = await person(browser, 'Priya');
  await createBoard(owner, 'Private');

  const stranger = await person(browser, 'Sam');
  await stranger.goto(owner.url());

  await expect(stranger.getByText("doesn't exist")).toBeVisible();
});
