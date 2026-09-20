/**
 * 接続情報とスナップショットのポーリングをまとめた 1 つの Provider。
 *
 * IDE 側は WebSocket を持たないので、`GET /api/state` を一定間隔で叩いて
 * 差分を拾う。返ってくる `revision` が変わったときだけ再描画が走るよう、
 * 同じ revision なら state を差し替えない。
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
	const { session } = useDivisionAuth();
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

	const client = useMemo(() => {
		if (!connection) {
			clientRef.current = null;
			return null;
		}
		if (clientRef.current) clientRef.current.setConnection(connection);
		else clientRef.current = new OrchestraClient(connection);
		clientRef.current.setDivisionAccessToken(session?.accessToken);
		return clientRef.current;
	}, [connection, session?.accessToken]);

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
			// revision が同じなら中身も同じ。参照を保って無駄な再描画を避ける。
			setSnapshot(prev => (prev && prev.revision === next.revision && prev.generatedAt !== 0 ? prev : next));

			const busy = next.chat.isRunning || next.kanban.runtime.isRunning;
			return busy ? POLL_INTERVAL_BUSY_MS : POLL_INTERVAL_MS;
		} catch (e) {
			if (controller.signal.aborted) return POLL_INTERVAL_MS;
			failuresRef.current += 1;
			const message = e instanceof OrchestraApiError ? e.userMessage : String(e);
			// 1 回のタイムアウトで赤くしない (スマホのスリープ復帰直後によく起きる)。
			if (failuresRef.current >= 2) setError(message);
			return POLL_INTERVAL_ERROR_MS;
		} finally {
			if (inFlightRef.current === controller) inFlightRef.current = null;
		}
	}, []);

	const scheduleLoop = useCallback((delay: number) => {
		clearTimer();
		timerRef.current = setTimeout(() => {
			void (async () => {
				if (appStateRef.current !== 'active') { scheduleLoop(POLL_INTERVAL_MS); return; }
				const nextDelay = await pollOnce();
				scheduleLoop(nextDelay);
			})();
		}, delay);
	}, [clearTimer, pollOnce]);

	useEffect(() => {
		if (!connection) {
			clearTimer();
			setSnapshot(null);
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
	}, [connection, clearTimer, pollOnce, scheduleLoop]);

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
		const updated = upsertConnection(connections, next);
		setConnections(updated);
		setConnection(next);
		setSnapshot(null);
		setError(null);
		await Promise.all([saveConnections(updated), saveActiveUrl(next.url)]);
	}, [connections]);

	const disconnect = useCallback(async () => {
		setConnection(null);
		setSnapshot(null);
		setError(null);
		await saveActiveUrl(null);
	}, []);

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

	const value = useMemo<AppContextValue>(() => ({
		connections,
		connection,
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
	}), [connections, connection, client, isRestoring, connect, disconnect, forget, snapshot, error, isRefreshing, refresh, invalidate]);

	return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
