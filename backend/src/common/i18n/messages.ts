/**
 * 面向用户的错误文案，按语言分开存放。
 *
 * 服务里 `throw new XxxException(ErrorCode.FOO)` 只抛错误码，
 * 由 I18nExceptionFilter 按请求头 `X-Lang` 换成对应语言的句子。
 * 这样界面上「中文就是中文、英文就是英文」，不会再出现 "中文 / English" 混排。
 */

export type Lang = 'zh' | 'en';

export const SUPPORTED_LANGS: Lang[] = ['zh', 'en'];
export const DEFAULT_LANG: Lang = 'zh';

export const ErrorCode = {
  AUTH_ACCOUNT_NOT_FOUND: 'AUTH_ACCOUNT_NOT_FOUND',
  AUTH_PENDING: 'AUTH_PENDING',
  AUTH_REJECTED: 'AUTH_REJECTED',
  AUTH_DISABLED: 'AUTH_DISABLED',
  AUTH_WRONG_PASSWORD: 'AUTH_WRONG_PASSWORD',

  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  FORBIDDEN_TASK_TRACK: 'FORBIDDEN_TASK_TRACK',
  FORBIDDEN_DRIVER_POSITION: 'FORBIDDEN_DRIVER_POSITION',
  FORBIDDEN_TASK: 'FORBIDDEN_TASK',
  FORBIDDEN_WORK_RECORD: 'FORBIDDEN_WORK_RECORD',

  DEVICE_PLATE_TOO_LONG: 'DEVICE_PLATE_TOO_LONG',
  DEVICE_NAME_TOO_LONG: 'DEVICE_NAME_TOO_LONG',
  DEVICE_NO_INVALID: 'DEVICE_NO_INVALID',
  DEVICE_ICCID_INVALID: 'DEVICE_ICCID_INVALID',
  DEVICE_NO_EXISTS: 'DEVICE_NO_EXISTS',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',

  GEOFENCE_NOT_FOUND: 'GEOFENCE_NOT_FOUND',
  GEOFENCE_NAME_REQUIRED: 'GEOFENCE_NAME_REQUIRED',
  GEOFENCE_NAME_TOO_LONG: 'GEOFENCE_NAME_TOO_LONG',
  GEOFENCE_CENTER_INVALID: 'GEOFENCE_CENTER_INVALID',
  GEOFENCE_RADIUS_INVALID: 'GEOFENCE_RADIUS_INVALID',

  VEHICLE_NOT_FOUND: 'VEHICLE_NOT_FOUND',
  VEHICLE_PLATE_REQUIRED: 'VEHICLE_PLATE_REQUIRED',
  VEHICLE_PLATE_TOO_LONG: 'VEHICLE_PLATE_TOO_LONG',
  VEHICLE_PLATE_EXISTS: 'VEHICLE_PLATE_EXISTS',
  VEHICLE_DEVICE_PLATE_TAKEN: 'VEHICLE_DEVICE_PLATE_TAKEN',

  UPLOAD_IMAGE_ONLY: 'UPLOAD_IMAGE_ONLY',
  NOTES_TOO_LONG: 'NOTES_TOO_LONG',

  RUC_PURCHASE_DATE_INVALID: 'RUC_PURCHASE_DATE_INVALID',
  RUC_READINGS_NOT_NUMBERS: 'RUC_READINGS_NOT_NUMBERS',
  RUC_END_MUST_EXCEED_START: 'RUC_END_MUST_EXCEED_START',
  RUC_ODOMETER_INVALID: 'RUC_ODOMETER_INVALID',
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];

const MESSAGES: Record<string, Record<Lang, string>> = {
  [ErrorCode.AUTH_ACCOUNT_NOT_FOUND]: {
    zh: '账号不存在，请检查账号是否输错',
    en: 'Account not found — check the username or email',
  },
  [ErrorCode.AUTH_PENDING]: {
    zh: '账户待审核，请等待管理员批准',
    en: 'Account is awaiting approval',
  },
  [ErrorCode.AUTH_REJECTED]: {
    zh: '账户申请已被拒绝',
    en: 'Account application was rejected',
  },
  [ErrorCode.AUTH_DISABLED]: {
    zh: '账户已被禁用，请联系管理员',
    en: 'Account is disabled — contact your administrator',
  },
  [ErrorCode.AUTH_WRONG_PASSWORD]: {
    zh: '密码错误，请重新输入',
    en: 'Incorrect password',
  },

  [ErrorCode.FORBIDDEN_ROLE]: {
    zh: '权限不足',
    en: 'Insufficient permissions',
  },
  [ErrorCode.FORBIDDEN_TASK_TRACK]: {
    zh: '无权查看该任务轨迹',
    en: 'Not allowed to view this task track',
  },
  [ErrorCode.FORBIDDEN_DRIVER_POSITION]: {
    zh: '无权查看该司机位置',
    en: 'Not allowed to view this driver position',
  },
  [ErrorCode.FORBIDDEN_TASK]: {
    zh: '无权查看该任务',
    en: 'Not allowed to view this task',
  },
  [ErrorCode.FORBIDDEN_WORK_RECORD]: {
    zh: '无权查看该工时记录',
    en: 'Not allowed to view this work record',
  },

  [ErrorCode.DEVICE_PLATE_TOO_LONG]: {
    zh: '车牌过长，最多 32 个字符',
    en: 'Plate too long (max 32 characters)',
  },
  [ErrorCode.DEVICE_NAME_TOO_LONG]: {
    zh: '名称过长，最多 128 个字符',
    en: 'Name too long (max 128 characters)',
  },
  [ErrorCode.DEVICE_NO_INVALID]: {
    zh: '设备号须为 5~20 位数字',
    en: 'Device number must be 5-20 digits',
  },
  [ErrorCode.DEVICE_ICCID_INVALID]: {
    zh: 'ICCID 须以 89 开头、共 18~22 位数字或 A~F 字母（印在 SIM 卡上，通常 20 位）',
    en: 'ICCID must start with 89 and be 18-22 digits or letters A-F (printed on the SIM, usually 20 characters)',
  },
  [ErrorCode.DEVICE_NO_EXISTS]: {
    zh: '该设备号已登记',
    en: 'Device number already registered',
  },
  [ErrorCode.DEVICE_NOT_FOUND]: {
    zh: '设备不存在',
    en: 'Device not found',
  },
  [ErrorCode.DEVICE_OFFLINE]: {
    zh: '设备不在线',
    en: 'Device is offline',
  },

  [ErrorCode.GEOFENCE_NOT_FOUND]: {
    zh: '围栏不存在',
    en: 'Geofence not found',
  },
  [ErrorCode.GEOFENCE_NAME_REQUIRED]: {
    zh: '请填写围栏名称',
    en: 'Geofence name is required',
  },
  [ErrorCode.GEOFENCE_NAME_TOO_LONG]: {
    zh: '围栏名称过长（最多 128 字）',
    en: 'Geofence name is too long (max 128 characters)',
  },
  [ErrorCode.GEOFENCE_CENTER_INVALID]: {
    zh: '围栏圆心经纬度不合法',
    en: 'Geofence centre coordinates are out of range',
  },
  [ErrorCode.GEOFENCE_RADIUS_INVALID]: {
    zh: '围栏半径不合法（20 ~ 200000 米）',
    en: 'Geofence radius must be between 20 and 200000 metres',
  },

  [ErrorCode.VEHICLE_NOT_FOUND]: {
    zh: '车辆不存在',
    en: 'Vehicle not found',
  },
  [ErrorCode.VEHICLE_PLATE_REQUIRED]: {
    zh: '请填写车牌',
    en: 'Plate is required',
  },
  [ErrorCode.VEHICLE_PLATE_TOO_LONG]: {
    zh: '车牌过长',
    en: 'Plate too long',
  },
  [ErrorCode.VEHICLE_PLATE_EXISTS]: {
    zh: '该车牌已登记',
    en: 'This plate is already registered',
  },
  [ErrorCode.VEHICLE_DEVICE_PLATE_TAKEN]: {
    zh: '该车牌已绑定其它定位器，一辆车只能绑一台，否则里程会算错',
    en: 'Another tracker is already bound to this plate — one per vehicle, or the mileage estimate breaks',
  },

  [ErrorCode.NOTES_TOO_LONG]: {
    zh: '备注过长，最多 2000 个字符',
    en: 'Notes too long (max 2000 characters)',
  },
  [ErrorCode.UPLOAD_IMAGE_ONLY]: {
    zh: '只能上传图片（JPG / PNG / WEBP / HEIC），单张不超过 10MB',
    en: 'Images only (JPG / PNG / WEBP / HEIC), up to 10MB each',
  },

  [ErrorCode.RUC_PURCHASE_DATE_INVALID]: {
    zh: '购买日期无效',
    en: 'Invalid purchase date',
  },
  [ErrorCode.RUC_READINGS_NOT_NUMBERS]: {
    zh: '起止里程必须是数字',
    en: 'Start and end readings must be numbers',
  },
  [ErrorCode.RUC_END_MUST_EXCEED_START]: {
    zh: '许可的截止里程必须大于起始里程',
    en: 'Licence end must be greater than its start',
  },
  [ErrorCode.RUC_ODOMETER_INVALID]: {
    zh: '里程读数无效',
    en: 'Invalid odometer reading',
  },
};

/** 把请求里的语言标识收敛到受支持的语言，认不出来就用默认语言 */
export function normalizeLang(raw: string | undefined | null): Lang {
  if (!raw) return DEFAULT_LANG;
  const head = String(raw).trim().toLowerCase().split(',')[0].split('-')[0];
  return (SUPPORTED_LANGS as string[]).includes(head) ? (head as Lang) : DEFAULT_LANG;
}

/** 已知错误码返回对应语言的句子；不是错误码就原样返回（兼容还没改造的消息） */
export function localizeMessage(message: string, lang: Lang): string {
  const entry = MESSAGES[message];
  return entry ? entry[lang] : message;
}

export function isErrorCode(message: string): boolean {
  return Object.prototype.hasOwnProperty.call(MESSAGES, message);
}
