/**
 * PC の .division の文書の一覧 (論文 → 仕様書 → デザイン → 成果物)。押すと DocumentSheet で開く。
 * PC 側で文書が増えたり変わったりしたら (documentsRevision) 読み直す。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { OrchestraApiError } from '../api/client';
import type { RemoteDocument } from '../api/types';
import { EmptyState, ErrorBanner, Icon, Loading, SectionTitle } from './ui';
import { DocumentSheet } from './DocumentSheet';
import { DOCUMENT_KIND_ICON, DOCUMENT_KIND_LABEL, documentTitle, groupDocuments } from '../lib/divisionDocs';
import { relativeTime } from '../lib/format';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

export const DocumentList = () => {
	const { client, snapshot } = useApp();
	const [docs, setDocs] = useState<RemoteDocument[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState<RemoteDocument | null>(null);

	const load = useCallback(async () => {
		if (!client) return;
		try {
			const res = await client.listDocuments();
			setDocs(res.documents);
			setError(null);
		} catch (e) {
			setError(e instanceof OrchestraApiError
				? (e.status === 404 ? 'この PC の Orchestra は文書の表示に対応していません。Orchestra を更新してください。' : e.userMessage)
				: String(e));
		}
	}, [client]);

	const revision = snapshot?.documentsRevision;
	useEffect(() => { void load(); }, [load, revision]);

	if (error && !docs) return <ErrorBanner message={error} onRetry={() => void load()} />;
	if (!docs) return <Loading label='文書を読み込み中…' />;
	if (!docs.length) {
		return (
			<EmptyState
				icon='file-text'
				title='まだ文書がありません'
				detail='Division Project で作業すると、論文 (.division/paper.md)・仕様書 (.division/specification.md)・デザイン (.division/design/) ができ、ここで見て直せます。'
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
			{open ? <DocumentSheet doc={open} onClose={() => { setOpen(null); void load(); }} /> : null}
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
