import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../design/theme';

/** mock の .switch（44×26、ON で accent、つまみ 20px が 18px 移動） */
export function Toggle({
  value,
  onChange,
  label,
  testID,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={9}
      style={{
        width: 44,
        height: 26,
        borderRadius: t.radius.pill,
        backgroundColor: value ? t.colors.accent : t.colors.borderStrong,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: 3,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: t.colors.bgElevated,
          transform: [{ translateX: value ? 18 : 0 }],
          ...t.shadow(1),
        }}
      />
    </Pressable>
  );
}
