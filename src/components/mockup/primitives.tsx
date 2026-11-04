import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, fontSize, radius, space } from '../../design/tokens';
import { fonts } from '../../design/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'md' | 'sm';
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: ViewStyle;
}

const bg: Record<Variant, string> = {
  primary: colors.accent,
  secondary: colors.bgElevated,
  ghost: 'transparent',
  danger: colors.danger,
};
const bgPressed: Record<Variant, string> = {
  primary: colors.accentPressed,
  secondary: colors.bgHover,
  ghost: colors.bgHover,
  danger: colors.danger,
};
const fg: Record<Variant, string> = {
  primary: colors.onAccent,
  secondary: colors.fgStrong,
  ghost: colors.accentText,
  danger: colors.onAccent,
};

/** モックアップ .btn / .btn-primary / .btn-secondary / .btn-ghost / .btn-sm */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  block,
  disabled,
  loading,
  accessibilityLabel,
  testID,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' && styles.sm,
        block && styles.block,
        { backgroundColor: pressed ? bgPressed[variant] : bg[variant] },
        variant === 'secondary' && styles.secondaryBorder,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: fg[variant] }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

interface IconButtonProps {
  icon: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}

/** モックアップ .icon-btn（44×44） */
export function IconButton({ icon, onPress, accessibilityLabel, testID }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [styles.icon, pressed && { backgroundColor: colors.bgHover }]}
    >
      <Text style={styles.iconText}>{icon}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  sm: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  block: { alignSelf: 'stretch' },
  secondaryBorder: { borderColor: colors.borderStrong },
  disabled: { opacity: 0.4 },
  label: { fontFamily: fonts.body, fontSize: fontSize.body, fontWeight: '600' },
  labelSm: { fontSize: fontSize.small },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 20, color: colors.fgStrong },
});
