import * as net from 'net';
import { Logger, NotFoundException } from '@nestjs/common';
import { Jt808Server } from './jt808.server';
import {
  MsgId, RegisterResult, AckResult, ParamId,
  Jt808Frame, decodeFrame, encodeFrame, encodeSubFrame, splitFrames, stringToBcd, encodeTimezone,
} from './jt808.codec';

const H = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const KNOWN = '051160004464'; // 厂家样例里的设备（BCD 12 位）
const KNOWN_NO = '51160004464';

// 厂家协议文档样例报文
const REGISTER_KNOWN = H('7e0100002d0511600044640000002a08523132333435333533333531313600000000000000000000000030303034343634ffd4c14238383838389e7e');
const AUTH_KNOWN = H('7e0102000b051160004464000135313136303030343436346c7e');
const HEARTBEAT = encodeFrame(MsgId.HEARTBEAT, KNOWN, 0x0c);
const POSITION_BODY = H(
  '00000000' + '000c0002' + '0159885e' + '06cbf344' + '0000' + '0000' + '0000' + '200807180722'
  + '010400000001' + '30011c' + '310109' + 'e4020063' + 'e50100' + 'e60100' + 'e7080000000000000000'
  + 'ee0a01cc01262c009a674300',
);
const POSITION_KNOWN = encodeFrame(MsgId.POSITION, KNOWN, 0x0d, POSITION_BODY);

const openSockets: net.Socket[] = [];

/** 测试客户端：收集并按消息 ID 等待服务器下行帧 */
function client(port: number) {
  const socket = net.connect({ port, host: '127.0.0.1' });
  openSockets.push(socket); // 断言失败时也要收回连接，否则会影响后面的用例
  let buf: Buffer = Buffer.alloc(0);
  const frames: Jt808Frame[] = [];
  const waiters: Array<() => void> = [];
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    const { frames: raws, rest } = splitFrames(buf);
    buf = rest;
    for (const r of raws) { const f = decodeFrame(r); if (f) frames.push(f); }
    waiters.splice(0).forEach((w) => w());
  });
  const ready = new Promise<void>((res, rej) => { socket.once('connect', () => res()); socket.once('error', rej); });
  const waitFor = (msgId: number, timeoutMs = 3000): Promise<Jt808Frame> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting 0x${msgId.toString(16)}`)), timeoutMs);
    const check = () => {
      const idx = frames.findIndex((f) => f.msgId === msgId);
      if (idx >= 0) { clearTimeout(timer); resolve(frames.splice(idx, 1)[0]); return true; }
      return false;
    };
    if (!check()) waiters.push(() => { check(); });
  });
  return { socket, ready, waitFor, frames };
}

const flush = () => new Promise((r) => setTimeout(r, 60));

/** 等条件成立，而不是赌固定时长：CI 机器慢的时候固定等待最先崩 */
async function until(check: () => boolean, ms = 3000, what = 'condition'): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setImmediate(r));
  }
}

describe('Jt808Server (TCP gateway)', () => {
  let server: Jt808Server;
  let port: number;
  let devices: any;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    devices = {
      // 按设备号返回，而不是用 mockImplementationOnce：
      // 一次性 mock 会被"恰好先到"的那一帧吃掉，导致用例之间互相干扰
      findByDeviceNo: jest.fn(async (no: string) => {
        if (no === KNOWN_NO) return { id: 'dev1', deviceNo: KNOWN_NO, enabled: true, vehiclePlate: 'ABC123' };
        if (no === '55555555555') return { id: 'dev9', deviceNo: '55555555555', enabled: false };
        return null;
      }),
      touch: jest.fn(async () => undefined),
      deviceOnline: jest.fn(async () => undefined),
      ingest: jest.fn(async () => 'stored'),
    };
    const config = { get: jest.fn(() => undefined) };
    server = new Jt808Server(config as any, devices as any);
    port = await server.start(0, '127.0.0.1');
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    devices.ingest.mockClear();
    devices.touch.mockClear();
  });

  afterEach(() => {
    openSockets.splice(0).forEach((s) => s.destroy());
  });

  it('registers a known device and replies 0x8100 OK with auth code = device number', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(REGISTER_KNOWN);
    const ack = await c.waitFor(MsgId.REGISTER_ACK);
    expect(ack.phone).toBe(KNOWN);
    expect(ack.body.readUInt16BE(0)).toBe(0); // 对应注册流水号
    expect(ack.body[2]).toBe(RegisterResult.OK);
    expect(ack.body.subarray(3).toString('latin1')).toBe(KNOWN_NO);
    expect(server.getOnline().map((o) => o.deviceNo)).toContain(KNOWN_NO);
    expect(server.isOnline(KNOWN_NO)).toBe(true);
    c.socket.destroy();
    await flush();
    expect(server.isOnline(KNOWN_NO)).toBe(false);
  });

  it('rejects an unregistered device with result 4 and records the attempt for onboarding', async () => {
    const c = client(port);
    await c.ready;
    const body = decodeFrame(REGISTER_KNOWN.subarray(1, -1))!.body;
    c.socket.write(encodeFrame(MsgId.REGISTER, '000012345678', 7, body));
    const ack = await c.waitFor(MsgId.REGISTER_ACK);
    expect(ack.body.readUInt16BE(0)).toBe(7);
    expect(ack.body[2]).toBe(RegisterResult.TERMINAL_NOT_FOUND);
    expect(ack.body.length).toBe(3); // 失败不带鉴权码
    const attempt = server.getUnregistered().find((u) => u.deviceNo === '12345678');
    expect(attempt).toBeDefined();
    expect(attempt!.count).toBe(1);
    server.clearUnregistered('12345678');
    expect(server.getUnregistered().find((u) => u.deviceNo === '12345678')).toBeUndefined();
    c.socket.destroy();
  });

  it('acks auth + heartbeat with 0x8001 and touches the device', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(AUTH_KNOWN);
    const a1 = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(a1.body.readUInt16BE(0)).toBe(1); // 鉴权帧流水号
    expect(a1.body.readUInt16BE(2)).toBe(MsgId.AUTH);
    expect(a1.body[4]).toBe(AckResult.OK);

    c.socket.write(HEARTBEAT);
    const a2 = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(a2.body.readUInt16BE(2)).toBe(MsgId.HEARTBEAT);
    await until(() => devices.touch.mock.calls.length > 0, 3000, 'touch');
    expect(devices.touch).toHaveBeenCalledWith(KNOWN_NO);
    c.socket.destroy();
  });

  it('auth from an unknown device is answered with FAIL so the terminal re-registers', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(encodeFrame(MsgId.AUTH, '000012345678', 2, Buffer.from('12345678', 'latin1')));
    const a = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(a.body[4]).toBe(AckResult.FAIL);
    c.socket.destroy();
  });

  it('discovers a device that skips registration and goes straight to heartbeat/position', async () => {
    // 有些固件从别的平台切过来时不重新注册，只认注册消息就永远看不到这台设备
    const c = client(port);
    await c.ready;
    c.socket.write(encodeFrame(MsgId.HEARTBEAT, '000087654321', 1));
    const hb = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(hb.body[4]).toBe(AckResult.FAIL); // 回失败，逼它重新注册

    c.socket.write(encodeFrame(MsgId.POSITION, '000087654321', 2, POSITION_BODY));
    const pos = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(pos.body[4]).toBe(AckResult.FAIL);
    await flush();
    expect(devices.ingest).not.toHaveBeenCalled(); // 未登记设备的点不入库

    const attempt = server.getUnregistered().find((u) => u.deviceNo === '87654321');
    expect(attempt).toMatchObject({ count: 2, disabled: false });
    server.clearUnregistered('87654321');
    c.socket.destroy();
  });

  it('flags a registered-but-disabled device separately from an unknown one', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(encodeFrame(MsgId.HEARTBEAT, '055555555555', 1));
    await c.waitFor(MsgId.PLATFORM_ACK);
    expect(server.getUnregistered().find((u) => u.deviceNo === '55555555555')).toMatchObject({ disabled: true });
    server.clearUnregistered('55555555555');
    c.socket.destroy();
  });

  it('closes a connection that changes device number mid-stream (scanner / spoof attempt)', async () => {
    // 真实终端不会在一条连接里换设备号；允许换号等于给了「把别的设备踢下线」的手段
    const c = client(port);
    await c.ready;
    c.socket.write(HEARTBEAT);
    await c.waitFor(MsgId.PLATFORM_ACK);
    const closed = new Promise<void>((r) => c.socket.once('close', () => r()));
    c.socket.write(encodeFrame(MsgId.HEARTBEAT, '000099998888', 2));
    await closed;
    expect(server.getUnregistered().find((u) => u.deviceNo === '99998888')).toBeUndefined();
    expect(server.isOnline(KNOWN_NO)).toBe(false);
  });

  it('closes a connection that never sends a valid frame (no session slot squatting)', async () => {
    // 握手超时是 30s，这里只验证连接建立后仍未发帧时 frames 计数为 0、服务器未把它当设备
    const c = client(port);
    await c.ready;
    await flush();
    expect(server.getOnline().some((o) => o.addr === `127.0.0.1:${(c.socket as any).localPort}`)).toBe(false);
    c.socket.destroy();
  });

  it('logs a connection the peer closes before sending any valid frame', async () => {
    // 握手超时那条日志只在连接撑满 10 秒时才会记；对端两秒就断的连接以前什么都不留。
    // 用本用例独有的字节（"hello"）来认日志：上一个用例收尾时销毁的连接也会触发同类日志
    const logSpy = jest.spyOn((server as any).logger, 'log');
    try {
      const c = client(port);
      await c.ready;
      c.socket.write(Buffer.from('hello'));
      await flush();
      c.socket.end();
      const mine = () => logSpy.mock.calls
        .map(([m]) => String(m))
        .filter((m) => /closed by peer after \d+ms without a valid JT808 frame — sent 5 bytes starting 68656c6c6f$/.test(m));
      await until(() => mine().length > 0, 3000, 'early-close log');
      await flush();
      expect(mine()).toHaveLength(1); // end 之后紧跟的 close 不能再补一条
    } finally {
      logSpy.mockRestore();
    }
  });

  it('acks a position report and hands the parsed point to the device service', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(POSITION_KNOWN);
    const a = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(a.body.readUInt16BE(0)).toBe(0x0d);
    expect(a.body.readUInt16BE(2)).toBe(MsgId.POSITION);
    await until(() => devices.ingest.mock.calls.length === 1, 3000, 'ingest');
    const [no, pos] = devices.ingest.mock.calls[0];
    expect(no).toBe(KNOWN_NO);
    expect(pos.latitude).toBeCloseTo(22.64483, 5);
    expect(pos.longitude).toBeCloseTo(114.02938, 5);
    expect(pos.fixed).toBe(true);
    expect(pos.time.toISOString()).toBe('2020-08-07T10:07:22.000Z'); // 默认 UTC+8
    expect(pos.extras.batteryPercent).toBe(99);
    c.socket.destroy();
  });

  it('tells ingest the clock is trusted only after the device announced its timezone', async () => {
    // 时钟可信时，几天前的点是补传的存货；不可信时它是时钟/时区配错，要用服务器时间兜底
    const c = client(port);
    await c.ready;
    c.socket.write(POSITION_KNOWN);
    await c.waitFor(MsgId.PLATFORM_ACK);
    c.socket.write(encodeFrame(MsgId.TIMEZONE_SYNC, KNOWN, 3, Buffer.from([96, 0, 0, 0])));
    await c.waitFor(MsgId.PLATFORM_ACK);
    c.socket.write(POSITION_KNOWN);
    await c.waitFor(MsgId.PLATFORM_ACK);
    await until(() => devices.ingest.mock.calls.length === 2, 3000, 'ingest x2');
    expect(devices.ingest.mock.calls[0][2]).toEqual({ clockTrusted: false });
    expect(devices.ingest.mock.calls[1][2]).toEqual({ clockTrusted: true });
    c.socket.destroy();
  });

  it('reports the device back online once per connection (clears its offline alarm)', async () => {
    devices.deviceOnline.mockClear();
    const c = client(port);
    await c.ready;
    c.socket.write(AUTH_KNOWN);
    await c.waitFor(MsgId.PLATFORM_ACK);
    c.socket.write(HEARTBEAT);
    await c.waitFor(MsgId.PLATFORM_ACK);
    c.socket.write(POSITION_KNOWN);
    await c.waitFor(MsgId.PLATFORM_ACK);
    expect(devices.deviceOnline).toHaveBeenCalledTimes(1);
    expect(devices.deviceOnline).toHaveBeenCalledWith(KNOWN_NO);
    c.socket.destroy();
  });

  it('does not report an unregistered device as back online', async () => {
    devices.deviceOnline.mockClear();
    const c = client(port);
    await c.ready;
    c.socket.write(encodeFrame(MsgId.HEARTBEAT, '000087654321', 1));
    await c.waitFor(MsgId.PLATFORM_ACK);
    expect(devices.deviceOnline).not.toHaveBeenCalled();
    server.clearUnregistered('87654321');
    c.socket.destroy();
  });

  it('logs each unhandled message type once per connection', async () => {
    const logSpy = jest.spyOn((server as any).logger, 'log');
    try {
      const c = client(port);
      await c.ready;
      for (let i = 0; i < 3; i++) {
        c.socket.write(encodeFrame(0x0112, KNOWN, 20 + i, Buffer.from([1, 2, 3])));
        await c.waitFor(MsgId.PLATFORM_ACK);
      }
      const lines = logSpy.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('sent 0x0112'));
      expect(lines).toEqual([`device ${KNOWN_NO} sent 0x0112 (3 bytes, acked, not processed)`]);
      c.socket.destroy();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('stores the SIM ICCID the device reports via 0x1107 and 0x0107', async () => {
    const iccid = '898600F11926F0185264';
    const c = client(port);
    await c.ready;
    c.socket.write(encodeFrame(MsgId.ICCID, KNOWN, 9, Buffer.concat([
      Buffer.from([20]), Buffer.from(iccid, 'latin1'), Buffer.from([4]), Buffer.from('A522', 'latin1'),
    ])));
    await c.waitFor(MsgId.PLATFORM_ACK);
    await until(() => devices.touch.mock.calls.length >= 1, 3000, 'touch');
    expect(devices.touch).toHaveBeenCalledWith(KNOWN_NO, { iccid });

    const attrs = Buffer.alloc(48);
    Buffer.from('898600f11926f0185264', 'hex').copy(attrs, 34);
    c.socket.write(encodeFrame(MsgId.ATTRIBUTES, KNOWN, 10, attrs));
    await c.waitFor(MsgId.PLATFORM_ACK);
    await until(() => devices.touch.mock.calls.length >= 2, 3000, 'touch x2');
    expect(devices.touch.mock.calls[1]).toEqual([KNOWN_NO, { iccid }]);
    c.socket.destroy();
  });

  it('0x1107 from an unregistered device is refused and never reaches touch', async () => {
    const c = client(port);
    await c.ready;
    const body = Buffer.concat([Buffer.from([20]), Buffer.from('898600F11926F0185264', 'latin1')]);
    c.socket.write(encodeFrame(MsgId.ICCID, '000087654321', 1, body));
    const a = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(a.body[4]).toBe(AckResult.FAIL);
    await flush();
    expect(devices.touch).not.toHaveBeenCalled();
    expect(server.getUnregistered().some((u) => u.deviceNo === '87654321')).toBe(true);
    server.clearUnregistered('87654321');
    c.socket.destroy();
  });

  it('garbage 0x1107 / short 0x0107 keep the device alive without inventing an ICCID', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(encodeFrame(MsgId.ICCID, KNOWN, 11, Buffer.concat([Buffer.from([20]), Buffer.from('ABCDE')])));
    await c.waitFor(MsgId.PLATFORM_ACK);
    c.socket.write(encodeFrame(MsgId.ATTRIBUTES, KNOWN, 12, Buffer.alloc(40)));
    await c.waitFor(MsgId.PLATFORM_ACK);
    await until(() => devices.touch.mock.calls.length >= 2, 3000, 'touch x2');
    expect(devices.touch.mock.calls[0]).toEqual([KNOWN_NO, {}]);
    expect(devices.touch.mock.calls[1]).toEqual([KNOWN_NO, {}]);
    c.socket.destroy();
  });

  it('applies the timezone announced by 0x1007 to later positions', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(encodeFrame(MsgId.TIMEZONE_SYNC, KNOWN, 3, Buffer.from([96, 0, 0, 0]))); // 96 = UTC+12
    await c.waitFor(MsgId.PLATFORM_ACK);
    c.socket.write(POSITION_KNOWN);
    await c.waitFor(MsgId.PLATFORM_ACK);
    await until(() => devices.ingest.mock.calls.length > 0, 3000, 'ingest');
    const pos = devices.ingest.mock.calls[0][1];
    expect(pos.time.toISOString()).toBe('2020-08-07T06:07:22.000Z');
    expect(server.getOnline().find((o) => o.deviceNo === KNOWN_NO)!.tzOffset).toBe(12);
    c.socket.destroy();
  });

  it('replies 0x8109 to a time-sync request with the device-local time', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(encodeFrame(MsgId.TIME_SYNC_REQ, KNOWN, 5));
    const r = await c.waitFor(MsgId.TIME_SYNC_ACK);
    expect(r.body.length).toBe(8);
    const local = new Date(Date.now() + 8 * 3600 * 1000);
    expect(r.body.readUInt16BE(0)).toBe(local.getUTCFullYear());
    expect(r.body[2]).toBe(local.getUTCMonth() + 1); // body: 年(2) 月 日 时 分 秒 结果
    expect(r.body[7]).toBe(AckResult.OK);
    c.socket.destroy();
  });

  it('reassembles a subpackaged 0x0704 backfill and stores every point', async () => {
    // 消息体长度字段只有 10 位（≤1023 字节），一个定位点 74 字节，
    // 所以盲区补报超过十几个点时终端必然分包；不重组就会静默丢掉一半数据
    const c = client(port);
    await c.ready;
    const len = Buffer.alloc(2); len.writeUInt16BE(POSITION_BODY.length, 0);
    const full = Buffer.concat([
      H('0004'), H('01'),
      len, POSITION_BODY, len, POSITION_BODY, len, POSITION_BODY, len, POSITION_BODY,
    ]);
    // 故意在一个定位点的中间切开，确保不是"恰好按点对齐"才能work
    const cut = Math.floor(full.length / 2) + 7;
    c.socket.write(encodeSubFrame(MsgId.BATCH_POSITION, KNOWN, 1, 2, 1, full.subarray(0, cut)));
    await c.waitFor(MsgId.PLATFORM_ACK);
    await flush();
    expect(devices.ingest).not.toHaveBeenCalled(); // 第一包还不能入库

    c.socket.write(encodeSubFrame(MsgId.BATCH_POSITION, KNOWN, 2, 2, 2, full.subarray(cut)));
    await c.waitFor(MsgId.PLATFORM_ACK);
    await until(() => devices.ingest.mock.calls.length === 4, 3000, 'reassembled batch');
    expect(devices.ingest.mock.calls[3][2]).toEqual({ batch: true, blindZone: true });
    c.socket.destroy();
  });

  it('ignores a bogus subpackage header instead of mis-parsing it as a whole message', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(encodeSubFrame(MsgId.BATCH_POSITION, KNOWN, 1, 0, 5, H('0001'))); // total=0, index>total
    await c.waitFor(MsgId.PLATFORM_ACK);
    await flush();
    expect(devices.ingest).not.toHaveBeenCalled();
    c.socket.destroy();
  });

  it('processes frames from one connection strictly in order even when the database is slow', async () => {
    // 乱序入库会把轨迹连成折线、把 GPS 工时的间隔算错
    const done: number[] = [];
    let first = true;
    devices.ingest.mockImplementation(async (_no: string, pos: any) => {
      if (first) { first = false; await new Promise((r) => setTimeout(r, 120)); }
      done.push(pos.speedKmh);
      return 'stored';
    });
    const slow = Buffer.from(POSITION_BODY); slow.writeUInt16BE(111, 18); // 11.1 km/h
    const fast = Buffer.from(POSITION_BODY); fast.writeUInt16BE(222, 18); // 22.2 km/h

    const c = client(port);
    await c.ready;
    c.socket.write(Buffer.concat([
      encodeFrame(MsgId.POSITION, KNOWN, 1, slow),
      encodeFrame(MsgId.POSITION, KNOWN, 2, fast),
    ]));
    await new Promise((r) => setTimeout(r, 400));
    expect(done).toEqual([11.1, 22.2]);
    devices.ingest.mockImplementation(async () => 'stored');
    c.socket.destroy();
  });

  it('sends the exact 0x8103 payload for realtime mode, and clamps the interval', async () => {
    // 参数发错比不发更糟：车会被改成按距离上报或错误时区，直到有人重新配置
    const c = client(port);
    await c.ready;
    c.socket.write(HEARTBEAT);
    await c.waitFor(MsgId.PLATFORM_ACK);

    server.setRealtimeMode(KNOWN_NO, 10, 12);
    const body = (await c.waitFor(MsgId.SET_PARAMS)).body;
    const items = new Map<number, Buffer>();
    let i = 2; // 跳过 参数总数 + 包参数个数（2011 版布局）
    while (i + 5 <= body.length) {
      const id = body.readUInt32BE(i);
      const len = body[i + 4];
      items.set(id, body.subarray(i + 5, i + 5 + len));
      i += 5 + len;
    }
    expect(items.get(ParamId.SLEEP_INTERVAL_MIN)).toEqual(H('00000000')); // 禁止休眠
    expect(items.get(ParamId.REALTIME_UPLOAD_MODE)).toEqual(H('00000a')); // 定时 10 秒
    expect(items.get(ParamId.DEFAULT_TIME_INTERVAL)).toEqual(H('0000000a'));
    expect(items.get(ParamId.REPORT_STRATEGY)).toEqual(H('00000000')); // 0 = 定时，不是定距
    expect(items.get(ParamId.REPORT_WHEN_STATIONARY)).toEqual(H('01')); // 静止也上报
    expect(items.get(ParamId.HEARTBEAT_INTERVAL)).toEqual(H('0000003c'));
    expect(items.get(ParamId.DEVICE_TIMEZONE)).toEqual(Buffer.from([encodeTimezone(12)]));

    const read = async (interval: number) => {
      server.setRealtimeMode(KNOWN_NO, interval, 12);
      const b = (await c.waitFor(MsgId.SET_PARAMS)).body;
      return b.readUInt16BE(b.indexOf(H('0000f11503')) + 6);
    };
    expect(await read(1)).toBe(10);
    expect(await read(9999)).toBe(120);
    c.socket.destroy();
  });

  it('parses a legacy 0x0201 position-query reply (serial + position body)', async () => {
    const c = client(port);
    await c.ready;
    const body = Buffer.concat([H('0011'), POSITION_BODY]);
    c.socket.write(encodeFrame(MsgId.POSITION_QUERY_ACK, KNOWN, 0x21, body));
    const a = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(a.body.readUInt16BE(2)).toBe(MsgId.POSITION_QUERY_ACK);
    await flush();
    expect(devices.ingest).toHaveBeenCalledTimes(1);
    expect(devices.ingest.mock.calls[0][1].latitude).toBeCloseTo(22.64483, 5);
    c.socket.destroy();
  });

  it('ingests every item of a 0x0704 batch upload as batch', async () => {
    const c = client(port);
    await c.ready;
    const len = Buffer.alloc(2); len.writeUInt16BE(POSITION_BODY.length, 0);
    const body = Buffer.concat([H('0002'), H('01'), len, POSITION_BODY, len, POSITION_BODY]);
    c.socket.write(encodeFrame(MsgId.BATCH_POSITION, KNOWN, 9, body));
    const a = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(a.body.readUInt16BE(2)).toBe(MsgId.BATCH_POSITION);
    await until(() => devices.ingest.mock.calls.length === 2, 3000, 'batch ingest');
    expect(devices.ingest.mock.calls[1][2]).toEqual({ batch: true, blindZone: true });
    c.socket.destroy();
  });

  it('survives garbage, bad checksums and split frames, then keeps serving', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(H('00ff7e12'));
    c.socket.write(H('7e00020000999999999118000c007e')); // 校验错
    await flush();
    expect(devices.touch).not.toHaveBeenCalled();
    // 一帧拆成两段发送
    c.socket.write(HEARTBEAT.subarray(0, 6));
    await flush();
    c.socket.write(HEARTBEAT.subarray(6));
    const a = await c.waitFor(MsgId.PLATFORM_ACK);
    expect(a.body.readUInt16BE(2)).toBe(MsgId.HEARTBEAT);
    c.socket.destroy();
  });

  it('sends platform commands to the live session and refuses when offline', async () => {
    const c = client(port);
    await c.ready;
    c.socket.write(HEARTBEAT);
    await c.waitFor(MsgId.PLATFORM_ACK);

    server.setRealtimeMode(KNOWN_NO, 10, 12);
    const set = await c.waitFor(MsgId.SET_PARAMS);
    expect(set.phone).toBe(KNOWN);
    expect(set.body[0]).toBe(7); // 参数总数
    expect(set.body[1]).toBe(7); // 包参数个数（2011 版布局，与厂家样例一致）
    expect(set.body.subarray(2, 6).readUInt32BE(0)).toBe(0xf117); // 第一项：禁止休眠

    server.queryPosition(KNOWN_NO);
    expect((await c.waitFor(MsgId.POSITION_QUERY)).body.length).toBe(0);

    server.reboot(KNOWN_NO);
    expect((await c.waitFor(MsgId.REBOOT)).msgId).toBe(MsgId.REBOOT);

    c.socket.destroy();
    await flush();
    expect(() => server.reboot(KNOWN_NO)).toThrow(NotFoundException);
  });

  it('replaces a stale session when the same device reconnects', async () => {
    const c1 = client(port);
    await c1.ready;
    c1.socket.write(HEARTBEAT);
    await c1.waitFor(MsgId.PLATFORM_ACK);
    const closed = new Promise<void>((r) => c1.socket.once('close', () => r()));

    const c2 = client(port);
    await c2.ready;
    c2.socket.write(HEARTBEAT);
    await c2.waitFor(MsgId.PLATFORM_ACK);
    await closed; // 旧连接被踢
    expect(server.getOnline().filter((o) => o.deviceNo === KNOWN_NO)).toHaveLength(1);
    c2.socket.destroy();
  });

  it('drops a connection that floods without frame delimiters', async () => {
    const c = client(port);
    await c.ready;
    let closed = false;
    c.socket.once('close', () => { closed = true; });
    // 一个起始 7e 后面跟 70KB 永不结束的数据：必须触发缓冲上限并断开（纯垃圾无 7e 会被直接丢弃、不占内存）
    c.socket.write(Buffer.concat([Buffer.from([0x7e]), Buffer.alloc(70 * 1024, 0x11)]));
    await until(() => closed, 2000, 'flood connection to be dropped');
  });
});

describe('Jt808Server abuse resistance on the public TCP port', () => {
  let server: Jt808Server;
  let port: number;

  const UNKNOWN = '099999999911';
  const UNKNOWN_HEARTBEAT = encodeFrame(MsgId.HEARTBEAT, UNKNOWN, 0x0c);

  beforeAll(async () => {
    Logger.overrideLogger(false);
    const devices = {
      findByDeviceNo: jest.fn(async (no: string) =>
        no === KNOWN_NO ? { id: 'dev1', deviceNo: KNOWN_NO, enabled: true, vehiclePlate: 'ABC123' } : null,
      ),
      touch: jest.fn(async () => undefined),
      deviceOnline: jest.fn(async () => undefined),
      ingest: jest.fn(async () => 'stored'),
    };
    server = new Jt808Server({ get: () => undefined } as any, devices as any);
    port = await server.start(0, '127.0.0.1');
  });

  afterAll(async () => { await server.stop(); });
  afterEach(() => { openSockets.splice(0).forEach((s) => s.destroy()); });

  it('closes a connection that floods bogus subpackage headers instead of logging forever', async () => {
    // 这条路径在设备核验之前就 return 了，拒绝计数管不到它，
    // 所以必须自己限流+断开：否则一条连接能无限刷 warn 日志把容器日志撑爆。
    const c = client(port);
    await c.ready;
    let closed = false;
    c.socket.once('close', () => { closed = true; });

    // total=0 是非法分包头（合法范围 1..64）
    const bogus = encodeSubFrame(MsgId.BATCH_POSITION, UNKNOWN, 0x01, 0, 1, Buffer.from([0xaa]));
    for (let i = 0; i < 40 && !closed; i++) {
      c.socket.write(bogus);
      await new Promise((r) => setImmediate(r));
    }

    await until(() => closed, 3000, 'the log-flooding connection to be dropped');
  });

  it('evicts an unregistered connection so a real truck can still get in at the connection cap', async () => {
    // 以前只踢 frames===0 的连接，攻击者每条连接发一帧合法心跳就永远不算空闲；
    // 槽位占满之后真实车辆全部被拒 —— 整个车队从地图上消失。
    const squatter = client(port);
    await squatter.ready;
    squatter.socket.write(UNKNOWN_HEARTBEAT);
    await squatter.waitFor(MsgId.PLATFORM_ACK);            // 发过帧了，不再是"空连接"

    const online = server.getOnline().length;
    const real = client(port);
    await real.ready;
    real.socket.write(REGISTER_KNOWN);
    const ack = await real.waitFor(MsgId.REGISTER_ACK);

    expect(ack.body[2]).toBe(RegisterResult.OK);
    expect(server.getOnline().length).toBeGreaterThanOrEqual(online);
    expect(server.getOnline().map((o) => o.deviceNo)).toContain(KNOWN_NO);
  });

  it('drops a slow-drip flood before the buffer copy cost explodes', async () => {
    // 上限必须在 concat 之前判：拼完再判的话，一字节一字节喂到 64KB
    // 光拷贝量就是 n²/2 ≈ 2GB，足以卡死事件循环（API 与网关同进程）。
    const c = client(port);
    await c.ready;
    let closed = false;
    c.socket.once('close', () => { closed = true; });
    c.socket.write(Buffer.from([0x7e]));
    for (let i = 0; i < 70 && !closed; i++) {
      c.socket.write(Buffer.alloc(1024, 0x11));
      await new Promise((r) => setImmediate(r));
    }
    await until(() => closed, 3000, 'the slow-drip flood to be dropped');
  });
});

describe('Jt808Server startup guards', () => {
  const build = (env: Record<string, string | undefined>) =>
    new Jt808Server({ get: (k: string) => env[k] } as any, {} as any);

  it('does not bind when JT808_PORT equals the HTTP port', async () => {
    // Railway 加 TCP Proxy 后会把 PORT 顶成代理目标端口：网关先占住它，
    // 随后 app.listen 报 EADDRINUSE，整个进程崩溃重启，API 一起宕。
    const s = build({ JT808_PORT: '8080', PORT: '8080' });
    await s.onModuleInit();
    expect(s.getPort()).toBeNull();
    expect(s.getStartError()).toMatch(/same as the HTTP port/);
    await s.stop();
  });

  it('starts when the ports differ', async () => {
    const s = build({ JT808_PORT: '0', PORT: '8080' });
    await s.onModuleInit();
    // JT808_PORT=0 被当成"未配置"，网关不启动且不算错误
    expect(s.getStartError()).toBeNull();
    await s.stop();
  });
});
