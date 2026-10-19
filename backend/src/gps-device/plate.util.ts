/**
 * 车牌归一化：大写、去空格/连字符/中点，便于设备登记的车牌与司机接单时输入的车牌匹配。
 *
 * 单独放一个文件，是为了避免 import 成环：
 * geofence.service 需要它，而 gps-device.service 需要 device-alarm.service、
 * device-alarm.service 又需要 geofence.service。如果这个函数留在 gps-device.service 里，
 * 三个文件就会首尾相接；成环之后谁先被加载，谁的 `design:paramtypes` 里就会出现 undefined，
 * Nest 启动时报 "can't resolve dependencies"，而且只在某些入口顺序下复现。
 */
export function normalizePlate(plate: string | null | undefined): string {
  return String(plate ?? '').toUpperCase().replace(/[\s\-·•.]/g, '');
}
