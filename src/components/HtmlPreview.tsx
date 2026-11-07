/**
 * デザインの HTML ページをそのまま描く。iOS / Android は WebView、Web 版は iframe (srcDoc)。
 * ページの中のスクリプトは動かす (デザインのタブ切り替えなど) が、外のサイトへは移動させない。
 */

import React, { useEffect, useRef } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius } from '../theme';

type WebViewProps = {
	source: { html: string };
	originWhitelist: string[];
	style?: StyleProp<ViewStyle>;
	onShouldStartLoadWithRequest?: (req: { url: string }) => boolean;
	setSupportMultipleWindows?: boolean;
	nestedScrollEnabled?: boolean;
	onMessage?: (event: { nativeEvent: { data: string } }) => void;
};

// Web 版 (と Jest) には WebView が無いので、ネイティブのときだけ読み込む
const NativeWebView: React.ComponentType<WebViewProps> | null =
	Platform.OS === 'web' ? null : (require('react-native-webview') as { WebView: React.ComponentType<WebViewProps> }).WebView;

export const HtmlPreview = ({ html, style, accessibilityLabel = 'デザインのプレビュー', onMessage }: {
	html: string;
	style?: StyleProp<ViewStyle>;
	accessibilityLabel?: string;
	/** ページの中から送られたもの (見た目の編集で使う)。Web 版は parent.postMessage、ネイティブは ReactNativeWebView.postMessage */
	onMessage?: (data: unknown) => void;
}) => {
	const frameRef = useRef<{ contentWindow?: Window | null } | null>(null);
	const onMessageRef = useRef(onMessage);
	onMessageRef.current = onMessage;
	const listens = !!onMessage;
	useEffect(() => {
		// Web 版: この iframe から来たものだけ受け取る
		if (NativeWebView || !listens || typeof window === 'undefined') return;
		const handler = (e: MessageEvent) => {
			if (frameRef.current?.contentWindow && e.source === frameRef.current.contentWindow) onMessageRef.current?.(e.data);
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [listens]);
	return (
		<View style={[styles.frame, style]} accessibilityLabel={accessibilityLabel}>
			{NativeWebView ? (
				<NativeWebView
					source={{ html }}
					originWhitelist={['*']}
					style={styles.fill}
					nestedScrollEnabled
					setSupportMultipleWindows={false}
					// 最初の読み込み (about:blank / data:) だけ通し、リンクで外へ出ない
					onShouldStartLoadWithRequest={req => /^(about:|data:)/.test(req.url) || req.url === 'about:blank'}
					{...(onMessage ? { onMessage: (e: { nativeEvent: { data: string } }) => onMessageRef.current?.(e.nativeEvent.data) } : {})}
				/>
			) : (
				React.createElement('iframe', {
					ref: frameRef,
					srcDoc: html,
					title: accessibilityLabel,
					sandbox: 'allow-scripts',
					style: { border: 'none', width: '100%', height: '100%', backgroundColor: '#fff' },
				})
			)}
		</View>
	);
};

const styles = StyleSheet.create({
	frame: { overflow: 'hidden', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
	fill: { flex: 1, backgroundColor: '#fff' },
});
