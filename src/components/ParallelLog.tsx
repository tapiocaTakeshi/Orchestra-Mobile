/**
 * ワークフローの「並列」ノードのチャットログ (```division-parallel ブロック、解析は lib/parallelLog.ts)。
 * 分岐ごとのタブ (状態・経過時間) を横に並べ、選んだ分岐のログをその下に出す。
 * 電話は幅が狭いので、PC のような横並びの列にはせず 1 つずつ切り替える。
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import {
	defaultLaneKey, formatLaneElapsed, isParallelLaneActive, laneElapsedMs, laneLastLine,
	ParallelLane, ParallelLaneStatus, ParallelLog, parallelLogCounts,
} from '../lib/parallelLog';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';

const STATUS_COLOR: Record<ParallelLaneStatus, string> = {
	waiting: colors.fgFaint,
	running: colors.running,
	done: colors.success,
	error: colors.danger,
	stopped: colors.fgMuted,
};

const STATUS_LABEL: Record<ParallelLaneStatus, string> = {
	waiting: '待機中',
	running: '実行中',
	done: '完了',
	error: 'エラー',
	stopped: '停止',
};

const STATUS_ICON: Record<Exclude<ParallelLaneStatus, 'running'>, React.ComponentProps<typeof Feather>['name']> = {
	waiting: 'clock',
	done: 'check',
	error: 'x',
	stopped: 'square',
};

const StatusIcon = ({ status }: { status: ParallelLaneStatus }) =>
	status === 'running'
		? <ActivityIndicator size='small' color={STATUS_COLOR.running} style={styles.spinner} />
		: <Feather name={STATUS_ICON[status]} size={13} color={STATUS_COLOR[status]} />;

/** 動いている分岐がある間だけ 1 秒ごとに描き直す (経過時間のため) */
const useNow = (active: boolean) => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [active]);
	return now;
};

const laneName = (lane: ParallelLane) => `${lane.step > 0 ? `${lane.step}. ` : ''}${lane.role}`;

export const ParallelLogView = <L extends ParallelLane>({ log, renderMarkdown, renderLane, waitingText, note }: {
	log: { v: 1; lanes: L[] } | ParallelLog;
	/** 分岐のログ (lane.text) を Markdown として描く (Markdown 部品から渡す) */
	renderMarkdown?: (text: string) => React.ReactNode;
	/** 分岐の中身を自分で描く (クラウドの会話)。null なら「出力を待っています」などを出す */
	renderLane?: (lane: L) => React.ReactNode;
	/** まだ始まっていない分岐に出す文 */
	waitingText?: string;
	/** 見出しの下の補足 */
	note?: string;
}) => {
	const lanes = log.lanes as L[];
	const counts = parallelLogCounts(log);
	const now = useNow(counts.active > 0);
	const [picked, setPicked] = useState<number | null>(null);
	const selected = lanes.find(l => l.key === picked) ?? lanes.find(l => l.key === defaultLaneKey(log))!;
	const body = renderLane ? renderLane(selected) : selected.text.trim() ? renderMarkdown?.(selected.text) : null;
	const finished = counts.done + counts.error;
	const summary = counts.active > 0
		? `${finished}/${counts.total} 完了`
		: counts.error > 0 ? `${counts.error} 件エラー` : 'すべて完了';
	const elapsed = laneElapsedMs(selected, now);

	return (
		<View style={styles.card} accessibilityLabel={`並列実行 ${counts.total} 分岐 ${summary}`}>
			<View style={styles.header}>
				<Feather name='git-branch' size={14} color={colors.success} />
				<Text style={styles.headerTitle}>並列実行</Text>
				<Text style={styles.headerMeta}>{counts.total} 分岐 · {summary}</Text>
			</View>

			{note ? <Text style={styles.note}>{note}</Text> : null}

			<View style={styles.progress}>
				{lanes.map(l => (
					<View key={l.key} style={[styles.progressPart, !isParallelLaneActive(l.status) && { backgroundColor: STATUS_COLOR[l.status] }]} />
				))}
			</View>

			<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
				{lanes.map(lane => {
					const isSel = lane.key === selected.key;
					const ms = laneElapsedMs(lane, now);
					return (
						<Pressable
							key={lane.key}
							accessibilityRole='tab'
							accessibilityState={{ selected: isSel }}
							accessibilityLabel={`${laneName(lane)} ${lane.title} ${STATUS_LABEL[lane.status]}`}
							onPress={() => setPicked(lane.key)}
							style={({ pressed }) => [
								styles.tab,
								isSel && { borderColor: STATUS_COLOR[lane.status], backgroundColor: withAlpha(STATUS_COLOR[lane.status], '14') },
								pressed && styles.pressed,
							]}
						>
							<StatusIcon status={lane.status} />
							<Text style={[styles.tabName, isSel && styles.tabNameSelected]} numberOfLines={1}>{laneName(lane)}</Text>
							{ms !== undefined && <Text style={styles.tabTime}>{formatLaneElapsed(ms)}</Text>}
						</Pressable>
					);
				})}
			</ScrollView>

			<View style={styles.body}>
				<View style={styles.laneHead}>
					<Text style={styles.laneTitle} numberOfLines={2}>{selected.title || laneName(selected)}</Text>
					<Text style={[styles.laneStatus, { color: STATUS_COLOR[selected.status] }]}>
						{STATUS_LABEL[selected.status]}{elapsed !== undefined ? ` · ${formatLaneElapsed(elapsed)}` : ''}
					</Text>
				</View>
				{body ?? (
					<Text style={styles.empty}>
						{selected.status === 'waiting' ? (waitingText ?? '他の準備が終わるのを待っています…') : selected.status === 'running' ? '出力を待っています…' : '(出力なし)'}
					</Text>
				)}
			</View>

			{/* ほかの分岐の今の 1 行 */}
			{lanes.filter(l => l.key !== selected.key && laneLastLine(l)).map(l => (
				<Pressable key={l.key} onPress={() => setPicked(l.key)} style={({ pressed }) => [styles.preview, pressed && styles.pressed]}>
					<Text style={[styles.previewName, { color: STATUS_COLOR[l.status] }]}>{laneName(l)}</Text>
					<Text style={styles.previewText} numberOfLines={1}>{laneLastLine(l)}</Text>
				</Pressable>
			))}
		</View>
	);
};

const styles = StyleSheet.create({
	card: {
		borderRadius: radius.md,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		borderLeftWidth: 3,
		borderLeftColor: colors.success,
		backgroundColor: colors.bgElevated,
		overflow: 'hidden',
	},
	header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm + 2, paddingBottom: spacing.sm },
	headerTitle: { fontSize: fontSize.xs + 1, fontWeight: '700', color: colors.fgStrong },
	headerMeta: { fontSize: fontSize.xs, color: colors.fgFaint, flexShrink: 1 },
	note: { fontSize: fontSize.xs - 1, color: colors.fgFaint, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, marginTop: -spacing.xs },
	progress: { flexDirection: 'row', height: 2, backgroundColor: colors.border },
	progressPart: { flex: 1 },
	tabs: { gap: spacing.xs + 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
	tab: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs + 2,
		paddingHorizontal: spacing.sm + 2,
		minHeight: 32,
		borderRadius: 999,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
		backgroundColor: colors.bg,
	},
	spinner: { transform: [{ scale: 0.7 }], width: 13, height: 13 },
	tabName: { fontSize: fontSize.xs, color: colors.fgMuted, maxWidth: 160 },
	tabNameSelected: { color: colors.fgStrong, fontWeight: '700' },
	tabTime: { fontSize: fontSize.xs - 1, color: colors.fgFaint, fontVariant: ['tabular-nums'] },
	pressed: { opacity: 0.6 },
	body: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
	laneHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingTop: spacing.sm },
	laneTitle: { flex: 1, fontSize: fontSize.xs + 1, fontWeight: '700', color: colors.fgStrong },
	laneStatus: { fontSize: fontSize.xs - 1, fontVariant: ['tabular-nums'] },
	empty: { fontSize: fontSize.xs + 1, color: colors.fgFaint },
	preview: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, minHeight: 36, alignItems: 'center' },
	previewName: { fontSize: fontSize.xs, fontWeight: '600' },
	previewText: { flex: 1, fontSize: fontSize.xs, color: colors.fgMuted },
});
