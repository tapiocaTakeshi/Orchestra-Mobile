import React, { ReactNode, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  accentSoft,
  fonts,
  fontSize,
  layout,
  lineHeight,
  radius,
  shadow,
  space,
  StatusKind,
  useTheme,
} from '../theme/tokens';

/* ====================== Text ====================== */

export type TxtVariant = 'display' | 'page' | 'section' | 'row' | 'body' | 'muted' | 'caption' | 'mono' | 'lead';

export function Txt({
  variant = 'body',
  style,
  numberOfLines,
  children,
}: {
  variant?: TxtVariant;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const map: Record<TxtVariant, TextStyle> = {
    display: { fontFamily: fonts.serif, fontSize: fontSize.display, lineHeight: lineHeight.display, fontWeight: '500', color: colors.fgStrong },
    page: { fontFamily: fonts.serif, fontSize: fontSize.page, lineHeight: lineHeight.page, fontWeight: '500', color: colors.fgStrong },
    section: { fontFamily: fonts.body, fontSize: fontSize.title, lineHeight: lineHeight.title, fontWeight: '600', color: colors.fgStrong },
    row: { fontFamily: fonts.body, fontSize: fontSize.body, lineHeight: 21, fontWeight: '600', color: colors.fgStrong },
    body: { fontFamily: fonts.body, fontSize: fontSize.body, lineHeight: lineHeight.bodyLoose, color: colors.fg },
    lead: { fontFamily: fonts.body, fontSize: fontSize.body, lineHeight: lineHeight.bodyLoose, color: colors.fgMuted },
    muted: { fontFamily: fonts.body, fontSize: fontSize.small, lineHeight: lineHeight.small, color: colors.fgMuted },
    caption: { fontFamily: fonts.body, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.fgFaint },
    mono: { fontFamily: fonts.mono, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.fgFaint },
  };
  return (
    <Text style={[map[variant], style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/* ====================== Screen layout ====================== */

/** .screen 相当。端末フレームは持ち込まず、セーフエリアとキーボードを扱う */
export function AppScreen({
  children,
  background = 'bg',
  padBottom = true,
  style,
}: {
  children: ReactNode;
  background?: 'bg' | 'bgSidebar';
  padBottom?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: colors[background], paddingTop: insets.top }, style]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, paddingBottom: padBottom ? insets.bottom : 0 }}>{children}</View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** .content 相当（padding 16 12 24、縦スクロール） */
export const ScreenScroll = React.forwardRef<ScrollView, ScrollViewProps & { children: ReactNode }>(
  function ScreenScroll({ children, contentContainerStyle, ...rest }, ref) {
    return (
      <ScrollView
        ref={ref}
        style={{ flex: 1 }}
        contentContainerStyle={[{ paddingTop: space.lg, paddingHorizontal: space.md, paddingBottom: space.xl }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        {...rest}
      >
        {children}
      </ScrollView>
    );
  },
);

/** .stack（gap 12） */
export function Stack({ children, gap = space.md, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'column', gap }, style]}>{children}</View>;
}

/** .section-h */
export function SectionHeading({ children, first }: { children: ReactNode; first?: boolean }) {
  return (
    <Txt variant="section" style={{ marginTop: first ? 0 : space.xl, marginBottom: space.sm }}>
      {children}
    </Txt>
  );
}

/* ====================== Icon button / Header ====================== */

export function IconButton({
  glyph,
  label,
  onPress,
  testID,
}: {
  glyph: string;
  label: string;
  onPress?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => ({
        width: layout.hit,
        height: layout.hit,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.bgHover : 'transparent',
      })}
    >
      <Text style={{ fontSize: 20, color: colors.fgStrong }}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * .header 相当。
 * variant="chat": 太字 17 のタイトルと、状態ドット付きのサブタイトル（会話ホーム）
 * variant="page": serif 22 の .page-title（プロジェクト・カンバンなど）
 */
export function AppHeader({
  leading,
  title,
  subtitle,
  subtitleStatus,
  variant = 'page',
  trailing,
}: {
  leading?: { glyph: string; label: string; onPress?: () => void; testID?: string };
  title: string;
  subtitle?: string;
  subtitleStatus?: StatusKind;
  variant?: 'chat' | 'page';
  trailing?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: layout.header,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        paddingHorizontal: space.xs,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      {leading ? <IconButton {...leading} /> : <View style={{ width: space.md }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        {variant === 'page' ? (
          <Txt variant="page" numberOfLines={1} style={{ lineHeight: 29 }}>
            {title}
          </Txt>
        ) : (
          <>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.body, fontSize: fontSize.title, fontWeight: '600', color: colors.fgStrong, lineHeight: 22 }}
            >
              {title}
            </Text>
            {subtitle ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {subtitleStatus ? <Dot kind={subtitleStatus} /> : null}
                <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: fontSize.caption, color: colors.fgFaint, lineHeight: 17 }}>
                  {subtitle}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>
      {trailing}
    </View>
  );
}

/* ====================== Button ====================== */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  block,
  disabled,
  accessibilityLabel,
  testID,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  block?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const palette: Record<ButtonVariant, { bg: string; bgPressed: string; fg: string; border: string }> = {
    primary: { bg: colors.accent, bgPressed: colors.accentPressed, fg: colors.onAccent, border: 'transparent' },
    secondary: { bg: colors.bgElevated, bgPressed: colors.bgHover, fg: colors.fgStrong, border: colors.borderStrong },
    ghost: { bg: 'transparent', bgPressed: colors.bgHover, fg: colors.accentText, border: 'transparent' },
    danger: { bg: colors.danger, bgPressed: colors.danger, fg: colors.onAccent, border: 'transparent' },
  };
  const p = palette[variant];
  const sm = size === 'sm';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: sm ? 36 : layout.hit,
          paddingHorizontal: sm ? space.md : space.lg,
          borderRadius: sm ? radius.sm : radius.md,
          borderWidth: 1,
          borderColor: p.border,
          backgroundColor: pressed && !disabled ? p.bgPressed : p.bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: disabled ? 0.4 : 1,
          alignSelf: block ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      <Text
        numberOfLines={1}
        style={{ fontFamily: fonts.body, fontSize: sm ? fontSize.small : fontSize.body, fontWeight: '600', color: p.fg }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ====================== Input ====================== */

export function Input(props: TextInputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const { style, onFocus, onBlur, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={colors.fgFaint}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        {
          width: '100%',
          minHeight: layout.hit,
          paddingHorizontal: space.md,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? colors.accentText : colors.border,
          borderRadius: radius.md,
          backgroundColor: colors.bgInput,
          color: colors.fg,
          fontSize: fontSize.body,
          fontFamily: fonts.body,
        },
        style,
      ]}
      {...rest}
    />
  );
}

/* ====================== Card ====================== */

export function Card({
  children,
  onPress,
  style,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow(1, colors.shadow),
  };
  if (!onPress) {
    return (
      <View style={[base, style]} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [base, pressed && { backgroundColor: colors.bgHover }, style]}
    >
      {children}
    </Pressable>
  );
}

/* ====================== Dot / Badge ====================== */

export function Dot({ kind }: { kind: StatusKind }) {
  const { colors } = useTheme();
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors[kind] }} />;
}

export function Badge({ status, label, testID }: { status?: StatusKind; label: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        height: 22,
        paddingHorizontal: space.sm,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgElevated,
        alignSelf: 'flex-start',
        flexShrink: 0,
      }}
    >
      {status ? <Dot kind={status} /> : null}
      <Text numberOfLines={1} style={{ fontSize: fontSize.caption, fontWeight: '600', color: colors.fgMuted }}>
        {label}
      </Text>
    </View>
  );
}

/** .avatar（✻ マーク） */
export function Avatar({ glyph = '✻', size = 26 }: { glyph?: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: Math.round(size * 0.54), color: colors.accent }}>{glyph}</Text>
    </View>
  );
}

/* ====================== Chip ====================== */

export function Chip({
  label,
  onPress,
  changed,
  testID,
}: {
  label: string;
  onPress?: () => void;
  changed?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        height: 28,
        paddingHorizontal: 10,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: changed ? colors.accentText : colors.border,
        backgroundColor: pressed ? colors.bgHover : colors.bg,
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
      })}
    >
      <Text numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: fontSize.caption, color: changed ? colors.accentText : colors.fgMuted }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** .chipset（横スクロール） */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flex: 1, minWidth: 0 }}
      contentContainerStyle={{ gap: 6, alignItems: 'center' }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/* ====================== Tabs ====================== */

export function Tabs<K extends string>({
  items,
  selected,
  onChange,
}: {
  items: { key: K; label: string }[];
  selected: K;
  onChange: (key: K) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      style={{ flexGrow: 0, marginBottom: space.md }}
      contentContainerStyle={{ gap: 6, paddingBottom: space.xs }}
    >
      {items.map((it) => {
        const on = it.key === selected;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(it.key)}
            style={{
              height: 32,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? colors.accentText : colors.border,
              backgroundColor: colors.bgElevated,
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: fontSize.small, fontWeight: '600', color: on ? colors.accentText : colors.fgMuted }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ====================== Switch ====================== */

export function Switch({
  value,
  onValueChange,
  label,
  testID,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      testID={testID}
      hitSlop={9}
      style={{
        width: 44,
        height: 26,
        borderRadius: radius.pill,
        backgroundColor: value ? colors.accent : colors.borderStrong,
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: colors.bgElevated,
          ...shadow(1, colors.shadow),
        }}
      />
    </Pressable>
  );
}

/* ====================== Option (radio row in sheet) ====================== */

export function OptionRow({
  title,
  description,
  checked,
  onPress,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 56,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderWidth: 1,
        borderColor: checked ? colors.accentText : colors.border,
        borderRadius: radius.md,
        marginBottom: space.sm,
        backgroundColor: pressed ? colors.bgHover : 'transparent',
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="row">{title}</Txt>
        {description ? <Txt variant="muted">{description}</Txt> : null}
      </View>
      <Text style={{ color: colors.accentText, fontWeight: '700', opacity: checked ? 1 : 0 }}>✓</Text>
    </Pressable>
  );
}

/* ====================== Approval bar ====================== */

export function ApprovalBar({
  title,
  detail,
  onApprove,
  onDeny,
  approveLabel = '許可',
  denyLabel = '拒否',
}: {
  title: string;
  detail: string;
  onApprove: () => void;
  onDeny: () => void;
  approveLabel?: string;
  denyLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      testID="approval-bar"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        backgroundColor: colors.bgSidebar,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Dot kind="warning" />
      <Text style={{ flex: 1, minWidth: 0, fontSize: fontSize.small, lineHeight: 18, color: colors.fg }} numberOfLines={2}>
        <Text style={{ fontWeight: '600', color: colors.fgStrong }}>{title}</Text>
        {' · '}
        {detail}
      </Text>
      <Button label={denyLabel} variant="secondary" size="sm" onPress={onDeny} />
      <Button label={approveLabel} variant="primary" size="sm" onPress={onApprove} />
    </View>
  );
}

/* ====================== Divider ====================== */

/** .divider（「または」） */
export function TextDivider({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <Text style={{ fontSize: fontSize.caption, color: colors.fgFaint }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}
