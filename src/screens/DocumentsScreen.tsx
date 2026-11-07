/**
 * 文書のページ: PC の .division にある論文・仕様書・デザイン・各ロールの成果物を見て、直して保存する。
 */

import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Screen, ScreenHeader } from '../components/ui';
import { DocumentList } from '../components/DocumentList';
import { colors, fontSize, spacing } from '../theme';

export const DocumentsScreen = () => (
	<Screen>
		<ScreenHeader title='論文・仕様書・デザイン' />
		<ScrollView contentContainerStyle={styles.content}>
			<Text style={styles.intro}>PC のワークスペースの .division にある文書です。押すと開き、「編集」で直して保存すると PC のファイルに書き込みます。PC 側で更新されるとここにも反映されます。</Text>
			<DocumentList />
		</ScrollView>
	</Screen>
);

const styles = StyleSheet.create({
	content: { padding: spacing.lg, gap: spacing.lg },
	intro: { fontSize: fontSize.xs, color: colors.fgMuted, lineHeight: 18 },
});
