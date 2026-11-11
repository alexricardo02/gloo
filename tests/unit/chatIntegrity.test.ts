import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SystemMessageKey } from '@prisma/client';
import { canonicalPair } from '@/lib/chats';

const ROOT = process.cwd();
const LOCALES = ['en', 'de', 'es', 'fr', 'it'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

describe('chat creation paths (CHAT_CREATION = match-only)', () => {
  it('only lib/chats.ts creates Chat rows', () => {
    // Prisma create/upsert/createMany on the chat delegate, or raw INSERTs.
    const creates = /\.chat\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(|INSERT\s+INTO\s+"Chat"/i;
    const offenders = [...sourceFiles('app'), ...sourceFiles('lib')]
      .filter((file) => path.normalize(file) !== path.normalize('lib/chats.ts'))
      .filter((file) => creates.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('the old "get or create chat" actions no longer exist', async () => {
    const chatActions: Record<string, unknown> = await import('@/app/actions/chat');
    const mapActions: Record<string, unknown> = await import('@/app/actions/map');

    expect(chatActions.getOrCreateChat).toBeUndefined();
    expect(mapActions.getOrCreateChatWithUser).toBeUndefined();
  });
});

describe('canonicalPair', () => {
  it('orders the pair the same way regardless of argument order', () => {
    expect(canonicalPair('cmb2', 'cma9')).toEqual(['cma9', 'cmb2']);
    expect(canonicalPair('cma9', 'cmb2')).toEqual(['cma9', 'cmb2']);
  });

  it('uses byte order (matches COLLATE "C"), not locale order', () => {
    // Locale collation would put "a" before "B"; byte order puts "B" (0x42) first.
    expect(canonicalPair('a', 'B')).toEqual(['B', 'a']);
  });
});

describe('system message translations', () => {
  it.each(LOCALES)('%s defines Chat.systemMessages for every SystemMessageKey', (locale) => {
    const messages = JSON.parse(fs.readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf8'));
    for (const key of Object.values(SystemMessageKey)) {
      const text = messages.Chat?.systemMessages?.[key];
      expect(typeof text, `${locale}: Chat.systemMessages.${key}`).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)('%s defines the chat error keys returned by the chat actions', (locale) => {
    const messages = JSON.parse(fs.readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf8'));
    for (const key of ['blockedChatError', 'messageEmpty', 'messageTooLong', 'sendFailed', 'loadFailed']) {
      expect(typeof messages.Chat?.[key], `${locale}: Chat.${key}`).toBe('string');
    }
    expect(typeof messages.Messages?.noMessagesPreview).toBe('string');
    expect(typeof messages.Profile?.goToChat).toBe('string');
  });
});
