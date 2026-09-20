/**
 * ソーシャル (役割割り当ての共有) のうち、ネットワークに触らない部分。
 *
 * 投稿に入る `assignments` は Supabase 側の既存の形 (roleSlug / providerName /
 * model …) をそのまま使う。IDE 側の RoleAssignment とは名前が違うので、
 * ここで相互に変換する。UI 非依存なのでそのままテストできる。
 */

import { DivisionProject, RoleAssignment } from '../api/types';
import { providerTitle, roleTitle } from './format';

/** 投稿に保存される 1 役割分の割り当て。 */
export type PostAssignment = {
	roleSlug: string;
	roleName: string;
	providerName: string;
	providerDisplayName: string;
	model: string;
	modelDisplayName: string;
	priority: number;
};

export type AssignmentPost = {
	id: string;
	authorId: string;
	authorName: string;
	title: string;
	description: string;
	assignments: PostAssignment[];
	sourceProjectId: string | null;
	likeCount: number;
	importCount: number;
	createdAt: string;
	updatedAt: string;
	/** ログイン中のユーザーがいいね済みか。フィード取得時に埋める。 */
	likedByMe: boolean;
	/** ログイン中のユーザー自身の投稿か。 */
	mine: boolean;
};

export type FeedSort = 'new' | 'popular' | 'imported';

export const FEED_SORTS: { value: FeedSort; label: string }[] = [
	{ value: 'new', label: '新着' },
	{ value: 'popular', label: '人気' },
	{ value: 'imported', label: '取り込み数' },
];

// ---------------------------------------------------------------------------
// 変換
// ---------------------------------------------------------------------------

const asString = (value: unknown, fallback = ''): string =>
	typeof value === 'string' ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number => {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
};

/** jsonb をそのまま信用せず、足りない項目を補完しながら読む。 */
export const parseAssignments = (raw: unknown): PostAssignment[] => {
	if (!Array.isArray(raw)) return [];
	return raw.map((item, index) => {
		const a = (item ?? {}) as Record<string, unknown>;
		const roleSlug = asString(a.roleSlug) || asString(a.role);
		const providerName = asString(a.providerName) || asString(a.provider);
		const model = asString(a.model) || asString(a.modelId);
		return {
			roleSlug,
			roleName: asString(a.roleName) || roleTitle(roleSlug),
			providerName,
			providerDisplayName: asString(a.providerDisplayName) || providerTitle(providerName),
			model,
			modelDisplayName: asString(a.modelDisplayName) || model,
			priority: asNumber(a.priority, index),
		};
	}).filter(a => !!a.roleSlug);
};

/** IDE のプロジェクト → 投稿用の割り当て。 */
export const toPostAssignments = (agents: RoleAssignment[]): PostAssignment[] =>
	agents.map((agent, index) => ({
		roleSlug: agent.role,
		roleName: roleTitle(agent.role),
		providerName: agent.provider,
		providerDisplayName: providerTitle(agent.provider),
		model: agent.model,
		modelDisplayName: agent.model,
		priority: index,
	}));

/** 投稿 → IDE のプロジェクトに入れられる形。priority 順に並べ直す。 */
export const toRoleAssignments = (assignments: PostAssignment[]): RoleAssignment[] =>
	[...assignments]
		.sort((a, b) => a.priority - b.priority)
		.map(a => ({ role: a.roleSlug, provider: a.providerName, model: a.model }));

/** 取り込んだ割り当てを既存プロジェクトに重ねる。同じ役割は上書きし、無い役割は足す。 */
export const mergeAssignments = (
	current: RoleAssignment[],
	incoming: RoleAssignment[],
): RoleAssignment[] => {
	const merged = current.map(cur => incoming.find(next => next.role === cur.role) ?? cur);
	const added = incoming.filter(next => !current.some(cur => cur.role === next.role));
	return [...merged, ...added];
};

/** 公開時の既定タイトル。プロジェクト名が空でも何か出す。 */
export const defaultPostTitle = (project: DivisionProject): string =>
	project.name.trim() || project.projectId || 'Division プロジェクト';

// ---------------------------------------------------------------------------
// 一覧の絞り込み・並べ替え
// ---------------------------------------------------------------------------

export const matchesQuery = (post: AssignmentPost, query: string): boolean => {
	const text = query.trim().toLowerCase();
	if (!text) return true;
	const haystack = [
		post.title,
		post.description,
		post.authorName,
		...post.assignments.flatMap(a => [a.roleName, a.roleSlug, a.modelDisplayName, a.model, a.providerDisplayName]),
	].join('\n').toLowerCase();
	return haystack.includes(text);
};

export const sortPosts = (posts: AssignmentPost[], sort: FeedSort): AssignmentPost[] => {
	const byNew = (a: AssignmentPost, b: AssignmentPost) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
	return [...posts].sort((a, b) => {
		if (sort === 'popular') return b.likeCount - a.likeCount || byNew(a, b);
		if (sort === 'imported') return b.importCount - a.importCount || byNew(a, b);
		return byNew(a, b);
	});
};

export const filterPosts = (posts: AssignmentPost[], query: string, sort: FeedSort): AssignmentPost[] =>
	sortPosts(posts.filter(p => matchesQuery(p, query)), sort);

/** カードの 1 行サマリ。「リーダー: gpt-5.4-mini · コーダー: …」 */
export const assignmentSummary = (assignments: PostAssignment[], max = 3): string => {
	const sorted = [...assignments].sort((a, b) => a.priority - b.priority);
	const head = sorted.slice(0, max).map(a => `${a.roleName}: ${a.modelDisplayName || a.model}`);
	const rest = sorted.length - head.length;
	return rest > 0 ? `${head.join(' · ')} ほか ${rest} 件` : head.join(' · ');
};

/** 投稿に使われているプロバイダー名 (重複なし、priority 順)。 */
export const usedProviders = (assignments: PostAssignment[]): string[] => {
	const seen: string[] = [];
	for (const a of [...assignments].sort((x, y) => x.priority - y.priority)) {
		const name = a.providerDisplayName || a.providerName;
		if (name && !seen.includes(name)) seen.push(name);
	}
	return seen;
};
