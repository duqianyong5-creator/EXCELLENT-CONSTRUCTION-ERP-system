import React from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Badge, Button, Typography, Space } from 'antd';
import { OrderedListOutlined, BellOutlined, UserOutlined, LogoutOutlined, GlobalOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { RootState } from '../../store';
import { logout } from '../../store/slices/authSlice';
import ClientTasksPage from './ClientTasksPage';
import NotificationsPage from '../admin/NotificationsPage';
import ClientProfilePage from './ClientProfilePage';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const AMBER = '#F59E0B';

export default function ClientLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user } = useSelector((s: RootState) => s.auth);
  const { unread } = useSelector((s: RootState) => s.notif);
  const lang = i18n.language;

  const handleLogout = () => { dispatch(logout()); navigate('/login'); };
  const toggleLang = () => {
    const next = lang === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(next);
    localStorage.setItem('language', next);
  };

  const userMenu = {
    items: [
      { key: 'profile', label: t('client.nav_profile'), icon: <UserOutlined />, onClick: () => navigate('/client/profile') },
      // 语言项固定显示「另一种语言」的名字，所以中英两份文案是反过来写的
      { key: 'lang', label: t('client.lang_toggle'), icon: <GlobalOutlined />, onClick: toggleLang },
      { type: 'divider' as const },
      { key: 'logout', label: t('logout'), icon: <LogoutOutlined />, onClick: handleLogout, danger: true },
    ],
  };

  const menuItems = [
    { key: '/client/tasks', icon: <OrderedListOutlined />, label: t('client.nav_orders') },
    { key: '/client/profile', icon: <UserOutlined />, label: t('client.nav_profile') },
    { key: '/client/notifications', icon: <BellOutlined />, label: t('client.nav_notifications') },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{
          position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100,
          background: '#111827',
        }}
      >
        {/* Logo */}
        <div style={{
          height: 68,
          display: 'flex', alignItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '0 16px', gap: 10,
        }}>
          <img src="./log.png" alt="logo" style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'contain' }} />
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 13, lineHeight: 1.3 }}>
              Excellent Construction
            </div>
            <div style={{ color: AMBER, fontWeight: 600, fontSize: 10, letterSpacing: 1 }}>
              {t('client.brand_sub')}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 8px' }}>
          {menuItems.map((item) => {
            const isActive = location.pathname === item.key;
            return (
              <div
                key={item.key}
                onClick={() => navigate(item.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 14px', borderRadius: 10, cursor: 'pointer', marginBottom: 2,
                  background: isActive ? `${AMBER}22` : 'transparent',
                  border: `1px solid ${isActive ? AMBER + '33' : 'transparent'}`,
                  color: isActive ? AMBER : 'rgba(255,255,255,0.55)',
                  fontSize: 14, fontWeight: isActive ? 600 : 400,
                }}
              >
                <span style={{ fontSize: 16 }}>
                  {item.key === '/client/notifications'
                    ? <Badge count={unread} size="small">{item.icon}</Badge>
                    : item.icon}
                </span>
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>
      </Sider>

      <Layout style={{ marginLeft: 220 }}>
        <Header style={{
          background: '#fff', padding: '0 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0',
          position: 'sticky', top: 0, zIndex: 99, height: 56,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="./log.png" alt="logo" style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'contain' }} />
            <Text strong style={{ fontSize: 14 }}>Excellent Construction Ltd</Text>
          </div>
          <Dropdown menu={userMenu} placement="bottomRight">
            <Space style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: `${AMBER}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: AMBER, fontWeight: 700,
              }}>
                {(user?.fullName || user?.username || '?')[0].toUpperCase()}
              </div>
              <div>
                <Text strong style={{ fontSize: 13 }}>{user?.fullName || user?.username}</Text>
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>{t('client.role_tag')}</Text>
              </div>
            </Space>
          </Dropdown>
        </Header>

        <Content style={{ margin: '24px', minHeight: 'calc(100vh - 104px)' }}>
          <Routes>
            <Route path="tasks" element={<ClientTasksPage />} />
            <Route path="profile" element={<ClientProfilePage />} />
            <Route path="notifications" element={<NotificationsPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
