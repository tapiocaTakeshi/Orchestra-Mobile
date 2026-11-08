/**
 * CloudAgentsScreen (ホームのクラウド一覧とセッション詳細) の回帰テスト。仕様 FR-003 / FR-004 / FR-005、受け入れ条件1・8。
 *  (a) 一覧の取得に失敗したら、歓迎用の空状態ではなく失敗表示と再試行を出す (成功の 0 件なら空状態)
 *  (b) 送信に失敗しても入力文は残り、入力欄の直上に理由と再試行が出る
 *  (c) 再試行は同じ本文を送り、成功したら失敗表示を消す
 *  (d) 目標ループの継続 (continueGoal) の失敗は、入力欄が空でも同じ継続操作・引数で再試行できる
 *  (e) 入力を書き換えたら古い失敗表示を消す
 *  (f) 別操作 (続ける) の成功で古い失敗表示を消す (ISS-11)
 *  (g) 失敗後に送れない状態 (承認待ち) へ変わったら、再試行を消して理由と次の操作を出す (ISS-12)
 *  (h) ホームから PC へ新規送信: チャット作成後に本文送信が失敗したら、再試行は同じ threadId へ本文だけを送る (ISS-09)
 *  (i) PC 送信の失敗後に接続が切れたら、再試行の代わりに理由と「PCに再接続」を出す (ISS-12)
 *
 * ネットワーク・ストレージ・重い子コンポーネントはモックで切り離す。
 * 一覧と詳細はポーリングするので、各テストの後で必ず unmount してタイマーを残さない。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import type { CloudSession, CloudSessionEvent } from '../../lib/divisionCloud';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- 外部依存のモック --------------------------------------------------------

const mockAuth = { userId: 'user-1', email: 'me@example.com', accessToken: 'access-token', refreshToken: 'refresh-token' };

jest.mock('../../state/DivisionAuthContext', () => ({
	useDivisionAuth: () => ({ session: mockAuth, refreshSession: jest.fn() }),
}));
const mockPcClient = { newThread: jest.fn(), sendPrompt: jest.fn() };
const mockRefresh = jest.fn(async () => undefined);
const appDisconnected = () => ({ connection: null, connectionStatus: 'disconnected', snapshot: null, client: null, connect: jest.fn(), invalidate: jest.fn(), refresh: mockRefresh });
let mockAppState: Record<string, unknown> = appDisconnected();
jest.mock('../../state/AppContext', () => ({
	useApp: () => mockAppState,
}));
jest.mock('../../state/useRemoteDevices', () => ({ useRemoteDevices: () => ({ devices: [] }) }));
jest.mock('../../state/cloudStorage', () => ({
	clearLastCloudRepo: jest.fn(async () => undefined),
	loadLastCloudModel: jest.fn(async () => null),
	loadLastCloudRepo: jest.fn(async () => null),
	saveLastCloudModel: jest.fn(async () => undefined),
	saveLastCloudRepo: jest.fn(async () => undefined),
}));
jest.mock('../../lib/remoteNotifications', () => ({ notifyRemoteEvent: jest.fn(async () => undefined) }));
jest.mock('../TuningScreen', () => ({ TuningScreen: () => null }));
jest.mock('../../components/DecisionInbox', () => ({ DecisionInbox: () => null }));
jest.mock('../../components/CloudProjectPicker', () => ({
	CloudProjectPicker: () => null,
	useCloudProjects: () => ({ projects: [], loading: false, error: null, reload: jest.fn() }),
}));
jest.mock('../../components/CloudPullRequest', () => {
	const actual = jest.requireActual('../../components/CloudPullRequest');
	return {
		...actual,
		PullRequestBar: () => null,
		PullRequestSheet: () => null,
		RepoPullRequests: () => null,
		usePullRequestInfo: () => ({ status: 'none' }),
	};
});
jest.mock('../../components/GitHubRepoPicker', () => {
	const actual = jest.requireActual('../../components/GitHubRepoPicker');
	return { ...actual, useGitHubConnection: () => ({ status: 'disconnected', reload: jest.fn() }) };
});
// TextInput (react-native-web) は node 環境で document を参照するので、入力欄は軽量スタブにする
jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	// AppState (react-native-web) は node 環境では購読を返さないので、常に前面の状態にする
	const AppState = { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) };
	return { ...actual, AppState, TextInput: (props: object) => ReactActual.createElement('input-stub', props) };
});
const mockToastShow = jest.fn();
jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	// Sheet (Modal) は node 環境で描けないので中身だけ出す
	return { ...actual, useToast: () => ({ show: mockToastShow, hide: jest.fn() }), Sheet: ({ children }: { children: React.ReactNode }) => children };
});

const mockListCloudSessions = jest.fn();
const mockFetchCloudEvents = jest.fn();
const mockSendCloudMessage = jest.fn();
const mockResumeCloudSession = jest.fn();
jest.mock('../../lib/divisionCloud', () => {
	const actual = jest.requireActual('../../lib/divisionCloud');
	return {
		...actual,
		listCloudSessions: (...args: unknown[]) => mockListCloudSessions(...args),
		fetchCloudEvents: (...args: unknown[]) => mockFetchCloudEvents(...args),
		sendCloudMessage: (...args: unknown[]) => mockSendCloudMessage(...args),
		resumeCloudSession: (...args: unknown[]) => mockResumeCloudSession(...args),
		// 承認カードの読み込みは通信しない
		getCloudCommandApproval: async () => null,
		getCloudApproval: async () => null,
		getCloudWorkflowProposal: async () => null,
	};
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CloudAgentsScreen } = require('../CloudAgentsScreen') as typeof import('../CloudAgentsScreen');

// --- テストデータ ------------------------------------------------------------

const baseSession = (over: Partial<CloudSession> = {}): CloudSession => ({
	id: 's1',
	title: 'README を直す',
	prompt: 'README を直して',
	status: 'idle',
	model: null,
	modelLabel: null,
	projectId: null,
	workspaceName: null,
	workspaceInfo: null,
	summary: null,
	errorMsg: null,
	changedFiles: 0,
	lastSeq: 0,
	createdAt: '2026-11-08T00:00:00.000Z',
	updatedAt: '2026-11-08T00:00:00.000Z',
	startedAt: '2026-11-08T00:00:00.000Z',
	completedAt: null,
	goalLoop: 'off',
	goalMaxRounds: null,
	approvalMode: false,
	...over,
});

/** 「毎回確認」で止まった目標ループ (最後が next: 'paused' のレビュー) */
const pausedEvents: CloudSessionEvent[] = [
	{ seq: 1, type: 'user', data: { text: 'テストを直して' }, createdAt: '2026-11-08T00:00:00.000Z' },
	{ seq: 2, type: 'review', data: { status: 'done', round: 1, next: 'paused', criteria: [{ index: 1, text: 'テストが通る', met: false }], summary: '一部未達' }, createdAt: '2026-11-08T00:00:01.000Z' },
];

// --- ヘルパー ----------------------------------------------------------------

const texts = (root: ReactTestInstance): string[] =>
	root.findAll(n => n.children.length > 0 && n.children.every(c => typeof c === 'string')).map(n => n.children.join(''));
const hasText = (root: ReactTestInstance, part: string) => texts(root).some(t => t.includes(part));

/** title / accessibilityLabel で押せるノードを探す (外側のラッパーだけ) */
const findButtons = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
	root.findAll(n => {
		if ((n.props?.title !== label && n.props?.accessibilityLabel !== label) || typeof n.props?.onPress !== 'function') return false;
		const p = n.parent;
		return !(p && (p.props?.title === label || p.props?.accessibilityLabel === label) && typeof p.props?.onPress === 'function');
	});

const press = async (node: ReactTestInstance) => {
	await act(async () => {
		node.props.onPress({ stopPropagation: () => undefined, preventDefault: () => undefined });
	});
};

const composer = (root: ReactTestInstance): ReactTestInstance =>
	root.findAll(n => n.type === ('input-stub' as unknown) && n.props.accessibilityLabel === '追加の指示')[0];

const type = async (root: ReactTestInstance, text: string) => {
	await act(async () => { composer(root).props.onChangeText(text); });
};

let renderer: ReactTestRenderer | null = null;

const render = async (props: Parameters<typeof CloudAgentsScreen>[0] = {}): Promise<ReactTestInstance> => {
	await act(async () => { renderer = create(<CloudAgentsScreen {...props} />); });
	// 一覧・イベントの非同期取得を流す
	await act(async () => { await Promise.resolve(); });
	return renderer!.root;
};

beforeEach(() => {
	mockListCloudSessions.mockReset();
	mockFetchCloudEvents.mockReset();
	mockSendCloudMessage.mockReset();
	mockResumeCloudSession.mockReset();
	mockPcClient.newThread.mockReset();
	mockPcClient.sendPrompt.mockReset();
	mockRefresh.mockClear();
	mockToastShow.mockReset();
	mockAppState = appDisconnected();
});

afterEach(async () => {
	if (renderer) {
		await act(async () => { renderer!.unmount(); });
		renderer = null;
	}
});

// --- (a) 一覧の状態 -----------------------------------------------------------

describe('CloudAgentsScreen 一覧の状態 (FR-004 / FR-008)', () => {
	it('成功して 0 件なら、次の操作を示す空状態を出す', async () => {
		mockListCloudSessions.mockResolvedValue([]);
		const root = await render({ onOpenPcChat: jest.fn(), headerTitle: 'ホーム' });
		expect(hasText(root, 'エージェントを動かす')).toBe(true);
		expect(findButtons(root, '再試行')).toHaveLength(0);
	});

	it('取得に失敗したら空状態を出さず、失敗理由と再試行を出す。再試行で読み直すと一覧が出る', async () => {
		mockListCloudSessions.mockRejectedValueOnce(new Error('ネットワークに接続できません'));
		const root = await render({ onOpenPcChat: jest.fn(), headerTitle: 'ホーム' });
		expect(hasText(root, 'ネットワークに接続できません')).toBe(true);
		expect(hasText(root, 'エージェントを動かす')).toBe(false);

		mockListCloudSessions.mockResolvedValue([baseSession()]);
		await press(findButtons(root, '再試行')[0]);
		expect(hasText(root, 'ネットワークに接続できません')).toBe(false);
		expect(hasText(root, 'README を直す')).toBe(true);
	});
});

// --- (b)〜(e) 詳細の送信・再試行 ---------------------------------------------

describe('CloudAgentsScreen セッション詳細の送信失敗と再試行 (FR-003 / FR-005)', () => {
	const openDetail = async (events: CloudSessionEvent[] = [], session = baseSession()) => {
		mockListCloudSessions.mockResolvedValue([session]);
		mockFetchCloudEvents.mockResolvedValue({ events, session });
		return render({ initialSessionId: 's1' });
	};

	it('通常送信の失敗: 入力文が残り、理由と再試行が出る。再試行は同じ本文を送り、成功で表示を消す', async () => {
		const root = await openDetail();
		await type(root, '  テストも追加して  ');

		mockSendCloudMessage.mockRejectedValueOnce(new Error('タイムアウトしました'));
		await press(findButtons(root, '送信')[0]);
		expect(mockSendCloudMessage).toHaveBeenLastCalledWith(mockAuth, 's1', 'テストも追加して');
		expect(composer(root).props.value).toBe('  テストも追加して  ');
		expect(hasText(root, '送信できませんでした: タイムアウトしました')).toBe(true);
		const retry = findButtons(root, '再試行');
		expect(retry).toHaveLength(1);

		mockSendCloudMessage.mockResolvedValueOnce(baseSession({ lastSeq: 1 }));
		await press(retry[0]);
		expect(mockSendCloudMessage).toHaveBeenCalledTimes(2);
		expect(mockSendCloudMessage).toHaveBeenLastCalledWith(mockAuth, 's1', 'テストも追加して');
		expect(hasText(root, '送信できませんでした')).toBe(false);
		expect(findButtons(root, '再試行')).toHaveLength(0);
		expect(composer(root).props.value).toBe('');
	});

	it('空白だけの入力では送信しない', async () => {
		const root = await openDetail();
		await type(root, '   ');
		await press(findButtons(root, '送信')[0]);
		expect(mockSendCloudMessage).not.toHaveBeenCalled();
	});

	it('目標継続の失敗: 入力欄が空でも再試行が出て、通常送信ではなく同じ継続操作・引数で送り直す', async () => {
		const root = await openDetail(pausedEvents);
		expect(composer(root).props.value).toBe('');

		mockSendCloudMessage.mockRejectedValueOnce(new Error('接続が切れました'));
		await press(findButtons(root, '次のラウンドへ進む')[0]);
		expect(mockSendCloudMessage).toHaveBeenLastCalledWith(mockAuth, 's1', '', { continueGoal: true });
		expect(hasText(root, '次のラウンドへ進めませんでした: 接続が切れました')).toBe(true);

		const retry = findButtons(root, '再試行');
		expect(retry).toHaveLength(1);
		mockSendCloudMessage.mockResolvedValueOnce(baseSession({ lastSeq: 3 }));
		await press(retry[0]);
		expect(mockSendCloudMessage).toHaveBeenCalledTimes(2);
		expect(mockSendCloudMessage).toHaveBeenLastCalledWith(mockAuth, 's1', '', { continueGoal: true });
		expect(hasText(root, '次のラウンドへ進めませんでした')).toBe(false);
	});

	it('目標継続の失敗: 追加指示付きなら、その指示を保ったまま継続を再試行する', async () => {
		const root = await openDetail(pausedEvents);
		await type(root, 'lint も直して');

		mockSendCloudMessage.mockRejectedValueOnce(new Error('接続が切れました'));
		await press(findButtons(root, '次のラウンドへ進む')[0]);
		mockSendCloudMessage.mockResolvedValueOnce(baseSession({ lastSeq: 3 }));
		await press(findButtons(root, '再試行')[0]);
		expect(mockSendCloudMessage).toHaveBeenLastCalledWith(mockAuth, 's1', 'lint も直して', { continueGoal: true });
	});

	it('失敗後に入力を書き換えたら、古い失敗表示と再試行を消す', async () => {
		const root = await openDetail();
		await type(root, '最初の指示');
		mockSendCloudMessage.mockRejectedValueOnce(new Error('タイムアウトしました'));
		await press(findButtons(root, '送信')[0]);
		expect(hasText(root, '送信できませんでした')).toBe(true);

		await type(root, '書き直した指示');
		expect(hasText(root, '送信できませんでした')).toBe(false);
		expect(findButtons(root, '再試行')).toHaveLength(0);
		expect(composer(root).props.value).toBe('書き直した指示');
	});

	it('失敗後に別の操作 (続ける) が成功したら、古い失敗表示と再試行を消す (ISS-11)', async () => {
		const failed = baseSession({ status: 'failed' });
		const root = await openDetail([{ seq: 1, type: 'user', data: { text: '最初' }, createdAt: '2026-11-08T00:00:00.000Z' }], failed);
		await type(root, '追加の指示');
		mockSendCloudMessage.mockRejectedValueOnce(new Error('タイムアウトしました'));
		await press(findButtons(root, '送信')[0]);
		expect(hasText(root, '送信できませんでした')).toBe(true);

		mockResumeCloudSession.mockResolvedValueOnce(baseSession({ status: 'running' }));
		await press(findButtons(root, '続ける')[0]);
		expect(mockResumeCloudSession).toHaveBeenCalled();
		expect(hasText(root, '送信できませんでした')).toBe(false);
		expect(findButtons(root, '再試行')).toHaveLength(0);
		// 入力は消さない (送信されていない)
		expect(composer(root).props.value).toBe('追加の指示');
	});

	it('失敗後にポーリングで承認待ちへ変わったら、押せない再試行は出さず理由と次の操作を出す (ISS-12)', async () => {
		const root = await openDetail();
		await type(root, '追加の指示');
		mockSendCloudMessage.mockRejectedValueOnce(new Error('タイムアウトしました'));
		await press(findButtons(root, '送信')[0]);
		expect(findButtons(root, '再試行')).toHaveLength(1);

		const awaiting = baseSession({ status: 'awaiting_approval' });
		mockFetchCloudEvents.mockResolvedValue({ events: [], session: awaiting });
		// 次のポーリング (2 秒) を待つ
		await act(async () => { await new Promise(r => setTimeout(r, 2_200)); });
		expect(hasText(root, '送信できませんでした')).toBe(true);
		expect(hasText(root, '現在は再試行できません。承認待ちのため')).toBe(true);
		expect(findButtons(root, '再試行')).toHaveLength(0);
	});
});

// --- (h)(i) ホームから PC への新規送信 ------------------------------------------

describe('CloudAgentsScreen ホームから PC への新規送信の失敗と再試行 (FR-003 / ISS-09 / ISS-12)', () => {
	const homeProps = { onOpenPcChat: jest.fn(), headerTitle: 'ホーム' };
	const appConnected = (status = 'connected') => ({
		...appDisconnected(),
		connection: { url: 'http://pc', token: 't', label: 'my-pc' },
		connectionStatus: status,
		client: mockPcClient,
	});

	const homeComposer = (root: ReactTestInstance) =>
		root.findAll(n => n.type === ('input-stub' as unknown) && n.props.accessibilityLabel === 'エージェントへの指示')[0];

	/** 送り先を PC にして本文を入れ、送信まで進める */
	const sendFromHome = async (prompt: string) => {
		mockListCloudSessions.mockResolvedValue([]);
		mockAppState = appConnected();
		homeProps.onOpenPcChat = jest.fn();
		const root = await render(homeProps);
		await press(findButtons(root, '送り先: クラウド。変更する')[0]);
		const pcRow = root.findAll(n => typeof n.props?.onPress === 'function' && n.props?.accessibilityState?.disabled === false && n.props?.accessibilityState?.selected === false
			&& !(n.parent && typeof n.parent.props?.onPress === 'function' && n.parent.props?.accessibilityState?.disabled === false));
		await press(pcRow[0]);
		await act(async () => { homeComposer(root).props.onChangeText(prompt); });
		await press(findButtons(root, 'PC my-pc に送る')[0]);
		return root;
	};

	it('チャット作成後に本文送信が失敗したら、入力を残し、再試行は同じ threadId へ本文だけを送る (チャットを重複作成しない)', async () => {
		mockPcClient.newThread.mockResolvedValue({ threadId: 't-new', messages: [], isRunning: false, awaitingApproval: false });
		mockPcClient.sendPrompt.mockRejectedValueOnce(new Error('タイムアウトしました'));
		const root = await sendFromHome('ログインを直して');

		expect(mockPcClient.newThread).toHaveBeenCalledTimes(1);
		expect(mockPcClient.sendPrompt).toHaveBeenLastCalledWith('ログインを直して', { threadId: 't-new' });
		expect(hasText(root, 'PC への本文を送信できませんでした: タイムアウトしました')).toBe(true);
		expect(homeComposer(root).props.value).toBe('ログインを直して');
		expect(mockToastShow).not.toHaveBeenCalledWith(expect.anything(), 'error');
		expect(homeProps.onOpenPcChat).not.toHaveBeenCalled();

		const retry = findButtons(root, '同じチャットへ再試行');
		expect(retry).toHaveLength(1);
		mockPcClient.sendPrompt.mockResolvedValueOnce({ threadId: 't-new' });
		await press(retry[0]);
		expect(mockPcClient.newThread).toHaveBeenCalledTimes(1);
		expect(mockPcClient.sendPrompt).toHaveBeenCalledTimes(2);
		expect(mockPcClient.sendPrompt).toHaveBeenLastCalledWith('ログインを直して', { threadId: 't-new' });
		expect(hasText(root, 'PC への本文を送信できませんでした')).toBe(false);
		expect(homeComposer(root).props.value).toBe('');
		expect(homeProps.onOpenPcChat).toHaveBeenCalledTimes(1);
	});

	it('チャット作成そのものが失敗したら、再試行で作成からやり直す', async () => {
		mockPcClient.newThread.mockRejectedValueOnce(new Error('PC が応答しません'));
		const root = await sendFromHome('テストを足して');
		expect(mockPcClient.sendPrompt).not.toHaveBeenCalled();
		expect(hasText(root, 'PC にチャットを作れませんでした: PC が応答しません')).toBe(true);

		mockPcClient.newThread.mockResolvedValueOnce({ threadId: 't-2', messages: [], isRunning: false, awaitingApproval: false });
		mockPcClient.sendPrompt.mockResolvedValueOnce({ threadId: 't-2' });
		await press(findButtons(root, '再試行')[0]);
		expect(mockPcClient.newThread).toHaveBeenCalledTimes(2);
		expect(mockPcClient.sendPrompt).toHaveBeenLastCalledWith('テストを足して', { threadId: 't-2' });
		expect(homeProps.onOpenPcChat).toHaveBeenCalledTimes(1);
	});

	it('失敗後に本文を書き換えたら、古い失敗表示と再試行を消す', async () => {
		mockPcClient.newThread.mockResolvedValue({ threadId: 't-new', messages: [], isRunning: false, awaitingApproval: false });
		mockPcClient.sendPrompt.mockRejectedValueOnce(new Error('タイムアウトしました'));
		const root = await sendFromHome('最初の指示');
		expect(hasText(root, 'PC への本文を送信できませんでした')).toBe(true);
		await act(async () => { homeComposer(root).props.onChangeText('書き直した指示'); });
		expect(hasText(root, 'PC への本文を送信できませんでした')).toBe(false);
		expect(findButtons(root, '同じチャットへ再試行')).toHaveLength(0);
	});

	it('失敗後に接続が切れたら、再試行を消して理由と「PCに再接続」を出す。自動では送り直さない', async () => {
		mockPcClient.newThread.mockResolvedValue({ threadId: 't-new', messages: [], isRunning: false, awaitingApproval: false });
		mockPcClient.sendPrompt.mockRejectedValueOnce(new Error('タイムアウトしました'));
		const root = await sendFromHome('最初の指示');

		mockAppState = appConnected('lost');
		await act(async () => { renderer!.update(<CloudAgentsScreen {...homeProps} />); });
		expect(hasText(root, '現在は再試行できません。PC との接続が切れています')).toBe(true);
		expect(findButtons(root, '同じチャットへ再試行')).toHaveLength(0);
		const reconnect = findButtons(root, 'PCに再接続');
		expect(reconnect).toHaveLength(1);
		await press(reconnect[0]);
		expect(mockRefresh).toHaveBeenCalled();
		expect(mockPcClient.sendPrompt).toHaveBeenCalledTimes(1);
		// 本文は保持している
		expect(homeComposer(root).props.value).toBe('最初の指示');
	});
});
