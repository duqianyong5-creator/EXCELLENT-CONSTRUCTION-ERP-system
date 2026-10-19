/**
 * 语言包体检。翻译活儿最容易出的不是翻错，是「漏」：
 * 某个键只有中文没有英文、页面里用了一个不存在的键、
 * 或者中英文的 {{占位符}} 对不上导致运行时少显示一个数字。
 * 这些在 tsc 和构建里都不报错，只有用户切到英文才发现。
 *
 * 用法：node scripts/check-locales.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const LOCALES_DIR = 'src/locales';
const SRC_DIR = 'src';

/** i18next 的复数变体：中文没有复数，只有英文会有 xxx_one，这不算缺失 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const problems = [];
const note = (msg) => problems.push(msg);

// ---- 1) 收集每个语言包的键 ----------------------------------------------
const bundleFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

const allKeys = new Set();
const keyOwner = new Map();

for (const file of bundleFiles) {
  const src = readFileSync(join(LOCALES_DIR, file), 'utf8');
  const zh = keysOfSection(src, 'zh');
  const en = keysOfSection(src, 'en');

  for (const k of zh) {
    if (!en.has(k) && !PLURAL_SUFFIX.test(k)) note(`${file}: key "${k}" has zh but no en`);
  }
  for (const k of en) {
    if (zh.has(k)) continue;
    // 英文可以额外有 xxx_one 这种复数变体，只要基键在中文里存在
    if (PLURAL_SUFFIX.test(k) && zh.has(k.replace(PLURAL_SUFFIX, ''))) continue;
    note(`${file}: key "${k}" has en but no zh`);
  }

  for (const k of zh) {
    if (keyOwner.has(k)) note(`duplicate key "${k}" in both ${keyOwner.get(k)} and ${file}`);
    keyOwner.set(k, file);
    allKeys.add(k);
  }

  // 占位符必须两边一致，否则英文里会凭空少一个数字
  const zhVals = valuesOfSection(src, 'zh');
  const enVals = valuesOfSection(src, 'en');
  for (const [k, v] of zhVals) {
    const a = placeholders(v);
    const b = placeholders(enVals.get(k) ?? '');
    if (a.join() !== b.join()) {
      note(`${file}: key "${k}" placeholders differ — zh ${JSON.stringify(a)} vs en ${JSON.stringify(b)}`);
    }
  }
}

// ---- 2) 页面里用到的键必须存在 --------------------------------------------
const used = new Set();
for (const file of walk(SRC_DIR)) {
  if (file.includes(`${LOCALES_DIR.replace('/', '\\')}`) || file.includes('src/locales')) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) used.add(m[1]);
  for (const m of src.matchAll(/i18nKey=["']([A-Za-z0-9_.]+)["']/g)) used.add(m[1]);
}

// ---- 3) 带占位符的键，调用时必须传参 ------------------------------------------
// 只比对中英两边的 {{占位符}} 一致是不够的：值是 '{{n}} m'、调用处却写成
// `${v} ${t('geofences.unitM')}`（自己在外面拼数字、不传 n），
// i18next 会把没提供的占位符原样输出，界面上就是 "500 {{n}} m"。这一条专门抓这种。
const valueOf = new Map();
for (const file of bundleFiles) {
  const src = readFileSync(join(LOCALES_DIR, file), 'utf8');
  for (const [k, v] of valuesOfSection(src, 'zh')) valueOf.set(k, v);
}
for (const file of walk(SRC_DIR)) {
  if (file.includes('locales')) continue;
  const src = readFileSync(file, 'utf8');
  // t('key') 后面紧跟 ')' —— 即没有第二个参数
  for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.]+)['"]\s*\)/g)) {
    const needs = placeholders(valueOf.get(m[1]) ?? '');
    if (needs.length) {
      note(`${file.replace(/\\/g, '/')}: t('${m[1]}') is called without values, but it needs {{${needs.join('}}, {{')}}} — it will render the placeholder literally`);
    }
  }
}

const legacy = readFileSync('src/i18n.ts', 'utf8');
const legacyKeys = new Set([...legacy.matchAll(/^\s{4}([a-zA-Z0-9_]+):/gm)].map((m) => m[1]));

for (const k of used) {
  if (allKeys.has(k) || legacyKeys.has(k)) continue;
  note(`key "${k}" is used in the app but defined in no bundle`);
}

// ---- 输出 ----------------------------------------------------------------
if (problems.length) {
  console.error(`locale check failed — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`locale check passed — ${allKeys.size} keys across ${bundleFiles.length} bundles, ${used.size} used in the app`);

// ---- helpers -------------------------------------------------------------
function sectionBody(src, lang) {
  const start = src.indexOf(`${lang}: {`);
  if (start === -1) return '';
  let depth = 0;
  let i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(from + 1, i);
    }
  }
  return '';
}

function keysOfSection(src, lang) {
  const body = sectionBody(src, lang);
  const out = new Set();
  let prevContinues = false;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    // 多行拼接出来的文案，续行里的 "Xxx:" 不是键（审批邮件正文就是这么写的）。
    // 键可以和值同行，也可以值另起一行——所以冒号后允许直接换行。
    if (!prevContinues) {
      const m = /^\s*['"]?([A-Za-z0-9_.]+)['"]?\s*:\s*(['"`]|$)/.exec(line);
      if (m) out.add(m[1]);
    }
    prevContinues = trimmed.endsWith('+') || trimmed.endsWith('(') || trimmed.endsWith(':');
  }
  return out;
}

function valuesOfSection(src, lang) {
  const body = sectionBody(src, lang);
  const out = new Map();
  for (const m of body.matchAll(/^\s*['"]?([A-Za-z0-9_.]+)['"]?\s*:\s*(['"`])([\s\S]*?)\2\s*,?\s*$/gm)) {
    out.set(m[1], m[3]);
  }
  return out;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}
