/**
 * クラウドエージェントで使う Division プロジェクトの一覧。
 *
 * プロジェクトを指定してセッションを作ると、サーバーはそのプロジェクトの「コーダー」の割り当てを
 * モデルとして使う (POST /api/cloud-sessions の projectId)。一覧の出どころは 2 つで、両方を合わせて出す:
 *   - PC に接続しているとき … PC の Orchestra の .division/projects.json (接続 API の division.projects)
 *   - Division API          … GET /api/projects (ユーザーの JWT で、自分のプロジェクトだけ返る)
 *     Supabase の Project テーブルは RLS でクライアントから読めない (サーバー専用) ので、直接は読まない。
 *
 * 後半の純粋関数 (並べ替え・名前の引き当て) は UI 非依存なのでそのままテストできる。
 */

import { DivisionProject } from '../api/types';
import { DivisionSession } from './divisionAuth';
import { divisionApiRequest } from './divisionCloud';

export type CloudProjectOption = {
	id: string;
	name: string;
	/** PC 側で有効になっているか (PC の一覧から作ったときだけ) */
	active?: boolean;
	updatedAt?: string;
};

/** 一覧に PC のプロジェクトが含まれていれば 'pc'、Division API のものだけなら 'division'。 */
export type CloudProjectSource = 'pc' | 'division';

type ProjectRow = { id?: unknown; name?: unknown; updatedAt?: unknown };

export const toProjectOption = (row: ProjectRow): CloudProjectOption | null => {
	const id = typeof row.id === 'string' ? row.id.trim() : '';
	if (!id) return null;
	const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '名前のないプロジェクト';
	return { id, name, ...(typeof row.updatedAt === 'string' ? { updatedAt: row.updatedAt } : {}) };
};

/** Division API から自分のプロジェクトを新しく更新した順に読む。 */
export const listServerProjects = async (session: DivisionSession): Promise<CloudProjectOption[]> => {
	let data: unknown;
	try {
		data = await divisionApiRequest<unknown>(session, '/api/projects');
	} catch (e) {
		throw new Error(`プロジェクトを取得できませんでした: ${e instanceof Error ? e.message : String(e)}`);
	}
	const rows = Array.isArray(data) ? (data as ProjectRow[]) : [];
	return rows
		.map(row => (row && typeof row === 'object' ? toProjectOption(row) : null))
		.filter((p): p is CloudProjectOption => p !== null)
		.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
};

/** PC の一覧を先に、そこに無い Division のプロジェクトを後ろに足す。 */
export const mergeProjectOptions = (pc: CloudProjectOption[], server: CloudProjectOption[]): CloudProjectOption[] => {
	const seen = new Set(pc.map(p => p.id));
	return [...pc, ...server.filter(p => !seen.has(p.id))];
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
