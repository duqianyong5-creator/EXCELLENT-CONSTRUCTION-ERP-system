import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import type { RootState } from '../../src/store';
import { useLang } from '../../src/i18n';
import AnnouncementModal from '../../src/AnnouncementModal';
import { colors, space, font, weight, hit } from '../../src/theme';

const ICONS: Record<string, { active: string; inactive: string }> = {
  tasks: { active: 'list', inactive: 'list-outline' },
  tracking: { active: 'map', inactive: 'map-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

// Plain icon above the label, filled when active: no pill, no border, like every mainstream app
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icon = ICONS[name] || ICONS.tasks;
  return (
    <View style={styles.iconContainer}>
      <Ionicons
        name={(focused ? icon.active : icon.inactive) as any}
        size={22}
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
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          // icon row + label row, plus the home-indicator safe area
          height: hit.min + space.lg + insets.bottom,
          paddingTop: space.sm,
          paddingBottom: space.xs + insets.bottom,
        },
        tabBarLabelStyle: {
          fontSize: font.xs,
          fontWeight: weight.medium,
          marginTop: 2,
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
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
