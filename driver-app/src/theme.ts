/**
 * Driver-app design system.
 *
 * Every screen takes its colours, spacing, type scale and radii from here and nowhere else
 * (the screens contain no literal colour values), so this file *is* the look of the app.
 *
 * The palette matches the desktop console: a light, paper-like canvas with white cards, a
 * navy hero block for headers, and the company amber as the single accent. Light wins over
 * dark here because drivers read the phone in daylight in a cab; the dark header keeps the
 * brand feel and separates "where am I" from "what do I do".
 *
 * Choices that differ from an ordinary app because the user is in a truck:
 *   - body text one step larger than usual: drivers glance, they do not read
 *   - tap targets at least 48pt: gloves
 *   - status colours are the same on the phone, the desktop and the client view
 */

export const colors = {
  /** Page canvas: a soft grey so white cards read as cards */
  bg: '#F3F5F9',
  /** Cards, sheets, the tab bar */
  surface: '#FFFFFF',
  /** A block inside a card (inputs, inner panels) */
  surfaceAlt: '#F6F8FB',
  /** Hairlines: translucent navy sits on any of the three surfaces */
  border: 'rgba(15,23,42,0.08)',
  borderStrong: 'rgba(15,23,42,0.16)',

  text: '#0F172A',
  textMuted: '#64748B',
  /** Placeholders and tertiary labels: 4.6:1 on white, still clearly lighter than textMuted */
  textFaint: '#7B869A',
  /** Text on an amber button: dark, for contrast */
  onAccent: '#1A1206',

  /** The navy hero block used for screen headers and the login top */
  hero: '#111827',
  heroAlt: '#1F2937',
  heroText: '#FFFFFF',
  heroMuted: 'rgba(255,255,255,0.68)',
  heroBorder: 'rgba(255,255,255,0.10)',

  accent: '#F59E0B',
  accentDark: '#D97706',
  /** Amber tint for chips, selected states and icon chips */
  accentSoft: 'rgba(245,158,11,0.14)',

  success: '#16A34A',
  successSoft: 'rgba(22,163,74,0.12)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220,38,38,0.12)',
  info: '#2563EB',
  infoSoft: 'rgba(37,99,235,0.12)',
  purple: '#7C3AED',
  purpleSoft: 'rgba(124,58,237,0.12)',
} as const;

/** Multiples of 4 only */
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

/** Type scale: neighbouring steps differ enough to read as levels */
export const font = {
  /** helper text, units */
  xs: 12,
  /** secondary body */
  sm: 14,
  /** body: one step larger than a normal app */
  base: 16,
  /** card titles */
  lg: 18,
  /** screen titles */
  xl: 22,
  /** key numbers */
  xxl: 28,
  /** the big number on a dashboard tile */
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

/** Minimum tap height: gloves */
export const hit = {
  min: 48,
  compact: 40,
} as const;

/**
 * On a light canvas elevation is carried by soft shadows: `card` for anything resting on the
 * page, `raised` for what floats above it (sheets, floating buttons, map overlays).
 */
export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

/**
 * Job status colours, one set for the whole product: pending = amber, assigned (to accept) = blue,
 * in progress = green, completed = neutral, cancelled = red. The phone, the desktop and the
 * client view all read from here, so a status looks the same to everyone.
 */
export const statusColors = {
  pending: { bg: colors.accentSoft, text: colors.accentDark, border: colors.accent },
  assigned: { bg: colors.infoSoft, text: colors.info, border: colors.info },
  in_progress: { bg: colors.successSoft, text: colors.success, border: colors.success },
  completed: { bg: '#EEF2F7', text: colors.textMuted, border: colors.borderStrong },
  cancelled: { bg: colors.dangerSoft, text: colors.danger, border: colors.danger },
} as const;

export const theme = { colors, space, font, weight, radius, hit, shadow, statusColors } as const;
export default theme;
