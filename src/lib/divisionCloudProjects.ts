/**
 * PC に繋いでいないときの Division プロジェクト管理。Division API を Supabase の JWT で叩く。
 *
 *   GET    /api/projects                  自分のプロジェクト一覧 (割り当ては含まない)
 *   GET    /api/projects/:id              プロジェクトと役割の割り当て
 *   POST   /api/projects                  作成 { name }
 *   PUT    /api/projects/:id              名前の変更 { name }
 *   DELETE /api/projects/:id              削除 (割り当てごと)
 *   PUT    /api/projects/:id/assignments  割り当てをまとめて置き換える { assignments: [{ role, provider, model }] }
 *   GET    /api/models                    選べるプロバイダーとモデル
 *
 * 後半の変換は UI 非依存なのでそのままテストできる。
 */

import { DivisionProject, ProviderModels, RoleAssignment } from '../api/types';
import { DivisionSession } from './divisionAuth';
import { divisionApiRequest } from './divisionCloud';

const projectPath = (id: string): string => `/api/projects/${encodeURIComponent(id)}`;

/** RoleAssignment.config は JSON の {"model": "..."} だが、古い行はモデル ID がそのまま入っている。 */
export const modelFromConfig = (config: unknown): string => {
	if (typeof config !== 'string') return '';
	const text = config.trim();
	if (!text) return '';
	if (text.startsWith('{')) {
		try {
			const parsed = JSON.parse(text) as { model?: unknown };
			return typeof parsed.model === 'string' ? parsed.model : '';
		} catch {
			return '';
		}
	}
	return text;
};

type AssignmentRow = {
	roleId?: unknown;
	providerId?: unknown;
	priority?: unknown;
	config?: unknown;
	role?: { slug?: unknown } | null;
	provider?: { modelId?: unknown } | null;
};

/**
 * サーバーの割り当てを画面の形にする。優先度の高い順に並べ、同じ役割は最初の 1 つだけ残す
 * (クラウドエージェントも役割ごとに優先度の一番高いものを使う)。
 */
export const toAgents = (rows: unknown): RoleAssignment[] => {
	if (!Array.isArray(rows)) return [];
	const sorted = (rows as AssignmentRow[])
		.map((row, index) => ({ row, index, priority: Number(row.priority) || 0 }))
		.sort((a, b) => b.priority - a.priority || a.index - b.index);
	const seen = new Set<string>();
	const agents: RoleAssignment[] = [];
	for (const { row } of sorted) {
		const role = typeof row.role?.slug === 'string' ? row.role.slug : typeof row.roleId === 'string' ? row.roleId : '';
		const provider = typeof row.providerId === 'string' ? row.providerId : '';
		if (!role || !provider || seen.has(role)) continue;
		seen.add(role);
		const fallback = typeof row.provider?.modelId === 'string' ? row.provider.modelId : '';
		agents.push({ role, provider, model: modelFromConfig(row.config) || fallback });
	}
	return agents;
};

type ProjectRow = { id?: unknown; name?: unknown; assignments?: unknown };

export const toCloudProject = (row: ProjectRow): DivisionProject | null => {
	const projectId = typeof row.id === 'string' ? row.id.trim() : '';
	if (!projectId) return null;
	const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '名前のないプロジェクト';
	return { projectId, name, agents: toAgents(row.assignments), isActive: false };
};

/** GET /api/models の { providers: [{ id, models: [{ modelId }] }] } をモデル選びの形にする。 */
export const toProviderModels = (data: unknown): ProviderModels[] => {
	const providers = (data as { providers?: unknown } | null)?.providers;
	if (!Array.isArray(providers)) return [];
	const result: ProviderModels[] = [];
	for (const p of providers as { id?: unknown; models?: unknown }[]) {
		if (typeof p.id !== 'string' || !p.id) continue;
		const models = Array.isArray(p.models)
			? (p.models as { modelId?: unknown }[])
				.map(m => (typeof m.modelId === 'string' ? m.modelId : ''))
				.filter(Boolean)
			: [];
		if (models.length > 0) result.push({ provider: p.id, models });
	}
	return result;
};

/** 保存する割り当て。役割の重複と、プロバイダーが決まっていない行は送らない。 */
export const toAssignmentsBody = (agents: RoleAssignment[]): { assignments: RoleAssignment[] } => {
	const seen = new Set<string>();
	const assignments: RoleAssignment[] = [];
	for (const a of agents) {
		const role = a.role.trim();
		const provider = a.provider.trim();
		if (!role || !provider || seen.has(role)) continue;
		seen.add(role);
		assignments.push({ role, provider, model: a.model.trim() });
	}
	return { assignments };
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const getCloudProject = async (session: DivisionSession, projectId: string): Promise<DivisionProject> => {
	const project = toCloudProject(await divisionApiRequest<ProjectRow>(session, projectPath(projectId)));
	if (!project) throw new Error('プロジェクトを読み込めませんでした。');
	return project;
};

/** 一覧と、それぞれの割り当て (一覧の API には含まれないので 1 件ずつ読む)。 */
export const listCloudProjects = async (session: DivisionSession): Promise<DivisionProject[]> => {
	const rows = await divisionApiRequest<unknown>(session, '/api/projects');
	const projects = (Array.isArray(rows) ? (rows as ProjectRow[]) : [])
		.map(toCloudProject)
		.filter((p): p is DivisionProject => p !== null);
	return Promise.all(projects.map(p => getCloudProject(session, p.projectId).catch(() => p)));
};

export const createCloudProject = async (session: DivisionSession, name: string, agents: RoleAssignment[] = []): Promise<DivisionProject> => {
	const row = await divisionApiRequest<ProjectRow>(session, '/api/projects', { method: 'POST', body: { name: name.trim() } });
	const project = toCloudProject(row);
	if (!project) throw new Error('プロジェクトを作成できませんでした。');
	const body = toAssignmentsBody(agents);
	if (body.assignments.length === 0) return project;
	return saveCloudAssignments(session, project.projectId, agents);
};

export const renameCloudProject = async (session: DivisionSession, projectId: string, name: string): Promise<void> => {
	await divisionApiRequest(session, projectPath(projectId), { method: 'PUT', body: { name: name.trim() } });
};

export const saveCloudAssignments = async (session: DivisionSession, projectId: string, agents: RoleAssignment[]): Promise<DivisionProject> => {
	const row = await divisionApiRequest<ProjectRow>(session, `${projectPath(projectId)}/assignments`, {
		method: 'PUT',
		body: toAssignmentsBody(agents),
	});
	const project = toCloudProject(row);
	if (!project) throw new Error('割り当てを保存できませんでした。');
	return project;
};

export const deleteCloudProject = async (session: DivisionSession, projectId: string): Promise<void> => {
	await divisionApiRequest(session, projectPath(projectId), { method: 'DELETE' });
};

export const listCloudModels = async (session: DivisionSession): Promise<ProviderModels[]> =>
	toProviderModels(await divisionApiRequest<unknown>(session, '/api/models'));
