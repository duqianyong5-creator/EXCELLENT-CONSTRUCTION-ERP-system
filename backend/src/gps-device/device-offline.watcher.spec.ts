import { Logger } from '@nestjs/common';
import {
  DeviceOfflineWatcher, OFFLINE_BOOT_GRACE_MS, OFFLINE_GRACE_MOVING_MS, OFFLINE_GRACE_PARKED_MS, OFFLINE_LOOKBACK_MS,
} from './device-offline.watcher';

const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 8, 28, 2, 40, 0);

function device(over: any = {}) {
  return {
    id: 'dev1', deviceNo: '18480027863', vehiclePlate: 'NTU781', enabled: true, externalPower: true,
    lastSeenAt: new Date(NOW - 3 * MIN), lastFixAt: new Date(NOW - 3 * MIN), lastSpeed: '0.00',
    ...over,
  };
}

function build(opts: { devices?: any[]; online?: string[]; port?: number | null; target?: any } = {}) {
  const repo = { find: jest.fn(async () => opts.devices ?? [device()]) };
  const server = {
    getPort: jest.fn(() => (opts.port === undefined ? 5023 : opts.port)),
    isOnline: jest.fn((no: string) => (opts.online ?? []).includes(no)),
  };
  const devices = { resolveTarget: jest.fn(async () => opts.target ?? null) };
  const alarms = { raiseOffline: jest.fn(async () => undefined) };
  const watcher = new DeviceOfflineWatcher(repo as any, server as any, devices as any, alarms as any);
  (watcher as any).startedAt = NOW - 60 * MIN; // 早就过了启动宽限期
  return { watcher, repo, server, devices, alarms };
}

beforeAll(() => { Logger.overrideLogger(false); });

describe('DeviceOfflineWatcher', () => {
  it('raises for a parked, mains-powered tracker that vanished more than 2 minutes ago', async () => {
    // 2026-09-28 的拔电测试：最后一帧 15:31:08，之后一个字节都没有
    const { watcher, alarms } = build();
    expect(await watcher.check(NOW)).toBe(1);
    expect(alarms.raiseOffline).toHaveBeenCalledWith(
      expect.objectContaining({ deviceNo: '18480027863' }),
      { lastSeenAt: new Date(NOW - 3 * MIN), moving: false, target: null },
    );
  });

  it('only asks the database for enabled, mains-powered devices seen within the look-back window', async () => {
    const { watcher, repo } = build();
    await watcher.check(NOW);
    const where = (repo.find.mock.calls[0] as any)[0].where;
    expect(where).toMatchObject({ enabled: true, externalPower: true });
    // Between(from, to)：FindOperator 的值是 [from, to]
    expect(where.lastSeenAt.value).toEqual([new Date(NOW - OFFLINE_LOOKBACK_MS), new Date(NOW - OFFLINE_GRACE_PARKED_MS)]);
  });

  it('leaves a device alone while its connection is still open (quiet is not gone)', async () => {
    const { watcher, alarms } = build({ online: ['18480027863'] });
    expect(await watcher.check(NOW)).toBe(0);
    expect(alarms.raiseOffline).not.toHaveBeenCalled();
  });

  it('gives a moving truck 30 minutes (valleys and tunnels drop the signal all the time)', async () => {
    const moving = device({ lastSpeed: '62.50', lastSeenAt: new Date(NOW - 10 * MIN), lastFixAt: new Date(NOW - 10 * MIN) });
    const early = build({ devices: [moving] });
    expect(await early.watcher.check(NOW)).toBe(0);

    const late = build({ devices: [{ ...moving, lastSeenAt: new Date(NOW - OFFLINE_GRACE_MOVING_MS - MIN), lastFixAt: new Date(NOW - OFFLINE_GRACE_MOVING_MS - MIN) }] });
    expect(await late.watcher.check(NOW)).toBe(1);
    expect((late.alarms.raiseOffline.mock.calls[0] as any)[1].moving).toBe(true);
  });

  it('does not call a truck "moving" on a stale speed from a fix long before it vanished', async () => {
    const stale = device({ lastSpeed: '62.50', lastFixAt: new Date(NOW - 3 * 60 * MIN) });
    const { watcher, alarms } = build({ devices: [stale] });
    expect(await watcher.check(NOW)).toBe(1);
    expect((alarms.raiseOffline.mock.calls[0] as any)[1].moving).toBe(false);
  });

  it('stays quiet right after a restart, while every tracker is still reconnecting', async () => {
    const { watcher, alarms } = build();
    (watcher as any).startedAt = NOW - OFFLINE_BOOT_GRACE_MS + MIN;
    expect(await watcher.check(NOW)).toBe(0);
    expect(alarms.raiseOffline).not.toHaveBeenCalled();
  });

  it('stays quiet when the gateway is not running (everything would look offline)', async () => {
    const { watcher, repo } = build({ port: null });
    expect(await watcher.check(NOW)).toBe(0);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('attaches the in-progress task of that plate so the alarm names the driver', async () => {
    const { watcher, alarms } = build({ target: { taskId: 't1', driverId: 'd1', createdAt: new Date() } });
    await watcher.check(NOW);
    expect((alarms.raiseOffline.mock.calls[0] as any)[1].target).toEqual({ taskId: 't1', driverId: 'd1' });
  });

  it('tick() never throws and never overlaps itself', async () => {
    const { watcher, repo } = build();
    let release!: () => void;
    repo.find.mockImplementationOnce(() => new Promise((r) => { release = () => r([]); }));
    (watcher as any).startedAt = 0;
    const first = watcher.tick();
    await watcher.tick(); // 上一轮还没结束：直接跳过
    expect(repo.find).toHaveBeenCalledTimes(1);
    release();
    await first;
    repo.find.mockRejectedValueOnce(new Error('db down'));
    await expect(watcher.tick()).resolves.toBeUndefined();
  });
});
