/**
 * 文書の一部をロールの AI で直す: 提案を見比べて「適用」したときだけ文書が変わる。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	return { ...actual, TextInput: (props: object) => ReactActual.createElement('input-stub', props) };
});
jest.mock('../HtmlPreview', () => ({ HtmlPreview: () => null }));
jest.mock('../../lib/divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import { AiEditPanel } from '../AiEditPanel';
import { DocumentView } from '../DocumentView';
import { applyAiEditProposal, toDocumentAiEditProposal } from '../../lib/divisionCloud';

const DOC = '# 論文\n\n古い段落。\n\n## 結論\n';
const START = DOC.indexOf('古い段落。');
const press = (root: ReactTestInstance, title: string) => root.findAll(n => n.props.title === title && typeof n.props.onPress === 'function')[0].props.onPress();
const input = (root: ReactTestInstance, label: string) => root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];

describe('applyAiEditProposal', () => {
	it('puts the replacement in, unless that part changed since', () => {
		const p = { start: START, end: START + 5, original: '古い段落。', replacement: '新しい段落。' };
		expect(applyAiEditProposal(DOC, p)).toBe('# 論文\n\n新しい段落。\n\n## 結論\n');
		expect(applyAiEditProposal(DOC.replace('古い', '別の'), p)).toBeNull();
		expect(toDocumentAiEditProposal({ start: 1, end: 0, original: '', replacement: '' })).toBeNull();
		expect(toDocumentAiEditProposal({ start: 0, end: 1, original: 'a', replacement: 'b', roleName: '調査' })).toMatchObject({ roleName: '調査', role: '' });
	});
});

describe('AiEditPanel', () => {
	const proposal = { path: '.division/paper.md', start: START, end: START + 5, original: '古い段落。', replacement: '新しい段落。', role: 'researcher', roleName: '調査', model: 'X · m' };

	it('asks the role\'s AI about the selection and applies only when approved', async () => {
		const aiEdit = jest.fn(async () => proposal);
		const onApply = jest.fn();
		let r!: ReactTestRenderer;
		await act(async () => { r = create(<AiEditPanel value={DOC} selection={{ start: START, end: START + 5 }} aiEdit={aiEdit} onApply={onApply} />); });
		await act(async () => { input(r.root, 'AI への指示').props.onChangeText('もっと具体的に'); });
		await act(async () => { press(r.root, 'AI に頼む'); });
		expect(aiEdit).toHaveBeenCalledWith({ start: START, end: START + 5, selected: '古い段落。', instruction: 'もっと具体的に', content: DOC });
		expect(onApply).not.toHaveBeenCalled();
		const texts = r.root.findAll(n => typeof n.props.children === 'string').map(n => n.props.children);
		expect(texts).toEqual(expect.arrayContaining(['古い段落。', '新しい段落。']));

		await act(async () => { press(r.root, '適用'); });
		expect(onApply).toHaveBeenCalledWith('# 論文\n\n新しい段落。\n\n## 結論\n');
	});

	it('discards the proposal without touching the document, and shows the error when the AI fails', async () => {
		const aiEdit = jest.fn().mockResolvedValueOnce(proposal).mockRejectedValueOnce(new Error('モデルが応答しませんでした'));
		const onApply = jest.fn();
		let r!: ReactTestRenderer;
		await act(async () => { r = create(<AiEditPanel value={DOC} selection={{ start: START, end: START + 5 }} aiEdit={aiEdit} onApply={onApply} />); });
		await act(async () => { input(r.root, 'AI への指示').props.onChangeText('短く'); });
		await act(async () => { press(r.root, 'AI に頼む'); });
		await act(async () => { press(r.root, '破棄'); });
		expect(onApply).not.toHaveBeenCalled();
		await act(async () => { press(r.root, 'AI に頼む'); });
		expect(r.root.findAll(n => n.props.message === 'モデルが応答しませんでした').length).toBeGreaterThan(0);
	});

	it('cannot ask without a selection', async () => {
		let r!: ReactTestRenderer;
		await act(async () => { r = create(<AiEditPanel value={DOC} selection={null} aiEdit={jest.fn()} onApply={jest.fn()} />); });
		const ask = r.root.findAll(n => n.props.title === 'AI に頼む' && typeof n.props.onPress === 'function')[0];
		expect(ask.props.disabled).toBe(true);
	});
});

describe('DocumentView with aiEdit', () => {
	it('uses the code editor\'s selection', async () => {
		const aiEdit = jest.fn(async () => ({ path: 'p', start: START, end: START + 5, original: '古い段落。', replacement: '新しい。', role: '', roleName: 'エージェント', model: '' }));
		const onChange = jest.fn();
		let r!: ReactTestRenderer;
		await act(async () => { r = create(<DocumentView name='.division/paper.md' value={DOC} onChangeText={onChange} mode='edit' aiEdit={aiEdit} />); });
		await act(async () => { input(r.root, '.division/paper.md を編集').props.onSelectionChange({ nativeEvent: { selection: { start: START, end: START + 5 } } }); });
		await act(async () => { input(r.root, 'AI への指示').props.onChangeText('短く'); });
		await act(async () => { press(r.root, 'AI に頼む'); });
		await act(async () => { press(r.root, '適用'); });
		expect(onChange).toHaveBeenCalledWith('# 論文\n\n新しい。\n\n## 結論\n');
	});
});
