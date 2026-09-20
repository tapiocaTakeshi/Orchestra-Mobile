/**
 * チューニング方針の保存。接続情報 (storage.ts) とは別ファイルに分けてある。
 *
 * 方針そのものは秘密ではないので AsyncStorage で十分。Division API キーは
 * profiles から都度取得し、端末には保存しない。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_ROUTING_POLICY, RoutingPolicy } from '../lib/divisionRouting';

const POLICY_KEY = 'orchestra.routingPolicy.v1';
const ENABLED_KEY = 'orchestra.routingPolicyEnabled.v1';

const isPolicy = (value: unknown): value is RoutingPolicy => {
	if (!value || typeof value !== 'object') return false;
	const p = value as Record<string, unknown>;
	return typeof p.minPerformance === 'number'
		&& typeof p.maxCostUsd === 'number'
		&& typeof p.maxOutputTokens === 'number';
};

export const loadRoutingPolicy = async (): Promise<{ policy: RoutingPolicy; enabled: boolean }> => {
	try {
		const [raw, enabled] = await Promise.all([
			AsyncStorage.getItem(POLICY_KEY),
			AsyncStorage.getItem(ENABLED_KEY),
		]);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		return {
			policy: isPolicy(parsed) ? parsed : DEFAULT_ROUTING_POLICY,
			enabled: enabled === '1',
		};
	} catch {
		return { policy: DEFAULT_ROUTING_POLICY, enabled: false };
	}
};

export const saveRoutingPolicy = async (policy: RoutingPolicy, enabled: boolean): Promise<void> => {
	try {
		await AsyncStorage.multiSet([
			[POLICY_KEY, JSON.stringify(policy)],
			[ENABLED_KEY, enabled ? '1' : '0'],
		]);
	} catch {
		// 保存できなくてもセッション内は動く。次回起動時に既定値に戻るだけ。
	}
};
