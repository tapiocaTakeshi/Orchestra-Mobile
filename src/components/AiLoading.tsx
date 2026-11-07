/**
 * AI のローディング (返答の生成中・エージェントの作業中) に出す、赤い回転矢印のアニメーション。
 * 元の GIF (16 コマ, 90ms/コマ) を背景を透過した 1 枚のスプライト (assets/ai-loading-sprite.png, 64px × 16 コマ) にし、
 * 枠の中でずらしてコマ送りする。ネイティブドライバーで動かすので再描画は起きない。動きを減らす設定では 1 コマ目で止める。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleProp, View, ViewStyle } from 'react-native';

const SPRITE = require('../../assets/ai-loading-sprite.png');
const FRAMES = 16;
const FRAME_MS = 90;

export const AiLoading = ({ size = 18, style, accessibilityLabel }: {
	size?: number;
	style?: StyleProp<ViewStyle>;
	/** 読み上げる文言 (無ければ読み上げない飾り) */
	accessibilityLabel?: string;
}) => {
	const frame = useRef(new Animated.Value(0)).current;
	const [reduceMotion, setReduceMotion] = useState(false);

	useEffect(() => {
		let alive = true;
		AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (alive) setReduceMotion(!!v); }).catch(() => {});
		const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => setReduceMotion(!!v));
		return () => { alive = false; sub?.remove?.(); };
	}, []);

	useEffect(() => {
		if (reduceMotion) {
			frame.setValue(0);
			return;
		}
		const loop = Animated.loop(Animated.timing(frame, {
			toValue: FRAMES,
			duration: FRAMES * FRAME_MS,
			easing: Easing.linear,
			useNativeDriver: true,
		}));
		loop.start();
		return () => loop.stop();
	}, [frame, reduceMotion]);

	// 0..16 の連続値を、コマごとの段差 (0, -size, -2size, …) に変える
	const translateX = useMemo(() => {
		const input: number[] = [];
		const output: number[] = [];
		for (let i = 0; i < FRAMES; i++) {
			input.push(i, i + 0.999);
			output.push(-i * size, -i * size);
		}
		input.push(FRAMES);
		output.push(-(FRAMES - 1) * size);
		return frame.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' });
	}, [frame, size]);

	return (
		<View
			accessible={!!accessibilityLabel}
			accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
			accessibilityLabel={accessibilityLabel}
			importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
			style={[{ width: size, height: size, overflow: 'hidden' }, style]}
		>
			<Animated.Image
				source={SPRITE}
				style={{ width: size * FRAMES, height: size, transform: [{ translateX }] }}
				resizeMode='stretch'
				fadeDuration={0}
			/>
		</View>
	);
};
