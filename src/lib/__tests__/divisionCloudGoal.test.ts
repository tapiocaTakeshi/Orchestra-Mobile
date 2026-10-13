/**
 * クラウドエージェントの目標ループ (goal / review イベント、goalLoop、continueGoal) の補助関数を確認する。
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import {
	CloudSessionEvent,
	createSessionBody,
	messageBody,
	pausedReviewSeq,
	reviewOutcomeLabel,
	toCloudGoal,
	toCloudReview,
	toCloudSession,
} from '../divisionCloud';

const ev = (seq: number, type: CloudSessionEvent['type'], data: Record<string, unknown> = {}): CloudSessionEvent =>
	({ seq, type, data, createdAt: '2026-10-01T00:00:00.000Z' });

describe('goal loop options', () => {
	it('sends goalLoop only when it is a known mode', () => {
		expect(createSessionBody({ prompt: 'p', goalLoop: 'confirm' })).toEqual({ prompt: 'p', goalLoop: 'confirm' });
		expect(createSessionBody({ prompt: 'p' })).toEqual({ prompt: 'p' });
		expect(createSessionBody({ prompt: 'p', goalLoop: 'nope' as never })).toEqual({ prompt: 'p' });
	});

	it('reads goalLoop from the session (old sessions run without it)', () => {
		expect(toCloudSession({ id: 's', goalLoop: 'auto', goalMaxRounds: 5 })).toMatchObject({ goalLoop: 'auto', goalMaxRounds: 5 });
		expect(toCloudSession({ id: 's' })).toMatchObject({ goalLoop: 'off', goalMaxRounds: null });
	});

	it('builds the continueGoal message body', () => {
		expect(messageBody('  more tests  ')).toEqual({ text: 'more tests' });
		expect(messageBody('', { continueGoal: true })).toEqual({ continueGoal: true });
		expect(messageBody(' also docs ', { continueGoal: true })).toEqual({ continueGoal: true, text: 'also docs' });
	});
});

describe('goal / review events', () => {
	it('parses the goal defensively', () => {
		expect(toCloudGoal({ goal: 'g', criteria: ['a', '', 3, 'b'], maxRounds: 5, mode: 'confirm', model: 'L' }))
			.toEqual({ goal: 'g', criteria: ['a', 'b'], maxRounds: 5, mode: 'confirm', model: 'L' });
		expect(toCloudGoal({})).toEqual({ goal: '', criteria: [], maxRounds: null, mode: 'auto', model: '' });
	});

	it('parses reviews and their outcome', () => {
		expect(toCloudReview({ round: 2, status: 'start', model: 'R' })).toEqual({ status: 'start', round: 2, model: 'R', role: '' });
		expect(toCloudReview({ status: 'weird' })).toBeNull();
		const done = toCloudReview({
			round: 1, status: 'done', achieved: false, next: 'continue', maxRounds: 5, summary: 's',
			criteria: [{ index: 1, text: 'a', met: true, reason: 'ok' }, { text: 'b' }, null],
		});
		expect(done).toMatchObject({ status: 'done', achieved: false, next: 'continue', maxRounds: 5 });
		if (done?.status !== 'done') throw new Error('expected a finished review');
		expect(done.criteria).toEqual([{ index: 1, text: 'a', met: true, reason: 'ok' }, { index: 2, text: 'b', met: false, reason: '' }]);
		expect(reviewOutcomeLabel(done)).toBe('未達のため、ラウンド 2/5 に進みます');
		expect(reviewOutcomeLabel({ ...done, next: 'achieved' })).toBe('目標を達成しました (ラウンド 1)');
		expect(reviewOutcomeLabel({ ...done, next: 'paused' })).toBe('目標はまだ達成されていません (ラウンド 1/5 完了)');
		expect(reviewOutcomeLabel({ ...done, next: 'limit' })).toBe('上限の 1 ラウンドで未達のまま終了しました');
		expect(toCloudReview({ status: 'done', next: '???' })).toMatchObject({ next: 'limit' });
	});

	it('finds the paused review that can go on to the next round', () => {
		const base = [ev(1, 'user'), ev(2, 'goal'), ev(3, 'done'), ev(4, 'review', { status: 'start', round: 1 })];
		expect(pausedReviewSeq([...base, ev(5, 'review', { status: 'done', round: 1, next: 'paused' }), ev(6, 'status')])).toBe(5);
		expect(pausedReviewSeq([...base, ev(5, 'review', { status: 'done', round: 1, next: 'continue' })])).toBeNull();
		expect(pausedReviewSeq([...base, ev(5, 'review', { status: 'done', next: 'paused' }), ev(6, 'user', { text: '次のラウンドへ進む' })])).toBeNull();
		expect(pausedReviewSeq(base)).toBeNull();
	});
});
