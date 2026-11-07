import {
	DivisionWorkflow, insertAfter, layoutWorkflow, normalizeWorkflow, removeNode, setApprovalAfter, workflowErrors, workflowSteps, workflowToTasks,
} from '../divisionWorkflow';
import { toCloudWorkflowProposal, workflowProposalBody } from '../divisionCloud';
import { workflowColumns } from '../../components/WorkflowReviewCard';

// The leader's draft: start → research → writer → approval → (design | coder) → reviewer → end
const draft = (): DivisionWorkflow => normalizeWorkflow({
	version: 1, enabled: true,
	nodes: [
		{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
		{ id: 's1', type: 'role', position: { x: 0, y: 0 }, data: { role: 'research', title: '調査' } },
		{ id: 's2', type: 'role', position: { x: 0, y: 0 }, data: { role: 'writer', title: '仕様', systemPrompt: '短く' } },
		{ id: 'a2', type: 'approval', position: { x: 0, y: 0 }, data: {} },
		{ id: 's3', type: 'role', position: { x: 0, y: -1 }, data: { role: 'design' } },
		{ id: 's4', type: 'role', position: { x: 0, y: 1 }, data: { role: 'coder' } },
		{ id: 's5', type: 'role', position: { x: 0, y: 0 }, data: { role: 'reviewer' } },
		{ id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
	],
	edges: [['start', 's1'], ['s1', 's2'], ['s2', 'a2'], ['a2', 's3'], ['a2', 's4'], ['s3', 's5'], ['s4', 's5'], ['s5', 'end']].map(([source, target], i) => ({ id: `e${i}`, source, target })),
})!;

describe('divisionWorkflow', () => {
	it('lays the graph out in columns and turns the steps into tasks', () => {
		const w = layoutWorkflow(draft());
		expect(workflowColumns(w).map(col => col.map(n => n.id))).toEqual([['start'], ['s1'], ['s2'], ['a2'], ['s3', 's4'], ['s5'], ['end']]);
		expect(workflowToTasks(w).map(t => [t.role, t.dependsOn, t.approval])).toEqual([
			['research', [], false],
			['writer', ['wf-1'], true],
			['design', ['wf-2'], false],
			['coder', ['wf-2'], false],
			['reviewer', ['wf-3', 'wf-4'], false],
		]);
		expect(workflowSteps(w)[1].systemPrompt).toBe('短く');
	});

	it('edits: approval off, insert, remove (no redundant edges)', () => {
		let w = setApprovalAfter(layoutWorkflow(draft()), 's2', false);
		w = insertAfter(w, 's4', { id: 'new', type: 'role', data: { role: 'coder' } });
		w = removeNode(w, 's3');
		expect(workflowToTasks(w).map(t => [t.role, t.dependsOn])).toEqual([['research', []], ['writer', ['wf-1']], ['coder', ['wf-2']], ['coder', ['wf-3']], ['reviewer', ['wf-4']]]);
		expect(workflowErrors(w)).toEqual([]);
	});
});

describe('cloud workflow proposal', () => {
	it('reads the proposal and builds the answer', () => {
		expect(toCloudWorkflowProposal({ proposalSeq: 7, workflow: draft() })?.proposalSeq).toBe(7);
		expect(toCloudWorkflowProposal({ proposalSeq: 7, workflow: 'x' })).toBeNull();
		expect(toCloudWorkflowProposal(null)).toBeNull();
		expect(workflowProposalBody({ proposalSeq: 7, action: 'approve' })).toEqual({ proposalSeq: 7, action: 'approve' });
		expect(workflowProposalBody({ proposalSeq: 7, action: 'approve', workflow: draft() }).workflow).toBeTruthy();
		expect(workflowProposalBody({ proposalSeq: 7, action: 'revise', feedback: ' 直して ' })).toEqual({ proposalSeq: 7, action: 'revise', feedback: '直して' });
		expect(() => workflowProposalBody({ proposalSeq: 7, action: 'revise', feedback: ' ' })).toThrow();
		const broken = { ...draft(), nodes: draft().nodes.filter(n => n.type !== 'start') };
		expect(() => workflowProposalBody({ proposalSeq: 7, action: 'approve', workflow: broken })).toThrow(/開始/);
	});
});
