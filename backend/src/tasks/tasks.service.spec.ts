import { TasksService } from './tasks.service';

describe('TasksService operation logging', () => {
  function createService() {
    const savedTask = {
      id: 'task-1',
      title: 'Concrete delivery',
      clientId: 'client-1',
      driverId: null,
      dispatcherId: 'admin-1',
      status: 'pending',
    };
    const taskRepo = {
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async () => savedTask),
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
    };
    const service = new TasksService(
      taskRepo as any,
      { create: jest.fn(), save: jest.fn(), findOne: jest.fn(), delete: jest.fn() } as any,
      { delete: jest.fn() } as any,
      { create: jest.fn() } as any,
      { record: jest.fn() } as any,
    );

    return {
      service,
      taskRepo,
      operationLogs: (service as any).operationLogs,
    };
  }

  it('records an operation log when an admin creates a task', async () => {
    const { service, operationLogs } = createService();

    await service.create(
      {
        clientId: 'client-1',
        title: 'Concrete delivery',
        startLocation: 'Depot',
        endLocation: 'Site',
      },
      { id: 'admin-1', username: 'admin', role: 'admin' },
    );

    expect(operationLogs.record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      actorName: 'admin',
      action: 'tasks.create',
      targetType: 'task',
      targetId: 'task-1',
      description: 'Created task Concrete delivery',
      details: {
        clientId: 'client-1',
        driverId: null,
        status: 'pending',
      },
    });
  });
});

describe('TasksService.completeTask notes', () => {
  // 司机 App 之前把备注放在 completionNotes 字段里发，后端读的是 notes —— 备注从来没存进去过
  function setup() {
    const task: any = { id: 't1', title: 'Job', clientId: 'c1', driverId: 'd1', status: 'in_progress' };
    const record: any = { id: 'w1', taskId: 't1', driverId: 'd1', startTime: new Date(Date.now() - 3600_000) };
    const taskRepo = { findOne: jest.fn(async () => task), save: jest.fn(async (t: any) => t) };
    const workRepo = { findOne: jest.fn(async () => record), save: jest.fn(async (r: any) => r) };
    const service = new TasksService(
      taskRepo as any, workRepo as any, { delete: jest.fn() } as any,
      { create: jest.fn() } as any, { record: jest.fn() } as any,
    );
    return { service, task, record, taskRepo, workRepo };
  }

  it('stores the trimmed notes on the work record (empty becomes null)', async () => {
    const { service, record } = setup();
    await service.completeTask('t1', 'd1', { notes: '  unloaded at gate 3, signed by Wang  ', imageUrls: [] });
    expect(record.completionNotes).toBe('unloaded at gate 3, signed by Wang');
    const second = setup();
    await second.service.completeTask('t1', 'd1', { notes: '   ', imageUrls: [] });
    expect(second.record.completionNotes).toBeNull();
  });

  it('rejects over-long notes before the task is marked completed', async () => {
    const { service, task, taskRepo } = setup();
    await expect(service.completeTask('t1', 'd1', { notes: 'x'.repeat(2001), imageUrls: [] })).rejects.toThrow();
    expect(task.status).toBe('in_progress');
    expect(taskRepo.save).not.toHaveBeenCalled();
  });
});
