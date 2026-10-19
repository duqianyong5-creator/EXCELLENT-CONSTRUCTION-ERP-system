import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Table, Card, Button, Tag, Space, Modal, Typography, Form, Input, Switch,
  Popconfirm, message, Slider, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined,
  EnvironmentOutlined, AimOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RootState } from '../../store';
import { geofencesApi, gpsApi } from '../../api';
import { addBaseLayers } from '../../components/mapLayers';

const { Title, Text } = Typography;
const AMBER = '#F59E0B';

/** 车队在新西兰。地图默认落在奥克兰，而不是仪表盘里那个写死的香港坐标 */
const NZ_FALLBACK: [number, number] = [-36.8485, 174.7633];
const MIN_RADIUS_M = 50;
const MAX_RADIUS_M = 5000;
const DEFAULT_RADIUS_M = 300;

type Geofence = {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  vehiclePlate?: string | null;
  enabled: boolean;
  alertOnEnter: boolean;
  alertOnLeave: boolean;
};

/**
 * 在地图上点一下定圆心、拖滑块定半径，并把圆实时画出来。
 * 让人填经纬度是没法用的——没人知道自己院子的经纬度是多少。
 */
function CirclePicker({
  center, radiusM, onPick, open,
}: {
  center: [number, number] | null;
  radiusM: number;
  onPick: (lat: number, lng: number) => void;
  open: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // 用 ref 存回调：地图只初始化一次，闭包里不能抓到旧的 onPick
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { center: center ?? NZ_FALLBACK, zoom: center ? 15 : 11 });
    addBaseLayers(map);
    map.on('click', (e: L.LeafletMouseEvent) => onPickRef.current(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      circleRef.current = null;
      markerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 弹窗是 forceRender 的：地图在页面加载时就初始化了，那时容器还是 display:none、尺寸为 0。
  // 必须等弹窗真正打开、容器有了尺寸再重新测量，否则整块地图是灰的，圈选器根本用不了。
  // Leaflet 只监听窗口 resize，弹窗打开不会触发它。
  useEffect(() => {
    if (!open) return;
    const map = mapRef.current;
    if (!map) return;
    const id = requestAnimationFrame(() => {
      map.invalidateSize();
      if (center) map.setView(center, Math.max(map.getZoom(), 14));
    });
    return () => cancelAnimationFrame(id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!center) {
      circleRef.current?.remove();
      markerRef.current?.remove();
      circleRef.current = null;
      markerRef.current = null;
      return;
    }
    if (!circleRef.current) {
      circleRef.current = L.circle(center, {
        radius: radiusM, color: AMBER, fillColor: AMBER, fillOpacity: 0.15, weight: 2,
      }).addTo(map);
      markerRef.current = L.marker(center, { draggable: true }).addTo(map);
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLatLng();
        onPickRef.current(p.lat, p.lng);
      });
      map.setView(center, Math.max(map.getZoom(), 14));
    } else {
      circleRef.current.setLatLng(center).setRadius(radiusM);
      markerRef.current?.setLatLng(center);
    }
  }, [center, radiusM]);

  return <div ref={hostRef} style={{ width: '100%', height: 320, borderRadius: 10, overflow: 'hidden' }} />;
}

export default function GeofencesPage() {
  const { t } = useTranslation();
  const { user } = useSelector((s: RootState) => s.auth);
  const isAdmin = user?.role === 'admin';

  const [list, setList] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Geofence | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M);
  const [fleetCenter, setFleetCenter] = useState<[number, number] | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows: any = await geofencesApi.list();
      setList(Array.isArray(rows) ? rows : []);
    } catch {
      message.error(t('geofences.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // 新建时把地图落在车队当前所在地，比落在一个默认城市有用得多
  useEffect(() => {
    gpsApi.positions()
      .then((rows: any) => {
        const first = (Array.isArray(rows) ? rows : []).find(
          (p: any) => p?.latitude != null && p?.longitude != null,
        );
        if (first) setFleetCenter([Number(first.latitude), Number(first.longitude)]);
      })
      .catch(() => { /* 拿不到就用默认中心，不打扰用户 */ });
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: '', vehiclePlate: '', enabled: true, alertOnEnter: true, alertOnLeave: true });
    setCenter(fleetCenter);
    setRadius(DEFAULT_RADIUS_M);
    setOpen(true);
  };

  const openEdit = (g: Geofence) => {
    setEditing(g);
    form.setFieldsValue({
      name: g.name,
      vehiclePlate: g.vehiclePlate || '',
      enabled: g.enabled,
      alertOnEnter: g.alertOnEnter,
      alertOnLeave: g.alertOnLeave,
    });
    setCenter([Number(g.centerLat), Number(g.centerLng)]);
    setRadius(Number(g.radiusM));
    setOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (!center) {
      message.error(t('geofences.centreRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: values.name,
        centerLat: center[0],
        centerLng: center[1],
        radiusM: radius,
        vehiclePlate: values.vehiclePlate?.trim() ? values.vehiclePlate.trim() : null,
        enabled: values.enabled,
        alertOnEnter: values.alertOnEnter,
        alertOnLeave: values.alertOnLeave,
      };
      if (editing) {
        await geofencesApi.update(editing.id, payload);
        message.success(t('geofences.saved'));
      } else {
        await geofencesApi.create(payload);
        message.success(t('geofences.created'));
      }
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || t('geofences.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await geofencesApi.delete(id);
      message.success(t('geofences.deleted'));
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || t('geofences.deleteFailed'));
    }
  };

  const columns = [
    {
      title: t('geofences.colName'), dataIndex: 'name', key: 'name',
      render: (v: string, r: Geofence) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <a
            href={`https://www.openstreetmap.org/?mlat=${r.centerLat}&mlon=${r.centerLng}#map=15/${r.centerLat}/${r.centerLng}`}
            target="_blank" rel="noreferrer"
            style={{ fontSize: 12, fontFamily: 'monospace' }}
          >
            <EnvironmentOutlined /> {Number(r.centerLat).toFixed(5)}, {Number(r.centerLng).toFixed(5)}
          </a>
        </Space>
      ),
    },
    {
      title: t('geofences.colScope'), dataIndex: 'vehiclePlate', key: 'vehiclePlate', width: 150,
      render: (v: string | null) => v
        ? <Tag color="gold" style={{ fontWeight: 700, letterSpacing: 1 }}>{v}</Tag>
        : <Text type="secondary">{t('geofences.allVehicles')}</Text>,
    },
    {
      title: t('geofences.colRadius'), dataIndex: 'radiusM', key: 'radiusM', width: 110,
      render: (v: number) => (
        // 数字必须作为插值参数传进去：语言包里的值是 '{{n}} m'，
        // 在外面自己拼数字、调用时不传 n，界面上就会原样显示 "500 {{n}} m"
        <Text>{v >= 1000
          ? t('geofences.unitKm', { n: (v / 1000).toFixed(1) })
          : t('geofences.unitM', { n: v })}</Text>
      ),
    },
    {
      title: t('geofences.colAlerts'), key: 'alerts', width: 170,
      render: (_: any, r: Geofence) => {
        const tags: React.ReactNode[] = [];
        if (r.alertOnEnter) tags.push(<Tag key="in" color="blue">{t('geofences.alertEnter')}</Tag>);
        if (r.alertOnLeave) tags.push(<Tag key="out" color="orange">{t('geofences.alertLeave')}</Tag>);
        return tags.length ? <>{tags}</> : <Text type="secondary">{t('geofences.noAlerts')}</Text>;
      },
    },
    {
      title: t('geofences.colStatus'), dataIndex: 'enabled', key: 'enabled', width: 100,
      render: (v: boolean) => v
        ? <Tag color="green">{t('geofences.enabled')}</Tag>
        : <Tag>{t('geofences.disabled')}</Tag>,
    },
    {
      title: t('geofences.colActions'), key: 'actions', width: 130,
      render: (_: any, r: Geofence) => (
        <Space size={4} wrap={false}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          {isAdmin && (
            <Popconfirm
              title={t('geofences.deleteConfirmTitle')}
              description={t('geofences.deleteConfirmDesc')}
              onConfirm={() => handleDelete(r.id)}
              okText={t('geofences.delete')} okButtonProps={{ danger: true }}
              cancelText={t('geofences.cancel')}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('geofences.title')}</Title>
        <Text type="secondary">{t('geofences.hint')}</Text>
      </div>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={load}>{t('geofences.refresh')}</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('geofences.add')}</Button>
        </div>
        <Table
          columns={columns} dataSource={list} rowKey="id" loading={loading}
          locale={{ emptyText: t('geofences.emptyText') }}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
        />
      </Card>

      <Modal
        open={open}
        title={editing ? t('geofences.editTitle') : t('geofences.createTitle')}
        onCancel={() => setOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        okText={editing ? t('geofences.save') : t('geofences.okAdd')}
        cancelText={t('geofences.cancel')}
        width={640}
        destroyOnClose={false}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name" label={t('geofences.fieldName')}
            rules={[{ required: true, message: t('geofences.nameRequired') }]}
          >
            <Input placeholder={t('geofences.namePlaceholder')} maxLength={128} />
          </Form.Item>

          <Form.Item name="vehiclePlate" label={t('geofences.fieldPlate')} extra={t('geofences.plateExtra')}>
            <Input placeholder={t('geofences.platePlaceholder')} maxLength={32} />
          </Form.Item>

          <Form.Item label={t('geofences.fieldCentre')}>
            <Alert
              type="info" showIcon icon={<AimOutlined />}
              message={t('geofences.mapHint')}
              style={{ marginBottom: 8 }}
            />
            <CirclePicker
              center={center}
              radiusM={radius}
              open={open}
              onPick={(lat, lng) => setCenter([lat, lng])}
            />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6, fontFamily: 'monospace' }}>
              {center ? `${center[0].toFixed(6)}, ${center[1].toFixed(6)}` : t('geofences.centreUnset')}
            </Text>
          </Form.Item>

          <Form.Item label={`${t('geofences.fieldRadius')} — ${t('geofences.unitM', { n: radius })}`} extra={t('geofences.radiusExtra')}>
            {/* 上限取「默认上限」和「当前值」较大者：用接口建过更大半径的围栏时，
                滑块不能把它悄悄夹回 5km 再存回去 */}
            <Slider
              min={MIN_RADIUS_M} max={Math.max(MAX_RADIUS_M, radius)} step={10}
              value={radius} onChange={setRadius}
              marks={{ [MIN_RADIUS_M]: `${MIN_RADIUS_M}m`, 1000: '1km', [MAX_RADIUS_M]: '5km' }}
            />
          </Form.Item>

          <Space size={24} wrap>
            <Form.Item name="enabled" label={t('geofences.fieldEnabled')} valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
            <Form.Item name="alertOnEnter" label={t('geofences.fieldAlertOnEnter')} valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
            <Form.Item name="alertOnLeave" label={t('geofences.fieldAlertOnLeave')} valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
