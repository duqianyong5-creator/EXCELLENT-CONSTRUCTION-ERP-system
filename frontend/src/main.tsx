import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import './i18n';
import App from './App';
import { store } from './store';
import './index.css';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: '#F59E0B',
            colorInfo: '#F59E0B',
            borderRadius: 10,
            controlHeight: 38,
            colorBgLayout: '#f6f8fb',
            colorTextHeading: '#0f172a',
            fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          },
          components: {
            Modal: { borderRadiusLG: 16, titleFontSize: 17, paddingContentHorizontalLG: 24 },
            Form: { itemMarginBottom: 16, verticalLabelPadding: '0 0 4px' },
            Table: {
              headerBg: '#f8fafc',
              headerColor: '#475569',
              headerSplitColor: 'transparent',
              borderColor: '#eef2f7',
              rowHoverBg: '#f8fafc',
              cellPaddingBlock: 12,
              headerBorderRadius: 12,
            },
            Button: { primaryShadow: 'none', fontWeight: 600 },
            Card: { borderRadiusLG: 14 },
            Segmented: { borderRadius: 8 },
          },
        }}
      >
        <App />
      </ConfigProvider>
    </Provider>
  </React.StrictMode>,
);
