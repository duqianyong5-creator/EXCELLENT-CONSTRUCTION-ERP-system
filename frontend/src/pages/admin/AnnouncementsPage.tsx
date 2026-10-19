import React, { useEffect, useState } from 'react';
import {
  Table, Card, Button, Tag, Space, Modal, Typography, Form,
  Input, Select, Popconfirm, Switch, message,
} from 'antd';
import { PlusOutlined, DeleteOutlined, NotificationOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { announcementsApi } from '../../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { TextArea } = Input;

const TARGET_LABEL: Record<string, { textKey: string; color: string }> = {
  all: { textKey: 'announcements.target_all', color: 'blue' },
  client: { textKey: 'announcements.target_client', color: 'green' },
  driver: { textKey: 'announcements.target_driver', color: 'orange' },
};

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const data: any = await announcementsApi.list();
      setList(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await announcementsApi.create(values);
      message.success(t('announcements.published_msg'));
      setOpen(false);
      form.resetFields();
      load();
    } catch {
      message.error(t('announcements.publish_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (record: any, active: boolean) => {
    try {
      await announcementsApi.setActive(record.id, active);
      message.success(active ? t('announcements.enabled_msg') : t('announcements.disabled_msg'));
      load();
    } catch {
      message.error(t('announcements.action_failed'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await announcementsApi.delete(id);
      message.success(t('announcements.deleted_msg'));
      load();
    } catch {
      message.error(t('announcements.delete_failed'));
    }
  };

  const columns = [
    { title: t('announcements.col_title'), dataIndex: 'title', key: 'title', render: (v: string) => <Text strong>{v}</Text> },
    { title: t('announcements.col_content'), dataIndex: 'content', key: 'content', ellipsis: true,
      render: (v: string) => <Text type="secondary">{v}</Text> },
    {
      title: t('announcements.col_target'), dataIndex: 'targetRole', key: 'targetRole', width: 110,
      render: (v: string) => {
        const m = TARGET_LABEL[v] || TARGET_LABEL.all;
        return <Tag color={m.color}>{t(m.textKey)}</Tag>;
      },
    },
    {
      title: t('announcements.col_status'), dataIndex: 'active', key: 'active', width: 100,
      render: (v: boolean, r: any) => (
        <Switch checked={v} size="small" onChange={(checked) => toggleActive(r, checked)} />
      ),
    },
    { title: t('announcements.col_created'), dataIndex: 'createdAt', key: 'createdAt', width: 150,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    {
      title: t('announcements.col_actions'), key: 'actions', width: 90,
      render: (_: any, r: any) => (
        <Popconfirm title={t('announcements.delete_confirm')} onConfirm={() => handleDelete(r.id)} okText={t('announcements.delete')} okButtonProps={{ danger: true }} cancelText={t('announcements.cancel')}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <NotificationOutlined style={{ marginRight: 8, color: '#F59E0B' }} />
          {t('announcements.title')}
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{t('announcements.new')}</Button>
      </div>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        <Table columns={columns} dataSource={list} rowKey="id" loading={loading} pagination={{ pageSize: 12 }} />
      </Card>

      <Modal
        title={t('announcements.modal_title')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleCreate}
        confirmLoading={submitting}
        okText={t('announcements.ok')}
        cancelText={t('announcements.cancel')}
        centered
        width={460}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ targetRole: 'all' }}>
          <Form.Item name="title" label={t('announcements.form_title')} rules={[{ required: true, message: t('announcements.form_title_required') }]}>
            <Input placeholder={t('announcements.form_title_placeholder')} maxLength={100} />
          </Form.Item>
          <Form.Item name="content" label={t('announcements.form_content')} rules={[{ required: true, message: t('announcements.form_content_required') }]}>
            <TextArea rows={4} placeholder={t('announcements.form_content_placeholder')} maxLength={1000} showCount />
          </Form.Item>
          <Form.Item name="targetRole" label={t('announcements.form_target')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'all', label: t('announcements.opt_all') },
                { value: 'client', label: t('announcements.opt_client') },
                { value: 'driver', label: t('announcements.opt_driver') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
