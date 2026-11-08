/**
 * ワークフローの並列ノードのチャットログ: PC が書く ```division-parallel ブロックを読む。
 */

import { decodeParallelLog, defaultLaneKey, formatLaneElapsed, laneElapsedMs, laneLastLine, parallelLogCounts, PARALLEL_LOG_LANG } from '../parallelLog';
import { parseMarkdown } from '../markdown';

// Orchestra の encodeParallelLog と同じ形
const block = (lanes: object[]) => `前置き\n\n\`\`\`${PARALLEL_LOG_LANG}\n${JSON.stringify({ v: 1, lanes })}\n\`\`\`\n\n後書き`;

describe('parallelLog', () => {
	it('the Markdown parser keeps the block whole, even when a branch wrote code fences', () => {
		const md = block([
			{ key: 2, step: 3, role: 'researcher', title: '調査', status: 'running', startedAt: 1000, text: '## 結果\n```js\nx()\n```\n' },
			{ key: 3, step: 4, role: 'designer', title: '画面', status: 'done', startedAt: 1000, endedAt: 6000, text: 'OK' },
		]);
		const blocks = parseMarkdown(md);
		expect(blocks.map(b => b.type)).toEqual(['paragraph', 'code', 'paragraph']);
		const code = blocks[1] as { type: 'code'; lang: string; text: string };
		expect(code.lang).toBe(PARALLEL_LOG_LANG);
		const log = decodeParallelLog(code.text)!;
		expect(log.lanes.map(l => l.role)).toEqual(['researcher', 'designer']);
		expect(log.lanes[0].text).toBe('## 結果\n```js\nx()\n```\n');
		expect(parallelLogCounts(log)).toEqual({ total: 2, done: 1, error: 0, active: 1 });
		expect(defaultLaneKey(log)).toBe(2);
		expect(laneElapsedMs(log.lanes[0], 4000)).toBe(3000);
		expect(laneElapsedMs(log.lanes[1], 99999)).toBe(5000);
	});

	it('rejects what is not a parallel log and fixes unknown fields', () => {
		expect(decodeParallelLog('{"lanes":')).toBeNull();
		expect(decodeParallelLog('{"lanes":[]}')).toBeNull();
		const log = decodeParallelLog(JSON.stringify({ lanes: [{ role: 'x', status: '???' }] }))!;
		expect(log.lanes[0]).toMatchObject({ key: 0, step: 0, status: 'waiting', text: '' });
	});

	it('elapsed time and the one-line preview', () => {
		expect(formatLaneElapsed(8_400)).toBe('8s');
		expect(formatLaneElapsed(65_000)).toBe('1m 05s');
		expect(formatLaneElapsed(3_720_000)).toBe('1h 02m');
		expect(laneLastLine({ key: 0, step: 1, role: 'r', title: '', status: 'running', text: '# 見出し\n\n**本文**の途中\n' })).toBe('本文の途中');
	});
});
