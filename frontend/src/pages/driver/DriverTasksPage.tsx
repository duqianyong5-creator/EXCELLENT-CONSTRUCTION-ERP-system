import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Card, List, Tag, Button, Modal, Form, Input, Upload, message,
  Typography, Space, Divider, Statistic, Badge, Progress, Alert,
} from 'antd';
import {
  EnvironmentOutlined, ClockCircleOutlined, CarOutlined,
  CameraOutlined, CheckCircleOutlined, PlayCircleOutlined,
  WifiOutlined, DisconnectOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { tasksApi, gpsApi } from '../../api';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';

dayjs.extend(duration);

const { Title, Text } = Typography;
const { TextArea } = Input;

const statusColors: Record<string, string> = {
  pending: 'default', assigned: 'blue', in_progress: 'orange', completed: 'green', cancelled: 'red',
};
const statusLabelKeys: Record<string, string> = {
  pending: 'driver.status_pending', assigned: 'driver.status_assigned', in_progress: 'driver.status_in_progress',
  completed: 'driver.status_completed', cancelled: 'driver.status_cancelled',
};

export default function DriverTasksPage() {
  const { t } = useTranslation();
  const { user } = useSelector((s: RootState) => s.auth);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTask, setActiveTask] = useState<any>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [gpsStatus, setGpsStatus] = useState<'on' | 'off' | 'error'>('off');
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const timerRef = useRef<any>(null);
  const gpsRef = useRef<any>(null);
  const startTimeRef = useRef<Date | null>(null);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<any[]>([]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const data: any = await tasksApi.list();
    const list = (data || []).filter((t: any) => t.driverId === user?.id);
    setTasks(list);
    const inProgress = list.find((t: any) => t.status === 'in_progress');
    if (inProgress && !activeTask) setActiveTask(inProgress);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // GPS upload every 10s
  const startGps = useCallback((taskId: string) => {
    if (!navigator.geolocation) { setGpsStatus('error'); return; }

    const upload = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsStatus('on');
          setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          gpsApi.upload({
            taskId,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            speed: (pos.coords.speed || 0) * 3.6,
            accuracy: pos.coords.accuracy,
          });
        },
        () => setGpsStatus('error'),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    };

    upload();
    gpsRef.current = setInterval(upload, 10000);
  }, []);

  const stopGps = useCallback(() => {
    if (gpsRef.current) { clearInterval(gpsRef.current); gpsRef.current = null; }
    setGpsStatus('off');
  }, []);

  // Timer
  useEffect(() => {
    if (activeTask?.status === 'in_progress') {
      startTimeRef.current = new Date();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current!.getTime()) / 1000));
      }, 1000);
      startGps(activeTask.id);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopGps();
    };
  }, [activeTask?.id, activeTask?.status]);

  const handleStart = async (task: any) => {
    if (gpsStatus === 'off' && navigator.geolocation) {
      // Check GPS availability
    }
    await tasksApi.start(task.id);
    setActiveTask({ ...task, status: 'in_progress' });
    message.success(t('driver.task_started_msg'));
    loadTasks();
  };

  const handleComplete = async (values: any) => {
    const formData = new FormData();
    formData.append('notes', values.notes || '');
    fileList.forEach((f) => {
      if (f.originFileObj) formData.append('images', f.originFileObj);
    });
    if (fileList.length === 0) {
      message.error(t('driver.photo_required'));
      return;
    }
    await tasksApi.complete(activeTask.id, formData);
    message.success(t('driver.task_done_msg'));
    setCompleteOpen(false);
    setActiveTask(null);
    setFileList([]);
    stopGps();
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    form.resetFields();
    loadTasks();
  };

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const todayTasks = tasks.filter((t) => {
    const today = dayjs().startOf('day');
    return t.scheduledAt ? dayjs(t.scheduledAt).isAfter(today) : true;
  });

  return (
    <div>
      <Title level={4} style={{ marginBottom: 20 }}>
        {t('driver.today_header', { date: dayjs().format(t('driver.today_date_format')) })}
      </Title>

      {/* Active task tracker */}
      {activeTask && activeTask.status === 'in_progress' && (
        <Card
          style={{ marginBottom: 20, border: '2px solid #fa8c16', borderRadius: 12, background: '#fffbe6' }}
          bodyStyle={{ padding: 20 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <Text strong style={{ fontSize: 16 }}>{t('driver.in_progress_label', { title: activeTask.title })}</Text>
              <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                <Statistic
                  title={t('driver.live_hours')}
                  value={formatTime(elapsed)}
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: '#fa8c16', fontSize: 28, fontWeight: 700 }}
                />
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: 8 }}>
                <Space>
                  {gpsStatus === 'on' ? (
                    <Tag color="green" icon={<WifiOutlined />}>{t('driver.gps_ok')}</Tag>
                  ) : gpsStatus === 'error' ? (
                    <Tag color="red" icon={<DisconnectOutlined />}>{t('driver.gps_error')}</Tag>
                  ) : (
                    <Tag color="default">{t('driver.gps_init')}</Tag>
                  )}
                  {gpsCoords && <Text type="secondary" style={{ fontSize: 12 }}>{gpsCoords.lat.toFixed(5)}, {gpsCoords.lng.toFixed(5)}</Text>}
                </Space>
              </div>
              <Button
                type="primary"
                danger
                size="large"
                icon={<CheckCircleOutlined />}
                onClick={() => setCompleteOpen(true)}
                style={{ borderRadius: 8 }}
              >
                {t('driver.complete_task')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Task list */}
      <Card bordered={false} style={{ borderRadius: 12 }}>
        <List
          loading={loading}
          dataSource={tasks}
          locale={{ emptyText: t('driver.no_tasks') }}
          renderItem={(task: any) => (
            <List.Item
              style={{ padding: '16px 0', borderBottom: '1px solid #f0f0f0' }}
              extra={
                task.status === 'assigned' ? (
                  <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => handleStart(task)}>
                    {t('start_task')}
                  </Button>
                ) : null
              }
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Text strong>{task.title}</Text>
                    <Tag color={statusColors[task.status]}>{t(statusLabelKeys[task.status] || task.status)}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space>
                      <EnvironmentOutlined style={{ color: '#52c41a' }} />
                      <Text type="secondary">{task.startLocation}</Text>
                      <Text type="secondary">→</Text>
                      <EnvironmentOutlined style={{ color: '#ff4d4f' }} />
                      <Text type="secondary">{task.endLocation}</Text>
                    </Space>
                    {task.cargo && (
                      <Space>
                        <Text type="secondary">{t('driver.cargo', { cargo: task.cargo })}</Text>
                        {task.cargoWeight && <Text type="secondary">{t('driver.cargo_weight', { weight: task.cargoWeight })}</Text>}
                      </Space>
                    )}
                    {task.scheduledAt && (
                      <Space>
                        <ClockCircleOutlined style={{ color: '#1677ff' }} />
                        <Text type="secondary">{dayjs(task.scheduledAt).format('YYYY-MM-DD HH:mm')}</Text>
                      </Space>
                    )}
                    {task.client && (
                      <Space>
                        <Text type="secondary">{t('driver.client', { name: task.client.fullName || task.client.username })}</Text>
                      </Space>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      {/* Complete Task Modal */}
      <Modal
        title={t('driver.complete_modal_title')}
        open={completeOpen}
        onCancel={() => setCompleteOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Alert message={t('driver.complete_alert')} type="info" showIcon style={{ marginBottom: 16 }} />
        <Form form={form} onFinish={handleComplete} layout="vertical">
          <Form.Item label={t('driver.photos_label')}>
            <Upload
              listType="picture-card"
              fileList={fileList}
              onChange={({ fileList: fl }) => setFileList(fl)}
              beforeUpload={() => false}
              maxCount={5}
            >
              {fileList.length < 5 && (
                <div>
                  <CameraOutlined style={{ fontSize: 20 }} />
                  <div style={{ marginTop: 8 }}>{t('driver.upload_photo')}</div>
                </div>
              )}
            </Upload>
          </Form.Item>
          <Form.Item name="notes" label={t('driver.notes')}>
            <TextArea rows={3} placeholder={t('driver.notes_placeholder')} />
          </Form.Item>
          <div style={{ background: '#f5f5f5', padding: '12px 16px', borderRadius: 8, marginBottom: 16 }}>
            <Text type="secondary">{t('driver.elapsed', { time: formatTime(elapsed) })}</Text>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setCompleteOpen(false)}>{t('driver.cancel')}</Button>
              <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />}>{t('driver.submit')}</Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
