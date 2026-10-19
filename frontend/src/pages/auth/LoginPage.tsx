import React, { useState } from 'react';
import { Form, Input, Button, message } from 'antd';
import {
  UserOutlined, LockOutlined, LaptopOutlined, PhoneOutlined, MailOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api';
import { setCredentials } from '../../store/slices/authSlice';

const AMBER = '#F59E0B';
const AMBER_DARK = '#D97706';

// 左侧功能标签 —— 根据本系统真实功能。存 key，按当前语言显示，不做中英混排
const FEATURE_KEYS = ['feat_users', 'feat_dispatch', 'feat_hours', 'feat_gps', 'feat_anomaly', 'feat_notify'];

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'zh';

  const switchLang = (next: 'zh' | 'en') => {
    i18n.changeLanguage(next);
    localStorage.setItem('language', next);
  };
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: any) => {
    try {
      setLoading(true);
      const res: any = await authApi.login({ identifier: values.identifier, password: values.password });
      dispatch(setCredentials({ token: res.access_token, user: res.user }));
      message.success(t('login_success'));

      const role = res.user.role;
      if (role === 'admin' || role === 'dispatcher' || role === 'monitor') navigate('/admin/dashboard');
      else if (role === 'driver') navigate('/driver/tasks');
      else navigate('/client/tasks');
    } catch (err: any) {
      // 后端按 X-Lang 返回当前语言的句子；真取不到再退回本地文案
      message.error(err?.message || t('login_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        {/* ===== 左侧：品牌信息 ===== */}
        <div className="login-left">
          <img src="./log.png" alt="Excellent Construction Ltd" className="login-logo" />

          <div className="brand-name">
            <span className="brand-line">EXCELLENT</span>
            <span className="brand-line brand-accent">CONSTRUCTION</span>
            <span className="brand-suffix">LIMITED</span>
          </div>
          <div className="brand-sub">{t('brand_sub')}</div>

          <div className="feature-tags">
            {FEATURE_KEYS.map((k) => (
              <span key={k} className="feature-tag">{t(k)}</span>
            ))}
          </div>

          <div className="contact-block">
            <div className="contact-row">
              <span className="contact-icon"><LaptopOutlined /></span>
              <div>
                <div className="contact-main">{t('it_contact')}</div>
                <div className="contact-sub">
                  <PhoneOutlined style={{ color: AMBER, marginRight: 6 }} />021 079 8567
                </div>
              </div>
            </div>
            <div className="contact-row">
              <span className="contact-icon"><MailOutlined /></span>
              <div className="contact-main">duqianyong5@gmail.com</div>
            </div>
          </div>
        </div>

        {/* ===== 右侧：登录表单 ===== */}
        <div className="login-right">
          {/* 语言切换放在右上角，整块面板只显示一种语言 */}
          <div className="lang-switch" role="group" aria-label="Language">
            <button
              type="button"
              className={lang === 'en' ? 'lang-on' : 'lang-off'}
              onClick={() => switchLang('en')}
            >EN</button>
            <button
              type="button"
              className={lang === 'zh' ? 'lang-on' : 'lang-off'}
              onClick={() => switchLang('zh')}
            >CN</button>
          </div>

          <div className="accent-bar" />
          <h1 className="portal-title">{t('portal_title')}</h1>
          <p className="portal-sub">{t('portal_sub')}</p>

          <Form onFinish={onFinish} layout="vertical" requiredMark={false} className="login-form">
            <Form.Item
              name="identifier"
              label={<span className="field-label">{t('username')}</span>}
              rules={[{ required: true, message: t('enter_username') }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#9ca3af' }} />}
                placeholder={t('email_or_username')}
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={<span className="field-label">{t('password')}</span>}
              rules={[{ required: true, message: t('enter_password') }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#9ca3af' }} />}
                placeholder={t('password')}
                autoComplete="current-password"
              />
            </Form.Item>

            <Button type="primary" htmlType="submit" loading={loading} block className="signin-btn">
              {t('sign_in')}&nbsp;→
            </Button>
          </Form>

          {/* /register 路由和注册页一直都有，只是登录页没有入口，
              被告知「在桌面端自己注册」的客户/司机根本找不到 */}
          <div className="right-footer">
            <span style={{ color: '#94a3b8' }}>{t('no_account')}</span>
            <a className="register-link" onClick={() => navigate('/register')}>{t('register')}</a>
          </div>

          <div className="version">V1.0.0</div>
        </div>
      </div>

      <style>{`
        .login-bg {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background:
            radial-gradient(circle at 6% 94%, rgba(245,158,11,0.16), transparent 42%),
            linear-gradient(135deg, #0d1424 0%, #131c30 50%, #0b1220 100%);
          background-color: #0b1220;
        }
        .login-bg::before {
          content: '';
          position: fixed; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 44px 44px;
          pointer-events: none;
        }
        .login-card {
          position: relative; z-index: 1;
          display: flex;
          width: 100%; max-width: 880px;
          min-height: 460px;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 30px 80px rgba(0,0,0,0.55);
        }
        /* 左侧 */
        .login-left {
          flex: 1;
          background: linear-gradient(160deg, #1a2336 0%, #131b2c 100%);
          padding: 40px 40px;
          display: flex; flex-direction: column;
        }
        .login-logo {
          width: 100px; height: 100px;
          border-radius: 50%;
          object-fit: cover;
          box-shadow: 0 10px 30px rgba(245,158,11,0.4);
          margin-bottom: 16px;
        }
        .brand-name {
          display: flex; flex-direction: column;
          margin-top: 2px;
        }
        .brand-line {
          font-size: 26px; font-weight: 800; line-height: 1.08;
          color: #fff; letter-spacing: 0.4px;
        }
        .brand-accent { color: ${AMBER}; }
        .brand-suffix {
          margin-top: 3px;
          font-size: 12px; font-weight: 600; letter-spacing: 4px;
          color: #64748b;
        }
        .brand-sub {
          margin-top: 14px; padding-top: 12px;
          border-top: 1px solid rgba(255,255,255,0.07);
          font-size: 10px; font-weight: 600; letter-spacing: 1.6px;
          color: #64748b; text-transform: uppercase;
        }
        .feature-tags {
          display: flex; flex-wrap: wrap; gap: 8px;
          margin-top: 22px;
        }
        .feature-tag {
          padding: 5px 12px;
          font-size: 11.5px; color: #cbd5e1;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
        }
        .contact-block { margin-top: auto; padding-top: 26px; display: flex; flex-direction: column; gap: 12px; }
        .contact-row { display: flex; align-items: center; gap: 14px; }
        .contact-icon {
          width: 40px; height: 40px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.05);
          border-radius: 10px; color: ${AMBER}; font-size: 18px;
        }
        .contact-main { color: #e2e8f0; font-size: 13px; font-weight: 600; }
        .contact-sub { color: #94a3b8; font-size: 11px; margin-top: 2px; }
        /* 右侧 */
        .login-right {
          position: relative;
          flex: 1;
          background: #ffffff;
          padding: 56px 44px 40px;
          display: flex; flex-direction: column; justify-content: center;
        }
        .accent-bar { width: 40px; height: 4px; border-radius: 3px; background: ${AMBER}; margin-bottom: 16px; }
        .portal-title { font-size: 23px; font-weight: 800; color: #0f172a; margin: 0; }
        .portal-sub { font-size: 13px; color: #64748b; margin: 5px 0 22px; }
        /* AntD 的 .ant-form-item-label > label 会盖掉单独的 .field-label，
           所以连着父选择器写，把小号大写标签的设计意图拿回来 */
        .login-form .ant-form-item-label > label {
          height: auto;
          font-size: 11px; font-weight: 700; letter-spacing: 1.2px;
          color: #64748b; text-transform: uppercase;
        }
        .login-form .ant-form-item-label { padding-bottom: 6px; }
        .field-label { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; color: #64748b; }
        .login-form .ant-input-affix-wrapper {
          border-radius: 10px; padding: 10px 13px; border-color: #e2e8f0;
        }
        .login-form .ant-input-affix-wrapper:hover,
        .login-form .ant-input-affix-wrapper-focused {
          border-color: ${AMBER}; box-shadow: 0 0 0 3px ${AMBER}22;
        }
        .login-form .ant-form-item { margin-bottom: 16px; }
        .signin-btn {
          height: 46px; border-radius: 12px; margin-top: 12px;
          background: ${AMBER}; border: none;
          font-size: 15px; font-weight: 700; color: #fff;
          box-shadow: 0 8px 22px ${AMBER}55;
          transition: all 0.2s ease;
        }
        .signin-btn:hover {
          background: ${AMBER_DARK} !important; color: #fff !important;
          transform: translateY(-1px); box-shadow: 0 10px 28px ${AMBER}66;
        }
        /* 右上角语言开关：整块面板只显示一种语言 */
        .lang-switch {
          position: absolute; top: 20px; right: 24px;
          display: inline-flex; overflow: hidden;
          border: 1px solid #e2e8f0; border-radius: 10px;
          background: #fff;
        }
        .lang-switch button {
          border: none; cursor: pointer;
          min-width: 46px; padding: 7px 0;
          font-size: 12px; font-weight: 700; letter-spacing: 0.5px;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .lang-switch button + button { border-left: 1px solid #e2e8f0; }
        .lang-on { background: ${AMBER}; color: #fff; }
        .lang-off { background: #fff; color: #94a3b8; }
        .lang-off:hover { background: #f8fafc; color: #475569; }
        /* 按钮和注册行之间要有呼吸，注册行本身降一级、别和主按钮抢 */
        .right-footer {
          display: flex; align-items: center; justify-content: center;
          margin-top: 22px; font-size: 12.5px;
        }
        .register-link {
          color: ${AMBER}; font-weight: 700; margin-left: 5px;
          text-decoration: none; cursor: pointer;
        }
        .register-link:hover { color: ${AMBER_DARK}; text-decoration: underline; }
        .version {
          text-align: center; color: #cbd5e1; font-size: 11px;
          margin-top: 18px; font-weight: 600; letter-spacing: 0.5px;
        }
        /* 响应式：窄屏堆叠，隐藏左侧品牌大区块 */
        @media (max-width: 760px) {
          .login-card { flex-direction: column; max-width: 440px; min-height: 0; }
          .login-left { padding: 36px 32px 24px; align-items: center; text-align: center; }
          .brand-name { font-size: 24px; }
          .feature-tags { justify-content: center; }
          .contact-block { margin-top: 28px; align-items: center; }
          .login-right { padding: 52px 32px 32px; }
          .lang-switch { top: 14px; right: 16px; }
        }
      `}</style>
    </div>
  );
}
