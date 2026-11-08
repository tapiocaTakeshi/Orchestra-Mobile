/**
 * RemoteScreen (PC のチャットの遠隔操作) の回帰テスト。
 *  - エージェントの返答を Markdown として描く (記号のまま出さない)
 *  - 目標ループの切り替え (自動 ⇄ 毎回確認)。古い IDE / Division API 以外では出さない
 *  - 「毎回確認」で止まったときは、ツールの承認ではなく次のラウンドへ進むか聞く
 *  - 入力欄: 複数行で書け、入力 → 送信ボタン 1 タップ (2 操作) で送れる。空のときは送れない
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer, ReactTestRendererJSON } from 'react-test-renderer';

import type { ChatState, Snapshot } from '../../api/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockClient = {
	sendPrompt: jest.fn(),
	setGoalLoopMode: jest.fn(),
	approveTool: jest.fn(),
	rejectTool: jest.fn(),
	newThread: jest.fn(),
	abortAgent: jest.fn(),
	switchThread: jest.fn(),
};
let mockSnapshot: Snapshot;
const mockInvalidate = jest.fn();
const mockToast = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
let mockConnectionStatus: string | undefined;

jest.mock('../../state/AppContext', () => ({
	useApp: () => ({ snapshot: mockSnapshot, error: null, refresh: mockRefresh, isRefreshing: false, invalidate: mockInvalidate, client: mockClient, connectionStatus: mockConnectionStatus }),
}));
jest.mock('../TuningScreen', () => ({ TuningScreen: () => null }));
// TextInput (react-native-web) は node 環境で document を参照するので、入力欄は軽量スタブにする
jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	return { ...actual, TextInput: (props: object) => ReactActual.createElement('input-stub', props) };
});
jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return { ...actual, useToast: () => ({ show: mockToast }) };
});

import { RemoteScreen } from '../RemoteScreen';

const snapshotWith = (chat: Partial<ChatState>): Snapshot => ({
	ide: { protocolVersion: 1, appName: 'Orchestra', version: '1.0.0', workspaceName: 'ws', workspaceFolders: [], uiLanguage: 'ja' },
	division: { projects: [], activeProjectIds: [], configPath: null, hasProject: false },
	kanban: {} as Snapshot['kanban'],
	chat: { threadId: 't1', messages: [], isRunning: false, awaitingApproval: false, ...chat },
	threads: [],
	remoteSession: null,
	revision: 1,
	generatedAt: 0,
});

const render = async () => {
	let tree!: ReactTestRenderer;
	await act(async () => { tree = create(<RemoteScreen onOpenPage={jest.fn()} />); });
	return tree;
};

/** 画面に出ている文字 (入れ子の太字なども含む) を | でつないで返す */
const textsOf = (tree: ReactTestRenderer) => {
	const leaves: string[] = [];
	const walk = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null) => {
		if (node === null) return;
		if (typeof node === 'string') leaves.push(node);
		else if (Array.isArray(node)) node.forEach(walk);
		else (node.children ?? []).forEach(walk);
	};
	walk(tree.toJSON());
	return leaves.join('|');
};

const byLabel = (tree: ReactTestRenderer, pattern: RegExp): ReactTestInstance =>
	tree.root.find(n => typeof n.props.accessibilityLabel === 'string' && pattern.test(n.props.accessibilityLabel) && typeof n.props.onPress === 'function');

beforeEach(() => {
	jest.clearAllMocks();
	mockConnectionStatus = undefined;
	Object.values(mockClient).forEach(fn => fn.mockResolvedValue({}));
});

describe('RemoteScreen', () => {
	it('返答の Markdown を記号のまま出さない', async () => {
		mockSnapshot = snapshotWith({ messages: [{ role: 'assistant', text: '## 🎯 目標\n\n**ログインを直す**\n\n1. テストが通る' }] });
		const tree = await render();
		const texts = textsOf(tree);
		expect(texts).toContain('🎯 目標');
		expect(texts).toContain('ログインを直す');
		expect(texts).not.toContain('**');
		expect(texts).not.toContain('##');
	});

	it('入力欄にループの設定は出さない (繰り返しはワークフローで設定する)', async () => {
		mockSnapshot = snapshotWith({ goalLoopMode: 'auto' });
		const tree = await render();
		expect(() => byLabel(tree, /^目標ループ/)).toThrow();
	});

	it('Division API 以外 / 古い IDE ではループを出さない', async () => {
		mockSnapshot = snapshotWith({ goalLoopMode: null });
		const tree = await render();
		expect(() => byLabel(tree, /^目標ループ/)).toThrow();
	});

	it('「毎回確認」で止まったら、次のラウンドへ進むか聞く', async () => {
		mockSnapshot = snapshotWith({
			isRunning: true,
			awaitingApproval: true,
			goalLoopMode: 'confirm',
			pendingReview: { flowRole: 'goal-loop', title: '目標はまだ達成されていません', content: '満たせていない条件:\n- テストが通る', completed: 1, total: 5 },
		});
		const tree = await render();
		const texts = textsOf(tree);
		expect(texts).toContain('🎯 目標はまだ達成されていません（ラウンド 1 / 5 完了）');
		expect(texts).toContain('次のラウンドへ進む');
		expect(texts).not.toContain('ツールの実行を承認しますか？');
		const next = tree.root.find(n => n.props.title === '次のラウンドへ進む' && typeof n.props.onPress === 'function');
		await act(async () => { next.props.onPress(); });
		expect(mockClient.approveTool).toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith('次のラウンドに進みました', 'success');
	});

	it('入力欄は複数行で、空のあいだは送信ボタンが無効', async () => {
		mockSnapshot = snapshotWith({});
		const tree = await render();
		const input = tree.root.find(n => n.props.accessibilityLabel === 'エージェントへの指示' && typeof n.props.onChangeText === 'function');
		expect(input.props.multiline).toBe(true);
		const sendButton = byLabel(tree, /^送信$/);
		expect(sendButton.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
		await act(async () => { input.props.onChangeText('   '); });
		expect(byLabel(tree, /^送信$/).props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
	});

	it('入力 → 送信ボタン 1 タップの 2 操作で送れる (改行を含む指示もそのまま送る)', async () => {
		mockSnapshot = snapshotWith({});
		const tree = await render();
		const input = tree.root.find(n => n.props.accessibilityLabel === 'エージェントへの指示' && typeof n.props.onChangeText === 'function');
		// 操作 1: 入力
		await act(async () => { input.props.onChangeText('ログインを直して\nテストも足して'); });
		const sendButton = byLabel(tree, /^送信$/);
		expect(sendButton.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
		// 操作 2: 送信ボタン
		await act(async () => { sendButton.props.onPress(); });
		expect(mockClient.sendPrompt).toHaveBeenCalledTimes(1);
		expect(mockClient.sendPrompt).toHaveBeenCalledWith('ログインを直して\nテストも足して');
		expect(mockInvalidate).toHaveBeenCalled();
		// 送ったら入力欄は空に戻る
		const after = tree.root.find(n => n.props.accessibilityLabel === 'エージェントへの指示' && typeof n.props.onChangeText === 'function');
		expect(after.props.value).toBe('');
	});

	it('自分の発言は右寄せの吹き出しで出す', async () => {
		mockSnapshot = snapshotWith({ messages: [{ role: 'user', text: 'こんにちは' }] });
		const tree = await render();
		expect(() => tree.root.find(n => n.props.accessibilityLabel === 'あなた: こんにちは')).not.toThrow();
	});

	// 送信失敗: 入力を残し、入力欄の直上に理由と再試行を出す。再試行は失敗した本文を同じ sendPrompt で送る (FR-003 / FR-005)
	const inputOf = (tree: ReactTestRenderer) =>
		tree.root.find(n => n.props.accessibilityLabel === 'エージェントへの指示' && typeof n.props.onChangeText === 'function');
	const retryButtons = (tree: ReactTestRenderer) =>
		tree.root.findAll(n => n.props.title === '再試行' && typeof n.props.onPress === 'function' && n.parent?.props.title !== '再試行');

	it('送信に失敗しても入力は残り、理由と再試行が出る。再試行は同じ本文を送り、成功で表示を消す', async () => {
		mockSnapshot = snapshotWith({});
		const tree = await render();
		await act(async () => { inputOf(tree).props.onChangeText('  結果を要約して  '); });
		mockClient.sendPrompt.mockRejectedValueOnce(new Error('タイムアウトしました'));
		await act(async () => { byLabel(tree, /^送信$/).props.onPress(); });
		expect(mockClient.sendPrompt).toHaveBeenLastCalledWith('結果を要約して');
		expect(inputOf(tree).props.value).toBe('  結果を要約して  ');
		expect(textsOf(tree)).toContain('PC へ送信できませんでした');
		expect(mockToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
		const retry = retryButtons(tree);
		expect(retry).toHaveLength(1);

		mockClient.sendPrompt.mockResolvedValueOnce({});
		await act(async () => { retry[0].props.onPress(); });
		expect(mockClient.sendPrompt).toHaveBeenCalledTimes(2);
		expect(mockClient.sendPrompt).toHaveBeenLastCalledWith('結果を要約して');
		expect(textsOf(tree)).not.toContain('PC へ送信できませんでした');
		expect(retryButtons(tree)).toHaveLength(0);
		expect(inputOf(tree).props.value).toBe('');
	});

	it('送信失敗の後に入力を書き換えたら、古い失敗表示と再試行を消す', async () => {
		mockSnapshot = snapshotWith({});
		const tree = await render();
		await act(async () => { inputOf(tree).props.onChangeText('最初の指示'); });
		mockClient.sendPrompt.mockRejectedValueOnce(new Error('タイムアウトしました'));
		await act(async () => { byLabel(tree, /^送信$/).props.onPress(); });
		expect(textsOf(tree)).toContain('PC へ送信できませんでした');
		await act(async () => { inputOf(tree).props.onChangeText('書き直した指示'); });
		expect(textsOf(tree)).not.toContain('PC へ送信できませんでした');
		expect(retryButtons(tree)).toHaveLength(0);
	});

	it('送信・停止ボタンは hitSlop に頼らず実寸 44×44 以上 (FR-011)', async () => {
		mockSnapshot = snapshotWith({});
		const tree = await render();
		const style = byLabel(tree, /^送信$/).props.style;
		const resolved = (typeof style === 'function' ? style({ pressed: false }) : style) as object[];
		const flat = Object.assign({}, ...[resolved].flat(Infinity).filter(Boolean)) as { width?: number; height?: number };
		expect(flat.width).toBeGreaterThanOrEqual(44);
		expect(flat.height).toBeGreaterThanOrEqual(44);
	});

	const flatStyle = (node: ReactTestInstance) => {
		const style = node.props.style;
		const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
		return Object.assign({}, ...[resolved].flat(Infinity).filter(Boolean)) as { minWidth?: number; minHeight?: number };
	};
	const failSend = async (tree: ReactTestRenderer, text = '最初の指示') => {
		await act(async () => { inputOf(tree).props.onChangeText(text); });
		mockClient.sendPrompt.mockRejectedValueOnce(new Error('タイムアウトしました'));
		await act(async () => { byLabel(tree, /^送信$/).props.onPress(); });
	};

	it('再試行ボタンは実寸 44×44 以上 (size=sm のまま。ISS-10)', async () => {
		mockSnapshot = snapshotWith({});
		const tree = await render();
		await failSend(tree);
		const pressable = tree.root.findAll(n => n.props.accessibilityLabel === '再試行' && typeof n.props.style === 'function')[0];
		const flat = flatStyle(pressable);
		expect(flat.minHeight).toBeGreaterThanOrEqual(44);
		expect(flat.minWidth).toBeGreaterThanOrEqual(44);
	});

	it('送信失敗の後に別操作 (承認) が成功したら、古い失敗表示を消す (ISS-11)', async () => {
		mockSnapshot = snapshotWith({ isRunning: true, awaitingApproval: true });
		const tree = await render();
		await failSend(tree);
		expect(textsOf(tree)).toContain('PC へ送信できませんでした');
		const approve = tree.root.find(n => n.props.title === '許可' && typeof n.props.onPress === 'function');
		await act(async () => { approve.props.onPress(); });
		expect(mockClient.approveTool).toHaveBeenCalled();
		expect(textsOf(tree)).not.toContain('PC へ送信できませんでした');
		expect(retryButtons(tree)).toHaveLength(0);
	});

	it('送信失敗の後に接続が切れたら、再試行を消して理由と「PCに再接続」を出す。自動では送り直さない (ISS-12)', async () => {
		mockSnapshot = snapshotWith({});
		const tree = await render();
		await failSend(tree);
		mockConnectionStatus = 'lost';
		await act(async () => { tree.update(<RemoteScreen onOpenPage={jest.fn()} />); });
		expect(textsOf(tree)).toContain('現在は再試行できません。PC との接続が切れています');
		// 入力欄直上の送信失敗表示の中だけを見る (画面上部の既存の接続切れバナーは別)
		const sendBanner = tree.root.findAll(n => n.props.accessibilityRole === 'alert'
			&& n.findAll(c => c.children.some(x => typeof x === 'string' && x.includes('PC へ送信できませんでした'))).length > 0)[0];
		expect(sendBanner).toBeDefined();
		const inBanner = (title: string) => sendBanner.findAll(n => n.props.title === title && typeof n.props.onPress === 'function' && n.parent?.props.title !== title);
		expect(inBanner('再試行')).toHaveLength(0);
		const reconnect = inBanner('PCに再接続');
		expect(reconnect).toHaveLength(1);
		await act(async () => { reconnect[0].props.onPress(); });
		expect(mockRefresh).toHaveBeenCalled();
		expect(mockClient.sendPrompt).toHaveBeenCalledTimes(1);
		expect(inputOf(tree).props.value).toBe('最初の指示');
	});
});
