/**
 * デザインの見た目の編集: プレビューで要素を選び、パネルで直すと HTML のソースが書き換わる。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	return { ...actual, TextInput: (props: object) => ReactActual.createElement('input-stub', props) };
});

// The preview: keep what it is given, and let the test send the page's messages.
const preview: { html: string; onMessage?: (data: unknown) => void } = { html: '' };
jest.mock('../HtmlPreview', () => ({
	HtmlPreview: (props: { html: string; onMessage?: (data: unknown) => void }) => {
		preview.html = props.html;
		preview.onMessage = props.onMessage;
		return null;
	},
}));

import { DesignVisualEditor } from '../DesignVisualEditor';
import { parseHtml } from '../../lib/htmlPatch';

const PAGE = `<!DOCTYPE html>
<html><head><style>:root { --color-primary: #3b82f6; }</style></head>
<body>
  <h1>ようこそ</h1>
  <p>説明</p>
</body></html>
`;

const Harness = ({ onChange }: { onChange: (v: string) => void }) => {
	const [value, setValue] = React.useState(PAGE);
	return <DesignVisualEditor name='design/index.html' value={value} onChangeText={v => { setValue(v); onChange(v); }} />;
};

const byLabel = (root: ReactTestInstance, label: string) => root.findAll(n => n.props.accessibilityLabel === label && (typeof n.props.onPress === 'function' || typeof n.props.onChangeText === 'function'))[0];

describe('DesignVisualEditor', () => {
	it('edits the tapped element, the design tokens, and undoes', async () => {
		const changes: string[] = [];
		let r!: ReactTestRenderer;
		await act(async () => { r = create(<Harness onChange={v => changes.push(v)} />); });
		expect(preview.html).toContain('data-od-agent');
		const h1 = parseHtml(PAGE).nodes.find(n => n.tag === 'h1')!.id;

		// Tap the heading in the page.
		await act(async () => { preview.onMessage!(JSON.stringify({ __od: true, type: 'select', id: h1, computed: { color: 'rgb(0, 0, 0)', 'font-size': '32px' } })); });
		const text = byLabel(r.root, '文字');
		await act(async () => { text.props.onChangeText('こんにちは'); });
		await act(async () => { text.props.onEndEditing(); });
		expect(changes.at(-1)).toContain('<h1>こんにちは</h1>');

		await act(async () => { byLabel(r.root, '文字の大きさを大きく').props.onPress(); });
		expect(changes.at(-1)).toContain('<h1 style="font-size: 33px">こんにちは</h1>');

		await act(async () => { byLabel(r.root, '文字の色: --color-primary').props.onPress(); });
		expect(changes.at(-1)).toContain('<h1 style="font-size: 33px; color: var(--color-primary)">');

		// Design tokens.
		await act(async () => { r.root.findAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityState?.selected === false && typeof n.props.onPress === 'function')[0].props.onPress(); });
		const token = byLabel(r.root, '--color-primary');
		await act(async () => { token.props.onChangeText('#10b981'); });
		await act(async () => { token.props.onEndEditing(); });
		expect(changes.at(-1)).toContain(':root { --color-primary: #10b981; }');

		// Undo goes back one change at a time.
		await act(async () => { byLabel(r.root, '元に戻す').props.onPress(); });
		expect(changes.at(-1)).toContain(':root { --color-primary: #3b82f6; }');
		expect(changes.at(-1)).toContain('color: var(--color-primary)');
	});

	it('deletes the selected element', async () => {
		const changes: string[] = [];
		let r!: ReactTestRenderer;
		await act(async () => { r = create(<Harness onChange={v => changes.push(v)} />); });
		const p = parseHtml(PAGE).nodes.find(n => n.tag === 'p')!.id;
		await act(async () => { preview.onMessage!({ __od: true, type: 'select', id: p }); });
		await act(async () => { r.root.findAll(n => n.props.title === '削除' && typeof n.props.onPress === 'function')[0].props.onPress(); });
		expect(changes.at(-1)).not.toContain('<p>');
		expect(changes.at(-1)).toContain('<h1>ようこそ</h1>');
	});
});
