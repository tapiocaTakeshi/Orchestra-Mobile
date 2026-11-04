import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../../design/theme';

export type ChipProps = {
  label: string;
  onPress?: () => void;
  /** 既定値から変更済み（mock の .chip.changed） */
  changed?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** mock の .chip（28 高、pill、mono 12px） */
export function Chip({ label, onPress, changed, accessibilityLabel, testID }: ChipProps) {
  const t = useTheme();
  const tone = changed ? t.colors.accentText : t.colors.fgMuted;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        height: 28,
        paddingHorizontal: 10,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: changed ? t.colors.accentText : t.colors.border,
        backgroundColor: pressed ? t.colors.bgHover : t.colors.bg,
      })}
    >
      <Text numberOfLines={1} style={{ fontFamily: t.fonts.mono, fontSize: 12, color: tone }}>
        {label}
      </Text>
    </Pressable>
  );
}
