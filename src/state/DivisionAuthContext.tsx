/**
 * Division アカウントのログイン状態を保持する Provider。
 *
 * ログイン中は RemoteSession テーブルへの新規 INSERT を購読し、新しいデバイスが
 * 追加されたら DiscoverScreen に「新着」バッジを出す。
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import {
	DivisionSession,
	restoreDivisionSession,
	signInWithDivision,
	signOutDivision,
	subscribeToNewRemoteSessions,
} from '../lib/divisionAuth';
import { clearDivisionSession, loadDivisionSession, saveDivisionSession } from '../lib/divisionSession';

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

		unsubscribeRef.current = subscribeToNewRemoteSessions(session, (row) => {
			setNewSessionIds(ids => (ids.includes(row.id) ? ids : [...ids, row.id]));
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
