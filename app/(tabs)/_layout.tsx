import { HeaderActions } from '@/components/HeaderActions';
import { DrawerMenuButton } from '@/components/DrawerMenuButton';
import { useTheme } from '@/hooks/useTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

const TAB_LABEL_STYLE = {
  fontSize: 11,
  fontWeight: '600' as const,
  marginBottom: 2,
};

const TAB_ITEM_STYLE = {
  paddingHorizontal: 2,
  minWidth: 64,
};

export default function TabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const tabBarHeight = 52 + bottomPad;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: tabBarHeight,
          paddingBottom: bottomPad,
          paddingTop: 6,
        },
        tabBarLabelStyle: TAB_LABEL_STYLE,
        tabBarItemStyle: TAB_ITEM_STYLE,
        tabBarAllowFontScaling: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerLeft: () => <DrawerMenuButton />,
        headerRight: () => <HeaderActions />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trajet',
          tabBarLabel: 'Trajet',
          tabBarIcon: ({ color }) => <Ionicons name="navigate" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: 'Véhicules',
          tabBarLabel: 'Véhicules',
          tabBarIcon: ({ color }) => <Ionicons name="car" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: 'Stats',
          tabBarLabel: 'Stats',
          tabBarIcon: ({ color }) => <Ionicons name="stats-chart" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="fillups"
        options={{
          href: null,
          title: 'Pleins',
        }}
      />
      <Tabs.Screen
        name="trip"
        options={{
          href: null,
          title: 'Trajet',
        }}
      />
      <Tabs.Screen
        name="maps"
        options={{
          href: null,
          title: 'Maps',
        }}
      />
    </Tabs>
  );
}
