import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import { User } from '../types';
import { Avatar } from './Avatar';
import { Muted } from './ui';

/**
 * The details panel behind a DM's "…" button: who's in the thread, a mute
 * toggle, and (for a group) Leave group. Slides over as a bottom sheet;
 * tapping a member opens their profile.
 */
export function ConversationDetailsSheet({
  visible,
  title,
  isGroup,
  members,
  muted,
  onToggleMute,
  onLeave,
  onOpenProfile,
  onClose,
}: {
  visible: boolean;
  title: string;
  isGroup: boolean;
  members: User[];
  muted: boolean;
  onToggleMute: (next: boolean) => void;
  /** Leave the group. Only offered for groups. */
  onLeave?: () => Promise<void> | void;
  onOpenProfile: (userId: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Leaving asks once, right here in the sheet (no pop-up).
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!visible) {
      setConfirmLeave(false);
      setLeaving(false);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
          onPress={() => {}}
        >
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Pressable testID="details-close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.cocoaSoft} />
            </Pressable>
          </View>

          <Pressable style={styles.muteRow} onPress={() => onToggleMute(!muted)}>
            <View style={styles.muteIcon}>
              <Ionicons
                name={muted ? 'notifications-off' : 'notifications-outline'}
                size={19}
                color={colors.amberDark}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.muteLabel}>Mute notifications</Text>
              <Muted style={{ fontSize: 12.5 }}>
                {muted ? "You won't be notified about this chat" : 'Get notified about new messages'}
              </Muted>
            </View>
            <Switch
              testID="details-mute"
              value={muted}
              onValueChange={onToggleMute}
              trackColor={{ true: colors.amber, false: colors.creamDark }}
              thumbColor={colors.white}
            />
          </Pressable>

          <Text style={styles.sectionTitle}>
            {isGroup ? `${members.length} members` : 'Members'}
          </Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {members.map((m) => (
              <Pressable
                key={m.id}
                testID={`details-member-${m.id}`}
                style={styles.memberRow}
                onPress={() => onOpenProfile(m.id)}
              >
                <Avatar user={m} size={40} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.display_name}
                  </Text>
                  <Muted>@{m.handle}</Muted>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.cocoaFaint} />
              </Pressable>
            ))}
          </ScrollView>

          {isGroup && onLeave ? (
            confirmLeave ? (
              <View testID="details-leave-confirm" style={styles.leaveConfirm}>
                <Text style={styles.leaveConfirmText}>
                  Leave this group? Everyone in it will see that you left
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Pressable
                    testID="details-leave-cancel"
                    onPress={() => setConfirmLeave(false)}
                    style={[styles.leaveBtn, styles.leaveCancel]}
                  >
                    <Text style={styles.leaveCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    testID="details-leave-yes"
                    disabled={leaving}
                    onPress={async () => {
                      setLeaving(true);
                      try {
                        await onLeave();
                      } finally {
                        setLeaving(false);
                      }
                    }}
                    style={[styles.leaveBtn, styles.leaveYes, leaving && { opacity: 0.6 }]}
                  >
                    <Text style={styles.leaveYesText}>{leaving ? 'Leaving' : 'Leave'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                testID="details-leave"
                style={styles.leaveRow}
                onPress={() => setConfirmLeave(true)}
              >
                <View style={[styles.muteIcon, styles.leaveIcon]}>
                  <Ionicons name="exit-outline" size={19} color={colors.danger} />
                </View>
                <Text style={styles.leaveLabel}>Leave group</Text>
              </Pressable>
            )
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // No dim: tapping above the sheet still closes it.
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    // With nothing dimmed behind it, the shadow is what lifts the sheet.
    ...(shadow as object),
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.creamDark,
    marginBottom: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 18, color: colors.cocoa, marginRight: spacing.md },
  muteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  muteIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: spacing.sm,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  memberName: { fontFamily: fonts.bold, fontSize: 15, color: colors.cocoa },
  leaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  leaveIcon: { backgroundColor: 'rgba(201, 79, 46, 0.12)' },
  leaveLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.danger },
  leaveConfirm: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  leaveConfirmText: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoa },
  leaveBtn: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingVertical: 10,
  },
  leaveCancel: { backgroundColor: colors.creamDark },
  leaveCancelText: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoa },
  leaveYes: { backgroundColor: colors.danger },
  leaveYesText: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
});
