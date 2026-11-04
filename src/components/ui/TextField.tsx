import React, { forwardRef, useState } from 'react';
import { TextInput, TextInputProps } from 'react-native';
import { useTheme } from '../../design/theme';

/** mock の .input（44 高、radius-md、フォーカスで accent-text の枠） */
export const TextField = forwardRef<TextInput, TextInputProps>(function TextField(
  { style, onFocus, onBlur, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={t.colors.fgFaint}
      {...rest}
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
          minHeight: 44,
          paddingHorizontal: t.space.md,
          borderWidth: 1,
          borderColor: focused ? t.colors.accentText : t.colors.border,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.bgInput,
          color: t.colors.fg,
          fontSize: 15,
          fontFamily: t.fonts.body,
        },
        style,
      ]}
    />
  );
});
