/**
 * PC の `/remote-control` で同期されたセッションの扱い (UI 非依存)。
 */

import { Snapshot } from '../api/types';

export type RemoteSessionNotice = {
	title: string;
	body: string;
	/** true なら端末の通知も出す (アプリが裏にあっても気づけるように) */
	notify: boolean;
};

/**
 * 前回と今回のスナップショットから、「PC からセッションが同期された」と知らせるかを決める。
 * syncedAt が変わったとき (PC でもう一度 `/remote-control` と打ったときも含む) だけ知らせる。
 * 接続直後の 1 回目は、すでに同期中であることを通知ではなくトーストで伝える。
 */
export const remoteSessionNotice = (previous: Snapshot | null, next: Snapshot): RemoteSessionNotice | null => {
	const session = next.remoteSession;
	if (!session) return null;
	if (!previous) {
		return { title: 'PC のセッションと同期中', body: `「${session.title}」を表示しています。`, notify: false };
	}
	if (previous.remoteSession?.syncedAt === session.syncedAt) return null;
	return { title: 'PC のセッションを同期しました', body: `「${session.title}」をこの端末で続けられます。`, notify: true };
};

/** これより前の syncedAt は、購読を始める前の同期とみなして知らせない (PC とスマホの時計のずれも見込む)。 */
export const REMOTE_SYNC_FRESH_MS = 2 * 60 * 1000;

/**
 * Realtime で届いた RemoteSession の行が、PC での `/remote-control` によるものなら、その syncedAt (ms)。
 * ハートビートの更新は syncedAt を変えないので、行ごとに最後に見た値と比べて弾く。
 * 古い同期 (アプリを開く前のもの) も知らせない。
 */
export const freshRemoteSync = (
	row: { id: string; syncedAt?: string | null },
	lastSeen: Map<string, number>,
	now = Date.now(),
): number | null => {
	const syncedAt = row.syncedAt ? Date.parse(row.syncedAt) : NaN;
	if (!Number.isFinite(syncedAt)) return null;
	if (lastSeen.get(row.id) === syncedAt) return null;
	lastSeen.set(row.id, syncedAt);
	return now - syncedAt <= REMOTE_SYNC_FRESH_MS ? syncedAt : null;
};

const claimedSyncs = new Set<number>();

/**
 * 同じ同期 (syncedAt) を 1 回だけ知らせるための札。Realtime (未接続でも届く) と LAN のポーリング
 * (接続中) の両方が同じ `/remote-control` に気づくので、先に取った方だけが通知する。
 * PC は同じ時刻を両方に載せるので、syncedAt (ms) が同じなら同じ同期。
 */
export const claimRemoteSyncNotice = (syncedAt: number): boolean => {
	if (claimedSyncs.has(syncedAt)) return false;
	claimedSyncs.add(syncedAt);
	if (claimedSyncs.size > 50) claimedSyncs.delete(claimedSyncs.values().next().value as number);
	return true;
};

// ---------------------------------------------------------------------------
// PC との接続状態 (リモートコントロール)
// ---------------------------------------------------------------------------

/**
 * リモートコントロールの接続状態。
 *   - disconnected … 未接続 (接続先を選んでいない)
 *   - connecting   … 接続先は選んだが、まだ PC から状態を受け取っていない
 *   - connected    … 接続済み (ポーリングが通っている)
 *   - lost         … 接続切れ (ポーリングが続けて失敗している。PC のスリープ・別の Wi-Fi など)
 */
export type RemoteConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'lost';

export const remoteConnectionStatus = (input: {
	hasConnection: boolean;
	hasSnapshot: boolean;
	/** 続けて失敗している (AppContext は 2 回続けて失敗したら error を立てる) */
	failing: boolean;
}): RemoteConnectionStatus => {
	if (!input.hasConnection) return 'disconnected';
	if (input.failing) return 'lost';
	return input.hasSnapshot ? 'connected' : 'connecting';
};

export const REMOTE_CONNECTION_LABELS: Record<RemoteConnectionStatus, string> = {
	disconnected: '未接続',
	connecting: '接続中',
	connected: '接続済み',
	lost: '接続切れ',
};

/**
 * チャット (スレッド) ごとの状態。開いているチャットは PC との接続状態をそのまま持ち、
 * PC で `/remote-control` したチャットは「リモート操作中」と分かるようにする。
 * 接続が切れていれば、どのチャットも PC に届かないので一律に「接続切れ」。
 */
export type ChatConnectionBadge = { label: string; tone: 'success' | 'running' | 'warning' | 'danger' | 'muted' };

export const chatConnectionBadge = (input: {
	status: RemoteConnectionStatus;
	/** このチャットが PC で今開いているチャット */
	isActive: boolean;
	/** このチャットが PC の `/remote-control` で同期したチャット */
	isRemoteControlled: boolean;
}): ChatConnectionBadge | null => {
	if (input.status === 'lost') return { label: '接続切れ', tone: 'danger' };
	if (input.status === 'disconnected') return { label: '未接続', tone: 'muted' };
	if (input.status === 'connecting') return input.isActive ? { label: '接続中', tone: 'warning' } : null;
	if (input.isRemoteControlled) return { label: 'リモート操作中', tone: 'running' };
	if (input.isActive) return { label: '接続済み', tone: 'success' };
	return null;
};

/** PC (RemoteSession の行) ごとの状態: 一覧に出すのは未接続 (つなげる) と接続切れ (最近まで見えていた) */
export type RemoteDeviceStatus = 'available' | 'offline';

/** ハートビートがこれより古い PC は「接続切れ」として出す (ハートビート間隔は約 25 秒) */
export const REMOTE_DEVICE_OFFLINE_AFTER_MS = 2 * 60 * 1000;
/** これより古い PC は一覧に出さない (使われなくなった古い行) */
export const REMOTE_DEVICE_HIDE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export const remoteDeviceStatus = (lastSeenAt: string, now = Date.now()): RemoteDeviceStatus | null => {
	const seen = Date.parse(lastSeenAt);
	if (!Number.isFinite(seen)) return null;
	const age = now - seen;
	if (age > REMOTE_DEVICE_HIDE_AFTER_MS) return null;
	return age > REMOTE_DEVICE_OFFLINE_AFTER_MS ? 'offline' : 'available';
};
