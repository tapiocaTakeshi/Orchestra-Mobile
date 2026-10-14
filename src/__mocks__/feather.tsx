/**
 * テスト用の Feather アイコン・スタブ。
 * 本物は expo-font / expo-modules-core (ESM) に依存し、ts-jest + node 環境では
 * 変換できないため、色・サイズを props として保持するだけの軽量な表示部品で代用する。
 * アイコンの「色」は主役行の強調 (primary) の検証に使うので、props をそのまま残す。
 */

import React from 'react';
import { Text } from 'react-native';

type FeatherProps = {
	name?: string;
	color?: string;
	size?: number;
	accessible?: boolean;
};

const Feather = ({ name, color, size }: FeatherProps) =>
	React.createElement(
		Text,
		{ testID: `icon-${name ?? 'unknown'}`, style: { color, fontSize: size } },
		name,
	);

export default Feather;
