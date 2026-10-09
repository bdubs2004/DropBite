import { createContext, useContext, useMemo } from 'react';
import { Platform, StyleSheet } from 'react-native';

// NiblGo brand palette (amber/cream/cocoa, see PROJECT_SCOPE.md §7), in a
// light and a dark version. The dark one is niblgo.com's dark theme: cocoa
// backgrounds, cream text and a brighter amber, with dark ink on amber buttons
// the same way the website does it.
//
// Every key means the same job in both palettes:
//   cream / creamDark   page background / chips, inputs, quiet fills
//   card                cards, sheets, bubbles (white in light mode)
//   raised              the selected pill in a segmented control: lifts
//                       off its track in both themes
//   cocoa / Soft / Faint  text, secondary text, meta text
//   amber / amberDark   accent fill / accent text and links
//   onAmber             text and icons sitting on an amber fill
//   white               real white, for things on photos or red buttons

export type MealSlotMeta = { label: string; color: string; bg: string };

export type Palette = {
  dark: boolean;
  amber: string;
  amberDark: string;
  amberSoft: string;
  cream: string;
  creamDark: string;
  cocoa: string;
  cocoaSoft: string;
  cocoaFaint: string;
  white: string;
  card: string;
  raised: string;
  onAmber: string;
  danger: string;
  success: string;
  overlay: string;
  hairline: string;
  meal: Record<string, MealSlotMeta>;
};

export const lightColors: Palette = {
  dark: false,
  amber: '#E8862E',
  amberDark: '#C96D1B',
  amberSoft: '#F7C593',
  cream: '#FFF4DE',
  creamDark: '#F6E7C8',
  cocoa: '#4A2E12',
  cocoaSoft: '#7A5A38',
  cocoaFaint: '#A98F73',
  white: '#FFFFFF',
  card: '#FFFFFF',
  raised: '#FFFFFF',
  onAmber: '#FFFFFF',
  danger: '#C94F2E',
  success: '#5E8C3A',
  overlay: 'rgba(74, 46, 18, 0.45)',
  hairline: 'rgba(74, 46, 18, 0.10)',
  meal: {
    breakfast: { label: 'Breakfast', color: '#9A5E12', bg: '#F7E7CB' },
    lunch: { label: 'Lunch', color: '#6B6B1E', bg: '#EDEDCF' },
    dinner: { label: 'Dinner', color: '#7E3B30', bg: '#F2DDD5' },
    snack: { label: 'Snack', color: '#5E4A7D', bg: '#E6E0EF' },
  },
};

export const darkColors: Palette = {
  dark: true,
  amber: '#F59A3E',
  amberDark: '#FFB65C',
  amberSoft: '#5C3B17',
  cream: '#140E08',
  creamDark: '#372716',
  cocoa: '#FFF6E9',
  cocoaSoft: '#E8D7BE',
  cocoaFaint: '#B8A183',
  white: '#FFFFFF',
  card: '#2C1E11',
  raised: '#4D3721',
  onAmber: '#20140A',
  danger: '#E8714F',
  success: '#8DBF63',
  overlay: 'rgba(0, 0, 0, 0.55)',
  hairline: 'rgba(252, 239, 219, 0.12)',
  meal: {
    breakfast: { label: 'Breakfast', color: '#F2C27A', bg: '#3D2A12' },
    lunch: { label: 'Lunch', color: '#D9D98C', bg: '#2F2F15' },
    dinner: { label: 'Dinner', color: '#EFA898', bg: '#3D1F18' },
    snack: { label: 'Snack', color: '#CDBDEB', bg: '#2C2439' },
  },
};

export const fonts = {
  // Baloo 2 is reserved for the brand wordmark only; Nunito everywhere else
  // keeps the interface clean and grown-up.
  wordmark: 'Baloo2_800ExtraBold',
  display: 'Nunito_800ExtraBold',
  bold: 'Nunito_700Bold',
  semi: 'Nunito_600SemiBold',
  regular: 'Nunito_400Regular',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
};

/**
 * Every photo grid (profiles, Dishes, Search, Your activity, tagged posts,
 * collections) uses the same look: three across, a little air between the
 * tiles, padded in from the screen edges, rounded corners.
 */
export const photoGrid = {
  columns: 3,
  gap: 6,
  side: spacing.lg,
  radius: radius.md,
};

export type Shadows = { shadow: object; shadowSoft: object };

function makeShadows(c: Palette): Shadows {
  // Brown shadows on cream; on the dark theme only black reads as depth.
  const rgb = c.dark ? '0, 0, 0' : '74, 46, 18';
  const color = c.dark ? '#000000' : c.cocoa;
  return {
    shadow: Platform.select({
      web: { boxShadow: `0 6px 18px rgba(${rgb}, ${c.dark ? 0.5 : 0.1})` } as object,
      default: {
        shadowColor: color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: c.dark ? 0.45 : 0.12,
        shadowRadius: 10,
        elevation: 4,
      },
    }) as object,
    shadowSoft: Platform.select({
      web: { boxShadow: `0 2px 8px rgba(${rgb}, ${c.dark ? 0.4 : 0.08})` } as object,
      default: {
        shadowColor: color,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: c.dark ? 0.35 : 0.08,
        shadowRadius: 5,
        elevation: 2,
      },
    }) as object,
  };
}

const lightShadows = makeShadows(lightColors);
const darkShadows = makeShadows(darkColors);

/** System follows the phone, like niblgo.com follows the browser. */
export type ThemeMode = 'system' | 'light' | 'dark';

export type Theme = Shadows & {
  colors: Palette;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

export function themeFor(dark: boolean, mode: ThemeMode, setMode: (m: ThemeMode) => void): Theme {
  return {
    colors: dark ? darkColors : lightColors,
    ...(dark ? darkShadows : lightShadows),
    mode,
    setMode,
  };
}

export const ThemeContext = createContext<Theme>(themeFor(false, 'system', () => {}));

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;

/**
 * Styles that follow the theme. Write them like StyleSheet.create, but as a
 * function of the palette; each component calls the returned hook. Each
 * palette's sheet is built once and reused.
 *
 *   const useStyles = makeStyles((colors, { shadow }) => ({ box: { ... } }));
 *   function Box() { const styles = useStyles(); ... }
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  build: (colors: Palette, shadows: Shadows) => T,
): () => T {
  const sheets = new Map<Palette, T>();
  return function useStyles() {
    const { colors, shadow, shadowSoft } = useContext(ThemeContext);
    return useMemo(() => {
      let sheet = sheets.get(colors);
      if (!sheet) {
        sheet = StyleSheet.create(build(colors, { shadow, shadowSoft }));
        sheets.set(colors, sheet);
      }
      return sheet;
    }, [colors, shadow, shadowSoft]);
  };
}
