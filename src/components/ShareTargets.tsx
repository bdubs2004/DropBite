import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { copyText, openMessages, systemShare } from '../lib/share';
import { fonts, spacing, makeStyles, useColors } from '../theme';

export type ShareHow = 'messages' | 'copy' | 'more';

/**
 * A row of round share buttons, the way Instagram and TikTok do it: Messages,
 * Copy link, and More (the phone's share sheet). `text` and `url` are what
 * Messages and More send; `copyValue` is what Copy puts on the clipboard.
 * `onShared` hears about each one that went through.
 */
export function ShareTargets({
  title,
  text,
  url,
  copyValue,
  copyLabel = 'Copy link',
  onShared,
  testIDPrefix = 'share',
}: {
  title: string;
  text: string;
  url?: string;
  copyValue: string;
  copyLabel?: string;
  onShared?: (how: ShareHow) => void;
  testIDPrefix?: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const body = url ? `${text}\n${url}` : text;

  const messages = async () => {
    if (await openMessages(body)) onShared?.('messages');
    // No Messages on this phone: the share sheet has whatever they use instead.
    else if ((await systemShare({ title, message: text, url })) !== 'failed') onShared?.('more');
  };
  const copy = async () => {
    if (!(await copyText(copyValue))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
    onShared?.('copy');
  };
  const more = async () => {
    const r = await systemShare({ title, message: text, url });
    if (r === 'copied') {
      setCopied(true);
      onShared?.('copy');
    } else if (r === 'shared') {
      onShared?.('more');
    }
  };

  const targets = [
    Platform.OS === 'web'
      ? null
      : { key: 'messages', label: 'Messages', icon: 'chatbubble' as const, onPress: messages },
    {
      key: 'copy',
      label: copied ? 'Copied' : copyLabel,
      icon: copied ? ('checkmark' as const) : ('link' as const),
      onPress: copy,
    },
    { key: 'more', label: 'More', icon: 'share-outline' as const, onPress: more },
  ].filter(Boolean) as { key: string; label: string; icon: any; onPress: () => void }[];

  return (
    <View style={styles.row}>
      {targets.map((t) => (
        <Pressable
          key={t.key}
          testID={`${testIDPrefix}-${t.key}`}
          onPress={t.onPress}
          accessibilityRole="button"
          accessibilityLabel={t.label}
          style={({ pressed }) => [styles.target, pressed && { opacity: 0.7 }]}
        >
          <View style={[styles.circle, t.key === 'copy' && copied && styles.circleDone]}>
            <Ionicons
              name={t.icon}
              size={22}
              color={t.key === 'copy' && copied ? colors.onAmber : colors.cocoa}
            />
          </View>
          <Text style={styles.label} numberOfLines={1}>
            {t.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  target: { alignItems: 'center', width: 76 },
  circle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.creamDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleDone: { backgroundColor: colors.success },
  label: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.cocoaSoft,
    marginTop: 6,
    textAlign: 'center',
  },
}));
