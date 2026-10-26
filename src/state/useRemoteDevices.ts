/**
 * ログイン中アカウントの PC (RemoteSession) の一覧をポーリングする。
 * ホームの一覧で、まだ接続していない PC を「未接続」「接続切れ」として出すのに使う。
 */

import { useCallback, useEffect, useState } from 'react';

import { DivisionSession, RemoteSessionRow, listRemoteSessions } from '../lib/divisionAuth';
import { REMOTE_DEVICE_HIDE_AFTER_MS } from '../lib/remoteSession';

const POLL_INTERVAL_MS = 10_000;

export const useRemoteDevices = (session: DivisionSession | null, enabled: boolean) => {
	const [devices, setDevices] = useState<RemoteSessionRow[]>([]);

	const reload = useCallback(async () => {
		if (!session) return;
		try {
			setDevices(await listRemoteSessions(session, REMOTE_DEVICE_HIDE_AFTER_MS));
		} catch {
			// 一覧の補助なので、取れなければ前の内容のまま (クラウドのセッションは出せる)
		}
	}, [session]);

	useEffect(() => {
		if (!enabled || !session) return;
		void reload();
		const timer = setInterval(() => { void reload(); }, POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [enabled, session, reload]);

	// アカウントが替わったら前の PC を出さない
	useEffect(() => { setDevices([]); }, [session?.userId]);

	return { devices, reload };
};
