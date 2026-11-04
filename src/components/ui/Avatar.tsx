import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../design/theme';

/** mock の .avatar（26px 円, accent 淡色地に ✻）。size=64 で .logo 相当 */
export function Avatar({ size = 26, glyph = '✻', rounded = 'circle' }: { size?: number; glyph?: string; rounded?: 'circle' | 'lg' }) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: rounded === 'circle' ? size / 2 : t.radius.lg,
        backgroundColor: t.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: t.colors.accent, fontSize: Math.round(size / 2) + 1 }}>{glyph}</Text>
    </View>
  );
}
