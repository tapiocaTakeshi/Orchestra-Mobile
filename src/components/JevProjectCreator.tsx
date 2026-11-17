/**
 * Jev で Division プロジェクトを作る (コストのタブの「作成」)。
 *
 * プロンプト (作りたいもの) と、エフォート・コスト (1 ロール 1 回あたりの上限)・性能 (ロール別ランキングの
 * スコアの下限) の 3 つの値を Jev に送る。Jev は 3 つの値をそのまま使い、ロールとロールごとのモデルを選び、
 * Division がそのプロジェクトを作る (POST /api/routing/project)。デスクトップのコスト管理・Web のダッシュボードと同じ流れ。
 * PC に接続していなくても使える。作ったら、そのままソーシャルに共有もできる。
 */

import React, { useRef, useState } from 'react';
import { AccessibilityActionEvent, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, ErrorBanner, Icon, Input, Muted, Row, SectionTitle, useToast } from './ui';
import { DivisionSession } from '../lib/divisionAuth';
import {
	DEFAULT_JEV_SLIDERS,
	DivisionRoutingError,
	JEV_COST_STEPS,
	JEV_EFFORTS,
	JEV_EFFORT_LABELS,
	JEV_STANDARD_ROLES,
	JevProjectResult,
	JevSliders,
	createProjectWithJev,
	defaultJevProjectName,
} from '../lib/divisionRouting';
import { publishAssignmentPost } from '../lib/divisionSocial';
import type { PostAssignment } from '../lib/social';
import { roleTitle } from '../lib/format';
import { formatUsd } from '../lib/tuning';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';

const errorText = (e: unknown): string =>
	e instanceof DivisionRoutingError ? e.userMessage : e instanceof Error ? e.message : String(e);

const performanceText = (v: number) => v >= 85 ? '最高性能' : v >= 65 ? '性能を重視' : v >= 40 ? 'バランス' : '料金を重視';
const nearestIndex = (steps: readonly number[], value: number) =>
	steps.reduce((best, v, i) => (Math.abs(v - value) < Math.abs(steps[best] - value) ? i : best), 0);
/** 0〜100 を 5 刻みで */
const PERFORMANCE_STEPS = Array.from({ length: 21 }, (_, i) => i * 5);

const STATUS_TEXT = {
	'below-performance': '上限内に性能の下限を満たすモデルがないため、上限内でいちばん性能の高いモデルにしています',
	'over-budget': '上限に収まるモデルがないため、いちばん安いモデルにしています',
} as const;

/**
 * 段階のあるスライダー。React Native に標準のスライダーは無いので自前で持つ。
 * つまみをドラッグ・トラックをタップ・左右の −/+ で動かせ、読み上げでは「調整可能」として上下スワイプで変えられる。
 */
export const StepSlider = ({ label, valueText, count, index, onChange, left, right, hint }: {
	label: string;
	valueText: string;
	count: number;
	index: number;
	onChange: (index: number) => void;
	left: string;
	right: string;
	hint?: string;
}) => {
	const width = useRef(0);
	const latest = useRef({ count, onChange });
	latest.current = { count, onChange };
	const fromX = (x: number) => {
		const n = latest.current.count;
		if (width.current <= 0 || n < 2) return;
		const ratio = Math.min(1, Math.max(0, x / width.current));
		latest.current.onChange(Math.round(ratio * (n - 1)));
	};
	const pan = useRef(PanResponder.create({
		onStartShouldSetPanResponder: () => true,
		onMoveShouldSetPanResponder: () => true,
		// スクロールにつまみを取られないようにする
		onPanResponderTerminationRequest: () => false,
		onPanResponderGrant: e => fromX(e.nativeEvent.locationX),
		onPanResponderMove: e => fromX(e.nativeEvent.locationX),
	})).current;

	const clamp = (i: number) => Math.min(count - 1, Math.max(0, i));
	const ratio = count > 1 ? index / (count - 1) : 0;
	const onAction = (e: AccessibilityActionEvent) => {
		if (e.nativeEvent.actionName === 'increment') onChange(clamp(index + 1));
		if (e.nativeEvent.actionName === 'decrement') onChange(clamp(index - 1));
	};

	return (
		<View style={styles.slider}>
			<Row style={styles.spread}>
				<Muted>{label}</Muted>
				<Text style={styles.sliderValue}>{valueText}</Text>
			</Row>
			<View style={styles.sliderRow}>
				<Pressable
					accessibilityRole='button'
					accessibilityLabel={`${label}を下げる`}
					disabled={index <= 0}
					onPress={() => onChange(clamp(index - 1))}
					style={[styles.stepButton, index <= 0 && styles.stepButtonDisabled]}
				>
					<Icon name='minus' size={16} color={colors.fg} />
				</Pressable>
				<View
					accessible
					accessibilityRole='adjustable'
					accessibilityLabel={label}
					accessibilityValue={{ text: valueText }}
					accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
					onAccessibilityAction={onAction}
					onLayout={(e: LayoutChangeEvent) => { width.current = e.nativeEvent.layout.width; }}
					style={styles.track}
					{...pan.panHandlers}
				>
					<View style={[styles.trackRail, styles.passThrough]}>
						<View style={[styles.trackFill, { width: `${ratio * 100}%` }]} />
					</View>
					<View style={[styles.thumb, styles.passThrough, { left: `${ratio * 100}%` }]} />
				</View>
				<Pressable
					accessibilityRole='button'
					accessibilityLabel={`${label}を上げる`}
					disabled={index >= count - 1}
					onPress={() => onChange(clamp(index + 1))}
					style={[styles.stepButton, index >= count - 1 && styles.stepButtonDisabled]}
				>
					<Icon name='plus' size={16} color={colors.fg} />
				</Pressable>
			</View>
			<Row style={styles.spread}>
				<Text style={styles.sliderEnd}>{left}</Text>
				{hint ? <Text style={[styles.sliderEnd, styles.sliderHint]}>{hint}</Text> : null}
				<Text style={styles.sliderEnd}>{right}</Text>
			</Row>
		</View>
	);
};

export const JevProjectCreator = ({ session }: { session: DivisionSession }) => {
	const toast = useToast();
	const [goal, setGoal] = useState('');
	const [name, setName] = useState('');
	const [sliders, setSliders] = useState<JevSliders>(DEFAULT_JEV_SLIDERS);
	const [roles, setRoles] = useState<string[]>([...JEV_STANDARD_ROLES]);
	const allRoles = roles.length === JEV_STANDARD_ROLES.length;
	const toggleRole = (slug: string) => {
		if (slug === 'leader') return;
		setRoles(rs => JEV_STANDARD_ROLES.filter(r => (r === slug ? !rs.includes(r) : rs.includes(r))));
	};
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<JevProjectResult | null>(null);
	const [shared, setShared] = useState<'idle' | 'busy' | 'done'>('idle');

	const update = (patch: Partial<JevSliders>) => setSliders(s => ({ ...s, ...patch }));
	const costIdx = nearestIndex(JEV_COST_STEPS, sliders.maxCostUsd);

	const send = async () => {
		setBusy(true); setError(null); setShared('idle');
		try {
			// 全部のままなら roles を送らない (Division が標準ロールを全部入れ、追加ロールを Jev が足す)
			const created = await createProjectWithJev(session, { goal, sliders, name, ...(allRoles ? {} : { roles }) });
			setResult(created);
			toast.show(`「${created.projectName}」を作成しました`);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const share = async () => {
		if (!result?.projectId) return;
		setShared('busy'); setError(null);
		try {
			const assignments: PostAssignment[] = result.assignments.map((a, i) => ({
				priority: i,
				roleSlug: a.roleSlug,
				roleName: a.roleName,
				providerId: a.providerId,
				providerName: a.providerName,
				providerDisplayName: a.providerName,
				model: a.modelId,
				modelDisplayName: a.modelName,
				...(a.effort ? { effort: a.effort } : {}),
			}));
			await publishAssignmentPost(session, {
				title: result.projectName.slice(0, 80),
				description: goal.trim().slice(0, 280),
				assignments,
				sourceProjectId: result.projectId,
			});
			setShared('done');
			toast.show('ソーシャルに共有しました');
		} catch (e) {
			setShared('idle');
			setError(errorText(e));
		}
	};

	return (
		<>
			<Card>
				<SectionTitle>Jev でプロジェクトを作成</SectionTitle>
				<Muted>
					プロンプトとエフォート・コスト・性能を Jev に送ると、Jev は 3 つの値をそのまま使い、ロール別のモデルの
					ランキングを読んでロールとモデルを選び、Division プロジェクトを作ります。
				</Muted>

				<View style={styles.field}>
					<Muted>プロンプト (作りたいもの)</Muted>
					<Input
						value={goal}
						onChangeText={setGoal}
						multiline
						accessibilityLabel='プロンプト'
						placeholder='例: 社内向けの勉強会の申し込みページを作って、管理画面も付けたい'
						style={styles.prompt}
					/>
				</View>

				<StepSlider
					label='エフォート'
					valueText={JEV_EFFORT_LABELS[sliders.effort]}
					count={JEV_EFFORTS.length}
					index={JEV_EFFORTS.indexOf(sliders.effort)}
					onChange={i => update({ effort: JEV_EFFORTS[i] })}
					left='低い'
					right='最大'
					hint='上げると料金も増えます'
				/>
				<StepSlider
					label='コスト (1 ロール 1 回あたりの上限)'
					valueText={`${formatUsd(JEV_COST_STEPS[costIdx], 3)} まで`}
					count={JEV_COST_STEPS.length}
					index={costIdx}
					onChange={i => update({ maxCostUsd: JEV_COST_STEPS[i] })}
					left={formatUsd(JEV_COST_STEPS[0], 3)}
					right={formatUsd(JEV_COST_STEPS[JEV_COST_STEPS.length - 1], 2)}
				/>
				<StepSlider
					label='性能 (ランキングのスコアの下限)'
					valueText={`${performanceText(sliders.minPerformance)}（${sliders.minPerformance} 以上）`}
					count={PERFORMANCE_STEPS.length}
					index={nearestIndex(PERFORMANCE_STEPS, sliders.minPerformance)}
					onChange={i => update({ minPerformance: PERFORMANCE_STEPS[i] })}
					left='料金を重視'
					right='性能を重視'
				/>

				<View style={styles.field}>
					<Muted>ロール</Muted>
					<View style={styles.chips} accessibilityLabel='プロジェクトに入れるロール'>
						{JEV_STANDARD_ROLES.map(slug => {
							const on = roles.includes(slug);
							const locked = slug === 'leader';
							return (
								<Pressable
									key={slug}
									accessibilityRole='checkbox'
									accessibilityLabel={roleTitle(slug)}
									accessibilityHint={locked ? 'リーダーは常に入ります' : undefined}
									accessibilityState={{ checked: on, disabled: locked }}
									disabled={locked}
									onPress={() => toggleRole(slug)}
									style={[styles.chip, on && styles.chipOn]}
								>
									{on ? <Icon name='check' size={14} color={colors.accentText} /> : null}
									<Text style={[styles.chipText, on && styles.chipTextOn]}>{roleTitle(slug)}</Text>
								</Pressable>
							);
						})}
					</View>
					<Muted>
						{allRoles
							? '標準のロールを全部入れます。動画制作などの追加ロールは、目的に要れば Jev が足します。'
							: '選んだロールだけで作ります。'}
					</Muted>
				</View>

				<View style={styles.field}>
					<Muted>プロジェクト名 (空ならプロンプトの 1 行目)</Muted>
					<Input
						value={name}
						onChangeText={setName}
						maxLength={200}
						accessibilityLabel='プロジェクト名'
						placeholder={defaultJevProjectName(goal) || '例: 勉強会の申し込みページ'}
					/>
				</View>

				<Button
					title={result ? 'もう一度 Jev に送って作る' : 'Jev に送って作る'}
					icon='zap'
					loading={busy}
					disabled={!goal.trim()}
					onPress={() => void send()}
				/>
				<Muted>Jev の料金が少額かかります (Plus プラン)。{result ? 'もう一度送ると、別のプロジェクトとして作ります。' : ''}</Muted>
			</Card>

			{error ? <ErrorBanner message={error} /> : null}

			{result ? (
				<Card style={styles.result}>
					<Row style={styles.resultHead}>
						<Icon name='check-circle' size={18} color={colors.success} />
						<Text style={styles.resultTitle}>「{result.projectName}」を作成しました</Text>
					</Row>
					<Muted>
						1 回の実行 約 {formatUsd(result.totalCostUsd, 4)} · {JEV_EFFORT_LABELS[result.sliders.effort]} ·{' '}
						{formatUsd(result.sliders.maxCostUsd, 3)} まで · スコア {result.sliders.minPerformance} 以上 · 平均 {result.averageScore.toFixed(1)}
					</Muted>
					{result.assignments.map(a => (
						<View key={a.roleSlug} style={styles.assignment}>
							<Row style={styles.spread}>
								<Body>{roleTitle(a.roleSlug)}</Body>
								<Text style={styles.cost}>{formatUsd(a.costUsd, 4)}</Text>
							</Row>
							<Muted numberOfLines={1}>{a.modelName} · {a.providerName}</Muted>
							<Muted>
								{a.pickedByJev ? 'Jev が選択 · ' : ''}#{a.rank} · スコア {a.score.toFixed(1)}{a.effort ? ` · ${JEV_EFFORT_LABELS[a.effort]}` : ''}
							</Muted>
							{a.status !== 'ok' ? <Text style={styles.warning}>{STATUS_TEXT[a.status]}</Text> : null}
						</View>
					))}
					<Muted>
						各ロールが 1 回ずつ動いたときの目安です。エフォートによるトークンの増え方は見積もりで、実際の料金は内容で決まります。
						{result.jevCostUsd > 0 ? ` Jev の料金 ${formatUsd(result.jevCostUsd, 4)}。` : ''}
					</Muted>
					<Muted>PC の Orchestra では、Division タブの「Supabase から取得」で一覧に出ます。</Muted>
					{result.projectId ? (
						<Button
							title={shared === 'done' ? 'ソーシャルに共有しました' : 'ソーシャルに共有'}
							variant='secondary'
							icon='share-2'
							loading={shared === 'busy'}
							disabled={shared === 'done'}
							onPress={() => void share()}
						/>
					) : null}
				</Card>
			) : null}
		</>
	);
};

const THUMB = 24;

const styles = StyleSheet.create({
	field: { gap: spacing.xs },
	chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
	chip: {
		flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 36,
		paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
	},
	chipOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, '14') },
	chipText: { color: colors.fgMuted, fontSize: fontSize.sm },
	chipTextOn: { color: colors.fgStrong, fontWeight: '600' },
	prompt: { minHeight: 96, textAlignVertical: 'top' },
	spread: { justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
	slider: { gap: spacing.xs },
	sliderValue: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '700' },
	sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	stepButton: {
		width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
		borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated,
	},
	stepButtonDisabled: { opacity: 0.4 },
	// つまみを掴みやすいよう、見た目のレールより背の高い領域で触れる
	track: { flex: 1, height: 44, justifyContent: 'center', marginHorizontal: THUMB / 2 },
	trackRail: { height: 6, borderRadius: 3, backgroundColor: colors.bgHover, overflow: 'hidden' },
	trackFill: { height: 6, backgroundColor: colors.accent },
	thumb: {
		position: 'absolute', top: (44 - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2,
		marginLeft: -THUMB / 2, backgroundColor: colors.bgElevated, borderWidth: 2, borderColor: colors.accent,
	},
	// レールとつまみはタッチを取らない (触れたのは常にトラック、locationX がトラック基準になる)
	passThrough: { pointerEvents: 'none' },
	sliderEnd: { color: colors.fgFaint, fontSize: fontSize.xs },
	sliderHint: { flex: 1, textAlign: 'center' },
	result: { borderColor: withAlpha(colors.success, '55') },
	resultHead: { alignItems: 'center', gap: spacing.sm },
	resultTitle: { flex: 1, color: colors.success, fontSize: fontSize.sm, fontWeight: '700' },
	assignment: {
		gap: 2, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
	},
	cost: { color: colors.fg, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
	warning: { color: colors.warningText, fontSize: fontSize.xs, borderRadius: radius.sm },
});
