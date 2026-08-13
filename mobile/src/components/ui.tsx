import { ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme, radii, type, spacing, initials, accentFor, type Theme } from '../theme';

/**
 * The two materials, in React Native.
 *
 * Clay = soft shadow + a hairline top highlight.
 * Slab = flat fill, 2px ink border, and a hard offset shadow faked with a
 *        second view behind it (RN has no `box-shadow: 4px 4px 0`).
 *
 * Pressing a Slab moves it onto its shadow, exactly like the web version — the
 * physicality is the whole point of the language, so it survives the port.
 */

export function Clay({
  children,
  level = 1,
  style,
  sunk = false,
}: {
  children?: ReactNode;
  level?: 1 | 2 | 3;
  style?: StyleProp<ViewStyle>;
  sunk?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: sunk ? t.c.sunk : t.c.surface,
          borderRadius: radii.clay,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: sunk ? 'transparent' : t.c.highlight,
        },
        sunk ? null : t.clay(level),
        style,
      ]}
    >
      {children}
    </View>
  );
}

interface SlabProps {
  children?: ReactNode;
  onPress?: () => void;
  variant?: 'accent' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  loading?: boolean;
  accentName?: string;
}

export function Slab({
  children,
  onPress,
  variant = 'accent',
  size = 'md',
  disabled,
  style,
  textStyle,
  loading,
  accentName,
}: SlabProps) {
  const t = useTheme((accentName as any) || 'terracotta');
  const offset = size === 'sm' ? 3 : 4;

  const fill =
    variant === 'accent' ? t.accent : variant === 'danger' ? t.a.rust : t.c.surface;
  const label =
    variant === 'accent' ? t.onAccent : variant === 'danger' ? '#FDF6F3' : t.c.ink;

  return (
    <View style={[{ alignSelf: 'stretch' }, style]}>
      {/* The hard shadow: a plain view sitting behind and below. */}
      <View
        style={{
          position: 'absolute',
          left: offset,
          top: offset,
          right: -offset,
          bottom: -offset,
          backgroundColor: t.c.ink,
          borderRadius: radii.slab,
          opacity: disabled ? 0.35 : 1,
        }}
      />
      <Pressable
        onPress={() => {
          if (disabled || loading) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress?.();
        }}
        disabled={disabled || loading}
        style={({ pressed }) => ({
          backgroundColor: fill,
          borderColor: t.c.ink,
          borderWidth: 2,
          borderRadius: radii.slab,
          paddingVertical: size === 'sm' ? 7 : 13,
          paddingHorizontal: size === 'sm' ? 13 : 20,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          opacity: disabled ? 0.5 : 1,
          // Pressing moves the button into its own shadow.
          transform: pressed ? [{ translateX: offset }, { translateY: offset }] : [],
        })}
      >
        {loading ? (
          <ActivityIndicator color={label} size="small" />
        ) : typeof children === 'string' ? (
          <Text
            style={[
              {
                color: label,
                fontFamily: type.display,
                fontWeight: '600',
                fontSize: size === 'sm' ? type.sizes.sm : type.sizes.md,
              },
              textStyle,
            ]}
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </Pressable>
    </View>
  );
}

/** A round clay button — the icon actions used all over the app. */
export function ClayButton({
  children,
  onPress,
  size = 44,
  style,
  active,
}: {
  children: ReactNode;
  onPress?: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active || pressed ? t.c.sunk : t.c.surface,
        },
        active || pressed ? null : t.clay(1),
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** An input pressed into the clay, rather than an outlined box. */
export function Groove({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.c.sunk,
          borderRadius: radii.claySm,
          borderTopWidth: 1,
          borderTopColor: t.dark ? '#0F0D0C' : '#C9BCAB',
          paddingHorizontal: spacing.base,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Avatar({
  name,
  uri,
  id,
  accent,
  size = 44,
  square = false,
  online,
  showDot,
}: {
  name: string;
  uri?: string | null;
  id?: string;
  accent?: string;
  size?: number;
  square?: boolean;
  online?: boolean;
  showDot?: boolean;
}) {
  const t = useTheme();
  const tone = t.a[(accent as any) || accentFor(id || name)] || t.a.terracotta;
  const radius = square ? Math.max(10, size * 0.28) : radii.pill;

  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <View style={[{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }, t.clay(1)]}>
          {/* expo-image is imported lazily by the caller where it matters. */}
          <View style={{ flex: 1, backgroundColor: t.c.sunk }} />
        </View>
      ) : (
        <View
          style={[
            {
              width: size,
              height: size,
              borderRadius: radius,
              backgroundColor: tone,
              alignItems: 'center',
              justifyContent: 'center',
            },
            t.clay(1),
          ]}
        >
          <Text
            style={{
              color: accent === 'ochre' ? '#241D10' : '#FDF8F2',
              fontFamily: type.display,
              fontWeight: '700',
              fontSize: Math.max(11, size * 0.36),
            }}
          >
            {initials(name)}
          </Text>
        </View>
      )}

      {/* The presence dot is a rotated square, matching the slab language. */}
      {showDot && online && (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(10, size * 0.3),
            height: Math.max(10, size * 0.3),
            backgroundColor: t.a.moss,
            borderWidth: 2,
            borderColor: t.c.bg,
            borderRadius: 3,
            transform: [{ rotate: '45deg' }],
          }}
        />
      )}
    </View>
  );
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return (
    <Text
      style={[
        {
          fontSize: type.sizes.xs,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: t.c.inkFaint,
          fontWeight: '600',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  style,
  muted,
  faint,
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
  faint?: boolean;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          color: faint ? t.c.inkFaint : muted ? t.c.inkSoft : t.c.ink,
          fontFamily: type.body,
          fontSize: type.sizes.base,
          lineHeight: type.sizes.base * 1.5,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Heading({
  children,
  size = 'lg',
  style,
}: {
  children: ReactNode;
  size?: 'lg' | 'xl' | 'xxl';
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <Text
      style={[
        {
          color: t.c.ink,
          fontFamily: type.display,
          fontWeight: '700',
          fontSize: type.sizes[size],
          letterSpacing: -0.5,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** The unread counter and other hard-edged badges. */
export function Chip({ children, tone }: { children: ReactNode; tone?: 'quiet' | 'accent' }) {
  const t = useTheme();
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: 6,
        borderRadius: radii.slab,
        borderWidth: 2,
        borderColor: t.c.ink,
        backgroundColor: tone === 'quiet' ? t.c.surface : t.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: tone === 'quiet' ? t.c.ink : t.onAccent,
          fontFamily: type.mono,
          fontSize: 11,
          fontWeight: '600',
        }}
      >
        {children}
      </Text>
    </View>
  );
}

export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height: 2, borderRadius: 2, backgroundColor: t.c.sunk }, style]} />;
}
