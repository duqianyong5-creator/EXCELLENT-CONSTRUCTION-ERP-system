import { objectPathOf } from './storage-path';

const BUCKET = 'truck-uploads';
const SUPA = 'https://abcdefgh.supabase.co';

/**
 * 这个函数唯一的作用，就是让「把存储桶改成私有」这件事不会把历史照片全部弄坏。
 * 数据库里已经存着一批公开 URL，抠不出对象路径就签不出新链接。
 */
describe('objectPathOf', () => {
  it('recovers the path from the public URLs already stored in the database', () => {
    const stored = `${SUPA}/storage/v1/object/public/${BUCKET}/work-records/abc-123.jpg`;
    expect(objectPathOf(stored, BUCKET)).toBe('work-records/abc-123.jpg');
  });

  it('recovers the path from an already-signed URL, token and all', () => {
    const stored = `${SUPA}/storage/v1/object/sign/${BUCKET}/work-records/abc-123.jpg?token=eyJhbGciOi.x.y`;
    expect(objectPathOf(stored, BUCKET)).toBe('work-records/abc-123.jpg');
  });

  it('passes a bare path through — that is what new uploads store', () => {
    expect(objectPathOf('work-records/abc-123.jpg', BUCKET)).toBe('work-records/abc-123.jpg');
    // 容错：多带了前导斜杠或桶名
    expect(objectPathOf('/work-records/abc-123.jpg', BUCKET)).toBe('work-records/abc-123.jpg');
    expect(objectPathOf(`${BUCKET}/work-records/abc-123.jpg`, BUCKET)).toBe('work-records/abc-123.jpg');
  });

  it('decodes percent-encoded path segments', () => {
    const stored = `${SUPA}/storage/v1/object/public/${BUCKET}/work-records/a%20b.jpg`;
    expect(objectPathOf(stored, BUCKET)).toBe('work-records/a b.jpg');
  });

  it('leaves local-storage fallback files alone', () => {
    // 这些是 API 自己的 /uploads 提供的，不在存储桶里，签名对它们没有意义
    expect(objectPathOf('/uploads/abc-123.jpg', BUCKET)).toBeNull();
  });

  it('refuses to treat an unrelated URL as one of our objects', () => {
    expect(objectPathOf('https://example.com/some/photo.jpg', BUCKET)).toBeNull();
    // 同为 supabase 域名但不是我们的桶
    expect(objectPathOf(`${SUPA}/storage/v1/object/public/other-bucket/x.jpg`, BUCKET)).toBeNull();
  });

  it('survives empty and malformed input', () => {
    expect(objectPathOf('', BUCKET)).toBeNull();
    expect(objectPathOf('   ', BUCKET)).toBeNull();
    expect(objectPathOf(undefined as any, BUCKET)).toBeNull();
    expect(objectPathOf(`${SUPA}/storage/v1/object/public/${BUCKET}/`, BUCKET)).toBeNull();
    // 坏的百分号编码不能抛异常，否则一条坏数据会让整个工时列表 500
    expect(objectPathOf(`${SUPA}/storage/v1/object/public/${BUCKET}/a%zz.jpg`, BUCKET)).toBe('a%zz.jpg');
  });
});
