import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLang } from './i18n';
import { colors, space, font, weight, radius, hit, shadow } from './theme';


type Btn = { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' };
type DialogState = { visible: boolean; title: string; message?: string; buttons: Btn[] };

/** How a button is drawn: one filled confirm, a red one when destructive, a text-style cancel */
type BtnKind = 'primary' | 'danger' | 'quiet' | 'cancel';

// 全局可调用的主题化弹窗（替代系统白底 Alert.alert，与 App 的卡片+琥珀风格统一）
let _show: (title: string, message?: string, buttons?: Btn[]) => void = () => {};

export function showAppAlert(title: string, message?: string, buttons?: Btn[]) {
  _show(title, message, buttons);
}

export default function AppDialog() {
  const { t } = useLang();
  const [s, setS] = useState<DialogState>({ visible: false, title: '', buttons: [] });

  useEffect(() => {
    _show = (title, message, buttons) =>
      setS({ visible: true, title, message, buttons: buttons || [] });
    return () => { _show = () => {}; };
  }, []);

  const close = () => setS((p) => ({ ...p, visible: false }));
  const handle = (b: Btn) => { close(); if (b.onPress) setTimeout(b.onPress, 10); };

  // No buttons given: a single "close"
  const buttons: Btn[] = s.buttons.length ? s.buttons : [{ text: t('common.close') }];
  // Three or more choices stack vertically like an action sheet; one or two sit side by side
  const stacked = buttons.length > 2;
  // Only the last plain choice is filled amber; in a stack every choice stays quiet
  const lastDefault = stacked
    ? -1
    : buttons.map((b) => !b.style || b.style === 'default').lastIndexOf(true);
  const kindOf = (b: Btn, i: number): BtnKind => {
    if (b.style === 'cancel') return 'cancel';
    if (b.style === 'destructive') return 'danger';
    return i === lastDefault ? 'primary' : 'quiet';
  };

  return (
    <Modal visible={s.visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{s.title}</Text>
          {!!s.message && <Text style={styles.message}>{s.message}</Text>}
          <View style={[styles.btnRow, stacked && styles.btnCol]}>
            {buttons.map((b, i) => {
              const kind = kindOf(b, i);
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.btn, stacked ? styles.btnFull : styles.btnFlex, btnStyle[kind]]}
                  activeOpacity={0.8}
                  onPress={() => handle(b)}
                >
                  <Text style={[styles.btnText, btnTextStyle[kind]]} numberOfLines={1}>
                    {b.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // The scrim covers any page, so it is not one of the palette's surfaces: a translucent navy
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    ...shadow.raised,
  },
  title: {
    color: colors.text,
    fontSize: font.lg,
    lineHeight: 24,
    fontWeight: weight.semibold,
  },
  message: {
    color: colors.textMuted,
    fontSize: font.sm,
    lineHeight: 20,
    marginTop: space.sm,
  },
  btnRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xl,
  },
  btnCol: {
    flexDirection: 'column',
  },
  btn: {
    // 对话框按钮是最常被误点的地方，给足可点高度（司机可能戴手套）
    height: hit.min,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Side by side: share the row equally
  btnFlex: {
    flex: 1,
  },
  // Stacked: full width at the fixed height (no flex, which would collapse the height on web)
  btnFull: {
    width: '100%',
  },
  btnText: {
    fontSize: font.base,
    fontWeight: weight.semibold,
  },
});

const btnStyle: Record<BtnKind, object> = {
  primary: { backgroundColor: colors.accent },
  danger: { backgroundColor: colors.danger },
  quiet: { backgroundColor: colors.surfaceAlt },
  // A text button: no box, so the one filled confirm is the only thing that stands out
  cancel: { backgroundColor: 'transparent' },
};

const btnTextStyle: Record<BtnKind, object> = {
  primary: { color: colors.onAccent },
  danger: { color: colors.heroText },
  quiet: { color: colors.text },
  cancel: { color: colors.textMuted },
};
