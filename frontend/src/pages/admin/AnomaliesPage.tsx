import React, { useEffect, useState } from 'react';
import { Table, Card, Tag, Button, Space, Badge, Typography, Tooltip, Modal, InputNumber, Switch, message } from 'antd';
import {
  WarningOutlined, CheckCircleOutlined, ReloadOutlined, SoundOutlined, ClockCircleOutlined,
  StopOutlined, AlertOutlined, PoweroffOutlined, LoginOutlined, LogoutOutlined, DisconnectOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api, { anomaliesApi } from '../../api';
import { isAnomalySoundOn, setAnomalySoundOn } from '../../hooks/useAnomalyAlarm';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

// 震动/断电用实心深红：它们是安全事件（半夜停在场里被撬），必须比超速那种浅色标签更扎眼。
// 围栏进出是行程信息、不是故障，用蓝/紫，免得和真正的报警混在一起。
const anomalyLabels: Record<string, { labelKey: string; color: string; icon: React.ReactNode }> = {
  gps_disconnect:      { labelKey: 'anomalies.type_gps_disconnect',      color: 'volcano',  icon: <WarningOutlined /> },
  speed_anomaly:       { labelKey: 'anomalies.type_speed_anomaly',       color: 'red',      icon: <WarningOutlined /> },
  teleport:            { labelKey: 'anomalies.type_teleport',            color: 'magenta',  icon: <WarningOutlined /> },
  time_inconsistency:  { labelKey: 'anomalies.type_time_inconsistency',  color: 'orange',   icon: <WarningOutlined /> },
  stationary:          { labelKey: 'anomalies.type_stationary',          color: 'red',      icon: <WarningOutlined /> },
  shock:               { labelKey: 'anomalies.type_shock',               color: '#d4380d',  icon: <AlertOutlined /> },
  power_cut:           { labelKey: 'anomalies.type_power_cut',           color: '#a8071a',  icon: <PoweroffOutlined /> },
  // 接着车电的定位器突然没了：没有备用电池的设备被拔线时，这是唯一能报出来的一条
  device_offline:      { labelKey: 'anomalies.type_device_offline',      color: '#a8071a',  icon: <DisconnectOutlined /> },
  geofence_enter:      { labelKey: 'anomalies.type_geofence_enter',      color: 'blue',     icon: <LoginOutlined /> },
  geofence_leave:      { labelKey: 'anomalies.type_geofence_leave',      color: 'purple',   icon: <LogoutOutlined /> },
};

export default function AnomaliesPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // 声音开关与全局报警提示音（useAnomalyAlarm）共用 localStorage 标志；
  // 实际的「检测到新静止报警就响」由 AdminLayout 里的全局 hook 负责，任意页面都会响。
  const [soundOn, setSoundOn] = useState(isAnomalySoundOn());
  const [snoozeFor, setSnoozeFor] = useState<any>(null);
  const [snoozeMinutes, setSnoozeMinutes] = useState(10);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data: any = await api.get(showAll ? '/anomalies' : '/anomalies/unresolved');
      const list = Array.isArray(data) ? data : [];
      setItems(list);
    } catch { setItems([]); }
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); }, [showAll]);

  // 每 15 秒自动刷新（用于静止报警实时提醒）
  useEffect(() => {
    const timer = setInterval(() => load(true), 15000);
    return () => clearInterval(timer);
  }, [showAll]);

  const ignore = async (id: string) => {
    await anomaliesApi.ignore(id);
    message.success(t('anomalies.ignored_msg'));
    load();
  };

  const resolve = async (id: string) => {
    await anomaliesApi.resolve(id);
    message.success(t('anomalies.resolved_msg'));
    load();
  };

  const doSnooze = async () => {
    if (!snoozeFor) return;
    await anomaliesApi.snooze(snoozeFor.id, snoozeMinutes);
    message.success(t('anomalies.snoozed_msg', { minutes: snoozeMinutes }));
    setSnoozeFor(null);
    load();
  };

  const unresolvedCount = items.filter((i) => !i.resolved).length;

  const columns = [
    {
      title: t('anomalies.col_type'), dataIndex: 'anomalyType', key: 'anomalyType',
      render: (v: string, r: any) => {
        const info = anomalyLabels[v];
        return (
          <Space size={4}>
            <Tag color={info?.color || 'default'} icon={info?.icon || <WarningOutlined />}>{info ? t(info.labelKey) : v}</Tag>
            {v === 'stationary' && r.alarmCount > 1 && <Tag color="red">{t('anomalies.alarm_count', { count: r.alarmCount })}</Tag>}
          </Space>
        );
      },
    },
    {
      title: t('anomalies.col_driver'), key: 'driver',
      // 定位器报警在车辆空闲时也会来（撬车就是这种），这种记录没有司机也没有任务；
      // 只显示一个「-」等于没说，调度员得知道是哪台车 —— 退而求其次显示车牌，再不行显示设备号。
      render: (_: any, r: any) => {
        const driverName = r.driver?.fullName || r.driver?.username;
        if (driverName) return driverName;
        if (r.vehiclePlate) {
          return (
            <Space direction="vertical" size={0}>
              <Tag color="gold" style={{ fontWeight: 700, letterSpacing: 1, marginInlineEnd: 0 }}>{r.vehiclePlate}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('anomalies.no_driver')}</Text>
            </Space>
          );
        }
        if (r.deviceNo) {
          return (
            <Tooltip title={t('anomalies.device_tooltip')}>
              <Text type="secondary" style={{ fontFamily: 'monospace' }}>{r.deviceNo}</Text>
            </Tooltip>
          );
        }
        return '-';
      },
    },
    {
      title: t('anomalies.col_task'), key: 'task',
      render: (_: any, r: any) => r.task?.title || '-',
    },
    {
      title: t('anomalies.col_description'), dataIndex: 'description', key: 'description', ellipsis: true,
      render: (v: string) => v ? <Text type="secondary">{v}</Text> : '-',
    },
    {
      title: t('anomalies.col_coords'), key: 'coords',
      render: (_: any, r: any) => r.latitude
        ? <Tooltip title={t('anomalies.open_in_maps')}><span style={{ fontSize: 12, color: '#1677ff', cursor: 'pointer' }} onClick={() => window.open(`https://maps.google.com/?q=${r.latitude},${r.longitude}`, '_blank')}>{Number(r.latitude).toFixed(5)}, {Number(r.longitude).toFixed(5)}</span></Tooltip>
        : '-',
    },
    {
      title: t('anomalies.col_detected_at'), dataIndex: 'detectedAt', key: 'detectedAt',
      render: (v: string) => dayjs(v).format('MM-DD HH:mm:ss'),
      sorter: (a: any, b: any) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    },
    {
      title: t('anomalies.col_status'), dataIndex: 'resolved', key: 'resolved',
      render: (v: boolean, r: any) => {
        if (v) return <Tag color="green" icon={<CheckCircleOutlined />}>{t('anomalies.resolved')}</Tag>;
        if (r.snoozeUntil && new Date(r.snoozeUntil).getTime() > Date.now()) {
          return <Tag color="gold" icon={<ClockCircleOutlined />}>{t('anomalies.snoozed_until', { time: dayjs(r.snoozeUntil).format('HH:mm') })}</Tag>;
        }
        return <Badge status="error" text={t('anomalies.unresolved')} />;
      },
    },
    {
      title: t('anomalies.col_actions'), key: 'actions', width: 200,
      render: (_: any, r: any) => r.resolved ? null : (
        <Space size="small">
          {r.anomalyType === 'stationary' && (
            <Button size="small" icon={<ClockCircleOutlined />} onClick={() => { setSnoozeFor(r); setSnoozeMinutes(10); }}>{t('anomalies.btn_snooze')}</Button>
          )}
          <Button size="small" icon={<StopOutlined />} onClick={() => ignore(r.id)}>{t('anomalies.btn_ignore')}</Button>
          <Button size="small" type="primary" onClick={() => resolve(r.id)}>{t('anomalies.btn_resolve')}</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>{t('anomalies.title')}</Title>
          {unresolvedCount > 0 && <Badge count={unresolvedCount} style={{ backgroundColor: '#ff4d4f' }} />}
        </Space>
        <Space>
          <Tooltip title={t('anomalies.sound_tooltip')}>
            <Space size={4}>
              <SoundOutlined style={{ color: soundOn ? '#F59E0B' : '#bbb' }} />
              <Switch size="small" checked={soundOn} onChange={(v) => { setSoundOn(v); setAnomalySoundOn(v); }} />
            </Space>
          </Tooltip>
          <Button
            type={showAll ? 'default' : 'primary'}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? t('anomalies.show_unresolved_only') : t('anomalies.show_all')}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => load()}>{t('anomalies.refresh')}</Button>
        </Space>
      </div>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Table
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
          rowClassName={(r) => !r.resolved ? 'ant-table-row-selected' : ''}
          scroll={{ x: 1000 }}
        />
      </Card>

      <Modal
        title={<span><ClockCircleOutlined /> {t('anomalies.snooze_modal_title')}</span>}
        open={!!snoozeFor}
        onCancel={() => setSnoozeFor(null)}
        onOk={doSnooze}
        okText={t('anomalies.snooze_ok')}
        cancelText={t('anomalies.cancel')}
        centered
        width={420}
        destroyOnClose
      >
        <Text>{t('anomalies.snooze_hint')}</Text>
        <div style={{ marginTop: 12 }}>
          <InputNumber min={1} max={120} value={snoozeMinutes} onChange={(v) => setSnoozeMinutes(Number(v) || 10)} addonAfter={t('anomalies.minutes')} style={{ width: 160 }} />
        </div>
      </Modal>
    </div>
  );
}
