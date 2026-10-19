/**
 * 按文件内容判断图片类型，不看客户端给的扩展名和 Content-Type。
 *
 * 上传的文件名和 MIME 都是客户端说了算的：一个司机账号可以上传
 * `evil.html` 并声明 `text/html`，我们照单全收地存进公开存储桶，
 * 结果就是公司域名下挂着一个能打开的钓鱼页；走本地存储兜底时
 * 它还是直接从 API 同源提供的，那就是存储型 XSS。
 *
 * 这里只认真正的图片magic bytes，扩展名和 Content-Type 都由我们自己决定。
 */

export interface SniffedImage {
  ext: string;
  contentType: string;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** HEIC/HEIF 家族在 offset 4 处是 'ftyp' + 具体品牌 */
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

function startsWith(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

export function sniffImage(buf: Buffer): SniffedImage | null {
  if (!buf || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: '.jpg', contentType: 'image/jpeg' };
  }

  if (startsWith(buf, PNG)) {
    return { ext: '.png', contentType: 'image/png' };
  }

  // WEBP: 'RIFF' ....(4 字节长度) 'WEBP'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return { ext: '.webp', contentType: 'image/webp' };
  }

  // HEIC/HEIF：手机默认格式，工地照片常见
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12).toLowerCase();
    if (HEIF_BRANDS.includes(brand)) {
      return { ext: '.heic', contentType: 'image/heic' };
    }
  }

  return null;
}
