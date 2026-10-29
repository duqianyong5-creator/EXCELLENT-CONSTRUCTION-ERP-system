import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  TouchableOpacity, FlatList, Modal, Pressable, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import LeafletMap from '../../src/LeafletMap';
import { gpsApi, gpsDevicesApi, tasksApi } from '../../src/api';
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
  /** Only for the trackers view */
  state?: 'moving' | 'parked' | 'offline';
  labelSuffix?: string;
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
  // The vehicle picker: with a big fleet the map fits everyone by default and this is how you follow one
  const [pickerOpen, setPickerOpen] = useState(false);
  // Staff can switch from trucks on a job to every registered GPS tracker, like the console's full-screen map
  const canToggleTrackers = role === 'admin' || role === 'dispatcher';
  const [showTrackers, setShowTrackers] = useState(false);
  // a role without the toggle never keeps it on (e.g. the screen survived a switch of account)
  useEffect(() => { if (!canToggleTrackers) setShowTrackers(false); }, [canToggleTrackers]);
  // Height of the floating header, so the map's controls start below it whatever the device
  const [headerHeight, setHeaderHeight] = useState(0);
  const timer = useRef<any>(null);

  // drop answers that arrive after the view has switched (toggling quickly, slow network)
  const fetchId = useRef(0);
  const fetchPositions = useCallback(async () => {
    const myId = ++fetchId.current;
    const stale = () => myId !== fetchId.current;
    try {
      if (role === 'driver') {
        const tasks: any[] = (await tasksApi.today()) as any;
        setDriverTodayTasks(Array.isArray(tasks) ? tasks : []);
      } else if (canToggleTrackers && showTrackers) {
        // Every registered tracker: moving = online with a fresh fix and some speed, parked = online but
        // still, offline = not connected (shown at its last known fix). Same rule as the console.
        const devices: any[] = (await gpsDevicesApi.list()) as any;
        const now = Date.now();
        const rank = { moving: 0, parked: 1, offline: 2 } as const;
        const list: DriverPos[] = (Array.isArray(devices) ? devices : [])
          .filter((d) => d.enabled !== false)
          .map((d) => {
            const speed = Number(d.lastSpeed ?? 0) || 0;
            const fixAt = d.lastFixAt ? new Date(d.lastFixAt).getTime() : 0;
            const fresh = fixAt > 0 && now - fixAt <= 2 * 60_000;
            const state: DriverPos['state'] = !d.online ? 'offline' : (fresh && speed >= 3 ? 'moving' : 'parked');
            return {
              driverId: String(d.id),
              driverName: d.vehiclePlate || d.name || d.deviceNo,
              latitude: parseFloat(d.lastLatitude),
              longitude: parseFloat(d.lastLongitude),
              speed: state === 'offline' ? undefined : speed,
              timestamp: d.lastFixAt,
              state,
              labelSuffix: state === 'offline' ? t('trk.stOffline') : undefined,
            };
          })
          .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0))
          .sort((a, b) => rank[a.state!] - rank[b.state!] || String(a.driverName || '').localeCompare(String(b.driverName || '')));
        if (!stale()) setPositions(list);
      } else if (role === 'admin' || role === 'dispatcher' || role === 'client') {
        // Staff get every truck on a job; a client gets only the trucks on that client's own jobs
        // (the server scopes it, the app cannot widen it). Both carry the driver's name.
        const data: any[] = (await (role === 'client' ? gpsApi.clientPositions() : gpsApi.positions())) as any;
        if (Array.isArray(data)) {
          const list = data.map((p) => ({
            driverId: p.driver_id ?? p.driverId ?? '',
            driverName: p.driverName ?? p.driver_name,
            latitude: parseFloat(p.latitude),
            longitude: parseFloat(p.longitude),
            speed: p.speed,
            timestamp: p.timestamp,
            taskId: p.task_id ?? p.taskId,
          }));
          list.sort((a, b) => String(a.driverName || '').localeCompare(String(b.driverName || '')));
          if (!stale()) setPositions(list);
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [role, canToggleTrackers, showTrackers, t]);

  useEffect(() => {
    fetchPositions();
    timer.current = setInterval(fetchPositions, 15000);
    return () => clearInterval(timer.current);
  }, [fetchPositions]);

  // Tap a vehicle to follow it; tap it again (or pick "All vehicles") to go back to the whole fleet
  const focusDriver = (pos: DriverPos) => {
    setSelected((cur) => (cur?.driverId === pos.driverId ? null : pos));
  };
  // A followed vehicle that stopped reporting falls back to the fleet view
  useEffect(() => {
    if (selected && !positions.some((p) => p.driverId === selected.driverId)) setSelected(null);
  }, [positions, selected]);

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
        topInset={(headerHeight || insets.top + hit.min + space.md) + space.sm}
        bottomInset={space.xl}
      />

      {/* 顶部遮罩，保证系统状态栏图标在浅色地图上可读 */}
      <View style={styles.topScrim} pointerEvents="none" />

      {/* 悬浮标题胶囊（全屏地图） */}
      <View
        style={[styles.floatingHeader, { paddingTop: insets.top + space.md }]}
        pointerEvents="box-none"
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.headerPill}>
          <Image source={require('../../assets/log.png')} style={styles.headerLogo} resizeMode="contain" />
          <View style={[styles.onlineDot, positions.length === 0 && styles.onlineDotOff]} />
          <View style={styles.headerTexts}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {selected
                ? t('trk.following', { name: selected.driverName || t('d.driverFallback') })
                : showTrackers
                  ? t('trk.trackersSummary', {
                      moving: positions.filter((p) => p.state === 'moving').length,
                      parked: positions.filter((p) => p.state === 'parked').length,
                      offline: positions.filter((p) => p.state === 'offline').length,
                    })
                  : positions.length > 0 ? t('trk.onlineCount', { count: positions.length }) : t('trk.noneOnline')}
            </Text>
          </View>
        </View>
        <View style={styles.headerBtns}>
        {canToggleTrackers && (
          <TouchableOpacity
            style={[styles.trackersBtn, showTrackers && styles.trackersBtnActive]}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() => { setSelected(null); setPositions([]); setShowTrackers((v) => !v); }}
            activeOpacity={0.85}
            accessibilityLabel={t('trk.trackersBtn')}
          >
            <Ionicons name={showTrackers ? 'location' : 'location-outline'} size={18} color={showTrackers ? colors.onAccent : colors.text} />
            <Text style={[styles.trackersBtnText, showTrackers && styles.trackersBtnTextActive]}>{t('trk.trackersBtn')}</Text>
          </TouchableOpacity>
        )}
        {positions.length > 0 && (
          <TouchableOpacity
            style={[styles.filterBtn, selected && styles.filterBtnActive]}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() => setPickerOpen(true)}
            activeOpacity={0.85}
            accessibilityLabel={t('trk.filter')}
          >
            <Ionicons name={selected ? 'funnel' : 'funnel-outline'} size={18} color={selected ? colors.onAccent : colors.text} />
          </TouchableOpacity>
        )}
        </View>
      </View>

      {/* Vehicle picker */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('trk.pickVehicle')}</Text>
            <TouchableOpacity
              style={[styles.sheetRow, !selected && styles.sheetRowActive]}
              onPress={() => { setSelected(null); setPickerOpen(false); }}
              activeOpacity={0.85}
            >
              <View style={styles.sheetIcon}><Ionicons name="layers-outline" size={20} color={colors.text} /></View>
              <Text style={styles.sheetRowName}>{t('trk.allVehicles')}</Text>
              <Text style={styles.sheetRowMeta}>{positions.length}</Text>
            </TouchableOpacity>
            <FlatList
              data={positions}
              keyExtractor={(p) => p.driverId}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.sheetRow, selected?.driverId === item.driverId && styles.sheetRowActive]}
                  onPress={() => { setSelected(item); setPickerOpen(false); }}
                  activeOpacity={0.85}
                >
                  <View style={styles.sheetIcon}><Text style={{ fontSize: font.lg }}>🚛</Text></View>
                  <Text style={styles.sheetRowName} numberOfLines={1}>{item.driverName || t('d.driverFallback')}</Text>
                  <Text style={[styles.sheetRowMeta, item.state === 'offline' && styles.metaOffline]}>{item.labelSuffix ?? (item.speed != null ? `${Math.round(item.speed)} km/h` : '—')}</Text>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {positions.length === 0 && (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <View style={styles.emptyIconWrap}>
            <Ionicons name="location-outline" size={30} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyText}>{showTrackers ? t('trk.noTrackers') : t('trk.emptyTitle')}</Text>
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
    fontWeight: weight.semibold,
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
    fontWeight: weight.semibold,
  },
  driverTodayTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  driverTodayTime: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.semibold,
  },
  driverTodayName: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.semibold,
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
    fontWeight: weight.semibold,
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
    backgroundColor: colors.surface,
    opacity: 0.6,
  },
  floatingHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: space.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md,
  },
  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  trackersBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    height: hit.compact, paddingHorizontal: space.md, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    ...shadow.card,
  },
  trackersBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  trackersBtnText: { fontSize: font.sm, fontWeight: weight.medium, color: colors.text },
  trackersBtnTextActive: { color: colors.onAccent },
  metaOffline: { color: colors.textFaint },
  filterBtn: {
    width: hit.compact, height: hit.compact, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    ...shadow.card,
  },
  filterBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg, paddingTop: space.md, ...shadow.raised,
  },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong, marginBottom: space.md },
  sheetTitle: { fontSize: font.lg, fontWeight: weight.semibold, color: colors.text, marginBottom: space.sm },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    minHeight: hit.min + space.sm, paddingHorizontal: space.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: 'transparent',
  },
  sheetRowActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  sheetIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  sheetRowName: { flex: 1, minWidth: 0, fontSize: font.base, fontWeight: weight.medium, color: colors.text },
  sheetRowMeta: { fontSize: font.sm, fontWeight: weight.medium, color: colors.success },
  headerLogo: { width: 28, height: 28, marginRight: space.sm },
  headerPill: {
    flexDirection: 'row', alignItems: 'center',
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderWidth: 1, borderColor: colors.border,
    ...shadow.card,
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
  headerTitle: { fontSize: font.sm, fontWeight: weight.semibold, color: colors.text },
  headerSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },

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
    fontSize: font.lg, color: colors.text, fontWeight: weight.semibold,
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
  refreshText: { fontSize: font.sm, color: colors.accent, fontWeight: weight.semibold, marginLeft: space.sm },
});
