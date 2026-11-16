/**
 * PC に繋いでいないときの Division プロジェクト (Division API のもの) の読み書き。
 *
 * プロジェクト画面の編集と、ソーシャルの取り込みで使う。保存・作成・削除のあとは
 * サーバーの応答で一覧を差し替えるので、読み直しを待たずに画面に出る。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ProviderModels, RoleAssignment } from '../api/types';
import { DivisionSession } from '../lib/divisionAuth';
import {
	ServerDivisionProject,
	createServerProject,
	deleteServerProject,
	listServerDivisionProjects,
	listServerProviderModels,
	saveServerProject,
} from '../lib/divisionProjects';

export type ServerProjects = {
	projects: ServerDivisionProject[];
	/** 割り当てに選べるモデル。取れなければ空 (名前の編集や取り込みはできる) */
	providers: ProviderModels[];
	loading: boolean;
	error: string | null;
	reload: () => void;
	save: (projectId: string, patch: { name?: string; agents: RoleAssignment[] }) => Promise<ServerDivisionProject>;
	create: (project: { name: string; agents: RoleAssignment[] }) => Promise<ServerDivisionProject>;
	remove: (projectId: string) => Promise<void>;
};

const byUpdated = (a: ServerDivisionProject, b: ServerDivisionProject) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');

/** enabled が false のあいだは何も読まない (PC 接続中は PC の一覧を使うため)。 */
export const useServerProjects = (session: DivisionSession | null, enabled = true): ServerProjects => {
	const [projects, setProjects] = useState<ServerDivisionProject[]>([]);
	const [providers, setProviders] = useState<ProviderModels[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nonce, setNonce] = useState(0);

	// session はトークン更新で別オブジェクトになるので、最新のものを ref で読む
	const sessionRef = useRef(session);
	sessionRef.current = session;
	const userId = session?.userId;

	useEffect(() => {
		const current = sessionRef.current;
		if (!current || !enabled) { setProjects([]); return; }
		let cancelled = false;
		setLoading(true);
		setError(null);
		void listServerDivisionProjects(current)
			.then(rows => { if (!cancelled) setProjects(rows); })
			.catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
			.finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, [userId, enabled, nonce]);

	// モデル一覧は滅多に変わらないので、ログインごとに 1 回だけ取る
	useEffect(() => {
		const current = sessionRef.current;
		if (!current || !enabled) return;
		let cancelled = false;
		void listServerProviderModels(current)
			.then(list => { if (!cancelled) setProviders(list); })
			.catch(() => undefined);
		return () => { cancelled = true; };
	}, [userId, enabled]);

	const reload = useCallback(() => setNonce(n => n + 1), []);

	const requireSession = () => {
		const current = sessionRef.current;
		if (!current) throw new Error('Division アカウントでログインしてください。');
		return current;
	};

	const save = useCallback(async (projectId: string, patch: { name?: string; agents: RoleAssignment[] }) => {
		const saved = await saveServerProject(requireSession(), projectId, patch);
		setProjects(prev => [saved, ...prev.filter(p => p.projectId !== saved.projectId)].sort(byUpdated));
		return saved;
	}, []);

	const create = useCallback(async (project: { name: string; agents: RoleAssignment[] }) => {
		const created = await createServerProject(requireSession(), project);
		setProjects(prev => [created, ...prev.filter(p => p.projectId !== created.projectId)]);
		return created;
	}, []);

	const remove = useCallback(async (projectId: string) => {
		await deleteServerProject(requireSession(), projectId);
		setProjects(prev => prev.filter(p => p.projectId !== projectId));
	}, []);

	return { projects, providers, loading, error, reload, save, create, remove };
};
