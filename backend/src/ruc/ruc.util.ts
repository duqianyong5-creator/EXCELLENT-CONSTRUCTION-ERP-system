/**
 * 新西兰 RUC（Road User Charges 路税）计算。
 *
 * RUC 是按「里程」买的，不是按时间：一张许可覆盖到某个里程读数，
 * 车辆跑到那个读数之前必须续买，超出后继续行驶会被处罚。
 * 所以这里所有判断都围绕「还剩多少公里」，天数只用来预估什么时候会用完。
 *
 * ⚠️ 法定依据是车上的 hubodometer（机械里程计）读数，本系统的里程是**估算值**，
 * 用于提前提醒，买许可时仍须以实际读数为准。
 */

export enum RucAlertLevel {
  /** 没登记许可 / 没有里程基准，无法判断——不能当成「正常」 */
  UNKNOWN = 'unknown',
  OK = 'ok',
  WARN = 'warn',
  CRITICAL = 'critical',
  /** 已经跑过许可覆盖的里程，属于违规行驶 */
  EXCEEDED = 'exceeded',
}

export interface RucThresholds {
  /** 剩余公里低于此值：提醒 */
  warnKm: number;
  /** 剩余公里低于此值：紧急 */
  criticalKm: number;
  /** 预计多少天内用完：提醒 */
  warnDays: number;
}

export interface RucAssessment {
  level: RucAlertLevel;
  remainingKm: number | null;
  projectedDays: number | null;
  projectedExhaustedAt: Date | null;
}

/** 单次上报之间可能出现的最大里程增量（公里）。超过这个值只可能是设备计数异常。 */
export const MAX_PLAUSIBLE_STEP_KM = 500;
/** 小于这个距离视为停车时的 GPS 漂移，不计入里程 */
const MIN_GPS_STEP_KM = 0.01;

export function assessRuc(input: {
  odometerKm: number | null;
  rucEndKm: number | null;
  avgDailyKm: number;
  thresholds: RucThresholds;
  now?: Date;
}): RucAssessment {
  const { odometerKm, rucEndKm, avgDailyKm, thresholds } = input;

  // 没有许可记录或没有里程估算时，明确返回「未知」。
  // 绝不能默默当成正常——那样车队会在毫不知情的情况下超出许可行驶。
  if (odometerKm == null || rucEndKm == null || !Number.isFinite(odometerKm) || !Number.isFinite(rucEndKm)) {
    return { level: RucAlertLevel.UNKNOWN, remainingKm: null, projectedDays: null, projectedExhaustedAt: null };
  }

  const remainingKm = round2(rucEndKm - odometerKm);

  const daily = Number.isFinite(avgDailyKm) && avgDailyKm > 0 ? avgDailyKm : 0;
  const projectedDays = daily > 0 && remainingKm > 0 ? round2(remainingKm / daily) : null;
  const projectedExhaustedAt = projectedDays != null
    ? new Date((input.now?.getTime() ?? Date.now()) + projectedDays * 24 * 3600 * 1000)
    : null;

  let level: RucAlertLevel;
  if (remainingKm <= 0) {
    level = RucAlertLevel.EXCEEDED;
  } else if (remainingKm <= thresholds.criticalKm) {
    level = RucAlertLevel.CRITICAL;
  } else if (remainingKm <= thresholds.warnKm) {
    level = RucAlertLevel.WARN;
  } else if (projectedDays != null && projectedDays <= thresholds.warnDays) {
    // 按公里还够，但照当前跑法很快就没了——跑长途的车全靠这条提前提醒
    level = RucAlertLevel.WARN;
  } else {
    level = RucAlertLevel.OK;
  }

  return { level, remainingKm, projectedDays, projectedExhaustedAt };
}

export interface OdometerState {
  /** 当前估算的车辆里程读数 */
  odometerKm: number | null;
  /** 车载定位器自身里程计的上次读数，用来算增量 */
  lastDeviceOdoKm: number | null;
}

/**
 * 用一次上报更新里程估算。
 * 优先用定位器自己的里程计（比 GPS 采样准），没有时退回用 GPS 两点间距离。
 */
export function applyDistance(
  state: OdometerState,
  report: { deviceOdoKm?: number | null; gpsKm?: number | null },
): OdometerState {
  const next: OdometerState = { ...state };
  const deviceOdo = numberOrNull(report.deviceOdoKm);

  if (deviceOdo != null) {
    const previous = state.lastDeviceOdoKm;
    next.lastDeviceOdoKm = deviceOdo;
    // 第一次见到这个计数器：只记基准，不能把设备里程当成车辆里程加进去。
    // 计数器倒退（换了设备/被重置）或一次跳变过大：同样只重置基准，不污染估算。
    if (previous != null && state.odometerKm != null) {
      const delta = deviceOdo - previous;
      if (delta > 0 && delta <= MAX_PLAUSIBLE_STEP_KM) {
        next.odometerKm = round2(state.odometerKm + delta);
      }
    }
    return next;
  }

  const gpsKm = numberOrNull(report.gpsKm);
  // 没有人工校准过就没有可信基准，此时不凭空造一个读数出来
  if (gpsKm != null && state.odometerKm != null
    && gpsKm >= MIN_GPS_STEP_KM && gpsKm <= MAX_PLAUSIBLE_STEP_KM) {
    next.odometerKm = round2(state.odometerKm + gpsKm);
  }
  return next;
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
