import React, { useEffect, useState } from 'react';
import {
  Table, Card, Button, Tag, Space, Modal, Typography, Image,
  Input, Popconfirm, Descriptions, Select, DatePicker, message,
} from 'antd';
import {
  EyeOutlined, DeleteOutlined, PictureOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { workRecordsApi, adjustmentsApi, usersApi } from '../../api';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

function minutesToHM(min: number) {
  if (!min) return '0h0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m}m`;
}

// 默认工时调整量（在系统设置里配置：30 或 60 分钟）
// 最终工时以服务器为准：后端在 applyAdjustment/setFinalDuration 里维护
// finalDuration = systemDuration + adjustmentTime，任务详情、司机端、客户端读的都是它。
//
// 这里原本是 systemDuration + localStorage 里的默认调整值，后果有两个：
// 管理员真正做过的工时调整在本页和工资导出里完全不体现；
// 两台电脑上的默认值不同，同一条记录在两个人屏幕上是两个数字。
function finalMinutesOf(record: any): number {
  const stored = Number(record?.finalDuration);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return Number(record?.systemDuration) || 0;
}

export default function WorkRecordsPage() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filterDriver, setFilterDriver] = useState<string>('all');
  const [dateRange, setDateRange] = useState<any>(null);

  const loadData = async () => {
    setLoading(true);
    const [list, drv]: any = await Promise.all([workRecordsApi.list(), usersApi.drivers()]);
    setRecords(list || []);
    setDrivers(Array.isArray(drv) ? drv : []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const loadLogs = async (record: any) => {
    setSelected(record);
    const data: any = await adjustmentsApi.logs({ taskId: record.taskId });
    setLogs(data || []);
    setLogsOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await workRecordsApi.delete(id);
      message.success(t('workRecords.deleted'));
      loadData();
    } catch {
      message.error(t('workRecords.delete_failed'));
    }
  };

  const openDetail = (record: any) => {
    setSelected(record);
    setDetailOpen(true);
  };

  const hasRange = !!(dateRange && dateRange[0] && dateRange[1]);
  const inRange = (record: any) => {
    if (!hasRange) return true;
    const base = record.startTime || record.createdAt;
    if (!base) return false;
    const d = dayjs(base);
    const start = dateRange[0].startOf('day');
    const end = dateRange[1].endOf('day');
    return !d.isBefore(start) && !d.isAfter(end);
  };

  const filteredRecords = records.filter((r) => {
    if (filterDriver !== 'all' && r.driverId !== filterDriver) return false;
    if (!inRange(r)) return false;
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return [
      r.driver?.fullName, r.driver?.username,
      r.task?.title, r.task?.vehiclePlate,
      r.task?.client?.fullName, r.task?.client?.username,
    ].some((v) => String(v || '').toLowerCase().includes(q));
  });

  // 选了日期范围后，按司机汇总工时（用于算工资）
  const summary: any[] = !hasRange ? [] : (() => {
    const map: Record<string, any> = {};
    filteredRecords.forEach((r) => {
      const key = r.driverId;
      if (!map[key]) map[key] = { key, driver: r.driver?.fullName || r.driver?.username || '-', gpsMinutes: 0, finalMinutes: 0, count: 0 };
      map[key].gpsMinutes += (r.systemDuration || 0);
      map[key].finalMinutes += finalMinutesOf(r);
      map[key].count += 1;
    });
    return Object.values(map).sort((a: any, b: any) => b.finalMinutes - a.finalMinutes);
  })();

  const rangeLabel = hasRange ? `${dateRange[0].format('YYYY-MM-DD')} ~ ${dateRange[1].format('YYYY-MM-DD')}` : '';

  const exportRecords = () => {
    const rows = filteredRecords.map((r) => ({
      [t('workRecords.xls_driver')]: r.driver?.fullName || r.driver?.username || '-',
      [t('workRecords.xls_client')]: r.task?.client?.fullName || r.task?.client?.username || '-',
      [t('workRecords.xls_task')]: r.task?.title || '-',
      [t('workRecords.xls_plate')]: r.task?.vehiclePlate || '-',
      [t('workRecords.xls_gps_start')]: r.startTime ? dayjs(r.startTime).format('YYYY-MM-DD HH:mm') : '-',
      [t('workRecords.xls_gps_end')]: r.endTime ? dayjs(r.endTime).format('YYYY-MM-DD HH:mm') : '-',
      [t('workRecords.xls_gps_hours')]: minutesToHM(r.systemDuration || 0),
      [t('workRecords.xls_final')]: minutesToHM(finalMinutesOf(r)),
      [t('workRecords.xls_minutes')]: finalMinutesOf(r),
      [t('workRecords.xls_anomaly')]: r.anomalyFlag ? t('workRecords.anomaly_yes') : t('workRecords.anomaly_no'),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t('workRecords.xls_sheet'));
    XLSX.writeFile(wb, `${t('workRecords.xls_sheet')}_${dayjs().format('YYYYMMDD')}.xlsx`);
  };

  const exportSummary = () => {
    const rows = summary.map((s) => ({
      [t('workRecords.xls_driver')]: s.driver,
      [t('workRecords.xls_date_range')]: rangeLabel,
      [t('workRecords.xls_task_count')]: s.count,
      [t('workRecords.xls_gps_total')]: minutesToHM(s.gpsMinutes),
      [t('workRecords.xls_final')]: minutesToHM(s.finalMinutes),
      [t('workRecords.xls_gps_minutes')]: s.gpsMinutes,
      [t('workRecords.xls_final_minutes')]: s.finalMinutes,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t('workRecords.xls_summary_sheet'));
    XLSX.writeFile(wb, `${t('workRecords.xls_summary_sheet')}_${rangeLabel.replace(/ /g, '')}.xlsx`);
  };

  const columns = [
    { title: t('workRecords.f_driver'), key: 'driver', render: (_: any, r: any) => r.driver?.fullName || r.driver?.username || '-' },
    { title: t('workRecords.f_task'), key: 'task', render: (_: any, r: any) => r.task?.title || '-' },
    {
      title: t('workRecords.f_plate'), key: 'plate', align: 'center' as const,
      render: (_: any, r: any) => r.task?.vehiclePlate
        ? <Tag color="orange" style={{ fontWeight: 700, margin: 0 }}>{r.task.vehiclePlate}</Tag>
        : <Text type="secondary" style={{ fontSize: 12 }}>-</Text>,
    },
    { title: t('workRecords.f_gps_start'), dataIndex: 'startTime', key: 'startTime', render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-' },
    { title: t('workRecords.f_gps_end'), dataIndex: 'endTime', key: 'endTime', render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-' },
    { title: t('workRecords.f_gps_hours'), dataIndex: 'systemDuration', key: 'systemDuration', render: (v: number) => <Tag color="blue">{minutesToHM(v)}</Tag> },
    { title: t('final_duration'), key: 'finalDuration', render: (_: any, r: any) => <Tag color="green" style={{ fontWeight: 700 }}>{minutesToHM(finalMinutesOf(r))}</Tag> },
    {
      title: t('workRecords.f_photos'), key: 'photos',
      render: (_: any, r: any) => {
        const count = r.imageUrls?.length || 0;
        return count > 0
          ? <Tag color="purple" icon={<PictureOutlined />}>{t('workRecords.photo_count', { count })}</Tag>
          : <Text type="secondary" style={{ fontSize: 12 }}>{t('workRecords.none')}</Text>;
      },
    },
    { title: t('workRecords.f_anomaly'), dataIndex: 'anomalyFlag', key: 'anomalyFlag', render: (v: boolean) => v ? <Tag color="red">{t('workRecords.anomaly_yes')}</Tag> : <Tag color="green">{t('workRecords.anomaly_no')}</Tag> },
    {
      title: t('operation'), key: 'actions',
      render: (_: any, record: any) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>{t('workRecords.detail')}</Button>
          <Button size="small" type="link" onClick={() => loadLogs(record)}>{t('workRecords.log')}</Button>
          <Popconfirm title={t('workRecords.confirm_delete')} description={t('workRecords.confirm_delete_desc')} onConfirm={() => handleDelete(record.id)} okText={t('workRecords.delete')} okButtonProps={{ danger: true }} cancelText={t('workRecords.cancel')}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>{t('work_records')}</Title>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder={t('workRecords.search_placeholder')}
          allowClear
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 300 }}
        />
        <Select
          value={filterDriver}
          onChange={setFilterDriver}
          style={{ width: 170 }}
          showSearch
          optionFilterProp="label"
          options={[{ value: 'all', label: t('workRecords.all_drivers') }, ...drivers.map((d: any) => ({ value: d.id, label: d.fullName || d.username }))]}
        />
        <DatePicker.RangePicker value={dateRange} onChange={setDateRange} placeholder={[t('workRecords.start_date'), t('workRecords.end_date')]} />
        <Button icon={<DownloadOutlined />} onClick={exportRecords}>{t('workRecords.export_details')}</Button>
      </Space>

      {hasRange && (
        <Card
          bordered={false}
          style={{ borderRadius: 12, marginBottom: 16 }}
          title={t('workRecords.payroll_title', { range: rangeLabel })}
          extra={<Button size="small" icon={<DownloadOutlined />} onClick={exportSummary}>{t('workRecords.export_summary')}</Button>}
        >
          <Table
            size="small"
            rowKey="key"
            dataSource={summary}
            pagination={false}
            locale={{ emptyText: t('workRecords.summary_empty') }}
            columns={[
              { title: t('workRecords.f_driver'), dataIndex: 'driver', key: 'driver' },
              { title: t('workRecords.f_task_count'), dataIndex: 'count', key: 'count' },
              { title: t('workRecords.f_gps_total'), key: 'gps', render: (_: any, s: any) => <Tag color="blue" style={{ fontWeight: 700, fontSize: 14 }}>{minutesToHM(s.gpsMinutes)}</Tag> },
              { title: t('workRecords.f_final'), key: 'final', render: (_: any, s: any) => <Tag color="green" style={{ fontWeight: 700, fontSize: 14 }}>{minutesToHM(s.finalMinutes)}</Tag> },
            ]}
          />
        </Card>
      )}

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Table columns={columns} dataSource={filteredRecords} rowKey="id" loading={loading} pagination={{ pageSize: 15 }} scroll={{ x: 1100 }} />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        title={t('workRecords.detail_title')}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button onClick={() => setDetailOpen(false)}>{t('workRecords.close')}</Button>}
        centered
        width={680}
        destroyOnClose
      >
        {selected && (
          <>
            <Descriptions bordered column={2} size="small" style={{ marginBottom: 20 }}>
              <Descriptions.Item label={t('workRecords.f_driver')} span={1}>{selected.driver?.fullName || selected.driver?.username || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('workRecords.f_plate')} span={1}>
                {selected.task?.vehiclePlate ? <Tag color="orange" style={{ fontWeight: 700 }}>{selected.task.vehiclePlate}</Tag> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('workRecords.f_task')} span={2}>{selected.task?.title || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('workRecords.f_destination')} span={2}>{selected.task?.endLocation || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('workRecords.f_gps_start')}>{selected.startTime ? dayjs(selected.startTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              <Descriptions.Item label={t('workRecords.f_gps_end')}>{selected.endTime ? dayjs(selected.endTime).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
              <Descriptions.Item label={t('workRecords.f_gps_hours')}><Tag color="blue">{minutesToHM(selected.systemDuration)}</Tag></Descriptions.Item>
              {/* 显示这条记录实际被调整了多少分钟（后端 adjustmentTime），而不是本机的默认值 */}
              <Descriptions.Item label={t('workRecords.f_adjustment')}>
                <Tag color={Number(selected.adjustmentTime) ? 'orange' : 'default'}>
                  {Number(selected.adjustmentTime)
                    ? `${Number(selected.adjustmentTime) > 0 ? '+' : '-'}${minutesToHM(Math.abs(Number(selected.adjustmentTime)))}`
                    : t('workRecords.no_adjustment')}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('workRecords.f_final')} span={2}><Tag color="green" style={{ fontWeight: 700 }}>{minutesToHM(finalMinutesOf(selected))}</Tag></Descriptions.Item>
              <Descriptions.Item label={t('workRecords.f_anomaly')} span={2}>{selected.anomalyFlag ? <Tag color="red">{t('workRecords.anomaly_yes')}</Tag> : <Tag color="green">{t('workRecords.anomaly_no')}</Tag>}</Descriptions.Item>
              {selected.completionNotes && (<Descriptions.Item label={t('workRecords.f_completion_notes')} span={2}>{selected.completionNotes}</Descriptions.Item>)}
            </Descriptions>

            <div>
              <Text strong style={{ fontSize: 14 }}>
                <PictureOutlined style={{ marginRight: 6 }} />
                {t('workRecords.completion_photos')}
                {selected.imageUrls?.length > 0 && (<Tag color="purple" style={{ marginLeft: 8 }}>{t('workRecords.photo_count', { count: selected.imageUrls.length })}</Tag>)}
              </Text>
              {selected.imageUrls?.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <Image.PreviewGroup>
                    <Space wrap size={10}>
                      {selected.imageUrls.map((url: string, i: number) => (
                        <Image
                          key={i}
                          src={url}
                          width={150}
                          height={150}
                          style={{ objectFit: 'cover', borderRadius: 8, border: '1px solid #e8e8e8' }}
                          alt={t('workRecords.photo_alt', { index: i + 1 })}
                          placeholder={
                            <div style={{ width: 150, height: 150, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <PictureOutlined style={{ fontSize: 24, color: '#bbb' }} />
                            </div>
                          }
                        />
                      ))}
                    </Space>
                  </Image.PreviewGroup>
                </div>
              ) : (
                <div style={{ marginTop: 12, padding: '20px', background: '#fafafa', borderRadius: 8, textAlign: 'center' }}>
                  <PictureOutlined style={{ fontSize: 32, color: '#d9d9d9' }} />
                  <div style={{ color: '#999', marginTop: 8, fontSize: 13 }}>{t('workRecords.no_photos')}</div>
                </div>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* 调整日志 */}
      <Modal title={t('workRecords.logs_title')} open={logsOpen} onCancel={() => setLogsOpen(false)} footer={null} centered width={600}>
        <Table
          size="small"
          dataSource={logs}
          rowKey="id"
          columns={[
            { title: t('workRecords.f_log_amount'), dataIndex: 'addedMinutes', key: 'addedMinutes', render: (v: number) => `+${minutesToHM(Math.abs(v))}` },
            { title: t('workRecords.f_log_reason'), dataIndex: 'reason', key: 'reason', render: (v: string) => v || t('workRecords.log_reason_default') },
            { title: t('workRecords.f_log_operator'), key: 'operator', render: (_: any, r: any) => r.operator?.fullName || r.operator?.username },
            { title: t('workRecords.f_log_time'), dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
          ]}
        />
      </Modal>
    </div>
  );
}
