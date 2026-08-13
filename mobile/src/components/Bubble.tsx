import { useState } from 'react';
import { View, Pressable, Image } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useChat, type Message, type Conversation } from '../stores';
import { useTheme, radii, spacing, type, accentFor, spring } from '../theme';
import { Avatar, Body, Chip } from './ui';
import { clock, duration, bytes } from '../lib/format';
import { mediaUrl } from '../lib/api';
import VoiceNote from './VoiceNote';

const QUICK = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

/**
 * A message bubble.
 *
 * Swipe-to-reply uses a real pan gesture on the UI thread via Reanimated —
 * on a phone this has to be at 60fps with no JS round-trip, which is why it's
 * a `Gesture.Pan` rather than the pointer-event approach the web version uses.
 */
export default function Bubble({
  message: m,
  conversation,
  meId,
  runStart,
  onReply,
  onThread,
}: {
  message: Message;
  conversation: Conversation;
  meId: string;
  runStart: boolean;
  onReply: (m: Message) => void;
  onThread: (m: Message) => void;
}) {
  const t = useTheme();
  const { react, star, remove, pin } = useChat();
  const [menu, setMenu] = useState(false);

  const mine = m.sender.id === meId;
  const x = useSharedValue(0);
  const armed = useSharedValue(false);

  const THRESHOLD = 56;
  const direction = mine ? -1 : 1;

  const pan = Gesture.Pan()
    .activeOffsetX(mine ? [-12, 9999] : [-9999, 12])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      const raw = e.translationX * direction;
      if (raw <= 0) {
        x.value = 0;
        return;
      }
      // Rubber-band, so it feels attached rather than sliding on ice.
      const eased = raw < THRESHOLD ? raw : THRESHOLD + (raw - THRESHOLD) * 0.35;
      x.value = Math.min(90, eased) * direction;

      const nowArmed = eased >= THRESHOLD;
      if (nowArmed !== armed.value) {
        armed.value = nowArmed;
        if (nowArmed) runOnJS(Haptics.selectionAsync)();
      }
    })
    .onEnd(() => {
      if (armed.value) runOnJS(onReply)(m);
      armed.value = false;
      x.value = withSpring(0, spring);
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  /* ── system and call rows sit outside the bubble language ────────────── */

  if (m.type === 'system') {
    return (
      <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 5,
            borderRadius: radii.pill,
            backgroundColor: t.dark ? 'rgba(43,39,36,0.85)' : 'rgba(244,238,230,0.85)',
          }}
        >
          <Body faint style={{ fontSize: type.sizes.xs, textAlign: 'center' }}>
            {m.body}
          </Body>
        </View>
      </View>
    );
  }

  const grouped = m.reactions.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.emoji] ||= []).push(r.userId);
    return acc;
  }, {});

  const bubbleColor = mine ? t.accent : t.c.raised;
  const textColor = mine ? t.onAccent : t.c.ink;

  const content = () => {
    if (m.deletedForAll)
      return (
        <Body style={{ color: textColor, fontStyle: 'italic', opacity: 0.7, fontSize: type.sizes.sm }}>
          This message was unsent
        </Body>
      );

    switch (m.type) {
      case 'image':
      case 'snap':
        if (m.type === 'snap' && (!m.media || m.viewOnce?.burnt || m.viewOnce?.seen))
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: 4 }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 13,
                  backgroundColor: t.c.sunk,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="flame-outline" size={20} color={t.c.inkFaint} />
              </View>
              <Body style={{ color: textColor, fontSize: type.sizes.sm }}>
                {mine ? 'Snap sent' : 'Snap opened — it is gone now'}
              </Body>
            </View>
          );
        return (
          <Image
            source={{ uri: mediaUrl(m.media?.thumbUrl || m.media?.url) }}
            style={{
              width: 240,
              height: m.media?.width && m.media?.height ? (240 * m.media.height) / m.media.width : 180,
              maxHeight: 320,
              borderRadius: 17,
              backgroundColor: t.c.sunk,
            }}
            resizeMode="cover"
          />
        );

      case 'video':
        return (
          <View
            style={{
              width: 240,
              height: 180,
              borderRadius: 17,
              backgroundColor: t.c.sunk,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="play-circle" size={44} color={t.c.inkSoft} />
          </View>
        );

      case 'voice':
        return <VoiceNote message={m} tint={textColor} />;

      case 'file':
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 190 }}>
            <Ionicons name="document-outline" size={22} color={textColor} />
            <View style={{ flex: 1 }}>
              <Body numberOfLines={1} style={{ color: textColor, fontSize: type.sizes.sm, fontWeight: '600' }}>
                {m.media?.name || 'File'}
              </Body>
              <Body style={{ color: textColor, opacity: 0.7, fontSize: type.sizes.xs }}>
                {bytes(m.media?.size)}
              </Body>
            </View>
          </View>
        );

      case 'call':
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 160 }}>
            <Ionicons
              name={m.call?.kind === 'video' ? 'videocam-outline' : 'call-outline'}
              size={20}
              color={textColor}
            />
            <View>
              <Body style={{ color: textColor, fontSize: type.sizes.sm, fontWeight: '600' }}>
                {m.call?.kind === 'video' ? 'Video call' : 'Voice call'}
              </Body>
              <Body style={{ color: textColor, opacity: 0.7, fontSize: type.sizes.xs }}>
                {m.call?.status === 'missed'
                  ? 'No answer'
                  : m.call?.duration
                    ? duration(m.call.duration)
                    : 'Ended'}
              </Body>
            </View>
          </View>
        );

      default:
        return (
          <Body style={{ color: textColor, fontSize: type.sizes.base }}>{m.body}</Body>
        );
    }
  };

  return (
    <View style={{ marginTop: runStart ? spacing.md : 3 }}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            slide,
            { flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: spacing.sm },
          ]}
        >
          {!mine && conversation.type === 'group' && (
            <Avatar
              name={m.sender.displayName || '?'}
              id={m.sender.id}
              accent={m.sender.accent}
              size={28}
            />
          )}

          <Pressable
            onLongPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              setMenu(true);
            }}
            style={[
              {
                maxWidth: '80%',
                backgroundColor: bubbleColor,
                borderRadius: radii.clay,
                borderBottomLeftRadius: runStart && !mine ? 8 : radii.clay,
                borderBottomRightRadius: runStart && mine ? 8 : radii.clay,
                paddingHorizontal: 14,
                paddingVertical: 9,
                paddingBottom: 22,
              },
              t.clay(1),
            ]}
          >
            {runStart && !mine && conversation.type === 'group' && (
              <Body
                style={{
                  fontSize: type.sizes.xs,
                  fontWeight: '700',
                  color: t.a[(m.sender.accent as any) || accentFor(m.sender.id)],
                  marginBottom: 2,
                }}
              >
                {m.sender.displayName}
              </Body>
            )}

            {m.replyTo?.senderName && (
              <View
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: mine ? t.onAccent : t.accent,
                  paddingLeft: 9,
                  paddingVertical: 4,
                  marginBottom: 6,
                  opacity: 0.85,
                }}
              >
                <Body style={{ color: textColor, fontSize: type.sizes.xs, fontWeight: '700' }}>
                  {m.replyTo.senderName}
                </Body>
                <Body numberOfLines={2} style={{ color: textColor, fontSize: type.sizes.sm }}>
                  {m.replyTo.body}
                </Body>
              </View>
            )}

            {content()}

            {/* Stamp tucked into the bottom-right corner. */}
            <View
              style={{
                position: 'absolute',
                right: 12,
                bottom: 6,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {m.editedAt && (
                <Body style={{ color: textColor, opacity: 0.6, fontSize: 10, fontStyle: 'italic' }}>
                  edited
                </Body>
              )}
              <Body style={{ color: textColor, opacity: 0.7, fontSize: 10, fontFamily: type.mono }}>
                {clock(m.createdAt)}
              </Body>
              {mine && (
                <Ionicons
                  name={
                    m.status === 'pending'
                      ? 'time-outline'
                      : m.status === 'failed'
                        ? 'alert-circle-outline'
                        : m.readBy.length
                          ? 'checkmark-done'
                          : 'checkmark'
                  }
                  size={13}
                  color={m.readBy.length ? t.onAccent : textColor}
                  style={{ opacity: m.readBy.length ? 1 : 0.7 }}
                />
              )}
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>

      {/* reactions */}
      {Object.keys(grouped).length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            gap: 4,
            marginTop: -6,
            alignSelf: mine ? 'flex-end' : 'flex-start',
            paddingHorizontal: 10,
          }}
        >
          {Object.entries(grouped).map(([emoji, users]) => (
            <Pressable
              key={emoji}
              onPress={() => react(m, emoji)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: radii.pill,
                borderWidth: 2,
                borderColor: t.c.ink,
                backgroundColor: users.includes(meId) ? t.accent : t.c.surface,
              }}
            >
              <Body style={{ fontSize: 12 }}>{emoji}</Body>
              {users.length > 1 && (
                <Body style={{ fontSize: 10, fontFamily: type.mono }}>{users.length}</Body>
              )}
            </Pressable>
          ))}
        </View>
      )}

      {/* thread tag */}
      {m.replyCount > 0 && (
        <Pressable
          onPress={() => onThread(m)}
          style={{
            alignSelf: mine ? 'flex-end' : 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            marginTop: 4,
            paddingHorizontal: 11,
            paddingVertical: 4,
            borderRadius: radii.pill,
            borderWidth: 2,
            borderColor: t.c.ink,
            backgroundColor: t.c.surface,
          }}
        >
          <Ionicons name="chatbubbles-outline" size={13} color={t.c.ink} />
          <Body style={{ fontSize: type.sizes.xs, fontWeight: '600' }}>
            {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          </Body>
        </Pressable>
      )}

      {/* long-press sheet */}
      {menu && (
        <>
          <Pressable
            onPress={() => setMenu(false)}
            style={{ position: 'absolute', left: -1000, right: -1000, top: -1000, bottom: -1000 }}
          />
          <View
            style={[
              {
                alignSelf: mine ? 'flex-end' : 'flex-start',
                marginTop: 6,
                padding: spacing.sm,
                borderRadius: radii.clay,
                backgroundColor: t.c.raised,
              },
              t.clay(3),
            ]}
          >
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: spacing.sm }}>
              {QUICK.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    react(m, emoji);
                    setMenu(false);
                  }}
                  style={{ padding: 6 }}
                >
                  <Body style={{ fontSize: 22 }}>{emoji}</Body>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.base, flexWrap: 'wrap' }}>
              {[
                { icon: 'arrow-undo-outline', label: 'Reply', run: () => onReply(m) },
                { icon: 'chatbubbles-outline', label: 'Thread', run: () => onThread(m) },
                { icon: m.starred ? 'star' : 'star-outline', label: 'Star', run: () => star(m) },
                { icon: 'pin-outline', label: 'Pin', run: () => pin(conversation.id, m.id).catch(() => {}) },
                { icon: 'trash-outline', label: 'Delete', run: () => remove(m, mine ? 'everyone' : 'me') },
              ].map((action) => (
                <Pressable
                  key={action.label}
                  onPress={() => {
                    action.run();
                    setMenu(false);
                  }}
                  style={{ alignItems: 'center', gap: 3, minWidth: 54 }}
                >
                  <Ionicons name={action.icon as any} size={20} color={t.c.ink} />
                  <Body style={{ fontSize: type.sizes.xs }}>{action.label}</Body>
                </Pressable>
              ))}
            </View>
          </View>
        </>
      )}
    </View>
  );
}
