/**
 * ワークフローを Dify のようなキャンバスで編集する全画面のエディタ (チャットの「ワークフローを編集」から開く)。
 *
 * Orchestra の .division/workflow.json のキャンバス (WorkflowCanvas.tsx) と同じ操作をスマホの指で:
 *   - 何もない所をドラッグで移動、2 本指でピンチして拡大・縮小
 *   - ノードはドラッグで動かす / タップで選んで下の欄で編集
 *   - ノード右の「＋」をタップでブロック一覧 (ロール・承認・for / while ループ・並列) から追加、
 *     「＋」をほかのノードまでドラッグするとつなぐ
 *   - 接続をタップで選ぶと真ん中に「＋」(間にブロックを入れる) と「×」(接続を消す)
 *   - ループは中のステップを囲む枠で描く。左下に縮小 / 拡大 / 全体表示 / 整列、右下にミニマップ
 * 保存すると編集したワークフローを onSave に渡す (チャットのワークフロー案に反映され、承認で送られる)。
 * 図は SVG を使わず View だけで描く (接続は直角に折れた線)。タッチはキャンバス 1 枚で受けて当たり判定する。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	GestureResponderEvent, KeyboardAvoidingView, LayoutChangeEvent, Modal, PanResponder, PanResponderGestureState, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorBanner, Icon, IconButton, Input, Muted, confirmAction } from './ui';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';
import {
	DivisionWorkflow, WorkflowEdge, WorkflowNode, WorkflowNodeType, insertAfter, insertLoopAfter, insertParallelAfter, layoutWorkflow, newWorkflowId,
	workflowErrors, workflowLoops, workflowSteps,
} from '../lib/divisionWorkflow';
import {
	CanvasView, HANDLE_Y, NODE_W, Point, canConnect, connectNodes, edgePoints, fitView, hitTest, inPoint, insertIntoEdge, keepPositions, moveNode,
	nodeHeight, outPoint, polylineMidpoint, revealNode, toScreen, toWorld, withLayout, workflowBounds, zoomAround,
} from '../lib/workflowCanvas';
import {
	NODE_COLORS, NODE_ICONS, NODE_TYPE_LABEL, WorkflowNodeEditor, defaultStepRole, nodeSub, nodeTitle, workflowRoleOptions,
} from './WorkflowNodeEditor';

/** 指で押せるように、当たり判定は画面上でこのくらいの半径 (pt) */
const TOUCH_SLOP = 22;
const DOT_GAP = 22;
const MINIMAP = { w: 120, h: 76 };
const HISTORY_LIMIT = 50;

type BlockKind = { kind: 'role'; role: string } | { kind: 'approval' } | { kind: 'for' } | { kind: 'while' } | { kind: 'parallel' };
type Picker = { after?: string; edge?: WorkflowEdge };

type Drag =
	| { kind: 'pan'; vx: number; vy: number; moved: boolean }
	| { kind: 'node'; id: string; ox: number; oy: number; moved: boolean }
	| { kind: 'connect'; from: string; moved: boolean }
	| { kind: 'edge'; id: string; moved: boolean }
	| { kind: 'pinch'; dist: number; cx: number; cy: number; view: CanvasView };

const nodeBody = (n: WorkflowNode): { tag?: string; text?: string } => {
	switch (n.type) {
		case 'role': return { tag: n.data.role, text: n.data.instruction || (n.data.systemPrompt ? 'システムプロンプトあり' : '指示なし') };
		case 'approval': return { text: 'あなたが結果を確認してから次へ' };
		case 'loop': return { text: nodeSub(n) };
		case 'loopEnd': return { text: nodeSub(n) };
		case 'parallel': return { text: nodeSub(n) };
		default: return {};
	}
};

/** 画面に敷く点の格子 (移動に合わせてずらすだけで、描き直さない) */
const DotGrid = React.memo(({ w, h }: { w: number; h: number }) => {
	const cols = Math.ceil(w / DOT_GAP) + 2;
	const rows = Math.ceil(h / DOT_GAP) + 2;
	const dots: React.ReactNode[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) dots.push(<View key={`${r}-${c}`} style={[styles.dot, { left: c * DOT_GAP, top: r * DOT_GAP }]} />);
	}
	return <>{dots}</>;
});
DotGrid.displayName = 'DotGrid';

/** 直角の線を View で描く */
const Polyline = ({ pts, color, width }: { pts: Point[]; color: string; width: number }) => (
	<>
		{pts.slice(1).map((b, i) => {
			const a = pts[i];
			const horizontal = a.y === b.y;
			return (
				<View
					key={i}
					style={{
						position: 'absolute',
						backgroundColor: color,
						left: (horizontal ? Math.min(a.x, b.x) : a.x - width / 2),
						top: (horizontal ? a.y - width / 2 : Math.min(a.y, b.y)),
						width: horizontal ? Math.abs(b.x - a.x) + width / 2 : width,
						height: horizontal ? width : Math.abs(b.y - a.y) + width / 2,
						borderRadius: width / 2,
					}}
				/>
			);
		})}
	</>
);

const BlockPicker = ({ picker, roles, onPick, onClose }: {
	picker: Picker;
	roles: string[];
	onPick: (b: BlockKind) => void;
	onClose: () => void;
}) => {
	const [query, setQuery] = useState('');
	const q = query.trim().toLowerCase();
	const match = (s: string) => !q || s.toLowerCase().includes(q);
	const item = (key: string, type: WorkflowNodeType, label: string, sub: string, b: BlockKind) => {
		if (!match(label) && !match(sub)) return null;
		return (
			<Pressable key={key} accessibilityRole='button' accessibilityLabel={`${label} を追加`} onPress={() => onPick(b)} style={({ pressed }) => [styles.pickItem, pressed && styles.pickItemPressed]}>
				<View style={[styles.nodeIcon, { backgroundColor: NODE_COLORS[type] }]}><Icon name={NODE_ICONS[type]} size={13} color='#fff' /></View>
				<View style={styles.flex}>
					<Text style={styles.pickLabel}>{label}</Text>
					<Text style={styles.pickSub}>{sub}</Text>
				</View>
			</Pressable>
		);
	};
	const roleItems = roles.map(r => item(`r-${r}`, 'role', r, 'ロールのステップ', { kind: 'role', role: r })).filter(Boolean);
	// ループと並列は複数のノードを置くので、接続の間ではなくノードの後ろにだけ
	const logic = [
		item('approval', 'approval', '承認', 'あなたが結果を確認', { kind: 'approval' }),
		...(picker.edge ? [] : [
			item('for', 'loop', 'for ループ', '決まった回数くり返す', { kind: 'for' }),
			item('while', 'loop', 'while ループ', '目標を達成するまでくり返す', { kind: 'while' }),
			item('parallel', 'parallel', '並列', '2 つの分岐を同時に実行', { kind: 'parallel' }),
		]),
	].filter(Boolean);
	return (
		<View style={styles.overlay}>
			<Pressable style={styles.scrim} accessibilityLabel='ブロック一覧を閉じる' onPress={onClose} />
			<View style={styles.pickerSheet} accessibilityLabel='ブロック一覧'>
				<View style={styles.pickerHead}>
					<Text style={styles.pickerTitle}>{picker.edge ? '接続の間に追加' : 'ブロックを追加'}</Text>
					<IconButton icon='x' accessibilityLabel='閉じる' onPress={onClose} />
				</View>
				<Input value={query} onChangeText={setQuery} placeholder='ブロックを検索' accessibilityLabel='ブロックを検索' />
				<ScrollView style={styles.pickerList} keyboardShouldPersistTaps='handled'>
					{roleItems.length ? <Text style={styles.pickHead}>ロール</Text> : null}
					{roleItems}
					{logic.length ? <Text style={styles.pickHead}>ロジック</Text> : null}
					{logic}
					{!roleItems.length && !logic.length ? <Muted>見つかりません</Muted> : null}
				</ScrollView>
			</View>
		</View>
	);
};

export const WorkflowCanvasEditor = ({ workflow: initial, roleOptions, onSave, onClose }: {
	workflow: DivisionWorkflow;
	/** ステップに割り振れるロール (プロジェクトのロール) */
	roleOptions?: string[];
	onSave: (workflow: DivisionWorkflow) => void;
	onClose: () => void;
}) => {
	const [workflow, setWorkflow] = useState<DivisionWorkflow>(() => withLayout(initial));
	const [history, setHistory] = useState<DivisionWorkflow[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
	const [picker, setPicker] = useState<Picker | null>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	const [view, setView] = useState<CanvasView>({ x: 24, y: 24, zoom: 1 });
	const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
	const [wire, setWire] = useState<{ from: string; x: number; y: number; over: string | null } | null>(null);
	const dirty = history.length > 0;

	const options = useMemo(() => workflowRoleOptions(workflow, roleOptions), [workflow, roleOptions]);
	const errors = useMemo(() => workflowErrors(workflow), [workflow]);
	const byId = useMemo(() => new Map(workflow.nodes.map(n => [n.id, n])), [workflow]);
	const selected = selectedId ? byId.get(selectedId) ?? null : null;
	const stepNo = useMemo(() => {
		const m = new Map<string, number>();
		workflowSteps(workflow).forEach((s, i) => { if (!m.has(s.nodeId)) m.set(s.nodeId, i + 1); });
		return m;
	}, [workflow]);
	const loops = useMemo(() => workflowLoops(workflow).loops, [workflow]);

	/** 変更はすべてここを通す (元に戻すの履歴を積む) */
	const typingIn = useRef<string | null>(null);
	const commit = useCallback((next: DivisionWorkflow) => {
		typingIn.current = null;
		setHistory(h => [...h.slice(-(HISTORY_LIMIT - 1)), workflow]);
		setWorkflow(next);
	}, [workflow]);
	/** 編集の補助関数は全体を並べ直すので、ユーザーが置いた位置を保つ */
	const apply = useCallback((next: DivisionWorkflow) => commit(keepPositions(workflow, next)), [commit, workflow]);
	const undo = () => {
		const prev = history[history.length - 1];
		if (!prev) return;
		typingIn.current = null;
		setHistory(h => h.slice(0, -1));
		setWorkflow(prev);
		setSelectedEdge(null);
		if (selectedId && !prev.nodes.some(n => n.id === selectedId)) setSelectedId(null);
	};

	// 最初に大きさが分かったら全体を表示する
	const fitted = useRef(false);
	useEffect(() => {
		if (fitted.current || size.w < 50 || size.h < 50) return;
		fitted.current = true;
		setView(fitView(workflow, size));
	}, [size, workflow]);

	// 選んだノードが編集欄の後ろ (画面の外) に隠れたら、見える所まで動かす
	useEffect(() => {
		const n = selectedId ? workflow.nodes.find(x => x.id === selectedId) : undefined;
		if (n && size.w > 50 && size.h > 50) setView(v => revealNode(v, n, size));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedId, size.w, size.h]);

	const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

	const pick = (b: BlockKind) => {
		const p = picker;
		setPicker(null);
		if (!p) return;
		const node: Omit<WorkflowNode, 'position'> | null =
			b.kind === 'role' ? { id: newWorkflowId('step'), type: 'role', data: { role: b.role, title: b.role } }
				: b.kind === 'approval' ? { id: newWorkflowId('approval'), type: 'approval', data: {} }
					: null;
		if (p.edge && node) {
			commit(insertIntoEdge(workflow, p.edge, node));
			setSelectedEdge(null);
			setSelectedId(node.id);
			return;
		}
		if (!p.after) return;
		if (node) { apply(insertAfter(workflow, p.after, node)); setSelectedId(node.id); return; }
		if (b.kind === 'for' || b.kind === 'while') {
			const next = insertLoopAfter(workflow, p.after, b.kind);
			apply(next);
			const added = next.nodes.find(n => n.type === 'loop' && !byId.has(n.id));
			if (added) setSelectedId(added.id);
			return;
		}
		if (b.kind === 'parallel') apply(insertParallelAfter(workflow, p.after, defaultStepRole(options, /^(search|searcher)$/)));
	};

	// ---- タッチ (キャンバス 1 枚で受けて、当たり判定で振り分ける)
	// PanResponder は 1 度だけ作るので、最新の値は ref から読む
	const live = useRef({ workflow, view, moving, commit, setSelectedId, setSelectedEdge, setPicker });
	live.current = { workflow, view, moving, commit, setSelectedId, setSelectedEdge, setPicker };
	const drag = useRef<Drag | null>(null);
	/** キャンバスの左上の画面上の位置 (タッチの pageX から引く) */
	const origin = useRef({ x: 0, y: 0 });

	const local = (e: GestureResponderEvent): Point => ({ x: e.nativeEvent.pageX - origin.current.x, y: e.nativeEvent.pageY - origin.current.y });
	const touchPair = (e: GestureResponderEvent) => {
		const [a, b] = e.nativeEvent.touches;
		return {
			dist: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
			cx: (a.pageX + b.pageX) / 2 - origin.current.x,
			cy: (a.pageY + b.pageY) / 2 - origin.current.y,
		};
	};

	const responder = useMemo(() => PanResponder.create({
		onStartShouldSetPanResponder: () => true,
		onMoveShouldSetPanResponder: () => true,
		onPanResponderTerminationRequest: () => false,
		onPanResponderGrant: (e: GestureResponderEvent) => {
			const { workflow: w, view: v } = live.current;
			// pageX - locationX = キャンバスの左上 (子は pointerEvents='none' なので、触れたのは常にキャンバス)
			origin.current = { x: e.nativeEvent.pageX - e.nativeEvent.locationX, y: e.nativeEvent.pageY - e.nativeEvent.locationY };
			live.current.setPicker(null);
			const hit = hitTest(w, toWorld(v, local(e)), TOUCH_SLOP / v.zoom);
			const n = hit && hit.kind !== 'edge' ? w.nodes.find(x => x.id === hit.id) : undefined;
			drag.current = hit?.kind === 'handle' ? { kind: 'connect', from: hit.id, moved: false }
				: hit?.kind === 'node' && n ? { kind: 'node', id: n.id, ox: n.position.x, oy: n.position.y, moved: false }
					: hit?.kind === 'edge' ? { kind: 'edge', id: hit.id, moved: false }
						: { kind: 'pan', vx: v.x, vy: v.y, moved: false };
		},
		onPanResponderMove: (e: GestureResponderEvent, g: PanResponderGestureState) => {
			const d = drag.current;
			if (!d) return;
			const { view: v, workflow: w } = live.current;
			// 2 本指: ピンチで拡大・縮小 (指の間を中心に)。始めの 1 本指の操作はやめる
			if (e.nativeEvent.touches.length >= 2) {
				const t = touchPair(e);
				if (d.kind !== 'pinch') {
					setMoving(null);
					setWire(null);
					drag.current = { kind: 'pinch', dist: Math.max(1, t.dist), cx: t.cx, cy: t.cy, view: v };
					return;
				}
				const z = zoomAround(d.view, d.view.zoom * (t.dist / d.dist), d.cx, d.cy);
				setView({ ...z, x: z.x + (t.cx - d.cx), y: z.y + (t.cy - d.cy) });
				return;
			}
			if (d.kind === 'pinch') return;
			const far = Math.abs(g.dx) + Math.abs(g.dy) > 6;
			if (!d.moved && !far) return;
			d.moved = true;
			if (d.kind === 'pan') setView({ ...v, x: d.vx + g.dx, y: d.vy + g.dy });
			else if (d.kind === 'node') setMoving({ id: d.id, x: Math.round(d.ox + g.dx / v.zoom), y: Math.round(d.oy + g.dy / v.zoom) });
			else if (d.kind === 'connect') {
				const p = toWorld(v, local(e));
				const over = hitTest(w, p, 0);
				setWire({ from: d.from, x: p.x, y: p.y, over: over && over.kind !== 'edge' && over.id !== d.from && canConnect(w, d.from, over.id) ? over.id : null });
			}
		},
		onPanResponderRelease: (e: GestureResponderEvent) => {
			const d = drag.current;
			drag.current = null;
			const { workflow: w, view: v, moving: m, commit: save, setSelectedId: select, setSelectedEdge: selectEdge, setPicker: openPicker } = live.current;
			setWire(null);
			if (!d || d.kind === 'pinch') { setMoving(null); return; }
			if (d.kind === 'pan') {
				if (!d.moved) { select(null); selectEdge(null); }
			} else if (d.kind === 'node') {
				if (d.moved && m) save(moveNode(w, d.id, m));
				else { select(d.id); selectEdge(null); }
				setMoving(null);
			} else if (d.kind === 'edge') {
				if (!d.moved) { selectEdge(d.id); select(null); }
			} else {
				// 「＋」をタップ、または何もない所で離したらブロック一覧 (Dify と同じ)、ノードの上で離したらつなぐ
				const over = d.moved ? hitTest(w, toWorld(v, local(e)), 0) : null;
				if (over && over.kind !== 'edge' && over.id !== d.from) { if (canConnect(w, d.from, over.id)) save(connectNodes(w, d.from, over.id)); }
				else openPicker({ after: d.from });
			}
		},
		onPanResponderTerminate: () => { drag.current = null; setMoving(null); setWire(null); },
	}), []);

	// ---- 描くための値
	const pos = (n: WorkflowNode): Point => (moving?.id === n.id ? { x: moving.x, y: moving.y } : n.position);

	const groups = loops.map(l => {
		const members = [l.id, l.endId, ...l.body].map(id => byId.get(id)).filter((n): n is WorkflowNode => !!n);
		if (!members.length) return null;
		const ps = members.map(n => ({ p: pos(n), h: nodeHeight(n) }));
		const x0 = Math.min(...ps.map(({ p }) => p.x)) - 14;
		const y0 = Math.min(...ps.map(({ p }) => p.y)) - 30;
		const x1 = Math.max(...ps.map(({ p }) => p.x + NODE_W)) + 14;
		const y1 = Math.max(...ps.map(({ p, h }) => p.y + h)) + 14;
		const label = `${l.title || (l.kind === 'while' ? 'while ループ' : 'for ループ')} · ${l.kind === 'while' ? `目標まで (最大 ${l.iterations} 回)` : `${l.iterations} 回`}`;
		return { id: l.id, x0, y0, x1, y1, label };
	}).filter((g): g is NonNullable<typeof g> => !!g);

	const edgeLines = workflow.edges.map(e => {
		const s = byId.get(e.source);
		const t = byId.get(e.target);
		if (!s || !t) return null;
		return { e, pts: edgePoints(outPoint(pos(s)), inPoint(pos(t))) };
	}).filter((x): x is NonNullable<typeof x> => !!x);

	const edgeTools = (() => {
		const line = selectedEdge ? edgeLines.find(l => l.e.id === selectedEdge) : undefined;
		return line ? { edge: line.e, at: toScreen(view, polylineMidpoint(line.pts)) } : null;
	})();

	// ミニマップ
	const b = workflowBounds(workflow);
	const viewWorld = { x: -view.x / view.zoom, y: -view.y / view.zoom, w: size.w / view.zoom, h: size.h / view.zoom };
	const mmX0 = Math.min(b.x, viewWorld.x) - 40;
	const mmY0 = Math.min(b.y, viewWorld.y) - 40;
	const mmX1 = Math.max(b.x + b.w, viewWorld.x + viewWorld.w) + 40;
	const mmY1 = Math.max(b.y + b.h, viewWorld.y + viewWorld.h) + 40;
	const mmK = Math.min(MINIMAP.w / (mmX1 - mmX0), MINIMAP.h / (mmY1 - mmY0));

	const zoomBy = (factor: number) => setView(v => zoomAround(v, v.zoom * factor, size.w / 2, size.h / 2));

	const close = async () => {
		if (dirty && !(await confirmAction({ title: '編集を破棄しますか?', message: '保存していない変更は失われます。', confirmLabel: '破棄', destructive: true }))) return;
		onClose();
	};

	return (
		<Modal animationType='slide' presentationStyle='fullScreen' onRequestClose={() => void close()}>
			<SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
				<View style={styles.header}>
					<IconButton icon='x' accessibilityLabel='閉じる' onPress={() => void close()} />
					<View style={styles.flex}>
						<Text accessibilityRole='header' style={styles.headerTitle} numberOfLines={1}>ワークフローを編集</Text>
						<Muted numberOfLines={1}>{`${stepNo.size} ステップ · ${workflow.nodes.length} ノード`}</Muted>
					</View>
					<IconButton icon='rotate-ccw' accessibilityLabel='元に戻す' disabled={!history.length} onPress={undo} />
					<Button title='保存' icon='check' size='sm' onPress={() => onSave(workflow)} />
				</View>
				{errors.length ? <ErrorBanner message={errors.join(' ')} tone='warning' style={styles.banner} /> : null}

				<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
					<View style={styles.board} onLayout={onLayout}>
						<View style={StyleSheet.absoluteFill} {...responder.panHandlers} accessibilityLabel='ワークフローのキャンバス'>
							{/* 点の格子: 移動に合わせてずらす */}
							<View style={[styles.dots, styles.noTouch, { transform: [{ translateX: (view.x % DOT_GAP) - DOT_GAP }, { translateY: (view.y % DOT_GAP) - DOT_GAP }] }]}>
								{size.w ? <DotGrid w={size.w} h={size.h} /> : null}
							</View>
							{/* 図 (大きさ 0 の View を拡大縮小するので、原点は左上) */}
							<View style={[styles.world, styles.noTouch, { transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.zoom }] }]}>
								{groups.map(g => (
									<View key={g.id} style={[styles.group, { left: g.x0, top: g.y0, width: g.x1 - g.x0, height: g.y1 - g.y0 }]}>
										<View style={styles.groupLabel}>
											<Icon name='repeat' size={11} color={NODE_COLORS.loop} />
											<Text style={styles.groupLabelText} numberOfLines={1}>{g.label}</Text>
										</View>
									</View>
								))}
								{edgeLines.map(({ e, pts }) => {
									const on = selectedEdge === e.id;
									const color = on ? colors.accent : withAlpha(colors.fgFaint, 'b3');
									const end = pts[pts.length - 1];
									return (
										<React.Fragment key={e.id}>
											<Polyline pts={pts} color={color} width={on ? 2.4 : 1.6} />
											<View style={[styles.arrow, { left: end.x - 7, top: end.y - 4, borderLeftColor: color }]} />
										</React.Fragment>
									);
								})}
								{wire && byId.get(wire.from) ? (
									<Polyline pts={edgePoints(outPoint(pos(byId.get(wire.from)!)), { x: wire.x, y: wire.y })} color={colors.accent} width={2} />
								) : null}
								{workflow.nodes.map(n => {
									const p = pos(n);
									const color = NODE_COLORS[n.type];
									const isSelected = n.id === selectedId;
									const isTarget = wire?.over === n.id;
									const body = nodeBody(n);
									return (
										<View
											key={n.id}
											accessibilityLabel={`${NODE_TYPE_LABEL[n.type]}: ${nodeTitle(n)}`}
											style={[
												styles.node,
												{ left: p.x, top: p.y, width: NODE_W, height: nodeHeight(n) },
												(isSelected || isTarget) && styles.nodeSelected,
												moving?.id === n.id && styles.nodeMoving,
											]}
										>
											<View style={styles.nodeHead}>
												<View style={[styles.nodeIcon, { backgroundColor: color }]}><Icon name={NODE_ICONS[n.type]} size={13} color='#fff' /></View>
												<Text style={styles.nodeTitle} numberOfLines={1}>{nodeTitle(n)}</Text>
												{stepNo.has(n.id) ? <Text style={styles.nodeNo}>#{stepNo.get(n.id)}</Text> : null}
											</View>
											{body.tag || body.text ? (
												<View style={styles.nodeBody}>
													{body.tag ? <Text style={[styles.tag, { color, borderColor: withAlpha(color, '66') }]} numberOfLines={1}>{body.tag}</Text> : null}
													{body.text ? <Text style={styles.nodeText} numberOfLines={2}>{body.text}</Text> : null}
												</View>
											) : null}
											{n.type !== 'start' ? <View style={[styles.handleIn, { top: HANDLE_Y - 7 }]} /> : null}
											{n.type !== 'end' ? (
												<View style={[styles.handleOut, { top: HANDLE_Y - 10 }]}>
													<Icon name='plus' size={12} color='#fff' />
												</View>
											) : null}
										</View>
									);
								})}
							</View>
						</View>

						{/* 選んだ接続の真ん中: 間に追加 / 消す */}
						{edgeTools ? (
							<View style={[styles.edgeTools, { left: edgeTools.at.x - 38, top: edgeTools.at.y - 16 }]}>
								<Pressable accessibilityRole='button' accessibilityLabel='接続の間にブロックを追加' onPress={() => setPicker({ edge: edgeTools.edge })} style={styles.roundBtn}>
									<Icon name='plus' size={14} color='#fff' />
								</Pressable>
								<Pressable
									accessibilityRole='button'
									accessibilityLabel='接続を削除'
									onPress={() => { commit({ ...workflow, edges: workflow.edges.filter(x => x.id !== edgeTools.edge.id) }); setSelectedEdge(null); }}
									style={[styles.roundBtn, styles.roundBtnDanger]}
								>
									<Icon name='x' size={14} color='#fff' />
								</Pressable>
							</View>
						) : null}

						{/* 左下: 縮小 / 倍率 / 拡大 / 全体表示 / 整列 */}
						<View style={styles.controls}>
							<Pressable accessibilityRole='button' accessibilityLabel='縮小' onPress={() => zoomBy(1 / 1.25)} style={styles.ctrlBtn}><Icon name='minus' size={16} color={colors.fg} /></Pressable>
							<Pressable accessibilityRole='button' accessibilityLabel='100% にする' onPress={() => setView(v => zoomAround(v, 1, size.w / 2, size.h / 2))} style={styles.ctrlZoom}>
								<Text style={styles.ctrlZoomText}>{Math.round(view.zoom * 100)}%</Text>
							</Pressable>
							<Pressable accessibilityRole='button' accessibilityLabel='拡大' onPress={() => zoomBy(1.25)} style={styles.ctrlBtn}><Icon name='plus' size={16} color={colors.fg} /></Pressable>
							<View style={styles.ctrlSep} />
							<Pressable accessibilityRole='button' accessibilityLabel='全体を表示' onPress={() => setView(fitView(workflow, size))} style={styles.ctrlBtn}><Icon name='maximize' size={15} color={colors.fg} /></Pressable>
							<Pressable
								accessibilityRole='button'
								accessibilityLabel='整列 (自動レイアウト)'
								onPress={() => { const laid = layoutWorkflow(workflow); commit(laid); setView(fitView(laid, size)); }}
								style={styles.ctrlBtn}
							>
								<Icon name='layout' size={15} color={colors.fg} />
							</Pressable>
						</View>

						{/* 右下: ミニマップ (タップでそこへ移動) */}
						<Pressable
							accessibilityRole='button'
							accessibilityLabel='ミニマップ'
							onPress={e => {
								const wx = e.nativeEvent.locationX / mmK + mmX0;
								const wy = e.nativeEvent.locationY / mmK + mmY0;
								setView(v => ({ ...v, x: size.w / 2 - wx * v.zoom, y: size.h / 2 - wy * v.zoom }));
							}}
							style={styles.minimap}
						>
							<View style={[StyleSheet.absoluteFill, styles.noTouch]}>
								{workflow.nodes.map(n => {
									const p = pos(n);
									return <View key={n.id} style={{ position: 'absolute', left: (p.x - mmX0) * mmK, top: (p.y - mmY0) * mmK, width: NODE_W * mmK, height: nodeHeight(n) * mmK, borderRadius: 2, backgroundColor: NODE_COLORS[n.type], opacity: 0.75 }} />;
								})}
								<View style={[styles.minimapView, { left: (viewWorld.x - mmX0) * mmK, top: (viewWorld.y - mmY0) * mmK, width: viewWorld.w * mmK, height: viewWorld.h * mmK }]} />
							</View>
						</Pressable>

						{!selected && !picker ? (
							<View style={[styles.hint, styles.noTouch]}>
								<Text style={styles.hintText}>ドラッグで移動・2 本指で拡大縮小。ノードの「＋」をタップで追加、ほかのノードへドラッグでつなぐ。</Text>
							</View>
						) : null}
					</View>

					{/* 選んだノードの編集欄 */}
					{selected ? (
						<View style={styles.panel}>
							<View style={styles.panelHead}>
								<View style={[styles.nodeIcon, { backgroundColor: NODE_COLORS[selected.type] }]}><Icon name={NODE_ICONS[selected.type]} size={13} color='#fff' /></View>
								<Text style={[styles.panelTitle, styles.flex]} numberOfLines={1}>{NODE_TYPE_LABEL[selected.type]} · {nodeTitle(selected)}</Text>
								<IconButton icon='chevron-down' accessibilityLabel='編集欄を閉じる' onPress={() => setSelectedId(null)} />
							</View>
							<ScrollView style={styles.panelBody} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps='handled'>
								<WorkflowNodeEditor
									workflow={workflow}
									selected={selected}
									options={options}
									onChange={next => {
										// 文字の入力 (data だけの変更) は 1 文字ごとに履歴を積まず、ノードごとに 1 回だけ
										if (next.edges === workflow.edges && next.nodes.length === workflow.nodes.length) {
											if (typingIn.current !== selected.id) { setHistory(h => [...h.slice(-(HISTORY_LIMIT - 1)), workflow]); typingIn.current = selected.id; }
											setWorkflow(next);
										} else {
											apply(next);
										}
									}}
									onSelect={setSelectedId}
								/>
							</ScrollView>
						</View>
					) : null}
				</KeyboardAvoidingView>

				{picker ? <BlockPicker picker={picker} roles={options} onPick={pick} onClose={() => setPicker(null)} /> : null}
			</SafeAreaView>
		</Modal>
	);
};

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.bg },
	flex: { flex: 1 },
	noTouch: { pointerEvents: 'none' },
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		paddingHorizontal: spacing.sm,
		minHeight: 56,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	headerTitle: { fontSize: fontSize.md, fontWeight: '600', color: colors.fgStrong },
	banner: { marginHorizontal: spacing.sm, marginTop: spacing.sm },
	board: { flex: 1, overflow: 'hidden', backgroundColor: colors.bgSidebar },
	dots: { position: 'absolute', left: 0, top: 0, right: -DOT_GAP * 2, bottom: -DOT_GAP * 2 },
	dot: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: withAlpha(colors.fgFaint, '55') },
	world: { position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible' },
	group: {
		position: 'absolute',
		borderRadius: radius.lg,
		borderWidth: 1.5,
		borderStyle: 'dashed',
		borderColor: withAlpha(NODE_COLORS.loop, '8c'),
		backgroundColor: withAlpha(NODE_COLORS.loop, '0f'),
	},
	groupLabel: { position: 'absolute', left: 12, top: 7, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
	groupLabelText: { fontSize: 11, fontWeight: '600', color: NODE_COLORS.loop },
	arrow: {
		position: 'absolute',
		width: 0,
		height: 0,
		borderTopWidth: 4,
		borderBottomWidth: 4,
		borderLeftWidth: 7,
		borderTopColor: 'transparent',
		borderBottomColor: 'transparent',
	},
	node: {
		position: 'absolute',
		borderRadius: radius.md,
		borderWidth: 1.5,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
		shadowColor: colors.shadow,
		shadowOpacity: 0.08,
		shadowRadius: 3,
		shadowOffset: { width: 0, height: 1 },
		elevation: 2,
	},
	nodeSelected: { borderColor: colors.accent, borderWidth: 2 },
	nodeMoving: { opacity: 0.9, shadowOpacity: 0.22, shadowRadius: 10, elevation: 8 },
	nodeHead: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 10 },
	nodeIcon: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
	nodeTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.fgStrong },
	nodeNo: { fontSize: 11, color: colors.fgFaint },
	nodeBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 10, marginTop: -6 },
	tag: { fontSize: 10, lineHeight: 16, paddingHorizontal: 6, borderWidth: 1, borderRadius: 5, maxWidth: 84, overflow: 'hidden' },
	nodeText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.fgFaint },
	handleIn: { position: 'absolute', left: -4, width: 4, height: 14, borderRadius: 2, backgroundColor: colors.accent },
	handleOut: {
		position: 'absolute',
		right: -11,
		width: 20,
		height: 20,
		borderRadius: 10,
		backgroundColor: colors.accent,
		borderWidth: 2,
		borderColor: colors.bgElevated,
		alignItems: 'center',
		justifyContent: 'center',
	},
	edgeTools: { position: 'absolute', flexDirection: 'row', gap: 12 },
	roundBtn: {
		width: 32,
		height: 32,
		borderRadius: 16,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.accent,
		shadowColor: colors.shadow,
		shadowOpacity: 0.25,
		shadowRadius: 3,
		shadowOffset: { width: 0, height: 1 },
		elevation: 3,
	},
	roundBtnDanger: { backgroundColor: colors.danger },
	controls: {
		position: 'absolute',
		left: spacing.sm,
		bottom: spacing.sm,
		flexDirection: 'row',
		alignItems: 'center',
		padding: 2,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	ctrlBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
	ctrlZoom: { minWidth: 46, height: 36, alignItems: 'center', justifyContent: 'center' },
	ctrlZoomText: { fontSize: 12, color: colors.fg },
	ctrlSep: { width: StyleSheet.hairlineWidth, height: 18, backgroundColor: colors.borderStrong, marginHorizontal: 2 },
	minimap: {
		position: 'absolute',
		right: spacing.sm,
		bottom: spacing.sm,
		width: MINIMAP.w,
		height: MINIMAP.h,
		overflow: 'hidden',
		borderRadius: 10,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	minimapView: { position: 'absolute', borderWidth: 1, borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, '14') },
	hint: { position: 'absolute', left: spacing.sm, right: spacing.sm, top: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: withAlpha(colors.bgElevated, 'e6') },
	hintText: { fontSize: 11, color: colors.fgMuted },
	panel: { maxHeight: '48%', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg },
	panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs },
	panelTitle: { fontSize: fontSize.sm, fontWeight: '600', color: colors.fgStrong },
	panelBody: { flexGrow: 0 },
	panelContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
	overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
	scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
	pickerSheet: {
		maxHeight: '70%',
		gap: spacing.sm,
		padding: spacing.md,
		borderTopLeftRadius: radius.lg,
		borderTopRightRadius: radius.lg,
		backgroundColor: colors.bgElevated,
	},
	pickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
	pickerTitle: { fontSize: fontSize.sm, fontWeight: '600', color: colors.fgStrong },
	pickerList: { flexGrow: 0 },
	pickHead: { fontSize: 11, fontWeight: '600', color: colors.fgFaint, marginTop: spacing.sm, marginBottom: 4 },
	pickItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.sm },
	pickItemPressed: { backgroundColor: colors.bgHover },
	pickLabel: { fontSize: fontSize.sm, color: colors.fgStrong },
	pickSub: { fontSize: 11, color: colors.fgFaint },
});
