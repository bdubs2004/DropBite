import { Platform } from 'react-native';

// DropBite brand palette (see PROJECT_SCOPE.md §7)
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
  // Baloo 2 for display / wordmark, Nunito for body
  display: 'Baloo2_800ExtraBold',
  displaySemi: 'Baloo2_600SemiBold',
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
  { label: string; emoji: string; color: string; bg: string }
> = {
  breakfast: { label: 'Breakfast', emoji: '🍳', color: '#B06A14', bg: '#FDE8C8' },
  lunch: { label: 'Lunch', emoji: '🥪', color: '#7A7A18', bg: '#F0F0C9' },
  dinner: { label: 'Dinner', emoji: '🍲', color: '#8C3A2E', bg: '#F8DCD2' },
  snack: { label: 'Snack', emoji: '🍿', color: '#6A4A8C', bg: '#E9DFF5' },
};
