/**
 * 把「数据库里存着的那个值」还原成存储桶里的对象路径。
 *
 * 历史上 `work_records.imageUrls` 存的是 Supabase 的**公开** URL。
 * 要把桶改成私有、改用签名 URL，就必须能从这些旧值里把对象路径抠出来，
 * 否则一改桶权限，所有历史照片立刻全部打不开。
 *
 * 需要认得三种形态：
 *   1. 旧的公开 URL   .../storage/v1/object/public/<bucket>/<path>
 *   2. 之前签过的 URL .../storage/v1/object/sign/<bucket>/<path>?token=...
 *   3. 新存的裸路径    <path>
 * 本地存储兜底的 `/uploads/xxx.jpg` 不属于对象存储，返回 null，按原样使用。
 */
export function objectPathOf(stored: string, bucket: string): string | null {
  if (!stored || typeof stored !== 'string') return null;
  const value = stored.trim();
  if (!value) return null;

  // 本地存储兜底：由 API 自己的 /uploads 提供，不经过存储桶
  if (value.startsWith('/uploads/')) return null;

  if (/^https?:\/\//i.test(value)) {
    for (const kind of ['public', 'sign']) {
      const marker = `/storage/v1/object/${kind}/${bucket}/`;
      const at = value.indexOf(marker);
      if (at === -1) continue;
      const path = value.slice(at + marker.length).split('?')[0];
      return decodeSafe(path) || null;
    }
    // 别的域名下的 http 地址：不是我们桶里的东西，原样放行
    return null;
  }

  // 裸路径。容错地去掉可能带上的前导斜杠或桶名前缀
  let path = value.replace(/^\/+/, '');
  if (path.startsWith(`${bucket}/`)) path = path.slice(bucket.length + 1);
  return path || null;
}

function decodeSafe(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
