import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { post } from './api';
import { SOUND_NAMES, soundChannel } from './sounds';

/**
 * Native push.
 *
 * A real difference from the web: the browser talks to a push service using
 * VAPID keys, while a phone gets a token from Expo's push service (which fans
 * out to APNs and FCM). The server stores both in the same table — an Expo
 * token is just a subscription with a different shape.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false, // off by default, same stance as the web app
  }),
});

/** One Android channel per tone, so per-person sounds actually work. */
export async function setupChannels() {
  if (Platform.OS !== 'android') return;
  for (const sound of SOUND_NAMES) {
    if (sound.id === 'none') continue;
    await Notifications.setNotificationChannelAsync(soundChannel(sound.id), {
      name: `Messages — ${sound.label}`,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 90, 40, 90],
      lightColor: '#C0603C',
    });
  }
  await Notifications.setNotificationChannelAsync('silent', {
    name: 'Messages — silent',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: [],
  });
}

export async function registerForPush(): Promise<boolean> {
  // A simulator has no push service to register with; it will always fail.
  if (!Device.isDevice) return false;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return false;

  await setupChannels();

  try {
    const token = await Notifications.getExpoPushTokenAsync();
    await post('/push/subscribe', {
      // The server's schema wants an endpoint + keys; an Expo token maps onto
      // it cleanly, which avoids a second table for the same concept.
      endpoint: `expo:${token.data}`,
      keys: { p256dh: 'expo', auth: token.data },
    });
    return true;
  } catch {
    return false;
  }
}

export async function disablePush() {
  try {
    const token = await Notifications.getExpoPushTokenAsync();
    await post('/push/unsubscribe', { endpoint: `expo:${token.data}` });
  } catch {
    /* nothing to unsubscribe */
  }
}
