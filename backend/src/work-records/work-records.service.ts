import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkRecord } from './work-record.entity';
import { UserRole } from '../users/user.entity';
import { ErrorCode } from '../common/i18n/messages';
import { StorageService } from '../common/services/storage.service';

@Injectable()
export class WorkRecordsService {
  constructor(
    @InjectRepository(WorkRecord) private repo: Repository<WorkRecord>,
    private storage: StorageService,
  ) {}

  /**
   * 工完照片在库里存的是存储桶里的对象路径（历史数据是公开 URL），
   * 返回给客户端时现签一个短期链接。这样桶可以是私有的，
   * 照片地址外泄也只在有效期内有用。
   */
  private async withSignedPhotos<T extends { imageUrls?: string[] | null }>(record: T): Promise<T> {
    if (!record?.imageUrls?.length) return record;
    return { ...record, imageUrls: await this.storage.signUrls(record.imageUrls) };
  }

  private async withSignedPhotosMany<T extends { imageUrls?: string[] | null }>(records: T[]): Promise<T[]> {
    return Promise.all(records.map((r) => this.withSignedPhotos(r)));
  }

  async findAll(user: any) {
    const qb = this.repo
      .createQueryBuilder('wr')
      .leftJoinAndSelect('wr.driver', 'driver')
      .leftJoinAndSelect('wr.task', 'task')
      .leftJoinAndSelect('task.client', 'client')
      .orderBy('wr.createdAt', 'DESC');

    if (user.role === UserRole.DRIVER) {
      qb.where('wr.driverId = :id', { id: user.id });
    } else if (user.role === UserRole.CLIENT) {
      // 客户是公司外部账号。以前这里不收窄，客户用自己的 token 就能拉到
      // 全公司所有司机的工时、姓名和完工照片。
      qb.where('task.clientId = :id', { id: user.id });
    }

    return this.withSignedPhotosMany(await qb.getMany());
  }

  async findByTask(taskId: string, actor?: any): Promise<WorkRecord | null> {
    const record = await this.repo.findOne({
      where: { taskId },
      relations: ['driver', 'task'],
    });
    if (record) this.assertVisible(record, actor);
    return record ? this.withSignedPhotos(record) : record;
  }

  /** 客户只能看自己任务的工时，司机只能看自己的 */
  private assertVisible(record: WorkRecord, actor?: any): void {
    if (!actor) return;
    if (actor.role === UserRole.DRIVER && record.driverId !== actor.id) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN_WORK_RECORD);
    }
    if (actor.role === UserRole.CLIENT && (record as any).task?.clientId !== actor.id) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN_WORK_RECORD);
    }
  }

  async findByDriver(driverId: string): Promise<WorkRecord[]> {
    return this.repo.find({
      where: { driverId },
      relations: ['task'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, actor?: any): Promise<WorkRecord> {
    const record = await this.findRaw(id);
    this.assertVisible(record, actor);
    return this.withSignedPhotos(record);
  }

  /**
   * 未经签名处理的原始实体，给要写回数据库的地方用。
   * 签名版是 spread 出来的副本、imageUrls 已经换成带 token 的临时链接，
   * 拿它去 save() 会把对象路径覆盖成几小时后就失效的地址。
   */
  private async findRaw(id: string): Promise<WorkRecord> {
    const record = await this.repo.findOne({
      where: { id },
      relations: ['driver', 'task'],
    });
    if (!record) throw new NotFoundException('工作记录不存在');
    return record;
  }

  async applyAdjustment(id: string, addedMinutes: number): Promise<WorkRecord> {
    const record = await this.findRaw(id);
    record.adjustmentTime += addedMinutes;
    record.finalDuration = record.systemDuration + record.adjustmentTime;
    return this.repo.save(record);
  }

  async setFinalDuration(id: string, finalDuration: number): Promise<WorkRecord> {
    const record = await this.findRaw(id);
    record.finalDuration = finalDuration;
    return this.repo.save(record);
  }

  async updateGpsDuration(taskId: string, gpsDuration: number): Promise<void> {
    await this.repo.update({ taskId }, { gpsDuration });
  }

  async delete(id: string): Promise<void> {
    // 同样要用原始实体：findById 返回的是 spread 出来的副本，
    // 不是 TypeORM 管理的实体，remove() 拿它删依赖主键能对上纯属侥幸
    const record = await this.findRaw(id);
    await this.repo.remove(record);
  }
}
