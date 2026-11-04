import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, shadows, space } from '../../design/tokens';

export interface ToastHandle {
  show: (message: string) => void;
}

/** モックアップ .toast（下から 48px、1.8 秒表示） */
export const Toast = forwardRef<ToastHandle>(function Toast(_props, ref) {
  const [message, setMessage] = useState('');
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    show(next: string) {
      setMessage(next);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      }, 1800);
    },
  }));

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[styles.toast, { opacity: anim, transform: [{ translateY }] }]}
      >
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, bottom: space['2xl'], alignItems: 'center', zIndex: 100 },
  toast: {
    backgroundColor: colors.fgStrong,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    maxWidth: '100%',
    ...shadows.s3,
  },
  text: { color: colors.bg, fontSize: fontSize.small, fontWeight: '600', textAlign: 'center' },
});
