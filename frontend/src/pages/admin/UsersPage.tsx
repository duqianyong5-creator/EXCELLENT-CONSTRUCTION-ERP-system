import React, { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  KeyOutlined,
  PlusOutlined,
  EditOutlined,
  UserOutlined,
  MailOutlined,
  TeamOutlined,
  CarOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { RootState } from '../../store';
import { usersApi } from '../../api';

const { Title, Text } = Typography;
const { Option } = Select;

const compactModalStyles = {
  header: { padding: '14px 18px' },
  body: { padding: '14px 18px 18px' },
};
const compactFormItemStyle = { marginBottom: 10 };

const ROLE_COLOR: Record<string, string> = {
  admin: 'red',
  dispatcher: 'blue',
  driver: 'green',
  client: 'purple',
  monitor: 'gold',
};

// 模块级常量拿不到 t()，所以这里存的是翻译键，渲染时再 t(...)
const ROLE_LABEL: Record<string, string> = {
  admin: 'users.role_admin',
  dispatcher: 'users.role_dispatcher',
  driver: 'users.role_driver',
  client: 'users.role_client',
  monitor: 'users.role_monitor',
};

function StatCard({ icon, color, value, label }: { icon: React.ReactNode; color: string; value: number; label: string }) {
  return (
    <Card bordered={false} style={{ borderRadius: 12 }} styles={{ body: { padding: 16 } }}>
      <Space size={14} align="center">
        <div style={{
          width: 46, height: 46, borderRadius: 12,
          background: `${color}1f`, color, fontSize: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1, color: '#0f172a' }}>{value}</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>{label}</div>
        </div>
      </Space>
    </Card>
  );
}

// 操作按钮统一配色（清晰可读）
const BTN = {
  edit: { background: '#fff7ed', color: '#ea580c', borderColor: '#fed7aa' },
  reset: { background: '#eff6ff', color: '#2563eb', borderColor: '#bfdbfe' },
  del: { background: '#fef2f2', color: '#ef4444', borderColor: '#fecaca' },
  notify: { background: '#f8fafc', color: '#475569', borderColor: '#e2e8f0' },
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'orange',
  active: 'green',
  rejected: 'red',
  disabled: 'default',
};

// 同上：存翻译键，渲染时再 t(...)
const STATUS_LABEL: Record<string, string> = {
  pending: 'users.status_pending',
  active: 'users.status_active',
  rejected: 'users.status_rejected',
  disabled: 'users.status_disabled',
};

export default function UsersPage() {
  const { t } = useTranslation();
  const currentUser = useSelector((s: RootState) => s.auth.user);
  const isAdmin = currentUser?.role === 'admin';

  const [users, setUsers] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resetForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [all, pend]: any = await Promise.all([usersApi.list(), usersApi.pending()]);
      setUsers(all || []);
      setPending(pend || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const [notifyTarget, setNotifyTarget] = useState<any>(null);
  const [notifyBody, setNotifyBody] = useState('');
  const [notifySubject, setNotifySubject] = useState('');

  // 审核通过邮件正文
  const buildApprovalBody = (u: any) =>
    t('users.mail_body_approved', { name: u.fullName || u.username, username: u.username });

  // 审核拒绝邮件正文
  const buildRejectBody = (u: any) =>
    t('users.mail_body_rejected', { name: u.fullName || u.username, username: u.username });

  // 审核通过：先通过，再弹出邮件让管理员手动发送通知
  const handleApprove = async (record: any) => {
    await usersApi.approve(record.id);
    message.success(t('users.approved'));
    load();
    if (record.email) {
      setNotifyTarget(record);
      setNotifySubject(t('users.mail_subject_approved'));
      setNotifyBody(buildApprovalBody(record));
    }
  };

  // 审核拒绝：先拒绝，再弹出邮件让管理员手动发送通知
  const handleReject = async (record: any) => {
    await usersApi.reject(record.id);
    message.success(t('users.rejected'));
    load();
    if (record.email) {
      setNotifyTarget(record);
      setNotifySubject(t('users.mail_subject_rejected'));
      setNotifyBody(buildRejectBody(record));
    }
  };

  // 打开本机邮箱客户端（mailto），由管理员在自己的邮箱里手动发送，无需服务器 SMTP
  const handleOpenMail = () => {
    if (!notifyTarget) return;
    const url = `mailto:${encodeURIComponent(notifyTarget.email)}?subject=${encodeURIComponent(notifySubject)}&body=${encodeURIComponent(notifyBody)}`;
    window.location.href = url;
    setNotifyTarget(null);
  };

  const openEdit = (record: any) => {
    setEditTarget(record);
    editForm.setFieldsValue({
      username: record.username,
      email: record.email,
      fullName: record.fullName,
      phone: record.phone,
      role: record.role,
      status: record.status,
    });
    setEditOpen(true);
  };

  const handleEdit = async (values: any) => {
    if (!editTarget) return;
    try {
      await usersApi.update(editTarget.id, values);
      message.success(t('users.updated'));
      setEditOpen(false);
      setEditTarget(null);
      editForm.resetFields();
      load();
    } catch (e: any) {
      message.error(e?.message || e?.error || t('users.update_failed'));
    }
  };
  const handleDelete = async (id: string) => {
    try {
      await usersApi.delete(id);
      message.success(t('users.deleted'));
      load();
    } catch (e: any) {
      message.error(e?.message || e?.error || t('users.delete_failed'));
    }
  };

  const handleResetPassword = async (values: any) => {
    if (!resetTargetId) return;
    try {
      await usersApi.resetPassword(resetTargetId, values.newPassword);
      message.success(t('users.password_reset'));
      setResetOpen(false);
      resetForm.resetFields();
      setResetTargetId(null);
    } catch (e: any) {
      message.error(e?.message || t('users.reset_failed'));
    }
  };

  const handleCreate = async (values: any) => {
    try {
      await usersApi.create(values);
      message.success(t('users.created'));
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (e: any) {
      message.error(e?.message || e?.error || t('users.create_failed'));
    }
  };

  const columns = [
    {
      title: t('users.col_username'), dataIndex: 'username', key: 'username',
      render: (v: string) => <Text style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</Text>,
    },
    {
      title: t('users.col_name'), key: 'name',
      render: (_: any, record: any) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.fullName || record.username}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>{record.email}</div>
        </div>
      ),
    },
    {
      title: t('users.col_role'), dataIndex: 'role', key: 'role',
      render: (role: string) => <Tag color={ROLE_COLOR[role]}>{t(ROLE_LABEL[role])}</Tag>,
    },
    {
      title: t('users.col_status'), dataIndex: 'status', key: 'status',
      render: (status: string) => <Tag color={STATUS_COLOR[status]}>{t(STATUS_LABEL[status])}</Tag>,
    },
    {
      title: t('users.col_actions'),
      key: 'actions',
      align: 'right' as const,
      render: (_: any, record: any) => (
        <Space size={6}>
          {isAdmin && record.id !== currentUser?.id && (
            <Button size="small" icon={<EditOutlined />} style={BTN.edit} onClick={() => openEdit(record)}>
              {t('users.btn_edit')}
            </Button>
          )}
          {isAdmin && record.id !== currentUser?.id && (
            <Button
              size="small"
              icon={<KeyOutlined />}
              style={BTN.reset}
              onClick={() => { setResetTargetId(record.id); setResetOpen(true); }}
            >
              {t('users.btn_reset')}
            </Button>
          )}
          {isAdmin && record.id !== currentUser?.id && (
            <Popconfirm
              title={t('users.delete_confirm_title')}
              description={t('users.delete_confirm_desc')}
              onConfirm={() => handleDelete(record.id)}
              okText={t('users.btn_delete')}
              cancelText={t('users.btn_cancel')}
              okButtonProps={{ danger: true }}
            >
              <Button size="small" icon={<DeleteOutlined />} style={BTN.del}>{t('users.btn_delete')}</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const pendingColumns = [
    {
      title: t('users.col_user'),
      key: 'user',
      render: (_: any, record: any) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.fullName || record.username}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>{record.email}</div>
        </div>
      ),
    },
    {
      title: t('users.col_requested_role'),
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => <Tag color={ROLE_COLOR[role]}>{t(ROLE_LABEL[role])}</Tag>,
    },
    {
      title: t('users.col_requested_at'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => dayjs(value).format('MM-DD HH:mm'),
    },
    {
      title: t('users.col_review'),
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => handleApprove(record)}>
            {t('users.btn_approve')}
          </Button>
          <Button danger size="small" icon={<CloseOutlined />} onClick={() => handleReject(record)}>
            {t('users.btn_reject')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            {t('users.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {isAdmin ? t('users.subtitle_admin') : t('users.subtitle_dispatcher')}
          </Text>
        </div>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('users.btn_create')}
          </Button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
        <StatCard icon={<TeamOutlined />} color="#3b82f6" value={users.length} label={t('users.stat_total')} />
        <StatCard icon={<CarOutlined />} color="#22c55e" value={users.filter((u) => u.role === 'driver').length} label={t('users.stat_drivers')} />
        <StatCard icon={<SafetyCertificateOutlined />} color="#F59E0B" value={users.filter((u) => u.role === 'admin').length} label={t('users.stat_admins')} />
      </div>

      <Card bordered={false} styles={{ body: { padding: 0 } }} style={{ borderRadius: 12, overflow: 'hidden' }}>
        <Tabs
          style={{ padding: '0 16px' }}
          items={[
            {
              key: 'all',
              label: (
                <span>
                  {t('users.tab_all')} <Badge count={users.length} color="blue" />
                </span>
              ),
              children: (
                <Table
                  columns={columns}
                  dataSource={users}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 15 }}
                  size="middle"
                />
              ),
            },
            {
              key: 'pending',
              label: (
                <span>
                  {t('users.tab_pending')} <Badge count={pending.length} />
                </span>
              ),
              children: (
                <Table
                  columns={pendingColumns}
                  dataSource={pending}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 15 }}
                  size="middle"
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={t('users.edit_title')}
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditTarget(null);
          editForm.resetFields();
        }}
        footer={null}
        destroyOnClose
        centered
        width={400}
        styles={compactModalStyles}
      >
        <Form form={editForm} onFinish={handleEdit} layout="vertical" size="small" style={{ paddingTop: 0 }}>
          <Form.Item name="username" label={t('users.f_username')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_username_required') }]}>
            <Input prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="email" label={t('users.f_email')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_email_required') }, { type: 'email', message: t('users.f_email_invalid') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="fullName" label={t('users.f_fullname')} style={compactFormItemStyle}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label={t('users.f_phone')} style={compactFormItemStyle}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label={t('users.f_role')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_role_required') }]}>
            <Select>
              <Option value="admin">{t('users.role_admin')}</Option>
              <Option value="dispatcher">{t('users.role_dispatcher')}</Option>
              <Option value="driver">{t('users.role_driver')}</Option>
              <Option value="client">{t('users.role_client')}</Option>
              <Option value="monitor">{t('users.role_monitor')}</Option>
            </Select>
          </Form.Item>
          <Form.Item name="status" label={t('users.f_status')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_status_required') }]}>
            <Select>
              <Option value="active">{t('users.status_active')}</Option>
              <Option value="pending">{t('users.status_pending')}</Option>
              <Option value="rejected">{t('users.status_rejected')}</Option>
              <Option value="disabled">{t('users.status_disabled')}</Option>
            </Select>
          </Form.Item>
          <div style={{ textAlign: 'right', marginTop: 4 }}>
            <Space size={8}>
              <Button
                size="small"
                onClick={() => {
                  setEditOpen(false);
                  setEditTarget(null);
                  editForm.resetFields();
                }}
              >
                {t('users.btn_cancel')}
              </Button>
              <Button size="small" type="primary" htmlType="submit">
                {t('users.btn_save')}
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>

      <Modal
        title={t('users.reset_title')}
        open={resetOpen}
        onCancel={() => {
          setResetOpen(false);
          resetForm.resetFields();
          setResetTargetId(null);
        }}
        footer={null}
        destroyOnClose
        centered
        width={380}
        styles={compactModalStyles}
      >
        <Form form={resetForm} onFinish={handleResetPassword} layout="vertical" size="small" style={{ paddingTop: 0 }}>
          <Form.Item
            name="newPassword"
            label={t('users.f_new_password')}
            style={compactFormItemStyle}
            rules={[{ required: true, message: t('users.f_new_password_required') }, { min: 6, message: t('users.f_password_min6') }]}
          >
            <Input.Password placeholder={t('users.f_new_password_ph')} />
          </Form.Item>
          <Form.Item
            name="confirm"
            label={t('users.f_confirm_password')}
            dependencies={['newPassword']}
            style={compactFormItemStyle}
            rules={[
              { required: true, message: t('users.f_confirm_required') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error(t('users.f_confirm_mismatch')));
                },
              }),
            ]}
          >
            <Input.Password placeholder={t('users.f_confirm_ph')} />
          </Form.Item>
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <Space size={8}>
              <Button
                size="small"
                onClick={() => {
                  setResetOpen(false);
                  resetForm.resetFields();
                  setResetTargetId(null);
                }}
              >
                {t('users.btn_cancel')}
              </Button>
              <Button size="small" type="primary" htmlType="submit">
                {t('users.btn_reset_submit')}
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>

      <Modal
        title={t('users.mail_title')}
        open={!!notifyTarget}
        onCancel={() => setNotifyTarget(null)}
        onOk={handleOpenMail}
        okText={t('users.mail_ok')}
        cancelText={t('users.btn_cancel')}
        okButtonProps={{ icon: <MailOutlined /> }}
        centered
        width={480}
        destroyOnClose
        styles={compactModalStyles}
      >
        <div style={{ marginBottom: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 10, fontSize: 13 }}>
          <div style={{ marginBottom: 4 }}><Text type="secondary">{t('users.mail_to')}</Text>{notifyTarget?.fullName || notifyTarget?.username}</div>
          <div><Text type="secondary">{t('users.mail_address')}</Text><Text strong>{notifyTarget?.email}</Text></div>
        </div>
        <Text type="secondary" style={{ fontSize: 13 }}>{t('users.mail_body_label')}</Text>
        <Input.TextArea
          rows={7}
          style={{ marginTop: 6 }}
          value={notifyBody}
          onChange={(e) => setNotifyBody(e.target.value)}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          {t('users.mail_hint')}
        </Text>
      </Modal>

      <Modal title={t('users.create_title')} open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnClose centered width={400} styles={compactModalStyles}>
        <Form form={form} onFinish={handleCreate} layout="vertical" size="small" style={{ paddingTop: 0 }}>
          <Form.Item name="username" label={t('users.f_username')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_username_required') }]}>
            <Input prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="fullName" label={t('users.f_fullname')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_fullname_required') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t('users.f_email')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_email_required') }, { type: 'email', message: t('users.f_email_invalid') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label={t('users.f_phone')} style={compactFormItemStyle}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label={t('users.f_role')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_role_required') }]}>
            <Select placeholder={t('users.f_role_placeholder')}>
              <Option value="admin">{t('users.role_admin')}</Option>
              <Option value="dispatcher">{t('users.role_dispatcher')}</Option>
              <Option value="driver">{t('users.role_driver')}</Option>
              <Option value="client">{t('users.role_client')}</Option>
              <Option value="monitor">{t('users.role_monitor')}</Option>
            </Select>
          </Form.Item>
          <Form.Item name="password" label={t('users.f_password')} style={compactFormItemStyle} rules={[{ required: true, message: t('users.f_password_required') }, { min: 6, message: t('users.f_password_min6') }]}>
            <Input.Password />
          </Form.Item>
          <div style={{ textAlign: 'right', marginTop: 4 }}>
            <Space size={8}>
              <Button size="small" onClick={() => setCreateOpen(false)}>{t('users.btn_cancel')}</Button>
              <Button size="small" type="primary" htmlType="submit">
                {t('users.btn_create_submit')}
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
