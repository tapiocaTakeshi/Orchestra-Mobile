/**
 * クラウドエージェントで使う Division プロジェクトの一覧。
 *
 * プロジェクトを指定してセッションを作ると、サーバーはそのプロジェクトの「コーダー」の割り当てを
 * モデルとして使う (POST /api/cloud-sessions の projectId)。一覧の出どころは 2 つで、両方を合わせて出す:
 *   - PC に接続しているとき … PC の Orchestra の .division/projects.json (接続 API の division.projects)
 *   - Division API          … GET /api/projects (ユーザーの JWT で、自分のプロジェクトだけ返る)
 *     Supabase の Project テーブルは RLS でクライアントから読めない (サーバー専用) ので、直接は読まない。
 *
 *
 * PC に繋いでいないときは、Division API のプロジェクトをそのまま編集する (役割とモデルの割り当て・名前・追加・削除)。
 * 形は PC の projects.json と同じ { role, provider, model } で、サーバーの RoleAssignment に置き換えて保存される
 * (PUT /api/projects/:id/agents)。ソーシャルの取り込みもこれを使う。
 *
 * 後半の純粋関数 (並べ替え・名前の引き当て) は UI 非依存なのでそのままテストできる。
 */

import { DivisionProject, ProviderModels, RoleAssignment } from '../api/types';
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

// ---------------------------------------------------------------------------
// Division API のプロジェクトを PC 無しで編集する
// ---------------------------------------------------------------------------

/** Division API のプロジェクト。PC のものと同じ形にしておくと、編集画面や取り込みをそのまま使える。 */
export type ServerDivisionProject = DivisionProject & { updatedAt?: string };

type ServerProjectRow = ProjectRow & { agents?: unknown };

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** サーバーの agents ([{ role, provider, model, effort? }]) を読む。役割の無い行は捨てる。 */
export const toAgents = (raw: unknown): RoleAssignment[] =>
	(Array.isArray(raw) ? raw : [])
		.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
		.map(a => ({
			role: asText(a.role),
			provider: asText(a.provider),
			model: asText(a.model),
			...(asText(a.effort) ? { effort: asText(a.effort) } : {}),
		}))
		.filter(a => !!a.role);

export const toServerProject = (row: ServerProjectRow): ServerDivisionProject | null => {
	const option = toProjectOption(row);
	if (!option) return null;
	return {
		projectId: option.id,
		name: option.name,
		agents: toAgents(row.agents),
		// 「有効」は PC の Orchestra だけの考え方なので、サーバーのものは常に false
		isActive: false,
		...(option.updatedAt ? { updatedAt: option.updatedAt } : {}),
	};
};

const failure = (what: string, e: unknown) =>
	new Error(`${what}: ${e instanceof Error ? e.message : String(e)}`);

/** 自分のプロジェクトを役割の割り当てつきで、新しく更新した順に読む。 */
export const listServerDivisionProjects = async (session: DivisionSession): Promise<ServerDivisionProject[]> => {
	let data: unknown;
	try {
		data = await divisionApiRequest<unknown>(session, '/api/projects');
	} catch (e) {
		throw failure('プロジェクトを取得できませんでした', e);
	}
	return (Array.isArray(data) ? (data as ServerProjectRow[]) : [])
		.map(row => (row && typeof row === 'object' ? toServerProject(row) : null))
		.filter((p): p is ServerDivisionProject => p !== null)
		.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
};

/** サーバーへ送る形 (空の model / effort は送らない)。 */
const agentsBody = (agents: RoleAssignment[]) =>
	agents.map(a => ({
		role: a.role.trim(),
		provider: a.provider.trim(),
		...(a.model.trim() ? { model: a.model.trim() } : {}),
		...(a.effort ? { effort: a.effort } : {}),
	}));

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

const readSaved = (data: unknown, what: string): ServerDivisionProject => {
	const project = data && typeof data === 'object' ? toServerProject(data as ServerProjectRow) : null;
	if (!project) throw new Error(`${what}: サーバーの応答を読めませんでした`);
	return project;
};

/** プロジェクトの役割の割り当て (と名前) を保存する。割り当ては丸ごと置き換わる。 */
export const saveServerProject = async (
	session: DivisionSession,
	projectId: string,
	patch: { name?: string; agents: RoleAssignment[] },
): Promise<ServerDivisionProject> => {
	let data: unknown;
	try {
		data = await divisionApiRequest<unknown>(session, `${projectPath(projectId)}/agents`, {
			method: 'PUT',
			body: { ...(patch.name?.trim() ? { name: patch.name.trim() } : {}), agents: agentsBody(patch.agents) },
		});
	} catch (e) {
		throw failure('プロジェクトを保存できませんでした', e);
	}
	return readSaved(data, 'プロジェクトを保存できませんでした');
};

/** 新しいプロジェクトを割り当てつきで作る。 */
export const createServerProject = async (
	session: DivisionSession,
	project: { name: string; agents: RoleAssignment[] },
): Promise<ServerDivisionProject> => {
	let data: unknown;
	try {
		data = await divisionApiRequest<unknown>(session, '/api/projects', {
			method: 'POST',
			body: { name: project.name.trim(), agents: agentsBody(project.agents) },
		});
	} catch (e) {
		throw failure('プロジェクトを作れませんでした', e);
	}
	return readSaved(data, 'プロジェクトを作れませんでした');
};

export const deleteServerProject = async (session: DivisionSession, projectId: string): Promise<void> => {
	try {
		await divisionApiRequest<unknown>(session, projectPath(projectId), { method: 'DELETE' });
	} catch (e) {
		throw failure('プロジェクトを削除できませんでした', e);
	}
};

type ModelsResponse = { providers?: { id?: unknown; models?: { modelId?: unknown }[] }[] };

/** 割り当てに選べるモデル (GET /api/models)。PC の getProviderModels と同じ形にする。 */
export const listServerProviderModels = async (session: DivisionSession): Promise<ProviderModels[]> => {
	const data = await divisionApiRequest<ModelsResponse>(session, '/api/models');
	return (data.providers ?? [])
		.map(p => ({
			provider: asText(p.id),
			models: (p.models ?? []).map(m => asText(m.modelId)).filter(Boolean),
		}))
		.filter(p => p.provider && p.models.length > 0);
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
