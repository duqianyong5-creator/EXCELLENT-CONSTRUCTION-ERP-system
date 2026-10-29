import React, { useCallback, useEffect, useState } from 'react';
import {
  Table, Card, Button, Tag, Space, Modal, Typography, Form, Input, Switch,
  Popconfirm, message, Tooltip, Alert, Badge, Segmented,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, AimOutlined,
  PoweroffOutlined, ThunderboltOutlined, EnvironmentOutlined, ApiOutlined,
  DisconnectOutlined, UserOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { RootState } from '../../store';
import { gpsDevicesApi } from '../../api';

const { Title, Text } = Typography;
const AMBER = '#F59E0B';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type Device = {
  id: string; deviceNo: string; vehiclePlate?: string | null; name?: string | null; enabled: boolean; iccid?: string | null;
  lastSeenAt?: string | null; lastFixAt?: string | null; lastLatitude?: number | null; lastLongitude?: number | null;
  lastSpeed?: number | null; batteryPercent?: number | null; externalPower?: boolean | null; signalPercent?: number | null;
  online: boolean; connection?: { addr: string; connectedAt: string; tzOffset: number } | null;
  currentTask?: { id: string; title: string; driverName: string } | null;
};

type Gateway = {
  port: number | null;
  error?: string | null;
  online: Array<{ deviceNo: string }>;
  unregistered: Array<{ deviceNo: string; addr: string; count: number; lastAt: string; disabled?: boolean }>;
};

// bare=true 时用不带「前 / ago」的说法，好嵌进「已离线 X」这种句子里
function ago(value: string | null | undefined, t: Translate, bare = false): string {
  if (!value) return '—';
  const sec = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  const p = bare ? 'devices.dur' : 'devices.ago';
  if (sec < 10) return t(`${p}JustNow`);
  if (sec < 60) return t(`${p}Seconds`, { n: sec });
  if (sec < 3600) return t(`${p}Minutes`, { n: Math.floor(sec / 60) });
  if (sec < 86400) return t(`${p}Hours`, { n: Math.floor(sec / 3600) });
  return dayjs(value).format('MM-DD HH:mm');
}

export default function DevicesPage() {
  const { t } = useTranslation();
  const { user } = useSelector((s: RootState) => s.auth);
  const isAdmin = user?.role === 'admin';

  const [list, setList] = useState<Device[]>([]);
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const devices: any = await gpsDevicesApi.list();
      setList(Array.isArray(devices) ? devices : []);
      // 网关状态仅管理员/调度员可见；监控角色拿不到时不影响设备列表
      try {
        const gw: any = await gpsDevicesApi.gateway();
        setGateway(gw || null);
      } catch {
        setGateway(null);
      }
    } catch {
      if (!silent) message.error(t('devices.loadFailed'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 15000);
    return () => clearInterval(timer);
  }, [load]);

  // Modal 用 forceRender 让 Form 常驻挂载，setFieldsValue 才能在打开前生效
  const openCreate = (deviceNo = '') => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ deviceNo, vehiclePlate: '', name: '', iccid: '', enabled: true });
    setOpen(true);
  };

  const openEdit = (d: Device) => {
    setEditing(d);
    form.setFieldsValue({ deviceNo: d.deviceNo, vehiclePlate: d.vehiclePlate || '', name: d.name || '', iccid: d.iccid || '', enabled: d.enabled });
    setOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await gpsDevicesApi.update(editing.id, { vehiclePlate: values.vehiclePlate, name: values.name, iccid: values.iccid, enabled: values.enabled });
        message.success(t('devices.saved'));
      } else {
        await gpsDevicesApi.create(values);
        message.success(t('devices.registered'));
      }
      setOpen(false);
      form.resetFields();
      load(true);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || t('devices.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await gpsDevicesApi.delete(id);
      message.success(t('devices.deleted'));
      load(true);
    } catch {
      message.error(t('devices.deleteFailed'));
    }
  };

  const sendCommand = async (d: Device, type: 'reboot' | 'realtime' | 'locate') => {
    try {
      await gpsDevicesApi.command(d.id, type === 'realtime' ? { type, intervalSec: 10 } : { type });
      message.success(
        type === 'reboot' ? t('devices.rebootSent')
          : type === 'realtime' ? t('devices.realtimeSent')
            : t('devices.locateSent'),
      );
    } catch (e: any) {
      message.error(e?.response?.data?.message || t('devices.deviceOffline'));
    }
  };

  const columns = [
    {
      title: t('devices.colDeviceNo'), dataIndex: 'deviceNo', key: 'deviceNo', width: 150,
      render: (v: string, r: Device) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontFamily: 'monospace' }}>{v}</Text>
          {r.name ? <Text type="secondary" style={{ fontSize: 12 }}>{r.name}</Text> : null}
        </Space>
      ),
    },
    {
      title: t('devices.colPlate'), dataIndex: 'vehiclePlate', key: 'vehiclePlate', width: 120,
      render: (v: string | null) => v
        ? <Tag color="gold" style={{ fontWeight: 700, letterSpacing: 1 }}>{v}</Tag>
        : <Text type="warning">{t('devices.unbound')}</Text>,
    },
    {
      // 哪张卡装在哪台设备、哪辆车上：换本地卡以后这是唯一能对上的线索
      title: t('devices.colIccid'), dataIndex: 'iccid', key: 'iccid', width: 200,
      render: (v: string | null) => v
        ? <Text copyable={{ text: v }} style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>
        : <Text type="secondary" style={{ fontSize: 12 }}>{t('devices.iccidUnknown')}</Text>,
    },
    {
      title: t('devices.colStatus'), key: 'status', width: 110,
      render: (_: any, r: Device) => (
        <Space direction="vertical" size={0}>
          {r.online
            ? <Badge status="processing" color="#22c55e" text={<Text style={{ color: '#16a34a', fontWeight: 600 }}>{t('devices.online')}</Text>} />
            : <Badge status="default" text={<Text type="secondary">{t('devices.offline')}</Text>} />}
          {!r.enabled && <Tag color="red" style={{ marginTop: 4 }}>{t('devices.disabled')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('devices.colLastSeen'), key: 'lastSeenAt', width: 130,
      render: (_: any, r: Device) => (
        <Tooltip title={r.lastSeenAt ? dayjs(r.lastSeenAt).format('YYYY-MM-DD HH:mm:ss') : ''}>
          <Text type={r.online ? undefined : 'secondary'}>{ago(r.lastSeenAt, t)}</Text>
        </Tooltip>
      ),
    },
    {
      title: t('devices.colLastFix'), key: 'fix', width: 210,
      render: (_: any, r: Device) => r.lastLatitude != null && r.lastLongitude != null ? (
        <Space direction="vertical" size={0}>
          <a
            href={`https://www.openstreetmap.org/?mlat=${r.lastLatitude}&mlon=${r.lastLongitude}#map=16/${r.lastLatitude}/${r.lastLongitude}`}
            target="_blank" rel="noreferrer" style={{ fontFamily: 'monospace', fontSize: 12 }}
          >
            <EnvironmentOutlined /> {Number(r.lastLatitude).toFixed(5)}, {Number(r.lastLongitude).toFixed(5)}
          </a>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {Number(r.lastSpeed ?? 0).toFixed(0)} km/h · {ago(r.lastFixAt, t)}
          </Text>
        </Space>
      ) : <Text type="secondary">—</Text>,
    },
    {
      title: t('devices.colCurrentTask'), key: 'currentTask', width: 170,
      render: (_: any, r: Device) => r.currentTask ? (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 13 }}><UserOutlined style={{ marginRight: 4, color: '#16a34a' }} />{r.currentTask.driverName}</Text>
          <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{r.currentTask.title}</Text>
        </Space>
      ) : (
        <Tooltip title={t('devices.noTaskTip')}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('devices.noActiveTask')}</Text>
        </Tooltip>
      ),
    },
    {
      title: t('devices.colPower'), key: 'power', width: 140,
      render: (_: any, r: Device) => (
        <Space size={6}>
          {r.batteryPercent != null && (
            <Tag color={r.batteryPercent < 20 ? 'red' : r.batteryPercent < 50 ? 'orange' : 'green'}>
              {r.externalPower ? <ThunderboltOutlined /> : null} {r.batteryPercent}%
            </Tag>
          )}
          {r.signalPercent != null && <Tag>{t('devices.signal')} {r.signalPercent}%</Tag>}
          {r.batteryPercent == null && r.signalPercent == null && <Text type="secondary">—</Text>}
        </Space>
      ),
    },
    {
      title: t('devices.colActions'), key: 'actions', width: 250,
      render: (_: any, r: Device) => (
        <Space size={4} wrap>
          <Tooltip title={t('devices.editTip')}>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          {/* 禁用的 AntD 按钮不派发鼠标事件，tooltip 必须包一层才弹得出来 */}
          <Tooltip title={r.online ? t('devices.locateNow') : t('devices.offlineCannotSend')}>
            <span>
              <Button size="small" icon={<AimOutlined />} disabled={!r.online} onClick={() => sendCommand(r, 'locate')} />
            </span>
          </Tooltip>
          <Popconfirm
            title={t('devices.realtimeConfirmTitle')}
            description={t('devices.realtimeConfirmDesc')}
            onConfirm={() => sendCommand(r, 'realtime')} okText={t('devices.send')} cancelText={t('devices.cancel')}
            disabled={!r.online}
          >
            <Tooltip title={r.online ? t('devices.realtimeMode') : t('devices.offlineCannotSend')}>
              <span>
                <Button size="small" icon={<ThunderboltOutlined />} disabled={!r.online} />
              </span>
            </Tooltip>
          </Popconfirm>
          <Popconfirm
            title={t('devices.rebootConfirmTitle')} onConfirm={() => sendCommand(r, 'reboot')}
            okText={t('devices.reboot')} cancelText={t('devices.cancel')} disabled={!r.online}
          >
            <Tooltip title={r.online ? t('devices.reboot') : t('devices.offlineCannotSend')}>
              <span>
                <Button size="small" icon={<PoweroffOutlined />} disabled={!r.online} />
              </span>
            </Tooltip>
          </Popconfirm>
          {isAdmin && (
            <Popconfirm
              title={t('devices.deleteConfirmTitle')} onConfirm={() => handleDelete(r.id)}
              okText={t('devices.delete')} okButtonProps={{ danger: true }} cancelText={t('devices.cancel')}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const onlineCount = list.filter((d) => d.online).length;
  // 「哪台设备 / 哪辆车不在线」：停用的设备不算掉线
  const offlineDevices = list.filter((d) => d.enabled && !d.online);
  // 有任务在跑却掉线 = 要立刻处理；熄火停放导致的掉线是正常现象，分开显示避免告警疲劳
  const offlineOnDuty = offlineDevices.filter((d) => d.currentTask);
  const offlineParked = offlineDevices.filter((d) => !d.currentTask);
  const visibleList = filter === 'online' ? list.filter((d) => d.online)
    : filter === 'offline' ? list.filter((d) => d.enabled && !d.online)
      : list;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <ApiOutlined style={{ marginRight: 8, color: AMBER }} />
          {t('devices.title')}
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>{t('devices.refresh')}</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>{t('devices.add')}</Button>
        </Space>
      </div>

      {gateway?.error && (
        <Alert
          type="error" showIcon style={{ marginBottom: 16, borderRadius: 10 }}
          message={t('devices.gatewayFailed', { error: gateway.error })}
          description={t('devices.gatewayFailedDesc')}
        />
      )}
      {/* 网关正常时不再放一条说明横幅：在线数筛选器里有，服务器地址是部署时的事，天天看只是占地方 */}
      {gateway && !gateway.error && !gateway.port && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 16, borderRadius: 10 }}
          message={t('devices.gatewayOff')}
        />
      )}

      {gateway && gateway.unregistered.length > 0 && (
        <Card
          size="small" bordered={false}
          style={{ marginBottom: 16, borderRadius: 12, background: '#fffbeb', border: '1px solid #fde68a' }}
          title={<span style={{ color: '#b45309' }}>{t('devices.unregisteredTitle')}</span>}
        >
          <Space wrap>
            {gateway.unregistered.map((u) => (
              <Tag
                key={u.deviceNo} color="orange" style={{ padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
                onClick={() => openCreate(u.deviceNo)}
              >
                <Text strong style={{ fontFamily: 'monospace' }}>{u.deviceNo}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{u.addr} · ×{u.count} · {ago(u.lastAt, t)}</Text>
                <PlusOutlined style={{ marginLeft: 8 }} />
              </Tag>
            ))}
          </Space>
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('devices.unregisteredHint')}
            </Text>
          </div>
        </Card>
      )}

      {offlineOnDuty.length > 0 && (
        <Card
          size="small" bordered={false}
          style={{ marginBottom: 16, borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca' }}
          title={
            <span style={{ color: '#b91c1c' }}>
              <DisconnectOutlined style={{ marginRight: 8 }} />
              {t('devices.offlineOnDutyTitle', { n: offlineOnDuty.length })}
            </span>
          }
        >
          <Space wrap size={[8, 8]}>
            {offlineOnDuty.map((d) => (
              <Tag key={d.id} color="red" style={{ padding: '5px 10px', fontSize: 13, margin: 0 }}>
                <Text strong style={{ letterSpacing: 0.5 }}>
                  {d.vehiclePlate || t('devices.noPlate')}
                </Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{d.currentTask?.driverName}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {d.lastSeenAt
                    ? t('devices.offlineFor', { duration: ago(d.lastSeenAt, t, true) })
                    : t('devices.neverConnected')}
                </Text>
              </Tag>
            ))}
          </Space>
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('devices.offlineOnDutyHint')}
            </Text>
          </div>
        </Card>
      )}

      {offlineParked.length > 0 && (
        <Card
          size="small" bordered={false}
          style={{ marginBottom: 16, borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}
          title={
            <span style={{ color: '#475569' }}>
              <DisconnectOutlined style={{ marginRight: 8 }} />
              {t('devices.offlineParkedTitle', { n: offlineParked.length })}
            </span>
          }
        >
          <Space wrap size={[8, 8]}>
            {offlineParked.map((d) => (
              <Tag key={d.id} style={{ padding: '5px 10px', fontSize: 13, margin: 0 }}>
                <Text style={{ letterSpacing: 0.5 }}>{d.vehiclePlate || t('devices.noPlate')}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12, fontFamily: 'monospace' }}>{d.deviceNo}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {d.lastSeenAt ? ago(d.lastSeenAt, t) : t('devices.neverConnected')}
                </Text>
              </Tag>
            ))}
          </Space>
        </Card>
      )}

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <div style={{ marginBottom: 12 }}>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as 'all' | 'online' | 'offline')}
            options={[
              { label: t('devices.filterAll', { n: list.length }), value: 'all' },
              { label: t('devices.filterOnline', { n: onlineCount }), value: 'online' },
              // 数字要和切过去之后表格里的行数一致：停用的设备不算掉线。
              // 原来用 list.length - onlineCount 把停用的也算了进去，标签和表格对不上。
              { label: t('devices.filterOffline', { n: offlineDevices.length }), value: 'offline' },
            ]}
          />
        </div>
        <Table
          columns={columns} dataSource={visibleList} rowKey="id" loading={loading}
          pagination={{ pageSize: 20 }} scroll={{ x: 1380 }}
          locale={{ emptyText: t('devices.emptyText') }}
        />
      </Card>

      <Modal
        title={editing ? t('devices.editTitle') : t('devices.add')}
        open={open} onCancel={() => setOpen(false)} onOk={handleSubmit} confirmLoading={submitting}
        okText={editing ? t('devices.save') : t('devices.okAdd')} cancelText={t('devices.cancel')}
        centered width={440} forceRender
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
          <Form.Item
            name="deviceNo" label={t('devices.fieldDeviceNo')}
            rules={[{ required: true, message: t('devices.deviceNoRequired') }, { pattern: /^\d{5,20}$/, message: t('devices.deviceNoPattern') }]}
            extra={t('devices.deviceNoExtra')}
          >
            <Input placeholder="51160004464" disabled={!!editing} maxLength={20} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item
            name="vehiclePlate" label={t('devices.fieldPlate')}
            extra={t('devices.plateExtra')}
          >
            <Input placeholder="ABC123" maxLength={32} style={{ textTransform: 'uppercase' }} />
          </Form.Item>
          <Form.Item name="name" label={t('devices.fieldName')}>
            <Input placeholder={t('devices.namePlaceholder')} maxLength={128} />
          </Form.Item>
          {/* The number printed on the card is often grouped with spaces or hyphens and is not always an
              89-prefixed ICCID (Chinese IoT SIMs print a 17-digit card number): strip separators and upper-case
              as the user types, and apply the same loose rule as the backend (10-22 hex characters). */}
          <Form.Item
            name="iccid" label={t('devices.fieldIccid')}
            normalize={(v) => String(v ?? '').replace(/[\s-]+/g, '').toUpperCase()}
            rules={[{ pattern: /^[0-9A-F]{10,22}$/, message: t('devices.iccidPattern') }]}
            extra={t('devices.iccidExtra')}
          >
            <Input placeholder="64050087230172061" maxLength={32} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="enabled" label={t('devices.fieldEnabled')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
