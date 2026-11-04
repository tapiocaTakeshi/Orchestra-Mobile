import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, fontSize, layout, radius, shadow, space, useTheme } from '../theme/tokens';

/* ====================== Sheet (.sheet) ====================== */

export function Sheet({
  visible,
  onClose,
  title,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim }}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={{
            maxHeight: height * 0.9,
            backgroundColor: colors.bgElevated,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingTop: space.sm,
            paddingHorizontal: space.lg,
            paddingBottom: space.xl + insets.bottom,
            ...shadow(3, colors.shadow),
          }}
        >
          <View
            style={{
              width: 36,
              height: 5,
              borderRadius: radius.pill,
              backgroundColor: colors.borderStrong,
              alignSelf: 'center',
              marginBottom: space.md,
            }}
          />
          {title ? (
            <Text
              style={{
                fontFamily: fonts.serif,
                fontSize: fontSize.page,
                fontWeight: '500',
                color: colors.fgStrong,
                marginBottom: space.md,
                lineHeight: 29,
              }}
            >
              {title}
            </Text>
          ) : null}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ====================== Drawer (.drawer) ====================== */

export function Drawer({
  visible,
  onClose,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(layout.drawerWidth, Math.round(width * 0.82));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View
          testID={testID}
          accessibilityViewIsModal
          accessibilityLabel="ナビゲーション"
          style={{
            width: drawerWidth,
            height: '100%',
            backgroundColor: colors.bgSidebar,
            paddingTop: insets.top + space.sm,
            paddingHorizontal: space.md,
            paddingBottom: insets.bottom + space.lg,
          }}
        >
          {children}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="メニューを閉じる"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: colors.scrim }}
        />
      </View>
    </Modal>
  );
}

/** ドロワーの .nav-item */
export function NavItem({
  icon,
  label,
  current,
  onPress,
}: {
  icon: string;
  label: string;
  current?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!current }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        height: 48,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: current || pressed ? colors.bgHover : 'transparent',
      })}
    >
      <Text style={{ width: 20, textAlign: 'center', fontSize: 18, color: current ? colors.accentText : colors.fgMuted }}>{icon}</Text>
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontSize: fontSize.body, fontWeight: '500', color: current ? colors.fgStrong : colors.fg }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ====================== Toast (.toast) ====================== */

type ToastApi = { show: (message: string) => void };

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export const TOAST_DURATION_MS = 1800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMessage(null);
    });
  }, [anim]);

  const show = useCallback(
    (msg: string) => {
      setMessage(msg);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, TOAST_DURATION_MS);
    },
    [anim, hide],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      <View style={{ flex: 1 }}>
        {children}
        {message !== null ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: space['2xl'] + insets.bottom, alignItems: 'center' }}
          >
            <Animated.View
              testID="toast"
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={{
                opacity: anim,
                transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
                backgroundColor: colors.fgStrong,
                paddingVertical: space.sm,
                paddingHorizontal: space.lg,
                borderRadius: radius.pill,
                maxWidth: '100%',
                ...shadow(3, colors.shadow),
              }}
            >
              <Text numberOfLines={2} style={{ color: colors.bg, fontSize: fontSize.small, fontWeight: '600', textAlign: 'center' }}>
                {message}
              </Text>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
