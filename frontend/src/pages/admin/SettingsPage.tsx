import React, { useEffect, useState } from 'react';
import { Card, Button, Modal, Table, Tag, Typography, Form, Input, InputNumber, message, Empty, Alert } from 'antd';
import { FileTextOutlined, KeyOutlined, ReloadOutlined, GlobalOutlined, ClockCircleOutlined, AlertOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { RootState } from '../../store';
import { operationLogsApi, usersApi, systemSettingsApi } from '../../api';

const { Title, Text } = Typography;
const AMBER = '#F59E0B';

// 统一的设置卡片：flex 布局，文字列 flex:1 + minWidth:0，内容永远不会溢出卡片
function SettingCard({
  icon, color, title, desc, onClick, children, span, titleColor, borderColor,
}: {
  icon: React.ReactNode; color: string; title: string; desc: string;
  onClick?: () => void; children?: React.ReactNode; span?: boolean;
  titleColor?: string; borderColor?: string;
}) {
  return (
    <Card
      hoverable={!!onClick}
      bordered={false}
      onClick={onClick}
      style={{
        borderRadius: 12,
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        gridColumn: span ? '1 / -1' : undefined,
        border: borderColor ? `1px solid ${borderColor}` : undefined,
      }}
      styles={{ body: { padding: 18 } }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10, flexShrink: 0,
          background: `${color}1f`, color, fontSize: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Title level={5} style={{ margin: 0, color: titleColor, lineHeight: 1.35 }}>{title}</Title>
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6, display: 'block', marginTop: 6 }}>
            {desc}
          </Text>
          {children}
        </div>
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  // 操作日志 + 清空数据：仅管理员可见；调度员无此权限
  const isAdmin = useSelector((s: RootState) => s.auth.user?.role) === 'admin';
  const setLang = (lng: 'zh' | 'en') => {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
  };
  const [logsOpen, setLogsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [form] = Form.useForm();
  // Default time adjustment: a server setting (work_adjust_minutes) the backend applies to every job on
  // completion. It used to live only in this browser's localStorage, where nothing could act on it.
  const [adjustDefault, setAdjustDefault] = useState<number>(30);
  const adjustLabel = (v: number) => (v === 60 ? t('settings.adjust_hour') : v === 0 ? t('settings.adjust_none') : t('settings.adjust_half_hour'));
  const saveAdjustDefault = async (v: number) => {
    try {
      await systemSettingsApi.update({ work_adjust_minutes: String(v) });
      setAdjustDefault(v);
      message.success(t('settings.adjust_saved', { value: adjustLabel(v) }));
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || t('settings.save_failed'));
    }
  };

  // GPS 报警 + 清空数据（后端 system-settings）
  const [gpsForm] = Form.useForm();
  const [gpsSaving, setGpsSaving] = useState(false);
  const [pwdSet, setPwdSet] = useState(false); // 是否已设置清空数据密码
  const [pwdInput, setPwdInput] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearPwd, setClearPwd] = useState('');
  const [clearLoading, setClearLoading] = useState(false);

  const loadSettings = async () => {
    try {
      const s: any = await systemSettingsApi.get();
      gpsForm.setFieldsValue({
        gps_stationary_minutes: Number(s.gps_stationary_minutes) || 15,
        gps_alarm_repeat: Number(s.gps_alarm_repeat) || 3,
        gps_alarm_delay_minutes: Number(s.gps_alarm_delay_minutes) || 10,
        gps_stationary_radius_m: Number(s.gps_stationary_radius_m) || 80,
      });
      setPwdSet(!!s.clear_data_password_set);
      const adj = Number(s.work_adjust_minutes);
      setAdjustDefault(adj === 60 || adj === 0 ? adj : 30);
    } catch {
      /* 忽略加载失败 */
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const saveGps = async () => {
    const v = await gpsForm.validateFields();
    setGpsSaving(true);
    try {
      await systemSettingsApi.update({
        gps_stationary_minutes: String(v.gps_stationary_minutes),
        gps_alarm_repeat: String(v.gps_alarm_repeat),
        gps_alarm_delay_minutes: String(v.gps_alarm_delay_minutes),
        gps_stationary_radius_m: String(v.gps_stationary_radius_m),
      });
      message.success(t('settings.gps_saved'));
    } catch (e: any) {
      message.error(e?.message || t('settings.save_failed'));
    } finally {
      setGpsSaving(false);
    }
  };

  const saveClearPwd = async () => {
    if (!pwdInput || pwdInput.length < 4) {
      message.error(t('settings.clear_pwd_min'));
      return;
    }
    setPwdSaving(true);
    try {
      await systemSettingsApi.update({ clear_data_password: pwdInput });
      message.success(t('settings.clear_pwd_saved'));
      setPwdInput('');
      setPwdSet(true);
    } catch (e: any) {
      message.error(e?.message || t('settings.save_failed'));
    } finally {
      setPwdSaving(false);
    }
  };

  const handleClearData = async () => {
    setClearLoading(true);
    try {
      await systemSettingsApi.clearData(clearPwd);
      message.success(t('settings.clear_done'));
      setClearOpen(false);
      setClearPwd('');
    } catch (e: any) {
      message.error(e?.message || t('settings.clear_failed'));
    } finally {
      setClearLoading(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const data: any = await operationLogsApi.list({ limit: 100 });
      setLogs(Array.isArray(data) ? data : []);
    } catch (error: any) {
      message.error(error?.message || t('settings.logs_load_failed'));
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (logsOpen) loadLogs();
  }, [logsOpen]);

  const handlePasswordSave = async (values: any) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error(t('settings.pwd_mismatch'));
      return;
    }
    setPasswordLoading(true);
    try {
      await usersApi.changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      message.success(t('settings.pwd_updated'));
      form.resetFields();
      setPasswordOpen(false);
    } catch (error: any) {
      message.error(error?.message || t('settings.pwd_update_failed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const columns = [
    {
      title: t('settings.log_time'),
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: t('settings.log_actor'),
      dataIndex: 'actorName',
      width: 160,
      render: (value: string, record: any) => value || record.actor?.username || '-',
    },
    {
      title: t('settings.log_action'),
      dataIndex: 'action',
      width: 180,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: t('settings.log_target'),
      width: 150,
      render: (_: unknown, record: any) => (
        <Text type="secondary">
          {[record.targetType, record.targetId].filter(Boolean).join(': ') || '-'}
        </Text>
      ),
    },
    {
      title: t('settings.log_description'),
      dataIndex: 'description',
      render: (value: string) => value || '-',
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>{t('settings.title')}</Title>
        <Text type="secondary">{t('settings.subtitle')}</Text>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, alignItems: 'stretch' }}>
        {isAdmin && (
          <SettingCard
            icon={<FileTextOutlined />} color={AMBER}
            title={t('settings.logs_title')} desc={t('settings.logs_desc')}
            onClick={() => setLogsOpen(true)}
          />
        )}

        <SettingCard
          icon={<KeyOutlined />} color={AMBER}
          title={t('settings.password_title')} desc={t('settings.password_desc')}
          onClick={() => setPasswordOpen(true)}
        />

        <SettingCard
          icon={<GlobalOutlined />} color={AMBER}
          title={t('settings.language_title')} desc={t('settings.language_desc')}
        >
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type={i18n.language === 'zh' ? 'primary' : 'default'} size="small" onClick={() => setLang('zh')}>{t('settings.lang_zh')}</Button>
            <Button type={i18n.language === 'en' ? 'primary' : 'default'} size="small" onClick={() => setLang('en')}>{t('settings.lang_en')}</Button>
          </div>
        </SettingCard>

        {/* Admin only: the settings endpoint refuses dispatchers */}
        {isAdmin && (
          <SettingCard
            icon={<ClockCircleOutlined />} color={AMBER}
            title={t('settings.adjust_title')} desc={t('settings.adjust_desc')}
          >
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button type={adjustDefault === 0 ? 'primary' : 'default'} size="small" onClick={() => saveAdjustDefault(0)}>{t('settings.adjust_0')}</Button>
              <Button type={adjustDefault === 30 ? 'primary' : 'default'} size="small" onClick={() => saveAdjustDefault(30)}>{t('settings.adjust_30')}</Button>
              <Button type={adjustDefault === 60 ? 'primary' : 'default'} size="small" onClick={() => saveAdjustDefault(60)}>{t('settings.adjust_60')}</Button>
            </div>
          </SettingCard>
        )}

        {/* GPS 异常报警设置 —— 整个 SystemSettingsController 都是 @Roles(ADMIN)，
            调度员看到这张卡也只会填完再吃一个「权限不足」，所以和操作日志、清空数据一样只给管理员 */}
        {isAdmin && (
        <SettingCard
          span
          icon={<AlertOutlined />} color="#ef4444"
          title={t('settings.gps_title')}
          desc={t('settings.gps_desc')}
        >
          <Form form={gpsForm} layout="vertical" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 20px', alignItems: 'flex-end' }}>
              <Form.Item name="gps_stationary_minutes" label={t('settings.gps_stationary_minutes')} rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <InputNumber min={1} max={240} addonAfter={t('settings.unit_minutes')} style={{ width: 130 }} />
              </Form.Item>
              <Form.Item name="gps_stationary_radius_m" label={t('settings.gps_radius')} rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <InputNumber min={20} max={2000} step={10} addonAfter={t('settings.unit_meters')} style={{ width: 130 }} />
              </Form.Item>
              <Form.Item name="gps_alarm_delay_minutes" label={t('settings.gps_delay')} rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <InputNumber min={1} max={120} addonAfter={t('settings.unit_minutes')} style={{ width: 130 }} />
              </Form.Item>
              <Form.Item name="gps_alarm_repeat" label={t('settings.gps_repeat')} rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                <InputNumber min={1} max={10} addonAfter={t('settings.unit_times')} style={{ width: 110 }} />
              </Form.Item>
              <Form.Item label=" " colon={false} style={{ marginBottom: 12 }}>
                <Button type="primary" onClick={saveGps} loading={gpsSaving}>{t('settings.save')}</Button>
              </Form.Item>
            </div>
          </Form>
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {t('settings.gps_note')}
          </Text>
        </SettingCard>
        )}

        {/* 清空数据（危险操作）—— 仅管理员 */}
        {isAdmin && (
        <SettingCard
          span
          icon={<DeleteOutlined />} color="#ef4444"
          title={t('settings.clear_title')} titleColor="#cf1322" borderColor="#ffccc7"
          desc={t('settings.clear_desc')}
        >
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
            <div>
              <Text style={{ fontSize: 13 }}>{t('settings.clear_pwd_label')} {pwdSet && <Tag color="green" style={{ marginLeft: 6 }}>{t('settings.clear_pwd_set_tag')}</Tag>}</Text>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Input.Password
                  placeholder={pwdSet ? t('settings.clear_pwd_ph_change') : t('settings.clear_pwd_ph_new')}
                  value={pwdInput}
                  onChange={(e) => setPwdInput(e.target.value)}
                  style={{ width: 220 }}
                />
                <Button onClick={saveClearPwd} loading={pwdSaving}>{t('settings.clear_pwd_save')}</Button>
              </div>
            </div>
            <Button danger type="primary" icon={<DeleteOutlined />} disabled={!pwdSet} onClick={() => setClearOpen(true)}>
              {t('settings.clear_title')}
            </Button>
          </div>
        </SettingCard>
        )}
      </div>

      <Modal
        title={t('settings.logs_title')}
        open={logsOpen}
        onCancel={() => setLogsOpen(false)}
        footer={[
          <Button key="refresh" icon={<ReloadOutlined />} onClick={loadLogs} loading={logsLoading}>
            {t('settings.refresh')}
          </Button>,
          <Button key="close" onClick={() => setLogsOpen(false)}>{t('settings.close')}</Button>,
        ]}
        width={980}
        centered
      >
        <Table
          rowKey="id"
          loading={logsLoading}
          columns={columns}
          dataSource={logs}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description={t('settings.logs_empty')} /> }}
          scroll={{ x: 850 }}
        />
      </Modal>

      <Modal
        title={t('settings.password_title')}
        open={passwordOpen}
        onCancel={() => setPasswordOpen(false)}
        footer={null}
        centered
        width={420}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handlePasswordSave}>
          <Form.Item name="oldPassword" label={t('settings.old_password')} rules={[{ required: true, message: t('settings.old_password_required') }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="newPassword" label={t('settings.new_password')} rules={[{ required: true, message: t('settings.new_password_required') }, { min: 8, message: t('settings.password_min8') }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="confirmPassword" label={t('settings.confirm_password')} rules={[{ required: true, message: t('settings.confirm_password_required') }]}>
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={passwordLoading}>
            {t('settings.update_password')}
          </Button>
        </Form>
      </Modal>

      <Modal
        title={<span style={{ color: '#cf1322' }}><DeleteOutlined /> {t('settings.clear_confirm_title')}</span>}
        open={clearOpen}
        onCancel={() => { setClearOpen(false); setClearPwd(''); }}
        onOk={handleClearData}
        confirmLoading={clearLoading}
        okText={t('settings.clear_confirm_ok')}
        cancelText={t('settings.cancel')}
        okButtonProps={{ danger: true, disabled: !clearPwd }}
        centered
        width={460}
        destroyOnClose
      >
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('settings.clear_alert_title')}
          description={t('settings.clear_alert_desc')}
        />
        <Text>{t('settings.clear_prompt')}</Text>
        <Input.Password
          style={{ marginTop: 8 }}
          placeholder={t('settings.clear_pwd_label')}
          value={clearPwd}
          onChange={(e) => setClearPwd(e.target.value)}
          onPressEnter={handleClearData}
        />
      </Modal>
    </div>
  );
}
