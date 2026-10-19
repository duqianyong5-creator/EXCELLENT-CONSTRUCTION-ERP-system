import { ConfigService } from '@nestjs/config';
import { createCorsOriginResolver, getConfig, requireConfig } from './security.config';

describe('security config', () => {
  describe('getConfig', () => {
    it('uses the first configured environment value', () => {
      const config = new ConfigService({ DATABASE_HOST: 'db.example.com' });

      expect(getConfig(config, ['DB_HOST', 'DATABASE_HOST'])).toBe('db.example.com');
    });
  });

  describe('requireConfig', () => {
    it('throws when a required secret is missing', () => {
      const config = new ConfigService({});

      expect(() => requireConfig(config, 'JWT_SECRET')).toThrow(
        'Missing required environment variable: JWT_SECRET',
      );
    });
  });

  describe('createCorsOriginResolver', () => {
    it('allows local requests without an Origin header', () => {
      const resolver = createCorsOriginResolver(new ConfigService({}));
      const callback = jest.fn();

      resolver(undefined, callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('allows configured production origins', () => {
      const resolver = createCorsOriginResolver(
        new ConfigService({ FRONTEND_URL: 'https://dispatch.example.com' }),
      );
      const callback = jest.fn();

      resolver('https://dispatch.example.com', callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it("allows the desktop app's 'null' origin (Electron file://)", () => {
      const resolver = createCorsOriginResolver(
        new ConfigService({ FRONTEND_URL: 'https://dispatch.example.com' }),
      );
      const callback = jest.fn();

      resolver('null', callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('rejects unconfigured credentialed origins', () => {
      const resolver = createCorsOriginResolver(
        new ConfigService({ FRONTEND_URL: 'https://dispatch.example.com' }),
      );
      const callback = jest.fn();

      resolver('https://evil.example.com', callback);

      expect(callback).toHaveBeenCalledWith(expect.any(Error), false);
    });
  });
});
