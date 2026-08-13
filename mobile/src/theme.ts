import { Platform, useColorScheme } from 'react-native';

/**
 * Nook's design system, translated to React Native.
 *
 * The web version leans on CSS features that simply don't exist here:
 *
 *   - **Dual shadows.** Clay's whole look is a dark shadow bottom-right *and* a
 *     light one top-left. RN allows one shadow per view on iOS and only an
 *     elevation number on Android. So clay is rebuilt as a single soft shadow
 *     plus a hairline top highlight border — close enough that it reads as the
 *     same material, honest about the platform.
 *   - **Inset shadows.** No equivalent at all. Sunken surfaces use a darker
 *     fill and a top border instead, which is what an inset shadow mostly
 *     communicates anyway.
 *   - **Hard offset shadows** (the Slab look) are faked with a second absolutely
 *     positioned view behind the element. That's what `Slab` does.
 */

export const palette = {
  light: {
    bg: '#E9E1D6',
    surface: '#F4EEE6',
    raised: '#FAF6F0',
    sunk: '#DED4C6',
    edge: '#CFC2B1',
    ink: '#1E1A17',
    inkSoft: '#5C5349',
    inkFaint: '#8B8073',
    inkInvert: '#F7F2EA',
    highlight: 'rgba(255,255,255,0.75)',
  },
  dark: {
    bg: '#201D1A',
    surface: '#2B2724',
    raised: '#35302B',
    sunk: '#171412',
    edge: '#423B34',
    ink: '#EFE6DA',
    inkSoft: '#A79C8E',
    inkFaint: '#7D7367',
    inkInvert: '#1A1715',
    highlight: 'rgba(255,240,220,0.06)',
  },
};

export const accents = {
  light: {
    terracotta: '#C0603C',
    'terracotta-deep': '#A9502F',
    moss: '#57694A',
    'moss-deep': '#46563B',
    ochre: '#CE9535',
    'ochre-deep': '#B07F27',
    'clay-blue': '#47606F',
    'clay-blue-deep': '#3A4F5C',
    rust: '#A33F2F',
    'rust-deep': '#8C3427',
  },
  dark: {
    terracotta: '#D97A53',
    'terracotta-deep': '#C0603C',
    moss: '#7F9268',
    'moss-deep': '#64764F',
    ochre: '#E0AD55',
    'ochre-deep': '#C4913A',
    'clay-blue': '#6B8598',
    'clay-blue-deep': '#547083',
    rust: '#C85A45',
    'rust-deep': '#A33F2F',
  },
};

export type AccentName = keyof typeof accents.light;

export const radii = {
  claySm: 14,
  clay: 22,
  clayLg: 30,
  clayXl: 38,
  slab: 6,
  pill: 999,
};

export const spacing = { xs: 4, sm: 8, md: 12, base: 16, lg: 22, xl: 30, xxl: 42 };

export const type = {
  // System fonts: bundling three custom families would add megabytes to the
  // download for a difference most people never consciously notice on a phone.
  display: Platform.select({ ios: 'Avenir Next', android: 'sans-serif-medium', default: 'System' }),
  body: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  sizes: { xs: 12, sm: 13, base: 15.5, md: 16, lg: 20, xl: 26, xxl: 34 },
};

/** One spring for the entire app, matching the web version's feel. */
export const spring = { damping: 34, stiffness: 420, mass: 0.9 };

export function clayShadow(level: 1 | 2 | 3 = 1, dark = false) {
  const config = {
    1: { radius: 8, offset: 3, opacity: dark ? 0.4 : 0.13, elevation: 2 },
    2: { radius: 16, offset: 6, opacity: dark ? 0.48 : 0.16, elevation: 5 },
    3: { radius: 28, offset: 12, opacity: dark ? 0.55 : 0.2, elevation: 10 },
  }[level];

  return {
    shadowColor: '#1E1A17',
    shadowOffset: { width: 0, height: config.offset },
    shadowOpacity: config.opacity,
    shadowRadius: config.radius,
    elevation: config.elevation,
  };
}

export interface Theme {
  dark: boolean;
  c: typeof palette.light;
  a: typeof accents.light;
  accent: string;
  accentDeep: string;
  onAccent: string;
  clay: (level?: 1 | 2 | 3) => ReturnType<typeof clayShadow>;
}

export function buildTheme(dark: boolean, accentName: AccentName = 'terracotta'): Theme {
  const c = dark ? palette.dark : palette.light;
  const a = dark ? accents.dark : accents.light;
  return {
    dark,
    c,
    a,
    accent: a[accentName] || a.terracotta,
    accentDeep: a[`${accentName}-deep` as AccentName] || a['terracotta-deep'],
    onAccent: accentName === 'ochre' && !dark ? '#241D10' : dark ? '#201D1A' : '#FDF8F2',
    clay: (level = 1) => clayShadow(level, dark),
  };
}

export function useTheme(accentName: AccentName = 'terracotta'): Theme {
  const scheme = useColorScheme();
  return buildTheme(scheme === 'dark', accentName);
}

/** Deterministic colour per person, so someone without a photo looks consistent. */
const ACCENT_LIST: AccentName[] = ['terracotta', 'moss', 'ochre', 'clay-blue', 'rust'];
export function accentFor(id = ''): AccentName {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENT_LIST[h % ACCENT_LIST.length];
}

export const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
