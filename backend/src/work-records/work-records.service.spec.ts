import { ForbiddenException } from '@nestjs/common';
import { WorkRecordsService } from './work-records.service';
import { UserRole } from '../users/user.entity';

/**
 * 这个模块之前一个测试都没有，于是两件事同时漏了网：
 *
 * 1. 读取时会把 imageUrls 换成 1 小时有效的签名链接。任何「先 findById 再 save」
 *    的写路径都会把这些带 token 的临时地址写回库里，覆盖掉真正的对象路径。
 *    applyAdjustment 当时改对了，setFinalDuration 和 delete 没有。
 * 2. 客户是公司外部账号，findAll 必须按 clientId 收窄；
 *    不收窄的话客户用自己的 token 就能拉到全公司的工时、司机姓名和完工照片。
 */

const RAW_PATHS = ['work-records/a.jpg', 'work-records/b.jpg'];
const signed = (p: string) => `https://x.supabase.co/storage/v1/object/sign/bucket/${p}?token=TOKEN`;

function build(record: any = {}) {
  const stored = {
    id: 'wr1',
    driverId: 'd1',
    systemDuration: 60,
    adjustmentTime: 0,
    finalDuration: 60,
    imageUrls: [...RAW_PATHS],
    task: { clientId: 'c1' },
    ...record,
  };

  const qb: any = {
    leftJoinAndSelect: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    where: jest.fn(() => qb),
    getMany: jest.fn(async () => [stored]),
  };
  const repo = {
    findOne: jest.fn(async () => stored),
    save: jest.fn(async (v: any) => v),
    remove: jest.fn(async (v: any) => v),
    update: jest.fn(async () => undefined),
    createQueryBuilder: jest.fn(() => qb),
  };
  const storage = { signUrls: jest.fn(async (urls: string[]) => urls.map(signed)) };
  const service = new WorkRecordsService(repo as any, storage as any);
  return { service, repo, storage, qb, stored };
}

describe('WorkRecordsService photo URLs', () => {
  it('signs photo urls when reading', async () => {
    const { service } = build();
    const out = await service.findById('wr1');
    expect(out.imageUrls).toEqual(RAW_PATHS.map(signed));
  });

  // 下面三条是同一个 bug 的三个入口。签名链接一小时后失效，
  // 写回库里就等于把照片地址换成了定时炸弹。
  it('setFinalDuration must not persist the signed copy', async () => {
    const { service, repo } = build();
    await service.setFinalDuration('wr1', 120);
    const saved = repo.save.mock.calls.at(-1)![0] as any;
    expect(saved.imageUrls).toEqual(RAW_PATHS);
    expect(saved.finalDuration).toBe(120);
  });

  it('applyAdjustment must not persist the signed copy', async () => {
    const { service, repo } = build();
    await service.applyAdjustment('wr1', 30);
    const saved = repo.save.mock.calls.at(-1)![0] as any;
    expect(saved.imageUrls).toEqual(RAW_PATHS);
    expect(saved.finalDuration).toBe(90);
  });

  it('delete must hand TypeORM the managed entity, not a spread copy', async () => {
    const { service, repo, stored } = build();
    await service.delete('wr1');
    expect(repo.remove).toHaveBeenCalledWith(stored);
  });

  it('never calls the signer on a write path', async () => {
    // 最直接的回归护栏：写路径根本不该碰签名逻辑
    const { service, storage } = build();
    await service.setFinalDuration('wr1', 120);
    await service.applyAdjustment('wr1', 10);
    await service.delete('wr1');
    expect(storage.signUrls).not.toHaveBeenCalled();
  });
});

describe('WorkRecordsService visibility', () => {
  it('narrows the list to the client own jobs', async () => {
    const { service, qb } = build();
    await service.findAll({ role: UserRole.CLIENT, id: 'c1' });
    expect(qb.where).toHaveBeenCalledWith('task.clientId = :id', { id: 'c1' });
  });

  it('narrows the list to the driver own records', async () => {
    const { service, qb } = build();
    await service.findAll({ role: UserRole.DRIVER, id: 'd1' });
    expect(qb.where).toHaveBeenCalledWith('wr.driverId = :id', { id: 'd1' });
  });

  it('does not narrow for staff', async () => {
    const { service, qb } = build();
    await service.findAll({ role: UserRole.DISPATCHER, id: 'x' });
    expect(qb.where).not.toHaveBeenCalled();
  });

  it('refuses a driver reading someone else record', async () => {
    const { service } = build({ driverId: 'other' });
    await expect(service.findById('wr1', { role: UserRole.DRIVER, id: 'd1' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a client reading another customer job', async () => {
    const { service } = build({ task: { clientId: 'other' } });
    await expect(service.findById('wr1', { role: UserRole.CLIENT, id: 'c1' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the owning client through', async () => {
    const { service } = build();
    await expect(service.findById('wr1', { role: UserRole.CLIENT, id: 'c1' })).resolves.toBeDefined();
  });
});
