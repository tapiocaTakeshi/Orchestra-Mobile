/** 画面全体で使い回す小さな UI 部品。ここ以外でスタイルを書かないようにする。 */

import React from 'react';
import {
	ActivityIndicator,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	TextInputProps,
	View,
	ViewStyle,
} from 'react-native';

import { colors, fontSize, radius, spacing } from '../theme';

export const Screen = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
	<View style={[styles.screen, style]}>{children}</View>
);

export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
	<View style={[styles.card, style]}>{children}</View>
);

export const SectionTitle = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
	<View style={styles.sectionTitleRow}>
		<Text style={styles.sectionTitle}>{children}</Text>
		{right}
	</View>
);

export const Muted = ({ children, style, numberOfLines }: { children: React.ReactNode; style?: object; numberOfLines?: number }) => (
	<Text style={[styles.muted, style]} numberOfLines={numberOfLines}>{children}</Text>
);

export const Title = ({ children }: { children: React.ReactNode }) => (
	<Text style={styles.title}>{children}</Text>
);

export const Body = ({ children, numberOfLines }: { children: React.ReactNode; numberOfLines?: number }) => (
	<Text style={styles.body} numberOfLines={numberOfLines}>{children}</Text>
);

type ButtonProps = {
	title: string;
	onPress: () => void;
	variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
	disabled?: boolean;
	loading?: boolean;
	style?: ViewStyle;
};

export const Button = ({ title, onPress, variant = 'primary', disabled, loading, style }: ButtonProps) => {
	const isDisabled = disabled || loading;
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityState={{ disabled: !!isDisabled }}
			onPress={isDisabled ? undefined : onPress}
			style={({ pressed }) => [
				styles.button,
				variant === 'primary' && styles.buttonPrimary,
				variant === 'secondary' && styles.buttonSecondary,
				variant === 'danger' && styles.buttonDanger,
				variant === 'ghost' && styles.buttonGhost,
				pressed && !isDisabled && styles.buttonPressed,
				isDisabled && styles.buttonDisabled,
				style,
			]}
		>
			{loading
				? <ActivityIndicator color={colors.fg} size='small' />
				: <Text style={[styles.buttonText, variant === 'ghost' && { color: colors.fgMuted }]}>{title}</Text>}
		</Pressable>
	);
};

export const Input = (props: TextInputProps) => (
	<TextInput
		placeholderTextColor={colors.fgFaint}
		{...props}
		style={[styles.input, props.multiline && styles.inputMultiline, props.style]}
	/>
);

export const Badge = ({ label, color = colors.fgFaint }: { label: string; color?: string }) => (
	<View style={[styles.badge, { borderColor: color }]}>
		<Text style={[styles.badgeText, { color }]}>{label}</Text>
	</View>
);

export const Dot = ({ color }: { color: string }) => (
	<View style={[styles.dot, { backgroundColor: color }]} />
);

export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
	<View style={[styles.row, style]}>{children}</View>
);

export const Divider = () => <View style={styles.divider} />;

export const EmptyState = ({ title, detail }: { title: string; detail?: string }) => (
	<View style={styles.empty}>
		<Text style={styles.emptyTitle}>{title}</Text>
		{detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
	</View>
);

export const ErrorBanner = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
	<View style={styles.errorBanner}>
		<Text style={styles.errorText}>{message}</Text>
		{onRetry ? <Button title='再試行' variant='ghost' onPress={onRetry} /> : null}
	</View>
);

/** 選択式のチップ列。優先度やカラムの切り替えに使う。 */
export const ChipGroup = <T extends string>({ options, value, onChange }: {
	options: { value: T; label: string; color?: string }[];
	value: T | null;
	onChange: (v: T) => void;
}) => (
	<View style={styles.chipRow}>
		{options.map(opt => {
			const selected = opt.value === value;
			return (
				<Pressable
					key={opt.value}
					accessibilityRole='button'
					accessibilityState={{ selected }}
					onPress={() => onChange(opt.value)}
					style={[
						styles.chip,
						selected && { borderColor: opt.color ?? colors.accent, backgroundColor: `${opt.color ?? colors.accent}22` },
					]}
				>
					<Text style={[styles.chipText, selected && { color: colors.fg }]}>{opt.label}</Text>
				</Pressable>
			);
		})}
	</View>
);

export const Loading = ({ label }: { label?: string }) => (
	<View style={styles.loading}>
		<ActivityIndicator color={colors.accent} />
		{label ? <Text style={styles.loadingText}>{label}</Text> : null}
	</View>
);

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: colors.bg,
	},
	card: {
		backgroundColor: colors.bgElevated,
		borderColor: colors.border,
		borderWidth: 1,
		borderRadius: radius.md,
		padding: spacing.md,
		gap: spacing.sm,
	},
	sectionTitleRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: spacing.sm,
	},
	sectionTitle: {
		color: colors.fg,
		fontSize: fontSize.md,
		fontWeight: '600',
	},
	title: {
		color: colors.fg,
		fontSize: fontSize.lg,
		fontWeight: '700',
	},
	body: {
		color: colors.fg,
		fontSize: fontSize.sm,
		lineHeight: 19,
	},
	muted: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
	},
	button: {
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm + 2,
		borderRadius: radius.sm,
		alignItems: 'center',
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: 'transparent',
		minHeight: 40,
	},
	buttonPrimary: { backgroundColor: colors.accent },
	buttonSecondary: { backgroundColor: colors.bgElevated, borderColor: colors.borderStrong },
	buttonDanger: { backgroundColor: colors.danger },
	buttonGhost: { backgroundColor: 'transparent' },
	buttonPressed: { opacity: 0.75 },
	buttonDisabled: { opacity: 0.4 },
	buttonText: {
		color: '#ffffff',
		fontSize: fontSize.sm,
		fontWeight: '600',
	},
	input: {
		backgroundColor: colors.bgInput,
		borderColor: colors.border,
		borderWidth: 1,
		borderRadius: radius.sm,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm + 2,
		color: colors.fg,
		fontSize: fontSize.sm,
	},
	inputMultiline: {
		minHeight: 88,
		textAlignVertical: 'top',
	},
	badge: {
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: spacing.sm,
		paddingVertical: 2,
	},
	badgeText: {
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	dot: {
		width: 8,
		height: 8,
		borderRadius: 4,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	divider: {
		height: 1,
		backgroundColor: colors.border,
		marginVertical: spacing.sm,
	},
	empty: {
		padding: spacing.xl,
		alignItems: 'center',
		gap: spacing.xs,
	},
	emptyTitle: {
		color: colors.fgMuted,
		fontSize: fontSize.sm,
		fontWeight: '600',
	},
	emptyDetail: {
		color: colors.fgFaint,
		fontSize: fontSize.xs,
		textAlign: 'center',
	},
	errorBanner: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: spacing.sm,
		backgroundColor: '#3b1418',
		borderColor: colors.danger,
		borderWidth: 1,
		borderRadius: radius.sm,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		margin: spacing.md,
	},
	errorText: {
		color: '#fecdd3',
		fontSize: fontSize.xs,
		flexShrink: 1,
	},
	chipRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	chip: {
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 999,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.xs + 2,
	},
	chipText: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	loading: {
		padding: spacing.xl,
		alignItems: 'center',
		gap: spacing.sm,
	},
	loadingText: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
	},
});
