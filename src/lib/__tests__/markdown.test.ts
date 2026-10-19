import { inlineToPlain, parseInline, parseMarkdown } from '../markdown';

describe('parseInline', () => {
	it('太字・斜体・コード・リンク・取り消し線を分ける', () => {
		expect(parseInline('a **b** *c* `d` [e](https://x.y) ~~f~~')).toEqual([
			{ type: 'text', text: 'a ' },
			{ type: 'bold', children: [{ type: 'text', text: 'b' }] },
			{ type: 'text', text: ' ' },
			{ type: 'italic', children: [{ type: 'text', text: 'c' }] },
			{ type: 'text', text: ' ' },
			{ type: 'code', text: 'd' },
			{ type: 'text', text: ' ' },
			{ type: 'link', url: 'https://x.y', children: [{ type: 'text', text: 'e' }] },
			{ type: 'text', text: ' ' },
			{ type: 'strike', children: [{ type: 'text', text: 'f' }] },
		]);
	});

	it('閉じていない記号は文字のまま出す (ストリーミング中)', () => {
		expect(parseInline('**書きかけ')).toEqual([{ type: 'text', text: '**書きかけ' }]);
		expect(parseInline('`code')).toEqual([{ type: 'text', text: '`code' }]);
	});

	it('snake_case や 2 * 3 は斜体にしない', () => {
		expect(inlineToPlain(parseInline('my_var_name'))).toBe('my_var_name');
		expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
		expect(parseInline('foo_bar_baz')).toEqual([{ type: 'text', text: 'foo_bar_baz' }]);
	});

	it('太字の中の斜体', () => {
		expect(parseInline('**a *b* c**')[0]).toEqual({
			type: 'bold',
			children: [{ type: 'text', text: 'a ' }, { type: 'italic', children: [{ type: 'text', text: 'b' }] }, { type: 'text', text: ' c' }],
		});
	});
});

describe('parseMarkdown', () => {
	it('目標ループの出力を見出し・リスト・引用に分ける', () => {
		const blocks = parseMarkdown([
			'## 🎯 目標',
			'',
			'**ログイン画面を直す**',
			'',
			'達成条件:',
			'1. テストが通る',
			'2. 画面が開く',
			'',
			'> 🔁 最大 5 ラウンド繰り返します。',
		].join('\n'));
		expect(blocks.map(b => b.type)).toEqual(['heading', 'paragraph', 'paragraph', 'list', 'quote']);
		const list = blocks[3];
		expect(list.type === 'list' && list.ordered && list.items.map(it => inlineToPlain(it.children))).toEqual(['テストが通る', '画面が開く']);
	});

	it('コードブロックは中身をそのまま持つ。閉じていなければ最後まで', () => {
		expect(parseMarkdown('```ts\nconst a = **1**;\n```\nあと')).toEqual([
			{ type: 'code', lang: 'ts', text: 'const a = **1**;' },
			{ type: 'paragraph', children: [{ type: 'text', text: 'あと' }] },
		]);
		expect(parseMarkdown('```\nline1\nline2')).toEqual([{ type: 'code', lang: '', text: 'line1\nline2' }]);
	});

	it('表と区切り線とチェックリスト', () => {
		const blocks = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\n- [x] done\n- [ ] todo');
		expect(blocks[0].type).toBe('table');
		if (blocks[0].type === 'table') {
			expect(blocks[0].header.map(inlineToPlain)).toEqual(['a', 'b']);
			expect(blocks[0].rows.map(r => r.map(inlineToPlain))).toEqual([['1', '2']]);
		}
		expect(blocks[1]).toEqual({ type: 'rule' });
		expect(blocks[2].type === 'list' && blocks[2].items.map(it => it.checked)).toEqual([true, false]);
	});

	it('続けて書いた行は 1 つの段落にする', () => {
		expect(parseMarkdown('一行目\n二行目')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: '一行目\n二行目' }] }]);
	});
});
