import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Modal, TextInput, ScrollView, Image,
  DeviceEventEmitter, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useDispatch, useSelector } from 'react-redux';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import DateTimePicker from '@react-native-community/datetimepicker';
import { gpsDevicesApi, notificationsApi, tasksApi, usersApi } from '../../src/api';
import { setActiveTask } from '../../src/store/taskSlice';
import type { RootState } from '../../src/store';
import { useLang } from '../../src/i18n';
import { showAppAlert } from '../../src/AppDialog';
import { colors, space, font, weight, radius, hit, shadow, statusColors } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Remembered per account so a shared phone never offers one driver another driver's plate
const LAST_PLATE_KEY = 'last_vehicle_plate';
const plateKey = (userId?: string) => `${LAST_PLATE_KEY}_${userId || 'anon'}`;


// 状态配色全 App 一套，定义在 theme.ts
const STATUS_COLOR: Record<string, { bg: string; text: string; border: string }> = statusColors;

export default function TasksScreen() {
  // 顶部安全区按机型取：原来写死 56，iPhone Pro 的灵动岛是 59~62，标题会被压住
  const insets = useSafeAreaInsets();
  // The hero sits under the status bar, so the status icons go light while this tab is on screen.
  // The <StatusBar> is mounted only while focused, so it hands the style back when the tab blurs.
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));
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

  // The phone no longer reports GPS: the vehicle's own tracker does, matched to the job by the plate the
  // driver picks when accepting. The store still needs to know the job in progress (the detail screen reads it).
  useEffect(() => {
    if (role !== 'driver') return;
    const active = tasks.find((tk: any) => tk.status === 'in_progress');
    if (!active) return;
    dispatch(setActiveTask({
      id: active.id,
      title: active.title,
      startLocation: active.startLocation,
      endLocation: active.endLocation,
      status: 'in_progress',
    }));
  }, [tasks, role]);

  // The plate is typed by hand; the last one used is offered again so a driver on the same truck
  // only confirms it. (The list of trucks with trackers is no longer shown here.)
  // Opens the create-job sheet with fresh client/driver lists (was the big amber bar; now a + in the header)
  const openCreateTask = async () => {
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
  };

  const openAcceptTask = (task: any) => {
    setAcceptTask(task);
    setVehiclePlate('');
    // only fill an empty field: never overwrite what the driver has already started typing
    SecureStore.getItemAsync(plateKey(user?.id)).then((p) => { if (p) setVehiclePlate((cur) => cur || p); }).catch(() => {});
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
      await tasksApi.start(acceptTask.id, vehiclePlate.trim());
      SecureStore.setItemAsync(plateKey(user?.id), vehiclePlate.trim()).catch(() => {});
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

  // ---- Render helpers: small pieces shared by the three role variants ----

  // Notification bell: sits on the navy hero; the unread count is a red badge on its corner
  const bell = (
    <TouchableOpacity style={styles.heroBtn} onPress={() => setNotificationsOpen(true)} activeOpacity={0.8}>
      <Ionicons name="notifications-outline" size={20} color={colors.heroText} />
      {unreadCount > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  // KPI strip: one white card with three cells and hairline dividers, no icons. Only the first
  // cell ("all jobs" / "today") is tappable: it toggles the today-only filter.
  const kpiCell = (cell: { value: number; label: string; active?: boolean; onPress?: () => void }) => {
    const body = (
      <>
        <Text style={[styles.kpiValue, cell.active && styles.kpiValueActive]} numberOfLines={1}>{cell.value}</Text>
        <Text style={styles.kpiLabel} numberOfLines={1}>{cell.label}</Text>
      </>
    );
    if (!cell.onPress) return <View style={styles.kpiCell}>{body}</View>;
    return (
      <TouchableOpacity style={styles.kpiCell} onPress={cell.onPress} activeOpacity={0.7}>
        {body}
      </TouchableOpacity>
    );
  };

  // Every role gets the same first cell: all jobs, or only today's while the filter is on
  const kpiStrip = (second: { value: number; label: string }, third: { value: number; label: string }) => (
    <View style={styles.kpiStrip}>
      {kpiCell({
        value: todayOnly ? todayCount : tasks.length,
        label: todayOnly ? t('d.statToday') : t('d.statTotal'),
        active: todayOnly,
        onPress: () => setTodayOnly(v => !v),
      })}
      <View style={styles.kpiDivider} />
      {kpiCell(second)}
      <View style={styles.kpiDivider} />
      {kpiCell(third)}
    </View>
  );

  // Filter chips: a horizontal pill row that bleeds to the screen edges
  const filterPills = <K extends string>(
    items: Array<{ key: K; label: string }>,
    current: K,
    onPick: (key: K) => void,
  ) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
      {items.map((item) => {
        const active = current === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.filterPill, active && styles.filterPillActive]}
            onPress={() => onPick(item.key)}
            activeOpacity={0.85}
          >
            <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const searchBox = (
    <View style={styles.searchBox}>
      <Ionicons name="search-outline" size={18} color={colors.textFaint} />
      <TextInput
        value={searchText}
        onChangeText={setSearchText}
        style={styles.searchInput}
        placeholder={t('d.search')}
        placeholderTextColor={colors.textFaint}
      />
    </View>
  );

  // Status on a card: a coloured dot and the word, in the status colour
  const statusMark = (st: { bg: string; text: string; border: string }, label: string) => (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: st.text }]} />
      <Text style={[styles.statusText, { color: st.text }]} numberOfLines={1}>{label}</Text>
    </View>
  );

  const plateChip = (plate: string) => (
    <View style={styles.plateChip}>
      <Text style={styles.plateChipText}>{plate}</Text>
    </View>
  );

  // Card meta: the secondary facts in one line separated by middle dots; empty facts are skipped
  const metaLine = (parts: Array<string | false | null | undefined>) => (
    <Text style={styles.metaLine} numberOfLines={2}>{parts.filter(Boolean).join(' · ')}</Text>
  );

  // Sheet chrome shared by every modal on this screen: drag handle, title and close button
  const sheetHead = (titleText: string, onClose: () => void) => (
    <>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle} numberOfLines={1}>{titleText}</Text>
        <TouchableOpacity onPress={onClose} style={styles.sheetClose} activeOpacity={0.8}>
          <Ionicons name="close-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </>
  );

  const infoRow = (label: string, value: string, last?: boolean) => (
    <View style={[styles.infoRow, last && styles.infoRowLast]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );

  // Sheets sit on the home indicator, so they pad for it; sheets with inputs lift above the keyboard on iOS
  const sheetBottomPad = { paddingBottom: Math.max(insets.bottom, space.lg) };
  const keyboardBehavior = Platform.OS === 'ios' ? ('padding' as const) : undefined;

  // Accept-job confirmation: the job summary, then cancel / confirm (confirm goes on to the plate sheet)
  const acceptSheet = (
    <Modal visible={!!acceptTask && !plateOpen} animationType="slide" transparent onRequestClose={() => setAcceptTask(null)}>
      <View style={styles.sheetScrim}>
        <View style={[styles.sheet, sheetBottomPad]}>
          {sheetHead(t('d.acceptConfirm'), () => setAcceptTask(null))}
          {acceptTask && (
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetLead} numberOfLines={2}>{acceptTask.title}</Text>
              <View style={styles.infoBox}>
                {infoRow(t('d.client'), getPersonName(acceptTask.client))}
                {infoRow(t('d.to'), acceptTask.endLocation || '-')}
                {infoRow(t('d.cargo'), acceptTask.cargo || '-')}
                {infoRow(t('d.weight'), acceptTask.cargoWeight ? `${acceptTask.cargoWeight} ${t('td.ton')}` : '-')}
                {infoRow(
                  t('d.scheduled'),
                  acceptTask.scheduledAt ? new Date(acceptTask.scheduledAt).toLocaleString() : '-',
                  true,
                )}
              </View>
              <View style={styles.sheetActions}>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={handleConfirmTaskInfo}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnPrimaryText}>{t('d.confirm')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnText}
                  onPress={() => setAcceptTask(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.btnTextLabel}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );

  const notificationsSheet = (
    <Modal visible={notificationsOpen} animationType="slide" transparent onRequestClose={() => setNotificationsOpen(false)}>
      <View style={styles.sheetScrim}>
        <View style={[styles.sheet, sheetBottomPad]}>
          {sheetHead(t('tasks.notifTitle0'), () => setNotificationsOpen(false))}
          <FlatList
            data={notifications}
            keyExtractor={(it: any) => it.id}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.notificationItem}
                onPress={() => openNotification(item)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.notificationItemHeader}>
                    {!item.isRead && <View style={styles.unreadDot} />}
                    <Text
                      style={[styles.notificationItemTitle, !item.isRead && styles.notificationItemTitleUnread]}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                  </View>
                  <Text style={styles.notificationItemBody} numberOfLines={2}>{item.content}</Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={16} color={colors.textFaint} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.sheetEmpty}>
                <Text style={styles.emptyInlineText}>{t('tasks.noNotif')}</Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (role === 'driver') {
    return (
      <View style={styles.page}>
        {isFocused && <StatusBar style="light" />}
        {/* Navy behind the list top, so an over-scroll on iOS shows navy above the hero, not grey */}
        <View style={styles.heroBleed} />
        <FlatList
          data={filteredDriverTasks}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Greeting, stats, filters and search scroll with the list so small phones keep room for cards
          ListHeaderComponent={(
            <View>
              <View style={[styles.hero, { paddingTop: insets.top + space.md }]}>
                <View style={styles.heroRow}>
                  {/* company logo: brands every in-app screen, not only the sign-in page */}
                  <View style={styles.heroLogo}><Image source={require('../../assets/log.png')} style={styles.heroLogoImg} resizeMode="contain" /></View>
                  <View style={styles.heroTextBlock}>
                    <Text style={styles.heroTitle} numberOfLines={1}>{t('d.greetingPrefix')}{driverName}</Text>
                    <Text style={styles.heroSubtitle} numberOfLines={1}>{driverSubtitle}</Text>
                  </View>
                  {bell}
                </View>
              </View>

              <View style={styles.headerBody}>
                {kpiStrip(
                  { value: driverInProgressCount, label: t('d.statActive') },
                  { value: driverOverdueCount, label: t('d.statOverdue') },
                )}
              </View>

              {filterPills(driverFilterItems, driverFilter, (key) => setDriverFilter(key))}

              <View style={styles.headerBody}>{searchBox}</View>
            </View>
          )}
          contentContainerStyle={[
            styles.listContent,
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
            <View style={styles.emptyBox}>
              <Ionicons name="clipboard-outline" size={48} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>{t('d.emptyTitle')}</Text>
              <Text style={styles.emptySub}>{t('d.emptySub')}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const st = getDriverStatusStyle(item);
            const statusText = getDriverStatusText(item);
            const clientName = getPersonName(item.client);
            return (
              <TouchableOpacity
                style={styles.card}
                // The whole card is tappable: a job to accept opens the accept flow, the rest open the detail
                onPress={() => (item.status === 'assigned' ? openAcceptTask(item) : router.push(`/task/${item.id}`))}
                activeOpacity={0.9}
              >
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title || t('d.taskFallback')}</Text>
                  {statusMark(st, statusText)}
                </View>

                {!!item.endLocation && (
                  <View style={styles.destRow}>
                    <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                    <Text style={styles.destText} numberOfLines={1}>{item.endLocation}</Text>
                  </View>
                )}

                {metaLine([
                  clientName !== '-' && clientName,
                  item.scheduledAt ? formatDriverDateTime(item.scheduledAt) : t('tasks.unscheduled'),
                  item.cargo || t('d.cargoFallback'),
                  !!item.cargoWeight && `${item.cargoWeight} ${t('tasks.ton')}`,
                ])}

                {!!item.vehiclePlate && (
                  <View style={styles.cardFooter}>
                    {plateChip(item.vehiclePlate)}
                  </View>
                )}

                {item.status === 'assigned' && (
                  <TouchableOpacity
                    style={[styles.btnPrimary, styles.cardAction, startingTaskId === item.id && styles.btnDisabled]}
                    onPress={() => openAcceptTask(item)}
                    disabled={startingTaskId === item.id}
                    activeOpacity={0.85}
                  >
                    {startingTaskId === item.id
                      ? <ActivityIndicator color={colors.onAccent} />
                      : <Text style={styles.btnPrimaryText}>{t('d.accept')}</Text>}
                  </TouchableOpacity>
                )}
                {item.status === 'in_progress' && (
                  <TouchableOpacity
                    style={[styles.btnSuccess, styles.cardAction, completingTaskId === item.id && styles.btnDisabled]}
                    onPress={() => openCompleteTask(item)}
                    disabled={completingTaskId === item.id}
                    activeOpacity={0.85}
                  >
                    {completingTaskId === item.id
                      ? <ActivityIndicator color={colors.heroText} />
                      : <Text style={styles.btnSuccessText}>{t('d.finish')}</Text>}
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
        />

        {acceptSheet}

        <Modal visible={plateOpen} animationType="slide" transparent onRequestClose={() => setPlateOpen(false)}>
          <KeyboardAvoidingView style={styles.sheetScrim} behavior={keyboardBehavior}>
            <View style={[styles.sheet, sheetBottomPad]}>
              {sheetHead(t('d.plateTitle'), () => setPlateOpen(false))}
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.sheetHint}>{t('d.plateHint')}</Text>
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
                    <Ionicons name="alert-circle-outline" size={16} color={colors.accentDark} />
                    <Text style={styles.plateWarnText}>
                      {t('d.plateNoTracker')}
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.btnPrimary, startingTaskId && styles.btnDisabled]}
                  onPress={handleStartAcceptedTask}
                  disabled={!!startingTaskId}
                  activeOpacity={0.85}
                >
                  {startingTaskId
                    ? <ActivityIndicator color={colors.onAccent} />
                    : <Text style={styles.btnPrimaryText}>{t('d.plateConfirm')}</Text>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={!!completeTask} animationType="slide" transparent onRequestClose={() => setCompleteTask(null)}>
          <KeyboardAvoidingView style={styles.sheetScrim} behavior={keyboardBehavior}>
            <View style={[styles.sheet, sheetBottomPad]}>
              {sheetHead(t('d.finishTitle'), () => {
                setCompleteTask(null);
                setCompletePhotos([]);
                setCompleteNotes('');
              })}
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.sheetLead} numberOfLines={2}>{completeTask?.title || t('d.taskFallback')}</Text>
                <Text style={styles.sheetHint}>{t('d.completeHint')}</Text>

                <View style={styles.photoGrid}>
                  {completePhotos.map((uri, index) => (
                    <View key={uri} style={styles.photoWrap}>
                      <Image source={{ uri }} style={styles.photo} />
                      <TouchableOpacity
                        style={styles.photoRemove}
                        hitSlop={{ top: space.md, bottom: space.md, left: space.md, right: space.md }}
                        onPress={() => setCompletePhotos(prev => prev.filter((_, i) => i !== index))}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="close-outline" size={16} color={colors.heroText} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {completePhotos.length < 5 && (
                    <TouchableOpacity style={styles.photoAdd} onPress={handleTakeCompletePhoto} activeOpacity={0.85}>
                      <Ionicons name="camera-outline" size={20} color={colors.textMuted} />
                      <Text style={styles.photoAddText}>{t('d.takePhoto')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  value={completeNotes}
                  onChangeText={setCompleteNotes}
                  multiline
                  style={styles.notesInput}
                  placeholder={t('td.notesPh')}
                  placeholderTextColor={colors.textFaint}
                />

                <TouchableOpacity
                  style={[styles.btnSuccess, completingTaskId && styles.btnDisabled]}
                  onPress={handleSubmitCompleteTask}
                  disabled={!!completingTaskId}
                  activeOpacity={0.85}
                >
                  {completingTaskId
                    ? <ActivityIndicator color={colors.heroText} />
                    : <Text style={styles.btnSuccessText}>{t('d.submitFinish')}</Text>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {notificationsSheet}
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {isFocused && <StatusBar style="light" />}
      <View style={styles.heroBleed} />
      <FlatList
        data={filteredAdminTasks}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Title, stats, filters and search scroll with the list (same as the driver view)
        ListHeaderComponent={(
          <View>
            <View style={[styles.hero, { paddingTop: insets.top + space.md }]}>
              <View style={styles.heroRow}>
                {/* company logo: brands every in-app screen, not only the sign-in page */}
                <View style={styles.heroLogo}><Image source={require('../../assets/log.png')} style={styles.heroLogoImg} resizeMode="contain" /></View>
                <View style={styles.heroTextBlock}>
                  <Text style={styles.heroTitle} numberOfLines={1}>{title}</Text>
                  <Text style={styles.heroSubtitle} numberOfLines={1}>{getToday()}</Text>
                </View>
                {bell}
                <TouchableOpacity style={styles.heroBtn} onPress={load} activeOpacity={0.8} accessibilityLabel={t('tasks.refresh')}>
                  <Ionicons name="refresh-outline" size={20} color={colors.heroText} />
                </TouchableOpacity>
                {canManage && (
                  <TouchableOpacity style={[styles.heroBtn, styles.heroBtnPrimary]} onPress={openCreateTask} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={t('tasks.createTask')}>
                    <Ionicons name="add" size={24} color={colors.onAccent} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={styles.headerBody}>
              {kpiStrip(
                { value: getInProgressCount(), label: t('tasks.inProgress') },
                { value: getCompletedCount(), label: t('tasks.completed') },
              )}
            </View>

            {filterPills(adminFilterItems, adminFilter, (key) => setAdminFilter(key))}

            <View style={styles.headerBody}>{searchBox}</View>
          </View>
        )}
        contentContainerStyle={[styles.listContent, filteredAdminTasks.length === 0 && { flexGrow: 1 }]}
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
            <Ionicons name="clipboard-outline" size={48} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{t('tasks.emptyTitle')}</Text>
            <Text style={styles.emptySub}>{t('tasks.emptySub')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const statusStyle = STATUS_COLOR[item.status] || STATUS_COLOR.pending;
          // A driver is required at creation so jobs never sit in pending; an assigned job that has not
          // started can still be reassigned or cancelled, and a finished one can be deleted
          const canEdit = canManage && (item.status === 'pending' || item.status === 'assigned');
          const canDelete = canManage && (item.status === 'completed' || item.status === 'cancelled');
          const iconHitSlop = { top: space.sm, bottom: space.sm, left: space.xs, right: space.xs };
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => {
                if (role === 'driver' && item.status === 'assigned') {
                  openAcceptTask(item);
                  return;
                }
                if (item.status === 'in_progress' || item.status === 'completed' || canManage) {
                  router.push(`/task/${item.id}`);
                }
              }}
              activeOpacity={0.9}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                {statusMark(statusStyle, t('status.' + item.status))}
              </View>

              <View style={styles.destRow}>
                <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                <Text style={styles.destText} numberOfLines={1}>{item.endLocation}</Text>
              </View>

              {metaLine([
                getPersonName(item.client),
                getPersonName(item.driver),
                item.scheduledAt ? formatDriverDateTime(item.scheduledAt) : t('tasks.unscheduled'),
                item.cargo,
                !!item.cargo && !!item.cargoWeight && `${item.cargoWeight} ${t('tasks.ton')}`,
              ])}

              {/* Footer only when there is something to put in it: the plate, the admin's icon buttons, or both */}
              {(!!item.vehiclePlate || canEdit || canDelete) && (
                <View style={styles.cardFooter}>
                  {!!item.vehiclePlate && plateChip(item.vehiclePlate)}
                  {(canEdit || canDelete) && (
                    <View style={styles.iconBtnRow}>
                      {canEdit && (
                        <TouchableOpacity
                          style={styles.iconBtn}
                          hitSlop={iconHitSlop}
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
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={t('tasks.assignDriver')}
                        >
                          <Ionicons name="person-add-outline" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
                      {canEdit && (
                        <TouchableOpacity
                          style={styles.iconBtn}
                          hitSlop={iconHitSlop}
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
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={t('tasks.cancel')}
                        >
                          <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                        </TouchableOpacity>
                      )}
                      {canDelete && (
                        <TouchableOpacity
                          style={styles.iconBtn}
                          hitSlop={iconHitSlop}
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
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={t('tasks.delete')}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              )}

              {role === 'driver' && item.status === 'assigned' && (
                <TouchableOpacity
                  style={[styles.btnPrimary, styles.cardAction, startingTaskId === item.id && styles.btnDisabled]}
                  onPress={() => openAcceptTask(item)}
                  disabled={startingTaskId === item.id}
                  activeOpacity={0.85}
                >
                  {startingTaskId === item.id
                    ? <ActivityIndicator color={colors.onAccent} />
                    : <Text style={styles.btnPrimaryText}>{t('d.accept')}</Text>}
                </TouchableOpacity>
              )}

              {role === 'driver' && item.status === 'in_progress' && (
                <TouchableOpacity
                  style={[styles.continueBtn, styles.cardAction]}
                  onPress={() => router.push(`/task/${item.id}`)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.continueBtnText}>{t('d.continue')}</Text>
                  <Ionicons name="arrow-forward-outline" size={18} color={colors.heroText} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        }}
      />

      {acceptSheet}

      <Modal visible={plateOpen} animationType="slide" transparent onRequestClose={() => setPlateOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetScrim} behavior={keyboardBehavior}>
          <View style={[styles.sheet, sheetBottomPad]}>
            {sheetHead(t('d.plateTitle'), () => setPlateOpen(false))}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetHint}>{t('d.plateHint')}</Text>
              <TextInput
                value={vehiclePlate}
                onChangeText={setVehiclePlate}
                style={styles.plateInput}
                placeholder={t('d.platePh')}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={[styles.btnPrimary, startingTaskId && styles.btnDisabled]}
                onPress={handleStartAcceptedTask}
                disabled={!!startingTaskId}
                activeOpacity={0.85}
              >
                {startingTaskId
                  ? <ActivityIndicator color={colors.onAccent} />
                  : <Text style={styles.btnPrimaryText}>{t('d.plateConfirm')}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {notificationsSheet}

      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetScrim} behavior={keyboardBehavior}>
          <View style={[styles.sheet, sheetBottomPad]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{t('tasks.createTaskTitle')}</Text>
                <Text style={styles.sheetSubtitle} numberOfLines={1}>{taskNamePreview}</Text>
              </View>
              <TouchableOpacity onPress={() => setCreateOpen(false)} style={styles.sheetClose} activeOpacity={0.8}>
                <Ionicons name="close-outline" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Step 1: client and driver */}
              <Text style={styles.formSectionTitle}>{t('tasks.secClientDriver')}</Text>
              <TouchableOpacity
                style={[styles.selectRow, selectedClient && styles.selectRowFilled]}
                onPress={() => { setPickSearch(''); setPickOpen('client'); }}
                activeOpacity={0.85}
              >
                <View style={[styles.selectAvatar, selectedClient && styles.selectAvatarFilled]}>
                  {selectedClient
                    ? <Text style={styles.selectAvatarText}>{String(selectedClient.fullName || selectedClient.username || '?').slice(0, 1).toUpperCase()}</Text>
                    : <Ionicons name="business-outline" size={18} color={colors.textFaint} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.selectRowLabel}>{t('tasks.client')} <Text style={styles.requiredMark}>*</Text></Text>
                  <Text style={[styles.selectRowValue, !selectedClient && styles.selectRowPlaceholder]} numberOfLines={1}>
                    {selectedClient ? (selectedClient.fullName || selectedClient.username || selectedClient.email) : t('tasks.selectClient')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={18} color={colors.textFaint} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.selectRow, selectedDriver && styles.selectRowFilled]}
                onPress={() => { setPickSearch(''); setPickOpen('driver'); }}
                activeOpacity={0.85}
              >
                <View style={[styles.selectAvatar, selectedDriver && styles.selectAvatarFilled]}>
                  {selectedDriver
                    ? <Text style={styles.selectAvatarText}>{String(selectedDriver.fullName || selectedDriver.username || '?').slice(0, 1).toUpperCase()}</Text>
                    : <Ionicons name="person-outline" size={18} color={colors.textFaint} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.selectRowLabel}>{t('tasks.driver')} <Text style={styles.requiredMark}>*</Text></Text>
                  <Text style={[styles.selectRowValue, !selectedDriver && styles.selectRowPlaceholder]} numberOfLines={1}>
                    {selectedDriver ? (selectedDriver.fullName || selectedDriver.username || selectedDriver.email) : t('tasks.selectDriver')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={18} color={colors.textFaint} />
              </TouchableOpacity>

              {/* Step 2: shipment */}
              <Text style={styles.formSectionTitle}>{t('tasks.secShipment')}</Text>
              <Text style={styles.formLabel}>{t('tasks.endAddr')} <Text style={styles.requiredMark}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="location-outline" size={18} color={colors.textFaint} style={styles.inputRowIcon} />
                <TextInput value={endLocation} onChangeText={setEndLocation} style={styles.inputRowField} placeholder={t('tasks.endAddrPh')} placeholderTextColor={colors.textFaint} />
              </View>
              <Text style={styles.formLabel}>{t('tasks.cargo')} <Text style={styles.requiredMark}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="cube-outline" size={18} color={colors.textFaint} style={styles.inputRowIcon} />
                <TextInput value={cargo} onChangeText={setCargo} style={styles.inputRowField} placeholder={t('tasks.cargoPh')} placeholderTextColor={colors.textFaint} />
              </View>
              <Text style={styles.formLabel}>{t('tasks.weight')} <Text style={styles.requiredMark}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="scale-outline" size={18} color={colors.textFaint} style={styles.inputRowIcon} />
                <TextInput value={cargoWeight} onChangeText={setCargoWeight} style={styles.inputRowField} placeholder={t('tasks.weightPh')} placeholderTextColor={colors.textFaint} keyboardType="numeric" />
                <Text style={styles.inputSuffix}>{t('tasks.ton')}</Text>
              </View>

              {/* Step 3: schedule and notes */}
              <Text style={styles.formSectionTitle}>{t('tasks.secSchedule')}</Text>
              <Text style={styles.formLabel}>{t('tasks.scheduledTime')} <Text style={styles.requiredMark}>*</Text></Text>
              <TouchableOpacity
                style={styles.inputRow}
                onPress={() => { setTempDate(scheduledAt || new Date()); setPicker('date'); }}
                activeOpacity={0.85}
              >
                <Ionicons name="calendar-outline" size={18} color={scheduledAt ? colors.textMuted : colors.textFaint} style={styles.inputRowIcon} />
                <Text style={[styles.inputRowField, !scheduledAt && styles.inputRowFieldPlaceholder]}>
                  {scheduledAt ? formatDriverDateTime(scheduledAt.toISOString()) : t('tasks.pickTime')}
                </Text>
                <Ionicons name="chevron-down-outline" size={18} color={colors.textFaint} />
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
                style={[styles.btnPrimary, styles.btnRow, styles.formSubmit, (saving || !createFormValid) && styles.btnDisabled]}
                onPress={async () => {
                  if (!selectedClient?.id || !selectedDriver?.id || !endLocation.trim() || !cargo.trim() || !cargoWeight.trim() || !scheduledAt) {
                    showAppAlert(t('common.notice'), t('tasks.fillRequired'));
                    return;
                  }
                  try {
                    setSaving(true);
                    // Task name = client-yyyymmdd-daily sequence (e.g. test1-20260627-001).
                    // The sequence counts titles that already contain today's date: timezone-safe and monotonic.
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
                    <Ionicons name="paper-plane-outline" size={18} color={colors.onAccent} />
                    <Text style={styles.btnPrimaryText}>{t('tasks.createDispatch')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={pickOpen != null} animationType="slide" transparent onRequestClose={() => setPickOpen(null)}>
        <KeyboardAvoidingView style={styles.sheetScrim} behavior={keyboardBehavior}>
          <View style={[styles.sheet, sheetBottomPad]}>
            {sheetHead(
              pickOpen === 'client' ? t('tasks.selectClient') : t('tasks.selectDriver'),
              () => { setPickOpen(null); setAssigningTask(null); },
            )}
            <View style={styles.pickSearchBox}>
              <Ionicons name="search-outline" size={18} color={colors.textFaint} />
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
              showsVerticalScrollIndicator={false}
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
                    <View style={[styles.selectAvatar, styles.selectAvatarFilled]}>
                      <Text style={styles.selectAvatarText}>
                        {String(item.fullName || item.username || '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.pickItemTitle} numberOfLines={1}>
                        {item.fullName || item.username || item.email}
                      </Text>
                      <Text style={styles.pickItemSub} numberOfLines={1}>{item.email}</Text>
                    </View>
                    {selected && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.sheetEmpty}>
                  <Text style={styles.emptyInlineText}>{t('common.noData')}</Text>
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ===== Page =====
  page: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  /** Navy block behind the top of the list: an iOS over-scroll reveals navy above the hero instead of grey */
  heroBleed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 240,
    backgroundColor: colors.hero,
  },
  /** The hero is full-bleed; gutters are given by each block below it and by the cards themselves */
  listContent: {
    paddingBottom: space.xxxl,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    gap: space.md,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: font.sm,
  },

  // ===== Hero header =====
  /** Compact navy block: title and one subtitle line. The extra bottom padding is what the KPI strip overlaps. */
  hero: {
    backgroundColor: colors.hero,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg + space.xxxl,
    // rounded foot so the KPI card reads as resting on the header, not cut by a straight edge
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  heroLogo: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  heroLogoImg: { width: 34, height: 34 },
  heroTextBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: space.xs,
  },
  heroTitle: {
    color: colors.heroText,
    fontSize: font.xl,
    fontWeight: weight.bold,
    lineHeight: 28,
  },
  heroSubtitle: {
    color: colors.heroMuted,
    fontSize: font.sm,
    marginTop: space.xs,
  },
  heroBtnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  heroBtn: {
    width: hit.compact,
    height: hit.compact,
    borderRadius: radius.md,
    backgroundColor: colors.heroAlt,
    borderWidth: 1,
    borderColor: colors.heroBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadge: {
    position: 'absolute',
    top: -space.xs,
    right: -space.xs,
    minWidth: 18,
    height: 18,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.hero,
  },
  unreadBadgeText: {
    color: colors.heroText,
    fontSize: font.xs,
    fontWeight: weight.semibold,
  },

  // ===== Blocks under the hero: KPI strip, create button, chips, search =====
  headerBody: {
    paddingHorizontal: space.lg,
  },
  /** One white card with three cells and hairline dividers; it rides up over the hero's lower edge */
  kpiStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginTop: -space.xxxl,
    ...shadow.card,
  },
  kpiCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
  },
  kpiDivider: {
    width: 1,
    marginVertical: space.md,
    backgroundColor: colors.border,
  },
  kpiValue: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: weight.bold,
    lineHeight: 28,
  },
  /** "Today only" is on */
  kpiValueActive: {
    color: colors.accentDark,
  },
  kpiLabel: {
    color: colors.textFaint,
    fontSize: font.xs,
    letterSpacing: 0.2,
    marginTop: space.xs,
  },
  filterRow: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    gap: space.sm,
  },
  filterPill: {
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The active chip is ink, not amber: amber stays reserved for the primary action */
  filterPillActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  filterText: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: weight.medium,
  },
  filterTextActive: {
    color: colors.surface,
  },
  searchBox: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    marginBottom: space.lg,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    paddingVertical: 0,
    color: colors.text,
    fontSize: font.base,
  },

  // ===== Job card =====
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    ...shadow.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.sm,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.semibold,
    lineHeight: 22,
  },
  /** Status is a dot and a word, not a filled tag; it never shrinks, so a long title truncates instead */
  statusRow: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  statusText: {
    fontSize: font.xs,
    fontWeight: weight.medium,
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xs,
  },
  destText: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.medium,
    lineHeight: 22,
  },
  /** The secondary facts in one quiet line, separated by middle dots */
  metaLine: {
    color: colors.textMuted,
    fontSize: font.sm,
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.sm,
  },
  plateChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  plateChipText: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontWeight: weight.medium,
    letterSpacing: 0.8,
  },
  /** Admin actions: small outline icon buttons at the footer's right */
  iconBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginLeft: 'auto',
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** A full-width action at the bottom of a card: a touch lower than the sheet buttons */
  cardAction: {
    marginTop: space.md,
    minHeight: 44,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.info,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  continueBtnText: {
    color: colors.heroText,
    fontSize: font.base,
    fontWeight: weight.semibold,
  },

  // ===== Buttons shared by cards and sheets =====
  btnPrimary: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    minHeight: hit.min,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    color: colors.onAccent,
    fontSize: font.base,
    fontWeight: weight.semibold,
  },
  btnSuccess: {
    backgroundColor: colors.success,
    borderRadius: radius.md,
    minHeight: hit.min,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSuccessText: {
    color: colors.heroText,
    fontSize: font.base,
    fontWeight: weight.semibold,
  },
  /** Cancel in a sheet is a text button, not a second boxed button */
  btnText: {
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTextLabel: {
    color: colors.textMuted,
    fontSize: font.base,
    fontWeight: weight.medium,
  },
  /** Icon + label inside a button */
  btnRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  btnDisabled: {
    opacity: 0.6,
  },

  // ===== Empty states =====
  emptyBox: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
    paddingBottom: space.huge,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.semibold,
    textAlign: 'center',
    marginTop: space.lg,
  },
  emptySub: {
    color: colors.textMuted,
    fontSize: font.sm,
    marginTop: space.xs,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyInlineText: {
    color: colors.textMuted,
    fontSize: font.sm,
    textAlign: 'center',
  },

  // ===== Bottom sheets =====
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    maxHeight: '88%',
    ...shadow.raised,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: space.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingBottom: space.md,
  },
  sheetTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.semibold,
  },
  sheetSubtitle: {
    color: colors.textFaint,
    fontSize: font.xs,
    marginTop: space.xs,
  },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The job's title at the top of a sheet */
  sheetLead: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.semibold,
    lineHeight: 22,
    marginBottom: space.md,
  },
  sheetHint: {
    color: colors.textMuted,
    fontSize: font.sm,
    lineHeight: 20,
    marginBottom: space.md,
  },
  sheetEmpty: {
    paddingVertical: space.xxl,
  },
  sheetActions: {
    marginTop: space.lg,
    gap: space.xs,
  },
  infoBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    width: 96,
    color: colors.textMuted,
    fontSize: font.sm,
    lineHeight: 22,
  },
  infoValue: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.medium,
    lineHeight: 22,
  },

  // ===== Plate sheet =====
  /** The plate reads like a plate: centred, spaced capitals */
  plateInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    height: hit.min,
    paddingHorizontal: space.lg,
    paddingVertical: 0,
    color: colors.text,
    fontSize: font.lg,
    fontWeight: weight.semibold,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: space.md,
  },
  plateWarnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  plateWarnText: {
    flex: 1,
    minWidth: 0,
    color: colors.accentDark,
    fontSize: font.sm,
    lineHeight: 20,
    fontWeight: weight.medium,
  },

  // ===== Finish-job sheet =====
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    paddingTop: space.xs,
    marginBottom: space.lg,
  },
  photoWrap: {
    width: 96,
    height: 96,
  },
  photo: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  /** Remove badge on the thumbnail's corner, ringed in white so it reads on any photo */
  photoRemove: {
    position: 'absolute',
    top: -space.xs,
    right: -space.xs,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  photoAddText: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontWeight: weight.medium,
  },
  notesInput: {
    minHeight: 80,
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

  // ===== Notifications sheet =====
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: hit.min,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  notificationItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  notificationItemTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.medium,
  },
  notificationItemTitleUnread: {
    fontWeight: weight.semibold,
  },
  notificationItemBody: {
    color: colors.textMuted,
    fontSize: font.sm,
    marginTop: space.xs,
    lineHeight: 20,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },

  // ===== Client / driver picker sheet =====
  pickSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: hit.min,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
  },
  pickSearchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    paddingVertical: 0,
    color: colors.text,
    fontSize: font.base,
  },
  pickItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: hit.min,
    paddingHorizontal: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  pickItemSelected: {
    backgroundColor: colors.accentSoft,
  },
  pickItemTitle: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.medium,
  },
  pickItemSub: {
    color: colors.textMuted,
    fontSize: font.sm,
    marginTop: space.xs,
  },

  // ===== Create-job form =====
  formSectionTitle: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.semibold,
    marginTop: space.lg,
    marginBottom: space.md,
  },
  requiredMark: {
    color: colors.danger,
  },
  formLabel: {
    color: colors.textFaint,
    fontSize: font.xs,
    fontWeight: weight.medium,
    letterSpacing: 0.2,
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  formInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
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
  formSubmit: {
    marginTop: space.sm,
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
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  selectRowFilled: {
    borderColor: colors.borderStrong,
  },
  /** Initial avatar for a chosen person; an outlined placeholder circle before one is chosen */
  selectAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAvatarFilled: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentSoft,
  },
  selectAvatarText: {
    color: colors.accentDark,
    fontSize: font.sm,
    fontWeight: weight.semibold,
  },
  selectRowLabel: {
    color: colors.textFaint,
    fontSize: font.xs,
    letterSpacing: 0.2,
    marginBottom: space.xs,
  },
  selectRowValue: {
    color: colors.text,
    fontSize: font.base,
    fontWeight: weight.medium,
  },
  selectRowPlaceholder: {
    color: colors.textFaint,
    fontWeight: weight.regular,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
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
    fontWeight: weight.medium,
    marginLeft: space.sm,
  },
});
