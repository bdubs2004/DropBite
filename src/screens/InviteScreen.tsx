import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShareTargets } from '../components/ShareTargets';
import { analytics } from '../lib/analytics';
import { copyText } from '../lib/share';
import { inviteMessage } from '../lib/shareText';
import { useApp } from '../state/AppContext';
import { fonts, spacing, makeStyles } from '../theme';

/**
 * Invite friends: text them the download link with your handle as their
 * invite code. When they sign up with it, the referral is recorded (Power BI's
 * referral numbers). Opened from the profile menu, Discover and an empty feed.
 */
export function InviteScreen({ navigation }: any) {
  const styles = useStyles();
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
        <View style={{ width: 50 }} />
        <Text style={styles.title}>Invite friends</Text>
        <Pressable testID="invite-close" onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={styles.lead}>
          Send friends the link to get NiblGo. When they sign up, they put your handle in as the
          invite code.
        </Text>
        {handle ? (
          <Pressable
            testID="invite-code"
            onPress={copyCode}
            accessibilityRole="button"
            accessibilityLabel="Copy your invite code"
            style={({ pressed }) => [styles.code, pressed && { opacity: 0.6 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>Your invite code</Text>
              <Text style={styles.codeValue} numberOfLines={1}>
                @{handle}
              </Text>
            </View>
            <Text style={styles.codeCopy}>{codeCopied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        ) : null}
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
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  done: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 16, width: 50, textAlign: 'right' },
  body: { flex: 1, paddingHorizontal: spacing.lg },
  lead: {
    fontFamily: fonts.semi,
    fontSize: 15,
    lineHeight: 21,
    color: colors.cocoaSoft,
  },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  codeLabel: { fontFamily: fonts.semi, fontSize: 13, color: colors.cocoaFaint },
  codeValue: { fontFamily: fonts.bold, fontSize: 20, color: colors.cocoa, marginTop: 2 },
  codeCopy: { fontFamily: fonts.bold, fontSize: 15, color: colors.amberDark },
  targets: {
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
}));
