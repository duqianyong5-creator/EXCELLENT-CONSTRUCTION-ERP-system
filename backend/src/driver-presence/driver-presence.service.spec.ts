import { DriverPresenceService } from './driver-presence.service';

describe('DriverPresenceService', () => {
  it('returns active driver accounts that currently have an app socket connected', async () => {
    const gateway = {
      getOnlineDriverIds: jest.fn(() => ['driver-1', 'driver-3']),
    };
    const usersService = {
      findDrivers: jest.fn(async () => [
        { id: 'driver-1', username: 'test', fullName: 'Test Driver', email: 'test@example.com' },
        { id: 'driver-2', username: 'offline', fullName: 'Offline Driver', email: 'offline@example.com' },
      ]),
    };
    const gpsService = { getLatestPositions: jest.fn(async () => []) };
    const service = new DriverPresenceService(gateway as any, usersService as any, gpsService as any);

    await expect(service.findOnlineDrivers()).resolves.toEqual([
      { id: 'driver-1', username: 'test', fullName: 'Test Driver', email: 'test@example.com' },
    ]);
    expect(gateway.getOnlineDriverIds).toHaveBeenCalled();
    expect(usersService.findDrivers).toHaveBeenCalled();
  });

  it('counts a driver as online when actively uploading GPS even without a socket', async () => {
    const gateway = { getOnlineDriverIds: jest.fn(() => [] as string[]) };
    const usersService = {
      findDrivers: jest.fn(async () => [
        { id: 'driver-1', username: 'test', fullName: 'Test Driver', email: 'test@example.com' },
      ]),
    };
    const gpsService = { getLatestPositions: jest.fn(async () => [{ driverId: 'driver-1' }]) };
    const service = new DriverPresenceService(gateway as any, usersService as any, gpsService as any);

    await expect(service.findOnlineDrivers()).resolves.toEqual([
      { id: 'driver-1', username: 'test', fullName: 'Test Driver', email: 'test@example.com' },
    ]);
  });
});
