import { defaults, types } from 'pg';
import { prepareValue } from 'pg/lib/utils';
import { parseUtcTimestamp } from './pg-utc';

/**
 * 容器时区是 Pacific/Auckland，数据库会话是 UTC。这组测试钉住驱动层的约定：
 * 「不带时区」的列里的文字就是 UTC，Date 写进去也按 UTC —— 和进程时区无关。
 */
// 生产容器的时区。CI 机器是 UTC，不设的话去掉 pg-utc 这组测试照样全绿、什么也证明不了
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Pacific/Auckland'; });
afterAll(() => { process.env.TZ = originalTz; });

describe('pg-utc: timestamp without time zone is UTC on both sides', () => {
  it('reads the stored text as UTC (the DEFAULT now() value is UTC wall time)', () => {
    const parse = types.getTypeParser(1114) as (v: string) => Date;
    expect(parse('2026-06-29 11:40:26.078159').toISOString()).toBe('2026-06-29T11:40:26.078Z');
    expect(parse('2026-09-28 02:31:08').toISOString()).toBe('2026-09-28T02:31:08.000Z');
  });

  it('hands unusual values back to the default parser instead of producing an Invalid Date', () => {
    expect(parseUtcTimestamp('infinity')).toBe(Infinity); // 驱动默认解析给的就是 Infinity
  });

  it('writes Dates as UTC so they compare correctly with now() in SQL', () => {
    expect(defaults.parseInputDatesAsUTC).toBe(true);
    expect(prepareValue(new Date('2026-09-28T02:31:08.778Z'))).toBe('2026-09-28T02:31:08.778+00:00');
  });

  it('round-trips a Date through write + read unchanged', () => {
    const d = new Date('2026-09-28T02:31:08.778Z');
    const written = String(prepareValue(d)).replace('T', ' ').replace('+00:00', '');
    expect((types.getTypeParser(1114) as (v: string) => Date)(written).getTime()).toBe(d.getTime());
  });
});
