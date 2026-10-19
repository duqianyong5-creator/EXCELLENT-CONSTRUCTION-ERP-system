import React, { useEffect, useState } from 'react';
import { List, Card, Button, Tag, Typography, Empty, Badge, Space } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { notificationsApi } from '../../api';
import { setUnread } from '../../store/slices/notifSlice';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const typeColors: Record<string, string> = {
  new_task: 'blue', task_assigned: 'blue', task_completed: 'green',
  task_created: 'cyan', gps_anomaly: 'red',
};

export default function NotificationsPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const data: any = await notificationsApi.list();
    setItems(data || []);
    const count = (data || []).filter((n: any) => !n.isRead).length;
    dispatch(setUnread(count));
    setLoading(false);
  };

  const markRead = async (id: string) => {
    await notificationsApi.markRead(id);
    load();
  };

  const markAll = async () => {
    await notificationsApi.markAllRead();
    load();
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>{t('notifications')}</Title>
        <Button icon={<CheckOutlined />} onClick={markAll}>{t('layout.notif_mark_all')}</Button>
      </div>

      <Card bordered={false} style={{ borderRadius: 12 }}>
        {items.length === 0 ? (
          <Empty description={t('layout.notif_empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            loading={loading}
            dataSource={items}
            renderItem={(item: any) => (
              <List.Item
                style={{ padding: '12px 16px', background: item.isRead ? 'transparent' : '#e6f4ff', borderRadius: 8, marginBottom: 4, cursor: 'pointer' }}
                onClick={() => !item.isRead && markRead(item.id)}
                extra={
                  <Space>
                    {!item.isRead && <Badge status="processing" />}
                    <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(item.createdAt).format('MM-DD HH:mm')}</Text>
                  </Space>
                }
              >
                <List.Item.Meta
                  avatar={<BellOutlined style={{ fontSize: 20, color: typeColors[item.type] || '#1677ff', marginTop: 2 }} />}
                  title={
                    <Space>
                      <Text strong={!item.isRead}>{item.title}</Text>
                      {item.type && <Tag color={typeColors[item.type] || 'default'} style={{ fontSize: 11 }}>{item.type}</Tag>}
                    </Space>
                  }
                  description={item.content}
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}
