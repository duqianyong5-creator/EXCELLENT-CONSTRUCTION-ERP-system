import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, space, font, weight, radius, hit } from './theme';


type Btn = { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' };
type DialogState = { visible: boolean; title: string; message?: string; buttons: Btn[] };

// 全局可调用的主题化弹窗（替代系统白底 Alert.alert，与 App 暗色+琥珀风格统一）
let _show: (title: string, message?: string, buttons?: Btn[]) => void = () => {};

export function showAppAlert(title: string, message?: string, buttons?: Btn[]) {
  _show(title, message, buttons);
}

export default function AppDialog() {
  const [s, setS] = useState<DialogState>({ visible: false, title: '', buttons: [] });

  useEffect(() => {
    _show = (title, message, buttons) =>
      setS({ visible: true, title, message, buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }] });
    return () => { _show = () => {}; };
  }, []);

  const close = () => setS((p) => ({ ...p, visible: false }));
  const handle = (b: Btn) => { close(); if (b.onPress) setTimeout(b.onPress, 10); };

  const stacked = s.buttons.length > 2;

  return (
    <Modal visible={s.visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{s.title}</Text>
          {!!s.message && <Text style={styles.message}>{s.message}</Text>}
          <View style={[styles.btnRow, stacked && styles.btnCol]}>
            {s.buttons.map((b, i) => {
              const cancel = b.style === 'cancel';
              const danger = b.style === 'destructive';
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.btn,
                    stacked && styles.btnFull,
                    cancel ? styles.btnCancel : danger ? styles.btnDanger : styles.btnPrimary,
                  ]}
                  activeOpacity={0.85}
                  onPress={() => handle(b)}
                >
                  <Text
                    style={[
                      styles.btnText,
                      cancel ? styles.btnTextCancel : { color: colors.onAccent },
                    ]}
                  >
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
    // 遮罩盖的是任意页面，不属于色板里的任何一种"表面"，所以保留字面值
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
  },
  title: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
  },
  message: {
    color: colors.textMuted,
    fontSize: font.sm,
    lineHeight: 21,
    marginTop: space.md,
  },
  btnRow: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xl,
  },
  btnCol: {
    flexDirection: 'column',
  },
  btn: {
    flex: 1,
    // 对话框按钮是最常被误点的地方，给足可点高度（司机可能戴手套）
    minHeight: hit.min,
    paddingVertical: space.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFull: {
    flex: 0,
    width: '100%',
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  // 红色按钮上用深色字：白字在 #EF4444 上只有 3.60:1（不达标），深色是 4.93:1。
  // 这是退出登录、删除任务、取消任务的确认按钮，最不该看不清。
  btnDanger: {
    backgroundColor: colors.danger,
  },
  btnCancel: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  btnText: {
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  btnTextCancel: {
    color: colors.textMuted,
  },
});
