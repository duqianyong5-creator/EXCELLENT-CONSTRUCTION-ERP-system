import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createCorsOriginResolver, requireConfig } from '../config/security.config';
import { UserRole } from '../users/user.entity';

type ConnectedUser = {
  role: string;
  socketIds: Set<string>;
};

@WebSocketGateway({
  cors: {
    origin: createCorsOriginResolver(new ConfigService()),
    credentials: true,
  },
  namespace: '/',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('WsGateway');

  private connectedUsers = new Map<string, ConnectedUser>();

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) {
        this.logger.warn(`socket ${client.id} rejected: no token`);
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: requireConfig(this.config, 'JWT_SECRET'),
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      const existing = this.connectedUsers.get(payload.sub);
      if (existing) {
        existing.socketIds.add(client.id);
        existing.role = payload.role;
      } else {
        this.connectedUsers.set(payload.sub, {
          role: payload.role,
          socketIds: new Set([client.id]),
        });
      }
      client.join(`user:${payload.sub}`);
      client.join(`role:${payload.role}`);
      this.logger.log(`socket connected: role=${payload.role} user=${payload.sub} | online drivers=${this.getOnlineDriverIds().length}`);
      if (payload.role === UserRole.DRIVER) {
        this.broadcastDriverPresenceUpdate();
      }
    } catch (e: any) {
      this.logger.warn(`socket ${client.id} rejected: token verify failed (${e?.message || e})`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data.userId) {
      const existing = this.connectedUsers.get(client.data.userId);
      existing?.socketIds.delete(client.id);
      if (existing && existing.socketIds.size === 0) {
        this.connectedUsers.delete(client.data.userId);
      }
      if (client.data.role === UserRole.DRIVER) {
        this.broadcastDriverPresenceUpdate();
      }
    }
  }

  getOnlineDriverIds(): string[] {
    return [...this.connectedUsers.entries()]
      .filter(([, user]) => user.role === UserRole.DRIVER && user.socketIds.size > 0)
      .map(([userId]) => userId);
  }

  private broadcastDriverPresenceUpdate() {
    if (!this.server) return;
    const driverIds = this.getOnlineDriverIds();
    this.server
      .to(`role:${UserRole.ADMIN}`)
      .to(`role:${UserRole.DISPATCHER}`)
      .emit('driver-presence:update', {
        driverIds,
        count: driverIds.length,
        timestamp: Date.now(),
      });
  }

  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  sendToRole(role: string, event: string, data: any) {
    this.server.to(`role:${role}`).emit(event, data);
  }

  broadcastGpsUpdate(driverId: string, gpsData: any) {
    if (!this.server) return;
    // 只推给运营角色（管理员/调度/监控），避免把全队司机的实时坐标广播给客户/司机端。
    // 客户端/司机端通过各自的接口轮询自己有权看的定位。
    this.server
      .to(`role:${UserRole.ADMIN}`)
      .to(`role:${UserRole.DISPATCHER}`)
      .to(`role:${UserRole.MONITOR}`)
      .emit('gps:update', { driverId, ...gpsData });
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { time: Date.now() });
  }
}
