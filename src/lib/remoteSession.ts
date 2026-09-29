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
