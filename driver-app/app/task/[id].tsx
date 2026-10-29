import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image, Modal, TextInput, useWindowDimensions, Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import * as ImagePicker from 'expo-image-picker';
import { tasksApi, workRecordsApi } from '../../src/api';
import { setActiveTask } from '../../src/store/taskSlice';
import type { RootState } from '../../src/store';
import { useLang } from '../../src/i18n';
import { showAppAlert } from '../../src/AppDialog';
import { colors, space, font, weight, radius, hit, shadow, statusColors } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** One line of a detail card: a quiet icon, a small label and the value */
type Row = { icon: IconName; label: string; value: string; prominent?: boolean };

const MAX_PHOTOS = 5;
/** Photo thumbnails sit in a 3-column grid */
const PHOTO_COLUMNS = 3;

export default function TaskDetailScreen() {
  // 顶部安全区按机型取：原来写死 56，iPhone Pro 的灵动岛是 59~62，标题会被压住
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const dispatch = useDispatch();
  const { user } = useSelector((s: RootState) => s.auth);
  const { activeTaskId } = useSelector((s: RootState) => s.task);
  const { t } = useLang();
  const role = user?.role || '';
  const canOperate = role === 'driver';

  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [workRecord, setWorkRecord] = useState<any>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const loadTask = useCallback(async () => {
    try {
      const data: any = await tasksApi.get(id);
      setTask(data);
      if (data?.status === 'completed') {
        try {
          const wr: any = await workRecordsApi.byTask(id);
          setWorkRecord(wr);
        } catch {
          setWorkRecord(null);
        }
      } else {
        setWorkRecord(null);
      }
    } catch {
      showAppAlert(t('td.error'), t('td.errLoad'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadTask(); }, [loadTask]);

  // 接单必须填车牌（车上的定位器靠车牌对到任务），这个流程在任务列表页：带着 accept 参数跳过去。
  // 以前这里直接 start，车牌是空的——那趟活的轨迹永远对不上定位器
  const handleStart = () => {
    router.navigate({ pathname: '/(tabs)/tasks', params: { accept: id } });
  };

  const handlePickPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      showAppAlert(t('common.notice'), t('td.max5'));
      return;
    }
    showAppAlert(t('td.pickPhoto'), '', [
      {
        text: t('td.takePhoto'), onPress: async () => {
          const res = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            allowsEditing: false,
          });
          if (!res.canceled && res.assets[0]) {
            setPhotos(prev => [...prev, res.assets[0].uri]);
          }
        },
      },
      {
        text: t('td.fromAlbum'), onPress: async () => {
          const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.7,
            allowsMultipleSelection: false,
          });
          if (!res.canceled && res.assets[0]) {
            setPhotos(prev => [...prev, res.assets[0].uri]);
          }
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const handleComplete = async () => {
    if (photos.length === 0) {
      showAppAlert(t('common.notice'), t('td.need1photo'));
      return;
    }
    showAppAlert(t('td.completeTitle'), t('td.completeConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('td.completeOk'), onPress: async () => {
          try {
            setCompleting(true);
            const formData = new FormData();
            photos.forEach((uri, index) => {
              const filename = `photo_${index}.jpg`;
              (formData as any).append('images', {
                uri,
                name: filename,
                type: 'image/jpeg',
              } as any);
            });
            // 后端读的字段叫 notes（以前发的是 completionNotes，备注从来没存进去过）
            if (notes.trim()) formData.append('notes', notes.trim());
            await tasksApi.complete(id, formData);
            dispatch(setActiveTask(null));
            showAppAlert(t('td.completed'), t('td.completedMsg'), [
              { text: t('common.back'), onPress: () => router.back() },
            ]);
          } catch (err: any) {
            showAppAlert(t('td.submitFailed'), err.message || t('td.completeFailed'));
            setCompleting(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.center}>
        <Ionicons name="document-outline" size={48} color={colors.textFaint} />
        <Text style={styles.emptyTitle}>{t('td.notFound')}</Text>
      </View>
    );
  }

  // Short, scannable dates ("21 Oct, 14:20") instead of the full locale string with seconds
  const loc = t('common.dateLocale');
  const fmtDate = (v?: string | null) => {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const fmtTime = (v?: string | null) => {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  };
  const fmtMinutes = (m?: number | null) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
  // Android edge-to-edge can report a 0 top inset on a pushed screen: never let the back button sit under the clock
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0);

  const statusStyle = statusColors[task.status as keyof typeof statusColors] || statusColors.assigned;

  // The primary action lives in a sticky bar under the scroll view so it is always reachable
  const showStart = canOperate && task.status === 'assigned';
  const showComplete = canOperate && task.status === 'in_progress';
  const hasActionBar = showStart || showComplete;

  // Thumbnail size: screen width minus page gutters, card padding and the gaps between columns
  const photoTile = Math.floor(
    (screenWidth - space.lg * 2 - space.lg * 2 - space.sm * (PHOTO_COLUMNS - 1)) / PHOTO_COLUMNS,
  );
  const tileSize = { width: photoTile, height: photoTile };

  const infoRows: Row[] = [
    { icon: 'location-outline', label: t('td.to'), value: task.endLocation || '-', prominent: true },
    { icon: 'business-outline', label: t('td.client'), value: task.client?.fullName || task.client?.username || '-' },
    ...(task.vehiclePlate ? [{ icon: 'car-outline' as IconName, label: t('td.plate'), value: task.vehiclePlate }] : []),
    ...(task.scheduledAt
      ? [{ icon: 'calendar-outline' as IconName, label: t('td.scheduled'), value: fmtDate(task.scheduledAt) }]
      : []),
  ];

  const cargoRows: Row[] = [
    ...(task.cargo ? [{ icon: 'cube-outline' as IconName, label: t('td.cargo'), value: task.cargo }] : []),
    ...(task.cargoWeight ? [{ icon: 'scale-outline' as IconName, label: t('td.weight'), value: `${task.cargoWeight} ${t('td.ton')}` }] : []),
    ...(task.notes ? [{ icon: 'document-text-outline' as IconName, label: t('td.notes'), value: task.notes }] : []),
  ];

  const recordRows: Row[] = workRecord?.completionNotes
    ? [{ icon: 'document-text-outline' as IconName, label: t('td.notes'), value: workRecord.completionNotes }]
    : [];

  const donePhotos: string[] = Array.isArray(workRecord?.imageUrls) ? workRecord.imageUrls : [];

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Hero: navy block with a square back button, the job title and its status as dot + text */}
        <View style={[styles.hero, { paddingTop: topInset + space.md }]}>
          <View style={styles.heroRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('td.backBtn')}
          >
            <Ionicons name="chevron-back" size={20} color={colors.heroText} />
          </TouchableOpacity>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle} numberOfLines={2}>{task.title}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusStyle.text }]} />
              <Text style={styles.statusText}>{t('status.' + task.status)}</Text>
            </View>
          </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* Job information */}
          <InfoCard title={t('td.taskInfo')} rows={infoRows} />

          {/* Cargo and job notes */}
          {cargoRows.length > 0 && (
            <InfoCard title={t('td.cargo')} rows={cargoRows} />
          )}

          {showComplete && (
            <>
              {/* Work photos */}
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{t('td.photos')}</Text>
                  <Text style={styles.cardMeta}>{photos.length}/{MAX_PHOTOS}</Text>
                </View>
                <View style={styles.photoGrid}>
                  {photos.map((uri, i) => (
                    <View key={i} style={[styles.photoTile, tileSize]}>
                      <Image source={{ uri }} style={styles.photo} />
                      <TouchableOpacity
                        style={styles.photoDelete}
                        hitSlop={{ top: space.md, bottom: space.md, left: space.md, right: space.md }}
                        onPress={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                      >
                        <Ionicons name="close" size={14} color={colors.heroText} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <TouchableOpacity
                      style={[styles.photoAdd, tileSize]}
                      onPress={handlePickPhoto}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="camera-outline" size={20} color={colors.textMuted} />
                      <Text style={styles.photoAddText}>{t('td.addPhoto')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Completion notes */}
              {/* 备注原来有状态没有输入框，提交的永远是空的 */}
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{t('td.notes')}</Text>
                </View>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  style={styles.notesInput}
                  placeholder={t('td.notesPh')}
                  placeholderTextColor={colors.textFaint}
                />
              </View>
            </>
          )}

          {/* Work record for completed jobs */}
          {task.status === 'completed' && workRecord && (
            <InfoCard title={t('td.workRecord')} rows={recordRows} lead={(
              <View style={styles.statStrip}>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{fmtTime(workRecord.startTime)}</Text>
                  <Text style={styles.statLabel}>{t('td.startTime')}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{fmtTime(workRecord.endTime)}</Text>
                  <Text style={styles.statLabel}>{t('td.endTime')}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCell}>
                  <Text style={[styles.statValue, { color: colors.success }]}>{fmtMinutes(workRecord.finalDuration)}</Text>
                  <Text style={styles.statLabel}>{t('td.finalHours')}</Text>
                </View>
              </View>
            )}>
              {donePhotos.length > 0 ? (
                <View style={styles.donePhotos}>
                  <Text style={styles.donePhotosLabel}>{t('td.donePhotos')}</Text>
                  <View style={styles.photoGrid}>
                    {donePhotos.map((u, i) => (
                      <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => setViewerUrl(u)}>
                        <Image source={{ uri: u }} style={[styles.photo, tileSize]} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}
            </InfoCard>
          )}
        </View>
      </ScrollView>

      {/* Sticky primary action: one button */}
      {hasActionBar && (
        <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          {showStart && (
            <TouchableOpacity style={[styles.actionBtn, styles.startBtn]} onPress={handleStart} activeOpacity={0.85}>
              <Text style={[styles.actionBtnText, { color: colors.onAccent }]}>{t('td.startTitle')}</Text>
            </TouchableOpacity>
          )}
          {showComplete && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.completeBtn, completing && styles.btnDisabled]}
              onPress={handleComplete}
              disabled={completing}
              activeOpacity={0.85}
            >
              {completing
                ? <ActivityIndicator color={colors.heroText} />
                : <Text style={[styles.actionBtnText, { color: colors.heroText }]}>{t('td.completeTitle')}</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 图片全屏查看 */}
      <Modal visible={!!viewerUrl} transparent animationType="fade" onRequestClose={() => setViewerUrl(null)}>
        <TouchableOpacity style={styles.viewerBackdrop} activeOpacity={1} onPress={() => setViewerUrl(null)}>
          {viewerUrl ? <Image source={{ uri: viewerUrl }} style={styles.viewerImage} resizeMode="contain" /> : null}
          <Text style={[styles.viewerHint, { bottom: insets.bottom + space.xxl }]}>{t('td.tapClose')}</Text>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

/** A white card with a plain title and label-over-value rows; `children` renders under the rows */
function InfoCard({ title, rows, children, lead }: { title: string; rows: Row[]; children?: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
      </View>
      {lead}
      {rows.map((row, i) => (
        <InfoRow key={i} {...row} first={i === 0} last={i === rows.length - 1} />
      ))}
      {children}
    </View>
  );
}

function InfoRow({ icon, label, value, prominent, first, last }: Row & { first?: boolean; last?: boolean }) {
  return (
    // One line per fact (label left, value right); the destination keeps its own larger line
    prominent ? (
      <View style={[styles.destBlock, first && styles.infoRowFirst]}>
        <Ionicons name={icon} size={18} color={colors.accentDark} />
        <View style={styles.infoText}>
          <Text style={styles.infoLabel}>{label}</Text>
          <Text style={styles.destValue}>{value}</Text>
        </View>
      </View>
    ) : (
      <View style={[styles.infoRow, first && styles.infoRowFirst, last && styles.infoRowLast]}>
        <Ionicons name={icon} size={16} color={colors.textFaint} />
        <Text style={styles.infoLabelInline}>{label}</Text>
        <Text style={styles.infoValueInline} numberOfLines={3}>{value}</Text>
      </View>
    )
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: space.xxxl },
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.bg, gap: space.md, padding: space.xxl,
  },
  emptyTitle: { color: colors.text, fontSize: font.base, fontWeight: weight.semibold },

  // Hero
  hero: {
    backgroundColor: colors.hero,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  backBtn: {
    width: hit.compact,
    height: hit.compact,
    borderRadius: radius.md,
    backgroundColor: colors.heroAlt,
    borderWidth: 1,
    borderColor: colors.heroBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  heroText: { flex: 1, minWidth: 0, paddingTop: 2 },
  heroTitle: {
    color: colors.heroText,
    fontSize: font.lg,
    lineHeight: 24,
    fontWeight: weight.semibold,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill },
  statusText: { color: colors.heroMuted, fontSize: font.sm, fontWeight: weight.medium },

  // Body and cards
  body: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  cardTitle: { flex: 1, minWidth: 0, fontSize: font.base, fontWeight: weight.semibold, color: colors.text },
  cardMeta: { fontSize: font.xs, color: colors.textFaint, letterSpacing: 0.2 },

  // Info rows: icon, then label over value, hairline between rows
  destBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingTop: space.sm, paddingBottom: space.md },
  destValue: { fontSize: font.lg, lineHeight: 24, color: colors.text, fontWeight: weight.semibold },
  infoLabelInline: { fontSize: font.sm, color: colors.textMuted },
  infoValueInline: { flex: 1, textAlign: 'right', fontSize: font.sm, color: colors.text, fontWeight: weight.medium },
  statStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: space.md, marginBottom: space.xs },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  statValue: { fontSize: font.lg, fontWeight: weight.bold, color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textFaint },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRowFirst: { borderTopWidth: 0 },
  infoRowLast: { paddingBottom: 0 },
  infoText: { flex: 1, minWidth: 0, gap: space.xs },
  infoLabel: { fontSize: font.xs, lineHeight: 16, color: colors.textFaint, letterSpacing: 0.2 },
  infoValue: { fontSize: font.base, lineHeight: 22, color: colors.text, fontWeight: weight.medium },
  infoValueProminent: { fontWeight: weight.semibold },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  photoTile: { borderRadius: radius.md },
  photo: { width: '100%', height: '100%', borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  photoDelete: {
    position: 'absolute', top: space.xs, right: space.xs,
    width: 24, height: 24, borderRadius: radius.pill,
    backgroundColor: colors.hero,
    alignItems: 'center', justifyContent: 'center',
  },
  photoAdd: {
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderStrong, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: space.xs,
    backgroundColor: colors.surfaceAlt,
  },
  photoAddText: { fontSize: font.xs, color: colors.textMuted, fontWeight: weight.medium },

  // Notes
  notesInput: {
    minHeight: 96,
    textAlignVertical: 'top',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginTop: space.md,
    color: colors.text,
    fontSize: font.base,
    lineHeight: 22,
  },

  // Closed-job line

  // Completion photos inside the work record card
  donePhotos: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  donePhotosLabel: { fontSize: font.xs, lineHeight: 16, color: colors.textFaint, letterSpacing: 0.2 },

  // Sticky action bar
  actionBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  actionBtn: {
    width: '100%',
    height: hit.min,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtn: { backgroundColor: colors.accent },
  completeBtn: { backgroundColor: colors.success },
  btnDisabled: { opacity: 0.6 },
  actionBtnText: { fontSize: font.base, fontWeight: weight.semibold },

  // Full-screen image viewer
  viewerBackdrop: {
    flex: 1,
    // A scrim over a photo has no surface token: it is simply near-black
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '80%' },
  viewerHint: {
    position: 'absolute',
    color: colors.heroMuted, fontSize: font.sm, fontWeight: weight.medium,
  },
});
