import React, { useCallback, useEffect, useState } from 'react';
import {
  Table, Card, Button, Tag, Space, Modal, Typography, Form, Input, InputNumber,
  Popconfirm, message, Tooltip, Alert, Progress, DatePicker,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ReloadOutlined, CarOutlined,
  FileProtectOutlined, DashboardOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { RootState } from '../../store';
import { vehiclesApi } from '../../api';

const { Title, Text, Paragraph } = Typography;
const AMBER = '#F59E0B';

type Level = 'unknown' | 'ok' | 'warn' | 'critical' | 'exceeded';

type Vehicle = {
  id: string; plate: string; displayPlate: string; label?: string | null; enabled: boolean;
  rucLicenceNo?: string | null; rucStartKm?: number | null; rucEndKm?: number | null; rucPurchasedAt?: string | null;
  odometerKm?: number | null; odometerCalibratedKm?: number | null; odometerCalibratedAt?: string | null;
  level: Level; remainingKm: number | null; avgDailyKm: number;
  projectedDays: number | null; projectedExhaustedAt: string | null; daysSinceCalibration: number | null;
};

// level 本身是后端给的标识，不翻译；只有 label 走 i18n
const LEVEL_META: Record<Level, { color: string; label: string }> = {
  unknown: { color: 'default', label: 'vehicles.levelUnknown' },
  ok: { color: 'green', label: 'vehicles.levelOk' },
  warn: { color: 'gold', label: 'vehicles.levelWarn' },
  critical: { color: 'orange', label: 'vehicles.levelCritical' },
  exceeded: { color: 'red', label: 'vehicles.levelExceeded' },
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};
const km = (v: unknown): string => {
  const n = num(v);
  return n == null ? '—' : `${Math.round(n).toLocaleString()} km`;
};

export default function VehiclesPage() {
  const { t } = useTranslation();
  const { user } = useSelector((s: RootState) => s.auth);
  const isAdmin = user?.role === 'admin';

  const [list, setList] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [rucTarget, setRucTarget] = useState<Vehicle | null>(null);
  const [odoTarget, setOdoTarget] = useState<Vehicle | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [addForm] = Form.useForm();
  const [rucForm] = Form.useForm();
  const [odoForm] = Form.useForm();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data: any = await vehiclesApi.list();
      setList(Array.isArray(data) ? data : []);
    } catch {
      if (!silent) message.error(t('vehicles.loadFailed'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const submit = async (fn: () => Promise<any>, ok: string) => {
    setSubmitting(true);
    try {
      await fn();
      message.success(ok);
      setAddOpen(false); setRucTarget(null); setOdoTarget(null);
      load(true);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || t('vehicles.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const openRuc = (v: Vehicle) => {
    setRucTarget(v);
    const start = num(v.odometerKm) ?? num(v.rucEndKm) ?? 0;
    // 新许可通常从当前里程接着买，按 1000 km 一档预填，省去手算
    rucForm.setFieldsValue({
      licenceNo: '',
      startKm: Math.round(start),
      endKm: Math.round(start) + 1000,
      purchasedAt: dayjs(),
    });
  };

  const openOdo = (v: Vehicle) => {
    setOdoTarget(v);
    odoForm.setFieldsValue({ odometerKm: num(v.odometerKm) ? Math.round(num(v.odometerKm)!) : undefined });
  };

  const columns = [
    {
      title: t('vehicles.colPlate'), key: 'plate', width: 150, fixed: 'left' as const,
      render: (_: any, r: Vehicle) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ letterSpacing: 1 }}>{r.displayPlate}</Text>
          {r.label ? <Text type="secondary" style={{ fontSize: 12 }}>{r.label}</Text> : null}
        </Space>
      ),
    },
    {
      title: t('vehicles.colRucStatus'), key: 'level', width: 130,
      render: (_: any, r: Vehicle) => {
        const meta = LEVEL_META[r.level] || LEVEL_META.unknown;
        return <Tag color={meta.color} style={{ fontWeight: 600 }}>{t(meta.label)}</Tag>;
      },
    },
    {
      title: t('vehicles.colRemaining'), key: 'remaining', width: 190,
      render: (_: any, r: Vehicle) => {
        const remaining = num(r.remainingKm);
        if (remaining == null) {
          return <Text type="secondary">{t('vehicles.noLicence')}</Text>;
        }
        const total = Math.max(1, (num(r.rucEndKm) ?? 0) - (num(r.rucStartKm) ?? 0));
        const used = Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Text strong style={{ color: remaining <= 0 ? '#dc2626' : remaining <= 200 ? '#ea580c' : undefined }}>
              {remaining <= 0 ? t('vehicles.kmOver', { km: Math.abs(Math.round(remaining)) }) : km(remaining)}
            </Text>
            <Progress
              percent={used} size="small" showInfo={false}
              strokeColor={remaining <= 0 ? '#dc2626' : remaining <= 200 ? '#ea580c' : remaining <= 500 ? AMBER : '#22c55e'}
            />
          </Space>
        );
      },
    },
    {
      title: t('vehicles.colProjected'), key: 'projected', width: 150,
      render: (_: any, r: Vehicle) => {
        const days = num(r.projectedDays);
        if (days == null) {
          return <Text type="secondary" style={{ fontSize: 12 }}>{t('vehicles.notEnoughData')}</Text>;
        }
        return (
          <Space direction="vertical" size={0}>
            <Text>{t('vehicles.inDays', { n: Math.floor(days) })}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.projectedExhaustedAt ? dayjs(r.projectedExhaustedAt).format('MM-DD') : ''}
              {r.avgDailyKm > 0 ? ` · ${t('vehicles.kmPerDay', { n: Math.round(r.avgDailyKm) })}` : ''}
            </Text>
          </Space>
        );
      },
    },
    {
      title: t('vehicles.colOdometer'), key: 'odo', width: 180,
      render: (_: any, r: Vehicle) => {
        const stale = (r.daysSinceCalibration ?? 999) > 30 || r.daysSinceCalibration == null;
        return (
          <Space direction="vertical" size={0}>
            <Text>{km(r.odometerKm)}</Text>
            <Tooltip title={t('vehicles.odoTip')}>
              <Text type={stale ? 'warning' : 'secondary'} style={{ fontSize: 12 }}>
                {r.daysSinceCalibration == null
                  ? t('vehicles.neverCalibrated')
                  : t('vehicles.calibratedDaysAgo', { n: r.daysSinceCalibration })}
              </Text>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: t('vehicles.colLicence'), key: 'licence', width: 190,
      render: (_: any, r: Vehicle) => num(r.rucEndKm) == null ? <Text type="secondary">—</Text> : (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 13 }}>{km(r.rucStartKm)} → {km(r.rucEndKm)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.rucLicenceNo || t('vehicles.noLicenceNo')}
            {r.rucPurchasedAt ? ` · ${dayjs(r.rucPurchasedAt).format('YYYY-MM-DD')}` : ''}
          </Text>
        </Space>
      ),
    },
    {
      // 表格里的按钮用短标签，完整说法放 tooltip：
      // 英文的 "Record licence" / "Calibrate odometer" 比中文长得多，
      // 挤在一列里会折成两行，整张表的行高跟着乱掉
      title: t('vehicles.colActions'), key: 'actions', width: 190,
      render: (_: any, r: Vehicle) => (
        <Space size={4} wrap={false}>
          <Tooltip title={t('vehicles.btnRecordLicence')}>
            <Button size="small" type="primary" ghost icon={<FileProtectOutlined />} onClick={() => openRuc(r)}>
              {t('vehicles.btnRecordLicenceShort')}
            </Button>
          </Tooltip>
          <Tooltip title={t('vehicles.btnCalibrate')}>
            <Button size="small" icon={<DashboardOutlined />} onClick={() => openOdo(r)}>
              {t('vehicles.btnCalibrateShort')}
            </Button>
          </Tooltip>
          {isAdmin && (
            <Popconfirm
              title={t('vehicles.deleteConfirm')}
              onConfirm={() => submit(() => vehiclesApi.delete(r.id), t('vehicles.deleted'))}
              okText={t('vehicles.delete')} okButtonProps={{ danger: true }} cancelText={t('vehicles.cancel')}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const needAttention = list.filter((v) => v.level === 'warn' || v.level === 'critical' || v.level === 'exceeded');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <CarOutlined style={{ marginRight: 8, color: AMBER }} />
          {t('vehicles.title')}
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>{t('vehicles.refresh')}</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { addForm.resetFields(); setAddOpen(true); }}>
            {t('vehicles.add')}
          </Button>
        </Space>
      </div>

      {needAttention.length > 0 && (
        <Alert
          type={needAttention.some((v) => v.level === 'exceeded') ? 'error' : 'warning'}
          showIcon icon={<WarningOutlined />} style={{ marginBottom: 16, borderRadius: 10 }}
          message={t('vehicles.attentionTitle', { n: needAttention.length })}
          description={
            <Space wrap size={[8, 4]}>
              {needAttention.map((v) => (
                <Tag key={v.id} color={LEVEL_META[v.level].color}>
                  <Text strong>{v.displayPlate}</Text>
                  <Text style={{ marginLeft: 6, fontSize: 12 }}>
                    {(num(v.remainingKm) ?? 0) <= 0
                      ? t('vehicles.kmOver', { km: Math.abs(Math.round(num(v.remainingKm) ?? 0)) })
                      : t('vehicles.kmLeft', { km: Math.round(num(v.remainingKm) ?? 0) })}
                  </Text>
                </Tag>
              ))}
            </Space>
          }
        />
      )}

      <Alert
        type="info" showIcon style={{ marginBottom: 16, borderRadius: 10 }}
        message={t('vehicles.infoTitle')}
        description={t('vehicles.infoDesc')}
      />

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Table
          columns={columns} dataSource={list} rowKey="id" loading={loading}
          pagination={{ pageSize: 20 }} scroll={{ x: 1100 }}
          locale={{ emptyText: t('vehicles.emptyText') }}
        />
      </Card>

      {/* 登记车辆 */}
      <Modal
        title={t('vehicles.add')} open={addOpen} onCancel={() => setAddOpen(false)}
        onOk={async () => {
          const v = await addForm.validateFields();
          submit(() => vehiclesApi.create(v), t('vehicles.added'));
        }}
        confirmLoading={submitting} okText={t('vehicles.okAdd')} cancelText={t('vehicles.cancel')}
        centered width={420} forceRender
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            name="plate" label={t('vehicles.fieldPlate')}
            rules={[{ required: true, message: t('vehicles.plateRequired') }]}
            extra={t('vehicles.plateExtra')}
          >
            <Input placeholder="ABC123" maxLength={32} style={{ textTransform: 'uppercase' }} />
          </Form.Item>
          <Form.Item name="label" label={t('vehicles.fieldLabel')}>
            <Input placeholder={t('vehicles.labelPlaceholder')} maxLength={128} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 登记 RUC 许可 */}
      <Modal
        title={t('vehicles.rucModalTitle', { plate: rucTarget?.displayPlate ?? '' })}
        open={!!rucTarget} onCancel={() => setRucTarget(null)}
        onOk={async () => {
          const v = await rucForm.validateFields();
          submit(() => vehiclesApi.recordLicence(rucTarget!.id, {
            licenceNo: v.licenceNo,
            startKm: v.startKm,
            endKm: v.endKm,
            purchasedAt: v.purchasedAt ? v.purchasedAt.toISOString() : undefined,
          }), t('vehicles.licenceRecorded'));
        }}
        confirmLoading={submitting} okText={t('vehicles.save')} cancelText={t('vehicles.cancel')}
        centered width={460} forceRender
      >
        <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          {t('vehicles.rucModalHint')}
        </Paragraph>
        <Form form={rucForm} layout="vertical">
          <Form.Item name="licenceNo" label={t('vehicles.fieldLicenceNo')}>
            <Input placeholder={t('vehicles.optional')} maxLength={64} />
          </Form.Item>
          <Form.Item
            name="startKm" label={t('vehicles.fieldStartKm')}
            rules={[{ required: true, message: t('vehicles.required') }]}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={1000} />
          </Form.Item>
          <Form.Item
            name="endKm" label={t('vehicles.fieldEndKm')}
            rules={[
              { required: true, message: t('vehicles.required') },
              ({ getFieldValue }) => ({
                validator: (_, value) => value > getFieldValue('startKm')
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('vehicles.endGreaterThanStart'))),
              }),
            ]}
            extra={t('vehicles.endKmExtra')}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={1000} />
          </Form.Item>
          <Form.Item name="purchasedAt" label={t('vehicles.fieldPurchasedAt')}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 校准里程 */}
      <Modal
        title={t('vehicles.odoModalTitle', { plate: odoTarget?.displayPlate ?? '' })}
        open={!!odoTarget} onCancel={() => setOdoTarget(null)}
        onOk={async () => {
          const v = await odoForm.validateFields();
          submit(() => vehiclesApi.calibrate(odoTarget!.id, v.odometerKm), t('vehicles.calibrated'));
        }}
        confirmLoading={submitting} okText={t('vehicles.save')} cancelText={t('vehicles.cancel')}
        centered width={420} forceRender
      >
        <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          {t('vehicles.odoModalHint')}
        </Paragraph>
        <Form form={odoForm} layout="vertical">
          <Form.Item
            name="odometerKm" label={t('vehicles.fieldCurrentKm')}
            rules={[{ required: true, message: t('vehicles.required') }]}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={100} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
