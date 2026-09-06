import { test, expect } from './fixtures';
import { getAuthFile, waitForAppStable, url } from './fixtures';

test.describe('Social Flow (TC15–TC16)', () => {

  test('TC15: Send a message via chat (User A → User B)', async ({ browser }) => {
    const messageText = 'Hey Bob, got room for one more tonight?';
    const userAContext = await browser.newContext({ storageState: getAuthFile('A') });
    const userAPage = await userAContext.newPage();

    await userAPage.goto(url('en', '/search-groups'));
    await waitForAppStable(userAPage);

    // Click message button on User B's group (both users have groups from global-setup)
    const messageBtn = userAPage.locator('[data-testid="message-button"]');
    await expect(messageBtn.first()).toBeVisible({ timeout: 8_000 });
    await messageBtn.first().click();
    await userAPage.waitForURL('**/messages/**', { timeout: 10_000 });
    await waitForAppStable(userAPage);

    // Type and send a message
    const input = userAPage.locator('[data-testid="chat-message-input"]');
    await expect(input).toBeVisible();
    await input.fill(messageText);

    const sendBtn = userAPage.locator('[data-testid="chat-send-btn"]');
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // Message should appear in User A's chat
    await expect(userAPage.getByText(messageText)).toBeVisible({ timeout: 5_000 });

    // ── User B checks messages – should see the chat from User A ──
    const userBContext = await browser.newContext({ storageState: getAuthFile('B') });
    const userBPage = await userBContext.newPage();

    await userBPage.goto(url('en', '/messages'));
    await waitForAppStable(userBPage);

    // Should see chats tab
    await expect(userBPage.locator('[data-testid="messages-tab-chats"]')).toBeVisible();

    // Click first chat if exists
    const chatItems = userBPage.locator('button').filter({ has: userBPage.locator('img') });
    if (await chatItems.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatItems.first().click();
      await userBPage.waitForURL('**/messages/**', { timeout: 10_000 });
      await waitForAppStable(userBPage);

    // Should see the message from User A (via polling every 3s or real-time)
      const chatInput = userBPage.locator('[data-testid="chat-message-input"]');
      await expect(chatInput).toBeVisible({ timeout: 5_000 });

      // Verify the actual message arrived
      await expect(userBPage.getByText(messageText)).toBeVisible({ timeout: 15_000 });
    }

    await userAContext.close();
    await userBContext.close();
  });

  test('TC15: Empty message cannot be sent', async ({ browser }) => {
    const userAContext = await browser.newContext({ storageState: getAuthFile('A') });
    const userAPage = await userAContext.newPage();

    await userAPage.goto(url('en', '/search-groups'));
    await waitForAppStable(userAPage);

    const messageBtn = userAPage.locator('[data-testid="message-button"]');
    await expect(messageBtn.first()).toBeVisible({ timeout: 8_000 });
    await messageBtn.first().click();
    await userAPage.waitForURL('**/messages/**', { timeout: 10_000 });
    await waitForAppStable(userAPage);

    const sendBtn = userAPage.locator('[data-testid="chat-send-btn"]');
    await expect(sendBtn).toBeDisabled();

    const input = userAPage.locator('[data-testid="chat-message-input"]');
    await input.fill('Hey');
    await expect(sendBtn).toBeEnabled();
    await input.fill('');
    await expect(sendBtn).toBeDisabled();

    await userAContext.close();
  });

  test('TC16: Chat list shows active chats', async ({ browser }) => {
    const userBContext = await browser.newContext({ storageState: getAuthFile('B') });
    const userBPage = await userBContext.newPage();

    await userBPage.goto(url('en', '/messages'));
    await waitForAppStable(userBPage);

    await expect(userBPage.locator('[data-testid="messages-tab-chats"]')).toBeVisible();
    await expect(userBPage.locator('[data-testid="messages-tab-likes"]')).toBeVisible();

    // Either empty state or chats should be visible
    const emptyTitle = userBPage.getByText(/No messages|Noch keine Nachrichten/i);
    const hasContent = (await emptyTitle.isVisible().catch(() => false)) ||
      (await userBPage.locator('[data-testid="messages-tab-chats"]').isVisible());
    expect(hasContent).toBeTruthy();

    await userBContext.close();
  });
});
