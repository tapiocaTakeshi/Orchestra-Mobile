/**
 * Division アカウントのログイン状態を保持する Provider。
 *
 * ログイン中は RemoteSession テーブルを購読し、新しいデバイスが追加されたときと、
 * PC で `/remote-control` が実行されたとき (syncedAt の更新) にローカル通知を出す
 * (Phase 1: アプリがフォアグラウンド/起動中のみ。
 * アプリを完全に閉じていても届く本物の push 通知は将来のフェーズで扱う)。
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';

import {
	DivisionSession,
	RemoteSessionRow,
	restoreDivisionSession,
	signInWithDivision,
	signOutDivision,
	subscribeToRemoteSessions,
} from '../lib/divisionAuth';
import { clearDivisionSession, loadDivisionSession, saveDivisionSession } from '../lib/divisionSession';
import { notifyRemoteEvent } from '../lib/remoteNotifications';
import { claimRemoteSyncNotice, freshRemoteSync } from '../lib/remoteSession';

type DivisionAuthContextValue = {
	session: DivisionSession | null;
	isRestoring: boolean;
	login: (email: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
	/** DiscoverScreen が「新着」バッジを出すためのデバイス ID 集合。表示したら dismissNewSession で消す。 */
	newSessionIds: string[];
	dismissNewSession: (id: string) => void;
};

const DivisionAuthContext = createContext<DivisionAuthContextValue | null>(null);

export const useDivisionAuth = (): DivisionAuthContextValue => {
	const ctx = useContext(DivisionAuthContext);
	if (!ctx) throw new Error('useDivisionAuth must be used inside <DivisionAuthProvider>');
	return ctx;
};

Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowAlert: true,
		shouldShowBanner: true,
		shouldShowList: true,
		shouldPlaySound: false,
		shouldSetBadge: false,
	}),
});

const notifyNewSession = async (row: RemoteSessionRow): Promise<void> => {
	try {
		const { status } = await Notifications.getPermissionsAsync();
		if (status !== 'granted') {
			const req = await Notifications.requestPermissionsAsync();
			if (req.status !== 'granted') return;
		}
		await Notifications.scheduleNotificationAsync({
			content: {
				title: 'Orchestra',
				body: `新しいデバイスが接続可能になりました: ${row.deviceLabel || row.lanUrl}`,
			},
			trigger: null, // 即時発火
		});
	} catch {
		// 通知が出せなくても致命的ではない
	}
};

const notifyRemoteSync = (row: RemoteSessionRow): Promise<void> =>
	notifyRemoteEvent(
		'PC のセッションを同期しました',
		`${row.deviceLabel || row.lanUrl} で /remote-control が実行されました。開いて続けられます。`,
		'session-synced',
	);

export const DivisionAuthProvider = ({ children }: { children: React.ReactNode }) => {
	const [session, setSession] = useState<DivisionSession | null>(null);
	const [isRestoring, setIsRestoring] = useState(true);
	const [newSessionIds, setNewSessionIds] = useState<string[]>([]);

	const unsubscribeRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const saved = await loadDivisionSession();
			if (!saved) {
				if (!cancelled) setIsRestoring(false);
				return;
			}
			const restored = await restoreDivisionSession(saved.accessToken, saved.refreshToken);
			if (cancelled) return;
			if (restored) {
				setSession(restored);
				void saveDivisionSession(restored);
			} else {
				void clearDivisionSession();
			}
			setIsRestoring(false);
		})();
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		unsubscribeRef.current?.();
		unsubscribeRef.current = null;
		if (!session) return;

		const lastSyncs = new Map<string, number>();
		unsubscribeRef.current = subscribeToRemoteSessions(session, {
			onInsert: (row) => {
				setNewSessionIds(ids => (ids.includes(row.id) ? ids : [...ids, row.id]));
				void notifyNewSession(row);
				// 新しい行でもう同期済みなら、次のハートビートで二重に知らせない
				freshRemoteSync(row, lastSyncs);
			},
			// PC で `/remote-control` を送った時点で知らせる (接続していなくても届く)
			onUpdate: (row) => {
				const syncedAt = freshRemoteSync(row, lastSyncs);
				if (syncedAt !== null && claimRemoteSyncNotice(syncedAt)) void notifyRemoteSync(row);
			},
		});
		return () => { unsubscribeRef.current?.(); unsubscribeRef.current = null; };
	}, [session]);

	const login = useCallback(async (email: string, password: string) => {
		const next = await signInWithDivision(email, password);
		setSession(next);
		await saveDivisionSession(next);
	}, []);

	const logout = useCallback(async () => {
		await signOutDivision();
		await clearDivisionSession();
		setSession(null);
		setNewSessionIds([]);
	}, []);

	const dismissNewSession = useCallback((id: string) => {
		setNewSessionIds(ids => ids.filter(x => x !== id));
	}, []);

	const value: DivisionAuthContextValue = {
		session, isRestoring, login, logout, newSessionIds, dismissNewSession,
	};

	return <DivisionAuthContext.Provider value={value}>{children}</DivisionAuthContext.Provider>;
};
