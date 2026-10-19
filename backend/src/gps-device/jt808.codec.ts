/**
 * JT/T 808-2013 编解码（信春科技 SLC 终端协议 V1.54 低功耗版）
 *
 * 纯函数、无 IO，便于用协议文档里的报文样例做单元测试。
 *
 * 帧：0x7e | 消息头 | 消息体 | 校验码(1) | 0x7e
 * 转义：0x7e -> 0x7d 0x02，0x7d -> 0x7d 0x01（校验后再转义；收包先还原再校验）
 * 校验：从消息头第一个字节到消息体最后一个字节逐字节异或
 * 字节序：大端
 * 消息头：消息ID(2) | 消息体属性(2) | 终端手机号 BCD[6] | 消息流水号(2) | [分包项 总包数(2) 包序号(2)]
 * 消息体属性：bit0-9 体长度，bit10-12 加密，bit13 分包
 */

export const FLAG = 0x7e;

export const MsgId = {
  // 终端 -> 平台
  TERMINAL_ACK: 0x0001,
  HEARTBEAT: 0x0002,
  LOGOUT: 0x0003,
  REGISTER: 0x0100,
  AUTH: 0x0102,
  ATTRIBUTES: 0x0107,
  TIME_SYNC_REQ: 0x0109,
  POSITION: 0x0200,
  POSITION_QUERY_ACK: 0x0201, // 旧固件对 0x8201 的应答：应答流水号(2) + 位置汇报体
  SLEEP_BATTERY: 0x0210,
  BATCH_POSITION: 0x0704,
  TIMEZONE_SYNC: 0x1007,
  ICCID: 0x1107,
  FAKE_SHUTDOWN_HEARTBEAT: 0x0f02,
  // 平台 -> 终端
  PLATFORM_ACK: 0x8001,
  REGISTER_ACK: 0x8100,
  SET_PARAMS: 0x8103,
  TERMINAL_CONTROL: 0x8105,
  TIME_SYNC_ACK: 0x8109,
  REBOOT: 0x8155,
  POSITION_QUERY: 0x8201,
  TEXT: 0x8300,
} as const;

/** 平台通用应答结果 */
export const AckResult = { OK: 0, FAIL: 1, BAD_MESSAGE: 2, UNSUPPORTED: 3, ALARM_CONFIRMED: 4 } as const;

// ---------- 报警位 ----------

/**
 * 0x0200 报警标志 DWORD 的位定义，照抄厂家文档《表18 报警标志位定义》。
 *
 * 这份固件和 JT/T 808-2013 标准表不是一回事，照标准猜会猜错：
 *  - 标准里 bit20 是「进出区域/路线」，本固件的表18 里根本没有这一位 —— 设备不会上报电子围栏，
 *    围栏只能由平台自己算（见 GeofenceService）。
 *  - 标准里 bit29/bit30 是碰撞/侧翻，本固件 bit29 被厂家改成了「犬吠报警」（这批设备有宠物型号）。
 *  - 震动报警根本不在这个 DWORD 里，在附加信息 0xE7 里（见 ExtAlarmBit），
 *    文档「4、备注 / 2、C3L设备 / 1.1震动报警标志」写得很明确：「通过E7字段的报警状态位判断震动报警」。
 */
export const AlarmBit = {
  SOS: 0, // 紧急报警，触动报警开关后触发（收到应答后清零）
  OVERSPEED: 1,
  FATIGUE: 2,
  GNSS_ANTENNA_OPEN: 5, // 天线未接或被剪断
  GNSS_ANTENNA_SHORT: 6,
  LOW_BATTERY: 7, // 终端主电源欠压（低电报警）
  POWER_CUT: 8, // 终端主电源掉电（防拆报警）—— owner 要的「断电」
  DRIVE_TIME_EXCEEDED: 18, // 当天累计驾驶超时
  PARK_TIMEOUT: 19, // 超时停车
  ILLEGAL_IGNITION: 27,
  ILLEGAL_DISPLACEMENT: 28, // 车辆非法位移（阈值见参数 0x0031）
  DOG_BARK: 29, // 厂家改位：不是标准里的碰撞报警
} as const;

/**
 * 附加信息 0xE7「状态扩展」8 字节：1-2 报警状态(WORD)，3-4 开关状态(WORD)，5-8 备用。
 * 文档样例 0x0001000700000000 =「震动报警，设备设防，设备休眠」，
 * 即两个 WORD 都是大端、bit0 是最低位 —— 下面的解析就是按这个样例对齐的。
 */
export const ExtAlarmBit = {
  SHOCK: 0, // 震动报警：本固件唯一的震动来源
  SOS1: 1,
  SOS2: 2,
  SOS3: 3,
  SLEEP_1H: 4,
  DATA_QUOTA: 5,
  POWER_ON: 6, // 报一次后设备自己清标志
  POWER_OFF: 7,
} as const;

/** 0xE7 开关状态 WORD 的位定义 */
export const ExtSwitchBit = {
  ARMED: 0, // 设防（撤防时固件不产生震动报警）
  SLEEPING: 1,
  SLEEP_JUDGED_BY_E7: 2,
} as const;

export type AlarmKind =
  | 'sos'
  | 'overspeed'
  | 'fatigue'
  | 'gnss_antenna_open'
  | 'gnss_antenna_short'
  | 'low_battery'
  | 'power_cut'
  | 'drive_time_exceeded'
  | 'park_timeout'
  | 'illegal_ignition'
  | 'illegal_displacement'
  | 'dog_bark'
  | 'shock'
  | 'sos_call'
  | 'sleep_1h'
  | 'data_quota'
  | 'power_on'
  | 'power_off';

/** 报警标志 DWORD 的位 -> 名字。顺序即输出顺序，保证解码结果可直接比较。 */
const ALARM_BIT_KINDS: Array<[number, AlarmKind]> = [
  [AlarmBit.SOS, 'sos'],
  [AlarmBit.OVERSPEED, 'overspeed'],
  [AlarmBit.FATIGUE, 'fatigue'],
  [AlarmBit.GNSS_ANTENNA_OPEN, 'gnss_antenna_open'],
  [AlarmBit.GNSS_ANTENNA_SHORT, 'gnss_antenna_short'],
  [AlarmBit.LOW_BATTERY, 'low_battery'],
  [AlarmBit.POWER_CUT, 'power_cut'],
  [AlarmBit.DRIVE_TIME_EXCEEDED, 'drive_time_exceeded'],
  [AlarmBit.PARK_TIMEOUT, 'park_timeout'],
  [AlarmBit.ILLEGAL_IGNITION, 'illegal_ignition'],
  [AlarmBit.ILLEGAL_DISPLACEMENT, 'illegal_displacement'],
  [AlarmBit.DOG_BARK, 'dog_bark'],
];

const EXT_ALARM_BIT_KINDS: Array<[number, AlarmKind]> = [
  [ExtAlarmBit.SHOCK, 'shock'],
  [ExtAlarmBit.SOS1, 'sos_call'],
  [ExtAlarmBit.SOS2, 'sos_call'],
  [ExtAlarmBit.SOS3, 'sos_call'],
  [ExtAlarmBit.SLEEP_1H, 'sleep_1h'],
  [ExtAlarmBit.DATA_QUOTA, 'data_quota'],
  [ExtAlarmBit.POWER_ON, 'power_on'],
  [ExtAlarmBit.POWER_OFF, 'power_off'],
];


export interface AlarmExtState {
  /** 0xE7 第 1-2 字节：报警状态 WORD */
  alarmWord: number;
  /** 0xE7 第 3-4 字节：开关状态 WORD */
  switchWord: number;
  armed: boolean;
  sleeping: boolean;
}

/**
 * 解析附加信息 0xE7。长度不足按「没有这个字段」处理 —— 报文来自外部，不能因为短一个字节就抛。
 */
export function parseAlarmExt(buf?: Buffer | null): AlarmExtState | null {
  if (!buf || buf.length < 4) return null;
  const alarmWord = buf.readUInt16BE(0);
  const switchWord = buf.readUInt16BE(2);
  return {
    alarmWord,
    switchWord,
    armed: (switchWord & (1 << ExtSwitchBit.ARMED)) !== 0,
    sleeping: (switchWord & (1 << ExtSwitchBit.SLEEPING)) !== 0,
  };
}

/**
 * 报警标志 DWORD + 0xE7 扩展 -> 具名报警列表。纯函数，无 IO。
 *
 * 之所以要把 0xE7 一起传进来：owner 最关心的「震动报警」只在 0xE7 里，
 * 只看报警标志 DWORD 会永远解不出震动。
 */
export function decodeAlarms(alarm: number, extras?: { alarmExt?: Buffer | null } | null): AlarmKind[] {
  const out: AlarmKind[] = [];
  const flags = Number.isFinite(alarm) ? (alarm >>> 0) : 0;
  for (const [bit, kind] of ALARM_BIT_KINDS) {
    // 位 31 用 >>> 0 之后仍可能超出 32 位有符号范围，统一用无符号除法判位
    if (Math.floor(flags / 2 ** bit) % 2 === 1) out.push(kind);
  }
  const ext = parseAlarmExt(extras?.alarmExt);
  if (ext) {
    for (const [bit, kind] of EXT_ALARM_BIT_KINDS) {
      if ((ext.alarmWord & (1 << bit)) !== 0 && !out.includes(kind)) out.push(kind);
    }
  }
  return out;
}

/** 注册应答结果 */
export const RegisterResult = {
  OK: 0,
  VEHICLE_REGISTERED: 1,
  VEHICLE_NOT_FOUND: 2,
  TERMINAL_REGISTERED: 3,
  TERMINAL_NOT_FOUND: 4,
} as const;

/** 0x8103 终端参数 ID（本次对接会用到的） */
export const ParamId = {
  HEARTBEAT_INTERVAL: 0x0001, // DWORD 秒
  MAIN_SERVER_HOST: 0x0013, // STRING
  MAIN_SERVER_PORT: 0x0018, // DWORD
  REPORT_STRATEGY: 0x0020, // DWORD 0 定时 1 定距
  DEFAULT_TIME_INTERVAL: 0x0029, // DWORD 秒
  GPS_INTERVAL: 0xf110, // DWORD 秒
  REALTIME_UPLOAD_MODE: 0xf115, // BYTE 模式(0 定时/1 定距) + WORD 间隔（10~120s 或 200~1000m）
  SLEEP_INTERVAL_MIN: 0xf117, // DWORD 分钟，0 = 禁止休眠
  DEVICE_TIMEZONE: 0xf142, // BYTE 时区编码
  SLEEP_ACTION: 0xf141, // BYTE 0 心跳 1 断网 2 发定位
  REPORT_WHEN_STATIONARY: 0xf154, // BYTE 0 不报 1 报
} as const;

export interface Jt808Frame {
  msgId: number;
  bodyLength: number;
  encrypted: boolean;
  /** 终端手机号（BCD 12 位字符串，含前导 0） */
  phone: string;
  serial: number;
  subpackage?: { total: number; index: number };
  body: Buffer;
  checksumOk: boolean;
}

// ---------- 基础工具 ----------

export function xorChecksum(buf: Buffer): number {
  let c = 0;
  for (let i = 0; i < buf.length; i++) c ^= buf[i];
  return c;
}

/** 收包：还原转义（输入不含首尾 0x7e） */
export function unescapeBytes(buf: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x7d && i + 1 < buf.length) {
      const n = buf[i + 1];
      if (n === 0x02) { out.push(0x7e); i++; continue; }
      if (n === 0x01) { out.push(0x7d); i++; continue; }
    }
    out.push(b);
  }
  return Buffer.from(out);
}

/** 发包：转义（输入不含首尾 0x7e） */
export function escapeBytes(buf: Buffer): Buffer {
  const out: number[] = [];
  for (const b of buf) {
    if (b === 0x7e) out.push(0x7d, 0x02);
    else if (b === 0x7d) out.push(0x7d, 0x01);
    else out.push(b);
  }
  return Buffer.from(out);
}

export function bcdToString(buf: Buffer): string {
  let s = '';
  for (const b of buf) s += ((b >> 4) & 0x0f).toString() + (b & 0x0f).toString();
  return s;
}

/** 数字串 -> BCD，左侧补 0 到指定字节数 */
export function stringToBcd(digits: string, bytes: number): Buffer {
  const clean = digits.replace(/\D/g, '').slice(-bytes * 2).padStart(bytes * 2, '0');
  const out = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) {
    out[i] = (parseInt(clean[i * 2], 10) << 4) | parseInt(clean[i * 2 + 1], 10);
  }
  return out;
}

/** 设备号归一化：去掉非数字与前导 0（BCD 12 位 与 设备上印的 11 位 号可互相匹配） */
export function normalizeDeviceNo(input: string): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || '0';
}

// ---------- 帧解析 / 组装 ----------

/**
 * 解析一帧（输入为两个 0x7e 之间的原始字节，仍带转义）。
 * 头部不完整或长度不符返回 null；校验码不符也返回帧但 checksumOk=false，由上层决定是否丢弃。
 */
/**
 * 消息体上限。协议里消息体长度只有 10 位（≤1023），这里放宽到 8KB 容忍厂家固件不严谨，
 * 但绝不接受几十 KB 的巨帧——那不是真实终端会发的，只会是放大攻击。
 */
export const MAX_BODY_BYTES = 8 * 1024;
/** 单个 0x0704 批量帧最多解析多少个点 */
export const MAX_BATCH_ITEMS = 200;

export function decodeFrame(escaped: Buffer): Jt808Frame | null {
  const raw = unescapeBytes(escaped);
  if (raw.length < 12 + 1) return null; // 最短：12 字节头 + 1 校验
  if (raw.length > MAX_BODY_BYTES + 32) return null; // 巨帧直接丢弃
  const msgId = raw.readUInt16BE(0);
  const props = raw.readUInt16BE(2);
  const bodyLength = props & 0x03ff;
  const encrypted = ((props >> 10) & 0x07) !== 0;
  const hasSub = (props & 0x2000) !== 0;
  const phone = bcdToString(raw.subarray(4, 10));
  const serial = raw.readUInt16BE(10);
  let offset = 12;
  let subpackage: Jt808Frame['subpackage'];
  if (hasSub) {
    if (raw.length < offset + 4 + 1) return null;
    subpackage = { total: raw.readUInt16BE(offset), index: raw.readUInt16BE(offset + 2) };
    offset += 4;
  }
  // 实际体长度以帧为准（个别厂家样例的长度字段不准），但不能超过声明 + 校验
  const payload = raw.subarray(0, raw.length - 1);
  const checksum = raw[raw.length - 1];
  const body = raw.subarray(offset, raw.length - 1);
  return {
    msgId,
    bodyLength,
    encrypted,
    phone,
    serial,
    subpackage,
    body,
    checksumOk: xorChecksum(payload) === checksum,
  };
}

/** 组装一帧（含首尾 0x7e，已转义） */
export function encodeFrame(msgId: number, phone: string, serial: number, body: Buffer = Buffer.alloc(0)): Buffer {
  if (body.length > 0x03ff) throw new Error(`JT808 body too long: ${body.length}`);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(msgId, 0);
  header.writeUInt16BE(body.length & 0x03ff, 2);
  stringToBcd(phone, 6).copy(header, 4);
  header.writeUInt16BE(serial & 0xffff, 10);
  const payload = Buffer.concat([header, body]);
  const withSum = Buffer.concat([payload, Buffer.from([xorChecksum(payload)])]);
  return Buffer.concat([Buffer.from([FLAG]), escapeBytes(withSum), Buffer.from([FLAG])]);
}

/**
 * 组装分包消息中的一包（消息体属性 bit13=1，消息头后面多 4 字节：总包数 + 包序号）。
 * 主要给测试和将来下发长消息用；上行的分包由网关负责重组。
 */
export function encodeSubFrame(
  msgId: number, phone: string, serial: number, total: number, index: number, body: Buffer,
): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt16BE(msgId, 0);
  header.writeUInt16BE((body.length & 0x03ff) | 0x2000, 2);
  stringToBcd(phone, 6).copy(header, 4);
  header.writeUInt16BE(serial & 0xffff, 10);
  header.writeUInt16BE(total & 0xffff, 12);
  header.writeUInt16BE(index & 0xffff, 14);
  const payload = Buffer.concat([header, body]);
  const withSum = Buffer.concat([payload, Buffer.from([xorChecksum(payload)])]);
  return Buffer.concat([Buffer.from([FLAG]), escapeBytes(withSum), Buffer.from([FLAG])]);
}

/**
 * 从 TCP 流缓冲区中切出完整帧（两个 0x7e 之间的内容）。
 * 兼容 "…7e7e…"（连发）与共享单个 7e 的情况；返回剩余未完成数据。
 */
export function splitFrames(buffer: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let start = -1;
  let i = 0;
  while (i < buffer.length) {
    if (buffer[i] === FLAG) {
      if (start >= 0 && i > start + 1) {
        frames.push(buffer.subarray(start + 1, i));
        start = i; // 允许共享 7e 作为下一帧起始
      } else {
        start = i;
      }
    }
    i++;
  }
  if (start < 0) return { frames, rest: Buffer.alloc(0) }; // 全是垃圾，丢弃
  return { frames, rest: buffer.subarray(start) };
}

// ---------- 0x0200 位置汇报 ----------

export interface PositionExtras {
  mileageKm?: number; // 0x01
  fuelL?: number; // 0x02
  signalPercent?: number; // 0x30
  satellites?: number; // 0x31
  batteryPercent?: number; // 0xE4
  /** 0xE4 状态：0 = 接通外电（true），1 = 断开外电、电池供电（false）；其他值不认（undefined） */
  externalPower?: boolean;
  moving?: boolean; // 0xE5
  alarmExt?: Buffer; // 0xE7 8 字节（原始）
  alarmExtState?: AlarmExtState; // 0xE7 解析后的报警/开关状态
  /** SIM 卡 ICCID，来自 0xEB 子项 0x00B2（10 字节；中国移动的卡会带字母，按十六进制字符读） */
  iccid?: string;
  voltage?: number; // 0xF0 0.01V
  currentMa?: number; // 0xF1
  gpsSatellites?: number; // 0xF2
  networkType?: '2G' | '4G'; // 0xF5
  imei?: string; // 0xF6
  raw: Map<number, Buffer>;
}

export interface Position {
  alarm: number;
  /** 报警标志 + 0xE7 解出来的具名报警。空数组 = 这条定位没带任何报警。 */
  alarms: AlarmKind[];
  status: number;
  acc: boolean;
  fixed: boolean;
  moving: boolean; // 状态位 bit22
  latitude: number;
  longitude: number;
  altitude: number;
  speedKmh: number;
  heading: number;
  /** 终端上报时间（已按 tzOffsetHours 换算为 UTC） */
  time: Date;
  extras: PositionExtras;
}

/** 解析 BCD[6] YYMMDDhhmmss（终端本地时区）为 UTC */
export function bcdTimeToDate(buf: Buffer, tzOffsetHours: number): Date {
  const s = bcdToString(buf);
  const yy = +s.slice(0, 2), mm = +s.slice(2, 4), dd = +s.slice(4, 6);
  const hh = +s.slice(6, 8), mi = +s.slice(8, 10), ss = +s.slice(10, 12);
  const utcMs = Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss) - tzOffsetHours * 3600 * 1000;
  return new Date(utcMs);
}

/** Date(UTC) -> 终端本地时区 BCD[6] */
export function dateToBcdTime(date: Date, tzOffsetHours: number): Buffer {
  const local = new Date(date.getTime() + tzOffsetHours * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const s = p(local.getUTCFullYear() % 100) + p(local.getUTCMonth() + 1) + p(local.getUTCDate())
    + p(local.getUTCHours()) + p(local.getUTCMinutes()) + p(local.getUTCSeconds());
  return stringToBcd(s, 6);
}

export function parseExtras(buf: Buffer): PositionExtras {
  const raw = new Map<number, Buffer>();
  const ex: PositionExtras = { raw };
  let i = 0;
  while (i + 2 <= buf.length) {
    const id = buf[i];
    const len = buf[i + 1];
    const val = buf.subarray(i + 2, i + 2 + len);
    if (val.length < len) break; // 截断，忽略残余
    raw.set(id, val);
    switch (id) {
      case 0x01: if (len >= 4) ex.mileageKm = val.readUInt32BE(0) / 10; break;
      case 0x02: if (len >= 2) ex.fuelL = val.readUInt16BE(0) / 10; break;
      case 0x30: if (len >= 1) ex.signalPercent = val[0]; break;
      case 0x31: if (len >= 1) ex.satellites = val[0]; break;
      case 0xe4:
        if (len >= 2) {
          // 断电报警要按这个字段判断，所以只认文档写明的 0 和 1。
          // 以前是 `=== 0`，任何别的值都会被读成「外电断开」—— 一个没见过的状态码就是一条假的防盗报警。
          ex.externalPower = val[0] === 0 ? true : val[0] === 1 ? false : undefined;
          ex.batteryPercent = val[1];
        }
        break;
      case 0xe5: if (len >= 1) ex.moving = val[0] === 1; break;
      case 0xe7: {
        ex.alarmExt = Buffer.from(val);
        const state = parseAlarmExt(ex.alarmExt);
        if (state) ex.alarmExtState = state;
        break;
      }
      case 0xf0: if (len >= 2) ex.voltage = val.readUInt16BE(0) / 100; break;
      case 0xf1: if (len >= 2) ex.currentMa = val.readUInt16BE(0); break;
      case 0xf2: if (len >= 1) ex.gpsSatellites = val[0]; break;
      case 0xf5: if (len >= 1) ex.networkType = val[0] === 1 ? '4G' : '2G'; break;
      case 0xf6: if (len >= 8) ex.imei = bcdToString(val.subarray(0, 8)).replace(/^0+/, ''); break;
      case 0xeb: {
        const iccid = parseExtendedTlv(val).get(0x00b2);
        if (iccid && iccid.length === 10) ex.iccid = normalizeIccid(decodeIccidBcd(iccid)) ?? undefined;
        break;
      }
      default: break;
    }
    i += 2 + len;
  }
  return ex;
}

/**
 * 0xEB 扩展：[长度(2)][子ID(2)][数据…] 重复，长度含子 ID 本身。
 * 厂家 V1.54 文档里 0xEB 写的是基站列表，但这批固件实际发的是这种 TLV（2026-09-28 抓包验证：
 * 0x00B2 = ICCID，0x00D8 = 4G 基站，0x00B9 = WiFi 列表）。只取需要的，其余原样忽略。
 */
export function parseExtendedTlv(buf: Buffer): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  let i = 0;
  while (i + 4 <= buf.length) {
    const len = buf.readUInt16BE(i);
    const id = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break; // 长度不合法：后面的也解不出来，停
    out.set(id, buf.subarray(i + 4, i + 2 + len));
    i += 2 + len;
  }
  return out;
}

/** 10 字节 ICCID：每个半字节一个字符。中国移动的 ICCID 真的含字母（厂家 0x1107 就是为此而设），不能当纯数字 BCD 读 */
export function decodeIccidBcd(buf: Buffer): string {
  return buf.toString('hex').toUpperCase();
}

/**
 * ICCID 一律 89 开头（E.118 的电信行业标识），后面 16~20 位。字母只会是 A~F：
 * 它来自半字节解码，不是任意文本。收紧之后，0x0107 若按另一种布局排、第 34 字节起是版本号文字，
 * 解出来的 "56312E…" 会被拒掉，而不是当成「换卡」把真 ICCID 覆盖掉。
 */
const ICCID_RE = /^89[0-9A-F]{16,20}$/;

/** 规范化 ICCID：去空白、大写；不像 ICCID 的返回 null（全 0 / 全 F 这类「没插卡」填充值自然过不了 89 前缀） */
export function normalizeIccid(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').replace(/\s+/g, '').toUpperCase();
  return ICCID_RE.test(v) ? v : null;
}

/**
 * 0x1107 上传 ICCID：[长度(1)=20][ICCID 字符串][长度(1)][设备型号字符串]。
 * 厂家专门为「带字母的 ICCID」加的消息。
 */
export function parseIccidMessage(body: Buffer): { iccid: string | null; model: string | null } {
  if (body.length < 2) return { iccid: null, model: null };
  const n = body[0];
  const iccid = normalizeIccid(body.subarray(1, 1 + n).toString('latin1'));
  let model: string | null = null;
  if (body.length >= 2 + n) {
    const m = body[1 + n];
    const text = body.subarray(2 + n, 2 + n + m).toString('latin1').replace(/\0+$/, '').trim();
    // 设备号可被伪造，这段文字会进日志：只认可打印 ASCII、限长，换行/控制符一律不要
    model = /^[\x20-\x7E]{1,32}$/.test(text) ? text : null;
  }
  return { iccid, model };
}

/**
 * 0x0107 查询终端属性应答：终端类型(2) 制造商(5) 型号(20) 终端ID(7) 之后、第 34 字节起是 SIM 卡 ICCID BCD[10]。
 * 只取 ICCID，硬件/固件版本目前用不上。
 */
export function parseTerminalAttributes(body: Buffer): { iccid: string | null } {
  if (body.length < 44) return { iccid: null };
  return { iccid: normalizeIccid(decodeIccidBcd(body.subarray(34, 44))) };
}

/** 解析 0x0200 消息体（也用于 0x0704 里的每一项） */
export function parsePosition(body: Buffer, tzOffsetHours: number): Position | null {
  if (body.length < 28) return null;
  const alarm = body.readUInt32BE(0);
  const status = body.readUInt32BE(4);
  const latRaw = body.readUInt32BE(8) / 1e6;
  const lngRaw = body.readUInt32BE(12) / 1e6;
  const south = (status & (1 << 2)) !== 0;
  const west = (status & (1 << 3)) !== 0;
  const extras = parseExtras(body.subarray(28));
  return {
    alarm,
    alarms: decodeAlarms(alarm, extras),
    status,
    acc: (status & 1) !== 0,
    fixed: (status & (1 << 1)) !== 0,
    moving: (status & (1 << 22)) !== 0,
    latitude: south ? -latRaw : latRaw,
    longitude: west ? -lngRaw : lngRaw,
    altitude: body.readUInt16BE(16),
    speedKmh: body.readUInt16BE(18) / 10,
    // 协议里是 0~359 的方向角，但字段本身是 16 位。固件出错或有人伪造时会来一个 ≥1000 的值，
    // 直接写进 gps_logs.heading（numeric(5,2)，上限 999.99）会让整条插入抛错——
    // 那一帧的定位、设备在线状态和报警判定会一起丢掉，而且每一帧都会重复。
    heading: body.readUInt16BE(20) % 360,
    time: bcdTimeToDate(body.subarray(22, 28), tzOffsetHours),
    extras,
  };
}

/**
 * 解析 0x0704 定位数据批量上传：返回每一项的 0x0200 消息体。
 *
 * declared 是设备自己声明的点数，count 是实际解析上限（受 MAX_BATCH_ITEMS 约束）。
 * 两者必须都返回：只返回收敛后的 count，调用方就永远看不出「这次补传被截断了」，
 * 而平台已经回了 OK，终端会把本地缓存删掉——丢的点找不回来。
 */
export function parseBatchPositions(body: Buffer): { count: number; declared: number; blindZone: boolean; items: Buffer[] } {
  if (body.length < 3) return { count: 0, declared: 0, blindZone: false, items: [] };
  const declared = body.readUInt16BE(0);
  const count = Math.min(declared, MAX_BATCH_ITEMS);
  const blindZone = body[2] === 1;
  const items: Buffer[] = [];
  let i = 3;
  while (i + 2 <= body.length && items.length < count) {
    const len = body.readUInt16BE(i);
    const item = body.subarray(i + 2, i + 2 + len);
    if (item.length < len) break;
    items.push(item);
    i += 2 + len;
  }
  return { count, declared, blindZone, items };
}

// ---------- 0x1007 时区 ----------

/**
 * 时区编码：值 = 时区 * 4 << 1，最低位 0 东区 / 1 西区。例：64 = 东八区，65 = 西八区。
 * 返回小时偏移（东正西负）；解析失败返回 null。
 */
export function decodeTimezone(byte: number): number | null {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
  const west = (byte & 1) === 1;
  const hours = (byte >> 1) / 4;
  if (hours > 14) return null;
  return west ? -hours : hours;
}

export function encodeTimezone(offsetHours: number): number {
  const west = offsetHours < 0;
  return ((Math.round(Math.abs(offsetHours) * 4)) << 1) | (west ? 1 : 0);
}

// ---------- 平台下行报文 ----------

export function buildPlatformAck(phone: string, serial: number, replySerial: number, replyMsgId: number, result: number = AckResult.OK): Buffer {
  const body = Buffer.alloc(5);
  body.writeUInt16BE(replySerial & 0xffff, 0);
  body.writeUInt16BE(replyMsgId & 0xffff, 2);
  body[4] = result;
  return encodeFrame(MsgId.PLATFORM_ACK, phone, serial, body);
}

export function buildRegisterAck(phone: string, serial: number, replySerial: number, result: number, authCode?: string): Buffer {
  const head = Buffer.alloc(3);
  head.writeUInt16BE(replySerial & 0xffff, 0);
  head[2] = result;
  const body = result === RegisterResult.OK && authCode
    ? Buffer.concat([head, Buffer.from(authCode.slice(0, 20), 'latin1')])
    : head;
  return encodeFrame(MsgId.REGISTER_ACK, phone, serial, body);
}

/** 0x8109 请求同步时间应答：年(2) 月 日 时 分 秒 结果 —— 以终端本地时区时间下发 */
export function buildTimeSyncAck(phone: string, serial: number, now: Date, tzOffsetHours: number): Buffer {
  const local = new Date(now.getTime() + tzOffsetHours * 3600 * 1000);
  const body = Buffer.alloc(8);
  body.writeUInt16BE(local.getUTCFullYear(), 0);
  body[2] = local.getUTCMonth() + 1;
  body[3] = local.getUTCDate();
  body[4] = local.getUTCHours();
  body[5] = local.getUTCMinutes();
  body[6] = local.getUTCSeconds();
  body[7] = AckResult.OK;
  return encodeFrame(MsgId.TIME_SYNC_ACK, phone, serial, body);
}

export interface ParamItem { id: number; value: Buffer }

export function dwordParam(id: number, value: number): ParamItem {
  const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0, 0); return { id, value: b };
}
export function byteParam(id: number, value: number): ParamItem {
  return { id, value: Buffer.from([value & 0xff]) };
}
export function stringParam(id: number, value: string): ParamItem {
  return { id, value: Buffer.from(value, 'latin1') };
}
/** 0xF115 实时定位上传模式：mode 0 定时(秒 10~120) / 1 定距(米 200~1000) */
export function realtimeUploadParam(mode: 0 | 1, interval: number): ParamItem {
  const b = Buffer.alloc(3); b[0] = mode; b.writeUInt16BE(interval & 0xffff, 1);
  return { id: ParamId.REALTIME_UPLOAD_MODE, value: b };
}

export type SetParamsLayout = '2011' | '2013';

/**
 * 0x8103 设置终端参数：参数总数(1) + [包参数个数(1)，仅 2011 版] + 参数项列表 [ID(4) 长度(1) 值]。
 * 厂家协议的下发样例（02 02 00000013 …）以及参数 0xF156「当前协议」默认值 1 = jt808-2011 都表明
 * 这批设备默认按 2011 版布局解析，因此默认用 2011 版；设备切到 2013 版后可传 layout='2013'。
 */
export function buildSetParams(phone: string, serial: number, params: ParamItem[], layout: SetParamsLayout = '2011'): Buffer {
  const count = params.length & 0xff;
  const parts: Buffer[] = [layout === '2011' ? Buffer.from([count, count]) : Buffer.from([count])];
  for (const p of params) {
    const head = Buffer.alloc(5);
    head.writeUInt32BE(p.id >>> 0, 0);
    head[4] = p.value.length & 0xff;
    parts.push(head, p.value);
  }
  return encodeFrame(MsgId.SET_PARAMS, phone, serial, Buffer.concat(parts));
}

/** 0x8105 终端控制（命令字 4 = 复位/重启，3 = 关机，5 = 恢复出厂） */
export function buildTerminalControl(phone: string, serial: number, command: number): Buffer {
  return encodeFrame(MsgId.TERMINAL_CONTROL, phone, serial, Buffer.from([command & 0xff]));
}

/** 0x8155 一键重启（消息体为空） */
export function buildReboot(phone: string, serial: number): Buffer {
  return encodeFrame(MsgId.REBOOT, phone, serial);
}

/** 0x8201 位置信息查询（消息体为空；终端回复 0x0001 并上传一条 0x0200） */
export function buildPositionQuery(phone: string, serial: number): Buffer {
  return encodeFrame(MsgId.POSITION_QUERY, phone, serial);
}

/**
 * 这里没有 0x8600「设置圆形区域」/ 0x8601「删除圆形区域」，是查过文档之后的结论，不是漏写。
 *
 * 厂家文档 V1.54 全文（含《附录A 消息对照表》）没有 0x86xx 任何一条，位置汇报的附加信息表里
 * 也没有标准的 0x12「区域/路线报警」项，表18 报警标志里同样没有标准的 bit20「进出区域」。
 * 唯一带「电子围栏」字样的是终端参数 0x0031「电子围栏半径（非法位移阈值）」——
 * 那是给 bit28「车辆非法位移」用的单一半径阈值，圆心是设备自己停车的位置，不能由平台指定，
 * 也没有进/出方向，不是真正的地理围栏。
 *
 * 所以围栏一律由平台侧算（见 GeofenceService）：对每台设备都有效，也不用为了改围栏去重新烧设备参数。
 */

export function hex(buf: Buffer): string {
  return buf.toString('hex');
}
