/**
 * エージェントの返答 (Markdown) を、画面に並べられる形に分ける (UI 非依存)。
 *
 * チャットで使われる範囲だけを扱う: 見出し・段落・箇条書き・番号付きリスト・引用・
 * コードブロック・表・区切り線と、行内の太字・斜体・取り消し線・コード・リンク。
 * 書きかけ (ストリーミング中) の文でも崩れないよう、閉じていない記号はそのまま文字として出す。
 */

export type MdInline =
	| { type: 'text'; text: string }
	| { type: 'bold'; children: MdInline[] }
	| { type: 'italic'; children: MdInline[] }
	| { type: 'strike'; children: MdInline[] }
	| { type: 'code'; text: string }
	| { type: 'link'; url: string; children: MdInline[] };

export type MdListItem = { children: MdInline[]; checked?: boolean };

export type MdBlock =
	| { type: 'heading'; level: number; children: MdInline[] }
	| { type: 'paragraph'; children: MdInline[] }
	| { type: 'list'; ordered: boolean; start: number; items: MdListItem[] }
	| { type: 'quote'; blocks: MdBlock[] }
	| { type: 'code'; lang: string; text: string }
	| { type: 'table'; header: MdInline[][]; rows: MdInline[][][] }
	| { type: 'rule' };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

const isTableRow = (line: string) => line.trim().startsWith('|');

const splitRow = (line: string): string[] => {
	let s = line.trim();
	if (s.startsWith('|')) s = s.slice(1);
	if (s.endsWith('|')) s = s.slice(0, -1);
	return s.split('|').map(cell => cell.trim());
};

const startsBlock = (line: string) =>
	HEADING.test(line) || BULLET.test(line) || ORDERED.test(line) || FENCE.test(line) || RULE.test(line) || QUOTE.test(line);

export const parseMarkdown = (source: string): MdBlock[] => {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const blocks: MdBlock[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) { i++; continue; }

		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[1];
			const body: string[] = [];
			i++;
			// 閉じていなければ最後まで (ストリーミング中) をコードとして出す
			while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++]);
			i++;
			blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
			i++;
			continue;
		}

		if (RULE.test(line)) {
			blocks.push({ type: 'rule' });
			i++;
			continue;
		}

		if (QUOTE.test(line)) {
			const body: string[] = [];
			while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])![1]);
			blocks.push({ type: 'quote', blocks: parseMarkdown(body.join('\n')) });
			continue;
		}

		if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
			const header = splitRow(line).map(parseInline);
			i += 2;
			const rows: MdInline[][][] = [];
			while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]).map(parseInline));
			blocks.push({ type: 'table', header, rows });
			continue;
		}

		const bullet = BULLET.exec(line);
		const ordered = ORDERED.exec(line);
		if (bullet || ordered) {
			const isOrdered = !bullet;
			const pattern = isOrdered ? ORDERED : BULLET;
			const items: MdListItem[] = [];
			while (i < lines.length) {
				const m = pattern.exec(lines[i]);
				if (m) {
					const text = isOrdered ? m[2] : m[1];
					const task = TASK.exec(text);
					items.push(task
						? { children: parseInline(task[2]), checked: task[1] !== ' ' }
						: { children: parseInline(text) });
					i++;
				} else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length > 0) {
					// 字下げした続きの行は、直前の項目に足す
					const last = items[items.length - 1];
					last.children = [...last.children, { type: 'text', text: ' ' }, ...parseInline(lines[i].trim())];
					i++;
				} else break;
			}
			blocks.push({ type: 'list', ordered: isOrdered, start: ordered ? Number(ordered[1]) : 1, items });
			continue;
		}

		const body: string[] = [line];
		i++;
		while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !isTableRow(lines[i])) body.push(lines[i++]);
		blocks.push({ type: 'paragraph', children: parseInline(body.join('\n')) });
	}

	return blocks;
};

/** 閉じ記号を探す。見つからなければ -1 (そのときは記号を文字として扱う)。 */
const findClose = (text: string, marker: string, from: number): number => {
	const at = text.indexOf(marker, from);
	return at > from ? at : -1;
};

export const parseInline = (text: string): MdInline[] => {
	const out: MdInline[] = [];
	let buffer = '';
	const flush = () => { if (buffer) { out.push({ type: 'text', text: buffer }); buffer = ''; } };
	let i = 0;

	while (i < text.length) {
		const ch = text[i];

		if (ch === '\\' && i + 1 < text.length && /[\\`*_~[\]()#>|-]/.test(text[i + 1])) {
			buffer += text[i + 1];
			i += 2;
			continue;
		}

		if (ch === '`') {
			const end = text.indexOf('`', i + 1);
			if (end > i) {
				flush();
				out.push({ type: 'code', text: text.slice(i + 1, end) });
				i = end + 1;
				continue;
			}
		}

		if (ch === '[') {
			const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
			if (m) {
				flush();
				out.push({ type: 'link', url: m[2], children: parseInline(m[1]) });
				i += m[0].length;
				continue;
			}
		}

		const two = text.slice(i, i + 2);
		if (two === '**' || two === '__' || two === '~~') {
			const end = findClose(text, two, i + 2);
			if (end > 0) {
				flush();
				out.push({ type: two === '~~' ? 'strike' : 'bold', children: parseInline(text.slice(i + 2, end)) });
				i = end + 2;
				continue;
			}
		}

		// 単語の途中の _ (snake_case) は斜体にしない
		if ((ch === '*' || (ch === '_' && !/\w/.test(text[i - 1] ?? ''))) && text[i + 1] && !/\s/.test(text[i + 1])) {
			const end = findClose(text, ch, i + 1);
			if (end > 0 && !/\s/.test(text[end - 1]) && (ch === '*' || !/\w/.test(text[end + 1] ?? ''))) {
				flush();
				out.push({ type: 'italic', children: parseInline(text.slice(i + 1, end)) });
				i = end + 1;
				continue;
			}
		}

		buffer += ch;
		i++;
	}

	flush();
	return out;
};

/** 読み上げやコピー用に、記号を外した文字だけにする。 */
export const inlineToPlain = (nodes: MdInline[]): string =>
	nodes.map(n => (n.type === 'text' || n.type === 'code' ? n.text : inlineToPlain(n.children))).join('');
