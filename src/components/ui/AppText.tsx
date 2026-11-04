import React from 'react';
import { Text, TextProps } from 'react-native';
import { TypeVariant, useTheme } from '../../design/theme';
import { ColorName } from '../../design/tokens';

export type AppTextProps = TextProps & {
  variant?: TypeVariant;
  color?: ColorName;
};

export function AppText({ variant = 'body', color, style, ...rest }: AppTextProps) {
  const t = useTheme();
  return <Text {...rest} style={[t.type[variant], color ? { color: t.colors[color] } : null, style]} />;
}
