/**
 * クラウドエージェントの「前回選んだリポジトリ」「前回選んだモデル」「前回選んだ目標ループ」の保存。接続情報 (storage.ts) とは別ファイルに分けてある。
 *
 * 次に新しいセッションを開いたとき、同じリポジトリとブランチ・同じモデル (Division Project ならそのプロジェクト) を
 * 選んだ状態にするだけの便利機能。
 * リポジトリ名・ブランチ名は秘密ではないので AsyncStorage で十分 (GitHub のトークンはサーバーにしか無い)。
 * 別のアカウントでログインし直したときに持ち越さないよう、Division のユーザー ID も一緒に保存する。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { CloudGoalLoopMode, CloudModelSelection, isGoalLoopMode, toModelSelection } from '../lib/divisionCloud';
import { GitHubRepo } from '../lib/divisionGitHub';

/** 旧形式 (1 件だけ)。読み込み時に REPOS_KEY の一覧へ引き継ぎ、次に保存するときに消す。 */
const LAST_REPO_KEY = 'orchestra.cloudLastRepo.v1';
const REPOS_KEY = 'orchestra.cloudRepos.v2';
const LAST_MODEL_KEY = 'orchestra.cloudLastModel.v1';
const LAST_GOAL_LOOP_KEY = 'orchestra.cloudLastGoalLoop.v1';

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

/** 保存しておくリポジトリの上限。古いものから押し出す。 */
export const MAX_SAVED_CLOUD_REPOS = 10;

const sameRepo = (a: GitHubRepo, b: GitHubRepo): boolean => a.fullName.toLowerCase() === b.fullName.toLowerCase();

const toEntry = (value: unknown): LastCloudRepo | null => {
	if (!value || typeof value !== 'object') return null;
	const v = value as { repo?: unknown; branch?: unknown };
	if (!isRepo(v.repo)) return null;
	return { repo: v.repo, branch: typeof v.branch === 'string' ? v.branch : '' };
};

/** 追加・編集 (ブランチの変更)。同じリポジトリがあれば置き換えて先頭 (= 最近使った) に動かし、上限を超えた分は捨てる。 */
export const upsertCloudRepo = (list: LastCloudRepo[], entry: LastCloudRepo): LastCloudRepo[] =>
	[entry, ...list.filter(e => !sameRepo(e.repo, entry.repo))].slice(0, MAX_SAVED_CLOUD_REPOS);

/** 削除。無ければそのまま。 */
export const removeCloudRepoFrom = (list: LastCloudRepo[], fullName: string): LastCloudRepo[] =>
	list.filter(e => e.repo.fullName.toLowerCase() !== fullName.toLowerCase());

/** 旧形式 (1 件だけの orchestra.cloudLastRepo.v1) を読む。別ユーザーのものや壊れたものは null。 */
const loadLegacyRepo = async (userId: string): Promise<LastCloudRepo | null> => {
	const raw = await AsyncStorage.getItem(LAST_REPO_KEY);
	if (!raw) return null;
	const parsed = JSON.parse(raw) as { userId?: unknown };
	return parsed.userId === userId ? toEntry(parsed) : null;
};

/**
 * 保存済みのリポジトリ一覧 (最近使った順)。別のユーザーのものや壊れたものは空。
 * 新形式が無ければ旧形式の 1 件を引き継ぐ (旧キーは次に保存するときに消す)。
 */
export const loadCloudRepos = async (userId: string): Promise<LastCloudRepo[]> => {
	try {
		const raw = await AsyncStorage.getItem(REPOS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as { userId?: unknown; repos?: unknown };
			if (parsed.userId !== userId || !Array.isArray(parsed.repos)) return [];
			let list: LastCloudRepo[] = [];
			// 壊れた要素は読み飛ばし、重複は先に出てきた方を残す
			for (const item of parsed.repos) {
				const entry = toEntry(item);
				if (entry && !list.some(e => sameRepo(e.repo, entry.repo))) list = [...list, entry];
			}
			return list.slice(0, MAX_SAVED_CLOUD_REPOS);
		}
		const legacy = await loadLegacyRepo(userId);
		return legacy ? [legacy] : [];
	} catch {
		return [];
	}
};

const writeCloudRepos = async (userId: string, repos: LastCloudRepo[]): Promise<void> => {
	await AsyncStorage.setItem(REPOS_KEY, JSON.stringify({ userId, repos }));
	// 一覧に取り込んだので旧キーはもう要らない
	await AsyncStorage.removeItem(LAST_REPO_KEY);
};

/** リポジトリを追加・更新する (起動したときと、設定で編集したとき)。 */
export const saveCloudRepo = async (userId: string, value: LastCloudRepo): Promise<void> => {
	try {
		await writeCloudRepos(userId, upsertCloudRepo(await loadCloudRepos(userId), value));
	} catch {
		// 保存できなくても困らない。次回は選び直すだけ。
	}
};

/** 一覧から外す。 */
export const removeCloudRepo = async (userId: string, fullName: string): Promise<void> => {
	try {
		await writeCloudRepos(userId, removeCloudRepoFrom(await loadCloudRepos(userId), fullName));
	} catch {
		// 同上
	}
};

/** 前回 (いちばん最近) 選んだリポジトリ。 */
export const loadLastCloudRepo = async (userId: string): Promise<LastCloudRepo | null> =>
	(await loadCloudRepos(userId))[0] ?? null;

export const saveLastCloudRepo = saveCloudRepo;

/** GitHub の連携を解除したときなど、保存したリポジトリをすべて消す。 */
export const clearLastCloudRepo = async (): Promise<void> => {
	try {
		await AsyncStorage.multiRemove([REPOS_KEY, LAST_REPO_KEY]);
	} catch {
		// 同上
	}
};

/** 前回のモデルの選択。別のユーザーのものや形の違うもの (Division Project なのにプロジェクトが無いなど) は null。 */
export const loadLastCloudModel = async (userId: string): Promise<CloudModelSelection | null> => {
	try {
		const raw = await AsyncStorage.getItem(LAST_MODEL_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { userId?: unknown; selection?: unknown };
		return parsed.userId === userId ? toModelSelection(parsed.selection) : null;
	} catch {
		return null;
	}
};

export const saveLastCloudModel = async (userId: string, selection: CloudModelSelection): Promise<void> => {
	try {
		const { mode, model, projectId } = selection;
		await AsyncStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ userId, selection: { mode, model, projectId } }));
	} catch {
		// 保存できなくても困らない。次回は選び直すだけ。
	}
};

/** 前回選んだ目標ループ。別のユーザーのものや知らない値は null。 */
export const loadLastCloudGoalLoop = async (userId: string): Promise<CloudGoalLoopMode | null> => {
	try {
		const raw = await AsyncStorage.getItem(LAST_GOAL_LOOP_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { userId?: unknown; mode?: unknown };
		return parsed.userId === userId && isGoalLoopMode(parsed.mode) ? parsed.mode : null;
	} catch {
		return null;
	}
};

export const saveLastCloudGoalLoop = async (userId: string, mode: CloudGoalLoopMode): Promise<void> => {
	try {
		await AsyncStorage.setItem(LAST_GOAL_LOOP_KEY, JSON.stringify({ userId, mode }));
	} catch {
		// 保存できなくても困らない。次回は選び直すだけ。
	}
};
