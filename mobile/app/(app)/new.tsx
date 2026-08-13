import { useEffect, useState } from 'react';
import { View, TextInput, Pressable, FlatList, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useChat, useAuth, type Person } from '../../src/stores';
import { get, post } from '../../src/lib/api';
import { useTheme, radii, spacing, type } from '../../src/theme';
import { Avatar, Body, Heading, Eyebrow, Groove, Slab, Chip } from '../../src/components/ui';

export default function New() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.me);
  const t = useTheme((me?.accent as any) || 'terracotta');
  const { openDirect, createGroup, setActive } = useChat();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [contacts, setContacts] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<{ contacts: Person[] }>('/users').then((r) => setContacts(r.contacts)).catch(() => {});
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) return setResults([]);
    const timer = setTimeout(() => {
      get<{ users: Person[] }>(`/users/search?q=${encodeURIComponent(query)}`)
        .then((r) => setResults(r.users))
        .catch(() => {});
    }, 280);
    return () => clearTimeout(timer);
  }, [query]);

  const shown = query.trim().length >= 2 ? results : contacts;
  const groupMode = picked.length > 0;

  const start = async (person: Person) => {
    try {
      const id = await openDirect(person.id);
      await post(`/users/${person.id}/contact`).catch(() => {});
      setActive(id);
      router.push(`/chat/${id}`);
    } catch (e: any) {
      Alert.alert('Could not open', e?.message || 'Something went wrong.');
    }
  };

  const makeGroup = async () => {
    setBusy(true);
    try {
      const id = await createGroup({ name: groupName.trim(), memberIds: picked.map((p) => p.id) });
      setPicked([]);
      setGroupName('');
      router.push(`/chat/${id}`);
    } catch (e: any) {
      Alert.alert('Could not create', e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.c.bg, paddingTop: insets.top + spacing.sm }}>
      <View style={{ paddingHorizontal: spacing.base, gap: spacing.md }}>
        <Heading size="xl">New conversation</Heading>

        <Groove style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radii.pill }}>
          <Ionicons name="search" size={17} color={t.c.inkFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find someone by username"
            placeholderTextColor={t.c.inkFaint}
            autoCapitalize="none"
            style={{ flex: 1, color: t.c.ink, fontFamily: type.body, fontSize: type.sizes.base, paddingVertical: 10 }}
          />
        </Groove>

        {groupMode && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {picked.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setPicked((c) => c.filter((x) => x.id !== p.id))}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: radii.pill,
                    borderWidth: 2,
                    borderColor: t.c.ink,
                    backgroundColor: t.c.surface,
                  }}
                >
                  <Body style={{ fontSize: type.sizes.sm }}>{p.displayName.split(' ')[0]}</Body>
                  <Ionicons name="close" size={13} color={t.c.ink} />
                </Pressable>
              ))}
            </View>

            <Groove>
              <TextInput
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Group name"
                placeholderTextColor={t.c.inkFaint}
                maxLength={50}
                style={{ color: t.c.ink, fontFamily: type.body, fontSize: type.sizes.base, paddingVertical: 12 }}
              />
            </Groove>

            <Slab onPress={makeGroup} disabled={!groupName.trim() || !picked.length} loading={busy}>
              {`Create with ${picked.length} ${picked.length === 1 ? 'person' : 'people'}`}
            </Slab>
          </>
        )}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.base, gap: 6 }}
        ListHeaderComponent={
          <Eyebrow style={{ marginBottom: spacing.sm }}>
            {query.trim().length >= 2 ? 'Search results' : 'Your contacts'}
          </Eyebrow>
        }
        renderItem={({ item: p }) => {
          const on = picked.some((x) => x.id === p.id);
          return (
            <Pressable
              onPress={() => (groupMode ? setPicked((c) => (on ? c.filter((x) => x.id !== p.id) : [...c, p])) : start(p))}
              onLongPress={() => setPicked((c) => (on ? c : [...c, p]))}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                padding: spacing.md,
                borderRadius: radii.claySm,
                backgroundColor: t.c.surface,
              }}
            >
              <Avatar name={p.displayName} id={p.id} accent={p.accent} size={42} online={p.online} showDot />
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '600' }}>{p.displayName}</Body>
                <Body faint style={{ fontSize: type.sizes.xs }}>
                  @{p.username}
                </Body>
              </View>
              {on && <Chip>✓</Chip>}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Body muted style={{ padding: spacing.base }}>
            {query.trim().length >= 2
              ? 'Nobody by that name. Usernames are exact — no phone numbers involved.'
              : 'No contacts yet. Search for a username to start. Long-press someone to build a group.'}
          </Body>
        }
      />
    </View>
  );
}
