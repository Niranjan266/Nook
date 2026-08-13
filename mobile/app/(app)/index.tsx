import { useMemo, useState } from 'react';
import { View, FlatList, Pressable, TextInput, RefreshControl, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useChat, useAuth, type Conversation } from '../../src/stores';
import { useTheme, radii, spacing, type } from '../../src/theme';
import { Avatar, Body, Heading, Chip, ClayButton, Groove } from '../../src/components/ui';
import { stamp, previewOf } from '../../src/lib/format';

const TABS = ['All', 'Unread', 'Groups', 'Archived'];

export default function Chats() {
  const router = useRouter();
  const { conversations, order, presence, typing, load } = useChat();
  const me = useAuth((s) => s.me);
  const t = useTheme((me?.accent as any) || 'terracotta');
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState('All');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const folders = me?.folders ?? [];

  const list = useMemo(() => {
    let items = order.map((id) => conversations[id]).filter(Boolean);
    items = tab === 'Archived' ? items.filter((c) => c.archived) : items.filter((c) => !c.archived);
    if (tab === 'Unread') items = items.filter((c) => c.unread > 0);
    if (tab === 'Groups') items = items.filter((c) => c.type === 'group');

    const folder = folders.find((f) => f.name === tab);
    if (folder) items = items.filter((c) => folder.conversations.includes(c.id));

    if (query.trim()) {
      const q = query.toLowerCase();
      items = items.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.partner?.username || '').includes(q)
      );
    }
    return items;
  }, [conversations, order, tab, query, folders]);

  const refresh = async () => {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  };

  const renderItem = ({ item: c }: { item: Conversation }) => {
    const online = c.partner ? presence[c.partner.id]?.online : false;
    const someoneTyping = (typing[c.id] || []).length > 0;
    const lastIsMine = c.lastMessage?.sender?.id === me?.id;

    return (
      <Pressable
        onPress={() => router.push(`/chat/${c.id}`)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          marginHorizontal: spacing.md,
          marginBottom: 6,
          borderRadius: radii.clay,
          backgroundColor: pressed ? t.c.surface : 'transparent',
        })}
      >
        <Avatar
          name={c.name}
          uri={c.avatarUrl}
          id={c.partner?.id || c.id}
          accent={c.partner?.accent}
          size={50}
          square={c.type === 'group'}
          online={online}
          showDot
        />

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
            <Body
              numberOfLines={1}
              style={{ flex: 1, fontWeight: c.unread > 0 ? '700' : '600', fontSize: type.sizes.md }}
            >
              {c.name}
            </Body>
            {c.lastMessage && (
              <Body faint style={{ fontSize: 11, fontFamily: type.mono }}>
                {stamp(c.lastMessage.createdAt)}
              </Body>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
            {someoneTyping ? (
              <Body numberOfLines={1} style={{ flex: 1, color: t.a['moss-deep'], fontWeight: '600', fontSize: type.sizes.sm }}>
                typing…
              </Body>
            ) : (
              <Body
                numberOfLines={1}
                muted={c.unread === 0}
                style={{ flex: 1, fontSize: type.sizes.sm, fontWeight: c.unread > 0 ? '500' : '400' }}
              >
                {c.type === 'group' && c.lastMessage && !lastIsMine && c.lastMessage.type !== 'system'
                  ? `${c.lastMessage.sender?.displayName?.split(' ')[0] || ''}: `
                  : ''}
                {c.lastMessage ? previewOf(c.lastMessage) : 'No messages yet'}
              </Body>
            )}

            {c.muted && <Ionicons name="notifications-off-outline" size={13} color={t.c.inkFaint} />}
            {c.pinned && <Ionicons name="pin-outline" size={13} color={t.c.inkFaint} />}
            {c.unread > 0 && <Chip>{c.unread > 99 ? '99+' : c.unread}</Chip>}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.c.bg, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.base,
          paddingBottom: spacing.md,
        }}
      >
        <Heading size="xl" style={{ flex: 1 }}>
          Nook
        </Heading>
        <ClayButton onPress={() => router.push('/new')}>
          <Ionicons name="add" size={22} color={t.c.ink} />
        </ClayButton>
      </View>

      <View style={{ paddingHorizontal: spacing.base, paddingBottom: spacing.md }}>
        <Groove style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radii.pill }}>
          <Ionicons name="search" size={17} color={t.c.inkFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a conversation"
            placeholderTextColor={t.c.inkFaint}
            style={{ flex: 1, color: t.c.ink, fontFamily: type.body, fontSize: type.sizes.base, paddingVertical: 10 }}
          />
        </Groove>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.base, gap: 6, paddingBottom: spacing.md }}
        style={{ flexGrow: 0 }}
      >
        {[...TABS, ...folders.map((f) => f.name)].map((label) => (
          <Pressable
            key={label}
            onPress={() => setTab(label)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: radii.pill,
              backgroundColor: tab === label ? t.c.sunk : 'transparent',
            }}
          >
            <Body
              muted={tab !== label}
              style={{ fontSize: type.sizes.sm, fontWeight: tab === label ? '600' : '500' }}
            >
              {label}
            </Body>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.accent} />}
        contentContainerStyle={{ paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', padding: spacing.xxl, gap: spacing.md }}>
            <Ionicons name="chatbubbles-outline" size={44} color={t.c.inkFaint} />
            <Body muted style={{ textAlign: 'center', maxWidth: 260 }}>
              {query
                ? 'Nothing matches that.'
                : tab === 'Archived'
                  ? 'Nothing archived.'
                  : tab === 'Unread'
                    ? 'All caught up.'
                    : 'No conversations yet. Nook only needs a username — no phone number, no address book upload.'}
            </Body>
          </View>
        }
      />
    </View>
  );
}
