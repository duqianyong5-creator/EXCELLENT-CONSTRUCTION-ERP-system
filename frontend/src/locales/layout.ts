import type { LocaleBundle } from './index';

export const layout: LocaleBundle = {
  zh: {
    // 管理端外壳
    'layout.logout': '退出登录',
    'layout.role_admin': '管理员',
    'layout.role_dispatcher': '调度员',
    'layout.role_monitor': '监控大屏',
    // 通知页
    'layout.notif_mark_all': '全部已读',
    'layout.notif_empty': '暂无通知',
    // 应用级兜底页面
    'layout.error_title': '页面加载出错',
    'layout.error_reset': '清除缓存并重新登录',
    'layout.unauthorized': '无权访问',
    // 地图底图与标记
    'layout.map_street': '街道',
    'layout.map_satellite': '卫星',
    'layout.track_start': '起点',
    'layout.track_end': '终点',
    'layout.track_driver_position': '司机当前位置',
  },
  en: {
    'layout.logout': 'Sign Out',
    'layout.role_admin': 'Admin',
    'layout.role_dispatcher': 'Dispatcher',
    'layout.role_monitor': 'Monitor Screen',
    'layout.notif_mark_all': 'Mark all read',
    'layout.notif_empty': 'No notifications',
    'layout.error_title': 'Something went wrong',
    'layout.error_reset': 'Clear data and sign in again',
    'layout.unauthorized': 'You do not have access to this page',
    'layout.map_street': 'Street',
    'layout.map_satellite': 'Satellite',
    'layout.track_start': 'Start',
    'layout.track_end': 'Finish',
    'layout.track_driver_position': 'Driver is here now',
  },
};
