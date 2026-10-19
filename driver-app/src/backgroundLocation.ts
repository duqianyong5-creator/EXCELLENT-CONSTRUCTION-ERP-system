import BackgroundGeolocation from 'react-native-background-geolocation';
import * as SecureStore from 'expo-secure-store';
import { gpsApi } from './api';
import { tr } from './i18n';

// 用 Transistorsoft 的原生定位引擎:熄屏/切后台/被杀都靠原生层持续追踪,
// 不依赖 JS 一直醒着(这正是 expo-location 熄屏掉点的原因)。
// 注:该库 5.2 的 TS 类型定义不全,运行期 API 稳定且有官方文档,这里用宽松别名调用。
const BG: any = BackgroundGeolocation;

const ACTIVE_KEY = 'gps_active_task_id';
let configured = false;
let currentTaskId: string | null = null;

async function uploadFromLocation(location: any): Promise<void> {
  let taskId = currentTaskId;
  if (!taskId) {
    try { taskId = await SecureStore.getItemAsync(ACTIVE_KEY); } catch { taskId = null; }
  }
  const c = location?.coords;
  if (!taskId || !c) return;
  try {
    await gpsApi.upload({
      taskId,
      latitude: c.latitude,
      longitude: c.longitude,
      speed: Math.max(0, (c.speed ?? 0) * 3.6), // m/s → km/h，与原有口径一致
      heading: typeof c.heading === 'number' && c.heading >= 0 ? c.heading : undefined,
      accuracy: c.accuracy ?? undefined,
    });
  } catch { /* 单次失败,引擎下一轮继续 */ }
}

// App 被系统杀死后仍上报(stopOnTerminate:false / startOnBoot 时生效)。
// 必须在模块顶层注册(本文件在 _layout 里被 import)。
const HeadlessTask = async (event: any) => {
  if (event?.name === 'location') {
    await uploadFromLocation(event.params);
  } else if (event?.name === 'heartbeat') {
    try {
      const loc = await BG.getCurrentPosition({ samples: 1, persist: false });
      await uploadFromLocation(loc);
    } catch { /* ignore */ }
  }
};
BG.registerHeadlessTask(HeadlessTask);

async function ensureConfigured(): Promise<void> {
  if (configured) return;

  BG.onLocation(
    (location: any) => { uploadFromLocation(location); },
    () => { /* 定位错误,忽略 */ },
  );
  // 静止时也定期上报一个点,保证仪表盘不掉线
  BG.onHeartbeat(async () => {
    try {
      const loc = await BG.getCurrentPosition({ samples: 1, persist: false });
      await uploadFromLocation(loc);
    } catch { /* ignore */ }
  });

  await BG.ready({
    desiredAccuracy: BG.DESIRED_ACCURACY_HIGH,
    distanceFilter: 10,
    locationUpdateInterval: 10000,
    fastestLocationUpdateInterval: 5000,
    stopTimeout: 5,
    heartbeatInterval: 60,
    stopOnTerminate: false,
    startOnBoot: true,
    enableHeadless: true,
    foregroundService: true,
    backgroundPermissionRationale: {
      title: tr('bg.permTitle'),
      message: tr('bg.permMsg'),
      positiveAction: tr('bg.permAction'),
    },
    notification: {
      title: tr('bg.notifTitle'),
      text: tr('bg.notifText'),
    },
    logLevel: BG.LOG_LEVEL_OFF,
  });
  configured = true;
}

// 返回 true 表示后台定位已接管(前后台/熄屏都上报)。
export async function startBackgroundGps(taskId: string): Promise<boolean> {
  try {
    currentTaskId = taskId;
    try { await SecureStore.setItemAsync(ACTIVE_KEY, taskId); } catch { /* ignore */ }
    await ensureConfigured();
    const state = await BG.getState();
    if (!state.enabled) {
      await BG.start();
    }
    // 立刻进入「移动」状态,不必等检测到运动,确保马上有点
    BG.changePace(true).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundGps(): Promise<void> {
  currentTaskId = null;
  try { await SecureStore.deleteItemAsync(ACTIVE_KEY); } catch { /* ignore */ }
  try { await BG.stop(); } catch { /* ignore */ }
}
