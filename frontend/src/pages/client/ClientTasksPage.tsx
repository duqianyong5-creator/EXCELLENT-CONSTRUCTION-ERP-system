import React, { useEffect, useState, useRef } from 'react';
import {
  Card, List, Tag, Typography, Space, Modal, Divider, Image, Empty, Row, Col,
} from 'antd';
import { EnvironmentOutlined, ClockCircleOutlined, CarOutlined, EyeOutlined, TruckOutlined } from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addBaseLayers, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../components/mapLayers';
import { useTranslation } from 'react-i18next';
import { tasksApi, gpsApi, workRecordsApi } from '../../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

// 转义，防止司机昵称把 HTML 注入到 Leaflet 弹窗
function escClient(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function TrackMap({ track, driverPos, status, driverName }: {
  track: [number, number][];
  driverPos: { lat: number; lng: number } | null;
  status: string;
  driverName?: string;
}) {
  const { t } = useTranslation();
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!divRef.current) return;
    const map = L.map(divRef.current, { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM });
    mapRef.current = map;
    addBaseLayers(map);

    if (track.length > 1) {
      L.polyline(track, { color: '#1677ff', weight: 3, opacity: 0.8 }).addTo(map);
    }
    if (track.length > 0) {
      L.marker(track[0], { icon: L.divIcon({ className: '', html: `<div style="width:14px;height:14px;background:#22c55e;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map).bindPopup(t('client.track_start'));
    }
    if (track.length > 0 && status === 'completed') {
      L.marker(track[track.length - 1], { icon: L.divIcon({ className: '', html: `<div style="width:14px;height:14px;background:#ef4444;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map).bindPopup(t('client.track_end'));
    }
    if (driverPos && status === 'in_progress') {
      L.marker([driverPos.lat, driverPos.lng], { icon: L.divIcon({ className: '', html: `<div style="background:#F59E0B;color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff">🚛</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(map).bindPopup(driverName ? t('client.track_driver', { name: escClient(driverName) }) : t('client.track_driver_position'));
    }

    const allPoints: [number, number][] = [...track];
    if (driverPos) allPoints.push([driverPos.lat, driverPos.lng]);
    if (allPoints.length > 1) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [30, 30] });
    } else if (allPoints.length === 1) {
      map.setView(allPoints[0], 13);
    }

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  return <div ref={divRef} style={{ width: '100%', height: 360, borderRadius: 12 }} />;
}

const statusColors: Record<string, string> = {
  pending: 'default', assigned: 'blue', in_progress: 'orange', completed: 'green', cancelled: 'red',
};
const statusLabelKeys: Record<string, string> = {
  pending: 'client.status_pending', assigned: 'client.status_assigned', in_progress: 'client.status_in_progress',
  completed: 'client.status_completed', cancelled: 'client.status_cancelled',
};

function minutesToHM(min: number) {
  if (!min) return '—';
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function ClientTasksPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const [track, setTrack] = useState<any[]>([]);
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [workRecord, setWorkRecord] = useState<any>(null);

  const loadTasks = async () => {
    setLoading(true);
    const data: any = await tasksApi.list();
    setTasks(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadTasks();

    const handler = (e: any) => {
      const { latitude, longitude } = e.detail;
      setDriverPos({ lat: Number(latitude), lng: Number(longitude) });
    };
    window.addEventListener('gps:update', handler);
    return () => window.removeEventListener('gps:update', handler);
  }, []);

  const openTrack = async (task: any) => {
    setSelected(task);
    setTrack([]);
    setWorkRecord(null);

    const [trackData, wr]: any = await Promise.all([
      gpsApi.track(task.id),
      workRecordsApi.byTask(task.id),
    ]);

    setTrack(trackData || []);
    setWorkRecord(wr);

    if (task.driverId && task.status === 'in_progress') {
      const pos: any = await gpsApi.driverPosition(task.driverId);
      if (pos) setDriverPos({ lat: Number(pos.latitude), lng: Number(pos.longitude) });
    }

    setTrackOpen(true);
  };

  const trackPath: [number, number][] = track.map((p: any) => [Number(p.latitude), Number(p.longitude)]);

  return (
    <div>
      <Title level={4} style={{ marginBottom: 20 }}>{t('client.title')}</Title>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <List
          loading={loading}
          dataSource={tasks}
          locale={{ emptyText: <Empty description={t('client.empty')} /> }}
          renderItem={(task: any) => (
            <List.Item
              style={{ padding: '16px 0' }}
              extra={
                <Space>
                  {(task.status === 'in_progress' || task.status === 'completed') && (
                    <Tag
                      color="blue"
                      style={{ cursor: 'pointer', padding: '4px 8px' }}
                      icon={<EyeOutlined />}
                      onClick={() => openTrack(task)}
                    >
                      {task.status === 'in_progress' ? t('client.live_track') : t('client.view_record')}
                    </Tag>
                  )}
                </Space>
              }
            >
              <List.Item.Meta
                avatar={
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: task.status === 'in_progress' ? '#fff7e6' : '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <TruckOutlined style={{ fontSize: 20, color: task.status === 'in_progress' ? '#fa8c16' : '#8c8c8c' }} />
                  </div>
                }
                title={
                  <Space>
                    <Text strong>{task.title}</Text>
                    <Tag color={statusColors[task.status]}>{t(statusLabelKeys[task.status] || task.status)}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <Space>
                      <EnvironmentOutlined style={{ color: '#52c41a' }} />
                      <Text type="secondary">{task.startLocation}</Text>
                      <Text>→</Text>
                      <EnvironmentOutlined style={{ color: '#ff4d4f' }} />
                      <Text type="secondary">{task.endLocation}</Text>
                    </Space>
                    {task.cargo && (
                      <Text type="secondary">
                        {task.cargoWeight
                          ? t('client.cargo_with_weight', { cargo: task.cargo, weight: task.cargoWeight })
                          : t('client.cargo', { cargo: task.cargo })}
                      </Text>
                    )}
                    {task.driver && (
                      <Space>
                        <CarOutlined />
                        <Text type="secondary">{t('client.driver', { name: task.driver.fullName || task.driver.username })}</Text>
                      </Space>
                    )}
                    {task.scheduledAt && (
                      <Space>
                        <ClockCircleOutlined />
                        <Text type="secondary">{dayjs(task.scheduledAt).format('YYYY-MM-DD HH:mm')}</Text>
                      </Space>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      {/* Track Modal */}
      <Modal
        title={
          <Space>
            {selected?.status === 'in_progress' ? t('client.modal_live') : t('client.modal_record')}
            <Text type="secondary" style={{ fontSize: 13 }}>{selected?.title}</Text>
          </Space>
        }
        open={trackOpen}
        onCancel={() => setTrackOpen(false)}
        footer={null}
        width={760}
        destroyOnClose
      >
        {/* Map */}
        <div style={{ marginBottom: 16 }}>
          <TrackMap track={trackPath} driverPos={driverPos} status={selected?.status} driverName={selected?.driver?.fullName || selected?.driver?.username} />
        </div>

        {/* Work Record Info */}
        {workRecord && (
          <>
            <Divider />
            <Row gutter={16}>
              <Col span={8}>
                <Card size="small" bordered={false} style={{ background: '#f0f5ff', borderRadius: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{t('client.start_time')}</Text>
                  <Text strong>{workRecord.startTime ? dayjs(workRecord.startTime).format('HH:mm') : '—'}</Text>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" bordered={false} style={{ background: '#f6ffed', borderRadius: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{t('client.end_time')}</Text>
                  <Text strong>{workRecord.endTime ? dayjs(workRecord.endTime).format('HH:mm') : t('client.in_transit')}</Text>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" bordered={false} style={{ background: '#fff7e6', borderRadius: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{t('client.duration')}</Text>
                  <Text strong>{minutesToHM(workRecord.finalDuration)}</Text>
                </Card>
              </Col>
            </Row>
            {workRecord.imageUrls?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{t('client.photos')}</Text>
                <Space>
                  {workRecord.imageUrls.map((url: string, i: number) => (
                    <Image key={i} src={url} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 6 }} />
                  ))}
                </Space>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
