import { readFileSync } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcrypt';

describe('launch hygiene', () => {
  const rootDir = join(__dirname, '..', '..', '..');

  it('seeds exactly one web admin account with the requested password hash', async () => {
    const sql = readFileSync(join(rootDir, 'database/database.sql'), 'utf8');
    const match = sql.match(
      /VALUES\s*\(\s*'admin'\s*,\s*'admin@trucksystem\.com'\s*,\s*'([^']+)'\s*,\s*'admin'\s*,\s*'active'/i,
    );

    expect(match).not.toBeNull();
    expect(await bcrypt.compare('admin888', match![1])).toBe(true);
    expect((sql.match(/INSERT\s+INTO\s+users/gi) ?? [])).toHaveLength(1);
  });

  it('does not ship old local default passwords', () => {
    const files = [
      'README.md',
      'docs/API.md',
      'docs/DEPLOY.md',
      'database/database.sql',
      'backend/src/auth/dto/login.dto.ts',
      'backend/src/users/users.controller.ts',
      'frontend/src/pages/admin/UsersPage.tsx',
    ];

    for (const file of files) {
      const content = readFileSync(join(rootDir, file), 'utf8');
      expect(content).not.toMatch(/Admin@123456|Temp@123456|manual password/i);
    }
  });
});
