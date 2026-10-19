import React, { useEffect, useState } from 'react';
import {
  Table, Card, Button, Tag, Space, Modal, Form, Input, Select,
  message, Popconfirm, Typography, DatePicker, InputNumber, Tooltip, Empty,
  Descriptions, Image,
} from 'antd';
import {
  PlusOutlined, EnvironmentOutlined, CarOutlined, UserOutlined,
  EyeOutlined, DeleteOutlined, PictureOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { tasksApi, usersApi, workRecordsApi } from '../../api';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const compactModalStyles = {
  header: { padding: '14px 18px' },
  body: { padding: '14px 18px 18px' },
};
const compactFormItemStyle = { marginBottom: 10 };

const STATUS_COLOR: Record<string, string> = {
  pending: 'default', assigned: 'blue', in_progress: 'orange',
  completed: 'green', cancelled: 'red',
};
// 状态文案走 i18n，这里只留「状态 → 文案 key」的映射
const STATUS_LABEL_KEY: Record<string, string> = {
  pending: 'tasks.status_pending', assigned: 'tasks.status_assigned', in_progress: 'tasks.status_in_progress',
  completed: 'tasks.status_completed', cancelled: 'tasks.status_cancelled',
};

function minutesToHM(min: number) {
  if (!min) return '0h 0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

export default function TasksPage() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [workRecord, setWorkRecord] = useState<any>(null);
  const [form] = Form.useForm();
  const [assignForm] = Form.useForm();
  const [searchText, setSearchText] = useState('');

  const loadData = async () => {
    setLoading(true);
    // 各自独立：某个接口失败也不影响任务列表刷新（任务列表用于生成序号）
    const [taskR, driverR, clientR] = await Promise.allSettled([
      tasksApi.list(), usersApi.drivers(), usersApi.clients(),
    ]);
    if (taskR.status === 'fulfilled') setTasks((taskR.value as any) || []);
    if (driverR.status === 'fulfilled') setDrivers((driverR.value as any) || []);
    if (clientR.status === 'fulfilled') setClients((clientR.value as any) || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // 任务名 = 客户名-年月日-当日序号（如 test1-20260627-001）。
  // 序号按「同一客户 + 今天日期」单独递增：不同客户各自从 001 开始。
  // 例：test1-20260628-001、test2-20260628-001。前缀含 -日期- 分隔，避免 test 与 test1 互相命中。
  const genTaskTitle = (clientName: string) => {
    const datePart = dayjs().format('YYYYMMDD');
    const prefix = `${clientName}-${datePart}-`;
    const sameCustomerDay = tasks.filter(
      (t: any) => typeof t?.title === 'string' && t.title.startsWith(prefix),
    ).length;
    return `${prefix}${String(sameCustomerDay + 1).padStart(3, '0')}`;
  };

  const openCreate = () => {
    form.resetFields();
    setCreateOpen(true);
  };

  const handleCreate = async (values: any) => {
    try {
      const { scheduledAt, ...payload } = values;
      const client = clients.find((c: any) => c.id === values.clientId);
      const clientName = client ? (client.fullName || client.username) : '客户';
      await tasksApi.create({
        ...payload,
        title: genTaskTitle(clientName),
        startLocation: '-',
        scheduledAt: scheduledAt?.toISOString(),
      });
      message.success(t('tasks.created'));
      setCreateOpen(false);
      form.resetFields();
      loadData();
    } catch (e: any) {
      message.error(e?.message || t('tasks.create_failed'));
    }
  };

  const handleAssign = async (values: any) => {
    try {
      await tasksApi.assign(selectedTask.id, values.driverId);
      message.success(t('tasks.driver_assigned'));
      setAssignOpen(false);
      assignForm.resetFields();
      loadData();
    } catch (e: any) {
      message.error(e?.message || t('tasks.assign_failed'));
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await tasksApi.cancel(id);
      message.success(t('tasks.cancelled'));
      loadData();
    } catch (e: any) {
      message.error(e?.message || t('tasks.cancel_failed'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await tasksApi.delete(id);
      message.success(t('tasks.deleted'));
      loadData();
    } catch {
      message.error(t('tasks.delete_failed'));
    }
  };

  const openDetail = async (task: any) => {
    setSelectedTask(task);
    setWorkRecord(null);
    setDetailOpen(true);
    if (task.status === 'completed') {
      try {
        const wr: any = await workRecordsApi.byTask(task.id);
        setWorkRecord(wr);
      } catch {
        // no work record yet
      }
    }
  };


  // 未知状态（后端新增而前端还没跟上）直接显示原值，避免空白
  const statusLabel = (s: string) => (STATUS_LABEL_KEY[s] ? t(STATUS_LABEL_KEY[s]) : s);

  const columns = [
    {
      title: t('tasks.f_title'), dataIndex: 'title', key: 'title',
      render: (v: string) => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: t('tasks.f_destination'), key: 'route',
      render: (_: any, r: any) => (
        <Tooltip title={r.endLocation}>
          <div style={{ fontSize: 12 }}>
            <div><EnvironmentOutlined style={{ color: '#ff4d4f', marginRight: 4 }} />{r.endLocation}</div>
          </div>
        </Tooltip>
      ),
    },
    {
      title: t('tasks.f_client'), key: 'client',
      render: (_: any, r: any) => (
        <Space size={4}>
          <UserOutlined style={{ color: '#722ed1' }} />
          <span>{r.client?.fullName || r.client?.username || '-'}</span>
        </Space>
      ),
    },
    {
      title: t('tasks.f_driver'), key: 'driver',
      render: (_: any, r: any) => r.driver ? (
        <Space size={4}>
          <CarOutlined style={{ color: '#1677ff' }} />
          <span>{r.driver.fullName || r.driver.username}</span>
        </Space>
      ) : <Tag>{t('tasks.unassigned')}</Tag>,
    },
    { title: t('tasks.f_cargo'), dataIndex: 'cargo', key: 'cargo', render: (v: string) => v || '-' },
    {
      title: t('tasks.f_scheduled'), dataIndex: 'scheduledAt', key: 'scheduledAt',
      render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-',
    },
    {
      title: t('tasks.f_status'), dataIndex: 'status', key: 'status',
      render: (s: string) => <Tag color={STATUS_COLOR[s]}>{statusLabel(s)}</Tag>,
    },
    {
      title: t('tasks.f_actions'), key: 'actions', width: 240,
      render: (_: any, record: any) => (
        <Space size={20} wrap>
          <Button
            size="small" icon={<EyeOutlined />}
            onClick={() => openDetail(record)}
          >
            {t('tasks.detail')}
          </Button>
          {/* 创建任务时司机是必填，所以任务不会停在 pending。
              已分配但还没开始的任务必须能改派——司机请假、派错人都要靠这个。 */}
          {['pending', 'assigned'].includes(record.status) && (
            <Button
              size="small" type="primary" icon={<CarOutlined />}
              onClick={() => { setSelectedTask(record); setAssignOpen(true); }}
            >
              {record.driverId ? t('tasks.reassign') : t('tasks.assign')}
            </Button>
          )}
          {['pending', 'assigned'].includes(record.status) && (
            <Popconfirm title={t('tasks.confirm_cancel')} onConfirm={() => handleCancel(record.id)}>
              <Button size="small" danger>{t('tasks.cancel')}</Button>
            </Popconfirm>
          )}
          {['completed', 'cancelled'].includes(record.status) && (
            <Popconfirm
              title={t('tasks.confirm_delete')}
              description={t('tasks.confirm_delete_desc')}
              onConfirm={() => handleDelete(record.id)}
              okText={t('tasks.delete')}
              okButtonProps={{ danger: true }}
              cancelText={t('tasks.cancel')}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const filteredTasks = tasks.filter((tk: any) => {
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return [
      tk.title,
      tk.client?.fullName, tk.client?.username, tk.client?.email,
      tk.driver?.fullName, tk.driver?.username,
      tk.endLocation, tk.cargo,
      tk.scheduledAt ? dayjs(tk.scheduledAt).format('YYYY-MM-DD') : '',
      tk.createdAt ? dayjs(tk.createdAt).format('YYYY-MM-DD') : '',
    ].some((v) => String(v || '').toLowerCase().includes(q));
  });

  const exportTasks = () => {
    const rows = filteredTasks.map((tk: any) => ({
      [t('tasks.xls_task')]: tk.title,
      [t('tasks.xls_client')]: tk.client?.fullName || tk.client?.username || '-',
      [t('tasks.xls_driver')]: tk.driver?.fullName || tk.driver?.username || t('tasks.unassigned'),
      [t('tasks.xls_destination')]: tk.endLocation || '-',
      [t('tasks.xls_cargo')]: tk.cargo || '-',
      [t('tasks.xls_weight')]: tk.cargoWeight ?? '-',
      [t('tasks.xls_scheduled')]: tk.scheduledAt ? dayjs(tk.scheduledAt).format('YYYY-MM-DD HH:mm') : '-',
      [t('tasks.xls_status')]: statusLabel(tk.status),
      [t('tasks.xls_created')]: tk.createdAt ? dayjs(tk.createdAt).format('YYYY-MM-DD HH:mm') : '-',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t('tasks.xls_sheet'));
    XLSX.writeFile(wb, `${t('tasks.xls_sheet')}_${dayjs().format('YYYYMMDD')}.xlsx`);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('tasks.title')}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>{t('tasks.subtitle')}</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('tasks.new')}</Button>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder={t('tasks.search_placeholder')}
          allowClear
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 360 }}
        />
        <Button icon={<DownloadOutlined />} onClick={exportTasks}>{t('tasks.export_excel')}</Button>
      </Space>

      <Card bordered={false} styles={{ body: { padding: 0 } }} style={{ borderRadius: 12, overflow: 'hidden' }}>
        <Table
          columns={columns} dataSource={filteredTasks} rowKey="id"
          loading={loading} pagination={{ pageSize: 15 }}
          size="middle"
          locale={{ emptyText: <Empty description={t('tasks.empty')} /> }}
        />
      </Card>

      {/* 任务详情弹窗 */}
      <Modal
        title={t('tasks.detail_title')}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        centered
        width={680}
        footer={<Button onClick={() => setDetailOpen(false)}>{t('tasks.close')}</Button>}
        destroyOnClose
      >
        {selectedTask && (
          <>
            <Descriptions bordered column={2} size="small" style={{ marginBottom: 20 }}>
              <Descriptions.Item label={t('tasks.f_title')} span={2}>
                <Text strong>{selectedTask.title}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('tasks.f_client')}>
                <Space size={4}>
                  <UserOutlined style={{ color: '#722ed1' }} />
                  {selectedTask.client?.fullName || selectedTask.client?.username || '-'}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('tasks.f_client_email')}>
                {selectedTask.client?.email
                  ? <Text copyable>{selectedTask.client.email}</Text>
                  : <Text type="secondary">{t('tasks.not_set')}</Text>}
              </Descriptions.Item>
              <Descriptions.Item label={t('tasks.f_driver')}>
                {selectedTask.driver
                  ? <Space size={4}><CarOutlined style={{ color: '#1677ff' }} />{selectedTask.driver.fullName || selectedTask.driver.username}</Space>
                  : <Tag>{t('tasks.unassigned')}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label={t('tasks.f_status')}>
                <Tag color={STATUS_COLOR[selectedTask.status]}>{statusLabel(selectedTask.status)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('tasks.f_destination')} span={2}>
                <EnvironmentOutlined style={{ color: '#ff4d4f', marginRight: 4 }} />
                {selectedTask.endLocation}
              </Descriptions.Item>
              {selectedTask.cargo && (
                <Descriptions.Item label={t('tasks.f_cargo')}>{selectedTask.cargo}</Descriptions.Item>
              )}
              {selectedTask.cargoWeight && (
                <Descriptions.Item label={t('tasks.f_weight')}>{t('tasks.weight_tons', { value: selectedTask.cargoWeight })}</Descriptions.Item>
              )}
              {selectedTask.scheduledAt && (
                <Descriptions.Item label={t('tasks.f_scheduled')} span={2}>
                  {dayjs(selectedTask.scheduledAt).format('YYYY-MM-DD HH:mm')}
                </Descriptions.Item>
              )}
              {selectedTask.notes && (
                <Descriptions.Item label={t('tasks.f_notes')} span={2}>{selectedTask.notes}</Descriptions.Item>
              )}
            </Descriptions>

            {/* 工时记录 + 照片（已完成任务） */}
            {selectedTask.status === 'completed' && (
              <div>
                <Text strong style={{ fontSize: 14 }}>{t('tasks.hours_and_photos')}</Text>
                {workRecord ? (
                  <>
                    <Descriptions bordered column={2} size="small" style={{ marginTop: 12, marginBottom: 16 }}>
                      <Descriptions.Item label={t('tasks.f_start_time')}>
                        {workRecord.startTime ? dayjs(workRecord.startTime).format('MM-DD HH:mm') : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('tasks.f_end_time')}>
                        {workRecord.endTime ? dayjs(workRecord.endTime).format('MM-DD HH:mm') : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label={t('tasks.f_actual_hours')}>
                        <Tag color="green" style={{ fontWeight: 700 }}>{minutesToHM(workRecord.finalDuration)}</Tag>
                      </Descriptions.Item>
                      {workRecord.completionNotes && (
                        <Descriptions.Item label={t('tasks.f_completion_notes')} span={2}>
                          {workRecord.completionNotes}
                        </Descriptions.Item>
                      )}
                    </Descriptions>

                    <div>
                      <Text style={{ fontSize: 13 }}>
                        <PictureOutlined style={{ marginRight: 6 }} />
                        {t('tasks.completion_photos')}
                        {workRecord.imageUrls?.length > 0 && (
                          <Tag color="purple" style={{ marginLeft: 8 }}>{t('tasks.photo_count', { count: workRecord.imageUrls.length })}</Tag>
                        )}
                      </Text>
                      {workRecord.imageUrls?.length > 0 ? (
                        <div style={{ marginTop: 10 }}>
                          <Image.PreviewGroup>
                            <Space wrap size={8}>
                              {workRecord.imageUrls.map((url: string, i: number) => (
                                <Image
                                  key={i}
                                  src={url}
                                  width={140}
                                  height={140}
                                  style={{ objectFit: 'cover', borderRadius: 8, border: '1px solid #e8e8e8' }}
                                  alt={t('tasks.photo_alt', { index: i + 1 })}
                                  placeholder={
                                    <div style={{ width: 140, height: 140, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <PictureOutlined style={{ fontSize: 24, color: '#bbb' }} />
                                    </div>
                                  }
                                />
                              ))}
                            </Space>
                          </Image.PreviewGroup>
                        </div>
                      ) : (
                        <div style={{ marginTop: 10, padding: '16px', background: '#fafafa', borderRadius: 8, textAlign: 'center' }}>
                          <PictureOutlined style={{ fontSize: 28, color: '#d9d9d9' }} />
                          <div style={{ color: '#999', marginTop: 6, fontSize: 13 }}>{t('tasks.no_photos')}</div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: 10, padding: '16px', background: '#fafafa', borderRadius: 8, textAlign: 'center', color: '#999' }}>
                    {t('tasks.loading_work_record')}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* 创建任务 */}
      <Modal title={t('tasks.new')} open={createOpen} onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        footer={null} width={520} centered styles={compactModalStyles} destroyOnClose>
        <Form form={form} onFinish={handleCreate} layout="vertical" size="small" style={{ paddingTop: 0 }}>

          <Form.Item name="clientId" label={t('tasks.f_client')} style={compactFormItemStyle} rules={[{ required: true, message: t('tasks.client_required') }]}>
            <Select
              showSearch
              placeholder={t('tasks.client_ph')}
              optionFilterProp="label"
              notFoundContent={<Empty description={t('tasks.no_clients')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              options={clients.map((c: any) => ({
                value: c.id,
                label: c.fullName || c.username,
                name: c.fullName || c.username,
              }))}
              optionRender={(opt) => (
                <Space>
                  <UserOutlined style={{ color: '#722ed1' }} />
                  <span>{opt.data.label}</span>
                </Space>
              )}
            />
          </Form.Item>

          {/* 任务名称在提交时按「客户-年月日-序号」自动生成，无需校验 */}
          <Form.Item name="title" hidden>
            <Input />
          </Form.Item>

          <Form.Item name="driverId" label={t('tasks.f_driver')} style={compactFormItemStyle} rules={[{ required: true, message: t('tasks.driver_required') }]}>
            <Select
              showSearch
              placeholder={t('tasks.driver_ph')}
              optionFilterProp="label"
              notFoundContent={<Empty description={t('tasks.no_drivers')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              options={drivers.map((d: any) => ({
                value: d.id,
                label: d.fullName || d.username,
              }))}
              optionRender={(opt) => (
                <Space>
                  <CarOutlined style={{ color: '#1677ff' }} />
                  <span>{opt.data.label}</span>
                </Space>
              )}
            />
          </Form.Item>

          <Form.Item name="endLocation" label={t('tasks.f_destination')} style={compactFormItemStyle} rules={[{ required: true }]}>
            <Input placeholder={t('tasks.destination_ph')} prefix={<EnvironmentOutlined style={{ color: '#ff4d4f' }} />} />
          </Form.Item>

          <Space size={8} style={{ width: '100%' }}>
            <Form.Item name="cargo" label={t('tasks.f_cargo_desc')} style={{ flex: 1, marginBottom: 10 }}>
              <Input placeholder={t('tasks.cargo_ph')} />
            </Form.Item>
            <Form.Item name="cargoWeight" label={t('tasks.f_weight_unit')} style={{ width: 120, marginBottom: 10 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          <Form.Item name="scheduledAt" label={t('tasks.f_scheduled')} style={compactFormItemStyle}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label={t('tasks.f_notes')} style={compactFormItemStyle}>
            <TextArea rows={2} />
          </Form.Item>

          <div style={{ textAlign: 'right', paddingTop: 4 }}>
            <Space size={8}>
              <Button size="small" onClick={() => { setCreateOpen(false); form.resetFields(); }}>{t('tasks.cancel')}</Button>
              <Button size="small" type="primary" htmlType="submit">{t('tasks.create_submit')}</Button>
            </Space>
          </div>
        </Form>
      </Modal>

      {/* 分配司机 */}
      <Modal title={t('tasks.assign_title')} open={assignOpen} onCancel={() => setAssignOpen(false)} footer={null} destroyOnClose centered width={420}>
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f5f5f5', borderRadius: 8 }}>
          <Text type="secondary">{t('tasks.assign_task_label')}</Text>
          <Text strong>{selectedTask?.title}</Text>
        </div>
        <Form form={assignForm} onFinish={handleAssign} layout="vertical">
          <Form.Item name="driverId" label={t('tasks.assign_select_driver')} rules={[{ required: true, message: t('tasks.driver_required') }]}>
            <Select
              showSearch
              placeholder={t('tasks.assign_driver_ph')}
              optionFilterProp="label"
              options={drivers.map((d: any) => ({
                value: d.id,
                label: d.fullName || d.username,
              }))}
              optionRender={(opt) => (
                <Space>
                  <CarOutlined style={{ color: '#1677ff' }} />
                  <span>{opt.data.label}</span>
                </Space>
              )}
            />
          </Form.Item>
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setAssignOpen(false)}>{t('tasks.cancel')}</Button>
              <Button type="primary" htmlType="submit">{t('tasks.assign_confirm')}</Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
