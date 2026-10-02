import { Platform } from 'react-native';

/**
 * Register this device for push and hand the Expo token to `save` so the server
 * can reach it. Best-effort: no-ops on web, simulators, and when permission is
 * denied, and never throws (push must never block app start).
 *
 * The token is an Expo push token (ExponentPushToken[...]), which the
 * notify-message edge function sends through Expo's push service — no raw APNs
 * / FCM wiring needed in the app.
 */
export async function registerPushToken(
  save: (token: string, platform: string) => Promise<void>,
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    const Device = (await import('expo-device')).default ?? (await import('expo-device'));
    // Push tokens only exist on physical devices.
    if ((Device as any)?.isDevice === false) return;

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    // Android needs a channel for notifications to display at all.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const Constants = (await import('expo-constants')).default;
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? (Constants as any)?.easConfig?.projectId;

    const resp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (resp?.data) await save(resp.data, Platform.OS);
  } catch {
    // Best-effort — a device without push just doesn't get notified.
  }
}
