import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import type { TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { authApi } from '../src/api';
import { useLang } from '../src/i18n';
import { showAppAlert } from '../src/AppDialog';
import { colors, space, font, weight, radius, hit, shadow } from '../src/theme';

/** How far the form card climbs over the hero's bottom edge */
const CARD_OVERLAP = space.xxxl;

/** Navy header shared by the form and the success state: the login shell, with the screen title where the brand sits */
function Hero({ title, subtitle, topInset }: { title: string; subtitle: string; topInset: number }) {
  return (
    <View style={[styles.hero, { paddingTop: topInset + space.xl }]}>
      <View style={styles.logoTile}>
        <Image source={require('../assets/log.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroSubtitle}>{subtitle}</Text>
    </View>
  );
}

type FieldProps = TextInputProps & {
  name: string;
  label: string;
  focused: string | null;
  setFocused: (name: string | null) => void;
  /** Trailing controls inside the field, such as the eye button */
  children?: React.ReactNode;
};

/** A caption label over a 48pt field on the inner surface; focus is the only time the accent appears */
function Field({ name, label, focused, setFocused, children, ...props }: FieldProps) {
  const active = focused === name;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, active && styles.inputWrapFocused]}>
        <TextInput
          style={styles.input}
          placeholderTextColor={colors.textFaint}
          onFocus={() => setFocused(name)}
          onBlur={() => setFocused(null)}
          {...props}
        />
        {children}
      </View>
    </View>
  );
}

export default function RegisterScreen() {
  const router = useRouter();
  const { t } = useLang();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', fullName: '', phone: '', password: '' });
  const [role, setRole] = useState<'driver' | 'client' | ''>('');
  const [focused, setFocused] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (form.username.trim().length < 3) return showAppAlert(t('reg.notice'), t('reg.tipUsername'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return showAppAlert(t('reg.notice'), t('reg.tipEmail'));
    if (!form.fullName.trim()) return showAppAlert(t('reg.notice'), t('reg.tipFullName'));
    if (!role) return showAppAlert(t('reg.notice'), t('reg.tipRole'));
    if (form.password.length < 8) return showAppAlert(t('reg.notice'), t('reg.tipPassword'));
    try {
      setLoading(true);
      await authApi.register({
        username: form.username.trim(),
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || undefined,
        role,
        password: form.password,
      });
      setSuccess(true);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || t('reg.failed');
      showAppAlert(t('reg.failed'), typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  const hero = <Hero title={t('reg.title')} subtitle={t('reg.subtitle')} topInset={insets.top} />;
  const bodyStyle = [styles.body, { paddingBottom: insets.bottom + space.lg }];

  if (success) {
    return (
      <View style={styles.bg}>
        <StatusBar style="light" />
        <View style={styles.heroBackdrop} />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {hero}
          <View style={bodyStyle}>
            <View style={styles.card}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark" size={32} color={colors.success} />
              </View>
              <Text style={styles.successTitle}>{t('reg.successTitle')}</Text>
              <Text style={styles.successDesc}>{t('reg.successDesc')}</Text>
              <TouchableOpacity style={styles.submitBtn} onPress={() => router.replace('/login')} activeOpacity={0.85}>
                <Text style={styles.submitText}>{t('reg.backLogin')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.bg}>
      <StatusBar style="light" />
      {/* Navy behind the top of the scroll view, so an over-scroll at the top stays navy rather than grey */}
      <View style={styles.heroBackdrop} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {hero}
          <View style={bodyStyle}>
            {/* Form card, floating over the hero's bottom edge */}
            <View style={styles.card}>
              <Field label={t('login.account')} placeholder={t('reg.usernamePh')} value={form.username}
                onChangeText={(v: string) => set('username', v)} name="username" focused={focused} setFocused={setFocused} autoCapitalize="none" />
              <Field label={t('profile.email')} placeholder={t('reg.emailPh')} value={form.email}
                onChangeText={(v: string) => set('email', v)} name="email" focused={focused} setFocused={setFocused} keyboardType="email-address" autoCapitalize="none" />
              <Field label={t('profile.name')} placeholder={t('reg.fullNamePh')} value={form.fullName}
                onChangeText={(v: string) => set('fullName', v)} name="fullName" focused={focused} setFocused={setFocused} />
              <Field label={t('profile.phone')} placeholder={t('reg.phonePh')} value={form.phone}
                onChangeText={(v: string) => set('phone', v)} name="phone" focused={focused} setFocused={setFocused} keyboardType="phone-pad" />

              {/* Role: a segmented control on the field surface; the chosen segment is ink, amber stays with the primary button */}
              <View style={styles.field}>
                <Text style={styles.label}>{t('reg.role')}</Text>
                <View style={styles.segment}>
                  <TouchableOpacity
                    style={[styles.segmentBtn, role === 'driver' && styles.segmentBtnActive]}
                    onPress={() => setRole('driver')}
                    activeOpacity={0.85}
                    hitSlop={{ top: space.xs, bottom: space.xs }}
                  >
                    <Text style={[styles.segmentText, role === 'driver' && styles.segmentTextActive]}>{t('reg.roleDriver')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentBtn, role === 'client' && styles.segmentBtnActive]}
                    onPress={() => setRole('client')}
                    activeOpacity={0.85}
                    hitSlop={{ top: space.xs, bottom: space.xs }}
                  >
                    <Text style={[styles.segmentText, role === 'client' && styles.segmentTextActive]}>{t('reg.roleClient')}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Field label={t('login.password')} placeholder={t('reg.passwordPh')} value={form.password}
                onChangeText={(v: string) => set('password', v)} name="password" focused={focused} setFocused={setFocused} secureTextEntry={!showPassword}>
                <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textFaint} />
                </TouchableOpacity>
              </Field>

              <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={loading} activeOpacity={0.85}>
                {loading ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.submitText}>{t('reg.submit')}</Text>}
              </TouchableOpacity>
            </View>

            {/* Secondary action as a text link, as on the login screen */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('reg.haveAccount')}</Text>
              <TouchableOpacity style={styles.footerBtn} onPress={() => router.replace('/login')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.footerLink}>{t('reg.backLogin')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
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
    height: '35%',
    backgroundColor: colors.hero,
  },
  hero: {
    backgroundColor: colors.hero,
    alignItems: 'center',
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
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
  },
  heroTitle: {
    fontSize: font.xl,
    fontWeight: weight.bold,
    color: colors.heroText,
    textAlign: 'center',
  },
  heroSubtitle: {
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
  segment: {
    flexDirection: 'row',
    gap: space.xs,
    height: hit.min,
    padding: space.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentBtn: {
    flex: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.text,
  },
  segmentText: {
    fontSize: font.sm,
    color: colors.textMuted,
    fontWeight: weight.medium,
  },
  segmentTextActive: {
    color: colors.surface,
    fontWeight: weight.semibold,
  },
  submitBtn: {
    height: hit.min,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.semibold,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: font.sm,
  },
  footerBtn: {
    minHeight: hit.min,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  footerLink: {
    color: colors.accentDark,
    fontSize: font.sm,
    fontWeight: weight.semibold,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.lg,
  },
  successTitle: {
    fontSize: font.lg,
    fontWeight: weight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  successDesc: {
    fontSize: font.sm,
    lineHeight: 20,
    color: colors.textMuted,
    marginTop: space.sm,
    marginBottom: space.xl,
    textAlign: 'center',
  },
});
