/**
 * 見た目の編集の差分パッチ (PC の Orchestra Design と同じもの + スマホ用の追加)。
 */

import {
	applyPatches,
	deleteElement,
	designTokens,
	duplicateElement,
	elementInfo,
	instrumentForPreview,
	parseHtml,
	setDesignToken,
	setStyleProperty,
	setTextContent,
} from '../htmlPatch';
import { designAgentScript, injectIntoHead, parseDesignAgentMessage } from '../designEditorAgent';

const PAGE = `<!DOCTYPE html>
<html>
<head>
  <style>
    :root { --color-primary: #3b82f6; --space-md: 16px; }
    .btn { color: var(--color-primary); }
  </style>
</head>
<body>
  <h1 class="title">ようこそ</h1>
  <ul>
    <li>A</li>
  </ul>
  <button style="padding: 8px">送信</button>
</body>
</html>
`;

const idOf = (html: string, tag: string) => parseHtml(html).nodes.find(n => n.tag === tag)!.id;
const edit = (html: string, make: (d: ReturnType<typeof parseHtml>) => ReturnType<typeof setTextContent>) => applyPatches(html, make(parseHtml(html)));

describe('htmlPatch', () => {
	it('changes text and inline style with the smallest change', () => {
		const h1 = idOf(PAGE, 'h1');
		const renamed = edit(PAGE, d => setTextContent(d, h1, 'こんにちは & ようこそ'));
		expect(renamed).toContain('<h1 class="title">こんにちは &amp; ようこそ</h1>');
		const styled = edit(renamed, d => setStyleProperty(d, h1, 'color', '#ef4444'));
		expect(styled).toContain('<h1 style="color: #ef4444" class="title">');
		const button = idOf(styled, 'button');
		expect(edit(styled, d => setStyleProperty(d, button, 'padding', '12px'))).toContain('<button style="padding: 12px">送信</button>');
		// Everything else is untouched.
		expect(styled.replace(/<h1[^]*?<\/h1>/, '')).toBe(PAGE.replace(/<h1[^]*?<\/h1>/, ''));
	});

	it('duplicates and deletes an element with its indentation', () => {
		const li = idOf(PAGE, 'li');
		const twice = edit(PAGE, d => duplicateElement(d, li));
		expect(twice).toContain('<ul>\n    <li>A</li>\n    <li>A</li>\n  </ul>');
		const gone = edit(PAGE, d => deleteElement(d, li));
		expect(gone).toContain('<ul>\n  </ul>');
		expect(() => deleteElement(parseHtml(PAGE), idOf(PAGE, 'body'))).toThrow();
	});

	it('reads and changes the :root design tokens', () => {
		const doc = parseHtml(PAGE);
		expect(designTokens(doc).map(t => [t.name, t.value])).toEqual([['--color-primary', '#3b82f6'], ['--space-md', '16px']]);
		const next = edit(PAGE, d => setDesignToken(d, '--color-primary', '#10b981'));
		expect(next).toContain(':root { --color-primary: #10b981; --space-md: 16px; }');
		expect(() => setDesignToken(doc, '--color-primary', 'red; } body {')).toThrow();
		expect(() => setDesignToken(doc, '--nope', '1px')).toThrow();
	});

	it('tells which elements have text that can be edited directly', () => {
		const doc = parseHtml(PAGE);
		expect(elementInfo(doc, idOf(PAGE, 'h1'))!.text).toBe('ようこそ');
		expect(elementInfo(doc, idOf(PAGE, 'ul'))!.text).toBeUndefined();
		expect(elementInfo(doc, idOf(PAGE, 'li'))!.path.map(p => p.tag)).toEqual(['html', 'body', 'ul', 'li']);
	});

	it('puts the selection agent in the preview without touching the saved source', () => {
		const doc = parseHtml(PAGE);
		const preview = injectIntoHead(instrumentForPreview(doc, { runScripts: false }), designAgentScript({ selected: 3, scrollY: 120 }));
		expect(preview).toMatch(/<head data-od-id="\d+"><script data-od-agent>/);
		expect(preview).toContain('"selected":3');
		expect(preview).toContain('<h1 data-od-id=');
		expect(PAGE).not.toContain('data-od-id');
	});
});

describe('parseDesignAgentMessage', () => {
	it('reads the messages from the preview, as a string (native) or an object (web)', () => {
		expect(parseDesignAgentMessage(JSON.stringify({ __od: true, type: 'select', id: 4, computed: { color: 'rgb(0, 0, 0)', bogus: 1 } })))
			.toEqual({ type: 'select', id: 4, computed: { color: 'rgb(0, 0, 0)' } });
		expect(parseDesignAgentMessage({ __od: true, type: 'select', id: null })).toEqual({ type: 'select', id: null, computed: {} });
		expect(parseDesignAgentMessage({ __od: true, type: 'scroll', y: 300 })).toEqual({ type: 'scroll', y: 300 });
		expect(parseDesignAgentMessage({ type: 'select', id: 1 })).toBeNull();
		expect(parseDesignAgentMessage('not json')).toBeNull();
	});
});
