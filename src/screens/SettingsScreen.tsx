import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEMO_MODE } from '../config';
import { Button, Card, Input, Muted, ScreenTitle } from '../components/ui';
import { getDataService } from '../services';
import { useApp } from '../state/AppContext';
import { colors, fonts, spacing } from '../theme';
import { NotificationPrefs } from '../types';

export function SettingsScreen({ navigation }: any) {
  const { user, setUser, prefs, setPrefs, refreshMe } = useApp();
  const svc = getDataService();
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await svc.updateProfile({ display_name: displayName.trim(), bio: bio.trim() });
      await refreshMe();
    } finally {
      setSaving(false);
    }
  };

  const togglePref = (key: keyof NotificationPrefs) => {
    setPrefs({ ...prefs, [key]: !prefs[key] });
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const json = await svc.exportMyData();
      if (Platform.OS === 'web') {
        // download as a file in the browser
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dropbite-export.json';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: json, title: 'My DropBite data' });
      }
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    await svc.deleteAccount();
    setUser(null);
  };

  const askDelete = () => {
    if (Platform.OS === 'web') {
      setConfirmDelete(true);
      return;
    }
    Alert.alert(
      'Delete account?',
      'This permanently removes your profile, posts, recipes, and streaks. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete everything', style: 'destructive', onPress: deleteAccount },
      ],
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.cream }}
      contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md }]}
    >
      <View style={styles.headerRow}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
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

      <Text style={styles.section}>Profile</Text>
      <Card>
        <Input label="Display name" value={displayName} onChangeText={setDisplayName} />
        <Input label="Bio" value={bio} onChangeText={setBio} multiline />
        <Button title="Save profile" onPress={saveProfile} loading={saving} />
      </Card>

      <Text style={styles.section}>Mealtime notifications</Text>
      <Card>
        <PrefRow
          label="Breakfast, around 8:00 AM"
          value={prefs.breakfast}
          onChange={() => togglePref('breakfast')}
        />
        <PrefRow
          label="Lunch, around 12:00 PM"
          value={prefs.lunch}
          onChange={() => togglePref('lunch')}
        />
        <PrefRow
          label="Dinner, around 6:00 PM"
          value={prefs.dinner}
          onChange={() => togglePref('dinner')}
          last
        />
        <Muted style={{ marginTop: spacing.md }}>
          Times follow your phone's timezone. Snacks never send reminders.
          {Platform.OS === 'web' ? ' Notifications are mobile-only.' : ''}
        </Muted>
      </Card>

      <Text style={styles.section}>Your data</Text>
      <Card>
        <Button
          title={exporting ? 'Exporting…' : 'Export my data (JSON)'}
          variant="secondary"
          onPress={exportData}
          loading={exporting}
        />
        <View style={{ height: spacing.md }} />
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
}: {
  label: string;
  value: boolean;
  onChange: () => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.prefRow, !last && styles.prefRowBorder]}>
      <Text style={styles.prefLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.creamDark, true: colors.amber }}
        thumbColor={colors.white}
        {...(Platform.OS === 'web' ? ({ activeThumbColor: colors.white } as object) : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    marginBottom: spacing.sm,
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
});
