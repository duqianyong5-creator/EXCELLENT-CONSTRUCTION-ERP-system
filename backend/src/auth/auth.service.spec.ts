import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserStatus } from '../users/user.entity';
import { ErrorCode, localizeMessage } from '../common/i18n/messages';

/**
 * 登录失败时必须说清楚「哪里错了」：
 * 司机站在工地上登不进去，只说一句「登录失败」他无法判断是账号打错、密码打错，
 * 还是账户还没被审核——这三种的处理方式完全不同。
 *
 * 服务只抛错误码，翻译交给 I18nExceptionFilter，所以这里同时验证
 * 「抛对了码」和「两种语言都有可读的句子」（不再是中英混排一句）。
 */
function build(user: any, passwordHash?: string) {
  const usersService = {
    findByEmailOrUsername: jest.fn(async () => user),
    findWithPassword: jest.fn(async () => ({ ...user, password: passwordHash })),
  };
  const service = new AuthService(
    usersService as any,
    { sign: jest.fn(() => 'token') } as any,
    { record: jest.fn(async () => undefined) } as any,
  );
  return { service, usersService };
}

const activeUser = { id: 'u1', username: 'driver1', status: UserStatus.ACTIVE, role: 'driver' };

describe('AuthService.validateUser failure codes', () => {
  it('says the account does not exist when the username is wrong', async () => {
    const { service } = build(null);
    await expect(service.validateUser('nope', 'x')).rejects.toThrow(UnauthorizedException);
    await expect(service.validateUser('nope', 'x')).rejects.toThrow(ErrorCode.AUTH_ACCOUNT_NOT_FOUND);
  });

  it('says the password is wrong when the account exists', async () => {
    const hash = await bcrypt.hash('correct-horse', 10);
    const { service } = build(activeUser, hash);
    await expect(service.validateUser('driver1', 'wrong')).rejects.toThrow(ErrorCode.AUTH_WRONG_PASSWORD);
  });

  it('distinguishes pending, rejected and disabled accounts from a bad password', async () => {
    const hash = await bcrypt.hash('pw', 10);
    for (const [status, code] of [
      [UserStatus.PENDING, ErrorCode.AUTH_PENDING],
      [UserStatus.REJECTED, ErrorCode.AUTH_REJECTED],
      [UserStatus.DISABLED, ErrorCode.AUTH_DISABLED],
    ] as const) {
      const { service } = build({ ...activeUser, status }, hash);
      // 即使密码是对的，也应该报状态问题而不是密码问题
      await expect(service.validateUser('driver1', 'pw')).rejects.toThrow(code);
    }
  });

  it('lets a correct password through', async () => {
    const hash = await bcrypt.hash('pw', 10);
    const { service } = build(activeUser, hash);
    await expect(service.validateUser('driver1', 'pw')).resolves.toMatchObject({ id: 'u1' });
  });
});

describe('login failure wording per language', () => {
  const CODES = [
    ErrorCode.AUTH_ACCOUNT_NOT_FOUND,
    ErrorCode.AUTH_PENDING,
    ErrorCode.AUTH_REJECTED,
    ErrorCode.AUTH_DISABLED,
    ErrorCode.AUTH_WRONG_PASSWORD,
  ];

  it('gives Chinese-only text in Chinese and English-only text in English', () => {
    for (const code of CODES) {
      const zh = localizeMessage(code, 'zh');
      const en = localizeMessage(code, 'en');

      // 中文文案里不能夹带成句的英文，英文文案里不能出现汉字——界面不再中英混排
      expect(zh).toMatch(/[一-鿿]/);
      expect(zh).not.toMatch(/[A-Za-z]{4,}/);
      expect(en).toMatch(/[A-Za-z]{4,}/);
      expect(en).not.toMatch(/[一-鿿]/);

      // 必须真的翻译过，不能把错误码本身漏给用户看
      expect(zh).not.toBe(code);
      expect(en).not.toBe(code);
    }
  });

  it('tells the five failure reasons apart in both languages', () => {
    for (const lang of ['zh', 'en'] as const) {
      const texts = CODES.map((c) => localizeMessage(c, lang));
      expect(new Set(texts).size).toBe(CODES.length);
    }
  });
});
