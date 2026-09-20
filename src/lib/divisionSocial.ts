/**
 * ソーシャル (役割割り当ての共有) の Supabase アクセス。
 *
 * 投稿本体は `AssignmentPost`、いいねは `AssignmentPostLike` に入る。どちらも
 * RLS で「読むのはログイン済みなら誰でも / 書けるのは自分の行だけ」に絞られており、
 * いいね数はトリガ、取り込み数は `import_assignment_post` 関数が更新する
 * (Orchestra リポジトリの supabase/migrations/*_assignment_post_social.sql)。
 * クライアントからカウンタを直接書くことはできない。
 */

import { PostgrestError } from '@supabase/supabase-js';

import { DivisionSession, getDivisionSupabase } from './divisionAuth';
import {
	DIVISION_ASSIGNMENT_POST_LIKE_TABLE,
	DIVISION_ASSIGNMENT_POST_TABLE,
	DIVISION_IMPORT_POST_FUNCTION,
	DIVISION_PROFILES_TABLE,
} from './divisionAuthConfig';
import { AssignmentPost, PostAssignment, parseAssignments } from './social';

const POST_COLUMNS = 'id, authorId, authorName, title, description, assignments, sourceProjectId, likeCount, importCount, createdAt, updatedAt';

/** テーブルが未整備 (マイグレーション未適用) のときは、次の一手が分かる文言にする。 */
const describeError = (error: PostgrestError, fallback: string): string => {
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

	const { data: likes } = await sb
		.from(DIVISION_ASSIGNMENT_POST_LIKE_TABLE)
		.select('postId')
		.eq('userId', session.userId)
		.in('postId', rows.map(r => r.id));

	const likedIds = new Set((likes ?? []).map(l => (l as { postId: string }).postId));
	return rows.map(row => toPost(row, likedIds, session.userId));
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

	const sb = await withSession(session);
	const authorName = input.authorName?.trim() || await fetchDisplayName(session);

	const { data, error } = await sb
		.from(DIVISION_ASSIGNMENT_POST_TABLE)
		.insert({
			authorId: session.userId,
			authorName,
			title,
			description: input.description?.trim() || null,
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
