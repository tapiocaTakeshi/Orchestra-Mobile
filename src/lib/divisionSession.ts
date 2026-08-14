/**
 * Division ログインセッション (Supabase JWT) の永続化。
 *
 * 接続情報 (Connection) は AsyncStorage (state/storage.ts) に置くが、こちらは
 * アカウントの認証トークンなので expo-secure-store (iOS Keychain / Android Keystore) を使う。
 */

import * as SecureStore from 'expo-secure-store';

import { DivisionSession } from './divisionAuth';

const SESSION_KEY = 'orchestra.divisionSession.v1';

export const loadDivisionSession = async (): Promise<DivisionSession | null> => {
	try {
		const raw = await SecureStore.getItemAsync(SESSION_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<DivisionSession>;
		if (typeof parsed.userId !== 'string' || typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') {
			return null;
		}
		return { userId: parsed.userId, email: parsed.email ?? '', accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
	} catch {
		return null;
	}
};

export const saveDivisionSession = async (session: DivisionSession): Promise<void> => {
	try {
		await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
	} catch {
		// 保存できなくてもセッション内は動く。次回起動時にログインし直すだけ。
	}
};

export const clearDivisionSession = async (): Promise<void> => {
	try {
		await SecureStore.deleteItemAsync(SESSION_KEY);
	} catch {
		// noop
	}
};
