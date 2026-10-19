import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { UsersController } from '../users/users.controller';
import { TasksController } from '../tasks/tasks.controller';
import { GpsDeviceController } from '../gps-device/gps-device.controller';
import { RucController } from '../ruc/ruc.controller';
import { WorkRecordsController } from '../work-records/work-records.controller';

/**
 * Nest 按方法的声明顺序注册路由，Express 取第一个匹配的。
 * 所以 `@Patch(':id')` 若排在 `@Patch('profile')` 前面，
 * PATCH /users/profile 会被当成 id='profile' 交给管理员专用的 updateUser——
 * 结果是「全系统没人能改密码、司机存不了资料」，而且没有任何报错能指向原因。
 *
 * 这个用例扫描控制器，禁止「静态路径排在同 HTTP 方法的单段参数路由之后」。
 */
const CONTROLLERS = [
  UsersController,
  TasksController,
  GpsDeviceController,
  RucController,
  WorkRecordsController,
];

interface Route {
  handler: string;
  method: number;
  path: string;
}

function routesOf(ctrl: any): Route[] {
  const proto = ctrl.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .map((name) => {
      const fn = proto[name];
      const path = Reflect.getMetadata(PATH_METADATA, fn);
      const method = Reflect.getMetadata(METHOD_METADATA, fn);
      return path === undefined ? null : { handler: name, method, path: String(path) };
    })
    .filter((r): r is Route => r !== null);
}

/** ':id' —— 单段参数路由，会匹配任何同级的静态路径 */
function isSingleSegmentParam(path: string): boolean {
  const clean = path.replace(/^\//, '').replace(/\/$/, '');
  return /^:[^/]+$/.test(clean);
}

function isStaticSingleSegment(path: string): boolean {
  const clean = path.replace(/^\//, '').replace(/\/$/, '');
  return clean !== '' && !clean.includes('/') && !clean.includes(':');
}

describe('controller route declaration order', () => {
  for (const ctrl of CONTROLLERS) {
    it(`${ctrl.name}: no static path is shadowed by an earlier ':param' route`, () => {
      const routes = routesOf(ctrl);
      const shadowed: string[] = [];

      routes.forEach((route, i) => {
        if (!isStaticSingleSegment(route.path)) return;
        const earlierParam = routes
          .slice(0, i)
          .find((r) => r.method === route.method && isSingleSegmentParam(r.path));
        if (earlierParam) {
          shadowed.push(
            `${RequestMethod[route.method]} '${route.path}' (${route.handler}) is unreachable: ` +
              `'${earlierParam.path}' (${earlierParam.handler}) is declared earlier and matches it first`,
          );
        }
      });

      expect(shadowed).toEqual([]);
    });
  }

  it('pins the case that actually broke: PATCH profile / change-password come before PATCH :id', () => {
    // 同一个 ':id' 在 GET 和 PATCH 上各有一条，必须按方法比，否则比到的是 GET 那条
    const patches = routesOf(UsersController).filter((r) => r.method === RequestMethod.PATCH);
    const index = (p: string) => patches.findIndex((r) => r.path === p);

    const idAt = index(':id');
    expect(idAt).toBeGreaterThan(-1);
    expect(index('profile')).toBeGreaterThan(-1);
    expect(index('change-password')).toBeGreaterThan(-1);
    expect(index('profile')).toBeLessThan(idAt);
    expect(index('change-password')).toBeLessThan(idAt);
  });
});
