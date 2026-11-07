/**
 * 危険なコマンドの承認 (GET / POST .../command-approval と command_approval イベント) の補助関数。
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import {
	commandApprovalBody,
	commandApprovalEventText,
	toCloudCommandApproval,
	toCloudCommandApprovalEvent,
} from '../divisionCloud';

describe('command approval', () => {
	it('reads the pending command, or null when nothing waits', () => {
		expect(toCloudCommandApproval({ requestSeq: 7, tool: 'run_command', command: 'rm -rf dist', reason: '再帰的な削除 (rm -r)', role: 'coder' }))
			.toEqual({ requestSeq: 7, tool: 'run_command', command: 'rm -rf dist', reason: '再帰的な削除 (rm -r)', role: 'coder' });
		expect(toCloudCommandApproval({ requestSeq: 3, command: 'git push' })).toEqual({ requestSeq: 3, tool: 'run_command', command: 'git push', reason: '' });
		expect(toCloudCommandApproval(null)).toBeNull();
		expect(toCloudCommandApproval({ command: 'x' })).toBeNull();
	});

	it('sends the feedback only when there is some', () => {
		expect(commandApprovalBody({ requestSeq: 7, action: 'approve' })).toEqual({ requestSeq: 7, action: 'approve' });
		expect(commandApprovalBody({ requestSeq: 7, action: 'deny', feedback: '  PR で出すので不要 ' })).toEqual({ requestSeq: 7, action: 'deny', feedback: 'PR で出すので不要' });
		expect(commandApprovalBody({ requestSeq: 7, action: 'deny', feedback: '   ' })).toEqual({ requestSeq: 7, action: 'deny' });
	});

	it('describes the request and the answer on the timeline', () => {
		const pending = toCloudCommandApprovalEvent({ status: 'pending', command: 'git push', reason: 'git のプッシュ', tool: 'run_command' });
		expect(pending).toEqual({ status: 'pending', command: 'git push', reason: 'git のプッシュ' });
		expect(commandApprovalEventText(pending!)).toBe('⚠️ コマンドの承認待ち: git のプッシュ');
		expect(commandApprovalEventText(toCloudCommandApprovalEvent({ requestSeq: 4, status: 'approved' })!)).toBe('✅ コマンドの実行を許可');
		expect(commandApprovalEventText(toCloudCommandApprovalEvent({ requestSeq: 4, status: 'denied', feedback: '不要' })!)).toBe('⛔ コマンドの実行を拒否: 不要');
		expect(toCloudCommandApprovalEvent({ status: 'weird' })).toBeNull();
	});
});
