import { Snapshot } from '../../api/types';
import { claimRemoteSyncNotice, freshRemoteSync, remoteSessionNotice } from '../remoteSession';

const snapshot = (remoteSession?: Snapshot['remoteSession']): Snapshot => ({
	ide: { protocolVersion: 1, appName: 'Orchestra', version: '1', workspaceName: '', workspaceFolders: [], uiLanguage: 'ja' },
	division: { projects: [], activeProjectIds: [], configPath: null, hasProject: false },
	kanban: {
		board: { version: 1, title: '', columns: [], tasks: [], updatedAt: 0 },
		runtime: { isLoaded: true, source: { kind: 'storage' }, isPolling: false, isRunning: false, awaitingApproval: false, runningTaskId: null, queuedTaskIds: [], lastPolledAt: null, autoRunEnabled: false },
	},
	chat: { threadId: 't', messages: [], isRunning: false, awaitingApproval: false },
	threads: [],
	remoteSession,
	revision: 1,
	generatedAt: 1,
});

const synced = (syncedAt: number) => ({ threadId: 't', title: 'バグ修正', syncedAt });

describe('remoteSessionNotice', () => {
	it('同期していなければ何もしない (古い IDE で remoteSession が無い場合も)', () => {
		expect(remoteSessionNotice(null, snapshot())).toBeNull();
		expect(remoteSessionNotice(snapshot(), snapshot(null))).toBeNull();
	});

	it('接続直後にすでに同期中なら、通知せずに伝える', () => {
		expect(remoteSessionNotice(null, snapshot(synced(1)))).toMatchObject({ notify: false });
	});

	it('PC で /remote-control と打たれたら通知する', () => {
		const notice = remoteSessionNotice(snapshot(null), snapshot(synced(1)));
		expect(notice).toMatchObject({ notify: true });
		expect(notice?.body).toContain('バグ修正');
	});

	it('もう一度打たれた (syncedAt が変わった) ときも通知する', () => {
		expect(remoteSessionNotice(snapshot(synced(1)), snapshot(synced(2)))).toMatchObject({ notify: true });
	});

	it('同じ同期のままなら何もしない', () => {
		expect(remoteSessionNotice(snapshot(synced(1)), snapshot(synced(1)))).toBeNull();
	});
});

describe('freshRemoteSync', () => {
	const now = Date.parse('2026-10-13T12:00:00.000Z');
	const at = (iso: string | null) => ({ id: 'pc1', syncedAt: iso });

	it('fires once for a new /remote-control and ignores heartbeats that keep the same syncedAt', () => {
		const seen = new Map<string, number>();
		expect(freshRemoteSync(at('2026-10-13T11:59:58.123+00:00'), seen, now)).toBe(Date.parse('2026-10-13T11:59:58.123Z'));
		expect(freshRemoteSync(at('2026-10-13T11:59:58.123+00:00'), seen, now)).toBeNull();
		expect(freshRemoteSync(at('2026-10-13T11:59:59.000Z'), seen, now)).toBe(Date.parse('2026-10-13T11:59:59.000Z'));
	});

	it('ignores rows that were never synced and syncs from before the app was listening', () => {
		const seen = new Map<string, number>();
		expect(freshRemoteSync(at(null), seen, now)).toBeNull();
		expect(freshRemoteSync({ id: 'pc1' }, seen, now)).toBeNull();
		expect(freshRemoteSync(at('2026-10-13T11:50:00.000Z'), seen, now)).toBeNull();
		// 同じ古い値のハートビートでも出さない
		expect(freshRemoteSync(at('2026-10-13T11:50:00.000Z'), seen, now)).toBeNull();
	});

	it('tracks each PC separately', () => {
		const seen = new Map<string, number>();
		const iso = '2026-10-13T11:59:30.000Z';
		expect(freshRemoteSync({ id: 'a', syncedAt: iso }, seen, now)).not.toBeNull();
		expect(freshRemoteSync({ id: 'b', syncedAt: iso }, seen, now)).not.toBeNull();
	});
});

describe('claimRemoteSyncNotice', () => {
	it('lets only the first notifier of the same sync through', () => {
		const syncedAt = 1_791_900_000_123;
		expect(claimRemoteSyncNotice(syncedAt)).toBe(true);
		expect(claimRemoteSyncNotice(syncedAt)).toBe(false);
		expect(claimRemoteSyncNotice(syncedAt + 1)).toBe(true);
	});
});

describe('remote connection status', () => {
	const { remoteConnectionStatus, chatConnectionBadge, remoteDeviceStatus, REMOTE_DEVICE_OFFLINE_AFTER_MS, REMOTE_DEVICE_HIDE_AFTER_MS } = jest.requireActual('../remoteSession');

	test('未接続 / 接続中 / 接続済み / 接続切れ', () => {
		expect(remoteConnectionStatus({ hasConnection: false, hasSnapshot: false, failing: false })).toBe('disconnected');
		expect(remoteConnectionStatus({ hasConnection: true, hasSnapshot: false, failing: false })).toBe('connecting');
		expect(remoteConnectionStatus({ hasConnection: true, hasSnapshot: true, failing: false })).toBe('connected');
		// 続けて失敗していれば、前の内容が残っていても接続切れ
		expect(remoteConnectionStatus({ hasConnection: true, hasSnapshot: true, failing: true })).toBe('lost');
		expect(remoteConnectionStatus({ hasConnection: true, hasSnapshot: false, failing: true })).toBe('lost');
	});

	test('チャットごとの印', () => {
		const badge = (status: string, isActive: boolean, isRemoteControlled = false) =>
			chatConnectionBadge({ status, isActive, isRemoteControlled })?.label ?? null;
		expect(badge('connected', true)).toBe('接続済み');
		expect(badge('connected', false)).toBeNull();
		expect(badge('connected', false, true)).toBe('リモート操作中');
		expect(badge('connected', true, true)).toBe('リモート操作中');
		expect(badge('lost', true)).toBe('接続切れ');
		expect(badge('lost', false)).toBe('接続切れ');
		expect(badge('connecting', true)).toBe('接続中');
		expect(badge('connecting', false)).toBeNull();
		expect(badge('disconnected', false)).toBe('未接続');
	});

	test('PC ごとの状態: つなげる / 接続切れ / 古すぎて出さない', () => {
		const now = Date.parse('2026-10-26T12:00:00Z');
		const ago = (ms: number) => new Date(now - ms).toISOString();
		expect(remoteDeviceStatus(ago(30_000), now)).toBe('available');
		expect(remoteDeviceStatus(ago(REMOTE_DEVICE_OFFLINE_AFTER_MS + 1), now)).toBe('offline');
		expect(remoteDeviceStatus(ago(REMOTE_DEVICE_HIDE_AFTER_MS + 1), now)).toBeNull();
		expect(remoteDeviceStatus('not a date', now)).toBeNull();
	});
});
