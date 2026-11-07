/**
 * .division の文書を 1 つ開いて、見る・直して保存する (Sheet)。既定は PC の文書、source を渡すと
 * クラウドのセッションのサンドボックスの文書 (lib/documentSource.ts)。
 *   - 開いたときに全文を読む。デザインのページは、ページが読む CSS も読んで埋め込む
 *   - 向こうで書き換わったら (source.revision が進んだら) 読み直す。
 *     スマホで編集中なら上書きせず、「PC (クラウド) で更新されました」と知らせる
 *   - 保存は開いたときの mtime を付けて送り、その間に向こうで変わっていれば確認してから上書きする
 *   - ワークフロー (.division/workflow.json) は図のエディタ (WorkflowCanvasEditor) でも直せる
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';
import type { RemoteDocument, RemoteDocumentContent } from '../api/types';
import { Button, ErrorBanner, Input, Loading, Muted, Row, Sheet, confirmAction, useToast } from './ui';
import { DocumentMode, DocumentView } from './DocumentView';
import { DOCUMENT_KIND_LABEL, documentTitle, isEdited, isHtmlPath, localStylesheets, resolveRelative } from '../lib/divisionDocs';
import { DocumentSource, usePcDocumentSource } from '../lib/documentSource';
import { aiEditErrorText } from '../lib/divisionCloud';
import { normalizeWorkflow, workflowErrors, type DivisionWorkflow } from '../lib/divisionWorkflow';
import { WorkflowCanvasEditor } from './WorkflowCanvasEditor';
import { fontSize, spacing } from '../theme';

/** workflow.json の中身を図として読む (読めなければ null) */
const parseWorkflow = (text: string): DivisionWorkflow | null => {
	try { return normalizeWorkflow(JSON.parse(text)); } catch { return null; }
};

export const DocumentSheet = ({ doc, source: given, onClose }: {
	doc: Pick<RemoteDocument, 'path' | 'name' | 'kind'>;
	source?: DocumentSource;
	onClose: () => void;
}) => {
	const pc = usePcDocumentSource();
	const source = given ?? pc;
	const where = source?.where ?? 'PC';
	// The source is rebuilt whenever its revision moves; reading the document again then is the effect below's call.
	const sourceRef = useRef(source);
	sourceRef.current = source;
	const toast = useToast();
	const [loaded, setLoaded] = useState<RemoteDocumentContent | null>(null);
	const [text, setText] = useState('');
	const [css, setCss] = useState<Record<string, string>>({});
	const [mode, setMode] = useState<DocumentMode>('preview');
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [changedOnPc, setChangedOnPc] = useState(false);
	const [canvasOpen, setCanvasOpen] = useState(false);
	const isWorkflow = doc.kind === 'workflow';
	const workflow = useMemo(() => (isWorkflow ? parseWorkflow(text) : null), [isWorkflow, text]);
	const dirty = !!loaded && isEdited(loaded.content, text);
	const dirtyRef = useRef(dirty);
	dirtyRef.current = dirty;

	const load = useCallback(async () => {
		const src = sourceRef.current;
		if (!src) return;
		try {
			const next = await src.get(doc.path);
			setLoaded(next);
			setText(next.content);
			setChangedOnPc(false);
			setError(null);
			if (isHtmlPath(doc.path)) {
				const sheets: Record<string, string> = {};
				await Promise.all(localStylesheets(next.content).map(async href => {
					try { sheets[href] = (await src.get(resolveRelative(doc.path, href))).content; } catch { /* 読めない CSS は無しで描く */ }
				}));
				setCss(sheets);
			}
		} catch (e) {
			setError(src.errorText(e));
		}
	}, [doc.path]);

	useEffect(() => { void load(); }, [load]);

	// 向こうで .division が変わったら読み直す (編集中なら知らせるだけ)
	const revision = source?.revision;
	const seenRevision = useRef(revision);
	useEffect(() => {
		if (revision === undefined || revision === seenRevision.current) return;
		seenRevision.current = revision;
		if (!source || saving) return;
		void (async () => {
			try {
				const latest = await source.get(doc.path);
				if (loaded && latest.mtime === loaded.mtime) return;
				if (dirtyRef.current) { setChangedOnPc(true); return; }
				await load();
			} catch { /* 消えた・読めない: 次の変更で */ }
		})();
	}, [revision, source, doc.path, loaded, load, saving]);

	const save = async (force = false, value = text) => {
		if (!source || !loaded) return;
		setSaving(true);
		try {
			const saved = await source.save(doc.path, value, force ? undefined : loaded.mtime);
			setLoaded(saved);
			setText(saved.content);
			setChangedOnPc(false);
			setError(null);
			toast.show(`${documentTitle(doc)} を${where}に保存しました`, 'success');
			source.onSaved?.();
		} catch (e) {
			if (source.isConflict(e)) {
				const overwrite = await confirmAction({
					title: `${where}側で書き換えられています`,
					message: `開いたあとで${where === 'PC' ? ' PC (またはエージェント) ' : 'エージェント'}がこの文書を更新しました。スマホの内容で上書きしますか?`,
					confirmLabel: '上書き',
					destructive: true,
				});
				if (overwrite) { setSaving(false); await save(true, value); return; }
				setChangedOnPc(true);
			} else {
				setError(source.errorText(e));
			}
		} finally {
			setSaving(false);
		}
	};

	const close = async () => {
		if (dirty && !(await confirmAction({ title: '保存していない変更があります', message: '閉じると変更は失われます。', confirmLabel: '閉じる', destructive: true }))) return;
		onClose();
	};

	return (
		<Sheet
			title={documentTitle(doc)}
			eyebrow={`${DOCUMENT_KIND_LABEL[doc.kind]} · ${doc.path}`}
			onClose={() => void close()}
			headerRight={loaded ? <Button title='保存' icon='save' size='sm' disabled={!dirty} loading={saving} onPress={() => void save()} /> : undefined}
		>
			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
				{error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
				{changedOnPc ? (
					<ErrorBanner tone='warning' message={`${where}側でこの文書が更新されました。読み直すとスマホでの編集は消えます。`} onRetry={() => void load()} />
				) : null}
				{!loaded && !error ? <Loading label='読み込み中…' /> : null}
				{loaded ? (
					<>
						{isWorkflow ? (
							<>
								<Button
									title='図で編集'
									icon='git-branch'
									variant='secondary'
									disabled={!workflow}
									onPress={() => setCanvasOpen(true)}
								/>
								<Muted>
									{!workflow
										? 'ワークフローとして読めません。JSON を直してください。'
										: workflowErrors(workflow).length
											? `このままでは実行できません: ${workflowErrors(workflow).join(' / ')}`
											: `ステップ ${workflow.nodes.filter(n => n.type === 'role').length} 件。図で直して保存すると、次の承認でこのとおりに実行します。`}
								</Muted>
								<Input
									value={text}
									onChangeText={setText}
									multiline
									autoCapitalize='none'
									autoCorrect={false}
									spellCheck={false}
									textAlignVertical='top'
									accessibilityLabel={`${doc.path} を編集`}
									style={styles.json}
								/>
							</>
						) : (
							<DocumentView
								name={doc.path}
								value={text}
								onChangeText={setText}
								mode={mode}
								onModeChange={setMode}
								css={css}
								height={520}
								{...(source?.aiEdit ? {
									aiEdit: req => source.aiEdit!({ ...req, path: doc.path }),
									aiEditErrorText: aiEditErrorText,
								} : {})}
							/>
						)}
						<Row style={styles.footer}>
							<Muted>{dirty ? '未保存の変更があります' : `${where}の内容と同じです`}</Muted>
							{dirty ? <Button title='元に戻す' icon='rotate-ccw' variant='ghost' size='sm' onPress={() => setText(loaded.content)} /> : null}
						</Row>
					</>
				) : null}
			</ScrollView>
			{canvasOpen && workflow ? (
				<WorkflowCanvasEditor
					workflow={workflow}
					onClose={() => setCanvasOpen(false)}
					onSave={next => {
						setCanvasOpen(false);
						const value = `${JSON.stringify(next, null, 2)}\n`;
						setText(value);
						void save(false, value);
					}}
				/>
			) : null}
		</Sheet>
	);
};

const styles = StyleSheet.create({
	content: { padding: spacing.lg, gap: spacing.md },
	footer: { alignItems: 'center', justifyContent: 'space-between' },
	json: { height: 420, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: fontSize.xs },
});
