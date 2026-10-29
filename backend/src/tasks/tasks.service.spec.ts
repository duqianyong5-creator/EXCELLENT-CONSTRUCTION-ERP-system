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
      { get: jest.fn(async () => '0') } as any,
      { create: jest.fn((d: any) => d), save: jest.fn(async (d: any) => d) } as any,
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
    const taskRepo = { findOne: jest.fn(async () => task), save: jest.fn(async (t: any) => t), update: jest.fn(async () => ({ affected: 1 })) };
    const workRepo = { findOne: jest.fn(async () => record), save: jest.fn(async (r: any) => r) };
    const service = new TasksService(
      taskRepo as any, workRepo as any, { delete: jest.fn() } as any,
      { create: jest.fn() } as any, { record: jest.fn() } as any,
      { get: jest.fn(async () => '0') } as any,
      { create: jest.fn((d: any) => d), save: jest.fn(async (d: any) => d) } as any,
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

describe('TasksService.completeTask default adjustment', () => {
  // System Settings promises "time added automatically to every work record". Until now the console only
  // remembered the choice in the browser and nothing on the server applied it, so final hours always
  // equalled the measured hours (a 21-minute job stayed 0h21m with "+30 minutes" set).
  function setup(minutes: string) {
    const task: any = { id: 't1', title: 'Job', clientId: 'c1', driverId: 'd1', status: 'in_progress' };
    const record: any = { id: 'w1', taskId: 't1', driverId: 'd1', adjustmentTime: 0, startTime: new Date(Date.now() - 21 * 60_000) };
    const taskRepo = { findOne: jest.fn(async () => task), save: jest.fn(async (t: any) => t), update: jest.fn(async () => ({ affected: 1 })) };
    const workRepo = { findOne: jest.fn(async () => record), save: jest.fn(async (r: any) => r) };
    const adjustRepo = { create: jest.fn((d: any) => d), save: jest.fn(async (d: any) => ({ id: 'a1', ...d })) };
    const service = new TasksService(
      taskRepo as any, workRepo as any, { delete: jest.fn() } as any,
      { create: jest.fn() } as any, { record: jest.fn() } as any,
      { get: jest.fn(async () => minutes) } as any, adjustRepo as any,
    );
    return { service, record, adjustRepo };
  }

  it('adds the configured minutes to the final hours and logs a system adjustment', async () => {
    const { service, record, adjustRepo } = setup('30');
    await service.completeTask('t1', 'd1', { notes: '', imageUrls: [] });
    expect(record.systemDuration).toBe(21);
    expect(record.adjustmentTime).toBe(30);
    expect(record.finalDuration).toBe(51);
    expect(adjustRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      workRecordId: 'w1', taskId: 't1', driverId: 'd1', addedMinutes: 30, operatorId: 'd1',
    }));
  });

  it('leaves the hours alone when the setting is 0 or unreadable', async () => {
    for (const v of ['0', '', 'abc', '-5']) {
      const { service, record, adjustRepo } = setup(v);
      await service.completeTask('t1', 'd1', { notes: '', imageUrls: [] });
      expect(record.finalDuration).toBe(21);
      expect(record.adjustmentTime).toBe(0);
      expect(adjustRepo.save).not.toHaveBeenCalled();
    }
  });
});

describe('TasksService.delete', () => {
  // Deleting a task used to fail ("delete failed" in the console) once anything else pointed at it:
  // adjustment_logs.task_id is NOT NULL with a foreign key, and gps_anomalies.task_id has one too.
  // Every completed job now carries an automatic adjustment log, so every new completed job hit it.
  it('removes the rows that reference the task, in one transaction, before the task itself', async () => {
    const task: any = { id: 't1', title: 'Old job', status: 'completed' };
    const calls: string[] = [];
    const m = {
      delete: jest.fn(async (entity: any, where: any) => { calls.push(`delete ${entity.name} ${JSON.stringify(where)}`); }),
      update: jest.fn(async (entity: any, where: any, set: any) => { calls.push(`update ${entity.name} ${JSON.stringify(where)} ${JSON.stringify(set)}`); }),
      remove: jest.fn(async (e: any) => { calls.push(`remove task ${e.id}`); }),
    };
    const taskRepo: any = {
      findOne: jest.fn(async () => task),
      manager: { transaction: jest.fn(async (cb: any) => cb(m)) },
    };
    const service = new TasksService(
      taskRepo, { findOne: jest.fn(async () => null) } as any, {} as any, { create: jest.fn() } as any, { record: jest.fn() } as any,
      { get: jest.fn() } as any, {} as any,
    );
    await service.delete('t1', { id: 'admin', role: 'admin' });
    expect(taskRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'delete AdjustmentLog {"taskId":"t1"}',
      'update GpsAnomaly {"taskId":"t1"} {"taskId":null}',
      'delete GpsLog {"taskId":"t1"}',
      'delete WorkRecord {"taskId":"t1"}',
      'remove task t1',
    ]);
  });
});

describe('TasksService.update (edit dialog)', () => {
  function setup(status = 'assigned') {
    const task: any = { id: 't1', title: 'Job', clientId: 'c1', driverId: 'd1', status, endLocation: 'Old', cargo: 'x' };
    const taskRepo: any = { findOne: jest.fn(async () => task), save: jest.fn(async (t: any) => t) };
    const service = new TasksService(
      taskRepo, {} as any, {} as any, { create: jest.fn() } as any, { record: jest.fn() } as any,
      { get: jest.fn() } as any, {} as any,
    );
    return { service, task, taskRepo };
  }

  // The endpoint took the whole request body and Object.assign-ed it onto the task, so a dispatcher could set
  // status, driver or client directly and skip the assign/start/complete flows (no notification, no work record).
  it('changes only the fields the edit dialog owns', async () => {
    const { service, task } = setup();
    await service.update('t1', {
      endLocation: 'New site', cargo: 'Gravel', cargoWeight: 12 as any, notes: 'gate 3', scheduledAt: null as any,
      status: 'completed' as any, driverId: 'other', clientId: 'other', id: 'hijack', title: 'renamed',
    } as any, { id: 'a', role: 'admin' });
    expect(task).toMatchObject({ endLocation: 'New site', cargo: 'Gravel', cargoWeight: 12, notes: 'gate 3', scheduledAt: null });
    expect(task).toMatchObject({ id: 't1', status: 'assigned', driverId: 'd1', clientId: 'c1', title: 'Job' });
  });

  it('refuses to edit a completed or cancelled task', async () => {
    for (const st of ['completed', 'cancelled']) {
      const { service, taskRepo } = setup(st);
      await expect(service.update('t1', { endLocation: 'New' } as any)).rejects.toThrow();
      expect(taskRepo.save).not.toHaveBeenCalled();
    }
  });
});

describe('TasksService.completeTask robustness', () => {
  function setup(opts: { record?: boolean; adjustFails?: boolean; minutes?: string } = {}) {
    const task: any = { id: 't1', title: 'Job', clientId: 'c1', driverId: 'd1', status: 'in_progress' };
    const record: any = opts.record === false ? null : { id: 'w1', taskId: 't1', driverId: 'd1', adjustmentTime: 0, startTime: new Date(Date.now() - 20 * 60_000) };
    const taskRepo = { findOne: jest.fn(async () => task), save: jest.fn(async (t: any) => t), update: jest.fn(async () => ({ affected: 1 })) };
    const workRepo = { findOne: jest.fn(async () => record), save: jest.fn(async (r: any) => r) };
    const adjustRepo = { create: jest.fn((d: any) => d), save: jest.fn(async (d: any) => { if (opts.adjustFails) throw new Error('db'); return d; }) };
    const notif = { create: jest.fn() };
    const service = new TasksService(
      taskRepo as any, workRepo as any, { delete: jest.fn() } as any, notif as any, { record: jest.fn() } as any,
      { get: jest.fn(async () => opts.minutes ?? '30') } as any, adjustRepo as any,
    );
    return { service, task, record, notif };
  }

  it('does not mark the task completed when there is no work record', async () => {
    const { service, task } = setup({ record: false });
    await expect(service.completeTask('t1', 'd1', { notes: '', imageUrls: [] })).rejects.toThrow();
    expect(task.status).toBe('in_progress');
  });

  it('still completes and notifies the client when the adjustment log cannot be written', async () => {
    const { service, task, record, notif } = setup({ adjustFails: true });
    await expect(service.completeTask('t1', 'd1', { notes: '', imageUrls: [] })).resolves.toBeTruthy();
    expect(task.status).toBe('completed');
    expect(record.finalDuration).toBe(50);
    expect(notif.create).toHaveBeenCalled();
  });

  it('caps an absurd configured adjustment at 8 hours', async () => {
    const { service, record } = setup({ minutes: '100000' });
    await service.completeTask('t1', 'd1', { notes: '', imageUrls: [] });
    expect(record.adjustmentTime).toBe(480);
  });
});

describe('TasksService.completeTask concurrency', () => {
  // A double tap or a network retry used to complete the job twice and write two adjustment logs
  it('only the first of two concurrent completions goes through', async () => {
    const task: any = { id: 't1', title: 'Job', clientId: 'c1', driverId: 'd1', status: 'in_progress' };
    const record: any = { id: 'w1', taskId: 't1', driverId: 'd1', adjustmentTime: 0, startTime: new Date(Date.now() - 600_000) };
    let claimed = false;
    const taskRepo: any = {
      findOne: jest.fn(async () => ({ ...task })),
      save: jest.fn(async (t: any) => t),
      update: jest.fn(async () => { if (claimed) return { affected: 0 }; claimed = true; return { affected: 1 }; }),
    };
    const adjustRepo = { create: jest.fn((d: any) => d), save: jest.fn(async (d: any) => d) };
    const service = new TasksService(
      taskRepo, { findOne: jest.fn(async () => record), save: jest.fn(async (r: any) => r) } as any, {} as any,
      { create: jest.fn() } as any, { record: jest.fn() } as any, { get: jest.fn(async () => '30') } as any, adjustRepo as any,
    );
    const results = await Promise.allSettled([
      service.completeTask('t1', 'd1', { notes: '', imageUrls: [] }),
      service.completeTask('t1', 'd1', { notes: '', imageUrls: [] }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(adjustRepo.save).toHaveBeenCalledTimes(1);
  });
});

describe('TasksService.delete permissions', () => {
  it('a dispatcher cannot delete a completed task (it carries paid hours)', async () => {
    const taskRepo: any = { findOne: jest.fn(async () => ({ id: 't1', title: 'Job', status: 'completed' })), manager: { transaction: jest.fn() } };
    const service = new TasksService(
      taskRepo, { findOne: jest.fn() } as any, {} as any, { create: jest.fn() } as any, { record: jest.fn() } as any,
      { get: jest.fn() } as any, {} as any,
    );
    await expect(service.delete('t1', { id: 'd', role: 'dispatcher' })).rejects.toThrow();
    expect(taskRepo.manager.transaction).not.toHaveBeenCalled();
  });
});
