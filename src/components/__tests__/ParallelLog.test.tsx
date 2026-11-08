/**
 * 並列の分岐のチャットログ: 分岐ごとのタブを押すと、その分岐のログに切り替わる。
 */

import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Markdown } from '../Markdown';
import { PARALLEL_LOG_LANG } from '../../lib/parallelLog';

const now = Date.now();
const text = `### 2. leader\n\n計画\n\n\`\`\`${PARALLEL_LOG_LANG}\n${JSON.stringify({
	v: 1,
	lanes: [
		{ key: 1, step: 2, role: 'researcher', title: '市場を調べる', status: 'done', startedAt: now - 9000, endedAt: now - 2000, text: '調査の結論' },
		{ key: 2, step: 3, role: 'designer', title: '画面を描く', status: 'running', startedAt: now - 5000, text: 'デザインを作成中' },
	],
})}\n\`\`\`\n`;

const allText = (r: ReactTestRenderer) => r.root.findAll(n => typeof n.children?.[0] === 'string' && (n.type as unknown) !== 'input').map(n => n.children.join('')).join('\n');

describe('ParallelLogView', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('draws lanes instead of a code block and switches lanes on tap', () => {
		let r!: ReactTestRenderer;
		act(() => { r = create(<Markdown text={text} textStyle={{}} />); });
		const shown = allText(r);
		expect(shown).toContain('並列実行');
		expect(shown).toContain('2 分岐 · 1/2 完了');
		expect(shown).not.toContain('"lanes"');
		// 既定は動いている分岐
		expect(shown).toContain('画面を描く');
		expect(shown).toContain('デザインを作成中');
		expect(shown).not.toContain('市場を調べる');
		// ほかの分岐は今の 1 行だけ
		expect(shown).toContain('調査の結論');

		const tab = r.root.findAll(n => n.props.accessibilityRole === 'tab' && typeof n.props.onPress === 'function')[0];
		act(() => tab.props.onPress());
		expect(allText(r)).toContain('市場を調べる');
		expect(allText(r)).toContain('完了 · 7s');
		expect(allText(r)).not.toContain('画面を描く');
		act(() => r.unmount());
	});
});
