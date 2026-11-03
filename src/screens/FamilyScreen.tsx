import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Button, Muted } from '../components/ui';
import { getDataService } from '../services';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';
import { FamilyInviteResult, FamilyState } from '../types';

const INVITE_RESULT: Record<FamilyInviteResult, string> = {
  ok: 'Invite sent',
  not_found: 'No one has that handle',
  self: 'That one is you',
  already: 'They are already in or invited',
  full: 'A family can have 12 people',
};

/**
 * Who shares your meal plan. Make a family and you're its admin: what you add
 * goes straight on the plan and you have the last word on everything else.
 * Invites you've been sent wait here too.
 */
export function FamilyScreen({ navigation }: any) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const svc = getDataService();
  const [state, setState] = useState<FamilyState | null>(null);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await svc.getFamily());
    } catch (e: any) {
      setError(e?.message ?? 'Could not load your family');
    }
  }, [svc]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save that');
    } finally {
      setBusy(false);
      setConfirming(false);
      load();
    }
  };

  const invite = () =>
    act(async () => {
      const r = await svc.inviteToFamily(handle);
      setNote(INVITE_RESULT[r]);
      if (r === 'ok') setHandle('');
    });

  const fam = state?.family;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.side}>
          <Ionicons name="chevron-back" size={22} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {fam?.name ?? 'Family'}
        </Text>
        <View style={styles.side} />
      </View>

      {!state ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <Text testID="family-error" style={styles.error}>
              {error}
            </Text>
          ) : null}

          {!fam && state.invites.length ? (
            <>
              <Text style={styles.section}>Invites</Text>
              {state.invites.map((inv) => (
                <View key={inv.family.id} testID={`family-invite-${inv.family.id}`} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {inv.family.name}
                    </Text>
                    {inv.invited_by ? <Muted>From {inv.invited_by.display_name}</Muted> : null}
                  </View>
                  <Button
                    small
                    testID={`family-accept-${inv.family.id}`}
                    title="Join"
                    onPress={() => act(() => svc.respondFamilyInvite(inv.family.id, true))}
                    disabled={busy}
                  />
                  <Button
                    small
                    variant="secondary"
                    testID={`family-decline-${inv.family.id}`}
                    title="Decline"
                    onPress={() => act(() => svc.respondFamilyInvite(inv.family.id, false))}
                    disabled={busy}
                  />
                </View>
              ))}
            </>
          ) : null}

          {!fam ? (
            <>
              <Text style={styles.section}>Start a family</Text>
              <Muted style={styles.lead}>
                Share one meal plan. You run it: what you add goes straight on, and you okay
                everyone else's picks
              </Muted>
              <View style={styles.inputRow}>
                <TextInput
                  testID="family-name"
                  keyboardAppearance={colors.dark ? 'dark' : 'light'}
                  value={name}
                  onChangeText={setName}
                  placeholder="The Smiths"
                  placeholderTextColor={colors.cocoaFaint}
                  style={styles.input}
                  maxLength={40}
                  returnKeyType="done"
                  onSubmitEditing={() => name.trim() && act(() => svc.createFamily(name))}
                />
                <Button
                  small
                  testID="family-create"
                  title="Create"
                  onPress={() => act(() => svc.createFamily(name))}
                  disabled={!name.trim() || busy}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.section}>People</Text>
              {state.members.map((m) => (
                <View key={m.user.id} testID={`family-member-${m.user.id}`} style={styles.row}>
                  <Avatar user={m.user} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.user.display_name}
                    </Text>
                    <Muted>
                      {m.is_admin ? 'Admin' : m.status === 'invited' ? 'Invited' : `@${m.user.handle}`}
                    </Muted>
                  </View>
                  {state.am_admin && !m.is_admin ? (
                    <Pressable
                      testID={`family-remove-${m.user.id}`}
                      onPress={() => act(() => svc.removeFamilyMember(m.user.id))}
                      hitSlop={8}
                      accessibilityLabel={`Remove ${m.user.display_name}`}
                    >
                      <Text style={styles.remove}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {state.am_admin ? (
                <>
                  <Text style={styles.section}>Invite someone</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      testID="family-handle"
                      keyboardAppearance={colors.dark ? 'dark' : 'light'}
                      value={handle}
                      onChangeText={(t) => {
                        setHandle(t);
                        setNote(null);
                      }}
                      placeholder="@handle"
                      placeholderTextColor={colors.cocoaFaint}
                      style={styles.input}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="send"
                      onSubmitEditing={() => handle.trim() && invite()}
                    />
                    <Button
                      small
                      testID="family-invite"
                      title="Invite"
                      onPress={invite}
                      disabled={!handle.trim() || busy}
                    />
                  </View>
                  {note ? (
                    <Text testID="family-note" style={styles.note}>
                      {note}
                    </Text>
                  ) : null}
                </>
              ) : null}

              <View style={styles.footer}>
                {confirming ? (
                  <View style={{ gap: spacing.sm }}>
                    <Text style={styles.confirmText}>
                      {state.am_admin
                        ? `Delete ${fam.name}? Everyone goes back to their own plan and this plan is gone`
                        : `Leave ${fam.name}? You go back to your own plan`}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <Button
                        testID="family-confirm"
                        variant="danger"
                        title={state.am_admin ? 'Delete' : 'Leave'}
                        onPress={() => act(() => (state.am_admin ? svc.deleteFamily() : svc.leaveFamily()))}
                        loading={busy}
                        style={{ flex: 1 }}
                      />
                      <Button
                        variant="secondary"
                        title="Cancel"
                        onPress={() => setConfirming(false)}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </View>
                ) : (
                  <Pressable testID="family-leave" onPress={() => setConfirming(true)} style={styles.dangerRow}>
                    <Text style={styles.danger}>{state.am_admin ? 'Delete family' : 'Leave family'}</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  side: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 70 },
  back: { fontFamily: fonts.bold, color: colors.amberDark, fontSize: 15 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.display, fontSize: 18, color: colors.cocoa },
  section: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.cocoaSoft,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  lead: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  name: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  remove: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoaFaint },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontFamily: fonts.semi,
    fontSize: 15.5,
    color: colors.cocoa,
  },
  note: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.cocoaSoft,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  error: {
    fontFamily: fonts.semi,
    fontSize: 13,
    color: colors.danger,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  footer: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  dangerRow: { paddingVertical: spacing.sm },
  danger: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.danger },
  confirmText: { fontFamily: fonts.semi, fontSize: 14, lineHeight: 20, color: colors.cocoa },
}));
