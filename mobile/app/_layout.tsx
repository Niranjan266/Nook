import { useEffect } from 'react';
import { View, ActivityIndicator, useColorScheme } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth, useChat } from '../src/stores';
import { useSocketBridge } from '../src/lib/useSocketBridge';
import { useTheme } from '../src/theme';

/**
 * Root layout: session bootstrap, socket wiring, and the auth gate.
 *
 * The gate lives here rather than in each screen so there is exactly one place
 * that decides whether you're in or out — no screen can accidentally render
 * signed-out.
 */
export default function RootLayout() {
  const { me, status, init } = useAuth();
  const load = useChat((s) => s.load);
  const scheme = useColorScheme();
  const t = useTheme((me?.accent as any) || 'terracotta');
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (me) load().catch(() => {});
  }, [me?.id]);

  useSocketBridge(Boolean(me));

  useEffect(() => {
    if (status === 'loading') return;
    const inApp = segments[0] === '(app)';
    if (status === 'out' && inApp) router.replace('/sign-in');
    if (status === 'in' && !inApp) router.replace('/(app)');
  }, [status, segments]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: t.c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: t.c.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          <Stack.Screen name="(app)" options={{ animation: 'fade' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
