/**
 * デザインの HTML ページを見た目で直す (スマホ版の Orchestra Design)。
 *   - プレビューの要素をタップして選ぶ → 下のパネルで文字・色・背景・文字の大きさ・太さ・揃え・余白・角丸を直す
 *   - 親の要素を選ぶ / 複製 / 削除 / インラインのスタイルを戻す
 *   - 「トークン」で :root のデザインシステムの値 (--color-* など) を直す (全画面に効く)
 *   - 元に戻す (このシートを開いてからの変更)
 * 変更はその場で HTML のソースに最小の差分として書き戻す (lib/htmlPatch.ts)。保存は呼び出し側。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ChipGroup, ErrorBanner, Input, Muted, Row, SegmentedControl } from './ui';
import { HtmlPreview } from './HtmlPreview';
import { AiEdit, AiEditPanel } from './AiEditPanel';
import { colors, fontSize, radius, spacing } from '../theme';
import {
	HtmlPatchError,
	ParsedHtml,
	TextPatch,
	applyPatches,
	deleteElement,
	designTokens,
	duplicateElement,
	elementInfo,
	instrumentForPreview,
	parseHtml,
	setAttribute,
	setDesignToken,
	setStyleProperty,
	setTextContent,
} from '../lib/htmlPatch';
import { DesignComputedStyle, designAgentScript, injectIntoHead, parseDesignAgentMessage } from '../lib/designEditorAgent';
import { inlineStylesheets, withViewport } from '../lib/divisionDocs';

const MAX_UNDO = 50;
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** "16px" → 16 (読めなければ null) */
export const pxOf = (v: string | undefined): number | null => {
	const m = /^(-?\d+(?:\.\d+)?)px$/.exec((v ?? '').trim());
	return m ? Number(m[1]) : null;
};

/** 色として表示できそうな値か (スウォッチを出すかどうか) */
export const looksLikeColor = (v: string): boolean => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|[a-z]+$)/i.test(v.trim()) && !/^(inherit|initial|unset|auto|none)$/i.test(v.trim());

/** rgb(1, 2, 3) → #010203 (透明・読めないものはそのまま) */
export const toHex = (v: string): string => {
	const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(v.trim());
	if (!m) return v.trim();
	if (m[4] !== undefined && Number(m[4]) === 0) return 'transparent';
	return `#${[m[1], m[2], m[3]].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
};

type Tab = 'element' | 'tokens';

export const DesignVisualEditor = ({ name, value, onChangeText, css, height = 420, aiEdit, aiEditErrorText }: {
	name: string;
	value: string;
	onChangeText: (text: string) => void;
	/** HTML が読む CSS (href → 中身) */
	css?: Record<string, string>;
	height?: number;
	/** 選んだ要素を、デザインのロール (designer) の AI に直してもらう */
	aiEdit?: AiEdit;
	aiEditErrorText?: (e: unknown) => string;
}) => {
	const doc = useMemo<ParsedHtml>(() => parseHtml(value), [value]);
	const [selected, setSelected] = useState<number | null>(null);
	const [computed, setComputed] = useState<DesignComputedStyle>({});
	const [tab, setTab] = useState<Tab>('element');
	const [error, setError] = useState<string | null>(null);
	const undo = useRef<string[]>([]);
	const [undoCount, setUndoCount] = useState(0);
	// 読み直すとき (編集のたび) に、選んでいた要素とスクロール位置を戻す
	const scrollY = useRef(0);
	const selectedRef = useRef<number | null>(null);
	selectedRef.current = selected;

	// 要素が消えた・数が変わったら選択を外す
	useEffect(() => {
		if (selected !== null && !doc.nodes[selected]) setSelected(null);
	}, [doc, selected]);

	const previewHtml = useMemo(() => {
		const instrumented = instrumentForPreview(doc, { runScripts: false });
		const withAgent = injectIntoHead(instrumented, designAgentScript({ selected: selectedRef.current, scrollY: scrollY.current }));
		return withViewport(inlineStylesheets(withAgent, css ?? {}));
		// 選択だけが変わったときは読み直さない (枠はページの中で動く)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [doc, css]);

	const onMessage = useCallback((raw: unknown) => {
		const m = parseDesignAgentMessage(raw);
		if (!m) return;
		if (m.type === 'scroll') scrollY.current = m.y;
		if (m.type === 'select') {
			setSelected(m.id);
			setComputed(m.computed ?? {});
			setError(null);
			if (m.id !== null) setTab('element');
		}
	}, []);

	const apply = useCallback((make: (d: ParsedHtml) => TextPatch[]) => {
		try {
			const patches = make(doc);
			if (!patches.length) return;
			const next = applyPatches(value, patches);
			if (next === value) return;
			undo.current = [...undo.current, value].slice(-MAX_UNDO);
			setUndoCount(undo.current.length);
			setError(null);
			onChangeText(next);
		} catch (e) {
			setError(e instanceof HtmlPatchError || e instanceof Error ? e.message : String(e));
		}
	}, [doc, value, onChangeText]);

	const undoLast = () => {
		const prev = undo.current.pop();
		setUndoCount(undo.current.length);
		if (prev !== undefined) onChangeText(prev);
	};

	const info = selected !== null ? elementInfo(doc, selected) : undefined;
	const tokens = useMemo(() => designTokens(doc), [doc]);
	const colorTokens = tokens.filter(t => /color|bg|background|accent|primary|surface|text/i.test(t.name) || looksLikeColor(t.value));

	return (
		<View style={styles.root}>
			<HtmlPreview html={previewHtml} style={{ height }} accessibilityLabel={`${name} を見た目で編集`} onMessage={onMessage} />
			<Row style={styles.toolbar}>
				<SegmentedControl
					options={[{ value: 'element', label: '要素' }, { value: 'tokens', label: `トークン${tokens.length ? ` (${tokens.length})` : ''}` }]}
					value={tab}
					onChange={setTab}
					style={styles.flex}
				/>
				<Button title='元に戻す' icon='rotate-ccw' variant='ghost' size='sm' disabled={!undoCount} onPress={undoLast} accessibilityLabel='元に戻す' />
			</Row>
			{error ? <ErrorBanner message={error} style={styles.banner} /> : null}
			{tab === 'tokens' ? (
				<TokensPanel tokens={tokens} onChange={(n, v) => apply(d => setDesignToken(d, n, v))} />
			) : info ? (
				<>
				{aiEdit && doc.nodes[info.id] ? (
					<AiEditPanel
						key={`ai-${info.id}`}
						value={value}
						selection={{ start: doc.nodes[info.id].start, end: doc.nodes[info.id].end }}
						what={`選んだ <${info.tag}> 要素`}
						aiEdit={aiEdit}
						errorText={aiEditErrorText}
						onApply={next => {
							undo.current = [...undo.current, value].slice(-MAX_UNDO);
							setUndoCount(undo.current.length);
							onChangeText(next);
						}}
					/>
				) : null}
				<ElementPanel
					key={info.id}
					info={info}
					computed={computed}
					colorTokens={colorTokens.map(t => t.name)}
					onSelect={setSelected}
					onStyle={(prop, v) => apply(d => setStyleProperty(d, info.id, prop, v))}
					onText={t => apply(d => setTextContent(d, info.id, t))}
					onResetStyle={() => apply(d => setAttribute(d, info.id, 'style', null))}
					onDuplicate={() => apply(d => duplicateElement(d, info.id))}
					onDelete={() => { apply(d => deleteElement(d, info.id)); setSelected(null); }}
				/>
				</>
			) : (
				<Muted>プレビューの文字・ボタン・枠などをタップすると、ここで見た目を直せます。リンクやボタンは押しても動かず、選ぶだけです。</Muted>
			)}
		</View>
	);
};

/** 値を打って確定 (改行・フォーカスが外れたとき) したら onCommit。外から値が変わったら追いかける */
const CommitInput = ({ value, onCommit, placeholder, label, multiline }: {
	value: string;
	onCommit: (v: string) => void;
	placeholder?: string;
	label: string;
	multiline?: boolean;
}) => {
	const [draft, setDraft] = useState(value);
	useEffect(() => { setDraft(value); }, [value]);
	const commit = () => { if (draft !== value) onCommit(draft); };
	return (
		<Input
			value={draft}
			onChangeText={setDraft}
			onEndEditing={commit}
			onSubmitEditing={multiline ? undefined : commit}
			onBlur={commit}
			placeholder={placeholder}
			multiline={multiline}
			autoCapitalize='none'
			autoCorrect={false}
			accessibilityLabel={label}
			style={[styles.input, multiline && styles.multiline]}
		/>
	);
};

const Swatch = ({ color, onPress, label }: { color: string; onPress: () => void; label: string }) => (
	<Pressable onPress={onPress} accessibilityRole='button' accessibilityLabel={label} style={[styles.swatch, { backgroundColor: color }]} />
);

const PRESET_COLORS = ['#ffffff', '#000000', '#1f2937', '#6b7280', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', 'transparent'];

const ColorField = ({ label, value, colorTokens, onChange }: {
	label: string;
	value: string;
	colorTokens: string[];
	onChange: (v: string) => void;
}) => (
	<View style={styles.field}>
		<Row style={styles.fieldHead}>
			<View style={[styles.swatchSmall, { backgroundColor: looksLikeColor(value) ? value : 'transparent' }]} />
			<Text style={styles.fieldLabel}>{label}</Text>
		</Row>
		<CommitInput value={value} onCommit={onChange} label={label} placeholder='#3b82f6 / var(--color-primary)' />
		<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatches}>
			{colorTokens.map(t => (
				<Pressable key={t} onPress={() => onChange(`var(${t})`)} accessibilityRole='button' accessibilityLabel={`${label}: ${t}`} style={styles.tokenChip}>
					<Text style={styles.tokenChipText} numberOfLines={1}>{t.replace(/^--/, '')}</Text>
				</Pressable>
			))}
			{PRESET_COLORS.map(c => <Swatch key={c} color={c} label={`${label}: ${c}`} onPress={() => onChange(c)} />)}
		</ScrollView>
	</View>
);

/** −/＋ で px を増減する (step 刻み) */
const Stepper = ({ label, value, step, min = 0, onChange }: { label: string; value: number | null; step: number; min?: number; onChange: (v: string) => void }) => (
	<Row style={styles.stepper}>
		<Text style={[styles.fieldLabel, styles.flex]}>{label}</Text>
		<Button title='−' variant='secondary' size='sm' accessibilityLabel={`${label}を小さく`} disabled={value === null || value - step < min} onPress={() => value !== null && onChange(`${Math.max(min, value - step)}px`)} />
		<Text style={styles.stepperValue}>{value === null ? '—' : `${Math.round(value * 10) / 10}px`}</Text>
		<Button title='＋' variant='secondary' size='sm' accessibilityLabel={`${label}を大きく`} disabled={value === null} onPress={() => value !== null && onChange(`${value + step}px`)} />
	</Row>
);

const ElementPanel = ({ info, computed, colorTokens, onSelect, onStyle, onText, onResetStyle, onDuplicate, onDelete }: {
	info: NonNullable<ReturnType<typeof elementInfo>>;
	computed: DesignComputedStyle;
	colorTokens: string[];
	onSelect: (id: number) => void;
	onStyle: (prop: string, value: string) => void;
	onText: (text: string) => void;
	onResetStyle: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
}) => {
	const style = info.inlineStyle;
	// 書かれていればインラインの値、無ければ計算済みの値を見せる
	const shown = (prop: keyof DesignComputedStyle) => style[prop] ?? toHex(computed[prop] ?? '');
	const padding = pxOf(computed['padding-top']);
	const ancestors = info.path.filter(p => p.tag !== 'html').slice(-4);
	const structural = info.tag === 'body' || info.tag === 'html' || info.tag === 'head';
	return (
		<View style={styles.panel}>
			<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
				{ancestors.map((p, i) => (
					<Pressable
						key={p.id}
						onPress={() => onSelect(p.id)}
						accessibilityRole='button'
						accessibilityLabel={`<${p.tag}> を選ぶ`}
						style={[styles.crumb, p.id === info.id && styles.crumbActive]}
					>
						<Text style={[styles.crumbText, p.id === info.id && styles.crumbTextActive]}>{i ? '› ' : ''}{p.tag}</Text>
					</Pressable>
				))}
			</ScrollView>
			{info.text !== undefined ? (
				<View style={styles.field}>
					<Text style={styles.fieldLabel}>文字</Text>
					<CommitInput value={info.text} onCommit={onText} label='文字' multiline />
				</View>
			) : (
				<Muted>この要素は中に別の要素があるため、文字は中の要素を選んで直してください。</Muted>
			)}
			<ColorField label='文字の色' value={shown('color')} colorTokens={colorTokens} onChange={v => onStyle('color', v)} />
			<ColorField label='背景' value={shown('background-color')} colorTokens={colorTokens} onChange={v => onStyle('background-color', v)} />
			<Stepper label='文字の大きさ' value={pxOf(style['font-size'] ?? computed['font-size'])} step={1} min={6} onChange={v => onStyle('font-size', v)} />
			<Stepper label='内側の余白' value={pxOf(style['padding'] ?? undefined) ?? padding} step={4} onChange={v => onStyle('padding', v)} />
			<Stepper label='角丸' value={pxOf(style['border-radius'] ?? computed['border-radius'])} step={2} onChange={v => onStyle('border-radius', v)} />
			<View style={styles.field}>
				<Text style={styles.fieldLabel}>太さ</Text>
				<ChipGroup
					options={[{ value: '400', label: '標準' }, { value: '600', label: 'やや太い' }, { value: '700', label: '太字' }]}
					value={(style['font-weight'] ?? computed['font-weight'] ?? '') === 'bold' ? '700' : (style['font-weight'] ?? computed['font-weight'] ?? null)}
					onChange={v => onStyle('font-weight', v)}
				/>
			</View>
			<View style={styles.field}>
				<Text style={styles.fieldLabel}>揃え</Text>
				<ChipGroup
					options={[{ value: 'left', label: '左' }, { value: 'center', label: '中央' }, { value: 'right', label: '右' }]}
					value={(style['text-align'] ?? computed['text-align'] ?? '').replace('start', 'left').replace('end', 'right') || null}
					onChange={v => onStyle('text-align', v)}
				/>
			</View>
			<Row style={styles.actions}>
				<Button title='複製' icon='copy' variant='secondary' size='sm' disabled={structural} onPress={onDuplicate} />
				<Button title='スタイルを戻す' icon='slash' variant='secondary' size='sm' disabled={!Object.keys(style).length} onPress={onResetStyle} />
				<Button title='削除' icon='trash-2' variant='danger' size='sm' disabled={structural} onPress={onDelete} />
			</Row>
		</View>
	);
};

const TokensPanel = ({ tokens, onChange }: { tokens: ReturnType<typeof designTokens>; onChange: (name: string, value: string) => void }) => {
	if (!tokens.length) {
		return <Muted>このページの &lt;style&gt; に :root のトークン (--color-primary など) がありません。</Muted>;
	}
	return (
		<View style={styles.panel}>
			<Muted>デザインシステムの値です。変えると、このページでその値を使っているところがすべて変わります。</Muted>
			{tokens.map(t => (
				<View key={t.name} style={styles.tokenRow}>
					<View style={[styles.swatchSmall, { backgroundColor: looksLikeColor(t.value) ? t.value : 'transparent' }]} />
					<Text style={styles.tokenName} numberOfLines={1}>{t.name}</Text>
					<View style={styles.flex}>
						<CommitInput value={t.value} onCommit={v => onChange(t.name, v)} label={t.name} />
					</View>
				</View>
			))}
		</View>
	);
};

const styles = StyleSheet.create({
	root: { gap: spacing.sm },
	flex: { flex: 1 },
	toolbar: { gap: spacing.sm, alignItems: 'center' },
	banner: { marginVertical: 0 },
	panel: { gap: spacing.sm },
	crumbs: { gap: 4, alignItems: 'center' },
	crumb: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
	crumbActive: { borderColor: colors.accent, backgroundColor: colors.bgElevated },
	crumbText: { color: colors.fgMuted, fontSize: fontSize.xs, fontFamily: MONO },
	crumbTextActive: { color: colors.accent },
	field: { gap: 4 },
	fieldHead: { gap: 6, alignItems: 'center' },
	fieldLabel: { color: colors.fgMuted, fontSize: fontSize.xs + 1 },
	input: { fontSize: fontSize.sm },
	multiline: { minHeight: 64, textAlignVertical: 'top' },
	swatches: { gap: 6, alignItems: 'center', paddingVertical: 2 },
	swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong },
	swatchSmall: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: colors.borderStrong },
	tokenChip: { paddingHorizontal: spacing.sm, height: 26, justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: colors.border, maxWidth: 140 },
	tokenChipText: { color: colors.fg, fontSize: fontSize.xs },
	stepper: { gap: spacing.sm, alignItems: 'center' },
	stepperValue: { minWidth: 56, textAlign: 'center', color: colors.fgStrong, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
	actions: { gap: spacing.sm, flexWrap: 'wrap' },
	tokenRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	tokenName: { width: 120, color: colors.fg, fontSize: fontSize.xs, fontFamily: MONO },
});
