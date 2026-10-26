/**
 * ホームのセッション一覧 (UI 非依存)。
 *
 * Claude Code のアプリのように、どこで動いているかに関係なく 1 つの一覧に並べる:
 *   - cloud     … クラウドエージェントのセッション (Division のサンドボックス)
 *   - pc-chat   … 接続中の PC (Orchestra) のチャット。リモートコントロールで操作する
 *   - pc-device … まだ接続していない PC。押すと接続してそのチャットを開く
 * 新しい順に混ぜ、全て / 稼働中 / 承認待ち / エラー のタブで絞り込む。
 */

import type { Snapshot, ThreadSummary } from '../api/types';
import type { RemoteSessionRow } from './divisionAuth';
import { CLOUD_SESSION_FILTERS, CloudSession, CloudSessionFilter, matchesCloudSessionFilter } from './divisionCloud';
import { ChatConnectionBadge, RemoteConnectionStatus, RemoteDeviceStatus, chatConnectionBadge, remoteDeviceStatus } from './remoteSession';

/** PC のチャットの状態。開いているチャット以外は PC から状態が来ないので idle */
export type PcChatState = 'running' | 'approval' | 'error' | 'idle';

export type HomeItem =
	| { kind: 'cloud'; key: string; updatedAt: number; session: CloudSession }
	| {
		kind: 'pc-chat';
		key: string;
		updatedAt: number;
		thread: ThreadSummary;
		pcName: string;
		state: PcChatState;
		/** PC でいま開いているチャット */
		isActive: boolean;
		badge: ChatConnectionBadge | null;
	}
	| { kind: 'pc-device'; key: string; updatedAt: number; device: RemoteSessionRow; status: RemoteDeviceStatus };

const time = (iso: string | null | undefined): number => {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isFinite(t) ? t : 0;
};

/** 開いているチャットの状態。接続が切れていれば、作業の続きを確かめられないのでエラー扱い */
export const pcChatState = (snapshot: Pick<Snapshot, 'chat'>, status: RemoteConnectionStatus): PcChatState => {
	if (status === 'lost') return 'error';
	if (snapshot.chat.awaitingApproval) return 'approval';
	if (snapshot.chat.isRunning) return 'running';
	if (snapshot.chat.error) return 'error';
	return 'idle';
};

export const buildHomeItems = (input: {
	cloudSessions: CloudSession[];
	/** 接続中の PC の状態 (未接続なら null) */
	snapshot: Pick<Snapshot, 'chat' | 'threads' | 'remoteSession'> | null;
	connectionStatus: RemoteConnectionStatus;
	pcName: string;
	/** 接続していないときに出す PC (RemoteSession の行) */
	devices: RemoteSessionRow[];
	now?: number;
}): HomeItem[] => {
	const items: HomeItem[] = input.cloudSessions.map(session => ({
		kind: 'cloud',
		key: `cloud:${session.id}`,
		updatedAt: time(session.updatedAt),
		session,
	}));

	const snapshot = input.snapshot;
	if (snapshot && input.connectionStatus !== 'disconnected') {
		const activeState = pcChatState(snapshot, input.connectionStatus);
		const remoteThreadId = snapshot.remoteSession?.threadId ?? null;
		const threads = snapshot.threads.some(t => t.threadId === snapshot.chat.threadId)
			? snapshot.threads
			// 新しいチャットはまだ一覧に無いことがあるので、開いているチャットを足す
			: [{ threadId: snapshot.chat.threadId, title: '新しいチャット', lastModified: new Date(input.now ?? Date.now()).toISOString(), messageCount: 0 }, ...snapshot.threads];
		for (const thread of threads) {
			const isActive = thread.threadId === snapshot.chat.threadId;
			items.push({
				kind: 'pc-chat',
				key: `pc:${thread.threadId}`,
				// 動いているチャットは一番上に来るよう、今の時刻として扱う
				updatedAt: isActive && activeState !== 'idle' ? (input.now ?? Date.now()) : time(thread.lastModified),
				thread,
				pcName: input.pcName,
				state: isActive ? activeState : 'idle',
				isActive,
				badge: chatConnectionBadge({ status: input.connectionStatus, isActive, isRemoteControlled: thread.threadId === remoteThreadId }),
			});
		}
	} else if (input.connectionStatus === 'disconnected') {
		for (const device of input.devices) {
			const status = remoteDeviceStatus(device.lastSeenAt, input.now);
			if (!status) continue;
			items.push({ kind: 'pc-device', key: `device:${device.id}`, updatedAt: time(device.lastSeenAt), device, status });
		}
	}

	return items.sort((a, b) => b.updatedAt - a.updatedAt);
};

const PC_STATE_FILTER: Record<PcChatState, CloudSessionFilter | null> = {
	running: 'running',
	approval: 'approval',
	error: 'error',
	idle: null,
};

export const matchesHomeFilter = (item: HomeItem, filter: CloudSessionFilter): boolean => {
	if (filter === 'all') return true;
	switch (item.kind) {
		case 'cloud': return matchesCloudSessionFilter(item.session.status, filter);
		case 'pc-chat': return PC_STATE_FILTER[item.state] === filter;
		// 接続していない PC はチャットではないので「全て」にだけ出す
		default: return false;
	}
};

export const countHomeItems = (items: HomeItem[]): Record<CloudSessionFilter, number> => {
	const counts: Record<CloudSessionFilter, number> = { all: 0, running: 0, approval: 0, error: 0 };
	for (const item of items) {
		for (const f of CLOUD_SESSION_FILTERS) if (matchesHomeFilter(item, f.value)) counts[f.value] += 1;
	}
	return counts;
};
