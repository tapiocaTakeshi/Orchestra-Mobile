/**
 * Division アカウントのログイン状態を保持する Provider。
 *
 * ログイン中は RemoteSession テーブルを購読し、新しいデバイスが追加されたときと、
 * PC で `/remote-control` が実行されたとき (syncedAt の更新) にローカル通知を出す
 * (Phase 1: アプリがフォアグラウンド/起動中のみ。
 * アプリを完全に閉じていても届く本物の push 通知は将来のフェーズで扱う)。
 *
 * 利用規約への同意 (App Store Guideline 1.2) もここで持つ。同意した版は端末に保存し
 * (ログイン前に同意するため)、ログインできたらサーバーにも記録する。
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import {
	DivisionSession,
	RemoteSessionRow,
	accessTokenExpiresAt,
	getDivisionSupabase,
	refreshDivisionSession,
	restoreDivisionSession,
	signInWithDivision,
	signOutDivision,
	subscribeToRemoteSessions,
} from '../lib/divisionAuth';
import { clearDivisionSession, loadDivisionSession, saveDivisionSession } from '../lib/divisionSession';
import { TERMS_VERSION } from '../lib/legal';
import { needsTermsAgreement, recordTermsAcceptance } from '../lib/terms';
import { loadAcceptedTermsVersion, saveAcceptedTermsVersion } from './termsStorage';
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
	/** 最新の利用規約 (TERMS_VERSION) に同意済みか。false ならログインも先に進むこともできない。 */
	termsAccepted: boolean;
	/** 最新の利用規約に同意する。端末に保存し、ログイン中ならサーバーにも記録する。 */
	acceptTerms: () => Promise<void>;
	/**
	 * アクセストークンを今すぐ更新する (PC が「期限切れ」と答えたとき)。更新できなければ null。
	 * 古いテストのモックには無いことがあるので省略可。
	 */
	refreshSession?: () => Promise<DivisionSession | null>;
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
	const [acceptedTermsVersion, setAcceptedTermsVersion] = useState<string | null>(null);
	/** login のコールバックから最新の値を読むため (state だと古い値を掴む)。 */
	const acceptedTermsRef = useRef<string | null>(null);

	const unsubscribeRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const [saved, termsVersion] = await Promise.all([loadDivisionSession(), loadAcceptedTermsVersion()]);
			if (cancelled) return;
			acceptedTermsRef.current = termsVersion;
			setAcceptedTermsVersion(termsVersion);
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

	// --- アクセストークンを新しく保つ ---
	// Supabase のアクセストークンは約 1 時間で切れる。PC はスマホが送るトークンで毎回アカウントを確かめるので、
	// 古いトークンのままだと PC に断られて接続が切れる。Supabase が更新したトークンを state と保存先に反映し、
	// アプリが前面にいる間だけ自動更新を回す (React Native ではバックグラウンドでタイマーが止まるため)。
	const sessionRef = useRef<DivisionSession | null>(null);
	sessionRef.current = session;
	const adoptSession = useCallback((next: DivisionSession) => {
		const current = sessionRef.current;
		if (!current || current.userId !== next.userId) return;
		if (current.accessToken === next.accessToken && current.refreshToken === next.refreshToken) return;
		sessionRef.current = next;
		setSession(next);
		void saveDivisionSession(next);
	}, []);

	useEffect(() => {
		if (!session?.userId) return;
		const sb = getDivisionSupabase();
		const { data } = sb.auth.onAuthStateChange((event, s) => {
			if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && s?.access_token && s.user?.id) {
				const current = sessionRef.current;
				if (current) adoptSession({ ...current, accessToken: s.access_token, refreshToken: s.refresh_token ?? current.refreshToken });
			}
		});
		const onActive = () => {
			void sb.auth.startAutoRefresh();
			// 前面に戻ったとき、切れている (切れかけの) トークンはすぐ更新する
			const current = sessionRef.current;
			const exp = current ? accessTokenExpiresAt(current.accessToken) : null;
			if (current && exp !== null && exp - Date.now() < 5 * 60_000) {
				void refreshDivisionSession(current).then(next => { if (next) adoptSession(next); });
			}
		};
		if (AppState.currentState === 'active') onActive();
		const sub = AppState.addEventListener('change', state => {
			if (state === 'active') onActive();
			else void sb.auth.stopAutoRefresh();
		});
		return () => {
			data.subscription.unsubscribe();
			sub.remove();
			void sb.auth.stopAutoRefresh();
		};
	}, [session?.userId, adoptSession]);

	const refreshSession = useCallback(async (): Promise<DivisionSession | null> => {
		const current = sessionRef.current;
		if (!current) return null;
		const next = await refreshDivisionSession(current);
		if (next) adoptSession(next);
		return next;
	}, [adoptSession]);

	const login = useCallback(async (email: string, password: string) => {
		const next = await signInWithDivision(email, password);
		setSession(next);
		await saveDivisionSession(next);
		// ログイン前に同意した規約をサーバーにも記録する。失敗してもログインは止めない。
		if (!needsTermsAgreement(acceptedTermsRef.current)) void recordTermsAcceptance(next, TERMS_VERSION);
	}, []);

	const acceptTerms = useCallback(async () => {
		acceptedTermsRef.current = TERMS_VERSION;
		setAcceptedTermsVersion(TERMS_VERSION);
		await saveAcceptedTermsVersion(TERMS_VERSION);
		if (session) void recordTermsAcceptance(session, TERMS_VERSION);
	}, [session]);

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
		termsAccepted: !needsTermsAgreement(acceptedTermsVersion),
		acceptTerms,
		refreshSession,
	};

	return <DivisionAuthContext.Provider value={value}>{children}</DivisionAuthContext.Provider>;
};
