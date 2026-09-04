import { Platform, Share } from 'react-native';

/**
 * Hand the user their data.
 *
 * Data portability is a legal obligation (GDPR art. 20, CCPA) and Apple asks
 * about it, so this has to actually deliver a file the user keeps — not just
 * show the JSON on screen.
 *
 * Deliberately uses no native file libraries: adding expo-file-system and
 * expo-sharing would mean a rebuild, and the platform primitives already
 * cover it. Web downloads a real file; native goes through the share sheet,
 * from which "Save to Files" or Mail both produce a keepable copy.
 */
export type ExportResult = 'saved' | 'dismissed' | 'failed';

export async function exportToFile(json: string, filename: string): Promise<ExportResult> {
  try {
    if (Platform.OS === 'web') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return 'saved';
    }

    const result = await Share.share({ title: filename, message: json });
    return result.action === Share.dismissedAction ? 'dismissed' : 'saved';
  } catch {
    return 'failed';
  }
}

/** niblgo-data-2026-09-04.json */
export function exportFilename(): string {
  return `niblgo-data-${new Date().toISOString().slice(0, 10)}.json`;
}
