import { useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../src/stores';
import { useTheme, radii, spacing, type } from '../src/theme';
import { Clay, Slab, Groove, Heading, Body, Eyebrow } from '../src/components/ui';
import { ApiError } from '../src/lib/api';

/**
 * The Front Door, on a phone.
 *
 * Same idea as the web version — a single low-sitting clay column, sunken input
 * grooves, one Slab button — but the drifting blob field is replaced by a
 * static gradient. Animating four large blurred shapes at 60fps is fine on a
 * desktop GPU and a battery-drain on a phone for something you look at once.
 */
export default function SignIn() {
  const { login, signup } = useAuth();
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canSubmit =
    mode === 'in' ? username.length >= 3 && password.length >= 1 : username.length >= 3 && password.length >= 8;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'in') await login(username.trim().toLowerCase(), password);
      else
        await signup({
          username: username.trim().toLowerCase(),
          displayName: displayName.trim() || username.trim(),
          password,
        });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const input = {
    color: t.c.ink,
    fontFamily: type.body,
    fontSize: type.sizes.md,
    paddingVertical: 14,
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.c.bg }}>
      <LinearGradient
        colors={
          t.dark
            ? ['#2A211C', '#201D1A', '#1C201D']
            : [`${t.a.terracotta}22`, t.c.bg, `${t.a.moss}18`]
        }
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: spacing.lg,
            paddingBottom: insets.bottom + spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* The mark: a clay square with an alcove cut into it, which also
              reads as a lowercase n. */}
          <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
            <View
              style={[
                {
                  width: 92,
                  height: 92,
                  borderRadius: 26,
                  backgroundColor: t.c.surface,
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingBottom: 14,
                },
                t.clay(3),
              ]}
            >
              <View
                style={{
                  width: 34,
                  height: 40,
                  backgroundColor: t.a.terracotta,
                  borderTopLeftRadius: 17,
                  borderTopRightRadius: 17,
                }}
              />
            </View>
            <Heading size="xxl" style={{ marginTop: spacing.base }}>
              Nook
            </Heading>
            <Body muted style={{ fontSize: type.sizes.sm }}>
              Your corner of the internet.
            </Body>
          </View>

          <Clay level={3} style={{ padding: spacing.lg, borderRadius: radii.clayXl }}>
            <Heading size="xl">{mode === 'in' ? 'Welcome back' : 'Make a nook'}</Heading>
            <Body muted style={{ fontSize: type.sizes.sm, marginTop: 4, marginBottom: spacing.lg }}>
              {mode === 'in'
                ? 'Your corner is exactly where you left it.'
                : 'A username is all you need. No phone number.'}
            </Body>

            <Eyebrow style={{ marginBottom: 6 }}>Username</Eyebrow>
            <Groove style={{ marginBottom: spacing.base }}>
              <TextInput
                value={username}
                onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase())}
                placeholder="riverbend"
                placeholderTextColor={t.c.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
                style={input}
              />
            </Groove>

            {mode === 'up' && (
              <>
                <Eyebrow style={{ marginBottom: 6 }}>What should people call you?</Eyebrow>
                <Groove style={{ marginBottom: spacing.base }}>
                  <TextInput
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="River Bend"
                    placeholderTextColor={t.c.inkFaint}
                    maxLength={40}
                    style={input}
                  />
                </Groove>
              </>
            )}

            <Eyebrow style={{ marginBottom: 6 }}>Password</Eyebrow>
            <Groove>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={t.c.inkFaint}
                secureTextEntry
                style={input}
              />
            </Groove>

            {!!error && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md }}>
                <Ionicons name="warning-outline" size={15} color={t.a.rust} />
                <Body style={{ color: t.a.rust, fontSize: type.sizes.sm, flex: 1 }}>{error}</Body>
              </View>
            )}

            <Slab
              onPress={submit}
              disabled={!canSubmit}
              loading={busy}
              style={{ marginTop: spacing.lg }}
            >
              {mode === 'in' ? 'Open the door' : 'Make my nook'}
            </Slab>

            <Pressable
              onPress={() => {
                setMode(mode === 'in' ? 'up' : 'in');
                setError('');
              }}
              style={{ marginTop: spacing.base, alignItems: 'center' }}
            >
              <Text style={{ color: t.c.inkSoft, fontSize: type.sizes.sm }}>
                {mode === 'in' ? 'New here? ' : 'Already have one? '}
                <Text style={{ color: t.accentDeep, fontWeight: '700' }}>
                  {mode === 'in' ? 'Make a nook' : 'Sign in'}
                </Text>
              </Text>
            </Pressable>
          </Clay>

          <Body faint style={{ textAlign: 'center', fontSize: type.sizes.xs, marginTop: spacing.lg }}>
            No feed, no reels, no stories, no strangers. Messages are encrypted in transit and never
            used to train anything.
          </Body>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
