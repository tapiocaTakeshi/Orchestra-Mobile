/**
 * 文書の選んだ部分を、その文書を書くロールの AI に直してもらう (承認つきの編集)。
 *   1. 選んだ部分と「どう直すか」を送る → ロールの AI が書き直した案が返る (まだ文書は変わらない)
 *   2. 変更前 / 変更後を見比べて「適用」すると文書に入る。「破棄」なら何も変わらない
 * 文書の保存・承認は呼び出し側 (いつもどおり)。
 */

import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorBanner, Input, Muted, Row } from './ui';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';
import type { DocumentAiEditProposal, DocumentAiEditRequest } from '../lib/divisionCloud';
import { applyAiEditProposal } from '../lib/divisionCloud';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const PREVIEW_CHARS = 1500;

export type AiEdit = (req: Omit<DocumentAiEditRequest, 'path'>) => Promise<DocumentAiEditProposal>;

const clip = (s: string) => (s.length > PREVIEW_CHARS ? `${s.slice(0, PREVIEW_CHARS)}…(${s.length} 文字)` : s);

export const AiEditPanel = ({ value, selection, what, aiEdit, onApply, errorText }: {
	/** 今の文書 */
	value: string;
	/** 選んでいる範囲 (無ければ「選んでください」を出す) */
	selection: { start: number; end: number } | null;
	/** 選んでいるものの説明 (例: 「<h1> 要素」)。無ければ選んだ文字数 */
	what?: string;
	aiEdit: AiEdit;
	/** 適用した後の文書 */
	onApply: (next: string) => void;
	errorText?: (e: unknown) => string;
}) => {
	const [instruction, setInstruction] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [proposal, setProposal] = useState<DocumentAiEditProposal | null>(null);
	const range = selection && selection.end > selection.start ? selection : null;
	// 別の部分を選び直したら、前の案は捨てる
	useEffect(() => { setError(null); }, [range?.start, range?.end]);

	const ask = async () => {
		if (!range || !instruction.trim() || busy) return;
		setBusy(true);
		setError(null);
		setProposal(null);
		try {
			setProposal(await aiEdit({ start: range.start, end: range.end, selected: value.slice(range.start, range.end), instruction: instruction.trim(), content: value }));
		} catch (e) {
			setError(errorText ? errorText(e) : e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const apply = () => {
		if (!proposal) return;
		const next = applyAiEditProposal(value, proposal);
		if (next === null) {
			setError('提案のあとで、その部分が変わりました。もう一度選んで頼んでください。');
			setProposal(null);
			return;
		}
		onApply(next);
		setProposal(null);
		setInstruction('');
	};

	if (proposal) {
		return (
			<View style={styles.box} accessibilityLabel='AI の提案'>
				<Text style={styles.title}>{proposal.roleName} の提案{proposal.model ? <Text style={styles.model}>  {proposal.model}</Text> : null}</Text>
				<Text style={styles.label}>変更前</Text>
				<Text selectable style={[styles.code, styles.removed]}>{clip(proposal.original) || '(空)'}</Text>
				<Text style={styles.label}>変更後</Text>
				<Text selectable style={[styles.code, styles.added]}>{clip(proposal.replacement) || '(削除)'}</Text>
				<Muted>適用すると編集中の文書に入ります。保存 (承認) するまでサンドボックスの文書は変わりません。</Muted>
				{error ? <ErrorBanner message={error} style={styles.banner} /> : null}
				<Row style={styles.actions}>
					<Button title='適用' icon='check' size='sm' onPress={apply} />
					<Button title='頼み直す' icon='refresh-cw' variant='secondary' size='sm' onPress={() => void ask()} loading={busy} disabled={busy || !range} />
					<Button title='破棄' icon='x' variant='ghost' size='sm' disabled={busy} onPress={() => setProposal(null)} />
				</Row>
			</View>
		);
	}

	return (
		<View style={styles.box}>
			<Text style={styles.title}>AI で直す</Text>
			{range ? (
				<Muted>{what ?? `選んだ ${range.end - range.start} 文字`}を、この文書を書くロールの AI が書き直します。</Muted>
			) : (
				<Muted>直したい部分を選ぶと (コードでは文字を選択、見た目の編集では要素をタップ)、この文書を書くロールの AI に頼めます。</Muted>
			)}
			<Input
				value={instruction}
				onChangeText={setInstruction}
				multiline
				editable={!busy}
				placeholder='どう直すか (例: もっと具体的に / 見出しを短く / ボタンを目立たせて)'
				accessibilityLabel='AI への指示'
				style={styles.instruction}
			/>
			{error ? <ErrorBanner message={error} style={styles.banner} /> : null}
			<Row style={styles.actions}>
				<Button title='AI に頼む' icon='zap' size='sm' loading={busy} disabled={busy || !range || !instruction.trim()} onPress={() => void ask()} />
			</Row>
		</View>
	);
};

const styles = StyleSheet.create({
	box: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: withAlpha(colors.accent, '44'), backgroundColor: withAlpha(colors.accent, '0a') },
	title: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	model: { color: colors.fgFaint, fontSize: fontSize.xs, fontWeight: '400' },
	label: { color: colors.fgMuted, fontSize: fontSize.xs },
	code: { fontFamily: MONO, fontSize: fontSize.xs + 1, lineHeight: 18, padding: spacing.sm, borderRadius: radius.sm },
	removed: { color: colors.fg, backgroundColor: withAlpha(colors.danger, '14'), textDecorationLine: 'line-through' },
	added: { color: colors.fgStrong, backgroundColor: withAlpha(colors.success, '1a') },
	instruction: { minHeight: 56, textAlignVertical: 'top' },
	banner: { marginVertical: 0 },
	actions: { gap: spacing.sm, flexWrap: 'wrap' },
});
