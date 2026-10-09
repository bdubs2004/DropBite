import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { ThemeContext, ThemeMode, themeFor } from '../theme';

/** Kept on this device only, like niblgo.com keeps it in the browser. */
export const THEME_KEY = 'niblgo.theme';

const isMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';

/**
 * Light or dark for the whole app. Follows the phone's setting until the
 * person picks Light or Dark in Settings. Children render only once the saved
 * choice is read (a few milliseconds), so the app never flashes the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode | null>(null);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => alive && setModeState(isMode(v) ? v : 'system'))
      .catch(() => alive && setModeState('system'));
    return () => {
      alive = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
  }, []);

  const current = mode ?? 'system';
  const dark = current === 'system' ? system === 'dark' : current === 'dark';
  const theme = useMemo(() => themeFor(dark, current, setMode), [dark, current, setMode]);

  if (mode === null) return null;
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
