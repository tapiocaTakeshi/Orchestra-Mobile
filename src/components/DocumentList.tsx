/**
 * .division の文書の一覧 (ワークフロー → 論文 → 仕様書 → デザイン → 成果物)。押すと DocumentSheet で開く。
 * 既定は PC の文書。source を渡すとそこ (クラウドのセッションのサンドボックス) の文書になる。
 * 文書が増えたり変わったりしたら (source.revision) 読み直す。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RemoteDocument } from '../api/types';
import { EmptyState, ErrorBanner, Icon, Loading, SectionTitle } from './ui';
import { DocumentSheet } from './DocumentSheet';
import { DOCUMENT_KIND_ICON, DOCUMENT_KIND_LABEL, documentTitle, groupDocuments } from '../lib/divisionDocs';
import { relativeTime } from '../lib/format';
import { DocumentSource, usePcDocumentSource } from '../lib/documentSource';
import { colors, fontSize, radius, spacing } from '../theme';

export const DocumentList = ({ source: given }: { source?: DocumentSource } = {}) => {
	const pc = usePcDocumentSource();
	const source = given ?? pc;
	const [docs, setDocs] = useState<RemoteDocument[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState<RemoteDocument | null>(null);

	const load = useCallback(async () => {
		if (!source) return;
		try {
			const res = await source.list();
			setDocs(res.documents);
			setError(null);
		} catch (e) {
			setError(source.errorText(e));
		}
	}, [source]);

	const revision = source?.revision;
	useEffect(() => { void load(); }, [load, revision]);

	if (error && !docs) return <ErrorBanner message={error} onRetry={() => void load()} />;
	if (!docs) return <Loading label='文書を読み込み中…' />;
	if (!docs.length) {
		return (
			<EmptyState
				icon='file-text'
				title='まだ文書がありません'
				detail={`Division Project で${source?.where === 'クラウド' ? 'このセッションが' : ''}作業すると、ワークフロー (.division/workflow.json)・論文 (.division/paper.md)・仕様書 (.division/specification.md)・デザイン (.division/design/) ができ、ここで見て直せます。`}
			/>
		);
	}

	return (
		<View style={styles.root}>
			{error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
			{groupDocuments(docs).map(group => (
				<View key={group.kind} style={styles.group}>
					<SectionTitle>{DOCUMENT_KIND_LABEL[group.kind]}</SectionTitle>
					{group.docs.map(doc => (
						<Pressable
							key={doc.path}
							accessibilityRole='button'
							accessibilityLabel={`${documentTitle(doc)} を開く`}
							onPress={() => setOpen(doc)}
							style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
						>
							<View style={styles.icon}><Icon name={DOCUMENT_KIND_ICON[doc.kind]} size={17} color={colors.accentText} /></View>
							<View style={styles.flex}>
								<Text style={styles.title} numberOfLines={1}>{documentTitle(doc)}</Text>
								<Text style={styles.sub} numberOfLines={1}>{doc.path}{doc.mtime ? ` · ${relativeTime(doc.mtime)}` : ''}</Text>
							</View>
							<Icon name='chevron-right' size={16} color={colors.fgFaint} />
						</Pressable>
					))}
				</View>
			))}
			{open ? <DocumentSheet doc={open} source={source ?? undefined} onClose={() => { setOpen(null); void load(); }} /> : null}
		</View>
	);
};

const styles = StyleSheet.create({
	root: { gap: spacing.lg },
	group: { gap: spacing.xs },
	flex: { flex: 1 },
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		paddingVertical: spacing.sm,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.md,
	},
	rowPressed: { backgroundColor: colors.bgHover },
	icon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSidebar },
	title: { fontSize: fontSize.sm, fontWeight: '600', color: colors.fgStrong },
	sub: { fontSize: fontSize.xs, color: colors.fgFaint },
});
