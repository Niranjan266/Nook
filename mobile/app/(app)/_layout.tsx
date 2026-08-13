import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useChat, useAuth } from '../../src/stores';
import { useTheme, type } from '../../src/theme';
import { Chip } from '../../src/components/ui';

/**
 * Four tabs, chunky targets, and no unread badge on the app icon by default —
 * the same anti-engagement stance as the web app. A count that only goes up is
 * a slot machine.
 */
export default function AppLayout() {
  const accent = useAuth((s) => s.me?.accent);
  const t = useTheme((accent as any) || 'terracotta');
  const unread = useChat((s) =>
    Object.values(s.conversations).reduce((n, c) => n + (c.muted ? 0 : c.unread), 0)
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accentDeep,
        tabBarInactiveTintColor: t.c.inkFaint,
        tabBarStyle: {
          backgroundColor: t.c.surface,
          borderTopWidth: 0,
          elevation: 12,
          shadowColor: '#1E1A17',
          shadowOpacity: t.dark ? 0.5 : 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          height: 66,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: type.body, fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="chatbubble-outline" size={size} color={color} />
              {unread > 0 && (
                <View style={{ position: 'absolute', top: -6, right: -12 }}>
                  <Chip>{unread > 99 ? '99+' : unread}</Chip>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: 'Calls',
          tabBarIcon: ({ color, size }) => <Ionicons name="call-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="new"
        options={{
          title: 'New',
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: 'You',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />

      {/* Pushed screens, not tabs. */}
      <Tabs.Screen name="chat/[id]" options={{ href: null }} />
      <Tabs.Screen name="room/[id]" options={{ href: null }} />
      <Tabs.Screen name="thread/[id]" options={{ href: null }} />
    </Tabs>
  );
}
