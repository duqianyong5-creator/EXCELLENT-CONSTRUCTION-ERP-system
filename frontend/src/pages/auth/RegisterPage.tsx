import React, { useState } from 'react';
import { Form, Input, Button, Select, message, Result } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, PhoneOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api';

const { Option } = Select;
const AMBER = '#F59E0B';
const AMBER_DARK = '#D97706';

const bgStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  position: 'relative',
  background:
    'radial-gradient(circle at 6% 94%, rgba(245,158,11,0.16), transparent 42%), ' +
    'linear-gradient(135deg, #0d1424 0%, #131c30 50%, #0b1220 100%)',
  backgroundColor: '#0b1220',
};

export default function RegisterPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const onFinish = async (values: any) => {
    try {
      setLoading(true);
      await authApi.register(values);
      setSuccess(true);
    } catch (err: any) {
      message.error(err.message || t('common.register_failed'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={bgStyle}>
        <div className="reg-card" style={{ textAlign: 'center' }}>
          <Result
            status="success"
            title={t('common.register_done_title')}
            subTitle={t('common.register_done_sub')}
            extra={
              <Link to="/login">
                <Button className="reg-submit" style={{ width: 160 }}>{t('common.back_to_login')}</Button>
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div style={bgStyle}>
      <div className="reg-card">
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src="./log.png"
            alt="Excellent Construction Ltd"
            style={{
              width: 88, height: 88, borderRadius: '50%', objectFit: 'cover',
              boxShadow: '0 10px 28px rgba(245,158,11,0.4)', marginBottom: 14,
            }}
          />
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{t('common.register_title')}</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{t('common.register_sub')}</div>
        </div>

        <Form onFinish={onFinish} size="large" layout="vertical" requiredMark={false} className="reg-form">
          <Form.Item name="username" rules={[{ required: true, message: t('common.username_required') }, { min: 3, message: t('common.username_min') }]}>
            <Input prefix={<UserOutlined style={{ color: '#9ca3af' }} />} placeholder={t('common.username_placeholder')} />
          </Form.Item>
          <Form.Item name="email" rules={[{ required: true, message: t('common.email_required') }, { type: 'email', message: t('common.email_invalid') }]}>
            <Input prefix={<MailOutlined style={{ color: '#9ca3af' }} />} placeholder={t('common.email_placeholder')} />
          </Form.Item>
          <Form.Item name="fullName" rules={[{ required: true, message: t('common.full_name_required') }]}>
            <Input prefix={<UserOutlined style={{ color: '#9ca3af' }} />} placeholder={t('common.full_name_placeholder')} />
          </Form.Item>
          <Form.Item name="phone">
            <Input prefix={<PhoneOutlined style={{ color: '#9ca3af' }} />} placeholder={t('common.phone_placeholder')} />
          </Form.Item>
          <Form.Item name="role" rules={[{ required: true, message: t('common.role_required') }]}>
            <Select placeholder={t('common.role_placeholder')}>
              <Option value="driver">{t('common.role_driver')}</Option>
              <Option value="client">{t('common.role_client')}</Option>
            </Select>
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: t('common.password_required') }, { min: 8, message: t('common.password_min') }]}>
            <Input.Password prefix={<LockOutlined style={{ color: '#9ca3af' }} />} placeholder={t('common.password_placeholder')} />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={loading} block className="reg-submit">
            {t('common.submit_application')}
          </Button>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 13 }}>
          <span style={{ color: '#94a3b8' }}>{t('common.have_account')}</span>
          <Link to="/login" className="reg-link">{t('common.back_to_login')}</Link>
        </div>
      </div>

      <style>{`
        .reg-card {
          position: relative; z-index: 1;
          width: 100%; max-width: 440px;
          background: #ffffff;
          border-radius: 18px;
          padding: 40px 36px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.5);
        }
        .reg-form .ant-input-affix-wrapper,
        .reg-form .ant-select-selector {
          border-radius: 10px !important;
          border-color: #e2e8f0 !important;
        }
        .reg-form .ant-input-affix-wrapper { padding: 10px 14px; }
        .reg-form .ant-input-affix-wrapper:hover,
        .reg-form .ant-input-affix-wrapper-focused,
        .reg-form .ant-select-focused .ant-select-selector,
        .reg-form .ant-select-selector:hover {
          border-color: ${AMBER} !important;
          box-shadow: 0 0 0 3px ${AMBER}22 !important;
        }
        .reg-form .ant-form-item { margin-bottom: 16px; }
        .reg-submit {
          height: 48px; border-radius: 12px; margin-top: 6px;
          background: ${AMBER} !important; border: none !important;
          font-size: 15px; font-weight: 700; color: #fff !important;
          box-shadow: 0 8px 22px ${AMBER}55;
          transition: all 0.2s ease;
        }
        .reg-submit:hover {
          background: ${AMBER_DARK} !important;
          transform: translateY(-1px); box-shadow: 0 10px 28px ${AMBER}66;
        }
        .reg-link { color: ${AMBER}; font-weight: 700; margin-left: 4px; text-decoration: none; }
        .reg-link:hover { color: ${AMBER_DARK}; }
      `}</style>
    </div>
  );
}
