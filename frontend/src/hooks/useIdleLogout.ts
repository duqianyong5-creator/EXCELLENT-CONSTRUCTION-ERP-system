import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { logout } from '../store/slices/authSlice';

// Web 端闲置自动登出。监控（大屏）账号豁免，保持长期在线。
const IDLE_MS = 60 * 60 * 1000; // 60 分钟

export function useIdleLogout() {
  const dispatch = useDispatch();
  const { isAuthenticated, user } = useSelector((s: RootState) => s.auth);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 未登录或监控账号：不启用闲置登出
    if (!isAuthenticated || !user || user.role === 'monitor') return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        dispatch(logout());
        // 应用用的是 HashRouter，桌面版还是从 file:// 加载的：
        // href='/login' 会让 Electron 跳到 file:///login（不存在），
        // 窗口变成空白的找不到文件页，而生产环境菜单和开发者工具都关了，用户只能强杀进程。
        window.location.hash = '#/login';
      }, IDLE_MS);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [isAuthenticated, user?.role, dispatch]);
}
