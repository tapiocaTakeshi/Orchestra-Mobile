/**
 * 接続候補 (ペアリングリンクから作った Connection でも、DiscoverScreen が見つけた
 * RemoteSession でも) を検証してから繋ぐ、共通のロジック。
 *
 * ConnectScreen (手動) と DiscoverScreen (アカウント自動検出) の両方から呼ばれる。
 */

import { OrchestraApiError, OrchestraClient } from '../api/client';
import { Connection, PROTOCOL_VERSION } from '../api/types';
import { notifyRemoteConnected } from './remoteNotifications';

export type ConnectOutcome =
	| { ok: true; connection: Connection; warning?: string }
	| { ok: false; message: string };

/** /api/ping → プロトコル確認 → /api/state (トークン検証を兼ねる) → connect() の順で試す。 */
export const verifyAndConnect = async (
	candidate: Connection,
	connect: (c: Connection) => Promise<void>,
	divisionAccessToken?: string | null,
): Promise<ConnectOutcome> => {
	try {
		const client = new OrchestraClient(candidate);
		client.setDivisionAccessToken(divisionAccessToken);

		const pong = await client.ping();
		if (!pong.ok) throw new OrchestraApiError(0, 'not_orchestra');

		const warning = pong.protocolVersion !== PROTOCOL_VERSION
			? `注意: IDE のプロトコル v${pong.protocolVersion} とアプリの v${PROTOCOL_VERSION} が違います。動かない機能があるかもしれません。`
			: undefined;

		// ここでトークンが検証される (間違っていれば 401)。
		const snapshot = await client.getSnapshot();
		const resolved: Connection = {
			...candidate,
			label: candidate.label || snapshot.ide.workspaceName || candidate.url,
		};
		await connect(resolved);
		void notifyRemoteConnected(resolved.label);
		return { ok: true, connection: resolved, warning };
	} catch (e) {
		const message = e instanceof OrchestraApiError ? e.userMessage : `接続に失敗しました: ${String(e)}`;
		return { ok: false, message };
	}
};
