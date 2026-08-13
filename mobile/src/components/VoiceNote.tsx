import { useEffect, useRef, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

import { type Message } from '../stores';
import { useTheme, spacing, type } from '../theme';
import { Body } from './ui';
import { duration } from '../lib/format';
import { mediaUrl } from '../lib/api';

const FALLBACK = Array.from({ length: 30 }, (_, i) => 0.35 + Math.abs(Math.sin(i * 1.7)) * 0.6);

/**
 * A voice note with a waveform, speed control and resume.
 *
 * expo-av unloads sounds explicitly — if you don't, every played note stays in
 * memory and Android eventually runs out of audio players and goes silent.
 * Hence the unload on unmount.
 */
export default function VoiceNote({ message, tint }: { message: Message; tint: string }) {
  const t = useTheme();
  const sound = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);

  const bars = message.media?.waveform?.length ? message.media.waveform : FALLBACK;
  const total = message.media?.duration || 0;

  useEffect(() => {
    return () => {
      sound.current?.unloadAsync().catch(() => {});
      sound.current = null;
    };
  }, []);

  async function toggle() {
    try {
      if (!sound.current) {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound: s } = await Audio.Sound.createAsync(
          { uri: mediaUrl(message.media?.url) },
          { shouldPlay: true, rate: speed, shouldCorrectPitch: true },
          (status) => {
            if (!status.isLoaded) return;
            setPlaying(status.isPlaying);
            if (status.durationMillis) setProgress(status.positionMillis / status.durationMillis);
            if (status.didJustFinish) {
              setPlaying(false);
              setProgress(0);
            }
          }
        );
        sound.current = s;
        return;
      }

      const status = await sound.current.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) await sound.current.pauseAsync();
      else await sound.current.playAsync();
    } catch {
      /* audio unavailable — nothing worth interrupting the user for */
    }
  }

  async function cycleSpeed() {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    await sound.current?.setRateAsync(next, true).catch(() => {});
  }

  return (
    <View style={{ gap: 4, minWidth: 210 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Pressable onPress={toggle} hitSlop={8}>
          <Ionicons name={playing ? 'pause' : 'play'} size={22} color={tint} />
        </Pressable>

        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 28 }}>
          {bars.slice(0, 30).map((h: number, i: number) => (
            <View
              key={i}
              style={{
                flex: 1,
                minWidth: 2,
                borderRadius: 2,
                backgroundColor: tint,
                opacity: i / 30 <= progress ? 1 : 0.32,
                height: `${Math.max(14, Math.min(100, h * 100))}%`,
              }}
            />
          ))}
        </View>

        <Pressable onPress={cycleSpeed} hitSlop={8}>
          <Body style={{ color: tint, fontFamily: type.mono, fontSize: 10, opacity: 0.8 }}>{speed}×</Body>
        </Pressable>

        <Body style={{ color: tint, fontFamily: type.mono, fontSize: type.sizes.xs, opacity: 0.8 }}>
          {duration(progress ? progress * total : total)}
        </Body>
      </View>

      {/* Transcribed on the sender's device — the audio never went anywhere. */}
      {!!message.transcript && (
        <Body style={{ color: tint, opacity: 0.8, fontSize: type.sizes.sm, fontStyle: 'italic' }}>
          {message.transcript}
        </Body>
      )}
    </View>
  );
}
