import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../design/theme';
import { Status, StatusDot } from './Badge';
import { IconButton } from './IconButton';

export type HeaderAction = { glyph: string; label: string; onPress?: () => void; testID?: string };

export type ScreenHeaderProps = {
  /** page: セリフ 22px の .page-title / conversation: 17px + サブ行の .header-title */
  variant?: 'page' | 'conversation';
  title: string;
  subtitle?: string;
  subtitleStatus?: Status;
  left?: HeaderAction;
  right?: HeaderAction | React.ReactNode;
};

function isAction(v: unknown): v is HeaderAction {
  return !!v && typeof v === 'object' && 'glyph' in (v as object) && 'label' in (v as object);
}

/** mock の .header（56 高、border-bottom、左右 4px） */
export function ScreenHeader({ variant = 'page', title, subtitle, subtitleStatus, left, right }: ScreenHeaderProps) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="header"
      style={{
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        paddingHorizontal: t.space.xs,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
        backgroundColor: t.colors.bg,
      }}
    >
      {left ? <IconButton {...left} /> : <View style={{ width: t.space.md }} />}
      {variant === 'page' ? (
        <Text numberOfLines={1} style={[t.type.pageTitle, { flex: 1 }]}>
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[t.type.title, { lineHeight: 22 }]}>
            {title}
          </Text>
          {subtitle ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {subtitleStatus ? <StatusDot status={subtitleStatus} /> : null}
              <Text numberOfLines={1} style={t.type.caption}>
                {subtitle}
              </Text>
            </View>
          ) : null}
        </View>
      )}
      {isAction(right) ? <IconButton {...right} /> : (right as React.ReactNode) ?? null}
    </View>
  );
}
