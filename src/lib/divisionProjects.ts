/**
 * クラウドエージェントで使う Division プロジェクトの一覧。
 *
 * プロジェクトを指定してセッションを作ると、サーバーはそのプロジェクトの「コーダー」の割り当てを
 * モデルとして使う (POST /api/cloud-sessions の projectId)。一覧の出どころは 2 つ:
 *   - PC に接続しているとき … PC の Orchestra の .division/projects.json (接続 API の division.projects)
 *   - 接続していないとき    … Supabase の Project テーブルを直接読む (デスクトップと同じ問い合わせ)
 *       GET /rest/v1/Project?or=(ownerId.eq.<uid>,userId.eq.<uid>)&select=id,name,updatedAt&order=updatedAt.desc
 *     RLS で自分の行しか読めないので、ユーザーの JWT でセッションを張ってから読む。
 *
 * 後半の純粋関数 (並べ替え・名前の引き当て) は UI 非依存なのでそのままテストできる。
 */

import { DivisionProject } from '../api/types';
import { DivisionSession, getDivisionSupabase } from './divisionAuth';
import { DIVISION_PROJECT_TABLE } from './divisionAuthConfig';

export type CloudProjectOption = {
	id: string;
	name: string;
	/** PC 側で有効になっているか (PC の一覧から作ったときだけ) */
	active?: boolean;
	updatedAt?: string;
};

export type CloudProjectSource = 'pc' | 'supabase';

export const PROJECT_COLUMNS = 'id,name,updatedAt';

/** デスクトップと同じ「自分が持ち主のプロジェクト」の条件 (ownerId と userId のどちらか)。 */
export const ownedProjectFilter = (userId: string): string => `ownerId.eq.${userId},userId.eq.${userId}`;

/** RLS を通すため、Supabase クライアントがこのユーザーのセッションを持っていなければ張り直す。 */
const supabaseFor = async (session: DivisionSession) => {
	const sb = getDivisionSupabase();
	try {
		const { data } = await sb.auth.getSession();
		if (data.session?.access_token && data.session.user?.id === session.userId) return sb;
	} catch {
		// 下で張り直す
	}
	await sb.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
	return sb;
};

type ProjectRow = { id?: unknown; name?: unknown; updatedAt?: unknown };

export const toProjectOption = (row: ProjectRow): CloudProjectOption | null => {
	const id = typeof row.id === 'string' ? row.id.trim() : '';
	if (!id) return null;
	const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '名前のないプロジェクト';
	return { id, name, ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}) };
};

/** Supabase から自分のプロジェクトを新しい順に読む。 */
export const listSupabaseProjects = async (session: DivisionSession): Promise<CloudProjectOption[]> => {
	const sb = await supabaseFor(session);
	const { data, error } = await sb
		.from(DIVISION_PROJECT_TABLE)
		.select(PROJECT_COLUMNS)
		.or(ownedProjectFilter(session.userId))
		.order('updatedAt', { ascending: false });
	if (error) {
		if (error.code === '42501') throw new Error('プロジェクトを読む権限がありません。');
		throw new Error(`プロジェクトを取得できませんでした: ${error.message}`);
	}
	return ((data ?? []) as ProjectRow[])
		.map(toProjectOption)
		.filter((p): p is CloudProjectOption => p !== null);
};

/** PC の一覧から選択肢を作る。ID の無いプロジェクト (Supabase に保存していない) は選べないので外す。 */
export const projectOptionsFromPc = (projects: DivisionProject[]): CloudProjectOption[] => {
	const seen = new Set<string>();
	const options: CloudProjectOption[] = [];
	for (const p of projects) {
		const id = p.projectId?.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		options.push({ id, name: p.name?.trim() || id, active: p.isActive });
	}
	// 有効なものを先に (同じなら元の並び順)
	return options.sort((a, b) => Number(!!b.active) - Number(!!a.active));
};

/** セッションの projectId からプロジェクト名を引く。一覧に無ければ ID の先頭だけ出す。 */
export const projectLabel = (projects: CloudProjectOption[], projectId: string | null | undefined): string | null => {
	if (!projectId) return null;
	const found = projects.find(p => p.id === projectId);
	return found ? found.name : `プロジェクト ${projectId.slice(0, 8)}`;
};

/** PC で有効なプロジェクトがちょうど 1 つなら、その ID (カンバンからの起動で既定にする)。 */
export const singleActiveProjectId = (projects: CloudProjectOption[]): string => {
	const active = projects.filter(p => p.active);
	return active.length === 1 ? active[0].id : '';
};
