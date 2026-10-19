import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { SystemSettingsService } from './system-settings.service';

function build(savedPassword: string | null) {
  const repo = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async ({ where }: any) =>
      where.key === 'clear_data_password' && savedPassword !== null
        ? { key: 'clear_data_password', value: savedPassword }
        : null,
    ),
    save: jest.fn(async (d) => d),
  };
  const dataSource = { query: jest.fn(async (..._args: any[]) => undefined) };
  return { service: new SystemSettingsService(repo as any, dataSource as any), repo, dataSource };
}

describe('SystemSettingsService.getNumber', () => {
  it('falls back when the stored value is not a positive number', async () => {
    const repo = { findOne: jest.fn(async () => ({ value: 'abc' })) } as any;
    const service = new SystemSettingsService(repo, {} as any);
    expect(await service.getNumber('gps_stationary_minutes', 15)).toBe(15);
  });

  it('returns the stored numeric value when valid', async () => {
    const repo = { findOne: jest.fn(async () => ({ value: '30' })) } as any;
    const service = new SystemSettingsService(repo, {} as any);
    expect(await service.getNumber('gps_stationary_minutes', 15)).toBe(30);
  });
});

describe('SystemSettingsService.clearData', () => {
  it('refuses to clear when no clear-data password has been set', async () => {
    const { service, dataSource } = build(null);
    await expect(service.clearData('anything')).rejects.toThrow(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('refuses to clear when the password is wrong', async () => {
    const { service, dataSource } = build(await bcrypt.hash('secret', 12));
    await expect(service.clearData('wrong')).rejects.toThrow(UnauthorizedException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('truncates ALL seven business tables (with CASCADE) when the password matches', async () => {
    const { service, dataSource } = build(await bcrypt.hash('secret', 12));
    const result = await service.clearData('secret');
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const sql = dataSource.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/TRUNCATE TABLE/);
    expect(sql).toMatch(/RESTART IDENTITY CASCADE/);
    for (const table of [
      'gps_logs', 'gps_anomalies', 'adjustment_logs', 'work_records',
      'notifications', 'announcements', 'tasks',
    ]) {
      expect(sql).toContain(table);
      expect(result.cleared).toContain(table);
    }
  });

  it('refuses an empty password even if none is set (no "" === "" bypass)', async () => {
    const { service, dataSource } = build(null);
    await expect(service.clearData('')).rejects.toThrow(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});

describe('SystemSettingsService.getAll', () => {
  it('redacts the clear-data password and returns only a "set" flag', async () => {
    const repo = { find: jest.fn(async () => [{ key: 'clear_data_password', value: 'secret' }]) } as any;
    const service = new SystemSettingsService(repo, {} as any);
    const all = await service.getAll();
    expect(all.clear_data_password).toBe('');
    expect(all.clear_data_password_set).toBe('1');
  });
});

describe('SystemSettingsService.setMany', () => {
  it('persists only whitelisted keys and ignores unknown keys', async () => {
    const { service, repo } = build(null);
    await service.setMany({ gps_alarm_repeat: '5', evil_key: 'x' } as any);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith({ key: 'gps_alarm_repeat', value: '5' });
  });

  it('stores the clear-data password as a bcrypt hash, never plaintext', async () => {
    const { service, repo } = build(null);
    await service.setMany({ clear_data_password: 'myPlainPw' } as any);
    const call = repo.save.mock.calls.find((c: any) => c[0].key === 'clear_data_password');
    expect(call).toBeTruthy();
    const stored = call[0].value as string;
    expect(stored).not.toBe('myPlainPw');
    expect(stored.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('myPlainPw', stored)).toBe(true);
  });
});
