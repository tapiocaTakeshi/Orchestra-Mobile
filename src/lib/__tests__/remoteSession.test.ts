import { Snapshot } from '../../api/types';
import { remoteSessionNotice } from '../remoteSession';

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
