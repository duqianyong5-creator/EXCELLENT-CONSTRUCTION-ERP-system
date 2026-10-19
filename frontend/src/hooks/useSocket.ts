import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useDispatch } from 'react-redux';
import { addNotification } from '../store/slices/notifSlice';
import { notification } from 'antd';

let socketInstance: Socket | null = null;

export function useSocket(token: string | null) {
  const dispatch = useDispatch();
  const ref = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    if (!socketInstance) {
      // 生产连线上后端(VITE_API_URL)，开发走 Vite /socket.io 代理。
      // 先 polling 再升级 websocket：更稳，避免与 Vite HMR 的 websocket 冲突。
      socketInstance = io(import.meta.env.VITE_API_URL || '/', {
        auth: { token },
        transports: ['polling', 'websocket'],
        reconnection: true,
      });
    }

    ref.current = socketInstance;

    socketInstance.on('notification:new', (data: any) => {
      dispatch(addNotification(data));
      notification.info({ message: data.title, description: data.content, duration: 4 });
    });

    socketInstance.on('gps:update', (data: any) => {
      // handled by map components via event
      window.dispatchEvent(new CustomEvent('gps:update', { detail: data }));
    });

    socketInstance.on('driver-presence:update', (data: any) => {
      window.dispatchEvent(new CustomEvent('driver-presence:update', { detail: data }));
    });

    return () => {
      socketInstance?.off('notification:new');
      socketInstance?.off('gps:update');
      socketInstance?.off('driver-presence:update');
    };
  }, [token, dispatch]);

  return ref.current;
}
