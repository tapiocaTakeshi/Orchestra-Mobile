/**
 * GitHub 連携の状態: Division のトークン更新 (セッションのオブジェクトが変わる) で「未連携」に戻らないこと、
 * 確認に失敗しても前に分かった状態を消さずに取り直すこと。
 */

import React from 'react';
import { act, create } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getGitHubStatus = jest.fn();
jest.mock('../../lib/divisionGitHub', () => ({
	...jest.requireActual('../../lib/divisionGitHub'),
	getGitHubStatus: (...args: unknown[]) => getGitHubStatus(...args),
}));

import { GitHubConnection, useGitHubConnection } from '../GitHubRepoPicker';
import { ToastProvider } from '../ui';
import { DivisionCloudError } from '../../lib/divisionCloud';

let latest: GitHubConnection | null = null;
const Probe = ({ auth }: { auth: { userId: string; email: string; accessToken: string; refreshToken: string } }) => {
	latest = useGitHubConnection(auth);
	return null;
};

const session = (token: string) => ({ userId: 'u1', email: 'a@b.c', accessToken: token, refreshToken: `r-${token}` });

beforeEach(() => { jest.useFakeTimers(); getGitHubStatus.mockReset(); latest = null; });
afterEach(() => { jest.useRealTimers(); });

describe('useGitHubConnection', () => {
	it('keeps the connection when the Division token is refreshed, and retries a failed check without forgetting it', async () => {
		getGitHubStatus.mockResolvedValue({ configured: true, connected: true, login: 'me' });
		let r!: ReturnType<typeof create>;
		await act(async () => { r = create(<ToastProvider><Probe auth={session('t1')} /></ToastProvider>); });
		expect(latest!.status).toEqual({ configured: true, connected: true, login: 'me' });
		expect(getGitHubStatus).toHaveBeenCalledTimes(1);

		// トークンの更新: 新しいセッションのオブジェクト。状態は消えず、取り直しもしない
		await act(async () => { r.update(<ToastProvider><Probe auth={session('t2')} /></ToastProvider>); });
		expect(latest!.status?.connected).toBe(true);
		expect(getGitHubStatus).toHaveBeenCalledTimes(1);

		// 確認に失敗 (通信など): 連携済みのまま、少し待って取り直す。取り直しは最新のトークンで
		getGitHubStatus.mockRejectedValueOnce(new DivisionCloudError(0, 'timeout'));
		await act(async () => { await latest!.refresh(); });
		expect(latest!.status?.connected).toBe(true);
		expect(latest!.error).toBeTruthy();
		await act(async () => { jest.advanceTimersByTime(3_000); });
		await act(async () => { await Promise.resolve(); });
		expect(getGitHubStatus).toHaveBeenCalledTimes(3);
		expect(getGitHubStatus.mock.calls[2][0].accessToken).toBe('t2');
		expect(latest!.error).toBeNull();
	});
});
