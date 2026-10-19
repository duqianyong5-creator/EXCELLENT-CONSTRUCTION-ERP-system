import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, UserStatus } from '../../users/user.entity';

/**
 * database.sql 里种了一个 admin 账号方便首次登录，口令是公开写在安装说明里的。
 * 装完不改就等于把管理员权限挂在公网上——能改派任务、改用户，还能下发 set_server
 * 把整个车队的定位器指到别人的服务器。
 *
 * 这里每次启动查一遍：还在用默认口令就打一条醒目的告警，并在设备/设置页可见的
 * 位置留下痕迹。只读取哈希做比对，不会改动任何数据。
 */
const SHIPPED_DEFAULTS = ['admin888'];

@Injectable()
export class DefaultCredentialCheckService implements OnModuleInit {
  private readonly logger = new Logger('LaunchHygiene');
  private insecureAccounts: string[] = [];

  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  async onModuleInit(): Promise<void> {
    try {
      const admins = await this.repo.find({
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
        select: ['id', 'username', 'password'],
      });

      const weak: string[] = [];
      for (const admin of admins) {
        if (!admin.password) continue;
        for (const candidate of SHIPPED_DEFAULTS) {
          if (await bcrypt.compare(candidate, admin.password)) {
            weak.push(admin.username);
            break;
          }
        }
      }

      this.insecureAccounts = weak;
      if (weak.length === 0) return;

      this.logger.error(
        `SECURITY: ${weak.length} admin account(s) still use the password published in the install docs: ` +
          `${weak.join(', ')}. Anyone who can reach this API can take over dispatch. ` +
          'Change it now under 系统设置 → 修改密码.',
      );
    } catch (e: any) {
      // 这只是个体检项，查不了也不能把服务拦在启动之外
      this.logger.warn(`default credential check skipped: ${e?.message || e}`);
    }
  }

  /** 供管理端显示告警条 */
  getInsecureAdminAccounts(): string[] {
    return [...this.insecureAccounts];
  }
}
