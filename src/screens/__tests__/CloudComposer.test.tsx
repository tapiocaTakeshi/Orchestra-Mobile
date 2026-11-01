/**
 * ホームの入力欄 (LaunchComposer) の回帰テスト。
 *
 * 入力欄は主操作 (指示を書いて送る) だけを中心にし、補助の設定チップは必要なときだけ出す:
 *  - 空の入力欄にはコストのチップを出さない。指示を書くと出て、押すとコスト調整のシートが開く
 *  - 目標ループのチップは既定値 (オフ) のときは出さず、変えたときだけ出す (変えた値は見える)
 *  - 入力欄が空でも、起動の設定シートの「コストの見積もりと方針を開く」からコスト調整へ行ける
 *  - 送信は指示が空なら何も起こさず、書いてあれば起動する
 * 通信・重い子画面はモックで、描画は react-test-renderer (実機ではない)。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

// ネイティブ依存 (ESM のまま入る保存先) はテストに関係ないので差し替える
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) }));

jest.mock('../../components/GitHubRepoPicker', () => ({
	useGitHubConnection: () => ({
		status: { configured: true, connected: true },
		error: null,
		starting: false,
		waiting: false,
		disconnecting: false,
		refresh: jest.fn(),
		connect: jest.fn(),
		cancelConnect: jest.fn(),
		disconnect: jest.fn(),
		markDisconnected: jest.fn(),
	}),
	GitHubAccountRow: () => null,
	GitHubConnectPanel: () => null,
	GitHubRepoPicker: () => null,
}));
jest.mock('../../components/CloudModelPicker', () => ({ CloudModelPicker: () => null }));
jest.mock('../../components/CloudProjectPicker', () => ({
	CloudProjectPicker: () => null,
	useCloudProjects: () => ({ projects: [], loading: false }),
}));
jest.mock('../TuningScreen', () => ({
	TuningScreen: () => {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const R = require('react') as typeof React;
		return R.createElement('Text', null, 'TUNING_SCREEN');
	},
}));
jest.mock('../../lib/divisionCloud', () => ({
	...jest.requireActual('../../lib/divisionCloud'),
	loadLastCloudRepo: jest.fn(async () => null),
}));
jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return {
		...actual,
		useToast: () => ({ show: jest.fn() }),
		// Modal はテストレンダラーのツリーに出ないので、シートの中身をその場に描く
		Sheet: ({ title, children }: { title: string; children: React.ReactNode }) => {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const R = require('react') as typeof React;
			return R.createElement(R.Fragment, null, R.createElement('Text', null, title), children);
		},
	};
});

// node 環境には document が無く、react-native-web の TextInput が focus 中の要素を調べに行くので最小限で用意する
(globalThis as unknown as { document?: { activeElement: null } }).document ??= { activeElement: null };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../CloudAgentsScreen') as typeof import('../CloudAgentsScreen');
const { LaunchComposer, EMPTY_DRAFT } = mod;

const findTextNode = (root: ReactTestInstance, text: string): ReactTestInstance | undefined =>
	root.findAll(
		n => n.children.length > 0 && n.children.every(c => typeof c === 'string') && n.children.join('') === text,
		{ deep: true },
	)[0];

const findButtonsByLabel = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
	root.findAll(node => {
		if (node.props?.accessibilityLabel !== label || typeof node.props?.onPress !== 'function') return false;
		const parent = node.parent;
		return !(parent?.props?.accessibilityLabel === label && typeof parent.props?.onPress === 'function');
	});

const findRowByTitle = (root: ReactTestInstance, title: string): ReactTestInstance => {
	const t = findTextNode(root, title);
	if (!t) throw new Error(`テキスト「${title}」が見つかりません。`);
	let cur: ReactTestInstance | null = t.parent;
	while (cur) {
		if (typeof cur.props?.onPress === 'function') return cur;
		cur = cur.parent;
	}
	throw new Error(`「${title}」を含む押せる行が見つかりません。`);
};

const press = async (node: ReactTestInstance) => {
	await act(async () => {
		const props = node.props as { onPress?: (e: unknown) => void; onClick?: (e: unknown) => void };
		(props.onPress ?? props.onClick)?.({ stopPropagation: () => undefined, preventDefault: () => undefined });
	});
};

let renderer: ReactTestRenderer | null = null;

const Harness = ({ initial, onLaunch }: { initial: Partial<typeof EMPTY_DRAFT>; onLaunch: () => void }) => {
	const [draft, setDraft] = React.useState({ ...EMPTY_DRAFT, ...initial });
	const [optionsOpen, setOptionsOpen] = React.useState(false);
	return React.createElement(LaunchComposer, {
		auth: { userId: 'u1', email: 'me@example.com', accessToken: 't', refreshToken: 'r' } as never,
		projects: { projects: [], loading: false } as never,
		draft,
		onChange: setDraft,
		onGoalLoopTouched: jest.fn(),
		onLaunch,
		optionsOpen,
		onOptionsOpen: setOptionsOpen,
		costLabel: null,
	});
};

let onLaunch: jest.Mock;
const render = async (initial: Partial<typeof EMPTY_DRAFT> = {}): Promise<ReactTestRenderer> => {
	onLaunch = jest.fn();
	await act(async () => {
		renderer = create(React.createElement(Harness, { initial, onLaunch }));
	});
	return renderer!;
};

afterEach(async () => {
	if (renderer) {
		await act(async () => { renderer!.unmount(); });
		renderer = null;
	}
	jest.clearAllMocks();
});

const COST_CHIP = 'コスト調整を開く';
const LOOP_CHIP_OFF = '目標ループ: オフ。変更する';

describe('LaunchComposer の補助チップ (必要なときだけ出す)', () => {
	it('空の入力欄にはコストのチップも、既定 (オフ) のループのチップも出さない', async () => {
		const r = await render();
		expect(findButtonsByLabel(r.root, COST_CHIP)).toHaveLength(0);
		expect(r.root.findAll(n => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('目標ループ'))).toHaveLength(0);
		// 主操作 (指示の入力と送信) は常にある
		expect(r.root.findAll(n => n.props?.accessibilityLabel === 'エージェントへの指示').length).toBeGreaterThan(0);
	});

	it('指示を書くとコストのチップが出て、押すとコスト調整のシートが開く', async () => {
		const r = await render({ prompt: 'テストを直して' });
		const chips = findButtonsByLabel(r.root, COST_CHIP);
		expect(chips).toHaveLength(1);
		expect(findTextNode(r.root, 'TUNING_SCREEN')).toBeUndefined();
		await press(chips[0]);
		expect(findTextNode(r.root, 'TUNING_SCREEN')).toBeTruthy();
	});

	it('ループを既定 (オフ) から変えたときだけチップが出て、変えた値が見える', async () => {
		const r = await render({ goalLoop: 'auto' });
		expect(findButtonsByLabel(r.root, '目標ループ: 自動。変更する')).toHaveLength(1);
		expect(findTextNode(r.root, 'ループ · 自動')).toBeTruthy();
		expect(findButtonsByLabel(r.root, LOOP_CHIP_OFF)).toHaveLength(0);
	});
});

describe('LaunchComposer からコストと設定への入口 (入力欄が空でも)', () => {
	it('モデルのチップから起動の設定が開き、そこからコスト調整へ行ける', async () => {
		const r = await render();
		const chipLabel = r.root
			.findAll(n => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('モデル:') && typeof n.props.onPress === 'function')[0];
		expect(chipLabel).toBeTruthy();
		await press(chipLabel);
		// 設定シートが開き、コストの入口がある
		const open = findButtonsByLabel(r.root, COST_CHIP);
		expect(open).toHaveLength(1);
		await press(open[0]);
		expect(findTextNode(r.root, 'TUNING_SCREEN')).toBeTruthy();
	});
});

describe('LaunchComposer の送信', () => {
	it('指示が空なら押しても起動しない (誤送信しない)', async () => {
		const r = await render();
		const send = findButtonsByLabel(r.root, 'セッションを起動');
		expect(send).toHaveLength(1);
		await press(send[0]);
		expect(onLaunch).not.toHaveBeenCalled();
	});

	it('指示と起動の設定が揃っていれば 1 タップで起動する (主操作)', async () => {
		const r = await render({ prompt: 'テストを直して', source: 'empty' });
		const send = findButtonsByLabel(r.root, 'セッションを起動');
		expect(send).toHaveLength(1);
		await press(send[0]);
		expect(onLaunch).toHaveBeenCalledTimes(1);
	});
});
