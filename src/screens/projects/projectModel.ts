export type ProjectStatus = 'running' | 'warning' | 'success' | 'danger';

export type ProjectItem = {
  id: string;
  name: string;
  repo: string;
  branch: string;
  summary: string;
  updatedLabel: string;
  status: ProjectStatus;
};

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  running: '作業中',
  warning: '承認待ち',
  success: '完了',
  danger: 'エラー',
};

const STATUS_ALIASES: Record<string, ProjectStatus> = {
  running: 'running', active: 'running', working: 'running', in_progress: 'running', '作業中': 'running',
  warning: 'warning', pending: 'warning', waiting: 'warning', awaiting_approval: 'warning', approval: 'warning', '承認待ち': 'warning',
  success: 'success', done: 'success', completed: 'success', merged: 'success', idle: 'success', '完了': 'success',
  danger: 'danger', error: 'danger', failed: 'danger', failure: 'danger', 'エラー': 'danger',
};

export function relativeTimeJa(input: string | number | Date, now: number = Date.now()): string {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(t)) return String(input);
  const diffMin = Math.max(0, Math.floor((now - t) / 60000));
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `更新 ${diffMin} 分前`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `更新 ${h} 時間前`;
  if (h < 48) return '昨日';
  return `${Math.floor(h / 24)} 日前`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 既存 API から返る形式の違いを吸収して ProjectItem にそろえる */
export function normalizeProject(raw: unknown, index: number): ProjectItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fullName = str(r.fullName) ?? str(r.full_name);
  const name = str(r.name) ?? (fullName ? fullName.split('/').pop() : undefined);
  if (!name) return null;
  const repo =
    (str(r.repo) ?? str(r.repoUrl) ?? str(r.url) ?? str(r.htmlUrl) ?? (fullName ? `github.com/${fullName}` : ''))
      .replace(/^https?:\/\//, '');
  const branch = str(r.branch) ?? str(r.defaultBranch) ?? str(r.default_branch) ?? 'main';
  const sessions = typeof r.sessionCount === 'number' ? r.sessionCount : typeof r.sessions === 'number' ? r.sessions : undefined;
  const summary = str(r.summary) ?? (sessions !== undefined ? `${sessions} セッション` : '');
  const updatedRaw = r.updatedAt ?? r.updated_at;
  const updatedLabel =
    str(r.updatedLabel) ??
    (typeof updatedRaw === 'string' || typeof updatedRaw === 'number' ? relativeTimeJa(updatedRaw) : '');
  const statusKey = (str(r.status) ?? '').toLowerCase();
  return {
    id: str(r.id) ?? (typeof r.id === 'number' ? String(r.id) : undefined) ?? fullName ?? `${name}-${index}`,
    name,
    repo,
    branch,
    summary,
    updatedLabel,
    status: STATUS_ALIASES[statusKey] ?? 'success',
  };
}

export function normalizeProjects(raw: unknown): ProjectItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { projects?: unknown }).projects)
      ? (raw as { projects: unknown[] }).projects
      : [];
  return list.map(normalizeProject).filter((p): p is ProjectItem => p !== null);
}

export function metaLeft(p: ProjectItem): string {
  return p.summary ? `${p.branch} · ${p.summary}` : p.branch;
}

/** モックアップ（03 · ProjectsScreen）と同じサンプル。取得 API が見つからない場合のみ使用 */
export const SAMPLE_PROJECTS: ProjectItem[] = [
  { id: 'orchestra-mobile', name: 'orchestra-mobile', repo: 'github.com/division/orchestra-mobile', branch: 'main', summary: '3 セッション', updatedLabel: '更新 2 分前', status: 'running' },
  { id: 'division-relay', name: 'division-relay', repo: 'github.com/division/division-relay', branch: 'feat/codec', summary: '1 セッション', updatedLabel: '更新 18 分前', status: 'warning' },
  { id: 'docs-site', name: 'docs-site', repo: 'github.com/division/docs-site', branch: 'main', summary: 'PR #128 マージ済み', updatedLabel: '昨日', status: 'success' },
  { id: 'billing-worker', name: 'billing-worker', repo: 'github.com/division/billing-worker', branch: 'fix/retry', summary: 'テスト 2 件失敗', updatedLabel: '3 日前', status: 'danger' },
];
