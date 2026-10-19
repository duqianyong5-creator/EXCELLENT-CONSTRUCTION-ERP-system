import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';
import { GpsDeviceService } from './gps-device.service';
import {
  AckResult, MsgId, ParamId, RegisterResult,
  Jt808Frame, decodeFrame, splitFrames, normalizeDeviceNo,
  parsePosition, parseBatchPositions, decodeTimezone, encodeTimezone,
  buildPlatformAck, buildRegisterAck, buildTimeSyncAck, buildSetParams, buildReboot, buildPositionQuery,
  realtimeUploadParam, dwordParam, byteParam, stringParam, MAX_BATCH_ITEMS,
  parseIccidMessage, parseTerminalAttributes,
} from './jt808.codec';
import { ErrorCode } from '../common/i18n/messages';

interface Session {
  socket: net.Socket;
  addr: string;
  buffer: Buffer;
  /** 协议头里的终端手机号（BCD 12 位） */
  phone: string | null;
  /** 归一化设备号 */
  deviceNo: string | null;
  authed: boolean;
  tzOffset: number;
  /** 设备报过时区（0x1007）或我们下发过时区：它报的时间可信，几分钟前的点就是补传而不是时钟错 */
  clockTrusted: boolean;
  serial: number;
  connectedAt: Date;
  lastSeenAt: Date;
  frames: number;
  /** 同一连接的帧串行处理，避免分包/批量乱序 */
  queue: Promise<void>;
  /** 待处理帧数，超过阈值暂停读取（背压） */
  pending: number;
  /** 被拒绝次数（未登记设备号），用于挡扫描 */
  rejects: number;
  /** 坏帧计数，用于日志降频 */
  badFrames: number;
  /** 协议层错误（加密位、非法分包头）计数：同样降频，超限断开 */
  protocolErrors: number;
  /** 该连接是否已经对应到一台「已登记且启用」的设备。连接准入时用它区分真实车辆和陌生连接 */
  trusted: boolean;
  /** 迟迟没有成为 trusted 的连接会被回收（占着槽位的陌生连接） */
  trustTimer: ReturnType<typeof setTimeout> | null;
  /** 收到的原始字节数和开头一小段：排查「设备连上了但不是 JT808」时唯一的线索 */
  bytesIn: number;
  firstBytes: Buffer | null;
  /** 分包消息的暂存区：key = 消息ID:总包数 */
  partials: Map<string, { parts: Map<number, Buffer>; at: number; bytes: number }>;
  /** 连上后迟迟不发有效帧的连接会被清掉（防止占用连接数） */
  handshakeTimer: ReturnType<typeof setTimeout> | null;
  /** 「一帧合法报文都没发就断了」只记一次：end 和 error 可能先后都触发 */
  earlyCloseLogged: boolean;
  /** 本连接上出现过、但没有专门处理的消息 ID：每种只记一次日志 */
  unhandledMsgIds: Set<number>;
}

export interface OnlineDevice {
  deviceNo: string;
  addr: string;
  connectedAt: Date;
  lastSeenAt: Date;
  tzOffset: number;
  authed: boolean;
}

export interface UnregisteredAttempt {
  deviceNo: string;
  addr: string;
  count: number;
  lastAt: Date;
  /** true = 设备已登记但被停用；false = 完全没登记过 */
  disabled: boolean;
}

const MAX_BUFFER = 64 * 1024; // 单连接最大积压（0x0704 批量最多也就几 KB）
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 终端心跳一般 ≤ 5 分钟；低功耗休眠会主动断开
const HANDSHAKE_TIMEOUT_MS = 10 * 1000; // 连上后 10 秒内没有一帧有效数据就断开
const MAX_PENDING_FRAMES = 100; // 待处理帧超过这个数就暂停读取
const MAX_CONNECTIONS = 500;
const MAX_UNREGISTERED = 200;
/** 一条连接上被拒绝多少次就断开：真实设备登记后就不会再被拒，这是挡设备号扫描的 */
const MAX_REJECTS_PER_SESSION = 5;
/** 一条连接上允许多少次校验错误的帧，超过只记一条汇总日志，避免刷日志 */
const MAX_BAD_FRAME_LOGS = 3;
/** 协议层错误（加密位、非法分包头）：超过这个数就断开。不设上限的话一条连接能无限刷日志 */
const MAX_PROTOCOL_ERRORS = 20;
/** 连上后多久还没对应到已登记设备就回收连接（真实设备几秒内就会发第一帧可识别数据） */
const TRUST_TIMEOUT_MS = 60 * 1000;
/** 未建立信任的连接能占用的分包缓冲额度，远小于正常额度 */
const UNTRUSTED_SUBPACKAGE_SETS = 1;
const UNTRUSTED_SUBPACKAGE_BYTES = 32 * 1024;
/** 分包重组上限：包数、字节数、同时进行的消息数、以及攒包的有效期 */
const MAX_SUBPACKAGES = 64;
const MAX_SUBPACKAGE_BYTES = 128 * 1024;
const MAX_SUBPACKAGE_SETS = 4;
const SUBPACKAGE_TTL_MS = 60 * 1000;

/**
 * JT808 TCP 网关：设备 -> 本服务（TCP）-> GpsDeviceService.ingest -> gps_logs / 地图 / 报警 / 工时
 *
 * 通过环境变量 JT808_PORT 开启（不设则不启动）。部署在 Railway 时给该端口加 TCP Proxy，
 * 设备服务器地址配置为 Railway 分配的 domain:port。
 */
@Injectable()
export class Jt808Server implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('JT808');
  private server: net.Server | null = null;
  private sessions = new Set<Session>();
  private byDevice = new Map<string, Session>();
  private unregistered = new Map<string, UnregisteredAttempt>();
  private defaultTz = 8;
  private startError: string | null = null;

  constructor(
    private config: ConfigService,
    private devices: GpsDeviceService,
  ) {}

  async onModuleInit(): Promise<void> {
    const port = Number(this.config.get<string>('JT808_PORT') || 0);
    const tzRaw = this.config.get<string>('JT808_DEVICE_TZ_OFFSET_HOURS');
    const tz = Number(tzRaw);
    if (tzRaw !== undefined && String(tzRaw).trim() !== '' && Number.isFinite(tz) && Math.abs(tz) <= 14) this.defaultTz = tz;
    if (!port) {
      this.logger.log('JT808 gateway disabled (set JT808_PORT to enable)');
      return;
    }
    // Railway 配了 TCP Proxy 后会把 PORT 顶成代理的目标端口。网关的 onModuleInit 先跑，
    // 抢到端口后 app.listen 才报 EADDRINUSE —— 整个进程崩溃重启，API 一起宕。宁可不开网关。
    const httpPort = Number(this.config.get<string>('PORT') || 3000);
    if (port === httpPort) {
      this.startError = `JT808_PORT (${port}) is the same as the HTTP port — gateway not started`;
      this.logger.error(`${this.startError}. Set JT808_PORT and PORT to different ports.`);
      return;
    }
    // 定位器网关起不来（端口被占、权限不足）不应该连带把后台、司机 App、客户端一起拖下线，
    // 设备页顶部的告警条会显示网关未运行。
    try {
      await this.start(port);
    } catch (e: any) {
      this.startError = e?.message || String(e);
      this.logger.error(`JT808 gateway failed to start on port ${port}: ${this.startError}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** 也供测试直接调用（port=0 随机端口） */
  start(port: number, host = '0.0.0.0'): Promise<number> {
    return new Promise((resolve, reject) => {
      // 连接准入由 handleConnection 自己管（优先踢空连接），不用 net 的先到先得上限
      const server = net.createServer((socket) => this.handleConnection(socket));
      this.server = server; // 先挂上，监听失败时 stop() 也能收拾干净
      server.on('error', (err) => {
        this.logger.error(`JT808 server error: ${err.message}`);
        reject(err);
      });
      server.listen(port, host, () => {
        this.startError = null;
        const bound = (server.address() as net.AddressInfo).port;
        this.logger.log(`JT808 gateway listening on ${host}:${bound} (device tz default UTC${this.defaultTz >= 0 ? '+' : ''}${this.defaultTz})`);
        resolve(bound);
      });
    });
  }

  async stop(): Promise<void> {
    for (const s of this.sessions) s.socket.destroy();
    this.sessions.clear();
    this.byDevice.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  getPort(): number | null {
    const a = this.server?.address();
    return a && typeof a === 'object' ? a.port : null;
  }

  /** 网关启动失败的原因（端口被占等），供管理端显示 */
  getStartError(): string | null {
    return this.startError;
  }

  getOnline(): OnlineDevice[] {
    return [...this.byDevice.values()].map((s) => ({
      deviceNo: s.deviceNo!,
      addr: s.addr,
      connectedAt: s.connectedAt,
      lastSeenAt: s.lastSeenAt,
      tzOffset: s.tzOffset,
      authed: s.authed,
    }));
  }

  isOnline(deviceNo: string): boolean {
    return this.byDevice.has(normalizeDeviceNo(deviceNo));
  }

  getUnregistered(): UnregisteredAttempt[] {
    return [...this.unregistered.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  }

  clearUnregistered(deviceNo: string): void {
    this.unregistered.delete(normalizeDeviceNo(deviceNo));
  }

  // ---------- 平台主动下发 ----------

  /** 重启终端（0x8155） */
  reboot(deviceNo: string): void {
    const s = this.requireSession(deviceNo);
    this.send(s, buildReboot(s.phone!, this.nextSerial(s)));
  }

  /** 让终端立刻上报一次位置（0x8201） */
  queryPosition(deviceNo: string): void {
    const s = this.requireSession(deviceNo);
    this.send(s, buildPositionQuery(s.phone!, this.nextSerial(s)));
  }

  /**
   * 车队实时模式：禁止休眠、定时 N 秒上报、静止也上报、心跳 60s、设备时区按服务器配置。
   * 设备接车电时功耗无所谓，这是调度地图需要的模式。
   */
  setRealtimeMode(deviceNo: string, intervalSec = 10, tzOffset?: number): void {
    const s = this.requireSession(deviceNo);
    const sec = Math.min(120, Math.max(10, Math.round(intervalSec)));
    const tz = tzOffset ?? s.tzOffset;
    this.send(s, buildSetParams(s.phone!, this.nextSerial(s), [
      dwordParam(ParamId.SLEEP_INTERVAL_MIN, 0),
      realtimeUploadParam(0, sec),
      dwordParam(ParamId.DEFAULT_TIME_INTERVAL, sec),
      dwordParam(ParamId.REPORT_STRATEGY, 0),
      byteParam(ParamId.REPORT_WHEN_STATIONARY, 1),
      dwordParam(ParamId.HEARTBEAT_INTERVAL, 60),
      byteParam(ParamId.DEVICE_TIMEZONE, encodeTimezone(tz)),
    ]));
    s.tzOffset = tz;
    s.clockTrusted = true;
  }

  /** 修改设备的主服务器地址（迁移服务器用） */
  setServer(deviceNo: string, host: string, port: number): void {
    const s = this.requireSession(deviceNo);
    this.send(s, buildSetParams(s.phone!, this.nextSerial(s), [
      stringParam(ParamId.MAIN_SERVER_HOST, host),
      dwordParam(ParamId.MAIN_SERVER_PORT, port),
    ]));
  }

  private requireSession(deviceNo: string): Session {
    const s = this.byDevice.get(normalizeDeviceNo(deviceNo));
    if (!s || !s.phone) throw new NotFoundException(ErrorCode.DEVICE_OFFLINE);
    return s;
  }

  // ---------- 连接处理 ----------

  private handleConnection(socket: net.Socket): void {
    const session: Session = {
      socket,
      addr: `${socket.remoteAddress}:${socket.remotePort}`,
      buffer: Buffer.alloc(0),
      phone: null,
      deviceNo: null,
      authed: false,
      tzOffset: this.defaultTz,
      clockTrusted: false,
      serial: 0,
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      frames: 0,
      queue: Promise.resolve(),
      pending: 0,
      rejects: 0,
      badFrames: 0,
      protocolErrors: 0,
      trusted: false,
      trustTimer: null,
      bytesIn: 0,
      firstBytes: null,
      partials: new Map(),
      handshakeTimer: null,
      earlyCloseLogged: false,
      unhandledMsgIds: new Set(),
    };
    // 连接数到上限时按「可信度」淘汰，而不是只看有没有发过帧。
    // 只看 frames===0 的话，攻击者每条连接发一帧合法心跳就永远不算空闲，
    // 500 个槽位占满之后真实车辆全部被拒——整个车队在地图上消失，而且没人知道为什么。
    if (this.sessions.size >= MAX_CONNECTIONS && !this.evictLeastTrusted(session.addr)) {
      this.logger.error(
        `connection limit reached and every session belongs to a registered device, refusing ${session.addr}`,
      );
      socket.destroy();
      return;
    }
    this.sessions.add(session);
    socket.setKeepAlive(true, 60_000);
    socket.setNoDelay(true);
    socket.setTimeout(IDLE_TIMEOUT_MS, () => {
      this.logger.debug(`idle timeout ${session.deviceNo ?? session.addr}`);
      socket.destroy();
    });
    session.handshakeTimer = setTimeout(() => {
      if (session.frames === 0) {
        // 以前是 debug，生产环境不输出——设备连上了却说的不是 JT808（协议版本、帧格式不对）
        // 这种最难查的情况完全看不见。收到的字节数和开头几个字节就是能区分它的线索：
        // 0 字节 = TCP 通了但设备一句没说；有字节但不以 7e 开头 = 不是 JT808 帧。
        this.logger.log(
          `no valid JT808 frame from ${session.addr} within ${HANDSHAKE_TIMEOUT_MS / 1000}s — `
            + (session.bytesIn === 0
              ? 'connected but sent nothing'
              : `received ${session.bytesIn} bytes that did not parse, starting ${session.firstBytes?.toString('hex')}`)
            + ', closing',
        );
        socket.destroy();
      }
    }, HANDSHAKE_TIMEOUT_MS);
    session.handshakeTimer.unref?.(); // 不要因为这个定时器把进程/测试拖住不退出
    // 发了帧但始终没对应上任何已登记设备的连接同样是在占槽位，到点回收
    session.trustTimer = setTimeout(() => {
      if (session.trusted) return;
      this.logger.log(
        `${session.addr} sent ${session.frames} frame(s) as device ${session.deviceNo ?? '(none)'} `
          + 'but never matched a registered device, closing',
      );
      socket.destroy();
    }, TRUST_TIMEOUT_MS);
    session.trustTimer.unref?.();
    socket.on('data', (chunk) => this.onData(session, chunk));
    socket.on('error', (err) => {
      if (session.frames === 0) this.noteEarlyClose(session, `dropped (${err.message})`);
      else this.logger.debug(`socket ${session.deviceNo ?? session.addr}: ${err.message}`);
    });
    // 对端主动断开（FIN）才会触发 end；服务端自己 destroy 的连接不会，所以不会和上面那些「…, closing」重复
    socket.on('end', () => this.noteEarlyClose(session, 'closed by peer'));
    socket.on('close', () => this.dropSession(session));
  }

  /**
   * 连上后一帧合法报文都没发就被对端断开。以前这种连接完全不留痕迹：握手超时那条日志
   * 只在连接撑满 10 秒时才会记，对端 2 秒就断的连接什么都不剩——2026-09-28 排查设备不在线时，
   * 几十个探测点打来的空连接在日志里一条都找不到，没法向厂家证明「连上来的我们都看得见」。
   * 设备连上又立刻断、或被中间代理掐断，正是查「为什么不在线」时最需要看见的情况。
   */
  private noteEarlyClose(session: Session, how: string): void {
    if (session.frames > 0 || session.earlyCloseLogged) return;
    session.earlyCloseLogged = true;
    const ms = Date.now() - session.connectedAt.getTime();
    this.logger.log(
      `${session.addr} ${how} after ${ms}ms without a valid JT808 frame — `
        + (session.bytesIn === 0
          ? 'sent nothing'
          : `sent ${session.bytesIn} bytes starting ${session.firstBytes?.toString('hex')}`),
    );
  }

  /**
   * 连接槽位满时腾一个位置：先踢从没对上设备号的，再踢对上了但不是已登记设备的，
   * 同级里踢最久没动静的。已登记设备的连接绝不主动踢——那才是真的车。
   * 返回 false 表示在场的全是已登记设备，没得可踢。
   */
  private evictLeastTrusted(incomingAddr: string): boolean {
    const tier = (s: Session): number => (s.trusted ? 2 : s.deviceNo ? 1 : 0);
    let victim: Session | null = null;
    for (const s of this.sessions) {
      if (tier(s) === 2) continue;
      if (!victim || tier(s) < tier(victim) ||
          (tier(s) === tier(victim) && s.lastSeenAt.getTime() < victim.lastSeenAt.getTime())) {
        victim = s;
      }
    }
    if (!victim) return false;
    this.logger.warn(
      `connection limit reached, dropping an untrusted connection from ${victim.addr} ` +
        `(tier ${tier(victim)}, ${victim.frames} frames) to admit ${incomingAddr}`,
    );
    victim.socket.destroy();
    return true;
  }

  private dropSession(session: Session): void {
    if (session.handshakeTimer) { clearTimeout(session.handshakeTimer); session.handshakeTimer = null; }
    if (session.trustTimer) { clearTimeout(session.trustTimer); session.trustTimer = null; }
    this.sessions.delete(session);
    if (session.deviceNo && this.byDevice.get(session.deviceNo) === session) {
      this.byDevice.delete(session.deviceNo);
      this.logger.log(`device ${session.deviceNo} disconnected (${session.frames} frames)`);
    }
  }

  private onData(session: Session, chunk: Buffer): void {
    if (session.socket.destroyed) return;
    session.bytesIn += chunk.length;
    if (!session.firstBytes) session.firstBytes = Buffer.from(chunk.subarray(0, 32));
    // 先判上限再拼接：拼完再判的话，攻击者一次一个字节地喂到 64KB，
    // 光 Buffer.concat 的拷贝量就是 n²/2 ≈ 2GB，够把事件循环卡死（API 和网关同进程）。
    if (session.buffer.length + chunk.length > MAX_BUFFER) {
      this.logger.warn(`buffer overflow from ${session.addr}, dropping connection`);
      session.socket.destroy();
      return;
    }
    session.buffer = Buffer.concat([session.buffer, chunk]);
    const { frames, rest } = splitFrames(session.buffer);
    session.buffer = rest;
    for (const raw of frames) {
      const frame = decodeFrame(raw);
      if (!frame) continue;
      if (!frame.checksumOk) {
        session.badFrames++;
        if (session.badFrames <= MAX_BAD_FRAME_LOGS) {
          this.logger.warn(`bad checksum from ${session.addr} msg=0x${frame.msgId.toString(16)}`);
        } else if (session.badFrames === MAX_BAD_FRAME_LOGS + 1) {
          this.logger.warn(`further malformed frames from ${session.addr} will not be logged`);
        }
        continue;
      }
      if (frame.encrypted) {
        this.send(session, buildPlatformAck(frame.phone, this.nextSerial(session), frame.serial, frame.msgId, AckResult.UNSUPPORTED));
        if (this.noteProtocolError(session, `encrypted message not supported from ${session.addr}`)) return;
        continue;
      }
      // 一次 onData 里能切出几千帧；拒绝到上限而断开之后，剩下的帧不该继续排队处理
      if (session.socket.destroyed) return;
      session.frames++;
      session.lastSeenAt = new Date();
      if (session.handshakeTimer) { clearTimeout(session.handshakeTimer); session.handshakeTimer = null; }
      if (!this.bindDevice(session, frame.phone)) return;

      // 分包消息：先攒齐再处理。消息体长度字段只有 10 位（≤1023 字节），
      // 一个定位点 74 字节，所以盲区补报超过十几个点时终端必然分包发送。
      // 不重组就只会处理第一包、后面几包当残帧丢掉——而且我们还回了「成功」，终端就不再重传了。
      const assembled = frame.subpackage ? this.collectSubpackage(session, frame) : frame;
      if (!assembled) {
        // 还没攒齐：按协议逐包应答，等后续包
        this.send(session, buildPlatformAck(frame.phone, this.nextSerial(session), frame.serial, frame.msgId, AckResult.OK));
        continue;
      }
      // 逐帧串行处理，避免同一设备的分包/批量乱序；
      // 处理慢（数据库卡）时暂停读取，不让待处理链无限增长。
      session.pending++;
      if (session.pending >= MAX_PENDING_FRAMES && !session.socket.isPaused()) session.socket.pause();
      session.queue = session.queue
        .then(() => this.handleFrame(session, assembled))
        .catch((e) => {
          this.logger.error(`handle 0x${assembled.msgId.toString(16)} from ${session.deviceNo}: ${e?.message || e}`);
        })
        .then(() => {
          session.pending--;
          if (session.pending < MAX_PENDING_FRAMES && session.socket.isPaused()) session.socket.resume();
        });
    }
  }

  /**
   * 记一条协议层错误：前几条打日志，之后只汇总，超限直接断开。
   * 返回 true 表示连接已被关闭，调用方应立刻停止处理。
   */
  private noteProtocolError(session: Session, message: string): boolean {
    session.protocolErrors++;
    if (session.protocolErrors <= MAX_BAD_FRAME_LOGS) {
      this.logger.warn(message);
    } else if (session.protocolErrors === MAX_BAD_FRAME_LOGS + 1) {
      this.logger.warn(`further protocol errors from ${session.addr} will not be logged`);
    }
    if (session.protocolErrors >= MAX_PROTOCOL_ERRORS) {
      this.logger.warn(`${session.protocolErrors} protocol errors on one connection from ${session.addr}, closing`);
      session.socket.destroy();
      return true;
    }
    return false;
  }

  /**
   * 收集分包消息。攒齐返回拼好的整条消息，没攒齐返回 null。
   * 同一条消息的各包共用「消息ID + 总包数」，包序号从 1 开始。
   */
  private collectSubpackage(session: Session, frame: Jt808Frame): Jt808Frame | null {
    const { total, index } = frame.subpackage!;
    if (total < 1 || total > MAX_SUBPACKAGES || index < 1 || index > total) {
      // 这条路径在 handleFrame 之前就返回了，拒绝计数不会生效，所以必须自己限流并计数——
      // 否则一条连接可以无限刷 warn 日志（每 64KB 入站能产生约 4600 行）
      this.noteProtocolError(
        session,
        `bogus subpackage ${index}/${total} for 0x${frame.msgId.toString(16)} from ${session.deviceNo}`,
      );
      return null;
    }
    const key = `${frame.msgId}:${total}`;
    let set = session.partials.get(key);
    const now = Date.now();
    if (set && now - set.at > SUBPACKAGE_TTL_MS) {
      this.logger.warn(`discarding a stale ${set.parts.size}/${total} subpackage set from ${session.deviceNo}`);
      set = undefined;
    }
    // 分包重组在设备核验之前就要分配内存，所以未建立信任的连接只给很小的额度：
    // 500 条连接 × 4 组 × 128KB ≈ 270MB 全是陌生人可控的，足以把进程 OOM 掉，
    // 而 OOM 会把同进程的 HTTP API 一起带走。真实设备登记后额度照旧。
    const maxSets = session.trusted ? MAX_SUBPACKAGE_SETS : UNTRUSTED_SUBPACKAGE_SETS;
    const maxBytes = session.trusted ? MAX_SUBPACKAGE_BYTES : UNTRUSTED_SUBPACKAGE_BYTES;

    if (!set) {
      if (session.partials.size >= maxSets) {
        // 不要 clear()：那会把其它几组已经应答过 OK 的分包一起丢掉。
        // 丢最旧的那一组，并且说清楚丢了什么。
        let oldestKey: string | null = null;
        let oldestAt = Infinity;
        for (const [k, v] of session.partials) {
          if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
        }
        if (oldestKey) {
          const dropped = session.partials.get(oldestKey)!;
          this.logger.warn(
            `dropping an incomplete subpackage set ${oldestKey} (${dropped.parts.size} packets) from ` +
              `${session.deviceNo ?? session.addr} to make room; those points were already acked OK and are lost`,
          );
          session.partials.delete(oldestKey);
        }
      }
      set = { parts: new Map(), at: now, bytes: 0 };
      session.partials.set(key, set);
    }
    if (!set.parts.has(index)) {
      set.bytes += frame.body.length;
      if (set.bytes > maxBytes) {
        this.logger.warn(
          `subpackage set for 0x${frame.msgId.toString(16)} from ${session.deviceNo ?? session.addr} too large ` +
            `(${set.bytes} > ${maxBytes}${session.trusted ? '' : ', unregistered device'}), dropping`,
        );
        session.partials.delete(key);
        return null;
      }
      set.parts.set(index, frame.body);
    }
    set.at = now;
    if (set.parts.size < total) return null;

    session.partials.delete(key);
    const body = Buffer.concat(Array.from({ length: total }, (_, i) => set!.parts.get(i + 1)!));
    this.logger.log(`reassembled 0x${frame.msgId.toString(16)} from ${session.deviceNo}: ${total} packets, ${body.length} bytes`);
    return { ...frame, body, subpackage: undefined };
  }

  /** 返回 false 表示这一帧不该再处理（连接已被判定为异常并关闭） */
  private bindDevice(session: Session, phone: string): boolean {
    const deviceNo = normalizeDeviceNo(phone);
    if (session.deviceNo === deviceNo) { session.phone = phone; return true; }
    if (session.deviceNo) {
      // 真实终端在一条连接里不会换设备号；换号只可能是扫描/伪造，顺带还能借此把别的设备踢下线
      this.logger.warn(`device number changed on one connection (${session.deviceNo} -> ${deviceNo}) from ${session.addr}, closing`);
      session.socket.destroy();
      return false;
    }
    session.phone = phone;
    session.deviceNo = deviceNo;
    const previous = this.byDevice.get(deviceNo);
    if (previous && previous !== session) {
      // 同一设备重连：踢掉旧连接（设备休眠/换基站后重连很常见，不能拒绝新连接，否则真设备会被锁在外面）。
      // 但旧连接刚刚还在正常收发，说明可能有人拿着同一个设备号顶号——记下来以便排查。
      if (Date.now() - previous.lastSeenAt.getTime() < 60_000) {
        this.logger.warn(
          `device ${deviceNo} taken over by ${session.addr} while the previous connection (${previous.addr}) was still active`,
        );
      }
      previous.socket.destroy();
    }
    this.byDevice.set(deviceNo, session);
    this.logger.log(`device ${deviceNo} connected from ${session.addr}`);
    return true;
  }

  private async handleFrame(session: Session, frame: Jt808Frame): Promise<void> {
    const phone = frame.phone;
    const deviceNo = session.deviceNo!;
    const ack = (result: number = AckResult.OK) =>
      this.send(session, buildPlatformAck(phone, this.nextSerial(session), frame.serial, frame.msgId, result));

    // 未登记 / 已停用的设备：任何消息都登记到「未登记设备」列表，保证管理端一定能发现它。
    // （有些固件从别的平台切过来时会跳过注册，直接发心跳或定位；只认注册消息就会永远看不到这台设备）
    // 一律回失败，迫使终端重新走注册流程；登记完成后下一次注册即被接受。
    const device = await this.devices.findByDeviceNo(deviceNo);
    if (!device || !device.enabled) {
      this.noteUnregistered(session, deviceNo, !!device);
      if (frame.msgId === MsgId.REGISTER) {
        this.send(session, buildRegisterAck(phone, this.nextSerial(session), frame.serial, RegisterResult.TERMINAL_NOT_FOUND));
      } else if (frame.msgId !== MsgId.TERMINAL_ACK) {
        ack(AckResult.FAIL);
      }
      // 真实设备登记之后就不会再被拒；连续被拒只可能是拿设备号在试探，断开让它付出重连成本
      if (++session.rejects >= MAX_REJECTS_PER_SESSION) {
        this.logger.warn(`${session.rejects} rejected frames on one connection from ${session.addr}, closing`);
        session.socket.destroy();
      }
      return;
    }
    session.rejects = 0;
    if (!session.trusted) {
      // 从这一刻起这条连接对应到一台真实在册的车：连接准入时不再把它当陌生连接淘汰
      session.trusted = true;
      if (session.trustTimer) { clearTimeout(session.trustTimer); session.trustTimer = null; }
      // 它回来了：掉线报警（如果有）自动结案。每条连接只做一次
      await this.devices.deviceOnline(deviceNo);
    }

    switch (frame.msgId) {
      case MsgId.REGISTER: {
        session.authed = true;
        // 鉴权码沿用厂家平台做法：就是设备号本身
        this.send(session, buildRegisterAck(phone, this.nextSerial(session), frame.serial, RegisterResult.OK, device.deviceNo));
        await this.devices.touch(deviceNo);
        return;
      }
      case MsgId.AUTH: {
        session.authed = true;
        ack();
        await this.devices.touch(deviceNo);
        return;
      }
      case MsgId.HEARTBEAT:
      case MsgId.FAKE_SHUTDOWN_HEARTBEAT: {
        ack();
        await this.devices.touch(deviceNo);
        return;
      }
      case MsgId.POSITION: {
        ack(); // 先应答，避免终端重发
        const pos = parsePosition(frame.body, session.tzOffset);
        if (!pos) { this.logger.warn(`short position body from ${deviceNo}`); return; }
        await this.devices.ingest(deviceNo, pos, { clockTrusted: session.clockTrusted });
        return;
      }
      case MsgId.POSITION_QUERY_ACK: {
        // 旧固件对 0x8201 的应答：应答流水号(2) + 0x0200 消息体；新固件直接发 0x0200
        ack();
        if (frame.body.length > 2) {
          const pos = parsePosition(frame.body.subarray(2), session.tzOffset);
          if (pos) await this.devices.ingest(deviceNo, pos, { clockTrusted: session.clockTrusted });
        }
        return;
      }
      case MsgId.BATCH_POSITION: {
        ack();
        const batch = parseBatchPositions(frame.body);
        let stored = 0;
        for (const item of batch.items) {
          const pos = parsePosition(item, session.tzOffset);
          if (!pos) continue;
          if ((await this.devices.ingest(deviceNo, pos, { batch: true, blindZone: batch.blindZone })) === 'stored') stored++;
        }
        const tag = batch.blindZone ? ' (blind-zone backfill)' : '';
        if (batch.declared > batch.items.length) {
          // 平台已经回了 OK，终端会清掉本地缓存 —— 这些点是找不回来的，必须留下记录
          this.logger.warn(
            `batch from ${deviceNo}${tag}: device declared ${batch.declared} points but only ${batch.items.length} were parsed ` +
              `(cap ${MAX_BATCH_ITEMS}); the rest are lost because the batch was already acked OK`,
          );
        }
        this.logger.log(`batch from ${deviceNo}: ${batch.items.length} points${tag}, stored ${stored}`);
        return;
      }
      case MsgId.TIME_SYNC_REQ: {
        this.send(session, buildTimeSyncAck(phone, this.nextSerial(session), new Date(), session.tzOffset));
        return;
      }
      case MsgId.TIMEZONE_SYNC: {
        const tz = frame.body.length ? decodeTimezone(frame.body[0]) : null;
        if (tz !== null) {
          session.tzOffset = tz;
          session.clockTrusted = true;
          this.logger.log(`device ${deviceNo} reports timezone UTC${tz >= 0 ? '+' : ''}${tz}`);
        }
        ack();
        return;
      }
      case MsgId.SLEEP_BATTERY: {
        ack();
        if (frame.body.length) await this.devices.touch(deviceNo, { batteryPercent: frame.body[0] });
        return;
      }
      case MsgId.LOGOUT: {
        ack();
        session.authed = false;
        return;
      }
      case MsgId.TERMINAL_ACK: {
        // 终端对我们下发指令的应答：只记日志
        if (frame.body.length >= 5) {
          const replyId = frame.body.readUInt16BE(2);
          const result = frame.body[4];
          this.logger.log(`device ${deviceNo} ack 0x${replyId.toString(16)} result=${result}`);
        }
        return;
      }
      case MsgId.ATTRIBUTES: {
        // 0x0107 终端属性：里面带 SIM 卡 ICCID（BCD）
        ack();
        const { iccid } = parseTerminalAttributes(frame.body);
        await this.devices.touch(deviceNo, iccid ? { iccid } : {});
        return;
      }
      case MsgId.ICCID: {
        // 0x1107：厂家为「带字母的 ICCID」专门加的消息。记不记日志由 service 按「有没有变」决定，
        // 这里不逐帧打——设备号可被伪造，逐帧日志就是任人刷的日志
        ack();
        const { iccid } = parseIccidMessage(frame.body);
        await this.devices.touch(deviceNo, iccid ? { iccid } : {});
        return;
      }
      default: {
        // 0x0112/0x0114 等：统一通用应答，保持终端在线。
        // 每种记一次：设备在断电、休眠这些关头发了什么我们没处理的消息，是排查时唯一的线索
        if (!session.unhandledMsgIds.has(frame.msgId) && session.unhandledMsgIds.size < 32) {
          session.unhandledMsgIds.add(frame.msgId);
          this.logger.log(
            `device ${deviceNo} sent 0x${frame.msgId.toString(16).padStart(4, '0')} (${frame.body.length} bytes, acked, not processed)`,
          );
        }
        ack();
        return;
      }
    }
  }

  private noteUnregistered(session: Session, deviceNo: string, disabled: boolean): void {
    const cur = this.unregistered.get(deviceNo);
    if (cur) {
      cur.count++;
      cur.lastAt = new Date();
      cur.addr = session.addr;
      cur.disabled = disabled;
      // 终端会不停重试，日志按次数降频，避免刷屏
      if (cur.count % 50 === 0) {
        this.logger.warn(`${disabled ? 'disabled' : 'unregistered'} device ${deviceNo} still trying (${cur.count}x)`);
      }
      return;
    }
    if (this.unregistered.size >= MAX_UNREGISTERED) {
      const oldest = [...this.unregistered.entries()].sort((a, b) => a[1].lastAt.getTime() - b[1].lastAt.getTime())[0];
      if (oldest) this.unregistered.delete(oldest[0]);
    }
    this.unregistered.set(deviceNo, { deviceNo, addr: session.addr, count: 1, lastAt: new Date(), disabled });
    this.logger.warn(`${disabled ? 'disabled' : 'unregistered'} device ${deviceNo} connected from ${session.addr} — register it in the admin console`);
  }

  private nextSerial(session: Session): number {
    session.serial = (session.serial + 1) & 0xffff;
    return session.serial;
  }

  private send(session: Session, frame: Buffer): void {
    if (session.socket.destroyed) return;
    session.socket.write(frame);
  }
}
