import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type PickImageResult =
  | { uri: string; error?: undefined }
  | { uri?: undefined; error: string }
  /** User backed out. Not an error, so callers shouldn't show anything. */
  | { uri?: undefined; error?: undefined; canceled: true };

/**
 * Pick a photo from the camera or library, then downscale and compress it.
 *
 * Shared by the compose screen and the avatar picker so the camera-permission
 * handling lives in exactly one place. The camera needs an explicit runtime
 * grant; without it launchCameraAsync just fails, which is what made the
 * Camera button silently do nothing. The library picker needs no grant.
 */
export async function pickImage(opts: {
  fromCamera: boolean;
  /** Crop aspect ratio, e.g. [4, 5] for posts or [1, 1] for avatars. */
  aspect: [number, number];
  /** Longest-edge cap after resize. */
  width: number;
}): Promise<PickImageResult> {
  const { fromCamera, aspect, width } = opts;
  try {
    if (fromCamera) {
      const current = await ImagePicker.getCameraPermissionsAsync();
      let granted = current.granted;
      if (!granted && current.canAskAgain) {
        granted = (await ImagePicker.requestCameraPermissionsAsync()).granted;
      }
      if (!granted) {
        return {
          error:
            'NiblGo needs camera access to take a photo. Turn it on in your device settings, or pick one from your library.',
        };
      }
    }

    const pickerOpts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: true,
      aspect,
    };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(pickerOpts)
      : await ImagePicker.launchImageLibraryAsync(pickerOpts);
    if (res.canceled || !res.assets?.length) return { canceled: true };

    // Compress client-side before upload; photos are the product, so cap
    // generously (CLAUDE.md image handling rule).
    const manipulated = await ImageManipulator.manipulateAsync(
      res.assets[0].uri,
      [{ resize: { width } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { uri: await durableUri(manipulated.uri) };
  } catch {
    return {
      error: fromCamera
        ? Platform.OS === 'web'
          ? 'Taking a photo is not supported in this browser. Use Library instead, or open NiblGo on your phone.'
          : 'Could not open the camera. Try again, or pick a photo from your library.'
        : 'Could not open your photo library. Please try again.',
    };
  }
}

/**
 * On web the manipulator can hand back a `blob:` URL, which is scoped to the
 * page session — fine for an immediate upload, useless once demo mode stores
 * it and the tab reloads. Inline it as a data URL so it survives.
 */
async function durableUri(uri: string): Promise<string> {
  if (!uri.startsWith('blob:')) return uri;
  try {
    const blob = await (await fetch(uri)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}
