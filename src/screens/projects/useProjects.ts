import { useCallback, useEffect, useRef, useState } from 'react';
import * as projectsLib from '../../lib/divisionProjects';
import { normalizeProjects, ProjectItem, SAMPLE_PROJECTS } from './projectModel';

type AnyFn = (...args: unknown[]) => unknown;
const lib = projectsLib as unknown as Record<string, unknown>;

function pick(names: string[]): AnyFn | undefined {
  for (const n of names) {
    if (typeof lib[n] === 'function') return lib[n] as AnyFn;
  }
  return undefined;
}

/** 既存 divisionProjects の取得関数（存在するものを使う） */
export const defaultLoadProjects: (() => Promise<unknown>) | undefined = (() => {
  const fn = pick(['listProjects', 'fetchProjects', 'getProjects', 'loadProjects']);
  return fn ? () => Promise.resolve(fn()) : undefined;
})();

/** 既存 divisionProjects の選択関数（存在すれば呼ぶ） */
export function notifyLibSelection(id: string): void {
  const fn = pick(['selectProject', 'setSelectedProject', 'setActiveProject']);
  if (!fn) return;
  try {
    const r = fn(id);
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => undefined);
  } catch {
    // 選択の永続化に失敗しても画面操作は継続
  }
}

export type ProjectsState = {
  projects: ProjectItem[];
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useProjects(loader: (() => Promise<unknown>) | undefined = defaultLoadProjects): ProjectsState {
  const [projects, setProjects] = useState<ProjectItem[]>(loader ? [] : SAMPLE_PROJECTS);
  const [loading, setLoading] = useState<boolean>(!!loader);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const reload = useCallback(() => {
    if (!loader) {
      setProjects(SAMPLE_PROJECTS);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    loader()
      .then((raw) => {
        if (!mounted.current) return;
        setProjects(normalizeProjects(raw));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!mounted.current) return;
        setError(e instanceof Error && e.message ? e.message : 'プロジェクトを取得できませんでした');
        setLoading(false);
      });
  }, [loader]);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return { projects, loading, error, reload };
}
