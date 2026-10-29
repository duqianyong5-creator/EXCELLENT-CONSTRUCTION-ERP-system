import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, ScrollView, ActivityIndicator,
} from 'react-native';
import type { TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useDispatch, useSelector } from 'react-redux';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { usersApi } from '../../src/api';
import { logout, updateUser } from '../../src/store/authSlice';
import type { RootState } from '../../src/store';
import { useLang } from '../../src/i18n';
import { showAppAlert } from '../../src/AppDialog';
import { colors, space, font, weight, radius, hit, shadow } from '../../src/theme';

/** How far the first card climbs over the hero's bottom edge */
const CARD_OVERLAP = space.xl;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** Card title row: a 32px amber icon chip beside a quiet title */
function SectionHeader({ icon, title }: { icon: IoniconName; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIconChip}>
        <Ionicons name={icon} size={16} color={colors.accent} />
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

type FieldProps = TextInputProps & {
  name: string;
  label: string;
  focused: string | null;
  setFocused: (name: string | null) => void;
};

/** A caption label over a 48pt field on the inner surface; focus is the only time the accent appears */
function Field({ name, label, focused, setFocused, ...props }: FieldProps) {
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
      </View>
    </View>
  );
}

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
  const [focused, setFocused] = useState<string | null>(null);

  // The hero sits under the status bar, so the status icons go light while this tab is on screen.
  // The <StatusBar> is mounted only while focused, so it hands the style back when the tab blurs.
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));

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
    <View style={styles.container}>
      {isFocused && <StatusBar style="light" />}
      {/* Navy behind the top of the scroll view, so an over-scroll at the top stays navy rather than grey */}
      <View style={styles.heroBackdrop} />

      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero: avatar tile, name, e-mail, outlined role pill */}
        <View style={[styles.hero, { paddingTop: insets.top + space.lg }]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {String(user?.fullName || user?.username || '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>{user?.fullName || user?.username}</Text>
          <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
          <View style={styles.rolePill}>
            <Text style={styles.roleText}>{t('role.' + (user?.role || 'driver'))}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* Basic info */}
          <View style={[styles.card, styles.firstCard]}>
            <SectionHeader icon="person-outline" title={t('profile.basicInfo')} />

            <Field
              name="fullName"
              label={t('profile.name')}
              value={fullName}
              onChangeText={setFullName}
              placeholder={t('profile.namePh')}
              focused={focused}
              setFocused={setFocused}
            />
            <Field
              name="phone"
              label={t('profile.phone')}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('profile.phonePh')}
              keyboardType="phone-pad"
              focused={focused}
              setFocused={setFocused}
            />
            <Field
              name="email"
              label={t('profile.email')}
              value={email}
              onChangeText={setEmail}
              placeholder={t('profile.emailPh')}
              keyboardType="email-address"
              autoCapitalize="none"
              focused={focused}
              setFocused={setFocused}
            />

            <TouchableOpacity
              style={[styles.primaryBtn, saving && styles.btnDisabled]}
              onPress={handleSaveProfile}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.primaryBtnText}>{t('profile.save')}</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Change password */}
          <View style={styles.card}>
            <SectionHeader icon="lock-closed-outline" title={t('profile.changePw')} />

            <Field
              name="oldPwd"
              label={t('profile.oldPw')}
              value={oldPwd}
              onChangeText={setOldPwd}
              secureTextEntry
              placeholder={t('profile.oldPwPh')}
              focused={focused}
              setFocused={setFocused}
            />
            <Field
              name="newPwd"
              label={t('profile.newPw')}
              value={newPwd}
              onChangeText={setNewPwd}
              secureTextEntry
              placeholder={t('profile.min6')}
              focused={focused}
              setFocused={setFocused}
            />

            <TouchableOpacity
              style={[styles.primaryBtn, changingPwd && styles.btnDisabled]}
              onPress={handleChangePassword}
              disabled={changingPwd}
              activeOpacity={0.85}
            >
              {changingPwd ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.primaryBtnText}>{t('profile.changePw')}</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Settings: the language switch lives here so it stays reachable after login */}
          <View style={styles.card}>
            <SectionHeader icon="settings-outline" title={t('profile.settings')} />
            <TouchableOpacity style={styles.settingRow} onPress={toggle} activeOpacity={0.7}>
              <Ionicons name="language-outline" size={16} color={colors.textMuted} />
              <Text style={styles.settingLabel}>{t('profile.language')}</Text>
              <Text style={styles.settingValue}>{t('profile.languageValue')}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          {/* Sign out: outlined danger, never a filled red block */}
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={confirmLogout}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.logoutText}>{t('profile.logout')}</Text>
          </TouchableOpacity>

          <Text style={styles.version}>{t('profile.version')}</Text>
        </View>
      </ScrollView>
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
    paddingBottom: space.xxl,
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
    paddingHorizontal: space.lg,
    // Room for the first card that climbs over the bottom edge
    paddingBottom: CARD_OVERLAP + space.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  avatarText: {
    fontSize: font.xl,
    fontWeight: weight.bold,
    color: colors.hero,
  },
  name: {
    fontSize: font.lg,
    fontWeight: weight.semibold,
    color: colors.heroText,
    textAlign: 'center',
  },
  email: {
    fontSize: font.sm,
    color: colors.heroMuted,
    marginTop: space.xs,
    textAlign: 'center',
  },
  rolePill: {
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.heroMuted,
  },
  roleText: {
    color: colors.heroMuted,
    fontSize: font.xs,
    fontWeight: weight.medium,
    letterSpacing: 0.2,
  },
  body: {
    flex: 1,
    paddingHorizontal: space.lg,
    backgroundColor: colors.bg,
    gap: space.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow.card,
  },
  firstCard: {
    marginTop: -CARD_OVERLAP,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  sectionIconChip: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: font.base,
    fontWeight: weight.semibold,
    color: colors.text,
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
    fontWeight: weight.medium,
  },
  settingValue: {
    color: colors.textMuted,
    fontSize: font.sm,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: hit.min,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  logoutText: {
    color: colors.danger,
    fontSize: font.base,
    fontWeight: weight.semibold,
  },
  version: {
    textAlign: 'center',
    color: colors.textFaint,
    fontSize: font.xs,
    marginTop: space.xs,
  },
});
