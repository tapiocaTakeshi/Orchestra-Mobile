/**
 * PC のチャットの成果物の承認: 全文を読み、編集した内容を editedOutputs で送って承認する。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { ReviewOutputs } from '../../api/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	return {
		...actual,
		TextInput: (props: object) => ReactActual.createElement('input-stub', props),
		Modal: ({ children }: { children: React.ReactNode }) => children,
	};
});

const review: ReviewOutputs = {
	flowRole: 'writer',
	title: 'specification.md',
	outputs: [{ role: 'writer', mdFileName: 'specification.md', mdFilePath: '/w/.division/specification.md', content: '# 仕様\n' }],
};
const client = {
	getReviewOutputs: jest.fn(async () => review),
	approveTool: jest.fn(async () => ({})),
	rejectTool: jest.fn(async () => ({})),
};
jest.mock('../../state/AppContext', () => ({ useApp: () => ({ client, invalidate: jest.fn() }) }));

import { ReviewOutputsSheet } from '../ReviewOutputsSheet';
import { ToastProvider } from '../ui';

const pressable = (root: ReactTestInstance, label: string) =>
	root.findAll(n => (n.props.accessibilityLabel === label || n.props.title === label) && typeof n.props.onPress === 'function')[0];

describe('ReviewOutputsSheet', () => {
	it('approves with the edited specification', async () => {
		const onClose = jest.fn();
		let r!: ReactTestRenderer;
		await act(async () => { r = create(<ToastProvider><ReviewOutputsSheet threadId='t1' onClose={onClose} /></ToastProvider>); });
		expect(client.getReviewOutputs).toHaveBeenCalledWith('t1');

		const tabs = r.root.findAll(n => n.props.accessibilityRole === 'tab' && typeof n.props.onPress === 'function');
		await act(async () => { tabs[tabs.length - 1].props.onPress(); });
		const editor = r.root.findAll(n => n.props.accessibilityLabel === 'specification.md を編集' && typeof n.props.onChangeText === 'function')[0];
		await act(async () => { editor.props.onChangeText('# 仕様 (スマホで直した)\n'); });

		await act(async () => { pressable(r.root, '編集して承認').props.onPress(); });
		expect(client.approveTool).toHaveBeenCalledWith('t1', [{ mdFileName: 'specification.md', mdContent: '# 仕様 (スマホで直した)\n' }]);
		expect(onClose).toHaveBeenCalled();
	});
});
