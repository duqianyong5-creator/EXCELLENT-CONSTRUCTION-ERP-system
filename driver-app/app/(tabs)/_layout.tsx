import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import type { RootState } from '../../src/store';
import { useLang } from '../../src/i18n';
import AnnouncementModal from '../../src/AnnouncementModal';
import { colors, space, font, weight, radius, hit } from '../../src/theme';

const ICONS: Record<string, { active: string; inactive: string }> = {
  tasks: { active: 'list', inactive: 'list-outline' },
  tracking: { active: 'calendar', inactive: 'calendar-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icon = ICONS[name] || ICONS.tasks;
  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
      <Ionicons
        name={(focused ? icon.active : icon.inactive) as any}
        size={24}
        color={focused ? colors.accent : colors.textFaint}
      />
    </View>
  );
}

export default function TabLayout() {
  const { user } = useSelector((s: RootState) => s.auth);
  const { t } = useLang();
  const insets = useSafeAreaInsets();
  const role = user?.role || '';
  const showTracking = role === 'client' || role === 'admin' || role === 'dispatcher';
  const tasksTitle = t('tab.tasks');
  const trackingTitle = role === 'driver' ? t('tab.todayJobs') : t('tab.location');
  const profileTitle = t('tab.profile');

  return (
    <>
    <AnnouncementModal />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          // 图标区按 hit.min 给足，再留出标签行；底部加上手势条的安全区
          height: hit.min + space.xxxl + insets.bottom,
          paddingTop: space.sm,
          paddingBottom: space.sm + insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize: font.xs,
          fontWeight: weight.heavy,
          marginTop: space.xs,
        },
        tabBarItemStyle: {
          paddingVertical: 0,
        },
      }}
    >
      <Tabs.Screen
        name="tasks"
        options={{
          title: tasksTitle,
          tabBarIcon: ({ focused }) => <TabIcon name="tasks" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          href: showTracking ? undefined : null,
          title: trackingTitle,
          tabBarIcon: ({ focused }) => <TabIcon name="tracking" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: profileTitle,
          tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} />,
        }}
      />
    </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    width: 64,
    height: 36,
    borderRadius: radius.pill,
    // 边框常驻，只换颜色，选中时不会因为多出一圈线而位移
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainerActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
});
