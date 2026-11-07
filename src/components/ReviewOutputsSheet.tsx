/**
 * PC のチャットが成果物 (論文・仕様書・デザインなど) の承認で止まっているときに、全文を開いて
 * 見る・直してから承認する (PC のチャットの「編集」→「承認して実行」と同じ)。
 * 編集した内容で承認すると、PC が .division のファイルに書き込み、次の役割はその内容を読む。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { OrchestraApiError } from '../api/client';
import type { ReviewOutputs } from '../api/types';
import { Button, ChipGroup, ErrorBanner, Loading, Muted, Row, Sheet, confirmAction, useToast } from './ui';
import { DocumentView } from './DocumentView';
import { DOCUMENT_KIND_LABEL, documentKindOf, editedOutputsOf, isEdited } from '../lib/divisionDocs';
import { useApp } from '../state/AppContext';
import { spacing } from '../theme';

const errorText = (e: unknown): string => (e instanceof OrchestraApiError ? e.userMessage : String(e));

export const ReviewOutputsSheet = ({ threadId, onClose }: { threadId?: string; onClose: () => void }) => {
	const { client, invalidate } = useApp();
	const toast = useToast();
	const [review, setReview] = useState<ReviewOutputs | null>(null);
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [selected, setSelected] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

	useEffect(() => {
		if (!client) return;
		let cancelled = false;
		void (async () => {
			try {
				const next = await client.getReviewOutputs(threadId);
				if (cancelled) return;
				setReview(next);
				setSelected(next.outputs[0]?.mdFileName ?? null);
			} catch (e) {
				if (!cancelled) setError(e instanceof OrchestraApiError && e.status === 404 ? 'この PC の Orchestra は成果物の編集に対応していません。Orchestra を更新してください。' : errorText(e));
			}
		})();
		return () => { cancelled = true; };
	}, [client, threadId]);

	const edited = useMemo(() => (review ? editedOutputsOf(review, edits) : undefined), [review, edits]);
	const current = review?.outputs.find(o => o.mdFileName === selected) ?? review?.outputs[0];

	const answer = async (kind: 'approve' | 'reject') => {
		if (!client) return;
		setBusy(kind);
		try {
			if (kind === 'approve') await client.approveTool(threadId, edited);
			else await client.rejectTool(threadId);
			toast.show(kind === 'reject' ? '拒否しました' : edited ? '編集した内容で承認しました' : '承認しました', 'success');
			invalidate();
			onClose();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(null);
		}
	};

	const close = async () => {
		if (edited && !(await confirmAction({ title: '編集を破棄しますか?', message: '承認せずに閉じると、ここでの編集は失われます。', confirmLabel: '破棄', destructive: true }))) return;
		onClose();
	};

	return (
		<Sheet title={review?.title ?? '成果物の確認'} eyebrow='承認待ちの成果物' onClose={() => void close()}>
			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
				{error ? <ErrorBanner message={error} /> : null}
				{!review && !error ? <Loading label='成果物を読み込み中…' /> : null}
				{review && current ? (
					<>
						{review.outputs.length > 1 ? (
							<ChipGroup
								options={review.outputs.map(o => ({
									value: o.mdFileName,
									label: `${DOCUMENT_KIND_LABEL[documentKindOf(o.mdFileName)]} · ${o.mdFileName}${edits[o.mdFileName] !== undefined && isEdited(o.content, edits[o.mdFileName]) ? ' ●' : ''}`,
								}))}
								value={current.mdFileName}
								onChange={setSelected}
							/>
						) : null}
						<DocumentView
							key={current.mdFileName}
							name={current.mdFileName}
							value={edits[current.mdFileName] ?? current.content}
							onChangeText={text => setEdits(prev => ({ ...prev, [current.mdFileName]: text }))}
							height={480}
						/>
						<Muted>{edited ? '編集した内容で承認すると、PC のファイル (.division) にも書き込み、次の役割はその内容を読みます。' : '「編集」で直してから承認できます。'}</Muted>
						<Row style={styles.actions}>
							<Button title='拒否' variant='secondary' loading={busy === 'reject'} disabled={!!busy} onPress={() => void answer('reject')} style={styles.flex} />
							<Button title={edited ? '編集して承認' : '承認'} icon='check' loading={busy === 'approve'} disabled={!!busy} onPress={() => void answer('approve')} style={styles.flex} />
						</Row>
					</>
				) : null}
			</ScrollView>
		</Sheet>
	);
};

const styles = StyleSheet.create({
	content: { padding: spacing.lg, gap: spacing.md },
	actions: { gap: spacing.sm },
	flex: { flex: 1 },
});
