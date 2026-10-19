import { AnnouncementsService } from './announcements.service';
import { AnnouncementTarget } from './announcement.entity';
import { UserRole } from '../users/user.entity';

function build() {
  const repo = {
    find: jest.fn(async (..._args: any[]) => []),
    create: jest.fn((d) => d),
    save: jest.fn(async (d) => ({ id: 'a1', ...d })),
    findOne: jest.fn(),
    remove: jest.fn(),
  };
  return { service: new AnnouncementsService(repo as any), repo };
}

describe('AnnouncementsService.feedForRole', () => {
  it('returns ALL + CLIENT announcements for a client', async () => {
    const { service, repo } = build();
    await service.feedForRole(UserRole.CLIENT);
    const where = repo.find.mock.calls[0][0].where;
    expect(where.active).toBe(true);
    expect(where.targetRole.value).toEqual([AnnouncementTarget.ALL, AnnouncementTarget.CLIENT]);
  });

  it('returns ALL + DRIVER announcements for a driver', async () => {
    const { service, repo } = build();
    await service.feedForRole(UserRole.DRIVER);
    const where = repo.find.mock.calls[0][0].where;
    expect(where.targetRole.value).toEqual([AnnouncementTarget.ALL, AnnouncementTarget.DRIVER]);
  });

  it('returns only ALL announcements for other roles (e.g. admin)', async () => {
    const { service, repo } = build();
    await service.feedForRole(UserRole.ADMIN);
    const where = repo.find.mock.calls[0][0].where;
    expect(where.targetRole.value).toEqual([AnnouncementTarget.ALL]);
  });
});

describe('AnnouncementsService.create', () => {
  it('defaults the target to ALL and marks the announcement active', async () => {
    const { service, repo } = build();
    await service.create({ title: 'Hi', content: 'Body' });
    const created = repo.create.mock.calls[0][0];
    expect(created.targetRole).toBe(AnnouncementTarget.ALL);
    expect(created.active).toBe(true);
  });
});
