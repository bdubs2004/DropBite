import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Which build the user is on.
 *
 * Attached to feedback automatically. A bug report that doesn't say which
 * platform and version it came from usually can't be acted on, and asking the
 * user to type it is asking them to get it wrong.
 */
export function appVersion(): string {
  const v = Constants.expoConfig?.version ?? 'unknown';
  // Native builds carry a separate build number that moves independently of
  // the marketing version; include it when there is one.
  const build =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber
      : Constants.expoConfig?.android?.versionCode;
  return build ? `${v} (${build})` : v;
}

export function platformName(): string {
  return `${Platform.OS}${Platform.Version ? ` ${Platform.Version}` : ''}`.slice(0, 32);
}
