/**
 * Division (Supabase) 認証 + リモートセッション一覧取得。
 *
 * IDE 側 (browser/react/src/void-login-tsx/divisionAuth.ts) の簡略移植。API キー/プランの
 * 概念はモバイルには不要なので持たない。RemoteSession の読み書きは RLS で
 * `auth.uid() = "userId"` に絞られるため、必ずユーザーの JWT でセッションを張ってから呼ぶ。
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

import {
	DIVISION_REMOTE_SESSION_TABLE,
	DIVISION_SUPABASE_ANON_KEY,
	DIVISION_SUPABASE_URL,
} from './divisionAuthConfig';

let _client: SupabaseClient | null = null;

/** Division (Supabase) クライアントのシングルトン。セッションの永続化はこちらで行わず、 */
/** expo-secure-store 側 (divisionSession.ts) に一本化する。 */
export const getDivisionSupabase = (): SupabaseClient => {
	if (_client) return _client;
	_client = createClient(DIVISION_SUPABASE_URL, DIVISION_SUPABASE_ANON_KEY, {
		auth: {
			persistSession: false,
			autoRefreshToken: true,
			detectSessionInUrl: false,
		},
	});
	return _client;
};

export type DivisionSession = {
	userId: string;
	email: string;
	accessToken: string;
	refreshToken: string;
};

const restoreSupabaseSession = async (accessToken: string, refreshToken: string): Promise<void> => {
	const sb = getDivisionSupabase();
	await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
};

/** Division APIへ送る最新のSupabase JWTを取得する。 */
export const getDivisionAccessToken = async (session: DivisionSession): Promise<string> => {
	if (!session.accessToken || !session.refreshToken) {
		throw new Error('Divisionのログインセッションがありません。');
	}
	await restoreSupabaseSession(session.accessToken, session.refreshToken);
	const { data, error } = await getDivisionSupabase().auth.getSession();
	if (error || !data.session?.access_token) {
		throw new Error('DivisionのJWTを更新できませんでした。もう一度ログインしてください。');
	}
	return data.session.access_token;
};

export const signInWithDivision = async (email: string, password: string): Promise<DivisionSession> => {
	const sb = getDivisionSupabase();
	const { data, error } = await sb.auth.signInWithPassword({ email, password });
	if (error) throw new Error(error.message);

	const session = data.session;
	const user = data.user;
	if (!session || !user) throw new Error('Supabase セッションを取得できませんでした。');

	return {
		userId: user.id,
		email: user.email ?? email,
		accessToken: session.access_token,
		refreshToken: session.refresh_token ?? '',
	};
};

/** 保存済みの accessToken/refreshToken からセッションを復元する。無人での自動再ログイン用。 */
export const restoreDivisionSession = async (accessToken: string, refreshToken: string): Promise<DivisionSession | null> => {
	if (!accessToken || !refreshToken) return null;
	try {
		await restoreSupabaseSession(accessToken, refreshToken);
		const sb = getDivisionSupabase();
		const { data, error } = await sb.auth.getUser();
		if (error || !data.user) return null;

		const { data: sessData } = await sb.auth.getSession();
		return {
			userId: data.user.id,
			email: data.user.email ?? '',
			accessToken: sessData.session?.access_token ?? accessToken,
			refreshToken: sessData.session?.refresh_token ?? refreshToken,
		};
	} catch {
		return null;
	}
};

export const signOutDivision = async (): Promise<void> => {
	try {
		const sb = getDivisionSupabase();
		await sb.auth.signOut();
	} catch {
		// best-effort
	}
};

export type RemoteSessionRow = {
	id: string;
	deviceLabel: string;
	lanUrl: string;
	token: string;
	protocolVersion: number;
	lastSeenAt: string;
};

const DEFAULT_STALE_AFTER_MS = 2 * 60 * 1000; // ハートビート間隔 (約25秒) の余裕を見て2分

/** ログイン中アカウントの RemoteSession を新しい順に返す。既定で2分以上更新の無い行は除外する。 */
export const listRemoteSessions = async (
	session: DivisionSession,
	staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): Promise<RemoteSessionRow[]> => {
	await restoreSupabaseSession(session.accessToken, session.refreshToken);
	const sb = getDivisionSupabase();

	const { data, error } = await sb
		.from(DIVISION_REMOTE_SESSION_TABLE)
		.select('id, deviceLabel, lanUrl, token, protocolVersion, lastSeenAt')
		.eq('userId', session.userId)
		.order('lastSeenAt', { ascending: false });

	if (error) throw new Error(`RemoteSession の取得に失敗しました: ${error.message}`);

	const cutoff = Date.now() - staleAfterMs;
	return (data ?? []).filter((row): row is RemoteSessionRow => {
		const seenAt = Date.parse((row as { lastSeenAt?: string }).lastSeenAt ?? '');
		return Number.isFinite(seenAt) && seenAt >= cutoff;
	});
};

export type RemoteSessionChangeCallback = (row: RemoteSessionRow) => void;

/**
 * ログイン中アカウントの RemoteSession に新しい行が増えたら通知する (INSERT のみ購読)。
 * IDE 側の subscribeToProfileChanges と同じ postgres_changes の仕組みを使う。
 */
export const subscribeToNewRemoteSessions = (
	session: DivisionSession,
	callback: RemoteSessionChangeCallback,
): (() => void) => {
	const sb = getDivisionSupabase();

	const channel = sb
		.channel(`remote-session-${session.userId}`)
		.on(
			'postgres_changes',
			{
				event: 'INSERT',
				schema: 'public',
				table: DIVISION_REMOTE_SESSION_TABLE,
				filter: `userId=eq.${session.userId}`,
			},
			(payload) => {
				const row = payload.new as RemoteSessionRow | undefined;
				if (row) callback(row);
			},
		)
		.subscribe();

	return () => { void channel.unsubscribe(); };
};
