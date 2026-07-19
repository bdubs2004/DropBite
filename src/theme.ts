import { Platform } from 'react-native';

// nibl brand palette (amber/cream/cocoa, see PROJECT_SCOPE.md §7)
export const colors = {
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
  danger: '#C94F2E',
  success: '#5E8C3A',
  overlay: 'rgba(74, 46, 18, 0.45)',
  hairline: 'rgba(74, 46, 18, 0.10)',
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

export const shadow = Platform.select({
  web: {
    boxShadow: '0 6px 18px rgba(74, 46, 18, 0.10)',
  } as object,
  default: {
    shadowColor: colors.cocoa,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
}) as object;

export const shadowSoft = Platform.select({
  web: {
    boxShadow: '0 2px 8px rgba(74, 46, 18, 0.08)',
  } as object,
  default: {
    shadowColor: colors.cocoa,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
}) as object;

export const MEAL_SLOT_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  breakfast: { label: 'Breakfast', color: '#9A5E12', bg: '#F7E7CB' },
  lunch: { label: 'Lunch', color: '#6B6B1E', bg: '#EDEDCF' },
  dinner: { label: 'Dinner', color: '#7E3B30', bg: '#F2DDD5' },
  snack: { label: 'Snack', color: '#5E4A7D', bg: '#E6E0EF' },
};
