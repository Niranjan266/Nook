import { useEffect, useState } from 'react';
import { View, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useChat, useAuth } from '../../../src/stores';
import { useTheme, radii, spacing, type } from '../../../src/theme';
import { Avatar, Body, Heading, ClayButton, Clay, Groove } from '../../../src/components/ui';
import { clock } from '../../../src/lib/format';

/**
 * A side-thread. One level deep on purpose — nesting turns a conversation into
 * a forum, and the point is to keep a tangent *out* of the main room without
 * creating a second place to check.
 */
export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const me = useAuth((s) => s.me);
  const t = useTheme((me?.accent as any) || 'terracotta');
  const { threads, messages, activeId, loadThread, sendInThread } = useChat();

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const replies = threads[id!] || [];
  const root = activeId ? (messages[activeId] || []).find((m) => m.id === id) : undefined;

  useEffect(() => {
    if (id) loadThread(id).catch(() => {});
  }, [id]);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await sendInThread(id!, text);
      setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.c.bg, paddingTop: insets.top + spacing.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          paddingBottom: spacing.md,
        }}
      >
        <ClayButton size={40} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={t.c.ink} />
        </ClayButton>
        <Heading size="lg" style={{ flex: 1 }}>
          Thread
        </Heading>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={replies}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.base, gap: spacing.sm }}
          ListHeaderComponent={
            root ? (
              <Clay sunk style={{ padding: spacing.md, marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
                  <Avatar
                    name={root.sender.displayName || '?'}
                    id={root.sender.id}
                    accent={root.sender.accent}
                    size={24}
                  />
                  <Body style={{ fontWeight: '600', fontSize: type.sizes.sm, flex: 1 }}>
                    {root.sender.id === me?.id ? 'You' : root.sender.displayName}
                  </Body>
                  <Body faint style={{ fontSize: type.sizes.xs, fontFamily: type.mono }}>
                    {clock(root.createdAt)}
                  </Body>
                </View>
                <Body style={{ fontSize: type.sizes.sm }}>{root.body || root.type}</Body>
              </Clay>
            ) : null
          }
          renderItem={({ item: m }) => {
            const mine = m.sender.id === me?.id;
            return (
              <View
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  flexDirection: 'row',
                  gap: spacing.sm,
                  alignItems: 'flex-end',
                }}
              >
                {!mine && (
                  <Avatar
                    name={m.sender.displayName || '?'}
                    id={m.sender.id}
                    accent={m.sender.accent}
                    size={26}
                  />
                )}
                <View
                  style={[
                    {
                      backgroundColor: mine ? t.accent : t.c.raised,
                      borderRadius: radii.clay,
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                      paddingBottom: 20,
                    },
                    t.clay(1),
                  ]}
                >
                  <Body style={{ color: mine ? t.onAccent : t.c.ink }}>{m.body}</Body>
                  <Body
                    style={{
                      position: 'absolute',
                      right: 12,
                      bottom: 5,
                      color: mine ? t.onAccent : t.c.ink,
                      opacity: 0.7,
                      fontSize: 10,
                      fontFamily: type.mono,
                    }}
                  >
                    {clock(m.createdAt)}
                  </Body>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <Body muted style={{ textAlign: 'center', padding: spacing.lg }}>
              No replies yet. Anything you say here stays out of the main conversation.
            </Body>
          }
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.sm,
            padding: spacing.md,
            paddingBottom: (insets.bottom || spacing.sm) + spacing.sm,
          }}
        >
          <Groove style={{ flex: 1, borderRadius: radii.clayLg, minHeight: 46, justifyContent: 'center' }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Reply in this thread"
              placeholderTextColor={t.c.inkFaint}
              multiline
              style={{
                color: t.c.ink,
                fontFamily: type.body,
                fontSize: type.sizes.base,
                maxHeight: 110,
                paddingVertical: 10,
              }}
            />
          </Groove>
          <Pressable
            onPress={submit}
            disabled={!text.trim() || busy}
            style={{
              width: 46,
              height: 46,
              borderRadius: 15,
              backgroundColor: t.accent,
              borderWidth: 2,
              borderColor: t.c.ink,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !text.trim() || busy ? 0.5 : 1,
            }}
          >
            <Ionicons name="send" size={19} color={t.onAccent} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
