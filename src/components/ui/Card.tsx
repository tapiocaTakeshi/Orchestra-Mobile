import React from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { useTheme } from '../../design/theme';

export type CardProps = {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** mock の .card（bg-elevated, border, radius-lg, padding lg, shadow-1） */
export function Card({ children, onPress, accessibilityLabel, style, testID }: CardProps) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.colors.bgElevated,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radius.lg,
    padding: t.space.lg,
    ...t.shadow(1),
  };
  if (!onPress) {
    return (
      <View testID={testID} style={[base, style]}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [base, pressed ? { backgroundColor: t.colors.bgHover } : null, style]}
    >
      {children}
    </Pressable>
  );
}
