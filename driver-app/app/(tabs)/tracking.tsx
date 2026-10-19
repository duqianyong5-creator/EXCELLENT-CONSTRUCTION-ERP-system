import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  TouchableOpacity, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import LeafletMap from '../../src/LeafletMap';
import { gpsApi, tasksApi } from '../../src/api';
import type { RootState } from '../../src/store';
import { useLang } from '../../src/i18n';
import { colors, space, font, weight, radius, hit, shadow, statusColors } from '../../src/theme';

// 今天的任务，司机扫一眼要的是几点：只显示时分
function fmtTime(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

type DriverPos = {
  driverId: string;
  driverName?: string;
  taskId?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  timestamp?: string;
};

export default function TrackingScreen() {
  const { user } = useSelector((s: RootState) => s.auth);
  const { t } = useLang();
  const insets = useSafeAreaInsets();
  const role = user?.role || '';
  const [positions, setPositions] = useState<DriverPos[]>([]);
  const [driverTodayTasks, setDriverTodayTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DriverPos | null>(null);
  const timer = useRef<any>(null);

  const fetchPositions = useCallback(async () => {
    try {
      if (role === 'driver') {
        const tasks: any[] = (await tasksApi.today()) as any;
        setDriverTodayTasks(Array.isArray(tasks) ? tasks : []);
      } else if (role === 'admin' || role === 'dispatcher') {
        const data: any[] = (await gpsApi.positions()) as any;
        if (Array.isArray(data)) {
          setPositions(data.map((p) => ({
            driverId: p.driver_id ?? p.driverId ?? '',
            driverName: p.driverName ?? p.driver_name, // 后端已带账户名
            latitude: parseFloat(p.latitude),
            longitude: parseFloat(p.longitude),
            speed: p.speed,
            timestamp: p.timestamp,
            taskId: p.task_id ?? p.taskId,
          })));
        }
      } else if (role === 'client') {
        const tasks: any[] = (await tasksApi.list()) as any;
        const active = (Array.isArray(tasks) ? tasks : []).filter(
          (t) => t.status === 'in_progress' && (t.driverId || t.driver_id),
        );
        const results = await Promise.all(
          active.map((t) =>
            gpsApi.driverPosition(t.driverId ?? t.driver_id).catch(() => null),
          ),
        );
        const valid: DriverPos[] = [];
        results.forEach((pos: any, i) => {
          if (pos && pos.latitude && pos.longitude) {
            valid.push({
              driverId: active[i].driverId ?? active[i].driver_id,
              driverName: active[i].driverName ?? active[i].driver_name,
              taskId: active[i].id,
              latitude: parseFloat(pos.latitude),
              longitude: parseFloat(pos.longitude),
              speed: pos.speed,
              timestamp: pos.timestamp,
            });
          }
        });
        setPositions(valid);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    fetchPositions();
    timer.current = setInterval(fetchPositions, 15000);
    return () => clearInterval(timer.current);
  }, [fetchPositions]);

  const focusDriver = (pos: DriverPos) => {
    setSelected(pos);
  };

  const title = role === 'client' ? t('trk.titleClient') : t('trk.title');

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>{t('trk.loadingMap')}</Text>
      </View>
    );
  }

  if (role === 'driver') {
    return (
      <View style={styles.driverTodayContainer}>
        <View style={[styles.driverTodayHeader, { paddingTop: insets.top + space.xl }]}>
          <Text style={styles.driverTodayTitle}>{t('trk.todayTitle')}</Text>
          <Text style={styles.driverTodaySub}>{t('trk.todaySub')}</Text>
        </View>
        <FlatList
          data={driverTodayTasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.driverTodayList,
            driverTodayTasks.length === 0 && { flex: 1, justifyContent: 'center' },
          ]}
          renderItem={({ item, index }) => {
            const st = statusColors[item.status as keyof typeof statusColors] || statusColors.assigned;
            const time = fmtTime(item.scheduledAt);
            return (
              <View style={styles.driverTodayCard}>
                <View style={styles.driverTodayTop}>
                  <Text style={styles.driverTodayNo}>#{String(index + 1).padStart(2, '0')}</Text>
                  {!!time && (
                    <View style={styles.driverTodayTimeRow}>
                      <Ionicons name="time-outline" size={16} color={colors.text} />
                      <Text style={styles.driverTodayTime}>{time}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.driverTodayName} numberOfLines={1}>{item.title || t('d.taskFallback')}</Text>
                <Text style={styles.driverTodayMeta} numberOfLines={1}>
                  {(item.cargo || t('d.cargoFallback'))} · {item.endLocation || t('trk.noDest')}
                </Text>
                <View style={[styles.driverTodayStatus, { backgroundColor: st.bg, borderColor: st.border }]}>
                  <Text style={[styles.driverTodayStatusText, { color: st.text }]}>
                    {item.status === 'in_progress' ? t('d.sInProgress') : item.status === 'assigned' ? t('d.sToAccept') : t('d.fCompleted')}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.driverTodayEmpty}>
              <Ionicons name="clipboard-outline" size={40} color={colors.accent} style={{ marginBottom: space.md }} />
              <Text style={styles.driverTodayEmptyTitle}>{t('tasks.emptyTitle')}</Text>
              <Text style={styles.driverTodayEmptySub}>{t('trk.todayEmptySub')}</Text>
            </View>
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LeafletMap
        positions={positions}
        focusId={selected?.driverId}
        style={StyleSheet.absoluteFill}
        topInset={66}
        bottomInset={18}
      />

      {/* 顶部遮罩，保证系统状态栏图标在浅色地图上可读 */}
      <View style={styles.topScrim} pointerEvents="none" />

      {/* 悬浮标题胶囊（全屏地图） */}
      <View style={[styles.floatingHeader, { paddingTop: insets.top + space.md }]} pointerEvents="box-none">
        <View style={styles.headerPill}>
          <View style={[styles.onlineDot, positions.length === 0 && styles.onlineDotOff]} />
          <View style={styles.headerTexts}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {positions.length > 0 ? t('trk.onlineCount', { count: positions.length }) : t('trk.noneOnline')}
            </Text>
          </View>
        </View>
      </View>

      {/* 司机列表面板 */}
      {positions.length > 0 && (
        <View style={styles.panel}>
          <FlatList
            data={positions}
            keyExtractor={(p) => p.driverId}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.md }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.driverCard,
                  selected?.driverId === item.driverId && styles.driverCardActive,
                ]}
                onPress={() => focusDriver(item)}
                activeOpacity={0.85}
              >
                <Text style={styles.driverCardIcon}>🚛</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.driverCardName} numberOfLines={1}>
                    {item.driverName || t('d.driverFallback')}
                  </Text>
                  <Text style={styles.driverCardSpeed}>
                    {item.speed != null ? `${Math.round(item.speed)} km/h` : '—'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {positions.length === 0 && (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <View style={styles.emptyIconWrap}>
            <Ionicons name="location-outline" size={30} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyText}>{t('trk.emptyTitle')}</Text>
          <Text style={styles.emptySub}>{t('trk.emptySub')}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.refreshBtn} onPress={fetchPositions} activeOpacity={0.85}>
        <Ionicons name="refresh" size={18} color={colors.accent} />
        <Text style={styles.refreshText}>{t('tasks.refresh')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  driverTodayContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  driverTodayHeader: {
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
  },
  driverTodayTitle: {
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: weight.heavy,
  },
  driverTodaySub: {
    color: colors.textMuted,
    fontSize: font.sm,
    marginTop: space.sm,
  },
  driverTodayList: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
  },
  driverTodayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.md,
  },
  driverTodayTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  driverTodayNo: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: weight.heavy,
  },
  driverTodayTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  driverTodayTime: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
  },
  driverTodayName: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
  },
  driverTodayMeta: {
    color: colors.textMuted,
    fontSize: font.sm,
    marginTop: space.sm,
    fontWeight: weight.medium,
  },
  driverTodayStatus: {
    alignSelf: 'flex-start',
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  driverTodayStatusText: {
    fontSize: font.sm,
    fontWeight: weight.bold,
  },
  driverTodayEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  driverTodayEmptyTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
  },
  driverTodayEmptySub: {
    color: colors.textFaint,
    fontSize: font.sm,
    marginTop: space.sm,
    textAlign: 'center',
  },
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  loadingText: { marginTop: space.md, color: colors.textMuted, fontSize: font.sm },

  // 压在地图瓦片上的元素一律用实色底：半透明的底在卫星图上会糊掉
  topScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 64,
    backgroundColor: colors.bg,
    opacity: 0.55,
  },
  floatingHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: space.lg,
    alignItems: 'flex-start',
  },
  headerPill: {
    flexDirection: 'row', alignItems: 'center',
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderWidth: 1, borderColor: colors.borderStrong,
    ...shadow.raised,
  },
  // 不能用 flex:1：RN 里它等于 flexBasis 0，而外层药丸是按内容收缩的（没有 flexGrow），
  // 结果文字列分到 0 宽，标题和「N 位司机在线」整个看不见，只剩一个绿点。
  // 只要允许它在空间不够时收缩就行。
  headerTexts: { flexShrink: 1, minWidth: 0 },
  onlineDot: {
    width: 10, height: 10, borderRadius: radius.pill,
    backgroundColor: colors.success, marginRight: space.sm,
  },
  onlineDotOff: { backgroundColor: colors.textFaint },
  headerTitle: { fontSize: font.base, fontWeight: weight.heavy, color: colors.text },
  headerSub: { fontSize: font.xs, color: colors.textMuted, marginTop: space.xs },

  panel: {
    position: 'absolute',
    // 让开右下角的刷新按钮（48 高 + 底部留白）
    bottom: hit.min + space.xxxl,
    left: 0,
    right: 0,
    paddingVertical: space.sm,
  },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    marginHorizontal: space.xs,
    minHeight: hit.min,
    minWidth: 150,
    maxWidth: 210,
    // 描边常驻 2px，选中时只换颜色，卡片不会跳动
    borderWidth: 2,
    borderColor: colors.border,
    ...shadow.raised,
  },
  driverCardActive: {
    borderColor: colors.accent,
  },
  driverCardIcon: { fontSize: font.xl },
  driverCardName: { fontSize: font.sm, color: colors.text, fontWeight: weight.bold },
  driverCardSpeed: { fontSize: font.xs, color: colors.success, marginTop: space.xs, fontWeight: weight.bold },
  emptyOverlay: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: space.xl,
  },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.md,
  },
  // 文字直接压在瓦片上会看不清，所以自己带一块实色底
  emptyText: {
    fontSize: font.lg, color: colors.text, fontWeight: weight.heavy,
    backgroundColor: colors.surface, overflow: 'hidden',
    borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.xs,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: font.sm, color: colors.textMuted, marginTop: space.sm,
    backgroundColor: colors.surface, overflow: 'hidden',
    borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.xs,
    textAlign: 'center',
  },
  refreshBtn: {
    position: 'absolute',
    bottom: space.xl,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    minHeight: hit.min,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    ...shadow.raised,
  },
  refreshText: { fontSize: font.sm, color: colors.accent, fontWeight: weight.heavy, marginLeft: space.sm },
});
