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
