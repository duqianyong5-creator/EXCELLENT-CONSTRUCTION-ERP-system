import { RucAlertLevel, assessRuc, applyDistance, RucThresholds } from './ruc.util';

const TH: RucThresholds = { warnKm: 500, criticalKm: 200, warnDays: 3 };

// 新西兰 RUC 是按里程买的：一张许可覆盖到某个里程读数，跑过那个读数之前必须续买。
// 所以判断依据永远是「还剩多少公里」，不是「还剩几天」——天数只是拿来预估什么时候会用完。
describe('assessRuc', () => {
  const base = {
    odometerKm: 120_500,
    rucEndKm: 121_000,
    avgDailyKm: 0,
    thresholds: TH,
  };

  it('reports how many kilometres are left on the licence', () => {
    expect(assessRuc({ ...base, odometerKm: 120_000 }).remainingKm).toBe(1000);
  });

  it('is OK while there is plenty left', () => {
    expect(assessRuc({ ...base, odometerKm: 119_000 }).level).toBe(RucAlertLevel.OK);
  });

  it('warns once the remaining distance drops below the warning threshold', () => {
    expect(assessRuc({ ...base, odometerKm: 120_600 }).level).toBe(RucAlertLevel.WARN); // 剩 400
  });

  it('escalates when the remaining distance is nearly gone', () => {
    expect(assessRuc({ ...base, odometerKm: 120_900 }).level).toBe(RucAlertLevel.CRITICAL); // 剩 100
  });

  it('flags driving past the licence as the most serious state', () => {
    // 超出许可继续跑在新西兰是要被罚的，这一级不能和「快用完」混在一起
    const r = assessRuc({ ...base, odometerKm: 121_200 });
    expect(r.level).toBe(RucAlertLevel.EXCEEDED);
    expect(r.remainingKm).toBe(-200);
  });

  it('warns on projected days even when the remaining distance still looks comfortable', () => {
    // 每天跑 300 公里，剩 700 公里 = 两天多就用完，按公里数还不到阈值，但必须提前提醒
    const r = assessRuc({ ...base, odometerKm: 120_300, avgDailyKm: 300 });
    expect(r.remainingKm).toBe(700);
    expect(r.projectedDays).toBeCloseTo(2.33, 1);
    expect(r.level).toBe(RucAlertLevel.WARN);
  });

  it('does not project a date when the vehicle is not moving', () => {
    const r = assessRuc({ ...base, odometerKm: 119_000, avgDailyKm: 0 });
    expect(r.projectedDays).toBeNull();
    expect(r.projectedExhaustedAt).toBeNull();
  });

  it('returns an unknown state when there is no licence on file (never silently OK)', () => {
    const r = assessRuc({ ...base, rucEndKm: null });
    expect(r.level).toBe(RucAlertLevel.UNKNOWN);
    expect(r.remainingKm).toBeNull();
  });

  it('returns an unknown state when we have no odometer estimate yet', () => {
    expect(assessRuc({ ...base, odometerKm: null }).level).toBe(RucAlertLevel.UNKNOWN);
  });
});

// 里程估算：车载定位器自己有里程计，设备换了/重置了会跳变，不能直接相信
describe('applyDistance', () => {
  it('adds the distance the tracker reports between two updates', () => {
    const r = applyDistance({ odometerKm: 1000, lastDeviceOdoKm: 500 }, { deviceOdoKm: 520 });
    expect(r.odometerKm).toBe(1020);
    expect(r.lastDeviceOdoKm).toBe(520);
  });

  it('starts tracking from the first reading without inventing distance', () => {
    const r = applyDistance({ odometerKm: 1000, lastDeviceOdoKm: null }, { deviceOdoKm: 88_000 });
    expect(r.odometerKm).toBe(1000); // 不能把设备里程当成车辆里程直接加上去
    expect(r.lastDeviceOdoKm).toBe(88_000);
  });

  it('ignores a counter that goes backwards (device replaced or reset)', () => {
    const r = applyDistance({ odometerKm: 1000, lastDeviceOdoKm: 500 }, { deviceOdoKm: 10 });
    expect(r.odometerKm).toBe(1000);
    expect(r.lastDeviceOdoKm).toBe(10); // 重新以新计数为基准
  });

  it('ignores an implausible jump instead of destroying the estimate', () => {
    // 一次上报之间不可能跑几千公里；信了就会把 RUC 估算彻底带偏
    const r = applyDistance({ odometerKm: 1000, lastDeviceOdoKm: 500 }, { deviceOdoKm: 9000 });
    expect(r.odometerKm).toBe(1000);
    expect(r.lastDeviceOdoKm).toBe(9000);
  });

  it('falls back to GPS distance when the tracker reports no odometer', () => {
    const r = applyDistance({ odometerKm: 1000, lastDeviceOdoKm: null }, { gpsKm: 12.5 });
    expect(r.odometerKm).toBe(1012.5);
  });

  it('prefers the tracker odometer over GPS distance when both are present', () => {
    // GPS 采样会漏掉弯道、停车时又会因漂移虚增，设备自己的里程计更接近真实
    const r = applyDistance({ odometerKm: 1000, lastDeviceOdoKm: 500 }, { deviceOdoKm: 520, gpsKm: 99 });
    expect(r.odometerKm).toBe(1020);
  });

  it('ignores GPS noise while the vehicle is parked', () => {
    const r = applyDistance({ odometerKm: 1000, lastDeviceOdoKm: null }, { gpsKm: 0.004 });
    expect(r.odometerKm).toBe(1000);
  });

  it('does nothing when there is no odometer baseline at all', () => {
    const r = applyDistance({ odometerKm: null, lastDeviceOdoKm: null }, { gpsKm: 10 });
    expect(r.odometerKm).toBeNull(); // 没校准过就没有可信基准，别编一个出来
  });
});
