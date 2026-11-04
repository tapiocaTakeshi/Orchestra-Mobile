import { useContext } from 'react';
import { Platform, StatusBar } from 'react-native';
import { EdgeInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';

/**
 * SafeAreaProvider があればその値を、無ければプラットフォーム既定値を返す。
 * （Provider 未設定のルートでもクラッシュさせないため）
 */
export function useSafeInsets(): EdgeInsets {
  const ctx = useContext(SafeAreaInsetsContext);
  if (ctx) return ctx;
  if (Platform.OS === 'android') {
    return { top: StatusBar.currentHeight ?? 0, bottom: 0, left: 0, right: 0 };
  }
  if (Platform.OS === 'ios') {
    return { top: 44, bottom: 34, left: 0, right: 0 };
  }
  return { top: 0, bottom: 0, left: 0, right: 0 };
}
