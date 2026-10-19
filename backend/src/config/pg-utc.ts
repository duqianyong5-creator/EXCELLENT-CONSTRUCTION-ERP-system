import { defaults, types } from 'pg';

/**
 * 「不带时区」的时间列（timestamp without time zone）一律按 UTC 读写，和进程时区脱钩。
 *
 * 为什么需要：数据库会话时区是 UTC，列上的 DEFAULT now() 存的是 UTC 墙上时间；
 * 而 node-postgres 默认按「进程本地时区」读写这类列。容器原来是 UTC，两边碰巧一致。
 * 2026-09-22 容器设成 TZ=Pacific/Auckland（为了「今天」「早上 8 点」这些本地时间逻辑）之后，
 * 这类列全部被读早了 12~13 小时：异常报警时间、任务创建时间在后台都显示错；
 * 应用自己写进去的值又变成了新西兰墙上时间，和数据库里的 now() 比较差出半天。
 *
 * 这里把驱动层固定成 UTC：读 = 把列里的文字当 UTC 解析，写 = Date 按 UTC 序列化。
 * 这正是 9/22 之前容器还是 UTC 时的行为，已有数据不用迁移（那之后没有业务数据按新西兰时间写进去）。
 * 带时区的列（timestamptz）不受影响：它们的文字本身带偏移。
 *
 * 必须在建立任何数据库连接之前执行，所以 main.ts 第一行就 import 这个文件。
 */
const TIMESTAMP_WITHOUT_TZ = 1114;

const defaultParser = types.getTypeParser(TIMESTAMP_WITHOUT_TZ);

export function parseUtcTimestamp(value: string): unknown {
  // '2026-06-29 11:40:26.078159' -> 2026-06-29T11:40:26.078Z
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  // infinity / 公元前 等非常规值：交还给驱动的默认解析
  return Number.isNaN(parsed.getTime()) ? defaultParser(value) : parsed;
}

types.setTypeParser(TIMESTAMP_WITHOUT_TZ, parseUtcTimestamp);
defaults.parseInputDatesAsUTC = true;
