import { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, Alert, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../src/stores';
import { put } from '../../src/lib/api';
import { useTheme, radii, spacing, type, accents } from '../../src/theme';
import { Avatar, Body, Heading, Eyebrow, Clay, Rule, Groove } from '../../src/components/ui';
import { registerForPush, disablePush } from '../../src/lib/push';

const clockLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function You() {
  const insets = useSafeAreaInsets();
  const { me, patchMe, logout } = useAuth();
  const t = useTheme((me?.accent as any) || 'terracotta');

  const [pushOn, setPushOn] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me?.displayName || '');

  if (!me) return null;
  const quiet = (me as any).quietHours || { enabled: false, start: 1320, end: 420, visible: true };

  const Row = ({
    icon,
    label,
    hint,
    value,
    onToggle,
    onPress,
  }: {
    icon: string;
    label: string;
    hint?: string;
    value?: boolean;
    onToggle?: (v: boolean) => void;
    onPress?: () => void;
  }) => (
    <Pressable onPress={onPress} disabled={!onPress}>
      <Clay style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md }}>
        <Ionicons name={icon as any} size={20} color={t.c.ink} />
        <View style={{ flex: 1 }}>
          <Body style={{ fontWeight: '500' }}>{label}</Body>
          {hint && (
            <Body faint style={{ fontSize: type.sizes.xs }}>
              {hint}
            </Body>
          )}
        </View>
        {onToggle && (
          <Switch
            value={value}
            onValueChange={onToggle}
            trackColor={{ true: t.accent, false: t.c.sunk }}
            thumbColor={t.c.raised}
          />
        )}
      </Clay>
    </Pressable>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.c.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.sm,
        paddingHorizontal: spacing.base,
        paddingBottom: spacing.xxl,
        gap: spacing.sm,
      }}
    >
      <Heading size="xl" style={{ marginBottom: spacing.md }}>
        You
      </Heading>

      <View style={{ alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg }}>
        <Avatar name={me.displayName} id={me.id} accent={me.accent} size={90} />
        {editing ? (
          <View style={{ width: '100%', gap: spacing.sm }}>
            <Groove>
              <TextInput
                value={name}
                onChangeText={setName}
                maxLength={40}
                style={{ color: t.c.ink, fontFamily: type.body, fontSize: type.sizes.base, paddingVertical: 12 }}
              />
            </Groove>
            <Pressable
              onPress={async () => {
                await patchMe({ displayName: name.trim() || me.displayName }).catch(() => {});
                setEditing(false);
              }}
            >
              <Body style={{ color: t.accentDeep, fontWeight: '700', textAlign: 'center' }}>Save</Body>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setEditing(true)} style={{ alignItems: 'center' }}>
            <Heading size="lg">{me.displayName}</Heading>
            <Body muted style={{ fontSize: type.sizes.sm }}>
              @{me.username}
            </Body>
          </Pressable>
        )}
      </View>

      {/* ── accent ────────────────────────────────────────────────────── */}
      <Eyebrow>Your colour</Eyebrow>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        {(['terracotta', 'moss', 'ochre', 'clay-blue', 'rust'] as const).map((a) => (
          <Pressable
            key={a}
            onPress={() => patchMe({ accent: a }).catch(() => {})}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: accents.light[a],
              borderWidth: me.accent === a ? 3 : 0,
              borderColor: t.c.ink,
            }}
          />
        ))}
      </View>

      {/* ── quiet hours ───────────────────────────────────────────────── */}
      <Eyebrow>Quiet hours</Eyebrow>
      <Body faint style={{ fontSize: type.sizes.xs, marginBottom: spacing.sm }}>
        Not a do-not-disturb that only protects you. The people you talk to see this window before they
        send, so the norm is social rather than technical.
      </Body>
      <Row
        icon="moon-outline"
        label={quiet.enabled ? `Quiet ${clockLabel(quiet.start)}–${clockLabel(quiet.end)}` : 'Off'}
        hint="Nothing notifies you inside the window"
        value={quiet.enabled}
        onToggle={async (v) => {
          await put('/users/me/quiet-hours', {
            enabled: v,
            start: quiet.start,
            end: quiet.end,
            visible: quiet.visible,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }).catch(() => {});
          useAuth.setState({ me: { ...me, quietHours: { ...quiet, enabled: v } } as any });
        }}
      />

      <View style={{ height: spacing.md }} />
      <Eyebrow>How it behaves</Eyebrow>

      <Row
        icon="notifications-outline"
        label="Push notifications"
        hint={pushOn ? 'On for this device' : 'Off'}
        value={pushOn}
        onToggle={async (v) => {
          if (v) {
            const ok = await registerForPush();
            setPushOn(ok);
            if (!ok) Alert.alert('Not enabled', 'Notification permission was refused.');
          } else {
            await disablePush();
            setPushOn(false);
          }
        }}
      />

      <Row
        icon="arrow-undo-outline"
        label="Swipe a message to reply"
        value={me.settings?.swipeToReply ?? true}
        onToggle={(v) => patchMe({ settings: { ...me.settings, swipeToReply: v } }).catch(() => {})}
      />

      <Row
        icon="checkmark-done-outline"
        label="Send read receipts"
        hint="Turn off and you stop seeing theirs too"
        value={me.privacy?.readReceipts ?? true}
        onToggle={(v) => patchMe({ privacy: { ...me.privacy, readReceipts: v } }).catch(() => {})}
      />

      <Rule style={{ marginVertical: spacing.lg }} />

      <Eyebrow>Honest note</Eyebrow>
      <Body faint style={{ fontSize: type.sizes.xs, lineHeight: 18 }}>
        Nook has no feeds, no ads and no tracking, and your messages are encrypted in transit. They are{' '}
        <Body faint style={{ fontWeight: '700', fontSize: type.sizes.xs }}>
          not
        </Body>{' '}
        end-to-end encrypted — the server can read them. If that matters for what you talk about, use
        something with E2E encryption.
      </Body>

      <View style={{ height: spacing.lg }} />
      <Pressable onPress={() => logout()}>
        <Clay style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md }}>
          <Ionicons name="log-out-outline" size={20} color={t.a.rust} />
          <Body style={{ color: t.a.rust, fontWeight: '600' }}>Sign out</Body>
        </Clay>
      </Pressable>
    </ScrollView>
  );
}
