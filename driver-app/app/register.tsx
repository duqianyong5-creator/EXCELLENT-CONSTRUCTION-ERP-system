import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { authApi } from '../src/api';
import { useLang } from '../src/i18n';
import { showAppAlert } from '../src/AppDialog';
import { colors, space, font, weight, radius, hit } from '../src/theme';

function Field({ icon, name, focused, setFocused, ...props }: any) {
  return (
    <View style={[styles.inputWrap, focused === name && styles.inputWrapFocused]}>
      <Ionicons name={icon} size={20} color={focused === name ? colors.accent : colors.textFaint} />
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textFaint}
        onFocus={() => setFocused(name)}
        onBlur={() => setFocused(null)}
        {...props}
      />
    </View>
  );
}

export default function RegisterScreen() {
  const router = useRouter();
  const { t } = useLang();
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

  if (success) {
    return (
      <View style={[styles.bg, { justifyContent: 'center', padding: space.xxl }]}>
        <View style={styles.card}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={44} color={colors.text} />
          </View>
          <Text style={styles.title}>{t('reg.successTitle')}</Text>
          <Text style={styles.subtitle}>{t('reg.successDesc')}</Text>
          <TouchableOpacity style={styles.submitBtn} onPress={() => router.replace('/login')} activeOpacity={0.85}>
            <Text style={styles.submitText}>{t('reg.backLogin')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.bg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.logoPlate}>
              <Image source={require('../assets/log.png')} style={styles.logo} resizeMode="contain" />
            </View>
            <Text style={styles.title}>{t('reg.title')}</Text>
            <Text style={styles.subtitle}>{t('reg.subtitle')}</Text>
          </View>

          <Field icon="person-outline" placeholder={t('reg.usernamePh')} value={form.username}
            onChangeText={(v: string) => set('username', v)} name="username" focused={focused} setFocused={setFocused} autoCapitalize="none" />
          <Field icon="mail-outline" placeholder={t('reg.emailPh')} value={form.email}
            onChangeText={(v: string) => set('email', v)} name="email" focused={focused} setFocused={setFocused} keyboardType="email-address" autoCapitalize="none" />
          <Field icon="id-card-outline" placeholder={t('reg.fullNamePh')} value={form.fullName}
            onChangeText={(v: string) => set('fullName', v)} name="fullName" focused={focused} setFocused={setFocused} />
          <Field icon="call-outline" placeholder={t('reg.phonePh')} value={form.phone}
            onChangeText={(v: string) => set('phone', v)} name="phone" focused={focused} setFocused={setFocused} keyboardType="phone-pad" />

          <Text style={styles.roleLabel}>{t('reg.role')}</Text>
          <View style={styles.roleRow}>
            <TouchableOpacity style={[styles.roleBtn, role === 'driver' && styles.roleBtnActive]} onPress={() => setRole('driver')}>
              <Text style={[styles.roleText, role === 'driver' && styles.roleTextActive]}>{t('reg.roleDriver')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.roleBtn, role === 'client' && styles.roleBtnActive]} onPress={() => setRole('client')}>
              <Text style={[styles.roleText, role === 'client' && styles.roleTextActive]}>{t('reg.roleClient')}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.inputWrap, focused === 'password' && styles.inputWrapFocused, { marginTop: space.lg }]}>
            <Ionicons name="lock-closed-outline" size={20} color={focused === 'password' ? colors.accent : colors.textFaint} />
            <TextInput style={styles.input} placeholder={t('reg.passwordPh')} placeholderTextColor={colors.textFaint}
              value={form.password} onChangeText={(v) => set('password', v)} secureTextEntry={!showPassword}
              onFocus={() => setFocused('password')} onBlur={() => setFocused(null)} />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.submitText}>{t('reg.submit')}</Text>}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('reg.haveAccount')}</Text>
            <TouchableOpacity style={styles.footerBtn} onPress={() => router.replace('/login')}>
              <Text style={styles.footerLink}>{t('reg.backLogin')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    // 深色底上阴影看不见，卡片靠底色差 + 一根发丝描边抬起来（和登录页同一处理）
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: { alignItems: 'center', marginBottom: space.xxl },
  // logo 本身是深色图：和登录页一样垫一块浅色底板，否则在深色卡片上几乎看不见
  logoPlate: {
    width: 88, height: 88, borderRadius: radius.xl, backgroundColor: colors.text,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.md,
  },
  logo: { width: 80, height: 80, borderRadius: radius.lg },
  title: { fontSize: font.xl, fontWeight: weight.heavy, color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: space.xs, textAlign: 'center' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: space.lg, marginBottom: space.lg, backgroundColor: colors.surfaceAlt,
    minHeight: hit.min,
  },
  inputWrapFocused: { borderColor: colors.accent, backgroundColor: colors.bg },
  input: { flex: 1, minWidth: 0, paddingVertical: space.md, fontSize: font.base, color: colors.text },
  eyeBtn: {
    width: hit.min,
    height: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    // 触区撑到 48，但视觉上仍贴着右边距
    marginRight: -space.md,
  },
  roleLabel: { fontSize: font.sm, color: colors.textMuted, fontWeight: weight.semibold, marginBottom: space.sm },
  roleRow: { flexDirection: 'row', gap: space.md },
  roleBtn: {
    flex: 1, paddingVertical: space.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    minHeight: hit.min,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  roleBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  roleText: { fontSize: font.sm, color: colors.textMuted, fontWeight: weight.semibold },
  roleTextActive: { color: colors.accent },
  submitBtn: {
    minHeight: hit.min, paddingVertical: space.lg, borderRadius: radius.md, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginTop: space.xl,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: colors.onAccent, fontSize: font.lg, fontWeight: weight.heavy, letterSpacing: 0.3 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  footerText: { color: colors.textFaint, fontSize: font.sm },
  footerBtn: { minHeight: hit.min, justifyContent: 'center', paddingHorizontal: space.sm },
  footerLink: { color: colors.accent, fontSize: font.sm, fontWeight: weight.bold },
  successIcon: {
    width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: space.lg,
  },
});
