import React, { useState } from 'react';
import { Card, Form, Input, Button, Space, message, Typography, Avatar, Tag, Tabs } from 'antd';
import { UserOutlined, LockOutlined, GlobalOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { RootState } from '../../store';
import { updateUser } from '../../store/slices/authSlice';
import { usersApi } from '../../api';

const { Title, Text } = Typography;

export default function ClientProfilePage() {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const { user } = useSelector((s: RootState) => s.auth);
  const [loading, setLoading] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [profileForm] = Form.useForm();
  const [pwdForm] = Form.useForm();

  const handleProfileSave = async (values: any) => {
    setLoading(true);
    try {
      await usersApi.updateProfile(values);
      dispatch(updateUser(values));
      message.success(t('client.profile_updated'));
    } catch (e: any) {
      message.error(e.message || t('client.profile_update_failed'));
    }
    setLoading(false);
  };

  const handlePasswordChange = async (values: any) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error(t('client.password_mismatch'));
      return;
    }
    setPwdLoading(true);
    try {
      await usersApi.changePassword({ oldPassword: values.oldPassword, newPassword: values.newPassword });
      message.success(t('client.password_changed'));
      pwdForm.resetFields();
    } catch (e: any) {
      message.error(e.message || t('client.password_change_failed'));
    }
    setPwdLoading(false);
  };

  const handleLangChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
    message.success(t('client.language_switched'));
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <Card bordered={false} style={{ borderRadius: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <Avatar size={64} style={{ background: '#1677ff' }} icon={<UserOutlined />} />
          <div>
            <Title level={5} style={{ margin: 0 }}>{user?.fullName || user?.username}</Title>
            <Tag color="blue">{t('client.role_tag')}</Tag>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{user?.email}</Text>
          </div>
        </div>

        <Tabs
          items={[
            {
              key: 'profile',
              label: t('profile'),
              children: (
                <Form
                  form={profileForm}
                  onFinish={handleProfileSave}
                  layout="vertical"
                  initialValues={{ fullName: user?.fullName, phone: user?.phone }}
                >
                  <Form.Item name="fullName" label={t('client.full_name')}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="phone" label={t('client.phone')}>
                    <Input />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={loading}>{t('client.save')}</Button>
                </Form>
              ),
            },
            {
              key: 'password',
              label: t('change_password'),
              children: (
                <Form form={pwdForm} onFinish={handlePasswordChange} layout="vertical">
                  <Form.Item name="oldPassword" label={t('old_password')} rules={[{ required: true }]}>
                    <Input.Password prefix={<LockOutlined />} />
                  </Form.Item>
                  <Form.Item name="newPassword" label={t('new_password')} rules={[{ required: true }, { min: 8 }]}>
                    <Input.Password prefix={<LockOutlined />} />
                  </Form.Item>
                  <Form.Item name="confirmPassword" label={t('client.confirm_new_password')} rules={[{ required: true }]}>
                    <Input.Password prefix={<LockOutlined />} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={pwdLoading}>{t('client.change_password')}</Button>
                </Form>
              ),
            },
            {
              key: 'language',
              label: t('language'),
              children: (
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>{t('client.choose_language')}</Text>
                  <Space>
                    <Button
                      type={i18n.language === 'zh' ? 'primary' : 'default'}
                      onClick={() => handleLangChange('zh')}
                      icon={<GlobalOutlined />}
                    >{t('client.lang_zh')}</Button>
                    <Button
                      type={i18n.language === 'en' ? 'primary' : 'default'}
                      onClick={() => handleLangChange('en')}
                      icon={<GlobalOutlined />}
                    >English</Button>
                  </Space>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

