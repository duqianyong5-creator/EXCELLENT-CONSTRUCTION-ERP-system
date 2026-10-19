import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useDispatch } from 'react-redux';
import * as SecureStore from 'expo-secure-store';
import { authApi, getBaseUrl } from '../src/api';
import { setCredentials } from '../src/store/authSlice';
import { useLang } from '../src/i18n';
import { showAppAlert } from '../src/AppDialog';
import { colors, space, font, weight, radius, hit } from '../src/theme';

export default function LoginScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { t, toggle } = useLang();
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'id' | 'pw' | null>(null);

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      showAppAlert(t('login.notice'), t('login.enterBoth'));
      return;
    }
    try {
      setLoading(true);
      const res: any = await authApi.login({ identifier: identifier.trim(), password });
      // 监控（大屏）账号仅限网页端使用，App 不允许登录
      if (res.user?.role === 'monitor') {
        showAppAlert(t('login.loginFailed'), t('login.monitorOnly'));
        return;
      }
      await SecureStore.setItemAsync('token', res.access_token);
      await SecureStore.setItemAsync('user', JSON.stringify(res.user));
      dispatch(setCredentials({ token: res.access_token, user: res.user }));
      router.replace('/(tabs)/tasks');
    } catch (err: any) {
      if (__DEV__) console.error('Login Error:', err);
      // 后端会明确告诉是账号不存在、密码错误还是账户待审核，直接把这句话给司机看。
      // 只有压根没连上服务器时才显示技术细节（那时地址/网络才是真正要查的东西）。
      const serverMessage = err?.response?.data?.message ?? err?.data?.message;
      const noResponse = !err?.response && !err?.statusCode;
      if (serverMessage) {
        showAppAlert(t('login.loginFailed'), String(serverMessage));
      } else if (noResponse) {
        const currentUrl = await getBaseUrl();
        showAppAlert(
          t('login.loginFailed'),
          `${t('login.noServer')}\n\n${currentUrl}`,
        );
      } else {
        showAppAlert(t('login.loginFailed'), String(err?.message ?? t('login.tryAgain')));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header decoration */}
        <View style={styles.topDecoration}>
          <View style={styles.decorCircle1} />
          <View style={styles.decorCircle2} />
        </View>

        {/* Logo area */}
        <View style={styles.logoBox}>
          <View style={styles.logoIconContainer}>
            <Image source={require('../assets/log.png')} style={styles.logoImage} resizeMode="contain" />
          </View>
          <Text style={styles.logoTitle}>Excellent Construction</Text>
          <Text style={styles.logoSub}>{t('login.portal')}</Text>
        </View>

        {/* Login card */}
        <View style={styles.card}>
          <Text style={styles.label}>{t('login.account')}</Text>
          <View style={[styles.inputContainer, focused === 'id' && styles.inputContainerFocused]}>
            <Ionicons name="person-outline" size={20} color={focused === 'id' ? colors.accent : colors.textFaint} />
            <TextInput
              style={styles.input}
              placeholder={t('login.accountPh')}
              value={identifier}
              onChangeText={setIdentifier}
              onFocus={() => setFocused('id')}
              onBlur={() => setFocused(null)}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              placeholderTextColor={colors.textFaint}
            />
          </View>

          <Text style={styles.label}>{t('login.password')}</Text>
          <View style={[styles.inputContainer, focused === 'pw' && styles.inputContainerFocused]}>
            <Ionicons name="lock-closed-outline" size={20} color={focused === 'pw' ? colors.accent : colors.textFaint} />
            <TextInput
              style={styles.input}
              placeholder={t('login.passwordPh')}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocused('pw')}
              onBlur={() => setFocused(null)}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              placeholderTextColor={colors.textFaint}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword(v => !v)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.loginBtn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.loginBtnText}>{t('login.login')}</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.registerRow}>
          <Text style={styles.tip}>{t('login.noAccount')}</Text>
          <TouchableOpacity style={styles.registerBtn} onPress={() => router.push('/register')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.registerLink}>{t('login.register')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.version}>v1.0.0</Text>
      </ScrollView>

      {/* 语言切换挂在右上角：它是全局开关，不该挤在"注册"旁边当第二个按钮 */}
      <TouchableOpacity
        onPress={toggle}
        style={[styles.langBtn, { top: insets.top + space.md }]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.85}
      >
        <Text style={styles.langBtnText}>{t('login.langToggle')}</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.xxl,
  },
  topDecoration: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    overflow: 'hidden',
  },
  decorCircle1: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    opacity: 0.08,
  },
  decorCircle2: {
    position: 'absolute',
    top: -50,
    left: -100,
    width: 250,
    height: 250,
    borderRadius: radius.pill,
    backgroundColor: colors.accentDark,
    opacity: 0.05,
  },
  logoBox: {
    alignItems: 'center',
    marginBottom: space.xxxl,
  },
  logoIconContainer: {
    width: 96,
    height: 96,
    borderRadius: radius.xl,
    // logo 本身是深色图，需要一块浅色底板才看得清
    backgroundColor: colors.text,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  logoImage: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
  },
  logoTitle: {
    fontSize: font.xl,
    fontWeight: weight.heavy,
    color: colors.text,
    marginBottom: space.sm,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  logoSub: {
    fontSize: font.xs,
    color: colors.accent,
    letterSpacing: 3,
    fontWeight: weight.bold,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    fontSize: font.sm,
    color: colors.textMuted,
    marginBottom: space.sm,
    fontWeight: weight.semibold,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.lg,
    paddingHorizontal: space.lg,
    gap: space.md,
    minHeight: hit.min,
  },
  inputContainerFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space.md,
    fontSize: font.base,
    color: colors.text,
  },
  eyeBtn: {
    width: hit.min,
    height: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    // 触区撑到 48，但视觉上仍贴着右边距
    marginRight: -space.md,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  loginBtn: {
    backgroundColor: colors.accent,
    marginTop: space.xl,
  },
  loginBtnText: {
    color: colors.onAccent,
    fontSize: font.lg,
    fontWeight: weight.heavy,
    letterSpacing: 0.3,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
  },
  tip: {
    textAlign: 'center',
    color: colors.textFaint,
    fontSize: font.sm,
  },
  registerBtn: {
    minHeight: hit.min,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  registerLink: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: weight.bold,
  },
  langBtn: {
    position: 'absolute',
    right: space.lg,
    zIndex: 10,
    minHeight: hit.min,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  langBtnText: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.bold,
    letterSpacing: 0.5,
  },
  version: {
    textAlign: 'center',
    color: colors.textFaint,
    marginTop: space.lg,
    fontSize: font.xs,
    opacity: 0.6,
  },
});
