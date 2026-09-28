/**
 * 接続候補 (ペアリングリンクから作った Connection でも、DiscoverScreen が見つけた
 * RemoteSession でも) を検証してから繋ぐ、共通のロジック。
 *
 * ConnectScreen (手動) と DiscoverScreen (アカウント自動検出) の両方から呼ばれる。
 *
 * 繋げるのは、ログイン中の Division アカウントのセッションだけ。PC はリモートコントロールを
 * 有効にするとアカウントの RemoteSession にペアリングのトークンを載せるので、候補のトークンが
 * その一覧にあるかで確かめる。ペアリングリンクや手入力で別アカウントの PC を指定しても繋がない
 * (PC 側も X-Division-Access-Token のユーザーを見て、違えば 403 account_mismatch を返す)。
 */

import { OrchestraApiError, OrchestraClient } from '../api/client';
import { Connection, PROTOCOL_VERSION } from '../api/types';
import { notifyRemoteConnected } from './remoteNotifications';

export type ConnectOutcome =
	| { ok: true; connection: Connection; warning?: string }
	| { ok: false; message: string };

/** 繋ぐ前に照合する、ログイン中アカウントの情報。 */
export type AccountScope = {
	/** PC に送る Division の JWT (PC 側でも同じアカウントか確かめる) */
	accessToken: string;
	/** アカウントの RemoteSession。ペアリングのトークンで照合する */
	sessions: { token: string }[];
};

export const NOT_ACCOUNT_SESSION_MESSAGE =
	'この PC は、ログイン中のアカウントのセッションではありません。PC 側でも同じ Division アカウントでログインし、リモートコントロールを有効にしてください。';

/** 候補がアカウントのセッションなら、その行を返す。ペアリングのトークンで照合する。 */
export const findAccountSession = <T extends { token: string }>(candidate: Pick<Connection, 'token'>, sessions: T[]): T | undefined =>
	sessions.find(s => !!s.token && s.token === candidate.token);

/** 保存済みの接続のうち、このアカウントで保存したものだけを返す。未ログインなら空。 */
export const connectionsForAccount = (connections: Connection[], userId: string | null | undefined): Connection[] =>
	userId ? connections.filter(c => c.ownerUserId === userId) : [];

/** PC が「別のアカウントの端末だ」と断ってきたか (ログイン中に PC 側のアカウントが変わった場合など)。 */
export const isAccountMismatch = (e: unknown): boolean =>
	e instanceof OrchestraApiError && e.status === 403 && e.message === 'account_mismatch';

/**
 * アカウントのセッションか確かめてから、/api/ping → プロトコル確認 →
 * /api/state (トークンとアカウントの検証を兼ねる) → connect() の順で試す。
 */
export const verifyAndConnect = async (
	candidate: Connection,
	connect: (c: Connection) => Promise<void>,
	account: AccountScope,
): Promise<ConnectOutcome> => {
	if (!findAccountSession(candidate, account.sessions)) {
		return { ok: false, message: NOT_ACCOUNT_SESSION_MESSAGE };
	}
	try {
		const client = new OrchestraClient(candidate);
		client.setDivisionAccessToken(account.accessToken);

		const pong = await client.ping();
		if (!pong.ok) throw new OrchestraApiError(0, 'not_orchestra');

		const warning = pong.protocolVersion !== PROTOCOL_VERSION
			? `注意: IDE のプロトコル v${pong.protocolVersion} とアプリの v${PROTOCOL_VERSION} が違います。動かない機能があるかもしれません。`
			: undefined;

		// ここでトークン (間違っていれば 401) とアカウント (違えば 403) が検証される。
		const snapshot = await client.getSnapshot();
		const resolved: Connection = {
			...candidate,
			label: candidate.label || snapshot.ide.workspaceName || candidate.url,
		};
		await connect(resolved);
		void notifyRemoteConnected(resolved.label);
		return { ok: true, connection: resolved, warning };
	} catch (e) {
		if (isAccountMismatch(e)) return { ok: false, message: NOT_ACCOUNT_SESSION_MESSAGE };
		const message = e instanceof OrchestraApiError ? e.userMessage : `接続に失敗しました: ${String(e)}`;
		return { ok: false, message };
	}
};
