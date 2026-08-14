/**
 * 接続情報の保存。
 *
 * AsyncStorage を直接触るのはここだけにして、他はこの薄い API 越しに読む。
 * トークンを含むので、書き込む値は接続情報だけに限定している。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { Connection } from '../api/types';

const CONNECTIONS_KEY = 'orchestra.connections.v1';
const ACTIVE_KEY = 'orchestra.activeConnection.v1';

const isConnection = (v: unknown): v is Connection => {
	if (!v || typeof v !== 'object') return false;
	const c = v as Record<string, unknown>;
	return typeof c.url === 'string' && typeof c.token === 'string' && typeof c.label === 'string';
};

export const loadConnections = async (): Promise<Connection[]> => {
	try {
		const raw = await AsyncStorage.getItem(CONNECTIONS_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isConnection) : [];
	} catch {
		return [];
	}
};

export const saveConnections = async (connections: Connection[]): Promise<void> => {
	try {
		await AsyncStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));
	} catch {
		// 保存できなくてもセッション内は動く。次回起動時に入力し直すだけ。
	}
};

export const loadActiveUrl = async (): Promise<string | null> => {
	try {
		return await AsyncStorage.getItem(ACTIVE_KEY);
	} catch {
		return null;
	}
};

export const saveActiveUrl = async (url: string | null): Promise<void> => {
	try {
		if (url) await AsyncStorage.setItem(ACTIVE_KEY, url);
		else await AsyncStorage.removeItem(ACTIVE_KEY);
	} catch {
		// 同上
	}
};

/** 同じ URL の接続は 1 件だけ持つ (トークンだけ更新されるケースがあるため上書き)。 */
export const upsertConnection = (connections: Connection[], next: Connection): Connection[] => {
	const rest = connections.filter(c => c.url !== next.url);
	return [next, ...rest];
};

export const removeConnection = (connections: Connection[], url: string): Connection[] =>
	connections.filter(c => c.url !== url);
