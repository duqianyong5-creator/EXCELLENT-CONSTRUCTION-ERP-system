import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useDispatch } from 'react-redux';
import * as SecureStore from 'expo-secure-store';
import { authApi, getBaseUrl } from '../src/api';
import { setCredentials } from '../src/store/authSlice';
import { useLang } from '../src/i18n';
import { showAppAlert } from '../src/AppDialog';
import { colors, space, font, weight, radius, hit, shadow } from '../src/theme';

/** How far the form card climbs over the hero's bottom edge */
const CARD_OVERLAP = space.xxxl;

export default function LoginScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { t, toggle } = useLang();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'id' | 'pw' | null>(null);

  // The navy hero owns about a third of the screen; the form card overlaps its bottom edge
  const heroHeight = Math.round(windowHeight * 0.34);

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      showAppAlert(t('login.notice'), t('login.enterBoth'));
      return;
    }
    try {
      setLoading(true);
      const res: any = await authApi.login({ identifier: identifier.trim(), password });
      // Monitoring (big-screen) accounts are web-only; the app refuses them
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
      // The server says plainly whether the account is unknown, the password is wrong or the
      // account awaits approval, so the driver sees that sentence as-is. Technical detail is
      // shown only when the server could not be reached at all (then the address is what matters).
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
    <View style={styles.container}>
      <StatusBar style="light" />
      {/* Navy behind the top of the scroll view, so an over-scroll at the top stays navy rather than grey */}
      <View style={[styles.heroBackdrop, { height: heroHeight }]} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero: logo tile, product name, one-line tagline, centred in the navy block */}
          <View style={[styles.hero, { minHeight: heroHeight, paddingTop: insets.top + space.md }]}>
            <View style={styles.logoTile}>
              <Image source={require('../assets/log.png')} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Text style={styles.brand}>Excellent Construction</Text>
            <Text style={styles.tagline}>{t('login.portal')}</Text>
          </View>

          {/* Form card, floating over the hero's bottom edge */}
          <View style={[styles.body, { paddingBottom: insets.bottom + space.lg }]}>
            <View style={styles.card}>
              <View style={styles.field}>
                <Text style={styles.label}>{t('login.account')}</Text>
                <View style={[styles.inputWrap, focused === 'id' && styles.inputWrapFocused]}>
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
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t('login.password')}</Text>
                <View style={[styles.inputWrap, focused === 'pw' && styles.inputWrapFocused]}>
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
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textFaint} />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('login.login')}</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Secondary action as a text link: the amber button is the only filled control on the screen */}
            <View style={styles.registerRow}>
              <Text style={styles.tip}>{t('login.noAccount')}</Text>
              <TouchableOpacity style={styles.registerBtn} onPress={() => router.push('/register')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.registerLink}>{t('login.register')}</Text>
              </TouchableOpacity>
            </View>

            {/* Pushes the version line to the bottom of the screen when the form is short */}
            <View style={styles.flex} />
            <Text style={styles.version}>v1.0.1</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Language switch: a global toggle, so it sits as a header button in the hero corner */}
      <TouchableOpacity
        onPress={toggle}
        style={[styles.langBtn, { top: insets.top + space.md }]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.85}
      >
        <Text style={styles.langBtnText}>{t('login.langToggle')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
  },
  heroBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.hero,
  },
  hero: {
    backgroundColor: colors.hero,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    // Room for the card that climbs over the bottom edge
    paddingBottom: CARD_OVERLAP + space.lg,
  },
  logoTile: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  logoImage: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
  },
  brand: {
    fontSize: font.xl,
    fontWeight: weight.bold,
    color: colors.heroText,
    textAlign: 'center',
  },
  tagline: {
    fontSize: font.sm,
    color: colors.heroMuted,
    marginTop: space.xs,
    textAlign: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: space.lg,
    backgroundColor: colors.bg,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    marginTop: -CARD_OVERLAP,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    ...shadow.card,
  },
  field: {
    marginBottom: space.lg,
  },
  label: {
    fontSize: font.xs,
    fontWeight: weight.medium,
    color: colors.textFaint,
    letterSpacing: 0.2,
    marginBottom: space.xs,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: hit.min,
    paddingHorizontal: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    // Clips the input (and its web focus ring) inside the border, so the amber focus border stays whole
    overflow: 'hidden',
  },
  inputWrapFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    paddingVertical: 0,
    fontSize: font.base,
    color: colors.text,
    // The amber border on the wrapper shows focus; on web the browser ring is painted in the
    // focused wrapper colour so it disappears instead of drawing a second, black ring
    outlineWidth: 0,
    outlineColor: colors.surface,
  },
  eyeBtn: {
    width: hit.min,
    height: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    // A 48pt tap target that still sits flush with the right edge of the input
    marginRight: -space.md,
  },
  primaryBtn: {
    height: hit.min,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  primaryBtnText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.semibold,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
  },
  tip: {
    color: colors.textMuted,
    fontSize: font.sm,
  },
  registerBtn: {
    minHeight: hit.min,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  registerLink: {
    color: colors.accentDark,
    fontSize: font.sm,
    fontWeight: weight.semibold,
  },
  langBtn: {
    position: 'absolute',
    right: space.lg,
    zIndex: 10,
    minWidth: hit.compact,
    height: hit.compact,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.heroAlt,
    borderWidth: 1,
    borderColor: colors.heroBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langBtnText: {
    color: colors.heroText,
    fontSize: font.sm,
    fontWeight: weight.semibold,
  },
  version: {
    textAlign: 'center',
    color: colors.textFaint,
    fontSize: font.xs,
    marginTop: space.lg,
  },
});
