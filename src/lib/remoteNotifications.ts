/** Expo local notifications for the active Orchestra remote session. */

import * as Notifications from 'expo-notifications';

let permissionChecked = false;
let permissionGranted = false;

const ensurePermission = async (): Promise<boolean> => {
	if (permissionChecked) return permissionGranted;
	permissionChecked = true;
	try {
		const current = await Notifications.getPermissionsAsync();
		if (current.status === 'granted') {
			permissionGranted = true;
			return true;
		}
		const requested = await Notifications.requestPermissionsAsync();
		permissionGranted = requested.status === 'granted';
		return permissionGranted;
	} catch {
		return false;
	}
};

export const notifyRemoteConnected = async (label: string): Promise<void> => {
	if (!await ensurePermission()) return;
	try {
		await Notifications.scheduleNotificationAsync({
			content: {
				title: 'Orchestra Mobile',
				body: `${label || 'Orchestra'} に接続しました。`,
				data: { kind: 'remote-connected' },
			},
			trigger: null,
		});
	} catch {
		// A notification failure must not break the remote connection.
	}
};

export const notifyRemoteEvent = async (title: string, body: string, kind: string): Promise<void> => {
	if (!await ensurePermission()) return;
	try {
		await Notifications.scheduleNotificationAsync({
			content: { title, body, data: { kind } },
			trigger: null,
		});
	} catch {
		// A notification failure must not break the remote session.
	}
};
