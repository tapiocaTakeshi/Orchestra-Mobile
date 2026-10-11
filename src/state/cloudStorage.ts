/**
 * クラウドエージェントの「前回選んだリポジトリ」の保存。接続情報 (storage.ts) とは別ファイルに分けてある。
 *
 * 次に新しいセッションを開いたとき、同じリポジトリとブランチを選んだ状態にするだけの便利機能。
 * リポジトリ名・ブランチ名は秘密ではないので AsyncStorage で十分 (GitHub のトークンはサーバーにしか無い)。
 * 別のアカウントでログインし直したときに持ち越さないよう、Division のユーザー ID も一緒に保存する。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { GitHubRepo } from '../lib/divisionGitHub';

const LAST_REPO_KEY = 'orchestra.cloudLastRepo.v1';

export type LastCloudRepo = { repo: GitHubRepo; branch: string };

const isRepo = (value: unknown): value is GitHubRepo => {
	if (!value || typeof value !== 'object') return false;
	const r = value as Record<string, unknown>;
	return typeof r.fullName === 'string' && !!r.fullName
		&& typeof r.name === 'string'
		&& typeof r.owner === 'string'
		&& typeof r.private === 'boolean'
		&& typeof r.defaultBranch === 'string';
};

export const loadLastCloudRepo = async (userId: string): Promise<LastCloudRepo | null> => {
	try {
		const raw = await AsyncStorage.getItem(LAST_REPO_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { userId?: unknown; repo?: unknown; branch?: unknown };
		if (parsed.userId !== userId || !isRepo(parsed.repo)) return null;
		return { repo: parsed.repo, branch: typeof parsed.branch === 'string' ? parsed.branch : '' };
	} catch {
		return null;
	}
};

export const saveLastCloudRepo = async (userId: string, value: LastCloudRepo): Promise<void> => {
	try {
		await AsyncStorage.setItem(LAST_REPO_KEY, JSON.stringify({ userId, repo: value.repo, branch: value.branch }));
	} catch {
		// 保存できなくても困らない。次回は選び直すだけ。
	}
};

export const clearLastCloudRepo = async (): Promise<void> => {
	try {
		await AsyncStorage.removeItem(LAST_REPO_KEY);
	} catch {
		// 同上
	}
};
