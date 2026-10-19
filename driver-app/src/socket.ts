import { io, Socket } from 'socket.io-client';
import { DeviceEventEmitter } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getBaseUrl } from './api';
import { checkAndNotify } from './notifications';

let socket: Socket | null = null;

/**
 * Connect to the backend WebSocket so new tasks/notifications arrive instantly
 * (no polling delay). The server auto-joins the `user:<id>` room from the JWT.
 */
export async function connectSocket() {
  if (socket) return;
  const token = await SecureStore.getItemAsync('token');
  if (!token) return;
  const baseUrl = await getBaseUrl();

  socket = io(baseUrl, {
    // 先用 websocket，连不上时回退到 polling，避免某些网络下完全连不上（在线状态丢失）
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 800,
  });

  if (__DEV__) {
    socket.on('connect', () => console.log('[socket] connected', socket?.id));
    socket.on('connect_error', (e: any) => console.log('[socket] connect_error', e?.message));
  }

  socket.on('notification:new', () => {
    // Fire the system notification (deduped via seen-ids) and refresh the
    // task list immediately — task appears the moment it's dispatched.
    checkAndNotify();
    DeviceEventEmitter.emit('tasks:refresh');
  });
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
