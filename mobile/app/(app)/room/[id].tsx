import { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useChat, useAuth } from '../../../src/stores';
import { useTheme, radii, spacing, type } from '../../../src/theme';
import { Avatar, Body, Heading, Eyebrow, ClayButton, Clay, Slab, Groove, Rule } from '../../../src/components/ui';
import { MOOD_EMOJI, MOOD_LABEL, stamp } from '../../../src/lib/format';
import { SOUND_NAMES } from '../../../src/lib/sounds';

const MOODS = ['', 'deep-work', 'away', 'rough-week', 'celebrating', 'travelling', 'resting'];
const PRESETS = ['dusk-clay', 'moss-paper', 'ochre-dune', 'slate-rain', 'arch', 'grid', 'plain'];
const TIMERS = [0, 3600, 86400, 604800];

/** Room settings: mood, wall, wallpaper, sound, disappearing messages. */
export default function Room() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const me = useAuth((s) => s.me);
  const t = useTheme((me?.accent as any) || 'terracotta');
  const { conversations, setMood, setWallpaper, updatePrefs } = useChat();
  const convo = conversations[id!];

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!convo) return null;
  const isGroup = convo.type === 'group';
  const needsConsent = !isGroup && convo.members.length > 1;
  const canEditWallpaper = !isGroup || convo.myRole === 'admin';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.md }}>
        <ClayButton size={40} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={t.c.ink} />
        </ClayButton>
        <Heading size="lg" style={{ flex: 1 }}>
          This room
        </Heading>
      </View>

      <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg }}>
        <Avatar
          name={convo.name}
          uri={convo.avatarUrl}
          id={convo.partner?.id || convo.id}
          accent={convo.partner?.accent}
          size={88}
          square={isGroup}
        />
        <Heading size="xl">{convo.name}</Heading>
        <Body muted style={{ fontSize: type.sizes.sm }}>
          {isGroup ? `${convo.members.length} people` : `@${convo.partner?.username}`}
        </Body>
      </View>

      {/* ── mood ──────────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: spacing.base, gap: spacing.sm }}>
        <Eyebrow>How it is right now</Eyebrow>
        <Body faint style={{ fontSize: type.sizes.xs }}>
          Only the people in this room see this. It is not a status broadcast.
        </Body>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {MOODS.map((mood) => {
            const on = (convo.roomState?.mood || '') === mood;
            return (
              <Pressable
                key={mood || 'none'}
                onPress={async () => {
                  setBusy(true);
                  await setMood(id!, mood, note).catch(() => {});
                  setBusy(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  borderRadius: radii.claySm,
                  backgroundColor: on ? t.c.sunk : t.c.surface,
                }}
              >
                <Body style={{ fontSize: 14 }}>{MOOD_EMOJI[mood] || '—'}</Body>
                <Body style={{ fontSize: type.sizes.sm, fontWeight: on ? '700' : '400' }}>
                  {MOOD_LABEL[mood] || 'Nothing in particular'}
                </Body>
              </Pressable>
            );
          })}
        </View>

        <Groove style={{ marginTop: 4 }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Add a line of context (optional)"
            placeholderTextColor={t.c.inkFaint}
            maxLength={120}
            style={{ color: t.c.ink, fontFamily: type.body, fontSize: type.sizes.base, paddingVertical: 12 }}
          />
        </Groove>
      </View>

      <Rule style={{ marginVertical: spacing.lg, marginHorizontal: spacing.base }} />

      {/* ── wallpaper ─────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: spacing.base, gap: spacing.sm }}>
        <Eyebrow>Wallpaper</Eyebrow>
        <Body faint style={{ fontSize: type.sizes.xs }}>
          {needsConsent
            ? `It belongs to the conversation, so ${convo.name.split(' ')[0]} gets asked before it changes for both of you.`
            : canEditWallpaper
              ? 'Set for everyone in this room.'
              : 'Only a group admin can change this.'}
        </Body>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {PRESETS.map((preset) => {
            const on = convo.wallpaper?.preset === preset;
            return (
              <Pressable
                key={preset}
                disabled={!canEditWallpaper}
                onPress={() =>
                  setWallpaper(id!, { preset, dim: 0.35 }, !needsConsent)
                    .then(() =>
                      needsConsent ? Alert.alert('Suggested', 'They can accept it.') : undefined
                    )
                    .catch((e) => Alert.alert('Not changed', e?.message || 'Could not set that.'))
                }
                style={{
                  width: 56,
                  height: 72,
                  borderRadius: radii.claySm,
                  backgroundColor: t.c.sunk,
                  borderWidth: on ? 3 : 0,
                  borderColor: t.c.ink,
                  opacity: canEditWallpaper ? 1 : 0.4,
                }}
              />
            );
          })}
        </View>

        {convo.wallpaperHistory?.length > 0 && (
          <>
            <Eyebrow style={{ marginTop: spacing.base }}>Every wallpaper this room has worn</Eyebrow>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {[...convo.wallpaperHistory].reverse().map((h: any, i: number) => (
                <View
                  key={i}
                  style={{
                    width: 52,
                    height: 68,
                    borderRadius: 12,
                    backgroundColor: t.c.sunk,
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    paddingBottom: 4,
                  }}
                >
                  <Body style={{ fontSize: 9, color: t.c.inkFaint }}>{stamp(h.at)}</Body>
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </View>

      <Rule style={{ marginVertical: spacing.lg, marginHorizontal: spacing.base }} />

      {/* ── sound ─────────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: spacing.base, gap: spacing.sm }}>
        <Eyebrow>How this person sounds</Eyebrow>
        <Body faint style={{ fontSize: type.sizes.xs }}>
          You learn who it is without looking at the screen.
        </Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {SOUND_NAMES.map((s) => {
            const on = (convo.sound || 'default') === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => updatePrefs(id!, { sound: s.id }).catch(() => {})}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: radii.claySm,
                  backgroundColor: on ? t.c.sunk : t.c.surface,
                }}
              >
                <Body style={{ fontSize: type.sizes.sm, fontWeight: on ? '700' : '400' }}>{s.label}</Body>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Rule style={{ marginVertical: spacing.lg, marginHorizontal: spacing.base }} />

      {/* ── prefs ─────────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: spacing.base, gap: spacing.sm }}>
        <Eyebrow>This conversation</Eyebrow>

        {[
          { key: 'muted', label: 'Muted', icon: 'notifications-off-outline' },
          { key: 'pinned', label: 'Pinned to top', icon: 'pin-outline' },
          { key: 'archived', label: 'Archived', icon: 'archive-outline' },
        ].map((row) => (
          <Pressable
            key={row.key}
            onPress={() => updatePrefs(id!, { [row.key]: !(convo as any)[row.key] }).catch(() => {})}
          >
            <Clay style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md }}>
              <Ionicons name={row.icon as any} size={20} color={t.c.ink} />
              <Body style={{ flex: 1 }}>{row.label}</Body>
              <View
                style={{
                  width: 46,
                  height: 26,
                  borderRadius: radii.pill,
                  backgroundColor: (convo as any)[row.key] ? t.accent : t.c.sunk,
                  padding: 3,
                  alignItems: (convo as any)[row.key] ? 'flex-end' : 'flex-start',
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    backgroundColor: t.c.raised,
                    borderWidth: 2,
                    borderColor: t.c.ink,
                  }}
                />
              </View>
            </Clay>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
