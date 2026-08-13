import { useRef, useState } from 'react';
import { View, TextInput, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

import { useChat, useAuth, type Message } from '../stores';
import { useTheme, radii, spacing, type } from '../theme';
import { Body, ClayButton, Groove } from './ui';
import { uploadFile } from '../lib/api';
import { duration } from '../lib/format';
import { getSocket } from '../lib/socket';

export default function Composer({
  conversationId,
  replyTo,
  onClearReply,
  onTyping,
}: {
  conversationId: string;
  replyTo: Message | null;
  onClearReply: () => void;
  onTyping: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const send = useChat((s) => s.send);
  const slowMode = useChat((s) => s.conversations[conversationId]?.slowMode || 0);

  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [seconds, setSeconds] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTyping = useRef(0);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    getSocket()?.emit('typing:stop', { conversationId });
    try {
      await send({ conversationId, body, replyTo: replyTo?.id || null });
      onClearReply();
    } catch (err: any) {
      // Slow mode and blocks land here with a readable reason.
      Alert.alert('Not sent', err?.message || 'Could not send that.');
      setText(body);
    }
  };

  /* ── media ─────────────────────────────────────────────────────────────── */

  async function pickImage(fromCamera: boolean, asSnap = false) {
    setAttachOpen(false);

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', `Nook needs access to your ${fromCamera ? 'camera' : 'photos'}.`);
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.Images })
      : await ImagePicker.launchImageLibraryAsync({
          quality: 0.8,
          mediaTypes: ImagePicker.MediaTypeOptions.All,
        });

    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const isVideo = asset.type === 'video';

    setUploading(true);
    try {
      const { media } = await uploadFile(
        asset.uri,
        'message',
        asset.fileName || (isVideo ? 'video.mp4' : 'photo.jpg'),
        asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg')
      );
      await send({
        conversationId,
        type: asSnap ? 'snap' : isVideo ? 'video' : 'image',
        // The picker already knows the dimensions, so the bubble can reserve
        // the right shape before the image downloads.
        media: { ...media, width: asset.width, height: asset.height },
        viewOnce: asSnap,
        replyTo: replyTo?.id || null,
      });
      onClearReply();
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message || 'Could not send that.');
    } finally {
      setUploading(false);
    }
  }

  async function pickDocument() {
    setAttachOpen(false);
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const file = result.assets[0];

    setUploading(true);
    try {
      const { media } = await uploadFile(file.uri, 'message', file.name, file.mimeType || 'application/octet-stream');
      await send({ conversationId, type: 'file', media, replyTo: replyTo?.id || null });
      onClearReply();
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message || 'Could not send that.');
    } finally {
      setUploading(false);
    }
  }

  /* ── voice notes ───────────────────────────────────────────────────────── */

  async function startRecording() {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Nook needs your microphone for voice messages.');
        return;
      }

      // Without this, iOS routes playback to the earpiece and records silence.
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
      setSeconds(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      Alert.alert('Could not record', 'The microphone is unavailable.');
    }
  }

  async function stopRecording(discard = false) {
    if (!recording) return;
    if (timer.current) clearInterval(timer.current);

    const length = seconds;
    setRecording(null);
    setSeconds(0);

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      if (discard || !uri || length < 1) return;

      setUploading(true);
      const { media } = await uploadFile(uri, 'voice', 'voice.m4a', 'audio/m4a');
      await send({
        conversationId,
        type: 'voice',
        media: { ...media, duration: length },
        replyTo: replyTo?.id || null,
      });
      onClearReply();
    } catch {
      Alert.alert('Not sent', 'Could not send that voice message.');
    } finally {
      setUploading(false);
    }
  }

  const bottom = insets.bottom || spacing.sm;

  return (
    <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: bottom }}>
      {slowMode > 0 && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            padding: spacing.sm,
            marginBottom: spacing.sm,
            borderRadius: radii.claySm,
            backgroundColor: `${t.a.moss}22`,
          }}
        >
          <Ionicons name="time-outline" size={15} color={t.c.inkSoft} />
          <Body muted style={{ fontSize: type.sizes.xs, flex: 1 }}>
            Slow mode: one message every {slowMode < 60 ? `${slowMode}s` : `${Math.round(slowMode / 60)} min`} per person.
          </Body>
        </View>
      )}

      {replyTo && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            padding: spacing.sm,
            marginBottom: spacing.sm,
            borderRadius: radii.claySm,
            backgroundColor: t.c.sunk,
            borderLeftWidth: 3,
            borderLeftColor: t.accent,
          }}
        >
          <View style={{ flex: 1 }}>
            <Body style={{ fontSize: type.sizes.xs, fontWeight: '700', color: t.accentDeep }}>
              Replying to {replyTo.sender?.displayName || 'them'}
            </Body>
            <Body numberOfLines={1} muted style={{ fontSize: type.sizes.sm }}>
              {replyTo.body || replyTo.type}
            </Body>
          </View>
          <Pressable onPress={onClearReply} hitSlop={10}>
            <Ionicons name="close" size={18} color={t.c.inkSoft} />
          </Pressable>
        </View>
      )}

      {attachOpen && (
        <View
          style={[
            {
              flexDirection: 'row',
              justifyContent: 'space-around',
              padding: spacing.base,
              marginBottom: spacing.sm,
              borderRadius: radii.clay,
              backgroundColor: t.c.raised,
            },
            t.clay(2),
          ]}
        >
          {[
            { icon: 'image-outline', label: 'Photo', run: () => pickImage(false) },
            { icon: 'camera-outline', label: 'Camera', run: () => pickImage(true) },
            { icon: 'flame-outline', label: 'Snap', run: () => pickImage(true, true) },
            { icon: 'document-outline', label: 'File', run: pickDocument },
          ].map((a) => (
            <Pressable key={a.label} onPress={a.run} style={{ alignItems: 'center', gap: 5 }}>
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: radii.pill,
                  backgroundColor: t.c.sunk,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={a.icon as any} size={21} color={t.c.ink} />
              </View>
              <Body style={{ fontSize: type.sizes.xs }}>{a.label}</Body>
            </Pressable>
          ))}
        </View>
      )}

      {recording ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ClayButton onPress={() => stopRecording(true)}>
            <Ionicons name="trash-outline" size={20} color={t.a.rust} />
          </ClayButton>
          <Groove
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingVertical: 12,
              borderRadius: radii.clayLg,
            }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.a.rust }} />
            <Body style={{ fontFamily: type.mono, fontSize: type.sizes.sm }}>{duration(seconds)}</Body>
            <Body muted style={{ fontSize: type.sizes.xs, flex: 1 }}>
              Recording — tap send when you're done
            </Body>
          </Groove>
          <Pressable
            onPress={() => stopRecording(false)}
            style={[
              {
                width: 48,
                height: 48,
                borderRadius: 15,
                backgroundColor: t.a.rust,
                borderWidth: 2,
                borderColor: t.c.ink,
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
          >
            <Ionicons name="send" size={20} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
          <ClayButton onPress={() => setAttachOpen((v) => !v)} active={attachOpen}>
            <Ionicons name={attachOpen ? 'close' : 'add'} size={22} color={t.c.ink} />
          </ClayButton>

          <Groove
            style={{
              flex: 1,
              borderRadius: radii.clayLg,
              paddingVertical: 2,
              justifyContent: 'center',
              minHeight: 48,
            }}
          >
            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                const now = Date.now();
                if (now - lastTyping.current > 2600) {
                  lastTyping.current = now;
                  onTyping();
                }
              }}
              placeholder={uploading ? 'Uploading…' : 'Say something'}
              placeholderTextColor={t.c.inkFaint}
              multiline
              style={{
                color: t.c.ink,
                fontFamily: type.body,
                fontSize: type.sizes.base,
                maxHeight: 120,
                paddingVertical: 10,
              }}
            />
          </Groove>

          <Pressable
            onPress={text.trim() ? submit : startRecording}
            disabled={uploading}
            style={{
              width: 48,
              height: 48,
              borderRadius: 15,
              backgroundColor: t.accent,
              borderWidth: 2,
              borderColor: t.c.ink,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: uploading ? 0.5 : 1,
            }}
          >
            <Ionicons name={text.trim() ? 'send' : 'mic'} size={20} color={t.onAccent} />
          </Pressable>
        </View>
      )}
    </View>
  );
}
