/**
 * 司机端设计系统。
 *
 * 之前整个 App 有 38 个颜色值、25 种圆角、19 种字号、28 种间距——
 * 每个数字都是当场拍的，所以没有两个元素用的是同一套刻度，
 * 整体就"散"。这里把刻度定死，所有页面只能从这里取值。
 *
 * 几条和普通 App 不一样的取舍，因为用的人在卡车里：
 *   - 正文比常规大一号：司机是瞥一眼，不是阅读
 *   - 可点区域最小 48pt：可能戴着手套
 *   - 深色打底：夜间行车不刺眼，白天在驾驶室阴影里对比也够
 */

export const colors = {
  /** 页面底色 */
  bg: '#0B0F1A',
  /** 卡片 */
  surface: '#111827',
  /** 卡片里再抬一层（内嵌块、输入框） */
  surfaceAlt: '#0F172A',
  /** 分隔线。用半透明白而不是实色，叠在任何底色上都成立 */
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',

  text: '#F8FAFC',
  textMuted: '#94A3B8',
  // 原来是 #64748B，在卡片上只有 3.73:1，达不到 WCAG AA 的 4.5——
  // 它是全 App 所有输入框占位文字的颜色，司机在阳光下的驾驶室里看不清。
  // 这个值在三种底色上是 5.04~5.44，同时仍明显比 textMuted（6.92）淡，层级不乱。
  textFaint: '#7A8AA0',
  /** 放在琥珀色按钮上的文字：深色才够对比 */
  onAccent: '#1A1206',

  accent: '#F59E0B',
  accentDark: '#D97706',
  /** 琥珀色的淡底，用于标签和选中态 */
  accentSoft: 'rgba(245,158,11,0.14)',

  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.14)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239,68,68,0.14)',
  info: '#3B82F6',
  infoSoft: 'rgba(59,130,246,0.14)',
} as const;

/** 4 的倍数。不要再出现 5/7/9/11/13 这种值 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

/** 字阶。相邻两级差得够开，层级才读得出来 */
export const font = {
  /** 辅助信息、单位 */
  xs: 12,
  /** 次要正文 */
  sm: 14,
  /** 正文——比常规 App 大一号，司机是瞥一眼 */
  base: 16,
  /** 卡片标题 */
  lg: 18,
  /** 页面标题 */
  xl: 22,
  /** 关键数字（工时、剩余里程） */
  xxl: 28,
  /** 首屏大数字 */
  display: 36,
} as const;

export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** 可点区域最小高度：司机可能戴手套 */
export const hit = {
  min: 48,
  compact: 40,
} as const;

/**
 * 深色底上的阴影几乎看不见，所以层级主要靠背景色差和描边表达。
 * 只有浮起来的东西（弹窗、悬浮按钮）才给阴影。
 */
export const shadow = {
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;

/**
 * 任务状态配色，全 App 一套：待派=品牌琥珀，已派(待接受)=信息蓝，进行中=绿，已完成=中性灰，已取消=红。
 * 司机端、管理端、今日任务页都从这里取——同一个状态在谁眼里都是同一种颜色。
 */
export const statusColors = {
  pending: { bg: colors.accentSoft, text: colors.accent, border: colors.accent },
  assigned: { bg: colors.infoSoft, text: colors.info, border: colors.info },
  in_progress: { bg: colors.successSoft, text: colors.success, border: colors.success },
  completed: { bg: colors.border, text: colors.textMuted, border: colors.borderStrong },
  cancelled: { bg: colors.dangerSoft, text: colors.danger, border: colors.danger },
} as const;

export const theme = { colors, space, font, weight, radius, hit, shadow, statusColors } as const;
export default theme;
