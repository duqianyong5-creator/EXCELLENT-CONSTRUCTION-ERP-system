import 'reflect-metadata';
// 入口顺序故意反着来：先加载 geofence.service。
// 如果这三个文件之间 import 成环，这个顺序会让某个类的 design:paramtypes 里出现 undefined。
import { GeofenceService } from './geofence.service';
import { DeviceAlarmService } from './device-alarm.service';
import { GpsDeviceService } from './gps-device.service';
import { GpsDeviceController } from './gps-device.controller';
import { GeofenceController } from './geofence.controller';
import { DeviceOfflineWatcher } from './device-offline.watcher';
import { Jt808Server } from './jt808.server';

/**
 * 构造函数注入靠的是 TypeScript 发出的 design:paramtypes 元数据。
 * 一旦 import 成环，环里某个类在被装饰的那一刻还没定义，元数据里就是 undefined，
 * Nest 启动时报 "Nest can't resolve dependencies ... at index [n]"。
 * 麻烦的是它只在某些入口加载顺序下复现，单元测试直接 new 出来是发现不了的 —— 所以在这里钉死。
 */
describe('依赖注入元数据不受 import 顺序影响', () => {
  const targets: Array<[string, any, number]> = [
    ['GpsDeviceService', GpsDeviceService, 5],
    ['DeviceAlarmService', DeviceAlarmService, 3],
    ['GeofenceService', GeofenceService, 1],
    ['GpsDeviceController', GpsDeviceController, 2],
    ['GeofenceController', GeofenceController, 1],
    ['DeviceOfflineWatcher', DeviceOfflineWatcher, 4],
  ];

  it.each(targets)('%s has no undefined constructor dependency', (_name, target, count) => {
    const params = Reflect.getMetadata('design:paramtypes', target) as any[];
    expect(params).toHaveLength(count as number);
    params.forEach((p, i) => {
      expect(`${_name}[${i}]=${p === undefined ? 'undefined' : 'ok'}`).toBe(`${_name}[${i}]=ok`);
    });
  });

  it('GpsDeviceService really receives DeviceAlarmService, not a stale partial module export', () => {
    const params = Reflect.getMetadata('design:paramtypes', GpsDeviceService) as any[];
    expect(params).toContain(DeviceAlarmService);
  });

  it('DeviceOfflineWatcher receives the gateway and the alarm service', () => {
    const params = Reflect.getMetadata('design:paramtypes', DeviceOfflineWatcher) as any[];
    expect(params).toEqual(expect.arrayContaining([Jt808Server, GpsDeviceService, DeviceAlarmService]));
  });

  it('DeviceAlarmService really receives GeofenceService', () => {
    const params = Reflect.getMetadata('design:paramtypes', DeviceAlarmService) as any[];
    expect(params).toContain(GeofenceService);
  });
});
