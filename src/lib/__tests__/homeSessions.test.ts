/**
 * ホームの一覧: クラウドのセッション・PC のチャット・接続できる PC を 1 つに混ぜ、
 * 全て / 稼働中 / 承認待ち / エラー で絞り込む。
 */

import { buildHomeItems, countHomeItems, matchesHomeFilter, pcChatState } from '../homeSessions';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const cloud = (id: string, status: string, minutesAgo: number) => ({ id, status, updatedAt: iso(minutesAgo), title: id } as never);

const snapshot = (chat: Partial<{ threadId: string; isRunning: boolean; awaitingApproval: boolean; error: string }>, remoteThreadId?: string) => ({
	chat: { threadId: 't1', messages: [], isRunning: false, awaitingApproval: false, ...chat },
	threads: [
		{ threadId: 't1', title: '開いているチャット', lastModified: iso(30), messageCount: 3 },
		{ threadId: 't2', title: '前のチャット', lastModified: iso(5), messageCount: 8 },
	],
	remoteSession: remoteThreadId ? { threadId: remoteThreadId, title: 'x', syncedAt: NOW } : null,
}) as never;

const device = (id: string, minutesAgo: number) => ({ id, deviceLabel: id, lanUrl: `http://${id}`, token: 't', protocolVersion: 1, lastSeenAt: iso(minutesAgo) });

test('クラウドと PC のチャットを新しい順に混ぜる (動いている PC のチャットは先頭)', () => {
	const items = buildHomeItems({
		cloudSessions: [cloud('c-old', 'idle', 60), cloud('c-new', 'running', 1)],
		snapshot: snapshot({ isRunning: true }),
		connectionStatus: 'connected',
		pcName: 'MacBook',
		devices: [device('d1', 1)],
		now: NOW,
	});
	expect(items.map(i => i.key)).toEqual(['pc:t1', 'cloud:c-new', 'pc:t2', 'cloud:c-old']);
	const active = items[0];
	expect(active.kind === 'pc-chat' && [active.state, active.pcName, active.badge?.label]).toEqual(['running', 'MacBook', '接続済み']);
	// 接続中は、接続していない PC の行は出さない
	expect(items.some(i => i.kind === 'pc-device')).toBe(false);
});

test('未接続なら PC のチャットの代わりに接続できる PC (と接続切れの PC) を出す', () => {
	const items = buildHomeItems({
		cloudSessions: [],
		snapshot: null,
		connectionStatus: 'disconnected',
		pcName: 'PC',
		devices: [device('online', 1), device('offline', 30), device('ancient', 60 * 24 * 30)],
		now: NOW,
	});
	expect(items.map(i => (i.kind === 'pc-device' ? `${i.device.id}:${i.status}` : i.key))).toEqual(['online:available', 'offline:offline']);
});

test('PC のチャットの状態: 確認待ち / 作業中 / エラー / 接続切れ', () => {
	expect(pcChatState(snapshot({ awaitingApproval: true, isRunning: true }), 'connected')).toBe('approval');
	expect(pcChatState(snapshot({ isRunning: true }), 'connected')).toBe('running');
	expect(pcChatState(snapshot({ error: 'boom' }), 'connected')).toBe('error');
	expect(pcChatState(snapshot({}), 'connected')).toBe('idle');
	expect(pcChatState(snapshot({ isRunning: true }), 'lost')).toBe('error');
});

test('タブの振り分けと件数 (PC のチャットも数える。接続していない PC は「全て」だけ)', () => {
	const items = buildHomeItems({
		cloudSessions: [cloud('run', 'running', 1), cloud('wait', 'awaiting_approval', 2), cloud('bad', 'failed', 3), cloud('done', 'idle', 4)],
		snapshot: snapshot({ awaitingApproval: true }, 't2'),
		connectionStatus: 'connected',
		pcName: 'PC',
		devices: [],
		now: NOW,
	});
	expect(countHomeItems(items)).toEqual({ all: 6, running: 1, approval: 2, error: 1 });
	const pcRemote = items.find(i => i.key === 'pc:t2')!;
	expect(pcRemote.kind === 'pc-chat' && pcRemote.badge?.label).toBe('リモート操作中');
	expect(matchesHomeFilter(pcRemote, 'running')).toBe(false);

	const offline = buildHomeItems({ cloudSessions: [], snapshot: null, connectionStatus: 'disconnected', pcName: 'PC', devices: [device('d', 30)], now: NOW });
	expect(countHomeItems(offline)).toEqual({ all: 1, running: 0, approval: 0, error: 0 });
});

test('新しいチャットがまだ一覧に無くても、開いているチャットとして出す', () => {
	const items = buildHomeItems({
		cloudSessions: [],
		snapshot: { ...snapshot({ threadId: 'fresh' }), threads: [] } as never,
		connectionStatus: 'connected',
		pcName: 'PC',
		devices: [],
		now: NOW,
	});
	expect(items.map(i => i.key)).toEqual(['pc:fresh']);
});
