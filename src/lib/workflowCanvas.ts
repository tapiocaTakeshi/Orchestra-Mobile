/*--------------------------------------------------------------------------------------
 *  The Dify-style workflow canvas (components/WorkflowCanvasEditor.tsx): geometry and editing
 *  helpers, kept free of React so they can be tested.
 *
 *  Same behaviour as Orchestra's canvas (browser/react/src/workflow-file-tsx/WorkflowCanvas.tsx):
 *  nodes keep the positions the user dragged them to, a node added after another is placed next to
 *  it, a node can be put into a connection, connections never make a cycle (a loop is a loop node).
 *  On the phone everything is hit-tested here from one touch handler, so the cards themselves do
 *  not need to take touches.
 *--------------------------------------------------------------------------------------*/

import { DivisionWorkflow, WorkflowEdge, WorkflowNode, layoutWorkflow, newWorkflowId } from './divisionWorkflow';

export const NODE_W = 200;
/** Where connections leave and enter a card (the middle of its header). */
export const HANDLE_Y = 22;
/** Horizontal room the layout gives a column (the same as layoutWorkflow). */
const COLUMN = 270;
/** Small enough that a long workflow (8+ nodes) fits a phone's width when the whole of it is shown. */
export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 2;

export type Point = { x: number; y: number };
export type CanvasView = { x: number; y: number; zoom: number };

/** A card's height (fixed per type so connections and loop groups can be drawn without measuring). */
export const nodeHeight = (n: WorkflowNode): number => {
	switch (n.type) {
		case 'start': case 'end': return 44;
		case 'loopEnd': case 'approval': case 'parallel': return 62;
		default: return 80;
	}
};

export const reachable = (edges: WorkflowEdge[], from: Iterable<string>): Set<string> => {
	const seen = new Set<string>();
	const stack = [...from];
	while (stack.length) {
		const id = stack.pop()!;
		for (const e of edges) { if (e.source === id && !seen.has(e.target)) { seen.add(e.target); stack.push(e.target); } }
	}
	return seen;
};

/** Nodes without positions (all at 0,0) are laid out; positions already set are kept. */
export const withLayout = (w: DivisionWorkflow): DivisionWorkflow =>
	w.nodes.length > 1 && w.nodes.every(n => n.position.x === 0 && n.position.y === 0) ? layoutWorkflow(w) : w;

/**
 * The editing helpers (insertAfter, removeNode, ...) lay the whole graph out again. Keep the nodes
 * where the user put them: nodes that already existed stay; new nodes are placed next to the node
 * they were added after, and the nodes downstream of them move right to make room.
 */
export const keepPositions = (prev: DivisionWorkflow, next: DivisionWorkflow): DivisionWorkflow => {
	const before = new Map(prev.nodes.map(n => [n.id, n.position]));
	const added = next.nodes.filter(n => !before.has(n.id));
	if (!added.length) {
		return { ...next, nodes: next.nodes.map(n => ({ ...n, position: before.get(n.id) ?? n.position })) };
	}
	const addedIds = new Set(added.map(n => n.id));
	const anchorId = next.edges.find(e => before.has(e.source) && addedIds.has(e.target))?.source;
	if (!anchorId) return next;
	const laid = next.nodes.find(n => n.id === anchorId)!.position;
	const kept = before.get(anchorId)!;
	const dx = kept.x - laid.x;
	const dy = kept.y - laid.y;
	const placed = new Map(added.map(n => [n.id, { x: n.position.x + dx, y: n.position.y + dy }]));
	const shift = Math.max(0, Math.max(...[...placed.values()].map(p => p.x)) - kept.x);
	const downstream = reachable(next.edges, addedIds);
	return {
		...next,
		nodes: next.nodes.map(n => {
			const p = placed.get(n.id);
			if (p) return { ...n, position: p };
			const old = before.get(n.id)!;
			return { ...n, position: downstream.has(n.id) && old.x > kept.x ? { x: old.x + shift, y: old.y } : old };
		}),
	};
};

/** Put a node into a connection (source → node → target), making room to its right if needed. */
export const insertIntoEdge = (w: DivisionWorkflow, edge: WorkflowEdge, node: Omit<WorkflowNode, 'position'>): DivisionWorkflow => {
	const s = w.nodes.find(n => n.id === edge.source);
	const t = w.nodes.find(n => n.id === edge.target);
	if (!s || !t) return w;
	const room = s.position.x + COLUMN * 2 - t.position.x;
	const moved = room > 0 ? new Set([t.id, ...reachable(w.edges, [t.id])]) : new Set<string>();
	return {
		...w,
		nodes: [
			...w.nodes.map(n => (moved.has(n.id) ? { ...n, position: { x: n.position.x + room, y: n.position.y } } : n)),
			{ ...node, position: { x: s.position.x + COLUMN, y: Math.round((s.position.y + t.position.y) / 2) } },
		],
		edges: [
			...w.edges.filter(e => e.id !== edge.id),
			{ id: newWorkflowId('e'), source: s.id, target: node.id },
			{ id: newWorkflowId('e'), source: node.id, target: t.id },
		],
	};
};

/** Whether `from → to` may be added: not into the start, not out of the end, not twice, no cycle. */
export const canConnect = (w: DivisionWorkflow, from: string, to: string): boolean => {
	if (from === to || w.edges.some(e => e.source === from && e.target === to)) return false;
	const source = w.nodes.find(n => n.id === from);
	const target = w.nodes.find(n => n.id === to);
	if (!source || !target || target.type === 'start' || source.type === 'end') return false;
	return !reachable(w.edges, [to]).has(from);
};

export const connectNodes = (w: DivisionWorkflow, from: string, to: string): DivisionWorkflow =>
	canConnect(w, from, to) ? { ...w, edges: [...w.edges, { id: newWorkflowId('e'), source: from, target: to }] } : w;

export const moveNode = (w: DivisionWorkflow, id: string, p: Point, grid = 8): DivisionWorkflow => {
	const snap = (v: number) => Math.round(v / grid) * grid;
	return { ...w, nodes: w.nodes.map(n => (n.id === id ? { ...n, position: { x: snap(p.x), y: snap(p.y) } } : n)) };
};

// ---------------------------------------------------------------------------------------------
// Geometry

export const outPoint = (p: Point): Point => ({ x: p.x + NODE_W, y: p.y + HANDLE_Y });
export const inPoint = (p: Point): Point => ({ x: p.x, y: p.y + HANDLE_Y });

/**
 * A connection as right-angled segments (drawn with plain Views: no SVG on the phone).
 * Forwards: right, down/up, right. Backwards (the target is left of the source): around below.
 */
export const edgePoints = (a: Point, c: Point): Point[] => {
	if (c.x - a.x >= 32) {
		const mx = Math.round((a.x + c.x) / 2);
		return a.y === c.y ? [a, c] : [a, { x: mx, y: a.y }, { x: mx, y: c.y }, c];
	}
	const off = 16;
	const my = Math.abs(a.y - c.y) > 60 ? Math.round((a.y + c.y) / 2) : Math.max(a.y, c.y) + 70;
	return [a, { x: a.x + off, y: a.y }, { x: a.x + off, y: my }, { x: c.x - off, y: my }, { x: c.x - off, y: c.y }, c];
};

/** The point halfway along a polyline (where the "+" / "×" of a connection go). */
export const polylineMidpoint = (pts: Point[]): Point => {
	const lens = pts.slice(1).map((p, i) => Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y));
	let half = lens.reduce((s, l) => s + l, 0) / 2;
	for (let i = 0; i < lens.length; i++) {
		if (half <= lens[i] && lens[i] > 0) {
			const k = half / lens[i];
			return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
		}
		half -= lens[i];
	}
	return pts[pts.length - 1] ?? { x: 0, y: 0 };
};

const distToSegment = (p: Point, a: Point, b: Point): number => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const k = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
	return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
};

export const distToPolyline = (p: Point, pts: Point[]): number =>
	pts.slice(1).reduce((m, b, i) => Math.min(m, distToSegment(p, pts[i], b)), Infinity);

export const workflowBounds = (w: DivisionWorkflow): { x: number; y: number; w: number; h: number } => {
	if (!w.nodes.length) return { x: 0, y: 0, w: NODE_W, h: 100 };
	const x0 = Math.min(...w.nodes.map(n => n.position.x));
	const y0 = Math.min(...w.nodes.map(n => n.position.y));
	const x1 = Math.max(...w.nodes.map(n => n.position.x + NODE_W));
	const y1 = Math.max(...w.nodes.map(n => n.position.y + nodeHeight(n)));
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * Fit the whole workflow into the board (opening the editor, 全体を表示, 整列): every node is on the
 * screen, centred, never larger than 100%. On a phone a long workflow becomes small; pinch or tap a
 * node to read it.
 */
export const fitView = (w: DivisionWorkflow, size: { w: number; h: number }, pad = 24): CanvasView => {
	const b = workflowBounds(w);
	const zoom = clampZoom(Math.min(1, (size.w - pad * 2) / b.w, (size.h - pad * 2) / b.h));
	return { zoom, x: (size.w - b.w * zoom) / 2 - b.x * zoom, y: (size.h - b.h * zoom) / 2 - b.y * zoom };
};

export const clampZoom = (z: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Zoom to `zoom`, keeping the screen point (cx, cy) over the same place of the workflow. */
export const zoomAround = (v: CanvasView, zoom: number, cx: number, cy: number): CanvasView => {
	const z = clampZoom(zoom);
	const k = z / v.zoom;
	return { zoom: z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
};

export const toWorld = (v: CanvasView, p: Point): Point => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom });
export const toScreen = (v: CanvasView, p: Point): Point => ({ x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y });

export type CanvasHit = { kind: 'handle' | 'node' | 'edge'; id: string } | null;

/**
 * What a touch at the workflow point `p` lands on: a node's "+" handle first (it sits on the card's
 * edge), then a card (the one drawn last wins), then a connection. `slop` is in workflow units.
 */
export const hitTest = (w: DivisionWorkflow, p: Point, slop: number, positionOf: (n: WorkflowNode) => Point = n => n.position): CanvasHit => {
	let best: { id: string; d: number } | null = null;
	for (const n of w.nodes) {
		if (n.type === 'end') continue;
		const o = outPoint(positionOf(n));
		const d = Math.hypot(p.x - o.x, p.y - o.y);
		if (d <= slop && (!best || d < best.d)) best = { id: n.id, d };
	}
	if (best) return { kind: 'handle', id: best.id };
	for (let i = w.nodes.length - 1; i >= 0; i--) {
		const n = w.nodes[i];
		const q = positionOf(n);
		if (p.x >= q.x && p.x <= q.x + NODE_W && p.y >= q.y && p.y <= q.y + nodeHeight(n)) return { kind: 'node', id: n.id };
	}
	const byId = new Map(w.nodes.map(n => [n.id, n]));
	let edge: { id: string; d: number } | null = null;
	for (const e of w.edges) {
		const s = byId.get(e.source);
		const t = byId.get(e.target);
		if (!s || !t) continue;
		const d = distToPolyline(p, edgePoints(outPoint(positionOf(s)), inPoint(positionOf(t))));
		if (d <= slop * 0.6 && (!edge || d < edge.d)) edge = { id: e.id, d };
	}
	return edge ? { kind: 'edge', id: edge.id } : null;
};

/** Pan (keeping the zoom) so the node is on the board, centred, when any of it is outside. */
export const revealNode = (v: CanvasView, n: WorkflowNode, size: { w: number; h: number }, pad = 16): CanvasView => {
	const a = toScreen(v, n.position);
	const w = NODE_W * v.zoom;
	const h = nodeHeight(n) * v.zoom;
	if (a.x >= pad && a.y >= pad && a.x + w <= size.w - pad && a.y + h <= size.h - pad) return v;
	return { ...v, x: v.x + (size.w - w) / 2 - a.x, y: v.y + (size.h - h) / 2 - a.y };
};
