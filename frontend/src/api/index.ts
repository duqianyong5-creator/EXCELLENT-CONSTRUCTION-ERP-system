import axios from 'axios';

// 生产：VITE_API_URL 指向线上后端(Railway)，直接访问后端根路径(/auth、/gps...)。
// 开发：留空，走 Vite 代理 /api（代理会把 /api 前缀去掉转给本地后端）。
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // 后端只回错误码，按这个头返回对应语言的句子（界面不再中英混排）
  config.headers['X-Lang'] = localStorage.getItem('language') || 'zh';
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    // 登录/注册接口本来就没有会话，它们返回 401 是"账号或密码错误"，不是登录态过期。
    // 这里若跟着刷新页面，错误提示会被刷掉，用户只看到页面闪一下、不知道哪里错了。
    const url = err.config?.url || '';
    const isAuthAttempt = url.includes('/auth/login') || url.includes('/auth/register');
    if (err.response?.status === 401 && !isAuthAttempt) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // reload 后应用重新初始化（无 token → 路由跳登录）。
      // 不用 href='/login'：在 Electron 的 file:// 下会失效。
      window.location.reload();
    }
    return Promise.reject(err.response?.data || err);
  },
);

export const authApi = {
  login: (data: { identifier: string; password: string }) =>
    api.post('/auth/login', data),
  register: (data: any) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

export const usersApi = {
  list: (params?: any) => api.get('/users', { params }),
  pending: () => api.get('/users/pending'),
  drivers: () => api.get('/users/drivers'),
  clients: () => api.get('/users/clients'),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data),
  approve: (id: string) => api.patch(`/users/${id}/approve`),
  reject: (id: string) => api.patch(`/users/${id}/reject`),
  disable: (id: string) => api.patch(`/users/${id}/disable`),
  enable: (id: string) => api.patch(`/users/${id}/enable`),
  updateRole: (id: string, role: string) => api.patch(`/users/${id}/role`, { role }),
  delete: (id: string) => api.delete(`/users/${id}`),
  resetPassword: (id: string, newPassword: string) => api.patch(`/users/${id}/reset-password`, { newPassword }),
  updateProfile: (data: any) => api.patch('/users/profile', data),
  changePassword: (data: any) => api.patch('/users/change-password', data),
};

export const tasksApi = {
  list: () => api.get('/tasks'),
  today: () => api.get('/tasks/today'),
  stats: () => api.get('/tasks/stats'),
  get: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.patch(`/tasks/${id}`, data),
  assign: (id: string, driverId: string) => api.patch(`/tasks/${id}/assign`, { driverId }),
  start: (id: string) => api.post(`/tasks/${id}/start`),
  complete: (id: string, formData: FormData) =>
    api.post(`/tasks/${id}/complete`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  cancel: (id: string) => api.patch(`/tasks/${id}/cancel`),
  delete: (id: string) => api.delete(`/tasks/${id}`),
};

export const gpsApi = {
  upload: (data: any) => api.post('/gps/upload', data),
  track: (taskId: string) => api.get(`/gps/track/${taskId}`),
  positions: () => api.get('/gps/positions'),
  driverPosition: (driverId: string) => api.get(`/gps/driver/${driverId}/position`),
};

export const vehiclesApi = {
  list: () => api.get('/vehicles'),
  create: (data: { plate: string; label?: string }) => api.post('/vehicles', data),
  update: (id: string, data: { label?: string; enabled?: boolean }) => api.patch(`/vehicles/${id}`, data),
  delete: (id: string) => api.delete(`/vehicles/${id}`),
  recordLicence: (id: string, data: { licenceNo?: string; startKm: number; endKm: number; purchasedAt?: string }) =>
    api.post(`/vehicles/${id}/ruc`, data),
  calibrate: (id: string, odometerKm: number) => api.post(`/vehicles/${id}/odometer`, { odometerKm }),
};

export const gpsDevicesApi = {
  list: () => api.get('/gps-devices'),
  gateway: () => api.get('/gps-devices/gateway'),
  create: (data: { deviceNo: string; vehiclePlate?: string; name?: string; enabled?: boolean; iccid?: string }) =>
    api.post('/gps-devices', data),
  update: (id: string, data: { vehiclePlate?: string; name?: string; enabled?: boolean; iccid?: string }) =>
    api.patch(`/gps-devices/${id}`, data),
  delete: (id: string) => api.delete(`/gps-devices/${id}`),
  command: (id: string, data: { type: 'reboot' | 'realtime' | 'locate'; intervalSec?: number; tzOffset?: number }) =>
    api.post(`/gps-devices/${id}/command`, data),
};

// 圆形电子围栏。判定在服务端做，所以这里只是普通 CRUD，没有「下发到设备」这一步。
export const geofencesApi = {
  list: () => api.get('/geofences'),
  get: (id: string) => api.get(`/geofences/${id}`),
  create: (data: {
    name: string; centerLat: number; centerLng: number; radiusM: number;
    vehiclePlate?: string | null; enabled?: boolean; alertOnEnter?: boolean; alertOnLeave?: boolean;
  }) => api.post('/geofences', data),
  update: (id: string, data: {
    name?: string; centerLat?: number; centerLng?: number; radiusM?: number;
    vehiclePlate?: string | null; enabled?: boolean; alertOnEnter?: boolean; alertOnLeave?: boolean;
  }) => api.patch(`/geofences/${id}`, data),
  delete: (id: string) => api.delete(`/geofences/${id}`),
};

export const driverPresenceApi = {
  online: () => api.get('/driver-presence/online'),
};

export const workRecordsApi = {
  list: () => api.get('/work-records'),
  byTask: (taskId: string) => api.get(`/work-records/task/${taskId}`),
  get: (id: string) => api.get(`/work-records/${id}`),
  delete: (id: string) => api.delete(`/work-records/${id}`),
};

export const adjustmentsApi = {
  add: (data: any) => api.post('/adjustments', data),
  setFinal: (data: any) => api.post('/adjustments/set-final', data),
  logs: (params?: any) => api.get('/adjustments/logs', { params }),
};

export const anomaliesApi = {
  list: () => api.get('/anomalies'),
  unresolved: () => api.get('/anomalies/unresolved'),
  resolve: (id: string) => api.patch(`/anomalies/${id}/resolve`),
  ignore: (id: string) => api.patch(`/anomalies/${id}/ignore`),
  snooze: (id: string, minutes: number) => api.patch(`/anomalies/${id}/snooze`, { minutes }),
};

export const announcementsApi = {
  list: () => api.get('/announcements'),
  feed: () => api.get('/announcements/feed'),
  create: (data: { title: string; content: string; targetRole: string }) => api.post('/announcements', data),
  setActive: (id: string, active: boolean) => api.patch(`/announcements/${id}/active`, { active }),
  delete: (id: string) => api.delete(`/announcements/${id}`),
};

export const systemSettingsApi = {
  get: () => api.get('/system-settings'),
  update: (data: Record<string, string>) => api.put('/system-settings', data),
  clearData: (password: string) => api.post('/system-settings/clear-data', { password }),
};

export const notificationsApi = {
  list: () => api.get('/notifications'),
  unreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
};

export const operationLogsApi = {
  list: (params?: { limit?: number }) => api.get('/operation-logs', { params }),
};

export default api;
