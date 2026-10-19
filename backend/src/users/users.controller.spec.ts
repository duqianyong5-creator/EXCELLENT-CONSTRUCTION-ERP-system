import { BadRequestException } from '@nestjs/common';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  function createController() {
    const service = {
      findAll: jest.fn(),
      findDrivers: jest.fn(),
      findClients: jest.fn(),
      findById: jest.fn(),
      findByEmailOrUsername: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      disable: jest.fn(),
      enable: jest.fn(),
      updateRole: jest.fn(),
      updateUser: jest.fn(),
      updateProfile: jest.fn(),
      delete: jest.fn(),
      changePassword: jest.fn(),
      resetPassword: jest.fn(),
    };

    const operationLogs = {
      record: jest.fn(),
    };

    return {
      controller: new UsersController(service as any, operationLogs as any),
      service,
      operationLogs,
    };
  }

  it('requires an explicit password when an admin creates a user', async () => {
    const { controller } = createController();

    await expect(
      controller.create({
        username: 'driver001',
        email: 'driver001@example.com',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('records an operation log when an admin resets a password', async () => {
    const { controller, service, operationLogs } = createController();
    service.resetPassword.mockResolvedValue({ message: 'Password reset' });

    await controller.resetPassword(
      'user-1',
      'new-password',
      { id: 'admin-1', username: 'admin' },
    );

    expect(operationLogs.record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      actorName: 'admin',
      action: 'users.reset-password',
      targetType: 'user',
      targetId: 'user-1',
      description: 'Reset user password',
      details: {},
    });
  });

  it('allows an admin to edit account fields without accepting password changes', async () => {
    const { controller, service, operationLogs } = createController();
    service.updateUser.mockResolvedValue({
      id: 'user-1',
      username: 'driver01',
      email: 'driver01@example.com',
      fullName: 'Driver One',
      phone: '0210000000',
      role: 'driver',
      status: 'active',
    });

    const result = await controller.updateUser(
      'user-1',
      {
        username: 'driver01',
        email: 'driver01@example.com',
        fullName: 'Driver One',
        phone: '0210000000',
        role: 'driver',
        status: 'active',
        password: 'should-not-be-accepted',
      },
      { id: 'admin-1', username: 'admin' },
    );

    expect(service.updateUser).toHaveBeenCalledWith('user-1', {
      username: 'driver01',
      email: 'driver01@example.com',
      fullName: 'Driver One',
      phone: '0210000000',
      role: 'driver',
      status: 'active',
    });
    expect(result.username).toBe('driver01');
    expect(operationLogs.record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      actorName: 'admin',
      action: 'users.update',
      targetType: 'user',
      targetId: 'user-1',
      description: 'Updated user driver01',
      details: {
        fields: ['username', 'email', 'fullName', 'phone', 'role', 'status'],
      },
    });
  });

  it('rejects admin editing their own account from user management', async () => {
    const { controller } = createController();

    await expect(
      controller.updateUser(
        'admin-1',
        {
          username: 'admin',
          email: 'admin@example.com',
          role: 'admin',
          status: 'active',
        },
        { id: 'admin-1', username: 'admin' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects admin resetting their own password from user management', async () => {
    const { controller } = createController();

    await expect(
      controller.resetPassword(
        'admin-1',
        'new-password',
        { id: 'admin-1', username: 'admin' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

});
