import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEMO_MODE } from '../config';
import { AvatarPicker } from '../components/AvatarPicker';
import { TimePickerModal } from '../components/TimePickerModal';
import { Button, Card, Input, Muted, ScreenTitle } from '../components/ui';
import { LIMITS } from '../lib/limits';
import { formatTime, MEAL_REMINDER_SLOTS, timeFor } from '../lib/mealTimes';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { fonts, makeStyles, radius, spacing, ThemeMode, useColors, useTheme } from '../theme';
import { MealReminderSlot } from '../types';

const MEAL_LABELS: Record<MealReminderSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

export type SettingsSection = 'profile' | 'notifications' | 'appearance' | 'privacy' | 'account';

const APPEARANCE: { mode: ThemeMode; label: string; icon: any }[] = [
  { mode: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { mode: 'light', label: 'Light', icon: 'sunny-outline' },
  { mode: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export function SettingsScreen({ navigation, route }: any) {
  const styles = useStyles();
  const colors = useColors();
  const { mode, setMode } = useTheme();
  const { user, setUser, prefs, setPrefs, refreshMe } = useApp();
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [followsPrivate, setFollowsPrivate] = useState(Boolean(user?.follows_private));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingSlot, setEditingSlot] = useState<MealReminderSlot | null>(null);

  // Section anchors: the drawer can deep-link to a section, so remember where
  // each one lands and scroll there once the layout is known.
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<SettingsSection, number>>>({});
  const target: SettingsSection | undefined = route?.params?.section;

  const rememberOffset = (key: SettingsSection) => (e: LayoutChangeEvent) => {
    offsets.current[key] = e.nativeEvent.layout.y;
  };

  useEffect(() => {
    if (!target) return;
    // One frame after layout, so the measured offsets exist.
    const t = setTimeout(() => {
      const y = offsets.current[target];
      if (y !== undefined) {
        scrollRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [target]);

  const toggleFollowsPrivate = async () => {
    const next = !followsPrivate;
    setFollowsPrivate(next);
    await svc.updateProfile({ follows_private: next });
    await refreshMe();
  };

  const changeAvatar = async (localUri: string) => {
    await svc.setAvatar(localUri);
    await refreshMe();
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await svc.updateProfile({ display_name: displayName.trim(), bio: bio.trim() });
      await refreshMe();
    } finally {
      setSaving(false);
    }
  };

  const togglePref = (key: MealReminderSlot) => {
    setPrefs({ ...prefs, [key]: !prefs[key] });
  };

  /**
   * Save a new reminder time. Turning a reminder's time on implies wanting the
   * reminder, so picking a time also enables the slot if it was off.
   */
  const setMealTime = (slot: MealReminderSlot, next: string) => {
    setPrefs({
      ...prefs,
      [slot]: true,
      times: { ...(prefs.times ?? {}), [slot]: next },
    });
  };

  const deleteAccount = async () => {
    await svc.deleteAccount();
    setUser(null);
  };

  const askDelete = () => {
    setConfirmDelete(true);
  };

  return (
    <ScrollView
      keyboardDismissMode="on-drag"
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: colors.cream }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.headerRow}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.amberDark} />
          <Text style={styles.back}>Back</Text>
        </Pressable>
      </View>
      <ScreenTitle>Settings</ScreenTitle>
      {DEMO_MODE ? (
        <Muted style={{ marginTop: 4 }}>
          Demo mode: data lives on this device only. See SETUP_GUIDE.md to connect the
          live backend.
        </Muted>
      ) : null}

      <Text style={styles.section} onLayout={rememberOffset('profile')}>
        Profile
      </Text>
      <Card>
        <AvatarPicker user={user} onPick={changeAvatar} />
        <Input
          label="Display name"
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={LIMITS.displayName}
        />
        <Input label="Bio" value={bio} onChangeText={setBio} multiline maxLength={LIMITS.bio} />
        <Button title="Save profile" onPress={saveProfile} loading={saving} />
      </Card>

      <Text style={styles.section} onLayout={rememberOffset('notifications')}>
        Mealtime notifications
      </Text>
      <Card>
        {MEAL_REMINDER_SLOTS.map((slot, i) => (
          <PrefRow
            key={slot}
            slot={slot}
            label={MEAL_LABELS[slot]}
            value={prefs[slot]}
            time={timeFor(prefs, slot)}
            onChange={() => togglePref(slot)}
            onPressTime={() => setEditingSlot(slot)}
            last={i === MEAL_REMINDER_SLOTS.length - 1}
          />
        ))}
        <Muted style={{ marginTop: spacing.md }}>
          Tap a time to change it. Reminders follow your phone's timezone, so
          they stay right when you travel. Snacks never send reminders.
          {Platform.OS === 'web' ? ' Notifications are mobile-only.' : ''}
        </Muted>
      </Card>

      <TimePickerModal
        visible={editingSlot !== null}
        value={editingSlot ? timeFor(prefs, editingSlot) : '12:00'}
        title={editingSlot ? `${MEAL_LABELS[editingSlot]} reminder` : 'Reminder time'}
        onSelect={(next) => editingSlot && setMealTime(editingSlot, next)}
        onClose={() => setEditingSlot(null)}
      />

      <Text style={styles.section} onLayout={rememberOffset('appearance')}>
        Appearance
      </Text>
      <Card>
        <View style={styles.segment} role="radiogroup">
          {APPEARANCE.map((o) => {
            const on = mode === o.mode;
            return (
              <Pressable
                key={o.mode}
                testID={`appearance-${o.mode}`}
                onPress={() => setMode(o.mode)}
                style={[styles.segBtn, on && styles.segBtnOn]}
                role="radio"
                aria-checked={on}
              >
                <Ionicons
                  name={o.icon}
                  size={17}
                  color={on ? colors.amberDark : colors.cocoaSoft}
                />
                <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Muted style={{ marginTop: spacing.md }}>
          System follows your phone, so NiblGo goes dark when your phone does
        </Muted>
      </Card>

      <Text style={styles.section} onLayout={rememberOffset('privacy')}>
        Privacy
      </Text>
      <Card>
        <PrefRow
          label="Private follower list"
          value={followsPrivate}
          onChange={toggleFollowsPrivate}
          last
        />
        <Muted style={{ marginTop: spacing.md }}>
          When on, people can still tap your followers and following counts, but the
          names stay hidden and they see a private notice instead.
        </Muted>
      </Card>

      <Text style={styles.section} onLayout={rememberOffset('account')}>
        Account
      </Text>
      <Card>
        {confirmDelete ? (
          <View>
            <Text style={styles.dangerText}>
              Really delete your account, posts, recipes, and streaks? No undo.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => setConfirmDelete(false)}
                style={{ flex: 1 }}
              />
              <Button
                title="Delete"
                variant="danger"
                onPress={deleteAccount}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <Button title="Delete account" variant="danger" onPress={askDelete} />
        )}
      </Card>


      <View style={{ height: spacing.xl }} />
      <Button
        title="Sign out"
        variant="ghost"
        onPress={async () => {
          await svc.signOut();
          setUser(null);
        }}
      />
      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

function PrefRow({
  label,
  value,
  onChange,
  last,
  slot,
  time,
  onPressTime,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
  last?: boolean;
  /** Present only on the mealtime rows, which carry an editable time. */
  slot?: MealReminderSlot;
  time?: string;
  onPressTime?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.prefRow, !last && styles.prefRowBorder]}>
      <Text style={styles.prefLabel}>{label}</Text>
      <View style={styles.prefRight}>
        {time && onPressTime ? (
          <Pressable
            testID={`meal-time-${slot}`}
            onPress={onPressTime}
            // Dim the time when the reminder is off: it still shows what it
            // would be, but it clearly isn't doing anything right now.
            style={[styles.timePill, !value && styles.timePillOff]}
          >
            <Text style={[styles.timePillText, !value && styles.timePillTextOff]}>
              {formatTime(time)}
            </Text>
          </Pressable>
        ) : null}
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: colors.creamDark, true: colors.amber }}
          thumbColor={colors.white}
          {...(Platform.OS === 'web' ? ({ activeThumbColor: colors.white } as object) : {})}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors, { shadowSoft }) => ({
  scroll: {
    padding: spacing.lg,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    marginBottom: spacing.sm,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    marginLeft: -4,
  },
  back: {
    fontFamily: fonts.bold,
    color: colors.amberDark,
    fontSize: 15,
  },
  section: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.creamDark,
    borderRadius: radius.pill,
    padding: 4,
  },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  segBtnOn: { backgroundColor: colors.raised, ...(shadowSoft as object) },
  segText: { fontFamily: fonts.bold, fontSize: 14, color: colors.cocoaSoft },
  segTextOn: { color: colors.amberDark },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  prefRowBorder: {
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  prefRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  timePill: {
    backgroundColor: colors.cream,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.creamDark,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  timePillOff: {
    opacity: 0.5,
  },
  timePillText: {
    fontFamily: fonts.bold,
    fontSize: 13.5,
    color: colors.amberDark,
  },
  timePillTextOff: {
    color: colors.cocoaFaint,
  },
  prefLabel: {
    fontFamily: fonts.semi,
    fontSize: 15.5,
    color: colors.cocoa,
  },
  dangerText: {
    fontFamily: fonts.bold,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
}));
