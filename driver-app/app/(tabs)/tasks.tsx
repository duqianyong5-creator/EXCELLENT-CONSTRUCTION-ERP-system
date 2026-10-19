import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Modal, TextInput, ScrollView, Image,
  DeviceEventEmitter, AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { gpsApi, gpsDevicesApi, notificationsApi, tasksApi, usersApi } from '../../src/api';
import { setActiveTask, setGpsRunning } from '../../src/store/taskSlice';
import type { RootState } from '../../src/store';
import { useLang } from '../../src/i18n';
import { showAppAlert } from '../../src/AppDialog';
import { startBackgroundGps, stopBackgroundGps } from '../../src/backgroundLocation';
import { colors, space, font, weight, radius, hit, statusColors } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GPS_UPLOAD_INTERVAL_MS = 10000;

// 状态配色全 App 一套，定义在 theme.ts
const STATUS_COLOR: Record<string, { bg: string; text: string; border: string }> = statusColors;

export default function TasksScreen() {
  // 顶部安全区按机型取：原来写死 56，iPhone Pro 的灵动岛是 59~62，标题会被压住
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dispatch = useDispatch();
  const { user } = useSelector((s: RootState) => s.auth);
  const { t } = useLang();
  const role = user?.role || '';
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [pickOpen, setPickOpen] = useState<null | 'client' | 'driver'>(null);
  const [pickSearch, setPickSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [selectedDriver, setSelectedDriver] = useState<any>(null);
  const [endLocation, setEndLocation] = useState('');
  const [cargo, setCargo] = useState('');
  const [cargoWeight, setCargoWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [assigningTask, setAssigningTask] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [acceptTask, setAcceptTask] = useState<any>(null);
  const [plateOpen, setPlateOpen] = useState(false);
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [knownPlates, setKnownPlates] = useState<Array<{ plate: string; name?: string | null }>>([]);
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [driverFilter, setDriverFilter] = useState<'all' | 'assigned' | 'in_progress' | 'completed'>('all');
  const [searchText, setSearchText] = useState('');
  const [adminFilter, setAdminFilter] = useState<'all' | 'in_progress' | 'completed'>('all');
  const [todayOnly, setTodayOnly] = useState(false);
  const [completeTask, setCompleteTask] = useState<any>(null);
  const [completePhotos, setCompletePhotos] = useState<string[]>([]);
  const [completeNotes, setCompleteNotes] = useState('');
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const gpsInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsResumedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    // 已退出登录(无角色)就别再拉取，否则会因没有 token 失败、在登录页弹「加载失败」
    if (!role) { setLoading(false); setRefreshing(false); return; }
    try {
      const data: any = await tasksApi.list();
      setTasks(Array.isArray(data) ? data : []);
      try {
        const [items, unread]: any = await Promise.all([
          notificationsApi.list(),
          notificationsApi.unreadCount(),
        ]);
        setNotifications(Array.isArray(items) ? items : []);
        setUnreadCount(Number(unread) || 0);
      } catch {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch {
      showAppAlert(t('tasks.loadFailed'), t('tasks.loadFailedSub'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [role]);

  useEffect(() => { load(); }, [load]);

  // Real-time: refresh the task list the instant a task is dispatched (socket push).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('tasks:refresh', () => { load(); });
    return () => sub.remove();
  }, [load]);

  // 任务详情页的「开始」带着 ?accept=<id> 跳回来：接单必须填车牌，车上的定位器靠它对到任务。
  // 用路由参数而不是事件：从通知冷启动时列表可能还没加载完，参数会等到任务到了再生效
  const { accept: acceptParam } = useLocalSearchParams<{ accept?: string }>();
  useEffect(() => {
    if (!acceptParam) return;
    const target = tasks.find((tk: any) => tk.id === acceptParam);
    if (!target) return; // 列表还在加载，等下一次
    router.setParams({ accept: '' });
    if (target.status === 'assigned') openAcceptTask(target);
  }, [tasks, acceptParam]);

  useEffect(() => {
    return () => {
      if (gpsInterval.current) clearInterval(gpsInterval.current);
    };
  }, []);

  const onRefresh = () => { setRefreshing(true); load(); };

  // 计划执行时间：Android 先选日期再选时间，合并成完整时间。
  const onSchedPickerChange = (event: any, selected?: Date) => {
    if (event?.type === 'dismissed' || !selected) { setPicker(null); return; }
    if (picker === 'date') {
      setTempDate(selected);
      setPicker('time');
      return;
    }
    const d = new Date(tempDate);
    d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setScheduledAt(d);
    setPicker(null);
  };

  const getToday = () => {
    const now = new Date();
    return now.toLocaleDateString(t('common.dateLocale'), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
  };

  const getInProgressCount = () => tasks.filter(t => t.status === 'in_progress').length;
  const getCompletedCount = () => tasks.filter(t => t.status === 'completed').length;
  const title = role === 'driver' ? t('tasks.titleDriver') : (role === 'client' ? t('tasks.titleClient') : t('tasks.titleManage'));
  const canManage = role === 'admin' || role === 'dispatcher';

  const getPersonName = (person: any) =>
    person?.fullName || person?.username || person?.email || '-';

  const uploadLocationOnce = async (taskId: string) => {
    // 优先实时定位；拿不到（室内/信号弱）就用最后已知位置，保证仍能上报，地图不掉点
    let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
    if (!loc) loc = await Location.getLastKnownPositionAsync();
    if (!loc) return;
    await gpsApi.upload({
      taskId,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      speed: Math.max(0, (loc.coords.speed ?? 0) * 3.6),
      heading: loc.coords.heading ?? undefined,
      accuracy: loc.coords.accuracy ?? undefined,
    });
  };

  const ensureLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      showAppAlert(t('d.locPerm'), t('d.locPermMsg'));
      return false;
    }
    return true;
  };

  const startGpsUpload = async (taskId: string) => {
    if (gpsInterval.current) { clearInterval(gpsInterval.current); gpsInterval.current = null; }
    dispatch(setGpsRunning(true));
    // 先传一次，立刻有点
    try { await uploadLocationOnce(taskId); } catch (e: any) {
      if (__DEV__) console.log('[gps] first upload failed:', e?.message || e);
    }
    // 优先后台定位（锁屏/切后台也上报）
    const bgOk = await startBackgroundGps(taskId);
    if (bgOk) {
      if (__DEV__) console.log('[gps] background location started');
      return true; // 后台服务接管，不再开前台定时器
    }
    // 回退：前台定时上报（如 Expo Go 不支持后台时）
    if (__DEV__) console.log('[gps] background not available, using foreground interval');
    gpsInterval.current = setInterval(async () => {
      try {
        await uploadLocationOnce(taskId);
      } catch (e: any) {
        if (__DEV__) console.log('[gps] upload failed:', e?.message || e);
      }
    }, GPS_UPLOAD_INTERVAL_MS);
    return true;
  };

  const stopGpsUpload = () => {
    if (gpsInterval.current) {
      clearInterval(gpsInterval.current);
      gpsInterval.current = null;
    }
    dispatch(setGpsRunning(false));
    stopBackgroundGps();
    gpsResumedFor.current = null;
  };

  // 自动恢复 GPS：司机重开 App / 回到任务页时，若有「进行中」任务但还没在上报，就自动开始上报。
  // 不用再手动重新接受，修掉「重开 App 后 GPS 不传」。
  useEffect(() => {
    if (role !== 'driver') return;
    const active = tasks.find((tk: any) => tk.status === 'in_progress');
    if (!active) return;
    if (gpsResumedFor.current === active.id) return; // 已为该任务启动过
    gpsResumedFor.current = active.id;
    dispatch(setActiveTask({
      id: active.id,
      title: active.title,
      startLocation: active.startLocation,
      endLocation: active.endLocation,
      status: 'in_progress',
    }));
    startGpsUpload(active.id);
  }, [tasks, role]);

  // 回到前台时,若有进行中任务,确保后台定位仍在跑。
  // 这样「定位卡住时重进 App 即可恢复」——不必重新登录(startBackgroundGps 幂等,在跑则不重复启动)。
  useEffect(() => {
    if (role !== 'driver') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      const active = tasks.find((tk: any) => tk.status === 'in_progress');
      if (active) startBackgroundGps(active.id);
    });
    return () => sub.remove();
  }, [tasks, role]);

  const openAcceptTask = (task: any) => {
    setAcceptTask(task);
    setVehiclePlate('');
  };

  const platesRequestId = useRef(0);

  const handleConfirmTaskInfo = () => {
    setPlateOpen(true);
    // 拉一次已登记车牌：车上装了定位器的车可以直接点选，车牌必须和登记的一致轨迹才对得上。
    // 连开两次弹窗时只认最后一次的结果，避免旧响应把列表覆盖回去。
    const reqId = ++platesRequestId.current;
    gpsDevicesApi.plates()
      .then((data: any) => {
        if (reqId !== platesRequestId.current) return;
        setKnownPlates(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (reqId === platesRequestId.current) setKnownPlates([]);
      });
  };

  const handleStartAcceptedTask = async () => {
    if (!acceptTask) return;
    if (!vehiclePlate.trim()) {
      showAppAlert(t('common.notice'), t('d.platePrompt'));
      return;
    }
    try {
      setStartingTaskId(acceptTask.id);
      const gpsReady = await ensureLocationPermission();
      if (!gpsReady) return;
      await tasksApi.start(acceptTask.id, vehiclePlate.trim());
      await startGpsUpload(acceptTask.id);
      dispatch(setActiveTask({
        id: acceptTask.id,
        title: acceptTask.title,
        startLocation: acceptTask.startLocation,
        endLocation: acceptTask.endLocation,
        status: 'in_progress',
      }));
      setAcceptTask(null);
      setPlateOpen(false);
      setVehiclePlate('');
      await load();
      showAppAlert(
        t('d.accepted'),
        t('d.plateConfirmed', { plate: vehiclePlate.trim() }),
      );
    } catch (e: any) {
      showAppAlert(t('d.acceptFailed'), e?.message || t('d.acceptFailedMsg'));
    } finally {
      setStartingTaskId(null);
    }
  };

  const openNotification = async (item: any) => {
    try {
      if (!item.isRead) await notificationsApi.markRead(item.id);
      setNotificationsOpen(false);
      await load();
      const taskId = item?.meta?.taskId;
      if (role === 'driver' && taskId) {
        const target = tasks.find((task) => task.id === taskId);
        if (target?.status === 'assigned') openAcceptTask(target);
        if (target?.status === 'in_progress') openCompleteTask(target);
        return;
      }
      if (taskId) router.push(`/task/${taskId}`);
    } catch {
      showAppAlert(t('common.notice'), t('tasks.notifOpenFail'));
    }
  };

  const openCompleteTask = (task: any) => {
    setCompleteTask(task);
    setCompletePhotos([]);
    setCompleteNotes('');
  };

  const handleTakeCompletePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showAppAlert(t('d.camPerm'), t('d.camPermMsg'));
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.72,
      allowsEditing: false,
    });
    if (!res.canceled && res.assets[0]) {
      setCompletePhotos(prev => [...prev, res.assets[0].uri].slice(0, 5));
    }
  };

  const handleSubmitCompleteTask = async () => {
    if (!completeTask) return;
    if (completePhotos.length === 0) {
      showAppAlert(t('common.notice'), t('d.need1'));
      return;
    }
    try {
      setCompletingTaskId(completeTask.id);
      const formData = new FormData();
      completePhotos.forEach((uri, index) => {
        (formData as any).append('images', {
          uri,
          name: `completion_${index + 1}.jpg`,
          type: 'image/jpeg',
        } as any);
      });
      // 后端读的字段叫 notes（以前这里发 completionNotes，备注从来没存进去过）
      if (completeNotes.trim()) formData.append('notes', completeNotes.trim());
      await tasksApi.complete(completeTask.id, formData);
      stopGpsUpload();
      dispatch(setActiveTask(null));
      setCompleteTask(null);
      setCompletePhotos([]);
      setCompleteNotes('');
      await load();
      showAppAlert(t('d.finishDone'), t('d.finishDoneMsg'));
    } catch (e: any) {
      showAppAlert(t('td.submitFailed'), e?.message || t('td.completeFailed'));
    } finally {
      setCompletingTaskId(null);
    }
  };

  const OVERDUE_GRACE_MS = 5 * 60 * 1000; // 逾期 5 分钟内不显示「已逾期」
  const isDriverTaskOverdue = (task: any) => {
    if (!task?.scheduledAt) return false;
    // 已完成/已取消不算；接受任务后(进行中)也不算——接受即视为已响应，超时 5 分钟内接受不算逾期。
    if (['completed', 'cancelled', 'in_progress'].includes(task.status)) return false;
    return new Date(task.scheduledAt).getTime() + OVERDUE_GRACE_MS < Date.now();
  };

  const isTodayTask = (task: any) => {
    if (!task?.scheduledAt) return false;
    const d = new Date(task.scheduledAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };

  const formatDriverDate = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toISOString().slice(0, 10);
  };

  const formatDriverDateTime = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const getDriverStatusText = (task: any) => {
    if (isDriverTaskOverdue(task)) return t('d.sOverdue');
    if (task.status === 'assigned') return t('d.sToAccept');
    if (task.status === 'in_progress') return t('d.sInProgress');
    if (task.status === 'completed') return t('d.fCompleted');
    if (task.status === 'cancelled') return t('d.sCancelled');
    return t('d.sToAccept');
  };

  // 司机端和管理端用同一套状态色（见 STATUS_COLOR）。以前司机端把进行中画成蓝、已完成画成绿，
  // 同一个状态在两个角色眼里是两种颜色。逾期借用红色：它和取消一样是要跳出来的
  const getDriverStatusStyle = (task: any) => {
    if (isDriverTaskOverdue(task)) return STATUS_COLOR.cancelled;
    return STATUS_COLOR[task.status] || STATUS_COLOR.assigned;
  };

  // 车牌归一化规则与后端 normalizePlate 保持一致（大小写、空格、连字符、中点都忽略）
  const normalizePlateLocal = (value: string) => value.toUpperCase().replace(/[\s\-·•.]/g, '');
  const plateHasTracker = knownPlates.some(
    (item) => normalizePlateLocal(item.plate) === normalizePlateLocal(vehiclePlate.trim()),
  );

  const driverName = user?.fullName || user?.username || t('d.driverFallback');
  const driverInProgressCount = tasks.filter(t => t.status === 'in_progress').length;
  const driverCompletedCount = tasks.filter(t => t.status === 'completed').length;
  const driverOverdueCount = tasks.filter(isDriverTaskOverdue).length;
  const driverSubtitle = driverInProgressCount > 0
    ? t('d.subActive', { count: driverInProgressCount })
    : t('d.subIdle');
  const driverFilterItems = [
    { key: 'all' as const, label: t('d.fAll') },
    { key: 'assigned' as const, label: t('d.fAssigned') },
    { key: 'in_progress' as const, label: t('d.fInProgress') },
    { key: 'completed' as const, label: t('d.fCompleted') },
  ];
  const filteredDriverTasks = tasks.filter((task) => {
    if (todayOnly && !isTodayTask(task)) return false;
    const q = searchText.trim().toLowerCase();
    const matchesSearch = !q || [
      task.title,
      task.cargo,
      task.endLocation,
      task.startLocation,
      task.client?.fullName,
      task.client?.username,
      task.client?.email,
      formatDriverDate(task.scheduledAt),
      formatDriverDate(task.createdAt),
    ].some((value) => String(value || '').toLowerCase().includes(q));

    if (!matchesSearch) return false;
    if (driverFilter === 'all') return true;
    if (driverFilter === 'completed') return task.status === 'completed';
    return task.status === driverFilter;
  });

  // Admin/client list: today toggle + status filter + search.
  const todayCount = tasks.filter(isTodayTask).length;
  const adminFilterItems = [
    { key: 'all' as const, label: t('d.fAll') },
    { key: 'in_progress' as const, label: t('tasks.inProgress') },
    { key: 'completed' as const, label: t('tasks.completed') },
  ];
  const filteredAdminTasks = tasks.filter((task) => {
    if (todayOnly && !isTodayTask(task)) return false;
    if (adminFilter === 'in_progress' && task.status !== 'in_progress') return false;
    if (adminFilter === 'completed' && task.status !== 'completed') return false;
    const q = searchText.trim().toLowerCase();
    if (!q) return true;
    return [
      task.title,
      task.cargo,
      task.endLocation,
      task.startLocation,
      task.client?.fullName,
      task.client?.username,
      task.client?.email,
      task.driver?.fullName,
      task.driver?.username,
      formatDriverDate(task.scheduledAt),
      formatDriverDate(task.createdAt),
    ].some((value) => String(value || '').toLowerCase().includes(q));
  });

  // 发布任务表单:必填是否齐全(控制按钮态) + 自动任务名预览(客户-年月日-序号)
  const createFormValid = !!(selectedClient?.id && selectedDriver?.id && endLocation.trim() && cargo.trim() && cargoWeight.trim() && scheduledAt);
  const taskNamePreview = (() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const sameDay = tasks.filter((tk: any) => typeof tk?.title === 'string' && tk.title.includes(`-${ymd}-`)).length;
    const clientName = selectedClient ? (selectedClient.fullName || selectedClient.username) : t('tasks.clientFallback');
    return t('tasks.namePreview', { name: `${clientName}-${ymd}-${String(sameDay + 1).padStart(3, '0')}` });
  })();

  // 选择器列表:支持按姓名/账号/邮箱搜索
  const pickList = (pickOpen === 'client' ? clients : drivers).filter((it: any) => {
    const q = pickSearch.trim().toLowerCase();
    if (!q) return true;
    return [it.fullName, it.username, it.email].some((v) => String(v || '').toLowerCase().includes(q));
  });

  // 通知弹窗一直在，但没有任何按钮能打开它；未读数也算了却没显示
  const bell = (
    <TouchableOpacity style={styles.headerIconBtn} onPress={() => setNotificationsOpen(true)} activeOpacity={0.8}>
      <Ionicons name="notifications-outline" size={22} color={colors.accent} />
      {unreadCount > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <View style={styles.loadingSpinner}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (role === 'driver') {
    return (
      <View style={styles.driverPage}>
        <FlatList
          data={filteredDriverTasks}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // 问候、统计、筛选、搜索跟着列表一起滚：原来固定在顶上占掉半屏，小屏手机只剩两张卡的位置
          ListHeaderComponent={(
        <View style={[styles.driverHeader, { paddingTop: insets.top + space.lg }]}>
              <View style={styles.headerTopRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.driverGreeting} numberOfLines={1}>{t('d.greetingPrefix')}{driverName}</Text>
                  <Text style={styles.driverSubTitle}>{driverSubtitle}</Text>
                </View>
                {bell}
              </View>

              <View style={styles.driverStatsGrid}>
                <TouchableOpacity
                  style={[styles.driverStatCard, styles.driverStatBlue, todayOnly && styles.driverStatCardOn]}
                  onPress={() => setTodayOnly(v => !v)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.driverStatValue, { color: todayOnly ? colors.accent : colors.info }]}>{todayOnly ? todayCount : tasks.length}</Text>
                  <Text style={styles.driverStatLabel}>{todayOnly ? t('d.statToday') : t('d.statTotal')}</Text>
                </TouchableOpacity>
                <View style={[styles.driverStatCard, styles.driverStatGreen]}>
                  <Text style={[styles.driverStatValue, { color: colors.success }]}>{driverInProgressCount}</Text>
                  <Text style={styles.driverStatLabel}>{t('d.statActive')}</Text>
                </View>
                <View style={[styles.driverStatCard, styles.driverStatRed]}>
                  <Text style={[styles.driverStatValue, { color: colors.danger }]}>{driverOverdueCount}</Text>
                  <Text style={styles.driverStatLabel}>{t('d.statOverdue')}</Text>
                </View>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.driverFilterRow}
              >
                {driverFilterItems.map((item) => {
                  const active = driverFilter === item.key;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={[styles.driverFilterPill, active && styles.driverFilterPillActive]}
                      onPress={() => setDriverFilter(item.key)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.driverFilterText, active && styles.driverFilterTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.driverSearchBox}>
                <Ionicons name="search" size={20} color={colors.textMuted} style={{ marginRight: space.md }} />
                <TextInput
                  value={searchText}
                  onChangeText={setSearchText}
                  style={styles.driverSearchInput}
                  placeholder={t('d.search')}
                  placeholderTextColor={colors.textFaint}
                />
              </View>
            </View>
          )}
          contentContainerStyle={[
            styles.driverListContentScroll,
            filteredDriverTasks.length === 0 && { flexGrow: 1 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <View style={styles.driverEmptyBox}>
              <View style={styles.driverEmptyIcon}>
                <Ionicons name="clipboard-outline" size={36} color={colors.accent} />
              </View>
              <Text style={styles.driverEmptyTitle}>{t('d.emptyTitle')}</Text>
              <Text style={styles.driverEmptySub}>{t('d.emptySub')}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const st = getDriverStatusStyle(item);
            const statusText = getDriverStatusText(item);
            const clientName = getPersonName(item.client);
            return (
              <TouchableOpacity
                style={[styles.driverTaskCard, { borderLeftColor: st.text }]}
                // 整张卡可点：待接受的进接单流程，其余看详情（照片、工时、备注都在那里）
                onPress={() => (item.status === 'assigned' ? openAcceptTask(item) : router.push(`/task/${item.id}`))}
                activeOpacity={0.85}
              >
                <View style={styles.driverTaskHead}>
                  <Text style={styles.driverTaskTitle} numberOfLines={1}>{item.title || t('d.taskFallback')}</Text>
                  <View style={[styles.driverStatusBadge, { backgroundColor: st.bg, borderColor: st.border }]}>
                    <Text style={[styles.driverStatusText, { color: st.text }]}>{statusText}</Text>
                  </View>
                </View>
                <Text style={styles.driverTaskMeta} numberOfLines={1}>
                  {(item.cargo || t('d.cargoFallback'))}{clientName !== '-' ? ` · ${clientName}` : ''}
                </Text>
                {!!item.endLocation && (
                  <Text style={styles.driverTaskRoute} numberOfLines={1}>{item.endLocation}</Text>
                )}

                <View style={styles.driverTaskDivider} />

                <View style={styles.driverTaskBottom}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.driverInfoLine}>
                      <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                      <Text style={styles.driverTaskDate}>{t('d.due')} {formatDriverDateTime(item.scheduledAt)}</Text>
                    </View>
                    <View style={[styles.driverInfoLine, { marginTop: space.sm }]}>
                      <Ionicons name="create-outline" size={14} color={colors.textFaint} />
                      <Text style={styles.driverTaskCreated}>{t('d.createdAt')} {formatDriverDateTime(item.createdAt)}</Text>
                    </View>
                  </View>
                  {item.cargoWeight ? (
                    <View style={styles.driverAmountPill}>
                      <Text style={styles.driverAmountValue}>{item.cargoWeight}</Text>
                      <Text style={styles.driverAmountUnit}>{t('tasks.ton')}</Text>
                    </View>
                  ) : (
                    <Text style={styles.driverTaskAmount}>—</Text>
                  )}
                </View>

                {item.status === 'assigned' && (
                  <TouchableOpacity
                    style={[styles.driverAcceptInline, startingTaskId === item.id && styles.btnDisabled]}
                    onPress={() => openAcceptTask(item)}
                    disabled={startingTaskId === item.id}
                    activeOpacity={0.85}
                  >
                    {startingTaskId === item.id
                      ? <ActivityIndicator color={colors.accent} />
                      : <Text style={styles.driverAcceptInlineText}>{t('d.accept')}</Text>}
                  </TouchableOpacity>
                )}
                {item.status === 'in_progress' && (
                  <TouchableOpacity
                    style={[styles.driverCompleteInline, completingTaskId === item.id && styles.btnDisabled]}
                    onPress={() => openCompleteTask(item)}
                    disabled={completingTaskId === item.id}
                    activeOpacity={0.85}
                  >
                    {completingTaskId === item.id
                      ? <ActivityIndicator color={colors.success} />
                      : <Text style={styles.driverCompleteInlineText}>{t('d.finish')}</Text>}
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
        />

        <Modal visible={!!acceptTask && !plateOpen} animationType="fade" transparent onRequestClose={() => setAcceptTask(null)}>
          <View style={styles.pickWrap}>
            <View style={styles.acceptCard}>
              <View style={styles.pickHeader}>
                <Text style={styles.pickHeaderTitle}>{t('d.acceptConfirm')}</Text>
                <TouchableOpacity onPress={() => setAcceptTask(null)} style={styles.modalClose} activeOpacity={0.8}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              {acceptTask && (
                <View style={styles.acceptContent}>
                  <Text style={styles.acceptTitle} numberOfLines={2}>{acceptTask.title}</Text>
                  <View style={styles.acceptInfoBox}>
                    <View style={styles.acceptInfoRow}>
                      <Text style={styles.acceptInfoLabel}>{t('d.client')}</Text>
                      <Text style={styles.acceptInfoValue}>{getPersonName(acceptTask.client)}</Text>
                    </View>
                    <View style={styles.acceptInfoRow}>
                      <Text style={styles.acceptInfoLabel}>{t('d.to')}</Text>
                      <Text style={styles.acceptInfoValue}>{acceptTask.endLocation || '-'}</Text>
                    </View>
                    <View style={styles.acceptInfoRow}>
                      <Text style={styles.acceptInfoLabel}>{t('d.cargo')}</Text>
                      <Text style={styles.acceptInfoValue}>{acceptTask.cargo || '-'}</Text>
                    </View>
                    <View style={styles.acceptInfoRow}>
                      <Text style={styles.acceptInfoLabel}>{t('d.weight')}</Text>
                      <Text style={styles.acceptInfoValue}>
                        {acceptTask.cargoWeight ? `${acceptTask.cargoWeight} ${t('td.ton')}` : '-'}
                      </Text>
                    </View>
                    <View style={styles.acceptInfoRow}>
                      <Text style={styles.acceptInfoLabel}>{t('d.scheduled')}</Text>
                      <Text style={styles.acceptInfoValue}>
                        {acceptTask.scheduledAt ? new Date(acceptTask.scheduledAt).toLocaleString() : '-'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.acceptActions}>
                    <TouchableOpacity
                      style={[styles.modalBtnSecondary, { flex: 1 }]}
                      onPress={() => setAcceptTask(null)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.modalBtnSecondaryText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalBtn, { flex: 1, marginTop: 0, marginBottom: 0 }]}
                      onPress={handleConfirmTaskInfo}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.modalBtnText}>{t('d.confirm')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        </Modal>

        <Modal visible={plateOpen} animationType="fade" transparent onRequestClose={() => setPlateOpen(false)}>
          <View style={styles.pickWrap}>
            <View style={styles.acceptCard}>
              <View style={styles.pickHeader}>
                <Text style={styles.pickHeaderTitle}>{t('d.plateTitle')}</Text>
                <TouchableOpacity onPress={() => setPlateOpen(false)} style={styles.modalClose} activeOpacity={0.8}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.acceptContent}>
                <Text style={styles.plateHint}>{t('d.plateHint')}</Text>
                <TextInput
                  value={vehiclePlate}
                  onChangeText={setVehiclePlate}
                  style={styles.plateInput}
                  placeholder={t('d.platePh')}
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="characters"
                />
                {knownPlates.length > 0 && vehiclePlate.trim().length > 0 && !plateHasTracker && (
                  <View style={styles.plateWarnBox}>
                    <Ionicons name="alert-circle-outline" size={16} color={colors.accent} />
                    <Text style={styles.plateWarnText}>
                      {t('d.plateNoTracker')}
                    </Text>
                  </View>
                )}
                {knownPlates.length > 0 && (
                  <View style={styles.platePickBox}>
                    <Text style={styles.platePickLabel}>
                      {t('d.plateTrackerList')}
                    </Text>
                    <View style={styles.platePickRow}>
                      {knownPlates.map((item) => {
                        const active = normalizePlateLocal(vehiclePlate.trim()) === normalizePlateLocal(item.plate);
                        return (
                          <TouchableOpacity
                            key={item.plate}
                            style={[styles.plateChipBtn, active && styles.plateChipBtnActive]}
                            onPress={() => setVehiclePlate(item.plate)}
                            activeOpacity={0.85}
                          >
                            <Ionicons name="car-outline" size={16} color={active ? colors.onAccent : colors.accent} />
                            <Text style={[styles.plateChipBtnText, active && styles.plateChipBtnTextActive]}>
                              {item.plate}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.modalBtn, startingTaskId && styles.btnDisabled]}
                  onPress={handleStartAcceptedTask}
                  disabled={!!startingTaskId}
                  activeOpacity={0.85}
                >
                  {startingTaskId
                    ? <ActivityIndicator color={colors.onAccent} />
                    : <Text style={styles.modalBtnText}>{t('d.plateConfirm')}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={!!completeTask} animationType="fade" transparent onRequestClose={() => setCompleteTask(null)}>
          <View style={styles.pickWrap}>
            <View style={styles.acceptCard}>
              <View style={styles.pickHeader}>
                <Text style={styles.pickHeaderTitle}>{t('d.finishTitle')}</Text>
                <TouchableOpacity
                  onPress={() => {
                    setCompleteTask(null);
                    setCompletePhotos([]);
                    setCompleteNotes('');
                  }}
                  style={styles.modalClose}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.acceptContent}>
                <Text style={styles.acceptTitle} numberOfLines={2}>{completeTask?.title || t('d.taskFallback')}</Text>
                <Text style={styles.completeHint}>{t('d.completeHint')}</Text>

                <View style={styles.completePhotoGrid}>
                  {completePhotos.map((uri, index) => (
                    <View key={uri} style={styles.completePhotoWrap}>
                      <Image source={{ uri }} style={styles.completePhoto} />
                      <TouchableOpacity
                        style={styles.completePhotoRemove}
                        hitSlop={{ top: space.md, bottom: space.md, left: space.md, right: space.md }}
                        onPress={() => setCompletePhotos(prev => prev.filter((_, i) => i !== index))}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="close" size={16} color={colors.text} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {completePhotos.length < 5 && (
                    <TouchableOpacity style={styles.completePhotoAdd} onPress={handleTakeCompletePhoto} activeOpacity={0.85}>
                      <Ionicons name="camera-outline" size={26} color={colors.textMuted} style={{ marginBottom: space.sm }} />
                      <Text style={styles.completePhotoAddText}>{t('d.takePhoto')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  value={completeNotes}
                  onChangeText={setCompleteNotes}
                  multiline
                  style={styles.completeNotesInput}
                  placeholder={t('td.notesPh')}
                  placeholderTextColor={colors.textFaint}
                />

                <TouchableOpacity
                  style={[styles.completeSubmitBtn, completingTaskId && styles.btnDisabled]}
                  onPress={handleSubmitCompleteTask}
                  disabled={!!completingTaskId}
                  activeOpacity={0.85}
                >
                  {completingTaskId
                    ? <ActivityIndicator color={colors.onAccent} />
                    : <Text style={styles.completeSubmitText}>{t('d.submitFinish')}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={notificationsOpen} animationType="slide" transparent onRequestClose={() => setNotificationsOpen(false)}>
          <View style={styles.pickWrap}>
            <View style={styles.pickCard}>
              <View style={styles.pickHeader}>
                <Text style={styles.pickHeaderTitle}>{t('tasks.notifTitle0')}</Text>
                <TouchableOpacity onPress={() => setNotificationsOpen(false)} style={styles.modalClose} activeOpacity={0.8}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <FlatList
                data={notifications}
                keyExtractor={(it: any) => it.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.notificationItem, !item.isRead && styles.notificationItemUnread]}
                    onPress={() => openNotification(item)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.notificationItemHeader}>
                      <Text style={styles.notificationItemTitle} numberOfLines={1}>{item.title}</Text>
                      {!item.isRead && <View style={styles.unreadDot} />}
                    </View>
                    <Text style={styles.notificationItemBody} numberOfLines={2}>{item.content}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={{ padding: space.xxl }}>
                    <Text style={styles.emptyInlineText}>{t('tasks.noNotif')}</Text>
                  </View>
                }
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredAdminTasks}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        // 标题、统计、筛选、搜索跟着列表一起滚（同司机端）
        ListHeaderComponent={(
      <View style={[styles.header, { paddingTop: insets.top + space.lg }]}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.headerTitle}>{title}</Text>
            <Text style={styles.headerSub}>{getToday()}</Text>
          </View>
          {bell}
          <TouchableOpacity style={styles.headerIconBtn} onPress={load} activeOpacity={0.8}>
            <Ionicons name="refresh" size={22} color={colors.accent} />
          </TouchableOpacity>
        </View>

        <View style={[styles.driverStatsGrid, { marginTop: space.lg, marginBottom: 0 }]}>
          <TouchableOpacity
            style={[styles.driverStatCard, styles.driverStatBlue, todayOnly && styles.driverStatCardOn]}
            onPress={() => setTodayOnly(v => !v)}
            activeOpacity={0.85}
          >
            <Text style={[styles.driverStatValue, { color: todayOnly ? colors.accent : colors.info }]}>{todayOnly ? todayCount : tasks.length}</Text>
            <Text style={styles.driverStatLabel}>{todayOnly ? t('d.statToday') : t('d.statTotal')}</Text>
          </TouchableOpacity>
          <View style={[styles.driverStatCard, styles.driverStatGreen]}>
            <Text style={[styles.driverStatValue, { color: colors.success }]}>{getInProgressCount()}</Text>
            <Text style={styles.driverStatLabel}>{t('tasks.inProgress')}</Text>
          </View>
          <View style={[styles.driverStatCard, styles.driverStatMuted]}>
            <Text style={[styles.driverStatValue, { color: colors.textMuted }]}>{getCompletedCount()}</Text>
            <Text style={styles.driverStatLabel}>{t('tasks.completed')}</Text>
          </View>
        </View>
        {canManage && (
          <TouchableOpacity
            style={styles.createBtn}
            onPress={async () => {
              try {
                const [c, d]: any = await Promise.all([usersApi.clients(), usersApi.drivers()]);
                setClients(Array.isArray(c) ? c : []);
                setDrivers(Array.isArray(d) ? d : []);
              } catch {
                setClients([]);
                setDrivers([]);
              }
              setSelectedClient(null);
              setSelectedDriver(null);
              setEndLocation('');
              setCargo('');
              setCargoWeight('');
              setNotes('');
              setScheduledAt(null);
              setCreateOpen(true);
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle" size={20} color={colors.onAccent} />
            <Text style={styles.createBtnText}>{t('tasks.createTask')}</Text>
          </TouchableOpacity>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: space.lg }}
          contentContainerStyle={styles.driverFilterRow}
        >
          {adminFilterItems.map((item) => {
            const active = adminFilter === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.driverFilterPill, active && styles.driverFilterPillActive]}
                onPress={() => setAdminFilter(item.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.driverFilterText, active && styles.driverFilterTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={[styles.driverSearchBox, { marginBottom: 0 }]}>
          <Ionicons name="search" size={20} color={colors.textMuted} style={{ marginRight: space.md }} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            style={styles.driverSearchInput}
            placeholder={t('d.search')}
            placeholderTextColor={colors.textFaint}
          />
        </View>
      </View>
        )}
        contentContainerStyle={[styles.adminListContent, filteredAdminTasks.length === 0 && { flexGrow: 1 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="clipboard-outline" size={36} color={colors.accent} />
            </View>
            <Text style={styles.emptyText}>{t('tasks.emptyTitle')}</Text>
            <Text style={styles.emptySub}>{t('tasks.emptySub')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const statusStyle = STATUS_COLOR[item.status] || STATUS_COLOR.pending;
          return (
            <TouchableOpacity
              style={[styles.card, { borderLeftWidth: 4, borderLeftColor: statusStyle.text }]}
              onPress={() => {
                if (role === 'driver' && item.status === 'assigned') {
                  openAcceptTask(item);
                  return;
                }
                if (item.status === 'in_progress' || item.status === 'completed' || canManage) {
                  router.push(`/task/${item.id}`);
                }
              }}
              activeOpacity={0.85}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: statusStyle.bg, borderColor: statusStyle.border }]}>
                  <Text style={[styles.badgeText, { color: statusStyle.text }]}>
                    {t('status.' + item.status)}
                  </Text>
                </View>
              </View>

              <View style={styles.destRow}>
                <Ionicons name="location" size={16} color={colors.danger} />
                <Text style={styles.destText} numberOfLines={1}>{item.endLocation}</Text>
              </View>

              <View style={styles.cardMetaGrid}>
                <View style={styles.cardMetaItem}>
                  <Ionicons name="business-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.cardMetaText} numberOfLines={1}>{getPersonName(item.client)}</Text>
                </View>
                <View style={styles.cardMetaItem}>
                  <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.cardMetaText} numberOfLines={1}>{getPersonName(item.driver)}</Text>
                </View>
                <View style={[styles.cardMetaItem, { flexBasis: '100%' }]}>
                  <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.cardMetaText} numberOfLines={1}>
                    {item.scheduledAt ? formatDriverDateTime(item.scheduledAt) : t('tasks.unscheduled')}
                  </Text>
                </View>
              </View>

              {item.cargo && (
                <View style={styles.cargoContainer}>
                  <Ionicons name="cube-outline" size={16} color={colors.accent} style={{ marginRight: space.sm }} />
                  <Text style={styles.cargoText}>
                    {item.cargo}
                    {item.cargoWeight ? ` · ${item.cargoWeight} ${t('tasks.ton')}` : ''}
                  </Text>
                </View>
              )}

              {canManage && (
                <View style={styles.actionRow}>
                  {/* 创建任务时司机必填，任务不会停在 pending；已分配未开始的必须能改派 */}
                  {(item.status === 'pending' || item.status === 'assigned') && (
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.smallBtnPrimary]}
                      onPress={async () => {
                        try {
                          const d: any = await usersApi.drivers();
                          setDrivers(Array.isArray(d) ? d : []);
                        } catch {
                          setDrivers([]);
                        }
                        setAssigningTask(item);
                        setPickOpen('driver');
                      }}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="person-add-outline" size={16} color={colors.accent} />
                      <Text style={styles.smallBtnTextPrimary}>{t('tasks.assignDriver')}</Text>
                    </TouchableOpacity>
                  )}
                  {(item.status === 'pending' || item.status === 'assigned') && (
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.smallBtnDanger]}
                      onPress={() => {
                        showAppAlert(t('tasks.cancelTask'), t('tasks.cancelConfirm'), [
                          { text: t('tasks.dontCancel'), style: 'cancel' },
                          {
                            text: t('tasks.cancelTask'), style: 'destructive', onPress: async () => {
                              try {
                                await tasksApi.cancel(item.id);
                                load();
                              } catch (e: any) {
                                showAppAlert(t('common.fail'), e?.message || t('tasks.cancelFailed'));
                              }
                            },
                          },
                        ]);
                      }}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                      <Text style={styles.smallBtnTextDanger}>{t('tasks.cancel')}</Text>
                    </TouchableOpacity>
                  )}
                  {(item.status === 'completed' || item.status === 'cancelled') && (
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.smallBtnDanger]}
                      onPress={() => {
                        showAppAlert(t('tasks.deleteTask'), t('tasks.deleteConfirm'), [
                          { text: t('common.cancel'), style: 'cancel' },
                          {
                            text: t('tasks.delete'), style: 'destructive', onPress: async () => {
                              try {
                                await tasksApi.delete(item.id);
                                load();
                              } catch (e: any) {
                                showAppAlert(t('common.fail'), e?.message || t('tasks.deleteFailed'));
                              }
                            },
                          },
                        ]);
                      }}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.danger} />
                      <Text style={styles.smallBtnTextDanger}>{t('tasks.delete')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {role === 'driver' && item.status === 'assigned' && (
                <TouchableOpacity
                  style={[styles.acceptBtn, startingTaskId === item.id && styles.btnDisabled]}
                  onPress={() => openAcceptTask(item)}
                  disabled={startingTaskId === item.id}
                  activeOpacity={0.85}
                >
                  {startingTaskId === item.id
                    ? <ActivityIndicator color={colors.onAccent} />
                    : <Text style={styles.acceptBtnText}>{t('d.accept')}</Text>}
                </TouchableOpacity>
              )}

              {role === 'driver' && item.status === 'in_progress' && (
                <TouchableOpacity
                  style={styles.continueBtn}
                  onPress={() => router.push(`/task/${item.id}`)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.continueBtnText}>{t('d.continue')}</Text>
                  <View style={styles.arrowIcon}>
                    <Text style={styles.arrowText}>→</Text>
                  </View>
                </TouchableOpacity>
              )}

              {role !== 'driver' && (
                <View style={styles.cardFooter}>
                  <Text style={styles.footerText}>{t('d.viewTask')}</Text>
                  {item.vehiclePlate ? (
                    <View style={styles.plateChip}>
                      <Ionicons name="car-outline" size={16} color={colors.accent} />
                      <Text style={styles.plateChipText}>{item.vehiclePlate}</Text>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color={colors.accent} />
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />

      <Modal visible={!!acceptTask && !plateOpen} animationType="fade" transparent onRequestClose={() => setAcceptTask(null)}>
        <View style={styles.pickWrap}>
          <View style={styles.acceptCard}>
            <View style={styles.pickHeader}>
              <Text style={styles.pickHeaderTitle}>{t('d.acceptConfirm')}</Text>
              <TouchableOpacity onPress={() => setAcceptTask(null)} style={styles.modalClose} activeOpacity={0.8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {acceptTask && (
              <View style={styles.acceptContent}>
                <Text style={styles.acceptTitle} numberOfLines={2}>{acceptTask.title}</Text>
                <View style={styles.acceptInfoBox}>
                  <View style={styles.acceptInfoRow}>
                    <Text style={styles.acceptInfoLabel}>{t('d.client')}</Text>
                    <Text style={styles.acceptInfoValue}>{getPersonName(acceptTask.client)}</Text>
                  </View>
                  <View style={styles.acceptInfoRow}>
                    <Text style={styles.acceptInfoLabel}>{t('d.to')}</Text>
                    <Text style={styles.acceptInfoValue}>{acceptTask.endLocation || '-'}</Text>
                  </View>
                  <View style={styles.acceptInfoRow}>
                    <Text style={styles.acceptInfoLabel}>{t('d.cargo')}</Text>
                    <Text style={styles.acceptInfoValue}>{acceptTask.cargo || '-'}</Text>
                  </View>
                  <View style={styles.acceptInfoRow}>
                    <Text style={styles.acceptInfoLabel}>{t('d.weight')}</Text>
                    <Text style={styles.acceptInfoValue}>
                      {acceptTask.cargoWeight ? `${acceptTask.cargoWeight} ${t('td.ton')}` : '-'}
                    </Text>
                  </View>
                  <View style={styles.acceptInfoRow}>
                    <Text style={styles.acceptInfoLabel}>{t('d.scheduled')}</Text>
                    <Text style={styles.acceptInfoValue}>
                      {acceptTask.scheduledAt ? new Date(acceptTask.scheduledAt).toLocaleString() : '-'}
                    </Text>
                  </View>
                </View>
                <View style={styles.acceptActions}>
                  <TouchableOpacity
                    style={[styles.modalBtnSecondary, { flex: 1 }]}
                    onPress={() => setAcceptTask(null)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.modalBtnSecondaryText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { flex: 1, marginTop: 0, marginBottom: 0 }]}
                    onPress={handleConfirmTaskInfo}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.modalBtnText}>{t('d.confirm')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={plateOpen} animationType="fade" transparent onRequestClose={() => setPlateOpen(false)}>
        <View style={styles.pickWrap}>
          <View style={styles.acceptCard}>
            <View style={styles.pickHeader}>
              <Text style={styles.pickHeaderTitle}>{t('d.plateTitle')}</Text>
              <TouchableOpacity onPress={() => setPlateOpen(false)} style={styles.modalClose} activeOpacity={0.8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.acceptContent}>
              <Text style={styles.plateHint}>{t('d.plateHint')}</Text>
              <TextInput
                value={vehiclePlate}
                onChangeText={setVehiclePlate}
                style={styles.plateInput}
                placeholder={t('d.platePh')}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={[styles.modalBtn, startingTaskId && styles.btnDisabled]}
                onPress={handleStartAcceptedTask}
                disabled={!!startingTaskId}
                activeOpacity={0.85}
              >
                {startingTaskId
                  ? <ActivityIndicator color={colors.onAccent} />
                  : <Text style={styles.modalBtnText}>{t('d.plateConfirm')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={notificationsOpen} animationType="slide" transparent onRequestClose={() => setNotificationsOpen(false)}>
        <View style={styles.pickWrap}>
          <View style={styles.pickCard}>
            <View style={styles.pickHeader}>
              <Text style={styles.pickHeaderTitle}>{t('tasks.notifTitle0')}</Text>
              <TouchableOpacity onPress={() => setNotificationsOpen(false)} style={styles.modalClose} activeOpacity={0.8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={notifications}
              keyExtractor={(it: any) => it.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.notificationItem, !item.isRead && styles.notificationItemUnread]}
                  onPress={() => openNotification(item)}
                  activeOpacity={0.85}
                >
                  <View style={styles.notificationItemHeader}>
                    <Text style={styles.notificationItemTitle} numberOfLines={1}>{item.title}</Text>
                    {!item.isRead && <View style={styles.unreadDot} />}
                  </View>
                  <Text style={styles.notificationItemBody} numberOfLines={2}>{item.content}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ padding: space.xxl }}>
                  <Text style={styles.emptyInlineText}>{t('tasks.noNotif')}</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{t('tasks.createTaskTitle')}</Text>
                <Text style={styles.modalSubtitle}>{taskNamePreview}</Text>
              </View>
              <TouchableOpacity onPress={() => setCreateOpen(false)} style={styles.modalClose} activeOpacity={0.8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* 第 1 步 客户与司机 */}
              <View style={styles.formSectionHead}>
                <View style={styles.formSectionBar} />
                <Text style={styles.formSectionTitle}>{t('tasks.secClientDriver')}</Text>
              </View>
              <TouchableOpacity
                style={[styles.selectRow, selectedClient && styles.selectRowFilled]}
                onPress={() => { setPickSearch(''); setPickOpen('client'); }}
                activeOpacity={0.85}
              >
                <View style={[styles.selectAvatar, selectedClient && styles.selectAvatarFilled]}>
                  {selectedClient
                    ? <Text style={styles.selectAvatarText}>{String(selectedClient.fullName || selectedClient.username || '?').slice(0, 1).toUpperCase()}</Text>
                    : <Ionicons name="business-outline" size={20} color={colors.textMuted} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectRowLabel}>{t('tasks.client')} <Text style={styles.requiredMark}>*</Text></Text>
                  <Text style={[styles.selectRowValue, !selectedClient && styles.selectRowPlaceholder]} numberOfLines={1}>
                    {selectedClient ? (selectedClient.fullName || selectedClient.username || selectedClient.email) : t('tasks.selectClient')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.selectRow, selectedDriver && styles.selectRowFilled]}
                onPress={() => { setPickSearch(''); setPickOpen('driver'); }}
                activeOpacity={0.85}
              >
                <View style={[styles.selectAvatar, selectedDriver && styles.selectAvatarFilled]}>
                  {selectedDriver
                    ? <Text style={styles.selectAvatarText}>{String(selectedDriver.fullName || selectedDriver.username || '?').slice(0, 1).toUpperCase()}</Text>
                    : <Ionicons name="person-outline" size={20} color={colors.textMuted} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectRowLabel}>{t('tasks.driver')} <Text style={styles.requiredMark}>*</Text></Text>
                  <Text style={[styles.selectRowValue, !selectedDriver && styles.selectRowPlaceholder]} numberOfLines={1}>
                    {selectedDriver ? (selectedDriver.fullName || selectedDriver.username || selectedDriver.email) : t('tasks.selectDriver')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
              </TouchableOpacity>

              {/* 第 2 步 运输信息 */}
              <View style={styles.formSectionHead}>
                <View style={styles.formSectionBar} />
                <Text style={styles.formSectionTitle}>{t('tasks.secShipment')}</Text>
              </View>
              <Text style={styles.formLabel}>{t('tasks.endAddr')} <Text style={styles.requiredMark}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="location-outline" size={20} color={colors.textMuted} style={styles.inputRowIcon} />
                <TextInput value={endLocation} onChangeText={setEndLocation} style={styles.inputRowField} placeholder={t('tasks.endAddrPh')} placeholderTextColor={colors.textFaint} />
              </View>
              <Text style={styles.formLabel}>{t('tasks.cargo')} <Text style={styles.requiredMark}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="cube-outline" size={20} color={colors.textMuted} style={styles.inputRowIcon} />
                <TextInput value={cargo} onChangeText={setCargo} style={styles.inputRowField} placeholder={t('tasks.cargoPh')} placeholderTextColor={colors.textFaint} />
              </View>
              <Text style={styles.formLabel}>{t('tasks.weight')} <Text style={styles.requiredMark}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="scale-outline" size={20} color={colors.textMuted} style={styles.inputRowIcon} />
                <TextInput value={cargoWeight} onChangeText={setCargoWeight} style={styles.inputRowField} placeholder={t('tasks.weightPh')} placeholderTextColor={colors.textFaint} keyboardType="numeric" />
                <Text style={styles.inputSuffix}>{t('tasks.ton')}</Text>
              </View>

              {/* 第 3 步 时间与备注 */}
              <View style={styles.formSectionHead}>
                <View style={styles.formSectionBar} />
                <Text style={styles.formSectionTitle}>{t('tasks.secSchedule')}</Text>
              </View>
              <Text style={styles.formLabel}>{t('tasks.scheduledTime')} <Text style={styles.requiredMark}>*</Text></Text>
              <TouchableOpacity
                style={styles.inputRow}
                onPress={() => { setTempDate(scheduledAt || new Date()); setPicker('date'); }}
                activeOpacity={0.85}
              >
                <Ionicons name="calendar-outline" size={20} color={scheduledAt ? colors.accent : colors.textMuted} style={styles.inputRowIcon} />
                <Text style={[styles.inputRowField, !scheduledAt && styles.inputRowFieldPlaceholder]}>
                  {scheduledAt ? formatDriverDateTime(scheduledAt.toISOString()) : t('tasks.pickTime')}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.textFaint} />
              </TouchableOpacity>
              {picker && (
                <DateTimePicker
                  value={tempDate}
                  mode={picker}
                  is24Hour
                  onChange={onSchedPickerChange}
                />
              )}
              <Text style={styles.formLabel}>{t('tasks.notes')}</Text>
              <TextInput value={notes} onChangeText={setNotes} style={[styles.formInput, styles.formTextarea]} placeholder={t('common.optional')} placeholderTextColor={colors.textFaint} multiline />

              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnRow, (saving || !createFormValid) && styles.btnDisabled]}
                onPress={async () => {
                  if (!selectedClient?.id || !selectedDriver?.id || !endLocation.trim() || !cargo.trim() || !cargoWeight.trim() || !scheduledAt) {
                    showAppAlert(t('common.notice'), t('tasks.fillRequired'));
                    return;
                  }
                  try {
                    setSaving(true);
                    // 任务名 = 客户名-年月日-当日序号（如 test1-20260627-001）
                    // 用「标题里已含今天日期」数序号：不受时区影响、按顺序递增。
                    const _now = new Date();
                    const _pad = (n: number) => String(n).padStart(2, '0');
                    const _ymd = `${_now.getFullYear()}${_pad(_now.getMonth() + 1)}${_pad(_now.getDate())}`;
                    const _sameDay = tasks.filter(
                      (tk: any) => typeof tk?.title === 'string' && tk.title.includes(`-${_ymd}-`),
                    ).length;
                    const _clientName = selectedClient.fullName || selectedClient.username || '客户';
                    const titleText = `${_clientName}-${_ymd}-${String(_sameDay + 1).padStart(3, '0')}`;
                    const payload: any = {
                      clientId: selectedClient.id,
                      driverId: selectedDriver.id,
                      title: titleText,
                      endLocation: endLocation.trim(),
                      scheduledAt: scheduledAt.toISOString(),
                    };
                    if (cargo.trim()) payload.cargo = cargo.trim();
                    if (cargoWeight.trim()) payload.cargoWeight = Number(cargoWeight);
                    if (notes.trim()) payload.notes = notes.trim();
                    await tasksApi.create(payload);
                    setCreateOpen(false);
                    load();
                    showAppAlert(t('common.success'), t('tasks.created'));
                  } catch (e: any) {
                    showAppAlert(t('common.fail'), e?.message || t('tasks.createFailed'));
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? <ActivityIndicator color={colors.onAccent} /> : (
                  <>
                    <Ionicons name="paper-plane" size={18} color={colors.onAccent} />
                    <Text style={styles.modalBtnText}>{t('tasks.createDispatch')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={pickOpen != null} animationType="fade" transparent onRequestClose={() => setPickOpen(null)}>
        <View style={styles.pickWrap}>
          <View style={styles.pickCard}>
            <View style={styles.pickHeader}>
              <Text style={styles.pickHeaderTitle}>{pickOpen === 'client' ? t('tasks.selectClient') : t('tasks.selectDriver')}</Text>
              <TouchableOpacity onPress={() => { setPickOpen(null); setAssigningTask(null); }} style={styles.modalClose} activeOpacity={0.8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.pickSearchBox}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                value={pickSearch}
                onChangeText={setPickSearch}
                style={styles.pickSearchInput}
                placeholder={t('d.search')}
                placeholderTextColor={colors.textFaint}
              />
            </View>
            <FlatList
              data={pickList}
              keyExtractor={(it: any) => it.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = pickOpen === 'client' ? selectedClient?.id === item.id : (!assigningTask && selectedDriver?.id === item.id);
                return (
                  <TouchableOpacity
                    style={[styles.pickItem, selected && styles.pickItemSelected]}
                    onPress={async () => {
                      if (pickOpen === 'client') {
                        setSelectedClient(item);
                        setPickOpen(null);
                        return;
                      }
                      if (assigningTask) {
                        try {
                          await tasksApi.assign(assigningTask.id, item.id);
                          setAssigningTask(null);
                          setPickOpen(null);
                          load();
                          showAppAlert(t('common.success'), t('tasks.driverAssigned'));
                        } catch (e: any) {
                          showAppAlert(t('common.fail'), e?.message || t('tasks.assignFailed'));
                        }
                        return;
                      }
                      setSelectedDriver(item);
                      setPickOpen(null);
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.selectAvatar, styles.selectAvatarFilled, { marginRight: space.md }]}>
                      <Text style={styles.selectAvatarText}>
                        {String(item.fullName || item.username || '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickItemTitle} numberOfLines={1}>
                        {item.fullName || item.username || item.email}
                      </Text>
                      <Text style={styles.pickItemSub} numberOfLines={1}>{item.email}</Text>
                    </View>
                    {selected && <Ionicons name="checkmark-circle" size={22} color={colors.accent} />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ padding: space.xl }}>
                  <Text style={styles.emptyInlineText}>{t('common.noData')}</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ===== 司机端列表 =====
  driverPage: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // 左右留白由列表内容统一给（头部现在也是列表的一部分）
  driverListContentScroll: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxxl,
  },
  driverHeader: {
    paddingTop: space.huge + space.lg,
    backgroundColor: colors.bg,
  },
  driverGreeting: {
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: weight.heavy,
    lineHeight: 36,
  },
  driverSubTitle: {
    color: colors.textMuted,
    fontSize: font.sm,
    marginTop: space.sm,
    marginBottom: space.xxl,
  },
  driverStatsGrid: {
    flexDirection: 'row',
    gap: space.md,
    marginBottom: space.md,
  },
  driverStatCard: {
    flex: 1,
    minHeight: hit.min + space.xxl,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  driverStatBlue: {
    borderColor: colors.info,
  },
  driverStatAmber: {
    borderColor: colors.accent,
  },
  driverStatRed: {
    borderColor: colors.danger,
  },
  driverStatGreen: {
    borderColor: colors.success,
  },
  /** 已完成是「过去的事」，和已完成标签一样用中性灰，别抢进行中的绿 */
  driverStatMuted: {
    borderColor: colors.borderStrong,
  },
  /** 「只看今天」选中态 */
  driverStatCardOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  driverStatValue: {
    fontSize: font.xl,
    fontWeight: weight.heavy,
    lineHeight: 28,
  },
  driverStatLabel: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontWeight: weight.bold,
    marginTop: space.xs,
  },
  driverFilterRow: {
    gap: space.sm,
    paddingRight: space.sm,
    marginBottom: space.lg,
  },
  driverFilterPill: {
    minWidth: 64,
    minHeight: hit.min,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  driverFilterPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  driverFilterText: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.heavy,
  },
  driverFilterTextActive: {
    color: colors.onAccent,
  },
  driverSearchBox: {
    height: hit.min,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    marginBottom: space.lg,
  },
  driverSearchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    height: '100%',
  },
  driverTaskCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: space.lg,
    marginBottom: space.md,
  },
  /** 标题和状态标签同一行：标题收缩、标签不压缩（原来标签绝对定位在右上角，标题要留 80 的右内边距躲它） */
  driverTaskHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.xs,
  },
  driverStatusBadge: {
    flexShrink: 0,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  driverStatusText: {
    fontSize: font.sm,
    fontWeight: weight.heavy,
  },
  driverTaskTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
  },
  driverTaskMeta: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.bold,
  },
  driverTaskRoute: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.bold,
    marginTop: space.sm,
  },
  driverTaskDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: space.md,
  },
  driverTaskBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
  },
  driverInfoLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  /** flex + minWidth:0 才不会把右边的吨数挤出卡片 */
  driverTaskDate: {
    flex: 1,
    minWidth: 0,
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.bold,
  },
  driverTaskCreated: {
    flex: 1,
    minWidth: 0,
    color: colors.textFaint,
    fontSize: font.xs,
    fontWeight: weight.bold,
  },
  driverTaskAmount: {
    color: colors.accent,
    fontSize: font.lg,
    fontWeight: weight.heavy,
    marginLeft: space.md,
  },
  driverAmountPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginLeft: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  driverAmountValue: {
    color: colors.accent,
    fontSize: font.lg,
    fontWeight: weight.heavy,
  },
  driverAmountUnit: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: weight.heavy,
    marginLeft: space.xs,
  },
  driverAcceptInline: {
    marginTop: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAcceptInlineText: {
    color: colors.accent,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  driverCompleteInline: {
    marginTop: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: colors.successSoft,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverCompleteInlineText: {
    color: colors.success,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },

  // ===== 完工弹窗 =====
  completeHint: {
    color: colors.textMuted,
    fontSize: font.sm,
    lineHeight: 20,
    marginBottom: space.lg,
  },
  completePhotoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginBottom: space.lg,
  },
  completePhotoWrap: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surfaceAlt,
  },
  completePhoto: {
    width: '100%',
    height: '100%',
  },
  completePhotoRemove: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completePhotoAdd: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completePhotoAddText: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.heavy,
  },
  completeNotesInput: {
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: colors.text,
    fontSize: font.base,
    marginBottom: space.lg,
  },
  completeSubmitBtn: {
    backgroundColor: colors.success,
    borderRadius: radius.md,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeSubmitText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },

  // ===== 空状态 =====
  driverEmptyBox: {
    flex: 1,
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: space.huge,
  },
  driverEmptyIcon: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  driverEmptyTitle: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: weight.heavy,
  },
  driverEmptySub: {
    color: colors.textFaint,
    fontSize: font.sm,
    marginTop: space.md,
    fontWeight: weight.bold,
  },
  adminListContent: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxxl,
  },
  emptyBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: space.huge,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: radius.xl,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  emptyText: {
    fontSize: font.xl,
    color: colors.text,
    fontWeight: weight.heavy,
  },
  emptySub: {
    fontSize: font.sm,
    color: colors.textFaint,
    marginTop: space.md,
    fontWeight: weight.bold,
  },
  emptyInlineText: {
    color: colors.textMuted,
    fontSize: font.sm,
    textAlign: 'center',
  },

  // ===== 管理端 / 客户端 =====
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  loadingSpinner: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: font.sm,
  },
  header: {
    backgroundColor: colors.bg,
    paddingTop: space.huge + space.lg,
    paddingBottom: space.lg,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  headerTitle: {
    fontSize: font.xl,
    fontWeight: weight.heavy,
    color: colors.text,
    marginBottom: space.xs,
  },
  headerSub: {
    fontSize: font.sm,
    color: colors.textMuted,
  },
  headerIconBtn: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadge: {
    position: 'absolute',
    top: -space.xs,
    right: -space.xs,
    minWidth: 20,
    height: 20,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  unreadBadgeText: {
    color: colors.text,
    fontSize: font.xs,
    fontWeight: weight.heavy,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: hit.min,
    marginTop: space.lg,
  },
  createBtnText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },

  // ===== 通知 =====
  notificationItem: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: hit.min,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  notificationItemUnread: {
    backgroundColor: colors.accentSoft,
  },
  notificationItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  notificationItemTitle: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.heavy,
    flex: 1,
    minWidth: 0,
  },
  notificationItemBody: {
    color: colors.textMuted,
    fontSize: font.sm,
    marginTop: space.xs,
    lineHeight: 20,
  },
  unreadDot: {
    width: space.sm,
    height: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },

  // ===== 任务卡片 =====
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.md,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: font.lg,
    fontWeight: weight.bold,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  /** 状态标签不参与压缩,否则长标题会把它挤成两行 */
  badge: {
    flexShrink: 0,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: font.sm,
    fontWeight: weight.bold,
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  destText: {
    flex: 1,
    minWidth: 0,
    fontSize: font.base,
    color: colors.text,
    fontWeight: weight.semibold,
  },
  cardMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  cardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexBasis: '50%',
    paddingRight: space.sm,
  },
  cardMetaText: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.semibold,
    flexShrink: 1,
    minWidth: 0,
  },
  cargoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  cargoText: {
    flex: 1,
    minWidth: 0,
    fontSize: font.sm,
    color: colors.accent,
    fontWeight: weight.semibold,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
  },
  footerText: {
    fontSize: font.xs,
    color: colors.textFaint,
  },
  actionRow: {
    flexDirection: 'row',
    gap: space.md,
    marginBottom: space.md,
  },
  smallBtn: {
    minHeight: hit.min,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  smallBtnPrimary: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  smallBtnDanger: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  smallBtnTextPrimary: {
    color: colors.accent,
    fontWeight: weight.heavy,
    fontSize: font.sm,
  },
  smallBtnTextDanger: {
    color: colors.danger,
    fontWeight: weight.heavy,
    fontSize: font.sm,
  },
  arrowIcon: {
    width: space.xxl + space.xs,
    height: space.xxl + space.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowText: {
    fontSize: font.base,
    color: colors.accent,
    fontWeight: weight.bold,
  },
  plateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  plateChipText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: weight.heavy,
    letterSpacing: 1,
  },
  acceptBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xs,
  },
  acceptBtnText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.infoSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    minHeight: hit.min,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  continueBtnText: {
    color: colors.info,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },

  // ===== 弹窗外壳 =====
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.lg,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingBottom: space.md,
  },
  modalTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
  },
  modalSubtitle: {
    color: colors.accent,
    fontSize: font.xs,
    fontWeight: weight.bold,
    marginTop: space.xs,
  },
  modalClose: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: space.lg,
  },
  pickCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    maxHeight: '80%',
  },
  pickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickHeaderTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
  },
  pickSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    marginHorizontal: space.lg,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  pickSearchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    paddingVertical: space.md,
  },
  pickItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: hit.min,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickItemSelected: {
    backgroundColor: colors.accentSoft,
  },
  pickItemTitle: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  pickItemSub: {
    color: colors.textFaint,
    fontSize: font.sm,
    marginTop: space.xs,
  },

  // ===== 接单 / 车牌弹窗 =====
  acceptCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    width: '100%',
  },
  acceptContent: {
    padding: space.lg,
  },
  acceptTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
    marginBottom: space.md,
  },
  acceptInfoBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  acceptInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  acceptInfoLabel: {
    width: 96,
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.semibold,
  },
  acceptInfoValue: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.semibold,
    lineHeight: 20,
  },
  acceptActions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.lg,
  },
  plateHint: {
    color: colors.textMuted,
    fontSize: font.sm,
    lineHeight: 20,
    marginBottom: space.md,
  },
  plateInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    minHeight: hit.min,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.heavy,
    letterSpacing: 1,
    marginBottom: space.lg,
  },
  plateWarnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  plateWarnText: {
    flex: 1,
    minWidth: 0,
    color: colors.accent,
    fontSize: font.sm,
    lineHeight: 20,
    fontWeight: weight.semibold,
  },
  platePickBox: {
    marginBottom: space.lg,
  },
  platePickLabel: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontWeight: weight.bold,
    marginBottom: space.sm,
  },
  platePickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  plateChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: hit.min,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  plateChipBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  plateChipBtnText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: weight.heavy,
    letterSpacing: 0.6,
  },
  plateChipBtnTextActive: {
    color: colors.onAccent,
  },

  // ===== 发布任务表单 =====
  formSectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
    marginBottom: space.md,
  },
  formSectionBar: {
    width: 3,
    height: font.base,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  formSectionTitle: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  requiredMark: {
    color: colors.danger,
    fontWeight: weight.heavy,
  },
  formLabel: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontWeight: weight.bold,
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  formInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    minHeight: hit.min,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    color: colors.text,
    fontSize: font.base,
    marginBottom: space.md,
  },
  formTextarea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: hit.min,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  selectRowFilled: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  selectAvatar: {
    width: hit.compact,
    height: hit.compact,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAvatarFilled: {
    backgroundColor: colors.accentSoft,
  },
  selectAvatarText: {
    color: colors.accent,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  selectRowLabel: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontWeight: weight.bold,
    marginBottom: space.xs,
  },
  selectRowValue: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  selectRowPlaceholder: {
    color: colors.textFaint,
    fontWeight: weight.semibold,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    minHeight: hit.min,
    paddingHorizontal: space.md,
    marginBottom: space.md,
  },
  inputRowIcon: {
    marginRight: space.sm,
  },
  inputRowField: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    paddingVertical: space.md,
  },
  inputRowFieldPlaceholder: {
    color: colors.textFaint,
  },
  inputSuffix: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.heavy,
    marginLeft: space.sm,
  },

  // ===== 弹窗按钮 =====
  modalBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: hit.min,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
    marginBottom: space.md,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
  },
  modalBtnText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  modalBtnSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    minHeight: hit.min,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  modalBtnSecondaryText: {
    color: colors.textMuted,
    fontSize: font.base,
    fontWeight: weight.heavy,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
