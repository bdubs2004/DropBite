import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

const PANEL_WIDTH = Math.min(Dimensions.get('window').width * 0.82, 360);
/** Drag this far right, or flick fast enough, and the panel closes. */
const DISMISS_DISTANCE = PANEL_WIDTH * 0.35;
const DISMISS_VELOCITY = 0.5;

/**
 * The side panel behind the profile's menu button.
 *
 * Slides in from the right and can be dragged back out with a finger — the
 * panel follows the drag, snapping open or closed on release depending on how
 * far and how fast you moved. Built on a Modal plus PanResponder rather than a
 * drawer navigator, which would mean restructuring the whole tab tree for a
 * panel that only one screen opens.
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
  // 0 = fully open, PANEL_WIDTH = fully off-screen to the right.
  const slide = useRef(new Animated.Value(PANEL_WIDTH)).current;

  const openPanel = () =>
    Animated.timing(slide, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

  const closePanel = (then?: () => void) =>
    Animated.timing(slide, {
      toValue: PANEL_WIDTH,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) then?.();
    });

  useEffect(() => {
    if (visible) {
      slide.setValue(PANEL_WIDTH);
      openPanel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismiss = () => closePanel(onClose);

  const pan = useRef(
    PanResponder.create({
      // Only claim the gesture for clear horizontal drags, so vertical
      // scrolling inside the panel still works.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        // Rightward only; resist leftward pulls past the open position.
        slide.setValue(Math.max(0, g.dx));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx > DISMISS_DISTANCE || g.vx > DISMISS_VELOCITY) dismiss();
        else openPanel();
      },
    }),
  ).current;

  const backdropOpacity = slide.interpolate({
    inputRange: [0, PANEL_WIDTH],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdropFill, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
        </Animated.View>

        <Animated.View
          testID="activity-drawer"
          style={[
            styles.panel,
            { paddingTop: insets.top + spacing.md, transform: [{ translateX: slide }] },
          ]}
          {...pan.panHandlers}
        >
          <View style={styles.head}>
            <Text style={styles.title}>Your stuff</Text>
            <Pressable testID="drawer-close" onPress={dismiss} hitSlop={10}>
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
                    onPress={() => closePanel(() => {
                      onClose();
                      item.onPress();
                    })}
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
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  panel: {
    width: PANEL_WIDTH,
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
