import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { notificationsApi, announcementsApi } from './api';
import { tr } from './i18n';

const BG_TASK = 'ect-task-notifications';
const SEEN_KEY = 'notif_seen_ids';
const ANNOUNCE_NOTIFIED_KEY = 'announce_notified_ids';

// How a notification is presented while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function getSeenIds(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function setSeenIds(ids: string[]) {
  try {
    await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(ids.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

/**
 * Fetch the latest notifications and fire a local (system) notification for any
 * unread item we haven't already surfaced. Works in both foreground polling and
 * the background-fetch task.
 */
export async function checkAndNotify(): Promise<number> {
  const token = await SecureStore.getItemAsync('token');
  if (!token) return 0;

  let items: any[] = [];
  try {
    const res: any = await notificationsApi.list();
    items = Array.isArray(res) ? res : [];
  } catch {
    return 0;
  }

  const seen = await getSeenIds();
  const seenSet = new Set(seen);
  const fresh = items.filter((n) => n && n.id && !n.isRead && !seenSet.has(n.id));

  for (const n of fresh) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: n.title || 'New task',
        body: n.content || '',
        data: { taskId: n?.meta?.taskId },
      },
      trigger: null, // deliver immediately
    });
  }

  if (items.length) {
    const merged = [...items.map((n) => n.id), ...seen];
    await setSeenIds(Array.from(new Set(merged)));
  }
  return fresh.length;
}

/**
 * Fetch active announcements for the current role and fire a local notification
 * for any we haven't already surfaced. Deduped via its own seen-set so each
 * announcement pushes exactly once (works in foreground polling and background fetch).
 */
export async function checkAnnouncementsAndNotify(): Promise<number> {
  const token = await SecureStore.getItemAsync('token');
  if (!token) return 0;

  let items: any[] = [];
  try {
    const res: any = await announcementsApi.feed();
    items = Array.isArray(res) ? res : [];
  } catch {
    return 0;
  }
  if (!items.length) return 0;

  let notified: string[] = [];
  try {
    const raw = await SecureStore.getItemAsync(ANNOUNCE_NOTIFIED_KEY);
    notified = raw ? JSON.parse(raw) : [];
  } catch { /* ignore */ }
  const notifiedSet = new Set(notified);
  const fresh = items.filter((a) => a && a.id && !notifiedSet.has(a.id));

  for (const a of fresh) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `📢 ${a.title || tr('ann.title')}`,
        body: a.content || '',
        data: { announcement: true },
      },
      trigger: null, // deliver immediately
    });
  }

  try {
    const merged = Array.from(new Set([...items.map((a) => a.id), ...notified]));
    await SecureStore.setItemAsync(ANNOUNCE_NOTIFIED_KEY, JSON.stringify(merged.slice(-200)));
  } catch { /* ignore */ }
  return fresh.length;
}

// Background-fetch task: runs periodically even when the app is backgrounded.
TaskManager.defineTask(BG_TASK, async () => {
  try {
    const [tasks, announce] = await Promise.all([
      checkAndNotify(),
      checkAnnouncementsAndNotify(),
    ]);
    return tasks + announce > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function registerTaskNotifications() {
  const ok = await ensureNotificationPermission();
  if (!ok) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Task notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  try {
    const already = await TaskManager.isTaskRegisteredAsync(BG_TASK);
    if (!already) {
      await BackgroundFetch.registerTaskAsync(BG_TASK, {
        minimumInterval: 60 * 15, // 15 min (the OS may throttle further)
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch {
    /* background fetch unavailable (e.g. Expo Go) — foreground polling still works */
  }
}

export async function unregisterTaskNotifications() {
  try {
    const already = await TaskManager.isTaskRegisteredAsync(BG_TASK);
    if (already) await BackgroundFetch.unregisterTaskAsync(BG_TASK);
  } catch {
    /* ignore */
  }
}
