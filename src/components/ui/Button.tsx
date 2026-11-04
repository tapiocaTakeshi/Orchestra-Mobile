import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useTheme } from '../../design/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  block?: boolean;
  disabled?: boolean;
  icon?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  block,
  disabled,
  icon,
  accessibilityLabel,
  style,
  testID,
}: ButtonProps) {
  const t = useTheme();
  const c = t.colors;
  const sm = size === 'sm';

  const fg =
    variant === 'primary' || variant === 'danger'
      ? c.onAccent
      : variant === 'ghost'
        ? c.accentText
        : c.fgStrong;

  const bgOf = (pressed: boolean) => {
    switch (variant) {
      case 'primary':
        return pressed ? c.accentPressed : c.accent;
      case 'secondary':
        return pressed ? c.bgHover : c.bgElevated;
      case 'danger':
        return c.danger;
      default:
        return pressed ? c.bgHover : 'transparent';
    }
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={sm ? 4 : 0}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: sm ? 36 : 44,
          paddingHorizontal: sm ? t.space.md : t.space.lg,
          borderRadius: sm ? t.radius.sm : t.radius.md,
          backgroundColor: bgOf(pressed && !disabled),
          borderColor: variant === 'secondary' ? c.borderStrong : 'transparent',
        },
        block ? styles.block : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {icon ? <Text style={[styles.label, { color: fg, fontSize: sm ? 13 : 15 }]}>{icon}</Text> : null}
      <Text
        numberOfLines={1}
        style={[styles.label, { color: fg, fontSize: sm ? 13 : 15, fontFamily: t.fonts.body }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  block: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
  label: { fontWeight: '600' },
});
