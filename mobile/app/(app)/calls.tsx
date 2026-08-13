import { useEffect, useState } from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { get } from '../../src/lib/api';
import { useAuth } from '../../src/stores';
import { useTheme, radii, spacing, type } from '../../src/theme';
import { Avatar, Body, Heading } from '../../src/components/ui';
import { stamp, duration } from '../../src/lib/format';

interface CallRecord {
  id: string;
  conversationId: string;
  direction: 'incoming' | 'outgoing';
  kind: 'audio' | 'video';
  status: string;
  duration: number;
  at: string;
  with: { id: string; username: string; displayName: string; accent: string };
}

export default function Calls() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.me);
  const t = useTheme((me?.accent as any) || 'terracotta');
  const [calls, setCalls] = useState<CallRecord[]>([]);

  useEffect(() => {
    get<{ calls: CallRecord[] }>('/calls').then((r) => setCalls(r.calls)).catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: t.c.bg, paddingTop: insets.top + spacing.sm }}>
      <Heading size="xl" style={{ paddingHorizontal: spacing.base, marginBottom: spacing.md }}>
        Calls
      </Heading>

      <FlatList
        data={calls}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: spacing.base, gap: 6 }}
        renderItem={({ item: c }) => {
          const missed = c.status === 'missed' || c.status === 'declined';
          return (
            <Pressable
              onPress={() => router.push(`/chat/${c.conversationId}`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                padding: spacing.md,
                borderRadius: radii.claySm,
                backgroundColor: t.c.surface,
              }}
            >
              <Avatar name={c.with.displayName} id={c.with.id} accent={c.with.accent} size={42} />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '600', color: missed ? t.a.rust : t.c.ink }}>
                  {c.with.displayName}
                </Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Ionicons
                    name={c.direction === 'outgoing' ? 'arrow-up-outline' : 'arrow-down-outline'}
                    size={12}
                    color={t.c.inkFaint}
                  />
                  <Body faint style={{ fontSize: type.sizes.xs }}>
                    {missed ? (c.status === 'declined' ? 'Declined' : 'Missed') : duration(c.duration)} ·{' '}
                    {stamp(c.at)}
                  </Body>
                </View>
              </View>
              <Ionicons
                name={c.kind === 'video' ? 'videocam-outline' : 'call-outline'}
                size={19}
                color={t.c.inkSoft}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', padding: spacing.xxl, gap: spacing.md }}>
            <Ionicons name="call-outline" size={40} color={t.c.inkFaint} />
            <Body muted style={{ textAlign: 'center', maxWidth: 260 }}>
              No calls yet. Open a conversation and tap the phone icon.
            </Body>
          </View>
        }
      />
    </View>
  );
}
