/**
 * PC の .division の文書を 1 つ開いて、見る・直して保存する (Sheet)。
 *   - 開いたときに全文を読む。デザインのページは、ページが読む CSS も読んで埋め込む
 *   - PC 側で書き換わったら (スナップショットの documentsRevision が進んだら) 読み直す。
 *     スマホで編集中なら上書きせず、「PC で更新されました」と知らせる
 *   - 保存は開いたときの mtime を付けて送り、その間に PC 側で変わっていれば確認してから上書きする
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { OrchestraApiError } from '../api/client';
import type { RemoteDocument, RemoteDocumentContent } from '../api/types';
import { Button, ErrorBanner, Loading, Muted, Row, Sheet, confirmAction, useToast } from './ui';
import { DocumentMode, DocumentView } from './DocumentView';
import { DOCUMENT_KIND_LABEL, documentTitle, isEdited, isHtmlPath, localStylesheets, resolveRelative } from '../lib/divisionDocs';
import { useApp } from '../state/AppContext';
import { spacing } from '../theme';

const errorText = (e: unknown): string => (e instanceof OrchestraApiError ? e.userMessage : String(e));

export const DocumentSheet = ({ doc, onClose }: { doc: Pick<RemoteDocument, 'path' | 'name' | 'kind'>; onClose: () => void }) => {
	const { client, snapshot, invalidate } = useApp();
	const toast = useToast();
	const [loaded, setLoaded] = useState<RemoteDocumentContent | null>(null);
	const [text, setText] = useState('');
	const [css, setCss] = useState<Record<string, string>>({});
	const [mode, setMode] = useState<DocumentMode>('preview');
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [changedOnPc, setChangedOnPc] = useState(false);
	const dirty = !!loaded && isEdited(loaded.content, text);
	const dirtyRef = useRef(dirty);
	dirtyRef.current = dirty;

	const load = useCallback(async () => {
		if (!client) return;
		try {
			const next = await client.getDocument(doc.path);
			setLoaded(next);
			setText(next.content);
			setChangedOnPc(false);
			setError(null);
			if (isHtmlPath(doc.path)) {
				const sheets: Record<string, string> = {};
				await Promise.all(localStylesheets(next.content).map(async href => {
					try { sheets[href] = (await client.getDocument(resolveRelative(doc.path, href))).content; } catch { /* 読めない CSS は無しで描く */ }
				}));
				setCss(sheets);
			}
		} catch (e) {
			setError(errorText(e));
		}
	}, [client, doc.path]);

	useEffect(() => { void load(); }, [load]);

	// PC 側で .division が変わったら読み直す (編集中なら知らせるだけ)
	const revision = snapshot?.documentsRevision;
	const seenRevision = useRef(revision);
	useEffect(() => {
		if (revision === undefined || revision === seenRevision.current) return;
		seenRevision.current = revision;
		if (!client || saving) return;
		void (async () => {
			try {
				const latest = await client.getDocument(doc.path);
				if (loaded && latest.mtime === loaded.mtime) return;
				if (dirtyRef.current) { setChangedOnPc(true); return; }
				await load();
			} catch { /* 消えた・読めない: 次の変更で */ }
		})();
	}, [revision, client, doc.path, loaded, load, saving]);

	const save = async (force = false) => {
		if (!client || !loaded) return;
		setSaving(true);
		try {
			const saved = await client.saveDocument(doc.path, text, force ? undefined : loaded.mtime);
			setLoaded(saved);
			setChangedOnPc(false);
			setError(null);
			toast.show(`${documentTitle(doc)} を PC に保存しました`, 'success');
			invalidate();
		} catch (e) {
			if (e instanceof OrchestraApiError && e.status === 409) {
				const overwrite = await confirmAction({
					title: 'PC 側で書き換えられています',
					message: '開いたあとで PC (またはエージェント) がこの文書を更新しました。スマホの内容で上書きしますか?',
					confirmLabel: '上書き',
					destructive: true,
				});
				if (overwrite) { setSaving(false); await save(true); return; }
				setChangedOnPc(true);
			} else {
				setError(errorText(e));
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
					<ErrorBanner tone='warning' message='PC 側でこの文書が更新されました。読み直すとスマホでの編集は消えます。' onRetry={() => void load()} />
				) : null}
				{!loaded && !error ? <Loading label='読み込み中…' /> : null}
				{loaded ? (
					<>
						<DocumentView name={doc.path} value={text} onChangeText={setText} mode={mode} onModeChange={setMode} css={css} height={520} />
						<Row style={styles.footer}>
							<Muted>{dirty ? '未保存の変更があります' : 'PC の内容と同じです'}</Muted>
							{dirty ? <Button title='元に戻す' icon='rotate-ccw' variant='ghost' size='sm' onPress={() => setText(loaded.content)} /> : null}
						</Row>
					</>
				) : null}
			</ScrollView>
		</Sheet>
	);
};

const styles = StyleSheet.create({
	content: { padding: spacing.lg, gap: spacing.md },
	footer: { alignItems: 'center', justifyContent: 'space-between' },
});
