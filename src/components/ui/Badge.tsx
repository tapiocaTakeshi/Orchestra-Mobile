import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../design/theme';

export type Status = 'running' | 'warning' | 'success' | 'danger';

export function StatusDot({ status, style }: { status: Status; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors[status] }, style]}
    />
  );
}

/** mock の .badge（22 高、pill、12px 600） */
export function Badge({ label, status, style }: { label: string; status?: Status; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 4,
          height: 22,
          paddingHorizontal: 8,
          borderRadius: t.radius.pill,
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.bgElevated,
        },
        style,
      ]}
    >
      {status ? <StatusDot status={status} /> : null}
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: t.colors.fgMuted, fontFamily: t.fonts.body }}>
        {label}
      </Text>
    </View>
  );
}
