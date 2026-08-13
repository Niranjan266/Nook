import { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  FlatList,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useChat, useAuth, type Message } from '../../../src/stores';
import { useTheme, radii, spacing, type } from '../../../src/theme';
import { Avatar, Body, ClayButton, Chip } from '../../../src/components/ui';
import { clock, dayLabel, sameDay, lastSeenLabel, MOOD_EMOJI, MOOD_LABEL } from '../../../src/lib/format';
import { getSocket } from '../../../src/lib/socket';
import Bubble from '../../../src/components/Bubble';
import Composer from '../../../src/components/Composer';

/** The wallpaper presets, as gradients rather than CSS. */
const PRESETS: Record<string, string[]> = {
  'dusk-clay': ['#E8A97F', '#D8C3AD', '#A9502F'],
  'moss-paper': ['#A9B899', '#E6E3D4', '#57694A'],
  'ochre-dune': ['#E8C98A', '#EFE3CA', '#D6BD93'],
  'slate-rain': ['#DFE2E2', '#B9C4C9', '#6B8598'],
  arch: ['#E9E1D6', '#DFCFC0'],
  grid: ['#E9E1D6', '#E9E1D6'],
  plain: ['#E9E1D6', '#E9E1D6'],
};

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const me = useAuth((s) => s.me);
  const t = useTheme((me?.accent as any) || 'terracotta');
  const {
    conversations,
    messages,
    typing,
    presence,
    hasMore,
    setActive,
    loadMessages,
    respondWallpaper,
  } = useChat();

  const convo = conversations[id!];
  const list = messages[id!] || [];
  const listRef = useRef<FlatList<Message>>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (id) setActive(id);
    return () => setActive(null);
  }, [id]);

  const typers = (typing[id!] || []).filter((u) => u !== me?.id);
  const partnerPresence = convo?.partner ? presence[convo.partner.id] : undefined;

  /** Inverted list, so `data` is newest-first and new messages appear at the bottom. */
  const data = useMemo(() => [...list].reverse(), [list]);

  const status = (() => {
    if (typers.length) return 'typing…';
    if (!convo) return '';
    if (convo.type === 'group') return `${convo.members.length} people`;
    if (partnerPresence?.online) return 'online';
    if (partnerPresence?.lastSeen) return `last seen ${lastSeenLabel(partnerPresence.lastSeen)}`;
    return convo.partner ? `@${convo.partner.username}` : '';
  })();

  if (!convo) {
    return (
      <View style={{ flex: 1, backgroundColor: t.c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const wp = convo.wallpaper;
  const gradient = PRESETS[wp?.preset] || (t.dark ? ['#201D1A', '#2B2724'] : ['#E9E1D6', '#E4DACE']);

  return (
    <View style={{ flex: 1, backgroundColor: t.c.bg }}>
      {/* ── wallpaper ─────────────────────────────────────────────────── */}
      <LinearGradient
        colors={gradient as any}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: t.c.bg,
          opacity: wp?.dim ?? 0.35,
        }}
      />

      {/* ── header ────────────────────────────────────────────────────── */}
      <View
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: spacing.md,
          paddingHorizontal: spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          backgroundColor: t.dark ? 'rgba(43,39,36,0.92)' : 'rgba(244,238,230,0.92)',
        }}
      >
        <ClayButton size={40} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={t.c.ink} />
        </ClayButton>

        <Pressable
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          onPress={() => router.push(`/room/${id}`)}
        >
          <Avatar
            name={convo.name}
            uri={convo.avatarUrl}
            id={convo.partner?.id || convo.id}
            accent={convo.partner?.accent}
            size={40}
            square={convo.type === 'group'}
            online={partnerPresence?.online}
            showDot
          />
          <View style={{ flex: 1 }}>
            <Body numberOfLines={1} style={{ fontWeight: '700', fontSize: type.sizes.md }}>
              {convo.name}
            </Body>
            <Body
              numberOfLines={1}
              style={{
                fontSize: type.sizes.xs,
                color: typers.length ? t.a['moss-deep'] : t.c.inkSoft,
                fontWeight: typers.length ? '600' : '400',
              }}
            >
              {status}
            </Body>
          </View>
        </Pressable>

        {convo.type === 'direct' && (
          <>
            <ClayButton size={40} onPress={() => router.push(`/call/${id}?kind=audio`)}>
              <Ionicons name="call-outline" size={19} color={t.c.ink} />
            </ClayButton>
            <ClayButton size={40} onPress={() => router.push(`/call/${id}?kind=video`)}>
              <Ionicons name="videocam-outline" size={19} color={t.c.ink} />
            </ClayButton>
          </>
        )}
      </View>

      {/* ── room mood ─────────────────────────────────────────────────── */}
      {convo.roomState?.mood ? (
        <Pressable
          onPress={() => router.push(`/room/${id}`)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.base,
            paddingVertical: 7,
            backgroundColor: `${t.a.ochre}33`,
          }}
        >
          <Body style={{ fontSize: 15 }}>{MOOD_EMOJI[convo.roomState.mood] || '•'}</Body>
          <Body style={{ flex: 1, fontSize: type.sizes.sm }}>
            <Body style={{ fontWeight: '700' }}>{MOOD_LABEL[convo.roomState.mood]}</Body>
            {convo.roomState.note ? ` — ${convo.roomState.note}` : ''}
          </Body>
        </Pressable>
      ) : null}

      {/* ── pinned ────────────────────────────────────────────────────── */}
      {convo.pins?.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.sm,
            backgroundColor: t.dark ? 'rgba(43,39,36,0.9)' : 'rgba(244,238,230,0.9)',
          }}
        >
          <Ionicons name="pin" size={14} color={t.c.inkFaint} />
          <Body numberOfLines={1} muted style={{ flex: 1, fontSize: type.sizes.sm }}>
            {convo.pins[0].message?.body || 'Pinned message'}
          </Body>
          {convo.pins.length > 1 && <Chip tone="quiet">{convo.pins.length}</Chip>}
        </View>
      )}

      {/* ── wallpaper proposal ────────────────────────────────────────── */}
      {wp?.proposal && wp.proposal.by !== me?.id && (
        <View
          style={{
            margin: spacing.md,
            padding: spacing.md,
            borderRadius: radii.clay,
            backgroundColor: t.c.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <Body style={{ flex: 1, fontSize: type.sizes.sm }}>
            New wallpaper suggested — it applies to both of you.
          </Body>
          <Pressable
            onPress={() => respondWallpaper(id!, true)}
            style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: t.accent, borderRadius: radii.slab }}
          >
            <Body style={{ color: t.onAccent, fontWeight: '700', fontSize: type.sizes.sm }}>Use it</Body>
          </Pressable>
          <Pressable onPress={() => respondWallpaper(id!, false)}>
            <Ionicons name="close" size={20} color={t.c.inkSoft} />
          </Pressable>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={data}
          inverted
          keyExtractor={(m) => m.id}
          keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
          onEndReachedThreshold={0.4}
          onEndReached={async () => {
            if (loadingMore || !hasMore[id!]) return;
            setLoadingMore(true);
            await loadMessages(id!, true).catch(() => {});
            setLoadingMore(false);
          }}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ margin: spacing.base }} color={t.accent} /> : null
          }
          renderItem={({ item, index }) => {
            // Inverted list: "previous" in reading order is the *next* index.
            const older = data[index + 1];
            const newDay = !older || !sameDay(older.createdAt, item.createdAt);
            const runStart =
              !older ||
              older.sender.id !== item.sender.id ||
              new Date(item.createdAt).getTime() - new Date(older.createdAt).getTime() > 6 * 60000;

            return (
              <View>
                <Bubble
                  message={item}
                  conversation={convo}
                  meId={me?.id || ''}
                  runStart={newDay || runStart}
                  onReply={(m) => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    setReplyTo(m);
                  }}
                  onThread={(m) => router.push(`/thread/${m.id}`)}
                />
                {newDay && (
                  <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 3,
                        borderRadius: radii.slab,
                        borderWidth: 2,
                        borderColor: t.c.ink,
                        backgroundColor: t.c.surface,
                      }}
                    >
                      <Body style={{ fontSize: 11, fontFamily: type.mono, textTransform: 'uppercase' }}>
                        {dayLabel(item.createdAt)}
                      </Body>
                    </View>
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: spacing.xxl, transform: [{ scaleY: -1 }] }}>
              <Body muted style={{ textAlign: 'center' }}>
                {convo.type === 'group'
                  ? 'Say hello and get it going.'
                  : `This is the start of your conversation with ${convo.name.split(' ')[0]}.`}
              </Body>
            </View>
          }
        />

        {typers.length > 0 && (
          <View style={{ paddingHorizontal: spacing.base, paddingBottom: 4 }}>
            <Body faint style={{ fontSize: type.sizes.xs, fontStyle: 'italic' }}>
              typing…
            </Body>
          </View>
        )}

        <Composer
          conversationId={id!}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          onTyping={() => getSocket()?.emit('typing:start', { conversationId: id })}
        />
      </KeyboardAvoidingView>
    </View>
  );
}
