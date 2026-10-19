import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发服务器代理的后端地址。默认本机后端；
// 想用本地界面连线上后端联调时设 VITE_PROXY_TARGET=https://...（走代理，不受生产 CORS 限制）
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3000';

export default defineConfig({
  // 相对路径：让打包后的资源在 Electron 的 file:// 下也能正确加载
  base: './',
  // 不输出 sourcemap：避免随安装包泄露源码（代码保护）
  build: { sourcemap: false },
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        // changeOrigin 只改 Host，不改 Origin。浏览器会带上 Origin: http://localhost:5173，
        // 连线上后端时被生产 CORS 拒掉（生产只放行桌面端的 null 和手机端的无 Origin）。
        // 代理是服务端转发，本来就不需要 CORS，把这个头去掉即可。
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
        },
      },
      '/uploads': {
        target: proxyTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: proxyTarget,
        ws: true,
        changeOrigin: true,
        // 同上。websocket 升级请求走的是 proxyReqWs，不是 proxyReq
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
          proxy.on('proxyReqWs', (proxyReq) => proxyReq.removeHeader('origin'));
        },
      },
    },
  },
  resolve: {
    alias: { '@': '/src' },
  },
});
