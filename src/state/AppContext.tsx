/**
 * 接続情報とスナップショットのポーリングをまとめた 1 つの Provider。
 *
 * IDE 側は WebSocket を持たないので、`GET /api/state` を一定間隔で叩いて
 * 差分を拾う。返ってくる `revision` が変わったときだけ再描画が走るよう、
 * 同じ revision なら state を差し替えない。
 *
 * 繋ぐのはログイン中の Division アカウントのセッションだけ:
 *   - 保存済みの接続は、保存したアカウント (ownerUserId) でログインしているときだけ見せる・使う
 *   - ログアウト中は PC にリクエストを送らない。別のアカウントでログインしたら接続を切る
 *   - PC 側のアカウントが変わって 403 account_mismatch が返ってきたら、その場で切る
 */

import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { OrchestraApiError, OrchestraClient } from '../api/client';
import { Connection, Snapshot } from '../api/types';
import { useToast } from '../components/ui';
import { NOT_ACCOUNT_SESSION_MESSAGE, connectionsForAccount, isAccountMismatch } from '../lib/connect';
import { notifyRemoteEvent } from '../lib/remoteNotifications';
import { remoteSessionNotice } from '../lib/remoteSession';
import { useDivisionAuth } from './DivisionAuthContext';
import {
	loadActiveUrl,
	loadConnections,
	removeConnection,
	saveActiveUrl,
	saveConnections,
	upsertConnection,
} from './storage';

/** 通常時のポーリング間隔。 */
const POLL_INTERVAL_MS = 3_000;
/** エージェントやカンバンが動いている間は細かく見る。 */
const POLL_INTERVAL_BUSY_MS = 1_200;
/** 連続で失敗している間は間隔を空ける (電池とログを無駄にしないため)。 */
const POLL_INTERVAL_ERROR_MS = 8_000;

type AppContextValue = {
	// 接続
	/** ログイン中のアカウントで保存した接続だけ */
	connections: Connection[];
	connection: Connection | null;
	client: OrchestraClient | null;
	isRestoring: boolean;

	connect: (connection: Connection) => Promise<void>;
	disconnect: () => Promise<void>;
	forget: (url: string) => Promise<void>;

	// スナップショット
	snapshot: Snapshot | null;
	error: string | null;
	isRefreshing: boolean;
	/** 手動リフレッシュ。pull-to-refresh から呼ぶ */
	refresh: () => Promise<void>;
	/** 操作した直後に最新を取り直す (楽観更新の代わり) */
	invalidate: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export const useApp = (): AppContextValue => {
	const ctx = useContext(AppContext);
	if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
	return ctx;
};

/** 接続済みでのみ使うショートカット。未接続なら例外を投げる。 */
export const useClient = (): OrchestraClient => {
	const { client } = useApp();
	if (!client) throw new Error('not connected');
	return client;
};

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
	const { session, isRestoring: isRestoringAuth } = useDivisionAuth();
	const toast = useToast();
	// 端末に保存された全アカウント分の接続。画面に渡すのはログイン中のアカウントの分だけ。
	const [connections, setConnections] = useState<Connection[]>([]);
	const [connection, setConnection] = useState<Connection | null>(null);
	const [isRestoring, setIsRestoring] = useState(true);

	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);

	const clientRef = useRef<OrchestraClient | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inFlightRef = useRef<AbortController | null>(null);
	const appStateRef = useRef<AppStateStatus>(AppState.currentState);
	const failuresRef = useRef(0);
	const snapshotRef = useRef<Snapshot | null>(null);

	// ログイン中のアカウントで保存した接続のときだけ使う。別のアカウントの PC には、リクエストも送らない。
	const accountConnection = connection && session && connection.ownerUserId === session.userId ? connection : null;

	const client = useMemo(() => {
		if (!accountConnection) {
			clientRef.current = null;
			return null;
		}
		if (clientRef.current) clientRef.current.setConnection(accountConnection);
		else clientRef.current = new OrchestraClient(accountConnection);
		clientRef.current.setDivisionAccessToken(session?.accessToken);
		return clientRef.current;
	}, [accountConnection, session?.accessToken]);

	// --- 保存済みの接続を復元 ---
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const [saved, activeUrl] = await Promise.all([loadConnections(), loadActiveUrl()]);
			if (cancelled) return;
			setConnections(saved);
			const active = saved.find(c => c.url === activeUrl) ?? null;
			setConnection(active);
			setIsRestoring(false);
		})();
		return () => { cancelled = true; };
	}, []);

	// --- ポーリング ---

	const clearTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	/** 繋いでいる接続を切る (保存済みの一覧には残す)。 */
	const dropActiveConnection = useCallback(async () => {
		setConnection(null);
		setSnapshot(null);
		snapshotRef.current = null;
		setError(null);
		await saveActiveUrl(null);
	}, []);

	// --- アカウントとの突き合わせ ---
	// 未ログインのあいだは accountConnection が null なので、PC にはリクエストを送らない (ログアウトも同じ)。
	// 同じアカウントでログインし直せばそのまま復帰し、別のアカウント (や保存元の分からない古い接続) なら
	// ここで切って、接続先を選び直してもらう。起動直後はログイン状態の復元が終わるまで待つ。
	useEffect(() => {
		if (isRestoring || isRestoringAuth || !connection || !session) return;
		if (connection.ownerUserId !== session.userId) void dropActiveConnection();
	}, [isRestoring, isRestoringAuth, connection, session, dropActiveConnection]);

	const pollOnce = useCallback(async (): Promise<number> => {
		const current = clientRef.current;
		if (!current) return POLL_INTERVAL_MS;

		inFlightRef.current?.abort();
		const controller = new AbortController();
		inFlightRef.current = controller;

		try {
			const next = await current.getSnapshot(controller.signal);
			failuresRef.current = 0;
			setError(null);
			const previous = snapshotRef.current;
			if (previous && previous.revision !== next.revision) {
				if (!previous.chat.awaitingApproval && next.chat.awaitingApproval) {
					void notifyRemoteEvent('承認が必要です', 'Orchestra がモバイルからの承認を待っています。', 'approval-required');
				}
				if (previous.chat.isRunning && !next.chat.isRunning && !next.chat.awaitingApproval) {
					void notifyRemoteEvent('処理が完了しました', 'Orchestra のエージェント処理が完了しました。', 'agent-completed');
				}
			}
			const syncNotice = remoteSessionNotice(previous, next);
			if (syncNotice) {
				toast.show(`${syncNotice.title}: ${syncNotice.body}`, 'success');
				if (syncNotice.notify) void notifyRemoteEvent(syncNotice.title, syncNotice.body, 'session-synced');
			}
			snapshotRef.current = next;
			// revision が同じなら中身も同じ。参照を保って無駄な再描画を避ける。
			setSnapshot(prev => (prev && prev.revision === next.revision && prev.generatedAt !== 0 ? prev : next));

			const busy = next.chat.isRunning || next.kanban.runtime.isRunning;
			return busy ? POLL_INTERVAL_BUSY_MS : POLL_INTERVAL_MS;
		} catch (e) {
			if (controller.signal.aborted) return POLL_INTERVAL_MS;
			if (isAccountMismatch(e)) {
				// PC 側が別のアカウントに切り替わった。繋ぎっぱなしにせず、接続先を選び直してもらう。
				clientRef.current = null;
				void dropActiveConnection();
				toast.show(NOT_ACCOUNT_SESSION_MESSAGE, 'error');
				return POLL_INTERVAL_MS;
			}
			failuresRef.current += 1;
			const message = e instanceof OrchestraApiError ? e.userMessage : String(e);
			// 1 回のタイムアウトで赤くしない (スマホのスリープ復帰直後によく起きる)。
			if (failuresRef.current >= 2) setError(message);
			return POLL_INTERVAL_ERROR_MS;
		} finally {
			if (inFlightRef.current === controller) inFlightRef.current = null;
		}
	}, [dropActiveConnection, toast]);

	const scheduleLoop = useCallback((delay: number) => {
		clearTimer();
		timerRef.current = setTimeout(() => {
			void (async () => {
				// 切断済み (または切り替え中) なら、ここでループを止める。
				if (!clientRef.current) return;
				if (appStateRef.current !== 'active') { scheduleLoop(POLL_INTERVAL_MS); return; }
				const nextDelay = await pollOnce();
				scheduleLoop(nextDelay);
			})();
		}, delay);
	}, [clearTimer, pollOnce]);

	useEffect(() => {
		if (!accountConnection) {
			clearTimer();
			setSnapshot(null);
			snapshotRef.current = null;
			setError(null);
			return;
		}
		failuresRef.current = 0;
		void (async () => {
			const delay = await pollOnce();
			scheduleLoop(delay);
		})();
		return () => {
			clearTimer();
			inFlightRef.current?.abort();
		};
	}, [accountConnection, clearTimer, pollOnce, scheduleLoop]);

	// バックグラウンドの間はポーリングを止め、戻ってきたら即座に取り直す。
	useEffect(() => {
		const sub = AppState.addEventListener('change', next => {
			const wasActive = appStateRef.current === 'active';
			appStateRef.current = next;
			if (!wasActive && next === 'active' && clientRef.current) {
				void (async () => {
					const delay = await pollOnce();
					scheduleLoop(delay);
				})();
			}
		});
		return () => sub.remove();
	}, [pollOnce, scheduleLoop]);

	// --- 操作 ---

	const refresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const delay = await pollOnce();
			scheduleLoop(delay);
		} finally {
			setIsRefreshing(false);
		}
	}, [pollOnce, scheduleLoop]);

	const invalidate = useCallback(() => {
		// 書き込み直後は IDE 側の state 更新が一瞬遅れることがあるので、少し待ってから取り直す。
		clearTimer();
		timerRef.current = setTimeout(() => {
			void (async () => {
				const delay = await pollOnce();
				scheduleLoop(delay);
			})();
		}, 250);
	}, [clearTimer, pollOnce, scheduleLoop]);

	const connect = useCallback(async (next: Connection) => {
		if (!session) throw new Error('Division アカウントでログインしてから接続してください。');
		// どのアカウントで繋いだかを残し、別のアカウントでは使わないようにする。
		const owned: Connection = { ...next, ownerUserId: session.userId };
		const updated = upsertConnection(connections, owned);
		setConnections(updated);
		setConnection(owned);
		setSnapshot(null);
		setError(null);
		await Promise.all([saveConnections(updated), saveActiveUrl(owned.url)]);
	}, [connections, session]);

	const disconnect = dropActiveConnection;

	const forget = useCallback(async (url: string) => {
		const updated = removeConnection(connections, url);
		setConnections(updated);
		await saveConnections(updated);
		if (connection?.url === url) {
			setConnection(null);
			setSnapshot(null);
			await saveActiveUrl(null);
		}
	}, [connections, connection]);

	const accountConnections = useMemo(
		() => connectionsForAccount(connections, session?.userId),
		[connections, session?.userId],
	);
	const value = useMemo<AppContextValue>(() => ({
		connections: accountConnections,
		connection: accountConnection,
		client,
		isRestoring,
		connect,
		disconnect,
		forget,
		snapshot,
		error,
		isRefreshing,
		refresh,
		invalidate,
	}), [accountConnections, accountConnection, client, isRestoring, connect, disconnect, forget, snapshot, error, isRefreshing, refresh, invalidate]);

	return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
