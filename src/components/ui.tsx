/** 画面全体で使い回す小さな UI 部品。ここ以外でスタイルを書かないようにする。 */

import React, { useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
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

export const Icon = ({ name, color = colors.fgMuted, size = 20 }: { name: React.ComponentProps<typeof Feather>['name']; color?: string; size?: number }) => (
	<Feather name={name} color={color} size={size} accessible={false} />
);

export const ScreenHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
	<View style={styles.screenHeader}>
		<Text accessibilityRole='header' style={styles.title}>{title}</Text>
		{subtitle ? <Muted>{subtitle}</Muted> : null}
	</View>
);

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
	<Text accessibilityRole='header' style={styles.title}>{children}</Text>
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
			accessibilityLabel={title}
			disabled={!!isDisabled}
			accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
			onPress={isDisabled ? undefined : onPress}
			style={({ pressed }) => [
				styles.button,
				variant === 'primary' && styles.buttonPrimary,
				variant === 'secondary' && styles.buttonSecondary,
				variant === 'danger' && styles.buttonDanger,
				variant === 'ghost' && styles.buttonGhost,
				pressed && !isDisabled && styles.buttonPressed,
				pressed && !isDisabled && variant === 'primary' && { backgroundColor: colors.accentPressed },
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

export const Input = (props: TextInputProps) => {
	const [focused, setFocused] = useState(false);
	return (
		<TextInput
			placeholderTextColor={colors.fgFaint}
			selectionColor={colors.accentText}
			accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
			{...props}
			onFocus={event => { setFocused(true); props.onFocus?.(event); }}
			onBlur={event => { setFocused(false); props.onBlur?.(event); }}
			style={[styles.input, props.multiline && styles.inputMultiline, props.style, focused && styles.inputFocused]}
		/>
	);
};

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
		<View style={styles.emptyIcon}><Icon name='inbox' size={24} /></View>
		<Text style={styles.emptyTitle}>{title}</Text>
		{detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
	</View>
);

export const ErrorBanner = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
	<View accessibilityRole='alert' accessibilityLiveRegion='polite' style={styles.errorBanner}>
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
	screenHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md, gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
	inputFocused: { borderColor: colors.accentText },
	emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
	screen: {
		flex: 1,
		backgroundColor: colors.bg,
	},
	card: {
		backgroundColor: colors.bgElevated,
		borderColor: colors.border,
		borderWidth: 1,
		borderRadius: radius.lg,
		padding: spacing.lg,
		gap: spacing.md,
		shadowColor: '#000000',
		shadowOpacity: 0.22,
		shadowRadius: 12,
		shadowOffset: { width: 0, height: 4 },
		elevation: 3,
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
		letterSpacing: -0.3,
	},
	body: {
		color: colors.fg,
		fontSize: fontSize.sm,
		lineHeight: 23,
	},
	muted: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		lineHeight: 19,
	},
	button: {
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm + 2,
		borderRadius: radius.sm,
		alignItems: 'center',
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: 'transparent',
		minHeight: 48,
		flexShrink: 1,
	},
	buttonPrimary: { backgroundColor: colors.accent },
	buttonSecondary: { backgroundColor: colors.bgInput, borderColor: colors.borderStrong },
	buttonDanger: { backgroundColor: colors.danger },
	buttonGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
	buttonPressed: { opacity: 0.75 },
	buttonDisabled: { opacity: 0.4 },
	buttonText: {
		color: '#ffffff',
		fontSize: fontSize.sm,
		fontWeight: '600',
		textAlign: 'center',
	},
	input: {
		minHeight: 48,
		minWidth: 0,
		backgroundColor: colors.bgInput,
		borderColor: colors.border,
		borderWidth: 1,
		borderRadius: radius.md,
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
		borderRadius: radius.lg,
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
		alignSelf: 'flex-start',
		flexShrink: 1,
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
		color: colors.fgMuted,
		fontSize: fontSize.sm,
		lineHeight: 23,
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
		minHeight: 44,
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.lg,
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

