import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  GeofenceService, MIN_GEOFENCE_RADIUS_M, MAX_GEOFENCE_RADIUS_M,
} from './geofence.service';
import { ErrorCode } from '../common/i18n/messages';

const YARD = { lat: -36.8485, lng: 174.7633 };

function build(rows: any[] = []) {
  const store = [...rows];
  const repo = {
    store,
    find: jest.fn(async ({ where }: any = {}) =>
      (where?.enabled === true ? store.filter((f) => f.enabled) : store)),
    findOne: jest.fn(async ({ where }: any) => store.find((f) => f.id === where.id) ?? null),
    create: jest.fn((v: any) => ({ ...v })),
    save: jest.fn(async (v: any) => {
      if (!v.id) { v.id = `f${store.length + 1}`; store.push(v); }
      return v;
    }),
    delete: jest.fn(async (id: string) => {
      const i = store.findIndex((f) => f.id === id);
      if (i >= 0) store.splice(i, 1);
    }),
  };
  return { service: new GeofenceService(repo as any), repo };
}

const valid = { name: '公司场地', centerLat: YARD.lat, centerLng: YARD.lng, radiusM: 200 };

describe('GeofenceService CRUD', () => {
  it('creates a circle with sensible defaults', async () => {
    const { service } = build();
    const fence = await service.create(valid);
    expect(fence).toMatchObject({
      name: '公司场地', radiusM: 200, vehiclePlate: null,
      enabled: true, alertOnEnter: true, alertOnLeave: true,
    });
  });

  it('rounds the radius and keeps the plate as typed', async () => {
    const { service } = build();
    const fence = await service.create({ ...valid, radiusM: 250.6, vehiclePlate: ' abc-123 ' });
    expect(fence.radiusM).toBe(251);
    expect(fence.vehiclePlate).toBe('abc-123');
  });

  it('rejects a missing name', async () => {
    const { service } = build();
    await expect(service.create({ ...valid, name: '  ' })).rejects.toThrow(ErrorCode.GEOFENCE_NAME_REQUIRED);
  });

  it('rejects an out-of-range centre', async () => {
    const { service } = build();
    await expect(service.create({ ...valid, centerLat: 91 })).rejects.toThrow(ErrorCode.GEOFENCE_CENTER_INVALID);
    await expect(service.create({ ...valid, centerLng: 181 })).rejects.toThrow(ErrorCode.GEOFENCE_CENTER_INVALID);
    await expect(service.create({ ...valid, centerLat: 'north' as any })).rejects.toThrow(BadRequestException);
  });

  it('rejects a radius outside the usable range', async () => {
    const { service } = build();
    // 小于 20 米只是在报 GPS 噪声；大到几百公里就不是围栏了
    await expect(service.create({ ...valid, radiusM: MIN_GEOFENCE_RADIUS_M - 1 }))
      .rejects.toThrow(ErrorCode.GEOFENCE_RADIUS_INVALID);
    await expect(service.create({ ...valid, radiusM: MAX_GEOFENCE_RADIUS_M + 1 }))
      .rejects.toThrow(ErrorCode.GEOFENCE_RADIUS_INVALID);
  });

  it('404s on an unknown id', async () => {
    const { service } = build();
    await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    await expect(service.update('nope', { name: 'x' })).rejects.toThrow(ErrorCode.GEOFENCE_NOT_FOUND);
    await expect(service.remove('nope')).rejects.toThrow(ErrorCode.GEOFENCE_NOT_FOUND);
  });

  it('patches only the fields that were sent', async () => {
    const { service } = build();
    const created = await service.create(valid);
    const updated = await service.update(created.id, { alertOnLeave: false });
    expect(updated).toMatchObject({ name: '公司场地', radiusM: 200, alertOnEnter: true, alertOnLeave: false });
  });

  it('clears the plate when an empty string is sent (back to fleet-wide)', async () => {
    const { service } = build();
    const created = await service.create({ ...valid, vehiclePlate: 'ABC123' });
    expect((await service.update(created.id, { vehiclePlate: '' })).vehiclePlate).toBeNull();
  });
});

describe('GeofenceService.fencesFor', () => {
  const rows = [
    { id: 'all', name: '全车队', centerLat: 0, centerLng: 0, radiusM: 100, vehiclePlate: null, enabled: true },
    { id: 'abc', name: 'ABC 专用', centerLat: 0, centerLng: 0, radiusM: 100, vehiclePlate: 'abc-123', enabled: true },
    { id: 'xyz', name: 'XYZ 专用', centerLat: 0, centerLng: 0, radiusM: 100, vehiclePlate: 'XYZ999', enabled: true },
    { id: 'off', name: '停用的', centerLat: 0, centerLng: 0, radiusM: 100, vehiclePlate: null, enabled: false },
  ];

  it('matches the plate ignoring case, spaces and hyphens, plus the fleet-wide ones', async () => {
    const { service } = build(rows);
    expect((await service.fencesFor('ABC 123')).map((f) => f.id)).toEqual(['all', 'abc']);
  });

  it('gives an unbound vehicle only the fleet-wide fences', async () => {
    const { service } = build(rows);
    expect((await service.fencesFor(null)).map((f) => f.id)).toEqual(['all']);
  });

  it('never returns a disabled fence', async () => {
    const { service } = build(rows);
    const ids = (await service.fencesFor('XYZ999')).map((f) => f.id);
    expect(ids).toEqual(['all', 'xyz']);
    expect(ids).not.toContain('off');
  });

  it('caches so a 10-second position interval does not hammer the database', async () => {
    const { service, repo } = build(rows);
    for (let i = 0; i < 20; i++) await service.fencesFor('ABC123');
    expect(repo.find).toHaveBeenCalledTimes(1);
  });

  it('drops the cache as soon as a fence is created, changed or deleted', async () => {
    const { service, repo } = build(rows);
    await service.fencesFor('ABC123');
    await service.create(valid);
    await service.fencesFor('ABC123');
    expect(repo.find).toHaveBeenCalledTimes(2);

    await service.update('abc', { enabled: false });
    await service.fencesFor('ABC123');
    expect(repo.find).toHaveBeenCalledTimes(3);

    await service.remove('xyz');
    await service.fencesFor('ABC123');
    expect(repo.find).toHaveBeenCalledTimes(4);
  });
});
