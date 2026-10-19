import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useSelector } from 'react-redux';
import type { RootState } from './store';
import { announcementsApi } from './api';
import { useLang } from './i18n';
import { colors, space, font, weight, radius, hit, shadow } from './theme';

const SEEN_KEY = 'seen_announcements';

const TARGET_LABEL: Record<string, { key: string; color: string; soft: string }> = {
  all: { key: 'ann.targetAll', color: colors.info, soft: colors.infoSoft },
  client: { key: 'role.client', color: colors.success, soft: colors.successSoft },
  driver: { key: 'role.driver', color: colors.accent, soft: colors.accentSoft },
};

export default function AnnouncementModal() {
  const { user } = useSelector((s: RootState) => s.auth);
  const { t } = useLang();
  const [items, setItems] = useState<any[]>([]);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  visibleRef.current = visible;

  // 拉取生效公告，挑出本机未看过的弹出。轮询 + 回到前台时再查，
  // 这样网页端刚发的公告即使 app 已经开着也能在 ~30 秒内弹出。
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      if (visibleRef.current) return; // 弹窗正开着就不打断
      try {
        const data: any = await announcementsApi.feed();
        const list = Array.isArray(data) ? data : [];
        if (!list.length) return;
        let seen: string[] = [];
        try {
          const raw = await SecureStore.getItemAsync(SEEN_KEY);
          if (raw) seen = JSON.parse(raw);
        } catch { /* ignore */ }
        const unseen = list.filter((a: any) => !seen.includes(a.id));
        if (!cancelled && unseen.length) {
          setItems(unseen);
          setVisible(true);
        }
      } catch { /* ignore */ }
    };

    load();
    const interval = setInterval(load, 30000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, [user?.id]);

  const dismiss = async () => {
    setVisible(false);
    try {
      const raw = await SecureStore.getItemAsync(SEEN_KEY);
      const seen: string[] = raw ? JSON.parse(raw) : [];
      const merged = Array.from(new Set([...seen, ...items.map((a) => a.id)]));
      await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(merged.slice(-200)));
    } catch { /* ignore */ }
  };

  if (!visible || !items.length) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="megaphone" size={20} color={colors.accent} />
            </View>
            <Text style={styles.headerTitle}>{t('ann.title')}</Text>
          </View>

          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {items.map((a) => {
              const tg = TARGET_LABEL[a.targetRole] || TARGET_LABEL.all;
              return (
                <View key={a.id} style={styles.item}>
                  <View style={styles.itemTop}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{a.title}</Text>
                    <View style={[styles.badge, { backgroundColor: tg.soft, borderColor: tg.color }]}>
                      <Text style={[styles.badgeText, { color: tg.color }]}>{t(tg.key)}</Text>
                    </View>
                  </View>
                  <View style={styles.itemContentBox}>
                    <Text style={styles.itemContent}>{a.content}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.button} onPress={dismiss} activeOpacity={0.85}>
            <Text style={styles.buttonText}>{t('ann.gotIt')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // 遮罩没有对应的色板 token：它压的是任意页面，只能是半透明黑
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: space.xl,
    ...shadow.raised,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  headerIcon: {
    width: hit.compact,
    height: hit.compact,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.xl,
    fontWeight: weight.heavy,
  },
  item: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  itemTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
    // 标题长了要自己收窄，不能顶到右边的标签上
    flex: 1,
    minWidth: 0,
    marginRight: space.sm,
    lineHeight: 24,
  },
  itemContentBox: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  badge: {
    flexShrink: 0,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: font.xs,
    fontWeight: weight.bold,
  },
  itemContent: {
    color: colors.textMuted,
    fontSize: font.base,
    lineHeight: 24,
  },
  button: {
    marginTop: space.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: hit.min,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
});
