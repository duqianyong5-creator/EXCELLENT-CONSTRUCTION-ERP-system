import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Row, Col, Card, Typography, Spin, Button, Modal, Select, Empty, message } from 'antd';
import {
  TruckOutlined, OrderedListOutlined, CheckCircleOutlined,
  ClockCircleOutlined, ReloadOutlined, CalendarOutlined, RocketOutlined,
  EnvironmentOutlined, DisconnectOutlined,
} from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { tasksApi, gpsApi, usersApi, driverPresenceApi, gpsDevicesApi } from '../../api';
import TrackMap from '../../components/TrackMap';
import { addBaseLayers, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../components/mapLayers';
import { useTranslation, Trans } from 'react-i18next';

const { Text } = Typography;
const AMBER = '#F59E0B';
const AMBER_DARK = '#D97706';
const POSITION_REFRESH_MS = 10000;
const DEVICE_REFRESH_MS = 30000;

// 转义用户输入，防止司机昵称把 HTML/脚本注入到地图标记（Leaflet 直接渲染 HTML 字符串）
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  gradient: string;
  accentColor: string;
}
function StatCard({ title, value, icon, gradient, accentColor }: StatCardProps) {
  return (
    <div
      style={{
        background: gradient,
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
        height: '100%',
        transition: 'all 0.2s ease',
        cursor: 'default',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 8px 22px rgba(0,0,0,0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.05)';
      }}
    >
      <div style={{
        width: 42, height: 42, borderRadius: 11,
        background: `${accentColor}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 19, color: accentColor,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2, fontWeight: 500, whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 23, fontWeight: 800, color: accentColor, lineHeight: 1.1 }}>{value}</div>
      </div>
    </div>
  );
}

function DriverMap({ positions }: { positions: any[] }) {
  const { t } = useTranslation();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  // 按司机 id 存 marker：原地更新而不是每次刷新全删重建，
  // 否则每 10 秒（有定位器时 2 秒）打开的气泡会自己关掉、地图也会跳回全局视野
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const didAutoFit = useRef(false);
  const userMovedMap = useRef(false);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    leafletMap.current = L.map(mapRef.current, {
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: true,
    });
    addBaseLayers(leafletMap.current);
    // 用户一旦自己缩放或拖动，就不再自动归位——调度员放大看某辆车时不该被拽回去
    const markMoved = () => { userMovedMap.current = true; };
    leafletMap.current.on('zoomstart', markMoved);
    leafletMap.current.on('dragstart', markMoved);
    return () => {
      leafletMap.current?.remove();
      leafletMap.current = null;
      markersRef.current.clear();
      didAutoFit.current = false;
      userMovedMap.current = false;
    };
  }, []);

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    const validPos = positions.filter(p =>
      p.latitude != null && p.longitude != null &&
      !isNaN(Number(p.latitude)) && !isNaN(Number(p.longitude))
    );

    const seen = new Set<string>();

    validPos.forEach((pos, i) => {
      const lat = Number(pos.latitude ?? pos.g_latitude);
      const lng = Number(pos.longitude ?? pos.g_longitude);
      const speed = Number(pos.speed ?? pos.g_speed ?? 0).toFixed(1);
      // 优先用后端直接带来的司机账号名（监控/客户等拿不到司机列表的角色也能显示）
      const name = pos.driverName ?? pos.driver?.fullName ?? pos.driver?.username ?? t('dashboard.map_driver_fallback');
      const safeName = escapeHtml(name);
      const safeInitial = escapeHtml(name.charAt(0).toUpperCase());
      const key = String(pos.driverId ?? pos.g_driver_id ?? pos.driver_id ?? pos.driver?.id ?? `idx-${i}`);
      seen.add(key);

      const popupHtml = `
          <div style="padding:8px">
            <div style="font-weight:700;font-size:14px;margin-bottom:6px">${safeName}</div>
            <div style="font-size:12px;color:#666">${t('dashboard.map_speed_label')}<b style="color:${AMBER}">${speed} km/h</b></div>
            <div style="font-size:11px;color:#999;margin-top:4px">${t('dashboard.map_coords_label')}${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
          </div>
        `;

      const existing = markersRef.current.get(key);
      if (existing) {
        // 原地挪动并刷新气泡内容：正在看的气泡不会被关掉
        existing.setLatLng([lat, lng]);
        existing.setPopupContent(popupHtml);
        return;
      }

      const icon = L.divIcon({
        className: '',
        html: `<div style="display:flex;flex-direction:column;align-items:center">
          <div style="background:linear-gradient(135deg,${AMBER},${AMBER_DARK});color:#000;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 12px rgba(0,0,0,0.4);border:3px solid #fff;font-weight:700">${safeInitial}</div>
          <div style="background:rgba(0,0,0,0.85);color:#fff;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;margin-top:4px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3)">${safeName}</div>
        </div>`,
        iconSize: [100, 60],
        iconAnchor: [50, 60],
      });
      const marker = L.marker([lat, lng], { icon }).bindPopup(popupHtml).addTo(map);
      markersRef.current.set(key, marker);
    });

    // 只移除这一轮没再上报的车
    markersRef.current.forEach((marker, key) => {
      if (seen.has(key)) return;
      marker.remove();
      markersRef.current.delete(key);
    });

    // 自动归位只做一次，而且用户自己缩放/拖动过之后就不再抢镜头
    if (didAutoFit.current || userMovedMap.current || validPos.length === 0) return;
    didAutoFit.current = true;
    if (validPos.length === 1) {
      map.setView([Number(validPos[0].latitude ?? validPos[0].g_latitude), Number(validPos[0].longitude ?? validPos[0].g_longitude)], 13);
    } else {
      const bounds = L.latLngBounds(validPos.map(p => [Number(p.latitude ?? p.g_latitude), Number(p.longitude ?? p.g_longitude)] as [number, number]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [positions]);

  return <div ref={mapRef} style={{ width: '100%', height: 480, borderRadius: 20 }} />;
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<any>({});
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [driverCount, setDriverCount] = useState(0);
  const [deviceStat, setDeviceStat] = useState<{ total: number; offline: number }>({ total: 0, offline: 0 });

  // 轨迹回放
  const [trackOpen, setTrackOpen] = useState(false);
  const [trackTasks, setTrackTasks] = useState<any[]>([]);
  const [trackTaskId, setTrackTaskId] = useState<string | undefined>();
  const [trackPath, setTrackPath] = useState<[number, number][]>([]);
  const [trackStatus, setTrackStatus] = useState<string>('');
  const [trackLoading, setTrackLoading] = useState(false);

  const openTrackReplay = async () => {
    setTrackOpen(true);
    setTrackTaskId(undefined);
    setTrackPath([]);
    try {
      const list: any = await tasksApi.list();
      const usable = (Array.isArray(list) ? list : []).filter(
        (t: any) => t.status === 'in_progress' || t.status === 'completed',
      );
      setTrackTasks(usable);
    } catch { setTrackTasks([]); }
  };

  const selectTrackTask = async (taskId: string) => {
    setTrackTaskId(taskId);
    setTrackLoading(true);
    setTrackPath([]);
    try {
      const task = trackTasks.find((t) => t.id === taskId);
      setTrackStatus(task?.status || '');
      const data: any = await gpsApi.track(taskId);
      const path: [number, number][] = (Array.isArray(data) ? data : []).map(
        (p: any) => [Number(p.latitude), Number(p.longitude)],
      );
      setTrackPath(path);
    } catch { setTrackPath([]); }
    setTrackLoading(false);
  };

  const enrichPositions = useCallback((pos: any[], drivers: any[]) => {
    const driverMap: Record<string, any> = {};
    (Array.isArray(drivers) ? drivers : []).forEach((d: any) => { driverMap[d.id] = d; });
    return (Array.isArray(pos) ? pos : []).map((p: any) => {
      const dId = p.driverId ?? p.g_driver_id ?? p.driver_id;
      return { ...p, driver: driverMap[dId] ?? null };
    });
  }, []);

  const refreshPositions = useCallback(async () => {
    // 监控大屏账号没有 /users/drivers 权限，用 Promise.all 时那个 403 会让整次刷新失败，
    // 于是大屏上的车在页面加载后就再也不动了。司机名后端已经随定位一起带过来了。
    const [posRes, driversRes] = await Promise.allSettled([gpsApi.positions(), usersApi.drivers()]);
    const pos = posRes.status === 'fulfilled' ? posRes.value : [];
    const drivers = driversRes.status === 'fulfilled' ? driversRes.value : [];
    setPositions(enrichPositions(pos as any, drivers as any));
  }, [enrichPositions]);

  const refreshOnlineDrivers = useCallback(async () => {
    const onlineDrivers: any = await driverPresenceApi.online();
    setDriverCount(Array.isArray(onlineDrivers) ? onlineDrivers.length : 0);
  }, []);

  // 车载 GPS 设备在线情况：掉线的车要能在仪表盘一眼看到（明细在「GPS设备」页）
  const refreshDevices = useCallback(async () => {
    const devices: any = await gpsDevicesApi.list();
    const rows = Array.isArray(devices) ? devices : [];
    const enabled = rows.filter((d: any) => d.enabled !== false);
    // 只统计「有任务在跑却掉线」的设备：车辆熄火停放时设备本来就会断开，
    // 全算离线的话每天下班后仪表盘就一片红，真出问题反而没人看了。
    setDeviceStat({
      total: enabled.length,
      offline: enabled.filter((d: any) => !d.online && d.currentTask).length,
    });
  }, []);

  const loadData = useCallback(async () => {
    // 各数据源独立加载：任一接口出错也不会让整个仪表盘空白
    const [statsR, posR, driversR, onlineR, devicesR] = await Promise.allSettled([
      tasksApi.stats(),
      gpsApi.positions(),
      usersApi.drivers(),
      driverPresenceApi.online(),
      refreshDevices(),
    ]);
    if (devicesR.status === 'rejected') console.error('[dashboard] gps devices failed:', devicesR.reason);
    if (statsR.status === 'fulfilled') setStats(statsR.value);
    else console.error('[dashboard] stats failed:', statsR.reason);
    if (onlineR.status === 'fulfilled') setDriverCount(Array.isArray(onlineR.value) ? onlineR.value.length : 0);
    else console.error('[dashboard] online drivers failed:', onlineR.reason);
    if (posR.status === 'fulfilled') {
      const drivers: any = driversR.status === 'fulfilled' ? driversR.value : [];
      setPositions(enrichPositions(posR.value as any, drivers));
    } else {
      console.error('[dashboard] positions failed:', posR.reason);
    }
    setLoading(false);
  }, [enrichPositions, refreshDevices]);

  // 手动刷新：给按钮一个明确的加载态 + 成功提示，避免"点了没反应"的错觉
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
      message.success(t('dashboard.refreshed_msg'));
    } catch {
      message.error(t('dashboard.refresh_failed'));
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  useEffect(() => {
    loadData();
    const interval = setInterval(async () => {
      try {
        await Promise.all([refreshPositions(), refreshOnlineDrivers()]);
      } catch {}
    }, POSITION_REFRESH_MS);
    // 设备在线状态变化慢，单独用低频轮询，不给每 10 秒的定位刷新加负担
    const deviceInterval = setInterval(() => { refreshDevices().catch(() => {}); }, DEVICE_REFRESH_MS);
    // 车载设备每 10 秒一个点、多车并发，逐条事件刷新会把接口打爆：合并成最多 2 秒一次
    let gpsPending: ReturnType<typeof setTimeout> | null = null;
    const gpsHandler = () => {
      if (gpsPending) return;
      gpsPending = setTimeout(() => {
        gpsPending = null;
        refreshPositions().catch(() => {});
      }, 2000);
    };
    const presenceHandler = () => {
      refreshOnlineDrivers().catch(() => {});
    };
    window.addEventListener('gps:update', gpsHandler);
    window.addEventListener('driver-presence:update', presenceHandler);
    return () => {
      clearInterval(interval);
      clearInterval(deviceInterval);
      if (gpsPending) clearTimeout(gpsPending);
      window.removeEventListener('gps:update', gpsHandler);
      window.removeEventListener('driver-presence:update', presenceHandler);
    };
  }, [loadData, refreshOnlineDrivers, refreshPositions, refreshDevices]);

  const statCards = [
    {
      title: t('dashboard.stat_today'),
      value: stats.today ?? 0,
      icon: <CalendarOutlined />,
      gradient: 'linear-gradient(135deg, #fef3c7, #fde68a)',
      accentColor: AMBER,
    },
    {
      title: t('dashboard.stat_in_progress'),
      value: stats.inProgress || 0,
      icon: <TruckOutlined />,
      gradient: 'linear-gradient(135deg, #ffedd5, #fed7aa)',
      accentColor: '#f97316',
    },
    {
      title: t('dashboard.stat_completed'),
      value: stats.completed || 0,
      icon: <CheckCircleOutlined />,
      gradient: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
      accentColor: '#22c55e',
    },
    {
      title: t('dashboard.stat_total'),
      value: stats.total || 0,
      icon: <OrderedListOutlined />,
      gradient: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
      accentColor: '#3b82f6',
    },
    {
      title: t('dashboard.stat_online_drivers'),
      value: driverCount,
      icon: <RocketOutlined />,
      gradient: 'linear-gradient(135deg, #f3e8ff, #e9d5ff)',
      accentColor: '#a855f7',
    },
    // 只有登记了车载定位器才显示这张卡
    ...(deviceStat.total > 0 ? [{
      title: deviceStat.offline > 0 ? t('dashboard.stat_devices_offline') : t('dashboard.stat_devices'),
      value: deviceStat.offline > 0 ? deviceStat.offline : deviceStat.total,
      icon: deviceStat.offline > 0 ? <DisconnectOutlined /> : <EnvironmentOutlined />,
      gradient: deviceStat.offline > 0
        ? 'linear-gradient(135deg, #fee2e2, #fecaca)'
        : 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
      accentColor: deviceStat.offline > 0 ? '#ef4444' : '#22c55e',
    }] : []),
  ];

  const now = new Date();
  const dateStr = now.toLocaleDateString(i18n.language === 'en' ? 'en-NZ' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 18,
        padding: '15px 22px',
        background: 'linear-gradient(135deg, #111827, #1f2937)',
        borderRadius: 14,
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        <div>
          <div style={{ margin: 0, color: '#fff', fontWeight: 800, fontSize: 21, lineHeight: 1.2 }}>
            {t('dashboard.title')}
          </div>
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12.5, marginTop: 2, display: 'block' }}>
            {dateStr}
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={refreshing}
          style={{
            background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DARK})`,
            border: 'none',
            color: '#000',
            fontWeight: 700,
            borderRadius: 10,
            height: 38,
            paddingLeft: 16,
            paddingRight: 16,
            boxShadow: `0 4px 14px ${AMBER}40`,
          }}
        >
          {t('dashboard.refresh')}
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px 0' }}>
          <div style={{
            width: 60, height: 60, borderRadius: 16,
            background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DARK})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}>
            <ReloadOutlined style={{ fontSize: 28, color: '#fff' }} />
          </div>
          <Text style={{ color: '#64748b', fontSize: 15 }}>{t('dashboard.loading')}</Text>
        </div>
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
            {statCards.map((card, idx) => (
              <Col xs={12} sm={12} md={8} lg={Math.floor(24 / statCards.length)} key={idx}>
                <StatCard {...card} />
              </Col>
            ))}
          </Row>

          {(stats.pending || 0) > 0 && (
            <div style={{
              background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DARK})`,
              borderRadius: 16,
              padding: '18px 24px',
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              boxShadow: `0 4px 20px ${AMBER}30`,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'rgba(0,0,0,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ClockCircleOutlined style={{ color: '#fff', fontSize: 22 }} />
              </div>
              <div>
                <Text style={{ color: '#fff', fontWeight: 700, fontSize: 16, display: 'block' }}>
                  {t('dashboard.pending_title')}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
                  <Trans
                    i18nKey="dashboard.pending_body"
                    values={{ pending: stats.pending }}
                    components={{ b: <strong /> }}
                  />
                </Text>
              </div>
            </div>
          )}

          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 44, height: 44,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <img src="./log.png" alt="logo" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${AMBER}40` }} />
                </div>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a1a' }}>{t('dashboard.map_title')}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: 5,
                      background: positions.length > 0 ? '#22c55e' : '#d9d9d9',
                      boxShadow: positions.length > 0 ? '0 0 8px #22c55e' : 'none',
                    }} />
                    <span style={{ fontSize: 13, color: '#64748b' }}>
                      {positions.length > 0 ? t('dashboard.trucks_moving', { n: positions.length }) : t('dashboard.no_trucks')}
                    </span>
                  </div>
                </div>
              </div>
            }
            extra={
              <Button icon={<EnvironmentOutlined />} onClick={openTrackReplay}>
                {t('dashboard.track_replay')}
              </Button>
            }
            bordered={false}
            style={{
              borderRadius: 20,
              boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
              overflow: 'hidden',
            }}
            styles={{ body: { padding: 0 } }}
          >
            <DriverMap positions={positions} />
          </Card>
        </>
      )}

      <Modal
        title={t('dashboard.track_replay')}
        open={trackOpen}
        onCancel={() => setTrackOpen(false)}
        footer={null}
        centered
        width={760}
        destroyOnClose
      >
        <Select
          showSearch
          allowClear
          style={{ width: '100%', marginBottom: 12 }}
          placeholder={t('dashboard.track_search_placeholder')}
          optionFilterProp="label"
          filterOption={(input, option) =>
            String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          value={trackTaskId}
          onChange={selectTrackTask}
          options={trackTasks.map((task) => {
            // 任务名 + 状态是整句翻译，客户/司机是数据，只是拼在后面
            const base = t('dashboard.track_option', {
              title: task.title,
              status: task.status === 'in_progress'
                ? t('dashboard.track_status_in_progress')
                : t('dashboard.track_status_completed'),
            });
            const people = [
              task.client ? (task.client.fullName || task.client.username) : null,
              task.driver ? (task.driver.fullName || task.driver.username) : null,
            ].filter(Boolean);
            return {
              value: task.id,
              label: people.length ? `${base} · ${people.join(' · ')}` : base,
            };
          })}
        />
        {trackLoading ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin /></div>
        ) : trackTaskId ? (
          trackPath.length > 0 ? (
            <TrackMap track={trackPath} status={trackStatus} height={420} />
          ) : (
            <Empty description={t('dashboard.track_empty')} style={{ padding: '60px 0' }} />
          )
        ) : (
          <Empty description={t('dashboard.track_select')} style={{ padding: '60px 0' }} />
        )}
      </Modal>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
}
