/**
 * ソーシャル (役割割り当ての共有) の Supabase アクセス。
 *
 * 投稿本体は `AssignmentPost`、いいねは `AssignmentPostLike` に入る。どちらも
 * RLS で「読むのはログイン済みなら誰でも / 書けるのは自分の行だけ」に絞られており、
 * いいね数はトリガ、取り込み数は `import_assignment_post` 関数が更新する
 * (Orchestra リポジトリの supabase/migrations/*_assignment_post_social.sql)。
 * クライアントからカウンタを直接書くことはできない。
 *
 * 不適切コンテンツ対策 (App Store Guideline 1.2):
 *   - 不適切な語を含む投稿はサーバーのトリガが `objectionable_content` で拒否する。
 *     アプリ側でも送る前に同じ語で確かめ (lib/moderation.ts)、フィードからも外す。
 *   - 通報とブロックは Edge Function `moderation` を通す (開発者への通知もそこで行う)。
 *     ブロックした相手の投稿は `AssignmentPost` の select ポリシーで返らなくなる。
 *   - ブロックの解除は `UserBlock` の自分の行を直接消す。
 */

import { PostgrestError } from '@supabase/supabase-js';

import { DivisionSession, getDivisionAccessToken, getDivisionSupabase } from './divisionAuth';
import {
	DIVISION_ASSIGNMENT_POST_LIKE_TABLE,
	DIVISION_ASSIGNMENT_POST_TABLE,
	DIVISION_FUNCTIONS_BASE_URL,
	DIVISION_IMPORT_POST_FUNCTION,
	DIVISION_PROFILES_TABLE,
} from './divisionAuthConfig';
import {
	OBJECTIONABLE_CONTENT_MESSAGE,
	REPORT_DETAILS_MAX,
	ReportReason,
	isObjectionablePost,
	isReportReason,
	validatePostText,
} from './moderation';
import { AssignmentPost, PostAssignment, parseAssignments } from './social';

export const DIVISION_USER_BLOCK_TABLE = 'UserBlock';
export const DIVISION_CONTENT_REPORT_TABLE = 'ContentReport';
export const DIVISION_MODERATION_FUNCTION = 'moderation';

const POST_COLUMNS = 'id, authorId, authorName, title, description, assignments, sourceProjectId, likeCount, importCount, createdAt, updatedAt';

/** テーブルが未整備 (マイグレーション未適用) のときは、次の一手が分かる文言にする。 */
export const describeError = (error: Pick<PostgrestError, 'code' | 'message'>, fallback: string): string => {
	// 不適切な語を含む投稿は、サーバーのトリガがこのメッセージで拒否する。
	if (/objectionable_content/.test(error.message ?? '')) return OBJECTIONABLE_CONTENT_MESSAGE;
	if (error.code === '42P01') return 'ソーシャル機能のテーブルがまだ作られていません。Orchestra の Supabase マイグレーションを適用してください。';
	if (error.code === '42501') return '権限がありません。Orchestra の Supabase マイグレーション (RLS ポリシー) を適用してください。';
	return `${fallback}: ${error.message}`;
};

const withSession = async (session: DivisionSession) => {
	const sb = getDivisionSupabase();
	await sb.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
	return sb;
};

type PostRow = {
	id: string;
	authorId: string;
	authorName: string | null;
	title: string;
	description: string | null;
	assignments: unknown;
	sourceProjectId: string | null;
	likeCount: number | null;
	importCount: number | null;
	createdAt: string;
	updatedAt: string;
};

const toPost = (row: PostRow, likedIds: Set<string>, userId: string): AssignmentPost => ({
	id: row.id,
	authorId: row.authorId,
	authorName: row.authorName ?? '名無し',
	title: row.title,
	description: row.description ?? '',
	assignments: parseAssignments(row.assignments),
	sourceProjectId: row.sourceProjectId,
	likeCount: row.likeCount ?? 0,
	importCount: row.importCount ?? 0,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
	likedByMe: likedIds.has(row.id),
	mine: row.authorId === userId,
});

export const DEFAULT_FEED_LIMIT = 50;

/**
 * フィードを取得する。並べ替えはサーバー側で新しい順に取ってから、
 * アプリ側で並べ替える (件数が少ないうちは往復を増やさない方が速い)。
 */
export const listAssignmentPosts = async (
	session: DivisionSession,
	options: { limit?: number; mineOnly?: boolean } = {},
): Promise<AssignmentPost[]> => {
	const sb = await withSession(session);
	let query = sb
		.from(DIVISION_ASSIGNMENT_POST_TABLE)
		.select(POST_COLUMNS)
		.order('createdAt', { ascending: false })
		.limit(options.limit ?? DEFAULT_FEED_LIMIT);

	if (options.mineOnly) query = query.eq('authorId', session.userId);

	const { data, error } = await query;
	if (error) throw new Error(describeError(error, '投稿の取得に失敗しました'));

	const rows = (data ?? []) as PostRow[];
	if (rows.length === 0) return [];

	// いいね・自分が通報した投稿・ブロック中の相手は並べて取る。通報とブロックは
	// サーバーでも絞っているので、読めなくても (マイグレーション前など) フィードは出す。
	const [{ data: likes }, reportedIds, blockedIds] = await Promise.all([
		sb
			.from(DIVISION_ASSIGNMENT_POST_LIKE_TABLE)
			.select('postId')
			.eq('userId', session.userId)
			.in('postId', rows.map(r => r.id)),
		selectIds(sb, DIVISION_CONTENT_REPORT_TABLE, 'postId', 'reporterId', session.userId),
		selectIds(sb, DIVISION_USER_BLOCK_TABLE, 'blockedId', 'blockerId', session.userId),
	]);

	const likedIds = new Set((likes ?? []).map(l => (l as { postId: string }).postId));
	return rows
		.map(row => toPost(row, likedIds, session.userId))
		.filter(post => isVisibleInFeed(post, reportedIds, blockedIds));
};

/** フィードに出すか。自分の投稿は (削除できるよう) いつも出す。 */
export const isVisibleInFeed = (
	post: AssignmentPost,
	reportedPostIds: ReadonlySet<string>,
	blockedUserIds: ReadonlySet<string>,
): boolean => {
	if (post.mine) return true;
	if (reportedPostIds.has(post.id) || blockedUserIds.has(post.authorId)) return false;
	return !isObjectionablePost(post);
};

const selectIds = async (
	sb: Awaited<ReturnType<typeof withSession>>,
	table: string,
	column: string,
	ownerColumn: string,
	userId: string,
): Promise<Set<string>> => {
	try {
		const { data, error } = await sb.from(table).select(column).eq(ownerColumn, userId);
		if (error || !Array.isArray(data)) return new Set();
		return new Set(data
			.map(row => (row as unknown as Record<string, unknown>)[column])
			.filter((id): id is string => typeof id === 'string' && !!id));
	} catch {
		return new Set();
	}
};

/** 表示名。profiles は自分の行しか読めないので、投稿時に埋め込む用。 */
export const fetchDisplayName = async (session: DivisionSession): Promise<string> => {
	try {
		const sb = await withSession(session);
		const { data } = await sb
			.from(DIVISION_PROFILES_TABLE)
			.select('full_name, email')
			.eq('id', session.userId)
			.maybeSingle();
		const profile = data as { full_name?: string | null; email?: string | null } | null;
		return profile?.full_name?.trim() || profile?.email?.trim() || session.email || '名無し';
	} catch {
		return session.email || '名無し';
	}
};

export const publishAssignmentPost = async (
	session: DivisionSession,
	input: {
		title: string;
		description?: string;
		assignments: PostAssignment[];
		sourceProjectId?: string | null;
		authorName?: string;
	},
): Promise<AssignmentPost> => {
	const title = input.title.trim();
	if (!title) throw new Error('タイトルを入力してください。');
	if (input.assignments.length === 0) throw new Error('共有できる役割の割り当てがありません。');
	const description = input.description?.trim() || '';
	const textProblem = validatePostText({ title, description });
	if (textProblem) throw new Error(textProblem);

	const sb = await withSession(session);
	const authorName = input.authorName?.trim() || await fetchDisplayName(session);
	if (validatePostText({ authorName })) {
		throw new Error(`${OBJECTIONABLE_CONTENT_MESSAGE} (表示名を変更してください)`);
	}

	const { data, error } = await sb
		.from(DIVISION_ASSIGNMENT_POST_TABLE)
		.insert({
			authorId: session.userId,
			authorName,
			title,
			description: description || null,
			assignments: input.assignments,
			sourceProjectId: input.sourceProjectId || null,
			updatedAt: new Date().toISOString(),
		})
		.select(POST_COLUMNS)
		.single();

	if (error) throw new Error(describeError(error, '投稿に失敗しました'));
	return toPost(data as PostRow, new Set<string>(), session.userId);
};

export const updateAssignmentPost = async (
	session: DivisionSession,
	postId: string,
	patch: { title?: string; description?: string },
): Promise<void> => {
	if (patch.title !== undefined && !patch.title.trim()) throw new Error('タイトルを入力してください。');
	const textProblem = validatePostText(patch);
	if (textProblem) throw new Error(textProblem);
	const sb = await withSession(session);
	const { error } = await sb
		.from(DIVISION_ASSIGNMENT_POST_TABLE)
		.update({
			...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
			...(patch.description !== undefined ? { description: patch.description.trim() || null } : {}),
			updatedAt: new Date().toISOString(),
		})
		.eq('id', postId);
	if (error) throw new Error(describeError(error, '投稿の更新に失敗しました'));
};

export const deleteAssignmentPost = async (session: DivisionSession, postId: string): Promise<void> => {
	const sb = await withSession(session);
	const { error } = await sb.from(DIVISION_ASSIGNMENT_POST_TABLE).delete().eq('id', postId);
	if (error) throw new Error(describeError(error, '投稿の削除に失敗しました'));
};

/** いいねの ON/OFF。いいね数はトリガ側で増減するので、ここでは触らない。 */
export const setPostLike = async (
	session: DivisionSession,
	postId: string,
	liked: boolean,
): Promise<void> => {
	const sb = await withSession(session);
	if (liked) {
		const { error } = await sb
			.from(DIVISION_ASSIGNMENT_POST_LIKE_TABLE)
			.upsert({ postId, userId: session.userId }, { onConflict: 'postId,userId', ignoreDuplicates: true });
		if (error) throw new Error(describeError(error, 'いいねに失敗しました'));
		return;
	}
	const { error } = await sb
		.from(DIVISION_ASSIGNMENT_POST_LIKE_TABLE)
		.delete()
		.eq('postId', postId)
		.eq('userId', session.userId);
	if (error) throw new Error(describeError(error, 'いいねの取り消しに失敗しました'));
};

/** 取り込み。取り込み数を増やしつつ、投稿の割り当てを返す。 */
export const importAssignmentPost = async (
	session: DivisionSession,
	postId: string,
): Promise<PostAssignment[]> => {
	const sb = await withSession(session);
	const { data, error } = await sb.rpc(DIVISION_IMPORT_POST_FUNCTION, { p_post_id: postId });
	if (error) {
		if (error.code === '42883') {
			throw new Error('取り込み用の関数がまだありません。Orchestra の Supabase マイグレーションを適用してください。');
		}
		throw new Error(describeError(error, '取り込みに失敗しました'));
	}
	return parseAssignments(data);
};

// ---------------------------------------------------------------------------
// 通報・ブロック
// ---------------------------------------------------------------------------

/** Edge Function `moderation` のエラー。code は関数が返した理由 (already_reported など)。 */
export class ModerationError extends Error {
	readonly code: string | null;
	readonly status: number;

	constructor(message: string, code: string | null, status: number) {
		super(message);
		this.name = 'ModerationError';
		this.code = code;
		this.status = status;
	}
}

const MODERATION_ERROR_MESSAGES: Record<string, string> = {
	already_reported: 'この投稿はすでに通報済みです。',
	cannot_report_own: '自分の投稿は通報できません。',
	post_not_found: 'この投稿はすでに削除されています。',
	cannot_block_self: '自分自身はブロックできません。',
};

export type ReportPostBody = { action: 'report'; postId: string; reason: ReportReason; details?: string };
export type BlockUserBody = { action: 'block'; userId: string; postId?: string };

/** 通報の送信内容。理由を確かめ、補足は前後の空白を落として上限で切る (空なら送らない)。 */
export const buildReportBody = (input: { postId: string; reason: ReportReason; details?: string }): ReportPostBody => {
	if (!input.postId) throw new Error('通報する投稿が見つかりません。');
	if (!isReportReason(input.reason)) throw new Error('通報の理由を選んでください。');
	const details = (input.details ?? '').trim().slice(0, REPORT_DETAILS_MAX);
	return { action: 'report', postId: input.postId, reason: input.reason, ...(details ? { details } : {}) };
};

export const buildBlockBody = (input: { userId: string; postId?: string | null }): BlockUserBody => {
	if (!input.userId) throw new Error('ブロックする利用者が見つかりません。');
	return { action: 'block', userId: input.userId, ...(input.postId ? { postId: input.postId } : {}) };
};

const callModerationFunction = async (
	session: DivisionSession,
	body: ReportPostBody | BlockUserBody,
): Promise<Record<string, unknown>> => {
	const accessToken = await getDivisionAccessToken(session);
	let res: Response;
	try {
		res = await fetch(`${DIVISION_FUNCTIONS_BASE_URL}/${DIVISION_MODERATION_FUNCTION}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
			body: JSON.stringify(body),
		});
	} catch {
		throw new ModerationError('通信できませんでした。電波の状態を確かめて、もう一度お試しください。', null, 0);
	}
	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok || json.ok !== true) {
		const code = typeof json.code === 'string' ? json.code : null;
		const message = (code && MODERATION_ERROR_MESSAGES[code])
			|| (typeof json.error === 'string' && json.error)
			|| `リクエストに失敗しました (HTTP ${res.status})`;
		throw new ModerationError(message, code, res.status);
	}
	return json;
};

/**
 * 投稿を通報する。開発者に通知され、24 時間以内に確認される。
 * すでに通報済みなら 'already_reported' を返す (利用者にとっては成功と同じ扱い)。
 */
export const reportPost = async (
	session: DivisionSession,
	input: { postId: string; reason: ReportReason; details?: string },
): Promise<'reported' | 'already_reported'> => {
	const body = buildReportBody(input);
	try {
		await callModerationFunction(session, body);
		return 'reported';
	} catch (e) {
		if (e instanceof ModerationError && e.code === 'already_reported') return 'already_reported';
		throw e;
	}
};

/** 利用者をブロックする。開発者にも通知され、その人の投稿はフィードに出なくなる。ブロック済みでも成功。 */
export const blockUser = async (
	session: DivisionSession,
	input: { userId: string; postId?: string | null },
): Promise<void> => {
	if (input.userId === session.userId) throw new ModerationError(MODERATION_ERROR_MESSAGES.cannot_block_self, 'cannot_block_self', 400);
	await callModerationFunction(session, buildBlockBody(input));
};

export type BlockedUser = {
	userId: string;
	name: string | null;
	createdAt: string;
};

/** ブロック中の利用者 (新しい順)。 */
export const listBlockedUsers = async (session: DivisionSession): Promise<BlockedUser[]> => {
	const sb = await withSession(session);
	const { data, error } = await sb
		.from(DIVISION_USER_BLOCK_TABLE)
		.select('blockedId, blockedName, createdAt')
		.eq('blockerId', session.userId)
		.order('createdAt', { ascending: false });
	if (error) throw new Error(describeError(error, 'ブロック中の利用者の取得に失敗しました'));
	return ((data ?? []) as { blockedId: string; blockedName: string | null; createdAt: string }[])
		.filter(row => typeof row.blockedId === 'string' && !!row.blockedId)
		.map(row => ({ userId: row.blockedId, name: row.blockedName ?? null, createdAt: row.createdAt }));
};

/** ブロックを解除する。次にフィードを読み込んだときから、その人の投稿がまた出る。 */
export const unblockUser = async (session: DivisionSession, blockedUserId: string): Promise<void> => {
	const sb = await withSession(session);
	const { error } = await sb
		.from(DIVISION_USER_BLOCK_TABLE)
		.delete()
		.eq('blockerId', session.userId)
		.eq('blockedId', blockedUserId);
	if (error) throw new Error(describeError(error, 'ブロックの解除に失敗しました'));
};
