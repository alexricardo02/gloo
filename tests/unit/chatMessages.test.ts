import { describe, it, expect } from 'vitest';
import {
  appendNewer,
  createPendingMessage,
  dropPending,
  newestConfirmed,
  newestIncoming,
  oldestConfirmed,
  prependOlder,
  reconcileSent,
  type ClientMessage,
} from '@/lib/chatMessages';
import type { ChatMessageDTO } from '@/lib/apiTypes';

const msg = (id: string, at: string, isOwn = false, text = id): ChatMessageDTO => ({
  id,
  type: 'USER',
  text,
  systemKey: null,
  createdAt: `2026-05-20T10:00:${at}.000Z`,
  isOwn,
});

const ids = (list: readonly ClientMessage[]) => list.map((m) => m.id);

describe('chat message list helpers (optimistic send, dedupe by id)', () => {
  it('appendNewer adds only unknown ids and keeps pending copies last', () => {
    const pending = createPendingMessage('pending-1', 'hello');
    const start: ClientMessage[] = [msg('a', '01'), pending];

    const next = appendNewer(start, [msg('a', '01'), msg('b', '02')]);
    expect(ids(next)).toEqual(['a', 'b', 'pending-1']);
    // Nothing new: same array (no re-render).
    expect(appendNewer(next, [msg('b', '02')])).toBe(next);
  });

  it('a poll that already delivered my sent message replaces the optimistic copy (no duplicate)', () => {
    const start: ClientMessage[] = [msg('a', '01'), createPendingMessage('pending-1', 'hello')];
    const polled = appendNewer(start, [msg('real-1', '02', true, 'hello')]);
    expect(ids(polled)).toEqual(['a', 'real-1']);

    // The send response arrives afterwards: still exactly one copy.
    const reconciled = reconcileSent(polled, 'pending-1', msg('real-1', '02', true, 'hello'));
    expect(ids(reconciled)).toEqual(['a', 'real-1']);
  });

  it('reconcileSent replaces the optimistic copy at its timestamp position', () => {
    const start: ClientMessage[] = [msg('a', '01'), createPendingMessage('pending-1', 'hi')];
    // A partner message newer than mine arrived by poll before my send returned.
    const withPartner = appendNewer(start, [msg('b', '05')]);
    const reconciled = reconcileSent(withPartner, 'pending-1', msg('mine', '03', true, 'hi'));
    expect(ids(reconciled)).toEqual(['a', 'mine', 'b']);
  });

  it('dropPending removes the optimistic copy after a failed send', () => {
    const start: ClientMessage[] = [msg('a', '01'), createPendingMessage('pending-1', 'x')];
    expect(ids(dropPending(start, 'pending-1'))).toEqual(['a']);
  });

  it('prependOlder puts the older page in front and skips ids already shown', () => {
    const start: ClientMessage[] = [msg('c', '03'), msg('d', '04')];
    expect(ids(prependOlder(start, [msg('a', '01'), msg('b', '02'), msg('c', '03')]))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('cursors ignore pending copies; newestIncoming ignores my own messages', () => {
    const list: ClientMessage[] = [msg('a', '01'), msg('b', '02', true), createPendingMessage('pending-1', 'x')];
    expect(oldestConfirmed(list)?.id).toBe('a');
    expect(newestConfirmed(list)?.id).toBe('b');
    expect(newestIncoming(list)?.id).toBe('a');
    expect(newestIncoming([msg('b', '02', true)])).toBeNull();
  });
});
