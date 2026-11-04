import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { useTheme } from '../../design/theme';

export type TabItem<K extends string> = { key: K; label: string };

/** mock の .tabs / .tab（32 高 pill、選択中は accent-text の枠と文字） */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      style={{ flexGrow: 0, marginBottom: t.space.md }}
      contentContainerStyle={{ gap: 6, paddingBottom: t.space.xs }}
    >
      {items.map((it) => {
        const selected = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(it.key)}
            style={({ pressed }) => ({
              height: 32,
              paddingHorizontal: t.space.md,
              borderRadius: t.radius.pill,
              borderWidth: 1,
              borderColor: selected ? t.colors.accentText : t.colors.border,
              backgroundColor: pressed ? t.colors.bgHover : t.colors.bgElevated,
              justifyContent: 'center',
            })}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                fontFamily: t.fonts.body,
                color: selected ? t.colors.accentText : t.colors.fgMuted,
              }}
            >
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
