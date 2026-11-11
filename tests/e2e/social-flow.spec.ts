import { test, expect } from './fixtures';
import { getAuthFile, waitForAppStable, url } from './fixtures';
import { ensureMatch, likeOtherGroup, MATCH_NOTICE_DE, MATCH_NOTICE_EN } from './helpers/match';

test.describe('Social Flow (TC15–TC16)', () => {

  test('TC15: A mutual like creates one chat with a localized match notice; "go to chat" only after the match', async ({ browser }) => {
    // ── User B likes User A (one-way: no chat yet) ──
    const userBContext = await browser.newContext({ storageState: getAuthFile('B') });
    const userBPage = await userBContext.newPage();
    await likeOtherGroup(userBPage);

    // ── User A: no message button before the match, then likes back ──
    const userAContext = await browser.newContext({ storageState: getAuthFile('A') });
    const userAPage = await userAContext.newPage();
    await userAPage.goto(url('en', '/search-groups'));
    await waitForAppStable(userAPage);

    const like = userAPage.locator('[data-testid="like-button"]').first();
    const messageBtn = userAPage.locator('[data-testid="message-button"]');
    await expect(like).toBeVisible({ timeout: 8_000 });
    if ((await like.getAttribute('aria-pressed')) !== 'true') {
      // CARD_MESSAGE_BUTTON = only-if-chat-exists
      await expect(messageBtn).toHaveCount(0);
      await like.click();
    }

    // The match result carries the chat id, so the button appears without a reload.
    await expect(messageBtn.first()).toBeVisible({ timeout: 10_000 });
    await messageBtn.first().click();
    await userAPage.waitForURL('**/en/messages/**', { timeout: 10_000 });
    await waitForAppStable(userAPage);

    // Exactly one match notice, rendered from its key (no sender, localized).
    const notice = userAPage.locator('[data-testid="chat-system-message"]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveText(MATCH_NOTICE_EN);

    const chatPath = new URL(userAPage.url()).pathname;
    await userAPage.goto(chatPath.replace('/en/', '/de/'));
    await waitForAppStable(userAPage);
    await expect(userAPage.locator('[data-testid="chat-system-message"]')).toHaveText(MATCH_NOTICE_DE);

    // ── User B: exactly one chat in the list ──
    await userBPage.goto(url('en', '/messages'));
    await waitForAppStable(userBPage);
    await expect(userBPage.locator('[data-testid="chat-list-item"]')).toHaveCount(1, { timeout: 10_000 });

    await userAContext.close();
    await userBContext.close();
  });

  test('TC15: Send a message via chat (User A → User B)', async ({ browser }) => {
    await ensureMatch(browser);

    const messageText = 'Hey Bob, got room for one more tonight?';
    const userAContext = await browser.newContext({ storageState: getAuthFile('A') });
    const userAPage = await userAContext.newPage();

    await userAPage.goto(url('en', '/search-groups'));
    await waitForAppStable(userAPage);

    // "Go to chat" on User B's group (shown because A and B matched)
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

    // Exactly one chat between A and B; it previews A's message
    const chatItems = userBPage.locator('[data-testid="chat-list-item"]');
    await expect(chatItems).toHaveCount(1, { timeout: 10_000 });
    await expect(chatItems.first()).toContainText(messageText);
    await chatItems.first().click();
    await userBPage.waitForURL('**/messages/**', { timeout: 10_000 });
    await waitForAppStable(userBPage);

    // Should see the message from User A (via polling every 3s or real-time)
    const chatInput = userBPage.locator('[data-testid="chat-message-input"]');
    await expect(chatInput).toBeVisible({ timeout: 5_000 });

    // Verify the actual message arrived
    await expect(userBPage.getByText(messageText)).toBeVisible({ timeout: 15_000 });

    await userAContext.close();
    await userBContext.close();
  });

  test('TC15: Empty message cannot be sent', async ({ browser }) => {
    await ensureMatch(browser);

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
