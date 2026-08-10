import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, shadow, spacing } from '../theme';

type Item = {
  key: string;
  label: string;
  hint: string;
  icon: any;
  onPress: () => void;
  danger?: boolean;
};

type Section = { title: string; items: Item[] };

/**
 * The side panel behind the profile's menu button.
 *
 * Slides in from the right over a dimmed backdrop, grouped into sections
 * (Your activity / Settings) the way Instagram's profile menu is. Built on a
 * plain Modal rather than a navigation drawer: it is only reachable from one
 * screen, and a drawer navigator would restructure the whole tab tree.
 */
export function ActivityDrawer({
  visible,
  onClose,
  sections,
}: {
  visible: boolean;
  onClose: () => void;
  sections: Section[];
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallow taps inside the panel so it doesn't close itself. */}
        <Pressable
          testID="activity-drawer"
          style={[styles.panel, { paddingTop: insets.top + spacing.md }]}
          onPress={() => {}}
        >
          <View style={styles.head}>
            <Text style={styles.title}>Your stuff</Text>
            <Pressable testID="drawer-close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.cocoaSoft} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
            {sections.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.items.map((item) => (
                  <Pressable
                    key={item.key}
                    testID={`drawer-${item.key}`}
                    onPress={() => {
                      onClose();
                      item.onPress();
                    }}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  >
                    <View style={[styles.iconWrap, item.danger && styles.iconWrapDanger]}>
                      <Ionicons
                        name={item.icon}
                        size={18}
                        color={item.danger ? colors.danger : colors.amberDark}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.label, item.danger && { color: colors.danger }]}>
                        {item.label}
                      </Text>
                      <Text style={styles.hint}>{item.hint}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={colors.cocoaFaint} />
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  panel: {
    width: '82%',
    maxWidth: 360,
    height: '100%',
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    ...(shadow as object),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.cocoa },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.cocoaSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapDanger: { backgroundColor: 'rgba(201, 79, 46, 0.12)' },
  label: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.cocoa },
  hint: { fontFamily: fonts.semi, fontSize: 12.5, color: colors.cocoaFaint, marginTop: 1 },
});
