/**
 * 在真实数据库上验证 GPS 清理任务的 SQL —— 只做 EXPLAIN，不删任何数据。
 *
 * 为什么需要它：清理 SQL 的单元测试用的是模拟仓库，只检查字符串，
 * 查不出类型错误。2026-09-24 凌晨第一次真跑时报了
 *   operator does not exist: character varying = uuid
 * 而当时 9 个单元测试全部是绿的。
 *
 * 做法：用编译后的真实 GpsCleanupService，把它的 query() 换成
 * 「在同一条 SQL 前面加 EXPLAIN 再发给数据库」。这样验证的是服务实际生成的 SQL，
 * 不是手抄的一份。EXPLAIN（不带 ANALYZE）只做解析和规划：列、类型、运算符都会检查，
 * 但语句不会执行。外面再包一层 BEGIN / ROLLBACK 作为第二道保险。
 *
 * 用法（凭据由 Railway 注入，不落地、不打印）：
 *   npm run build && railway run node scripts/verify-cleanup-sql.js
 */
const { Client } = require('pg');
const { GpsCleanupService } = require('../dist/gps/gps-cleanup.service');

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query('BEGIN');

  try {
    const col = await client.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'gps_logs' AND column_name = 'task_id'`,
    );
    console.log('gps_logs.task_id type in this database:', col.rows[0]?.data_type ?? '(not found)');

    const planned = [];
    const gpsRepo = {
      query: async (sql, params) => {
        await client.query('EXPLAIN ' + sql, params);
        planned.push(sql.includes('ROW_NUMBER') ? 'downsample' : 'purge');
        return [[], 0]; // 让服务以为「删完了」，每条语句只规划一次
      },
    };

    // 两条路径都要验：有进行中任务时才会拼出那条出过错的排除子句
    for (const [label, ids] of [
      ['with in-progress tasks (the path that failed at 3am)', ['00000000-0000-0000-0000-000000000001']],
      ['with no in-progress tasks', []],
    ]) {
      planned.length = 0;
      const taskRepo = { find: async () => ids.map((id) => ({ id })) };
      const settings = { getNumber: async (_k, fallback) => fallback };
      const service = new GpsCleanupService(gpsRepo, taskRepo, settings);

      // 服务自己会吞掉异常只打日志，这里要能看到它，所以临时接管 logger
      let failure = null;
      service.logger = { log: () => {}, error: (m) => { failure = m; }, warn: () => {} };
      await service.cleanupOldGps();

      if (failure) {
        console.log(`FAIL  ${label}: ${failure}`);
        process.exitCode = 1;
      } else {
        console.log(`OK    ${label}: planned ${planned.join(' + ')}`);
      }
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((e) => {
  console.error('verification could not run:', e.message);
  process.exitCode = 1;
});
