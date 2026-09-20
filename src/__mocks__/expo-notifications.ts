/**
 * jest (node 環境) 用の expo-notifications スタブ。
 *
 * 本物は ESM のまま配布されていて ts-jest が読めないため、テストでは
 * この薄いスタブに差し替える (package.json の moduleNameMapper)。
 * 通知は「出せなくても本筋は動く」扱いなので、常に拒否された体で返す。
 */

export const setNotificationHandler = (): void => { /* noop */ };

export const getPermissionsAsync = async (): Promise<{ status: string }> => ({ status: 'denied' });

export const requestPermissionsAsync = async (): Promise<{ status: string }> => ({ status: 'denied' });

export const scheduleNotificationAsync = async (): Promise<string> => 'stub-notification';
