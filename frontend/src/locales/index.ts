/**
 * 每个页面一个语言文件，在这里汇总。
 *
 * 之所以拆开：页面的文案量很大（管理端原先有 700 多行硬编码中文），
 * 全塞进一个 i18n.ts 会变成谁都不敢动的巨型文件，也没法并行修改。
 * 键名按页面加前缀（`settings.*`、`tasks.*`），避免跨页面撞名。
 */

export interface LocaleBundle {
  zh: Record<string, string>;
  en: Record<string, string>;
}

import { announcements } from './announcements';
import { anomalies } from './anomalies';
import { client } from './client';
import { common } from './common';
import { dashboard } from './dashboard';
import { devices } from './devices';
import { driver } from './driver';
import { geofences } from './geofences';
import { layout } from './layout';
import { settings } from './settings';
import { tasks } from './tasks';
import { users } from './users';
import { vehicles } from './vehicles';
import { workRecords } from './work-records';

const BUNDLES: LocaleBundle[] = [
  announcements,
  anomalies,
  client,
  common,
  dashboard,
  devices,
  driver,
  geofences,
  layout,
  settings,
  tasks,
  users,
  vehicles,
  workRecords,
];

function merge(lang: keyof LocaleBundle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const bundle of BUNDLES) {
    for (const [key, value] of Object.entries(bundle[lang])) {
      // 撞名说明有人漏了页面前缀，开发时要立刻发现
      if (out[key] !== undefined && import.meta.env.DEV) {
        console.warn(`[i18n] duplicate key "${key}" — add a page prefix`);
      }
      out[key] = value;
    }
  }
  return out;
}

export const zhPages = merge('zh');
export const enPages = merge('en');
