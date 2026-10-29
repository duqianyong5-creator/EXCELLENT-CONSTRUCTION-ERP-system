import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { Provider } from 'react-redux';
import { store } from '../src/store';
import * as SecureStore from 'expo-secure-store';
import { useRouter, useSegments } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import { setCredentials } from '../src/store/authSlice';
import type { RootState } from '../src/store';
import { View, ActivityIndicator } from 'react-native';
import * as Notifications from 'expo-notifications';
import { LangProvider } from '../src/i18n';
import AppDialog from '../src/AppDialog';
import { registerTaskNotifications, checkAndNotify, checkAnnouncementsAndNotify } from '../src/notifications';
import { connectSocket, disconnectSocket } from '../src/socket';
import { colors } from '../src/theme';

function AuthGuard() {
  const router = useRouter();
  const segments = useSegments();
  const dispatch = useDispatch();
  const { isAuthenticated } = useSelector((s: RootState) => s.auth);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const restore = async () => {
      try {
        const token = await SecureStore.getItemAsync('token');
        const userStr = await SecureStore.getItemAsync('user');
        if (token && userStr) {
          dispatch(setCredentials({ token, user: JSON.parse(userStr) }));
        }
      } catch { /* ignore */ }
      setChecking(false);
    };
    restore();
  }, []);

  useEffect(() => {
    if (checking) return;
    const inAuth = segments[0] === 'login' || segments[0] === 'register';
    if (!isAuthenticated && !inAuth) {
      router.replace('/login');
    } else if (isAuthenticated && inAuth) {
      router.replace('/(tabs)/tasks');
    }
  }, [isAuthenticated, checking, segments]);

  // Task notifications: register background fetch, poll while foregrounded,
  // and open the related task when a notification is tapped.
  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      return;
    }
    registerTaskNotifications();
    checkAndNotify();
    checkAnnouncementsAndNotify();
    connectSocket();
    const interval = setInterval(() => {
      checkAndNotify();
      checkAnnouncementsAndNotify();
    }, 30000);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const taskId = (response.notification.request.content.data as any)?.taskId;
      if (taskId) router.push(`/task/${taskId}`);
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [isAuthenticated]);

  if (checking) {
    return (
      // 容器要给底色：不给的话深色 App 启动时会先白闪一下
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  return null;
}

export default function RootLayout() {
  return (
    <Provider store={store}>
      <LangProvider>
        <AuthGuard />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="task/[id]" />
        </Stack>
        <AppDialog />
      </LangProvider>
    </Provider>
  );
}
