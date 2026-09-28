/** 画面全体で使い回す小さな UI 部品。ここ以外でスタイルを書かないようにする。 */

import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import {
	ActivityIndicator,
	Alert,
	Animated,
	Modal,
	Platform,
	Pressable,
	StyleSheet,
	Switch,
	Text,
	TextInput,
	TextInputProps,
	View,
	ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, radius, spacing, withAlpha } from '../theme';

export type IconName = React.ComponentProps<typeof Feather>['name'];

export const Icon = ({ name, color = colors.fgMuted, size = 20 }: { name: IconName; color?: string; size?: number }) => (
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
	/** sm はツールバーや入力欄の脇に置く小さめのボタン。 */
	size?: 'md' | 'sm';
	icon?: IconName;
	disabled?: boolean;
	loading?: boolean;
	style?: ViewStyle;
	accessibilityLabel?: string;
};

/**
 * 主ボタンは明るい塗りに暗い文字 (色を足さない)、それ以外は枠だけか文字だけ。
 * 危険な操作は赤い塗りではなく、赤い文字で出す。
 */
const buttonTextColor = (variant: ButtonProps['variant']) => {
	switch (variant) {
		case 'ghost': return colors.fgMuted;
		case 'secondary': return colors.fg;
		case 'danger': return colors.danger;
		default: return colors.bg;
	}
};

export const Button = ({ title, onPress, variant = 'primary', size = 'md', icon, disabled, loading, style, accessibilityLabel }: ButtonProps) => {
	const isDisabled = disabled || loading;
	const textColor = buttonTextColor(variant);
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityLabel={accessibilityLabel ?? title}
			disabled={!!isDisabled}
			accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
			onPress={isDisabled ? undefined : onPress}
			style={({ pressed }) => [
				styles.button,
				size === 'sm' && styles.buttonSmall,
				variant === 'primary' && styles.buttonPrimary,
				variant === 'secondary' && styles.buttonSecondary,
				variant === 'danger' && styles.buttonDanger,
				variant === 'ghost' && styles.buttonGhost,
				pressed && !isDisabled && (variant === 'primary' ? styles.buttonPrimaryPressed : styles.buttonPressed),
				isDisabled && styles.buttonDisabled,
				style,
			]}
		>
			{loading
				? <ActivityIndicator color={textColor} size='small' />
				: (
					<View style={styles.buttonContent}>
						{icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} color={textColor} /> : null}
						<Text style={[styles.buttonText, size === 'sm' && styles.buttonTextSmall, { color: textColor }]} numberOfLines={2}>{title}</Text>
					</View>
				)}
		</Pressable>
	);
};

/** アイコンだけのボタン。見た目が小さくても押せる範囲は 44pt 確保する。 */
export const IconButton = ({ icon, onPress, accessibilityLabel, color = colors.fgMuted, badge, active, disabled }: {
	icon: IconName;
	onPress: () => void;
	accessibilityLabel: string;
	color?: string;
	/** 右上に出す件数。0 や undefined なら出さない。 */
	badge?: number;
	active?: boolean;
	disabled?: boolean;
}) => (
	<Pressable
		accessibilityRole='button'
		accessibilityLabel={badge ? `${accessibilityLabel} (${badge})` : accessibilityLabel}
		accessibilityState={{ disabled: !!disabled, selected: active }}
		disabled={disabled}
		hitSlop={4}
		onPress={onPress}
		style={({ pressed }) => [
			styles.iconButton,
			active && styles.iconButtonActive,
			pressed && styles.iconButtonPressed,
			disabled && styles.buttonDisabled,
		]}
	>
		<Icon name={icon} size={20} color={active ? colors.fgStrong : color} />
		{badge ? (
			<View style={styles.iconBadge}>
				<Text style={styles.iconBadgeText}>{badge > 99 ? '99+' : badge}</Text>
			</View>
		) : null}
	</Pressable>
);

export const Input = forwardRef<TextInput, TextInputProps>((props, ref) => {
	const [focused, setFocused] = useState(false);
	return (
		<TextInput
			ref={ref}
			placeholderTextColor={colors.fgFaint}
			selectionColor={colors.accentText}
			accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
			{...props}
			onFocus={event => { setFocused(true); props.onFocus?.(event); }}
			onBlur={event => { setFocused(false); props.onBlur?.(event); }}
			style={[
				styles.input,
				props.multiline && styles.inputMultiline,
				props.style,
				focused && styles.inputFocused,
			]}
		/>
	);
});
Input.displayName = 'Input';

/** 状態や件数の小さな表示。枠や地は付けず、アイコンと文字色だけで伝える。 */
export const Badge = ({ label, color = colors.fgFaint, icon }: { label: string; color?: string; icon?: IconName }) => (
	<View style={styles.badge}>
		{icon ? <Icon name={icon} size={12} color={color} /> : null}
		<Text style={[styles.badgeText, { color }]}>{label}</Text>
	</View>
);

export const Dot = ({ color }: { color: string }) => (
	<View style={[styles.dot, { backgroundColor: color }]} />
);

/** オン/オフ。つまみの色を端末任せにすると Android や Web で緑になるので、テーマの色で揃える。 */
export const Toggle = ({ value, onValueChange, accessibilityLabel, disabled }: {
	value: boolean;
	onValueChange: (next: boolean) => void;
	accessibilityLabel?: string;
	disabled?: boolean;
}) => (
	<Switch
		value={value}
		onValueChange={onValueChange}
		disabled={disabled}
		accessibilityLabel={accessibilityLabel}
		trackColor={{ true: colors.accentText, false: colors.borderStrong }}
		thumbColor={value ? colors.fgStrong : colors.fgMuted}
		ios_backgroundColor={colors.borderStrong}
		{...(Platform.OS === 'web' ? { activeThumbColor: colors.fgStrong } : {})}
	/>
);

export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
	<View style={[styles.row, style]}>{children}</View>
);

export const Divider = () => <View style={styles.divider} />;

export const EmptyState = ({ title, detail, icon = 'inbox', action }: {
	title: string;
	detail?: string;
	icon?: IconName;
	action?: React.ReactNode;
}) => (
	<View style={styles.empty}>
		<View style={styles.emptyIcon}><Icon name={icon} size={24} color={colors.fgFaint} /></View>
		<Text style={styles.emptyTitle}>{title}</Text>
		{detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
		{action ? <View style={styles.emptyAction}>{action}</View> : null}
	</View>
);

export const ErrorBanner = ({ message, onRetry, tone = 'error', style }: {
	message: string;
	onRetry?: () => void;
	/** warning は「繋がったけど注意がある」ときの黄色。 */
	tone?: 'error' | 'warning';
	style?: ViewStyle;
}) => (
	<View
		accessibilityRole='alert'
		accessibilityLiveRegion='polite'
		style={[styles.errorBanner, tone === 'warning' && styles.warningBanner, style]}
	>
		<Icon name='alert-circle' size={16} color={tone === 'warning' ? colors.warning : '#fecdd3'} />
		<Text style={[styles.errorText, tone === 'warning' && styles.warningText]}>{message}</Text>
		{onRetry ? <Button title='再試行' variant='ghost' size='sm' onPress={onRetry} /> : null}
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
						selected && (opt.color
							? { borderColor: withAlpha(opt.color, '66'), backgroundColor: withAlpha(opt.color, '1a') }
							: styles.chipSelected),
					]}
				>
					<Text style={[styles.chipText, selected && (opt.color ? { color: opt.color } : styles.chipTextSelected)]}>{opt.label}</Text>
				</Pressable>
			);
		})}
	</View>
);


/** 2〜4 択の切り替え。タブの中のタブ (表示モードなど) に使う。 */
export const SegmentedControl = <T extends string>({ options, value, onChange, style }: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (v: T) => void;
	style?: ViewStyle;
}) => (
	<View accessibilityRole='tablist' style={[styles.segmented, style]}>
		{options.map(opt => {
			const selected = opt.value === value;
			return (
				<Pressable
					key={opt.value}
					accessibilityRole='tab'
					accessibilityState={{ selected }}
					onPress={() => onChange(opt.value)}
					style={[styles.segment, selected && styles.segmentActive]}
				>
					<Text style={[styles.segmentText, selected && styles.segmentTextActive]} numberOfLines={1}>{opt.label}</Text>
				</Pressable>
			);
		})}
	</View>
);

// ---------------------------------------------------------------------------
// 確認ダイアログ
// ---------------------------------------------------------------------------

/**
 * 取り消せない操作の前に確認する。react-native-web の Alert.alert は何も出さないので、
 * Web だけはブラウザの confirm() を使う。
 */
export const confirmAction = ({ title, message, confirmLabel = 'OK', destructive = false }: {
	title: string;
	message?: string;
	confirmLabel?: string;
	destructive?: boolean;
}): Promise<boolean> => {
	if (Platform.OS === 'web') {
		const confirmFn = (globalThis as { confirm?: (text: string) => boolean }).confirm;
		return Promise.resolve(confirmFn ? confirmFn(message ? `${title}\n\n${message}` : title) : true);
	}
	return new Promise(resolve => {
		Alert.alert(
			title,
			message,
			[
				{ text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
				{ text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
			],
			{ cancelable: true, onDismiss: () => resolve(false) },
		);
	});
};

// ---------------------------------------------------------------------------
// トースト
// ---------------------------------------------------------------------------

type ToastTone = 'info' | 'success' | 'error';
type ToastState = { id: number; message: string; tone: ToastTone };

type ToastApi = {
	show: (message: string, tone?: ToastTone) => void;
	hide: () => void;
};

// 表示中のトーストと操作を別の Context に分ける。操作側は参照が変わらないので、
// useCallback の依存に入れてもトーストが出るたびに作り直されない。
const ToastStateContext = createContext<ToastState | null>(null);
const ToastApiContext = createContext<ToastApi | null>(null);

/**
 * 操作結果を画面に一時的に出す。スクロールの一番下に文字を置くと
 * 見えないまま消えてしまうので、結果の通知はここに集める。
 */
export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
	const [toast, setToast] = useState<ToastState | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const seq = useRef(0);

	const hide = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		setToast(null);
	}, []);

	const show = useCallback((message: string, tone: ToastTone = 'info') => {
		if (timer.current) clearTimeout(timer.current);
		seq.current += 1;
		setToast({ id: seq.current, message, tone });
		// エラーは読み切れるように少し長く出す。
		timer.current = setTimeout(() => setToast(null), tone === 'error' ? 5_000 : 2_600);
	}, []);

	useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

	const api = useMemo(() => ({ show, hide }), [show, hide]);
	return (
		<ToastApiContext.Provider value={api}>
			<ToastStateContext.Provider value={toast}>{children}</ToastStateContext.Provider>
		</ToastApiContext.Provider>
	);
};

export const useToast = (): ToastApi => {
	const ctx = useContext(ToastApiContext);
	if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
	return ctx;
};

const TOAST_ICON: Record<ToastTone, IconName> = { info: 'info', success: 'check-circle', error: 'alert-circle' };
const TOAST_COLOR: Record<ToastTone, string> = { info: colors.accentText, success: colors.success, error: colors.danger };

/**
 * トーストの表示場所。Modal は別レイヤーに描かれるので、シートの中にも 1 つ置く。
 * 下端は入力欄やキーボードと重なるので、見出しの上に被せて出す。
 */
export const ToastHost = () => {
	const toast = useContext(ToastStateContext);
	const { hide } = useToast();
	const anim = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (!toast) return;
		anim.setValue(0);
		Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
	}, [toast, anim]);

	if (!toast) return null;
	const color = TOAST_COLOR[toast.tone];
	return (
		<Animated.View
			pointerEvents='box-none'
			style={[
				styles.toastWrap,
				{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] },
			]}
		>
			<Pressable
				accessibilityRole={toast.tone === 'error' ? 'alert' : 'text'}
				accessibilityLiveRegion='polite'
				accessibilityHint='タップで閉じます'
				onPress={hide}
				style={[styles.toast, { borderColor: `${color}66` }]}
			>
				<Icon name={TOAST_ICON[toast.tone]} size={18} color={color} />
				<Text style={styles.toastText}>{toast.message}</Text>
			</Pressable>
		</Animated.View>
	);
};

// ---------------------------------------------------------------------------
// シート (Modal)
// ---------------------------------------------------------------------------

/**
 * 画面の上に重ねる編集用シート。見出しと「閉じる」をどの画面でも同じ位置・大きさにする。
 * iOS の pageSheet は上端がステータスバーに掛からないので、下端だけ安全領域をとる。
 */
export const Sheet = ({ title, eyebrow, onClose, headerRight, children }: {
	title: string;
	eyebrow?: string;
	onClose: () => void;
	headerRight?: React.ReactNode;
	children: React.ReactNode;
}) => (
	<Modal animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
		<SafeAreaView style={styles.screen} edges={Platform.OS === 'ios' ? ['bottom'] : ['top', 'bottom']}>
			<View style={styles.sheetHeader}>
				<View style={styles.sheetTitle}>
					{eyebrow ? <Muted numberOfLines={1}>{eyebrow}</Muted> : null}
					<Text accessibilityRole='header' style={styles.title} numberOfLines={2}>{title}</Text>
				</View>
				{headerRight}
				<IconButton icon='x' accessibilityLabel='閉じる' onPress={onClose} />
			</View>
			<View style={styles.sheetBody}>
				{children}
				<ToastHost />
			</View>
		</SafeAreaView>
	</Modal>
);

export const Loading = ({ label }: { label?: string }) => (
	<View style={styles.loading}>
		<ActivityIndicator color={colors.fgMuted} />
		{label ? <Text style={styles.loadingText}>{label}</Text> : null}
	</View>
);

const styles = StyleSheet.create({
	screenHeader: {
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.lg,
		paddingBottom: spacing.md,
		gap: 2,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.borderStrong,
	},
	inputFocused: { borderColor: colors.fgFaint },
	emptyIcon: { marginBottom: spacing.xs },
	screen: {
		flex: 1,
		backgroundColor: colors.bg,
	},
	card: {
		// 箱で囲まず、細い線で区切るだけの平らな区画にする
		paddingVertical: spacing.lg,
		gap: spacing.md,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.borderStrong,
	},
	sectionTitleRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: spacing.sm,
	},
	sectionTitle: {
		color: colors.fgMuted,
		fontSize: fontSize.xs + 1,
		fontWeight: '600',
		flexShrink: 1,
	},
	title: {
		color: colors.fgStrong,
		fontSize: fontSize.lg - 2,
		fontWeight: '600',
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
		minHeight: 46,
		flexShrink: 1,
	},
	buttonSmall: { minHeight: 38, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs },
	buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, flexShrink: 1 },
	buttonPrimary: { backgroundColor: colors.fg },
	buttonPrimaryPressed: { backgroundColor: colors.fgMuted },
	buttonSecondary: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
	buttonDanger: { backgroundColor: 'transparent', borderColor: withAlpha(colors.danger, '44') },
	buttonGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
	buttonPressed: { backgroundColor: colors.bgHover },
	buttonDisabled: { opacity: 0.4 },
	buttonText: {
		color: colors.fg,
		fontSize: fontSize.sm - 1,
		fontWeight: '600',
		textAlign: 'center',
		flexShrink: 1,
	},
	buttonTextSmall: { fontSize: fontSize.xs + 1 },
	iconButton: {
		width: 44,
		height: 44,
		borderRadius: radius.sm,
		alignItems: 'center',
		justifyContent: 'center',
	},
	iconButtonActive: { backgroundColor: colors.bgHover },
	iconButtonPressed: { backgroundColor: colors.bgHover },
	iconBadge: {
		position: 'absolute',
		top: 4,
		right: 4,
		minWidth: 16,
		height: 16,
		borderRadius: 8,
		paddingHorizontal: 3,
		backgroundColor: colors.fg,
		alignItems: 'center',
		justifyContent: 'center',
	},
	iconBadgeText: { color: colors.bg, fontSize: 10, fontWeight: '700' },
	input: {
		minHeight: 46,
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
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		alignSelf: 'flex-start',
		flexShrink: 1,
	},
	badgeText: {
		fontSize: fontSize.xs,
		fontWeight: '500',
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
		height: StyleSheet.hairlineWidth,
		backgroundColor: colors.borderStrong,
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
		fontWeight: '500',
		textAlign: 'center',
	},
	emptyDetail: {
		color: colors.fgFaint,
		fontSize: fontSize.xs + 1,
		lineHeight: 21,
		textAlign: 'center',
	},
	emptyAction: { marginTop: spacing.sm, alignSelf: 'stretch', alignItems: 'center' },
	// デスクトップのログイン画面のエラー表示と同じ、薄い赤の地 + 赤の枠
	errorBanner: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: spacing.sm,
		backgroundColor: withAlpha(colors.danger, '1a'),
		borderColor: withAlpha(colors.danger, '4d'),
		borderWidth: 1,
		borderRadius: radius.sm,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		margin: spacing.md,
	},
	errorText: {
		color: colors.danger,
		fontSize: fontSize.xs,
		lineHeight: 18,
		flex: 1,
	},
	warningBanner: { backgroundColor: withAlpha(colors.warning, '1a'), borderColor: withAlpha(colors.warning, '4d') },
	warningText: { color: colors.warning },
	segmented: {
		flexDirection: 'row',
		backgroundColor: colors.bgElevated,
		borderRadius: radius.md,
		padding: 3,
		gap: 3,
	},
	segment: {
		flex: 1,
		minHeight: 34,
		borderRadius: radius.sm,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: spacing.xs,
	},
	segmentActive: { backgroundColor: colors.bgHover },
	segmentText: { color: colors.fgFaint, fontSize: fontSize.xs + 1, fontWeight: '600' },
	segmentTextActive: { color: colors.fgStrong },
	toastWrap: {
		position: 'absolute',
		top: spacing.sm,
		left: spacing.lg,
		right: spacing.lg,
		alignItems: 'center',
		zIndex: 100,
	},
	toast: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		maxWidth: 480,
		backgroundColor: colors.bgInput,
		borderWidth: 1,
		borderRadius: radius.md,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm + 2,
		shadowColor: '#000000',
		shadowOpacity: 0.5,
		shadowRadius: 16,
		shadowOffset: { width: 0, height: 6 },
		elevation: 8,
	},
	toastText: { color: colors.fg, fontSize: fontSize.xs + 1, lineHeight: 19, flexShrink: 1 },
	sheetHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		paddingLeft: spacing.lg,
		paddingRight: spacing.sm,
		paddingVertical: spacing.sm,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.borderStrong,
	},
	sheetTitle: { flex: 1, gap: 2, paddingVertical: spacing.xs },
	sheetBody: { flex: 1 },
	chipRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	chip: {
		minHeight: 36,
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 999,
		paddingHorizontal: spacing.md,
	},
	chipSelected: { backgroundColor: colors.bgHover, borderColor: colors.borderStrong },
	chipText: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	chipTextSelected: { color: colors.fgStrong },
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
