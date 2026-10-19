import { sniffImage } from './image-sniff';

/**
 * 上传接口的扩展名和 Content-Type 以前直接用客户端给的值，
 * 于是一个司机账号可以把 .html / .svg 存进公开存储桶，
 * 用公司域名做钓鱼页；走本地存储兜底时还是同源提供的，就是存储型 XSS。
 */
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const webp = () =>
  Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(8)]);
const heic = () =>
  Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp', 'latin1'), Buffer.from('heic', 'latin1'), Buffer.alloc(8)]);

describe('sniffImage', () => {
  it('recognises the formats a phone camera actually produces', () => {
    expect(sniffImage(jpeg())).toEqual({ ext: '.jpg', contentType: 'image/jpeg' });
    expect(sniffImage(png())).toEqual({ ext: '.png', contentType: 'image/png' });
    expect(sniffImage(webp())).toEqual({ ext: '.webp', contentType: 'image/webp' });
    // iPhone 默认就是 HEIC，挡掉的话司机传不了工地照片
    expect(sniffImage(heic())).toEqual({ ext: '.heic', contentType: 'image/heic' });
  });

  it('rejects the things an attacker would rather host on your domain', () => {
    const cases: Array<[string, Buffer]> = [
      ['html', Buffer.from('<!DOCTYPE html><script>alert(1)</script>                ', 'utf8')],
      ['svg with script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8')],
      ['pdf', Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')],
      ['zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)])],
      ['windows exe', Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(32)])],
    ];
    for (const [what, buf] of cases) {
      expect([what, sniffImage(buf)]).toEqual([what, null]);
    }
  });

  it('is not fooled by an image extension or a claimed mime type', () => {
    // 这正是以前的做法：信 originalname / mimetype。内容才是唯一依据。
    const htmlNamedJpg = Buffer.from('<html><body>not an image</body></html>      ', 'utf8');
    expect(sniffImage(htmlNamedJpg)).toBeNull();
  });

  it('handles empty and truncated input without throwing', () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull(); // JPEG 头被截断
    expect(sniffImage(undefined as any)).toBeNull();
  });
});
