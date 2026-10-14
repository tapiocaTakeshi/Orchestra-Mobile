/**
 * テスト用の react-native-safe-area-context スタブ。
 * 実機ではノッチやホームバーを避けるための余白を提供するが、テストで検証するのは
 * 画面の操作 (接続・ログアウト・ページ遷移) であり、余白の計算ではないため、
 * 子要素をそのまま描く View で代用する。
 */

import React from 'react';
import { View, ViewProps } from 'react-native';

export const SafeAreaView = ({ children, style }: ViewProps) =>
	React.createElement(View, { style }, children);

export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });

export const SafeAreaProvider = ({ children }: { children?: React.ReactNode }) =>
	React.createElement(React.Fragment, null, children);
