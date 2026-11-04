import React from 'react';
import { Pressable, StyleProp, Text, ViewStyle } from 'react-native';
import { useTheme } from '../../design/theme';

export type IconButtonProps = {
  glyph: string;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** mock の .icon-btn（44×44, radius-md, 押下で bg-hover） */
export function IconButton({ glyph, label, onPress, disabled, style, testID }: IconButtonProps) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          borderRadius: t.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? t.colors.bgHover : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <Text style={{ fontSize: 20, color: t.colors.fgStrong }}>{glyph}</Text>
    </Pressable>
  );
}
