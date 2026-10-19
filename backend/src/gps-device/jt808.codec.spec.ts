import {
  parseExtendedTlv, parseIccidMessage, parseTerminalAttributes, normalizeIccid,
  AckResult, MsgId, RegisterResult, ParamId, AlarmBit, ExtAlarmBit,
  decodeAlarms, parseAlarmExt,
  bcdToString, stringToBcd, normalizeDeviceNo,
  escapeBytes, unescapeBytes, xorChecksum,
  decodeFrame, encodeFrame, splitFrames,
  parsePosition, parseBatchPositions, bcdTimeToDate, dateToBcdTime,
  decodeTimezone, encodeTimezone,
  buildPlatformAck, buildRegisterAck, buildTimeSyncAck, buildSetParams, buildReboot,
  realtimeUploadParam, dwordParam, byteParam,
} from './jt808.codec';

// 报文样例全部来自厂家协议文档（信春科技 JT808 V1.54）
const H = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const inner = (s: string) => H(s).subarray(1, -1); // 去掉首尾 7e

describe('JT808 escape / checksum', () => {
  it('escapes per spec example: 30 7e 08 7d 55 -> 30 7d02 08 7d01 55', () => {
    expect(escapeBytes(H('307e087d55'))).toEqual(H('307d02087d0155'));
    expect(unescapeBytes(H('307d02087d0155'))).toEqual(H('307e087d55'));
  });

  it('leaves a trailing lone 0x7d untouched', () => {
    expect(unescapeBytes(H('307d'))).toEqual(H('307d'));
  });

  it('xor checksum matches heartbeat example (0x87)', () => {
    const raw = unescapeBytes(inner('7e00020000999999999118000c877e'));
    expect(xorChecksum(raw.subarray(0, -1))).toBe(0x87);
  });
});

describe('BCD helpers', () => {
  it('round-trips phone numbers with leading zero padding', () => {
    expect(bcdToString(H('051160004464'))).toBe('051160004464');
    expect(stringToBcd('51160004464', 6)).toEqual(H('051160004464'));
    expect(stringToBcd('999999999118', 6)).toEqual(H('999999999118'));
  });

  it('normalizes device numbers (BCD 12-digit vs printed 11-digit)', () => {
    expect(normalizeDeviceNo('051160004464')).toBe('51160004464');
    expect(normalizeDeviceNo(' 5116-0004464 ')).toBe('51160004464');
    expect(normalizeDeviceNo('000')).toBe('0');
  });
});

describe('decodeFrame on vendor examples', () => {
  it('heartbeat 0x0002 (empty body)', () => {
    const f = decodeFrame(inner('7e00020000999999999118000c877e'))!;
    expect(f).toMatchObject({ msgId: MsgId.HEARTBEAT, bodyLength: 0, phone: '999999999118', serial: 0x000c, checksumOk: true });
    expect(f.body.length).toBe(0);
    expect(f.subpackage).toBeUndefined();
  });

  it('terminal general ack 0x0001', () => {
    const f = decodeFrame(inner('7e0001000599999999911800077fbc810300cb7e'))!;
    expect(f.msgId).toBe(MsgId.TERMINAL_ACK);
    expect(f.checksumOk).toBe(true);
    expect(f.body.readUInt16BE(0)).toBe(0x7fbc); // 应答流水号
    expect(f.body.readUInt16BE(2)).toBe(0x8103); // 应答 ID
    expect(f.body[4]).toBe(0);
  });

  it('register 0x0100 carries the device number in the header phone field', () => {
    const f = decodeFrame(inner(
      '7e0100002d0511600044640000002a08523132333435333533333531313600000000000000000000000030303034343634ffd4c14238383838389e7e',
    ))!;
    expect(f.msgId).toBe(MsgId.REGISTER);
    expect(f.phone).toBe('051160004464');
    expect(normalizeDeviceNo(f.phone)).toBe('51160004464');
    expect(f.bodyLength).toBe(0x2d);
    expect(f.body.length).toBe(0x2d);
    expect(f.checksumOk).toBe(true);
    expect(f.body.subarray(4, 9).toString('latin1')).toBe('12345'); // 制造商ID
  });

  it('auth 0x0102 body is the auth code (vendor uses the device number)', () => {
    const f = decodeFrame(inner('7e0102000b051160004464000135313136303030343436346c7e'))!;
    expect(f.msgId).toBe(MsgId.AUTH);
    expect(f.checksumOk).toBe(true);
    expect(f.body.toString('latin1')).toBe('51160004464');
  });

  it('flags a corrupted checksum instead of throwing', () => {
    const f = decodeFrame(inner('7e00020000999999999118000c007e'))!;
    expect(f.checksumOk).toBe(false);
  });

  it('returns null for a truncated header', () => {
    expect(decodeFrame(H('0002000099'))).toBeNull();
  });
});

describe('encodeFrame reproduces vendor platform examples byte-for-byte', () => {
  it('platform ack 0x8001', () => {
    const out = buildPlatformAck('999999999118', 0x85eb, 0x0007, 0x0704, AckResult.OK);
    expect(out).toEqual(H('7e8001000599999999911885eb0007070400677e'));
  });

  it('register ack 0x8100 with auth code = device number', () => {
    const out = buildRegisterAck('051160004464', 0x33ab, 0x0000, RegisterResult.OK, '51160004464');
    expect(out).toEqual(H('7e8100000e05116000446433ab0000003531313630303034343634727e'));
  });

  it('register ack without auth code when rejected', () => {
    const f = decodeFrame(buildRegisterAck('051160004464', 1, 5, RegisterResult.TERMINAL_NOT_FOUND).subarray(1, -1))!;
    expect(f.body).toEqual(H('000504'));
  });

  it('time sync ack 0x8109 (2018-08-22 15:31:12 local)', () => {
    // 文档样例的时间是终端本地时间；用 +8 时区反推 UTC 再编码应得到同一报文
    const localMs = Date.UTC(2018, 7, 22, 15, 31, 12);
    const out = buildTimeSyncAck('777777777943', 0xbbb2, new Date(localMs - 8 * 3600 * 1000), 8);
    expect(out).toEqual(H('7e81090008777777777943bbb207e208160f1f0c00547e'));
  });

  it('escapes 0x7e/0x7d inside the frame (checksum computed before escaping)', () => {
    const body = H('7e7d');
    const frame = encodeFrame(0x8300, '000000000001', 0x7e7d, body);
    // 流水号 7e7d 与消息体 7e7d 都必须转义
    expect(frame.subarray(1, -1).includes(0x7e)).toBe(false);
    const back = decodeFrame(frame.subarray(1, -1))!;
    expect(back.serial).toBe(0x7e7d);
    expect(back.body).toEqual(body);
    expect(back.checksumOk).toBe(true);
  });

  it('rejects oversize bodies', () => {
    expect(() => encodeFrame(0x8300, '1', 0, Buffer.alloc(1024))).toThrow();
  });
});

describe('splitFrames (TCP stream reassembly)', () => {
  const hb = '7e00020000999999999118000c877e';

  it('extracts back-to-back frames and keeps the incomplete tail', () => {
    const buf = H(hb + hb + '7e0002');
    const { frames, rest } = splitFrames(buf);
    expect(frames).toHaveLength(2);
    expect(rest).toEqual(H('7e0002'));
  });

  it('handles a shared single 0x7e between frames', () => {
    const shared = hb + hb.slice(2); // …877e00020000…
    const { frames } = splitFrames(H(shared));
    expect(frames).toHaveLength(2);
    expect(decodeFrame(frames[1])!.msgId).toBe(MsgId.HEARTBEAT);
  });

  it('drops garbage before the first flag and keeps a partial frame', () => {
    const { frames, rest } = splitFrames(H('aabb' + hb.slice(0, 10)));
    expect(frames).toHaveLength(0);
    expect(rest).toEqual(H(hb.slice(0, 10)));
  });

  it('returns empty rest when there is no flag at all', () => {
    const { frames, rest } = splitFrames(H('aabbcc'));
    expect(frames).toHaveLength(0);
    expect(rest.length).toBe(0);
  });
});

describe('parsePosition on the vendor 0x0200 example', () => {
  // 文档样例（缺首 7e，我们直接取消息体）
  const frameHex = '02000048051160004464000d'
    + '00000000' + '000c0002' + '0159885e' + '06cbf344' + '0000' + '0000' + '0000' + '200807180722'
    + '010400000001' + '30011c' + '310109' + 'e4020063' + 'e50100' + 'e60100' + 'e7080000000000000000'
    + 'ee0a01cc01262c009a674300';
  const body = H(frameHex).subarray(12);

  it('decodes the base fields (Shenzhen, GMT+8 -> UTC)', () => {
    const p = parsePosition(body, 8)!;
    expect(body.length).toBe(0x48);
    expect(p.latitude).toBeCloseTo(22.644830, 6);
    expect(p.longitude).toBeCloseTo(114.029380, 6); // 0x06cbf344 = 114029380
    expect(p.fixed).toBe(true);
    expect(p.acc).toBe(false);
    expect(p.speedKmh).toBe(0);
    expect(p.heading).toBe(0);
    expect(p.time.toISOString()).toBe('2020-08-07T10:07:22.000Z'); // 18:07:22 +08
  });

  it('decodes vendor extra-info items', () => {
    const p = parsePosition(body, 8)!;
    expect(p.extras.mileageKm).toBe(0.1);
    expect(p.extras.signalPercent).toBe(0x1c);
    expect(p.extras.satellites).toBe(9);
    expect(p.extras.externalPower).toBe(true); // 状态 0 = 接通外接电源
    expect(p.extras.batteryPercent).toBe(99);
    expect(p.extras.moving).toBe(false);
    expect(p.extras.raw.get(0xee)?.length).toBe(10);
  });

  it('applies south/west sign bits from the status word', () => {
    const b = Buffer.from(body);
    b.writeUInt32BE(0x000c0002 | (1 << 2) | (1 << 3), 4); // 南纬 + 西经
    const p = parsePosition(b, 8)!;
    expect(p.latitude).toBeLessThan(0);
    expect(p.longitude).toBeLessThan(0);
  });

  it('uses the per-connection timezone offset (NZ +12)', () => {
    const p = parsePosition(body, 12)!;
    expect(p.time.toISOString()).toBe('2020-08-07T06:07:22.000Z');
  });

  it('returns null for a body shorter than 28 bytes', () => {
    expect(parsePosition(Buffer.alloc(10), 8)).toBeNull();
  });

  it('reads 0xE4 state 1 as "on battery" and an undocumented state as unknown, never as a power cut', () => {
    // 断电报警按这个字段判断：以前是 `=== 0`，任何没见过的状态码都会被读成「外电断开」
    const withE4 = (hex: string) => parsePosition(Buffer.concat([body.subarray(0, 28), H(hex)]), 8)!.extras;
    expect(withE4('e4020050')).toMatchObject({ externalPower: true, batteryPercent: 80 });
    expect(withE4('e4020150')).toMatchObject({ externalPower: false, batteryPercent: 80 });
    expect(withE4('e4020250').externalPower).toBeUndefined();
    expect(withE4('e4020250').batteryPercent).toBe(80);
  });

  it('reads the SIM ICCID out of the 0xEB extension (sub-item 0x00B2, letters included)', () => {
    // 2026-09-28 真机抓包：0xEB 里是 [长度][子ID][数据] 的 TLV，不是文档写的基站列表
    const b = Buffer.concat([body.subarray(0, 28), H('eb0e 000c 00b2 898600f11926f0185264')]);
    expect(parsePosition(b, 8)!.extras.iccid).toBe('898600F11926F0185264');
  });

  it('ignores a truncated trailing extra item', () => {
    const b = Buffer.concat([body.subarray(0, 28), H('e402')]);
    expect(parsePosition(b, 8)!.extras.batteryPercent).toBeUndefined();
  });
});

describe('0x0704 batch upload', () => {
  it('splits N position items and reports blind-zone flag', () => {
    const item = Buffer.alloc(28);
    item.writeUInt32BE(1 << 1, 4); // fixed
    item.writeUInt32BE(22_000_000, 8);
    item.writeUInt32BE(114_000_000, 12);
    stringToBcd('200807180722', 6).copy(item, 22);
    const lenBuf = Buffer.alloc(2); lenBuf.writeUInt16BE(28, 0);
    const body = Buffer.concat([H('0002'), H('01'), lenBuf, item, lenBuf, item]);
    const r = parseBatchPositions(body);
    expect(r.count).toBe(2);
    expect(r.blindZone).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(parsePosition(r.items[1], 8)!.latitude).toBe(22);
  });

  it('stops at a truncated item without throwing', () => {
    const body = H('0002' + '00' + '001c' + '00');
    expect(parseBatchPositions(body).items).toHaveLength(0);
  });

  it('reports the count the device declared so truncation cannot pass as success', () => {
    // 上限本身是防放大攻击的，必须保留；但被截断这件事要能被上层看见——
    // 平台是先回 OK 再解析的，终端收到 OK 就会清掉本地缓存。
    const parts = [H('ffff'), H('01')]; // 声称 65535 个点，盲区补传
    for (let i = 0; i < 3; i++) parts.push(H('0002'), H('abcd'));
    const r = parseBatchPositions(Buffer.concat(parts));
    expect(r.declared).toBe(65535);
    expect(r.count).toBe(200);
    expect(r.items.length).toBe(3);
    expect(r.blindZone).toBe(true);
  });

  it('caps the number of items a single frame can expand into (amplification guard)', () => {
    const item = Buffer.alloc(28);
    const lenBuf = Buffer.alloc(2); lenBuf.writeUInt16BE(28, 0);
    const parts = [H('ffff'), H('00')]; // 声称 65535 个点
    for (let i = 0; i < 400; i++) parts.push(lenBuf, item);
    const r = parseBatchPositions(Buffer.concat(parts));
    expect(r.count).toBe(200);
    expect(r.items.length).toBeLessThanOrEqual(200);
  });
});

describe('oversized frame rejection', () => {
  it('drops a frame whose body is far beyond any legitimate JT808 message', () => {
    // 协议消息体上限 1023 字节；几十 KB 的「一帧」只会是放大攻击
    const header = Buffer.alloc(12);
    header.writeUInt16BE(MsgId.BATCH_POSITION, 0);
    const huge = Buffer.concat([header, Buffer.alloc(60 * 1024, 0x41), Buffer.from([0])]);
    expect(decodeFrame(huge)).toBeNull();
  });

  it('still accepts a large-but-plausible frame', () => {
    const body = Buffer.alloc(1000, 0x42);
    const frame = encodeFrame(MsgId.BATCH_POSITION, '051160004464', 1, body);
    expect(decodeFrame(frame.subarray(1, -1))!.body).toEqual(body);
  });
});

describe('time and timezone helpers', () => {
  it('bcd time round-trips through UTC', () => {
    const d = bcdTimeToDate(H('200807180722'), 8);
    expect(dateToBcdTime(d, 8)).toEqual(H('200807180722'));
    expect(dateToBcdTime(d, 12)).toEqual(H('200807220722'));
  });

  it('decodes the 0x1007 / 0xF142 timezone byte (64 = +8, 65 = -8)', () => {
    expect(decodeTimezone(64)).toBe(8);
    expect(decodeTimezone(65)).toBe(-8);
    expect(decodeTimezone(96)).toBe(12);
    expect(decodeTimezone(0)).toBe(0);
    expect(decodeTimezone(255)).toBeNull();
    expect(encodeTimezone(8)).toBe(64);
    expect(encodeTimezone(-8)).toBe(65);
    expect(encodeTimezone(12)).toBe(96);
    expect(encodeTimezone(5.5)).toBe(44);
  });
});

describe('0x8103 set params / 0x8155 reboot', () => {
  const params = [
    realtimeUploadParam(0, 10),
    dwordParam(ParamId.DEFAULT_TIME_INTERVAL, 10),
    byteParam(ParamId.DEVICE_TIMEZONE, encodeTimezone(12)),
  ];

  it('defaults to the vendor/2011 layout: count + package-count + [id(4) len(1) value]', () => {
    const f = decodeFrame(buildSetParams('051160004464', 1, params).subarray(1, -1))!;
    expect(f.msgId).toBe(MsgId.SET_PARAMS);
    expect(f.checksumOk).toBe(true);
    expect(f.body[0]).toBe(3);
    expect(f.body[1]).toBe(3);
    expect(f.body.subarray(2, 10)).toEqual(H('0000f11503' + '00000a')); // F115, len 3, 定时 10s
    expect(f.body.subarray(10, 19)).toEqual(H('0000002904' + '0000000a')); // 0029, len 4
    expect(f.body.subarray(19, 25)).toEqual(H('0000f14201' + '60')); // F142, len 1, UTC+12
  });

  it('reproduces the vendor 0x8103 example (server host + port, 2011 layout) byte-for-byte', () => {
    const { stringParam } = require('./jt808.codec');
    const out = buildSetParams('613310262184', 0xc1d2, [
      stringParam(ParamId.MAIN_SERVER_HOST, '39.104.62.81'),
      dwordParam(ParamId.MAIN_SERVER_PORT, 7300),
    ]);
    expect(out).toEqual(H('7e8103001c613310262184c1d20202000000130c33392e3130342e36322e3831000000180400001c84cb7e'));
  });

  it('can emit the 2013 layout (no package-count byte)', () => {
    const f = decodeFrame(buildSetParams('051160004464', 1, params, '2013').subarray(1, -1))!;
    expect(f.body[0]).toBe(3);
    expect(f.body.subarray(1, 9)).toEqual(H('0000f11503' + '00000a'));
  });

  it('reboot has an empty body', () => {
    const f = decodeFrame(buildReboot('051160004464', 9).subarray(1, -1))!;
    expect(f.msgId).toBe(MsgId.REBOOT);
    expect(f.body.length).toBe(0);
    expect(f.serial).toBe(9);
  });
});

// 报警位的权威来源是厂家文档《表18 报警标志位定义》和附加信息 0xE7 那一行，
// 不是 JT/T 808-2013 标准表 —— 两者在这批固件上有实质差别，下面的用例把差别钉住。
describe('decodeAlarms: 表18 报警标志位', () => {
  it('returns nothing for a clean position', () => {
    expect(decodeAlarms(0)).toEqual([]);
    expect(decodeAlarms(0, { alarmExt: H('0000000000000000') })).toEqual([]);
  });

  it('decodes 主电源掉电 (bit8) — owner 要的「断电报警」', () => {
    expect(AlarmBit.POWER_CUT).toBe(8);
    expect(decodeAlarms(1 << 8)).toEqual(['power_cut']);
  });

  it('keeps 欠压(bit7) 和 掉电(bit8) 分开：低电不是断电', () => {
    expect(decodeAlarms(1 << 7)).toEqual(['low_battery']);
    expect(decodeAlarms((1 << 7) | (1 << 8))).toEqual(['low_battery', 'power_cut']);
  });

  it('decodes SOS / 超速 / 疲劳 / 天线 / 超时 / 非法点火 / 非法位移', () => {
    expect(decodeAlarms(1 << 0)).toEqual(['sos']);
    expect(decodeAlarms(1 << 1)).toEqual(['overspeed']);
    expect(decodeAlarms(1 << 2)).toEqual(['fatigue']);
    expect(decodeAlarms(1 << 5)).toEqual(['gnss_antenna_open']);
    expect(decodeAlarms(1 << 6)).toEqual(['gnss_antenna_short']);
    expect(decodeAlarms(1 << 18)).toEqual(['drive_time_exceeded']);
    expect(decodeAlarms(1 << 19)).toEqual(['park_timeout']);
    expect(decodeAlarms(1 << 27)).toEqual(['illegal_ignition']);
  });

  it('reads bit28 (车辆非法位移) without sign-extension damage', () => {
    // 1 << 28 之后再往上就要小心 JS 位运算的符号位；bit29 同理
    expect(decodeAlarms(1 << 28)).toEqual(['illegal_displacement']);
    expect(decodeAlarms(0x30000000)).toEqual(['illegal_displacement', 'dog_bark']);
  });

  it('does NOT invent 进出区域 at bit20: 表18 里没有这一位（电子围栏只能平台侧算）', () => {
    // 标准 JT/T 808-2013 的 bit20 是「进出区域/路线」，这批固件的表18 根本没有它。
    // 如果照标准解码，这里会冒出一个永远不会被触发的 geofence 报警。
    expect(decodeAlarms(1 << 20)).toEqual([]);
  });

  it('does NOT treat bit29 as 碰撞: 厂家把它改成了犬吠报警', () => {
    // 标准表里 bit29/bit30 是碰撞/侧翻；照标准猜会把犬吠报成车祸。
    expect(decodeAlarms(1 << 29)).toEqual(['dog_bark']);
    expect(decodeAlarms(1 << 30)).toEqual([]);
    expect(decodeAlarms(0x80000000)).toEqual([]);
  });

  it('ignores a rubbish alarm word instead of throwing', () => {
    expect(decodeAlarms(NaN)).toEqual([]);
    expect(decodeAlarms(0xffffffff)).toContain('power_cut');
  });
});

describe('parseAlarmExt / 震动报警 (0xE7)', () => {
  // 文档 0xE7 那一行给了工作样例：0x0001000700000000 =「震动报警，设备设防，设备休眠」
  const VENDOR_E7 = H('0001000700000000');

  it('matches the vendor worked example byte-for-byte', () => {
    const ext = parseAlarmExt(VENDOR_E7)!;
    expect(ext.alarmWord).toBe(0x0001);
    expect(ext.switchWord).toBe(0x0007);
    expect(ext.armed).toBe(true); // 开关状态 bit0 设防
    expect(ext.sleeping).toBe(true); // 开关状态 bit1 休眠
  });

  it('震动报警 is 0xE7 报警状态 bit0 — it is NOT in the alarm DWORD', () => {
    expect(ExtAlarmBit.SHOCK).toBe(0);
    // 报警标志 DWORD 全 0，震动照样要解出来
    expect(decodeAlarms(0, { alarmExt: VENDOR_E7 })).toEqual(['shock']);
    // 反过来：没有 0xE7 就永远解不出震动，这正是之前漏掉它的原因
    expect(decodeAlarms(0)).toEqual([]);
  });

  it('decodes the other 0xE7 alarm bits', () => {
    expect(decodeAlarms(0, { alarmExt: H('0002000000000000') })).toEqual(['sos_call']);
    expect(decodeAlarms(0, { alarmExt: H('0010000000000000') })).toEqual(['sleep_1h']);
    expect(decodeAlarms(0, { alarmExt: H('0040000000000000') })).toEqual(['power_on']);
    expect(decodeAlarms(0, { alarmExt: H('0080000000000000') })).toEqual(['power_off']);
  });

  it('collapses SOS1/2/3 into one kind instead of reporting it three times', () => {
    expect(decodeAlarms(0, { alarmExt: H('000e000000000000') })).toEqual(['sos_call']);
  });

  it('combines the DWORD and 0xE7 in one list (断电 + 震动 同时发生)', () => {
    expect(decodeAlarms(1 << 8, { alarmExt: VENDOR_E7 })).toEqual(['power_cut', 'shock']);
  });

  it('treats a short or missing 0xE7 as "no extension" rather than throwing', () => {
    expect(parseAlarmExt(undefined)).toBeNull();
    expect(parseAlarmExt(H('0001'))).toBeNull(); // 截断
    expect(decodeAlarms(1 << 8, { alarmExt: H('00') })).toEqual(['power_cut']);
    expect(decodeAlarms(1 << 8, null)).toEqual(['power_cut']);
  });
});

describe('parsePosition exposes decoded alarms', () => {
  // 厂家 0x0200 样例：报警标志全 0，0xE7 也全 0 —— 一条完全干净的定位
  const cleanBody = H('02000048051160004464000d'
    + '00000000' + '000c0002' + '0159885e' + '06cbf344' + '0000' + '0000' + '0000' + '200807180722'
    + '010400000001' + '30011c' + '310109' + 'e4020063' + 'e50100' + 'e60100' + 'e7080000000000000000'
    + 'ee0a01cc01262c009a674300').subarray(12);

  it('reports no alarms for the vendor example', () => {
    const p = parsePosition(cleanBody, 8)!;
    expect(p.alarms).toEqual([]);
    expect(p.extras.alarmExtState).toMatchObject({ alarmWord: 0, switchWord: 0, armed: false });
  });

  it('surfaces 震动 when the same frame carries the vendor 0xE7 example', () => {
    const b = Buffer.from(cleanBody);
    H('0001000700000000').copy(b, b.indexOf(H('e708'), 28) + 2);
    const p = parsePosition(b, 8)!;
    expect(p.alarms).toEqual(['shock']);
    expect(p.extras.alarmExtState!.armed).toBe(true);
  });

  it('surfaces 断电 from the alarm DWORD', () => {
    const b = Buffer.from(cleanBody);
    b.writeUInt32BE(1 << 8, 0);
    expect(parsePosition(b, 8)!.alarms).toEqual(['power_cut']);
  });
});

describe('0x8600 设置圆形区域', () => {
  it('is deliberately absent: 厂家 V1.54 文档没有这条消息', () => {
    // 文档全文（含附录A 消息对照表）没有任何 0x86xx；位置附加信息里也没有标准的 0x12
    // 「区域/路线报警」项，表18 里也没有 bit20 进出区域。
    // 有人以后想「顺手补上」时，这条用例会说明为什么不能补。
    const codec = require('./jt808.codec');
    expect(codec.buildSetCircularArea).toBeUndefined();
    expect(Object.values(MsgId).some((id) => (id as number) >= 0x8600 && (id as number) <= 0x86ff)).toBe(false);
  });
});

describe('SIM ICCID messages', () => {
  const ICCID = '898600F11926F0185264';

  it('parseExtendedTlv splits [len][id][data] items and stops at a bad length', () => {
    const tlv = parseExtendedTlv(H('000c 00b2 898600f11926f0185264 0003 00a8 64 0006 0089 fffffffd'));
    expect(tlv.get(0x00b2)!.toString('hex')).toBe('898600f11926f0185264');
    expect(tlv.get(0x00a8)![0]).toBe(0x64);
    expect(tlv.get(0x0089)!.toString('hex')).toBe('fffffffd');
    expect(parseExtendedTlv(H('ffff 00b2 01')).size).toBe(0); // 长度超出：不解
    expect(parseExtendedTlv(H('0001 00b2')).size).toBe(0); // 长度 < 2：停，不会原地打转
    expect(parseExtendedTlv(H('0000 00b2 aa')).size).toBe(0);
  });

  it('0xEB: only a 10-byte 0x00B2 counts, and a bad inner length does not eat the extras after it', () => {
    const withEb = (hex: string) => parsePosition(Buffer.concat([Buffer.alloc(28), H(hex)]), 8)!.extras;
    expect(withEb('eb0f 000d 00b2 898600f11926f018526400').iccid).toBeUndefined(); // 11 字节
    expect(withEb('eb0e 000c 00b2 ffffffffffffffffffff').iccid).toBeUndefined(); // 没插卡的填充值
    const ex = withEb('eb05 ffff 00b2 01 3001 2a');
    expect(ex.iccid).toBeUndefined();
    expect(ex.signalPercent).toBe(42); // 后面的 0x30 照常解
  });

  it('parseIccidMessage reads 0x1107: [len][iccid][len][model]', () => {
    const body = Buffer.concat([Buffer.from([20]), Buffer.from(ICCID, 'latin1'), Buffer.from([4]), Buffer.from('A522', 'latin1')]);
    expect(parseIccidMessage(body)).toEqual({ iccid: ICCID, model: 'A522' });
    expect(parseIccidMessage(Buffer.from([20]))).toEqual({ iccid: null, model: null });
    expect(parseIccidMessage(Buffer.concat([Buffer.from([3]), Buffer.from('abc')])).iccid).toBeNull(); // 不像 ICCID
    // 型号会进日志：带换行 / 控制符的不要
    const hostile = Buffer.concat([Buffer.from([20]), Buffer.from(ICCID, 'latin1'), Buffer.from([9]), Buffer.from('A5\n[FAKE]', 'latin1')]);
    expect(parseIccidMessage(hostile).model).toBeNull();
    // 长度字节大于实际内容、空消息体：不抛错，当没报
    expect(parseIccidMessage(Buffer.concat([Buffer.from([20]), Buffer.from('ABCDE')]))).toEqual({ iccid: null, model: null });
    expect(parseIccidMessage(Buffer.alloc(0))).toEqual({ iccid: null, model: null });
    // 小写、19 位、型号带 NUL 结尾
    const lower = Buffer.concat([Buffer.from([19]), Buffer.from('8986001234567890123', 'latin1'), Buffer.from([6]), Buffer.from('A522\0\0', 'latin1')]);
    expect(parseIccidMessage(lower)).toEqual({ iccid: '8986001234567890123', model: 'A522' });
  });

  it('parseTerminalAttributes takes the BCD ICCID at byte 34 of 0x0107', () => {
    const body = Buffer.alloc(48);
    H('898600f11926f0185264').copy(body, 34);
    expect(parseTerminalAttributes(body).iccid).toBe(ICCID);
    expect(parseTerminalAttributes(Buffer.alloc(40)).iccid).toBeNull(); // 太短
    expect(parseTerminalAttributes(body.subarray(0, 43)).iccid).toBeNull(); // 差一个字节
    expect(parseTerminalAttributes(body.subarray(0, 44)).iccid).toBe(ICCID); // 刚好够
    expect(parseTerminalAttributes(Buffer.alloc(48)).iccid).toBeNull(); // 全 0 不是 ICCID
    const allF = Buffer.alloc(48); allF.fill(0xff, 34, 44);
    expect(parseTerminalAttributes(allF).iccid).toBeNull();
  });

  it('normalizeIccid strips spaces, upper-cases and refuses non-ICCIDs', () => {
    expect(normalizeIccid(' 8986 00f1 1926 f018 5264 ')).toBe(ICCID);
    expect(normalizeIccid('12345')).toBeNull();
    expect(normalizeIccid('')).toBeNull();
    expect(normalizeIccid(undefined)).toBeNull();
    // 0x0107 按另一种布局排时第 34 字节起是版本号文字 "V1.54.0.1"：解出来是 20 个十六进制字符，但不以 89 开头
    expect(normalizeIccid('56312E35342E302E3100')).toBeNull();
    expect(normalizeIccid('898600G11926F0185264')).toBeNull(); // G 不是半字节
    // 长度：18~22 位（含 89 前缀）
    expect(normalizeIccid('89' + '1'.repeat(15))).toBeNull();
    expect(normalizeIccid('89' + '1'.repeat(16))).toBe('89' + '1'.repeat(16));
    expect(normalizeIccid('8986001234567890123')).toBe('8986001234567890123'); // 19 位
    expect(normalizeIccid('89' + '1'.repeat(20))).toBe('89' + '1'.repeat(20));
    expect(normalizeIccid('89' + '1'.repeat(21))).toBeNull();
    expect(normalizeIccid('F'.repeat(20))).toBeNull();
    expect(normalizeIccid('0'.repeat(20))).toBeNull();
    expect(normalizeIccid('8986-00F1-1926-F018-5264')).toBeNull(); // 连字符不是空白，不剥
  });
});
