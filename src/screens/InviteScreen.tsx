import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoMark } from '../components/Logo';
import { ShareTargets } from '../components/ShareTargets';
import { GET_APP_URL } from '../config';
import { analytics } from '../lib/analytics';
import { copyText } from '../lib/share';
import { inviteMessage } from '../lib/shareText';
import { useApp } from '../state/AppContext';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';

/**
 * Invite friends: text them the download link with your handle as their
 * invite code. When they sign up with it, the referral is recorded (Power BI's
 * referral numbers). Opened from the profile menu, Discover and an empty feed.
 */
export function InviteScreen({ navigation }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const handle = user?.handle ?? '';
  const [codeCopied, setCodeCopied] = useState(false);

  // Each invite that actually went out counts once.
  const sent = () => analytics().inviteSent();

  const copyCode = async () => {
    if (!handle || !(await copyText(`@${handle}`))) return;
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1800);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="invite-close" onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.cancel}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <LogoMark size={76} />
        <Text style={styles.title}>Invite friends to NiblGo</Text>
        <Text style={styles.sub}>
          Text them the link. NiblGo is free on iPhone, and meals are better with your people
        </Text>

        {handle ? (
          <Pressable
            testID="invite-code"
            onPress={copyCode}
            accessibilityRole="button"
            accessibilityLabel="Copy your invite code"
            style={({ pressed }) => [styles.code, pressed && { opacity: 0.85 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>Your invite code</Text>
              <Text style={styles.codeValue} numberOfLines={1}>
                @{handle}
              </Text>
            </View>
            <View style={[styles.codeCopy, codeCopied && styles.codeCopyDone]}>
              <Ionicons
                name={codeCopied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={codeCopied ? colors.onAmber : colors.amberDark}
              />
              <Text style={[styles.codeCopyText, codeCopied && { color: colors.onAmber }]}>
                {codeCopied ? 'Copied' : 'Copy'}
              </Text>
            </View>
          </Pressable>
        ) : null}
        <Text style={styles.fine}>
          They enter it when they sign up, so we know you brought them
        </Text>
      </View>

      {handle ? (
        <View style={[styles.targets, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <ShareTargets
            title="Join me on NiblGo"
            text={inviteMessage(handle)}
            copyValue={inviteMessage(handle)}
            copyLabel="Copy invite"
            onShared={sent}
            testIDPrefix="invite"
          />
          <Text style={styles.link}>{GET_APP_URL.replace(/^https:\/\//, '')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  cancel: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 16 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.cocoa,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  sub: {
    fontFamily: fonts.semi,
    fontSize: 15,
    lineHeight: 21,
    color: colors.cocoaSoft,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.amber,
    backgroundColor: colors.card,
  },
  codeLabel: {
    fontFamily: fonts.bold,
    fontSize: 11.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.cocoaFaint,
  },
  codeValue: { fontFamily: fonts.display, fontSize: 22, color: colors.cocoa, marginTop: 2 },
  codeCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.creamDark,
  },
  codeCopyDone: { backgroundColor: colors.success },
  codeCopyText: { fontFamily: fonts.bold, fontSize: 14, color: colors.amberDark },
  fine: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.cocoaFaint,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  targets: {
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  link: {
    fontFamily: fonts.semi,
    fontSize: 12.5,
    color: colors.cocoaFaint,
    textAlign: 'center',
    marginTop: spacing.md,
  },
}));
