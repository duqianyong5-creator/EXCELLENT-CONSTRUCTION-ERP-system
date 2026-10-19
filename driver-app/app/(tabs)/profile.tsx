import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { usersApi } from '../../src/api';
import { logout, updateUser } from '../../src/store/authSlice';
import type { RootState } from '../../src/store';
import { useLang } from '../../src/i18n';
import { showAppAlert } from '../../src/AppDialog';
import { colors, space, font, weight, radius, hit } from '../../src/theme';

export default function ProfileScreen() {
  const dispatch = useDispatch();
  const router = useRouter();
  const { user } = useSelector((s: RootState) => s.auth);
  const { t, toggle } = useLang();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [saving, setSaving] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      await usersApi.updateProfile({ fullName, phone, email });
      dispatch(updateUser({ fullName, phone, email }));
      const stored = await SecureStore.getItemAsync('user');
      if (stored) {
        const u = JSON.parse(stored);
        await SecureStore.setItemAsync('user', JSON.stringify({ ...u, fullName, phone, email }));
      }
      showAppAlert(t('profile.saved'));
    } catch (err: any) {
      showAppAlert(t('common.fail'), err.message || t('profile.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd) {
      showAppAlert(t('common.notice'), t('profile.pwBothRequired'));
      return;
    }
    if (newPwd.length < 6) {
      showAppAlert(t('common.notice'), t('profile.pwMin6'));
      return;
    }
    try {
      setChangingPwd(true);
      await usersApi.changePassword({ oldPassword: oldPwd, newPassword: newPwd });
      setOldPwd('');
      setNewPwd('');
      showAppAlert(t('profile.pwChanged'), t('profile.reLogin'));
      handleLogout();
    } catch (err: any) {
      showAppAlert(t('common.fail'), err.message || t('profile.pwChangeFailed'));
    } finally {
      setChangingPwd(false);
    }
  };

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('user');
    dispatch(logout());
    router.replace('/login');
  };

  const confirmLogout = () => {
    showAppAlert(t('profile.logout'), t('profile.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.exit'), style: 'destructive', onPress: handleLogout },
    ]);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 头部 */}
      <View style={[styles.header, { paddingTop: insets.top + space.xxl }]}>
        <View style={styles.headerBg}>
          <View style={styles.decorCircle1} />
          <View style={styles.decorCircle2} />
        </View>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {String(user?.fullName || user?.username || '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.name}>{user?.fullName || user?.username}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.roleBadge}>
          <Ionicons name="id-card-outline" size={16} color={colors.accent} style={{ marginRight: space.sm }} />
          <Text style={styles.roleText}>{t('role.' + (user?.role || 'driver'))}</Text>
        </View>
      </View>

      {/* 基本信息 */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionIconBox}>
            <Ionicons name="person-outline" size={16} color={colors.accent} />
          </View>
          <Text style={styles.sectionTitle}>{t('profile.basicInfo')}</Text>
        </View>

        <Text style={styles.label}>{t('profile.name')}</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder={t('profile.namePh')}
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <Text style={styles.label}>{t('profile.phone')}</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder={t('profile.phonePh')}
            keyboardType="phone-pad"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <Text style={styles.label}>{t('profile.email')}</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder={t('profile.emailPh')}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <TouchableOpacity
          style={[styles.btn, styles.primaryBtn, saving && styles.btnDisabled]}
          onPress={handleSaveProfile}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.btnText}>{t('profile.save')}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 修改密码 */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionIconBox}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.accent} />
          </View>
          <Text style={styles.sectionTitle}>{t('profile.changePw')}</Text>
        </View>

        <Text style={styles.label}>{t('profile.oldPw')}</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={oldPwd}
            onChangeText={setOldPwd}
            secureTextEntry
            placeholder={t('profile.oldPwPh')}
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <Text style={styles.label}>{t('profile.newPw')}</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={newPwd}
            onChangeText={setNewPwd}
            secureTextEntry
            placeholder={t('profile.min6')}
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <TouchableOpacity
          style={[styles.btn, styles.primaryBtn, changingPwd && styles.btnDisabled]}
          onPress={handleChangePassword}
          disabled={changingPwd}
          activeOpacity={0.8}
        >
          {changingPwd ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.btnText}>{t('profile.changePw')}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 设置：语言开关原来只在登录页有，登进来之后就再也切不了 */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionIconBox}>
            <Ionicons name="settings-outline" size={16} color={colors.accent} />
          </View>
          <Text style={styles.sectionTitle}>{t('profile.settings')}</Text>
        </View>
        <TouchableOpacity style={styles.settingRow} onPress={toggle} activeOpacity={0.8}>
          <Ionicons name="language-outline" size={20} color={colors.textMuted} />
          <Text style={styles.settingLabel}>{t('profile.language')}</Text>
          <View style={styles.settingValuePill}>
            <Text style={styles.settingValue}>{t('profile.languageValue')}</Text>
            <Ionicons name="swap-horizontal" size={16} color={colors.accent} />
          </View>
        </TouchableOpacity>
      </View>

      {/* 退出登录 */}
      <TouchableOpacity
        style={styles.logoutBtn}
        onPress={confirmLogout}
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.danger} />
        <Text style={styles.logoutText}>{t('profile.logout')}</Text>
      </TouchableOpacity>

      <Text style={styles.version}>{t('profile.version')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
    position: 'relative',
    overflow: 'hidden',
  },
  headerBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
    backgroundColor: colors.surface,
  },
  decorCircle1: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 150,
    height: 150,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    opacity: 0.08,
  },
  decorCircle2: {
    position: 'absolute',
    top: -30,
    left: -30,
    width: 120,
    height: 120,
    borderRadius: radius.pill,
    backgroundColor: colors.accentDark,
    opacity: 0.05,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: space.lg,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: font.display,
    color: colors.onAccent,
    fontWeight: weight.heavy,
  },
  name: {
    fontSize: font.xl,
    fontWeight: weight.heavy,
    color: colors.text,
    marginBottom: space.xs,
    textAlign: 'center',
  },
  email: {
    fontSize: font.sm,
    color: colors.textMuted,
    marginBottom: space.md,
    textAlign: 'center',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  roleText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: weight.bold,
  },
  section: {
    backgroundColor: colors.surface,
    margin: space.lg,
    marginBottom: 0,
    borderRadius: radius.lg,
    padding: space.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  sectionIconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: font.lg,
    fontWeight: weight.bold,
    color: colors.text,
  },
  label: {
    fontSize: font.sm,
    color: colors.textMuted,
    marginBottom: space.sm,
    fontWeight: weight.medium,
  },
  inputContainer: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.lg,
  },
  input: {
    minHeight: hit.min,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    fontSize: font.base,
    color: colors.text,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: hit.min,
  },
  settingLabel: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.semibold,
  },
  settingValuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: hit.compact,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  settingValue: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: weight.bold,
  },
  logoutBtn: {
    backgroundColor: colors.dangerSoft,
    margin: space.lg,
    marginTop: space.xl,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  logoutText: {
    color: colors.danger,
    fontSize: font.base,
    fontWeight: weight.bold,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.bold,
  },
  version: {
    textAlign: 'center',
    color: colors.textFaint,
    fontSize: font.xs,
    marginVertical: space.xl,
  },
});
