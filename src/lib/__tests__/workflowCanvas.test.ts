import { DivisionWorkflow, insertAfter, layoutWorkflow, normalizeWorkflow } from '../divisionWorkflow';
import {
	HANDLE_Y, NODE_W, canConnect, connectNodes, edgePoints, fitView, hitTest, inPoint, insertIntoEdge, keepPositions, moveNode, outPoint,
	polylineMidpoint, revealNode, toScreen, toWorld, withLayout, zoomAround,
} from '../workflowCanvas';

// start → s1 → s2 → end
const chain = (): DivisionWorkflow => layoutWorkflow(normalizeWorkflow({
	version: 1, enabled: true,
	nodes: [
		{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
		{ id: 's1', type: 'role', position: { x: 0, y: 0 }, data: { role: 'researcher' } },
		{ id: 's2', type: 'role', position: { x: 0, y: 0 }, data: { role: 'coder' } },
		{ id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
	],
	edges: [['start', 's1'], ['s1', 's2'], ['s2', 'end']].map(([source, target], i) => ({ id: `e${i}`, source, target })),
})!);

const at = (w: DivisionWorkflow, id: string) => w.nodes.find(n => n.id === id)!.position;

describe('workflowCanvas', () => {
	it('lays out a workflow without positions and keeps one that has them', () => {
		const w = chain();
		const flat = { ...w, nodes: w.nodes.map(n => ({ ...n, position: { x: 0, y: 0 } })) };
		expect(withLayout(flat).nodes.map(n => n.position.x)).toEqual([0, 270, 540, 810]);
		const moved = moveNode(w, 's1', { x: 301, y: 77 });
		expect(at(moved, 's1')).toEqual({ x: 304, y: 80 });
		expect(withLayout(moved)).toBe(moved);
	});

	it('keeps the positions the user chose when a step is added after a node', () => {
		const w = moveNode(chain(), 's1', { x: 296, y: 200 });
		const next = keepPositions(w, insertAfter(w, 's1', { id: 'new', type: 'role', data: { role: 'writer' } }));
		expect(at(next, 'start')).toEqual(at(w, 'start'));
		expect(at(next, 's1')).toEqual({ x: 296, y: 200 });
		// placed right of s1, at its height; the nodes after it move right
		expect(at(next, 'new')).toEqual({ x: 566, y: 200 });
		expect(at(next, 's2').x).toBeGreaterThan(at(w, 's2').x);
	});

	it('puts a node into a connection', () => {
		const w = chain();
		const edge = w.edges.find(e => e.source === 's1')!;
		const next = insertIntoEdge(w, edge, { id: 'ok', type: 'approval', data: {} });
		expect(next.edges.some(e => e.id === edge.id)).toBe(false);
		expect(next.edges.filter(e => e.source === 's1' || e.target === 's2').map(e => [e.source, e.target])).toEqual([['s1', 'ok'], ['ok', 's2']]);
		expect(at(next, 'ok').x).toBe(at(w, 's1').x + 270);
	});

	it('does not connect into the start, out of the end, twice or into a cycle', () => {
		const w = chain();
		expect(canConnect(w, 's1', 'start')).toBe(false);
		expect(canConnect(w, 'end', 's1')).toBe(false);
		expect(canConnect(w, 's1', 's2')).toBe(false);
		expect(canConnect(w, 's2', 's1')).toBe(false);
		expect(canConnect(w, 'start', 's2')).toBe(true);
		expect(connectNodes(w, 'start', 's2').edges).toHaveLength(4);
		expect(connectNodes(w, 's2', 's1')).toBe(w);
	});

	it('draws connections as right angles and finds their middle', () => {
		expect(edgePoints({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
		expect(edgePoints({ x: 0, y: 0 }, { x: 100, y: 40 })).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 40 }]);
		// backwards: goes around
		const back = edgePoints({ x: 200, y: 0 }, { x: 0, y: 0 });
		expect(back).toHaveLength(6);
		expect(back.every((p, i) => i === 0 || p.x === back[i - 1].x || p.y === back[i - 1].y)).toBe(true);
		expect(polylineMidpoint([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 40 }])).toEqual({ x: 50, y: 20 });
	});

	it('hit-tests handles, cards and connections', () => {
		const w = chain();
		const s1 = at(w, 's1');
		expect(hitTest(w, outPoint(s1), 10)).toEqual({ kind: 'handle', id: 's1' });
		expect(hitTest(w, { x: s1.x + 40, y: s1.y + 40 }, 10)).toEqual({ kind: 'node', id: 's1' });
		const a = outPoint(s1);
		const c = inPoint(at(w, 's2'));
		expect(hitTest(w, { x: (a.x + c.x) / 2, y: s1.y + HANDLE_Y + 2 }, 10)).toEqual({ kind: 'edge', id: w.edges.find(e => e.source === 's1')!.id });
		expect(hitTest(w, { x: s1.x + NODE_W / 2, y: s1.y + 500 }, 10)).toBeNull();
		// the end has no outgoing handle
		expect(hitTest(w, outPoint(at(w, 'end')), 10)).toEqual({ kind: 'node', id: 'end' });
	});

	it('fits the view and zooms around a point', () => {
		const v = fitView(chain(), { w: 400, h: 600 });
		expect(v.zoom).toBeGreaterThanOrEqual(0.7);
		expect(v.zoom).toBeLessThanOrEqual(1);
		const z = zoomAround(v, v.zoom * 2, 100, 100);
		const before = toWorld(v, { x: 100, y: 100 });
		const after = toWorld(z, { x: 100, y: 100 });
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
		expect(toScreen(z, after).x).toBeCloseTo(100);
		expect(zoomAround(v, 100, 0, 0).zoom).toBe(2);
	});

	it('pans a node that is off the board into view', () => {
		const w = chain();
		const s2 = w.nodes.find(n => n.id === 's2')!;
		const size = { w: 400, h: 300 };
		const v = { x: 0, y: 0, zoom: 1 };
		const moved = revealNode(v, { ...s2, position: { x: 900, y: 500 } }, size);
		const p = toScreen(moved, { x: 900, y: 500 });
		expect(p.x).toBeCloseTo(100);
		expect(p.y).toBeCloseTo(110);
		// already visible: unchanged
		expect(revealNode(v, { ...s2, position: { x: 20, y: 20 } }, size)).toBe(v);
	});
});
