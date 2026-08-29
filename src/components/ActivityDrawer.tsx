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
 * Slides in from the right, and the grab handle on its left edge drags it back
 * out — the panel follows your finger and snaps open or closed on release
 * depending on distance and flick speed.
 *
 * The gesture lives on the handle rather than the whole panel on purpose. When
 * the whole panel was draggable, starting a drag on top of a menu row also
 * fired that row (react-native-web does not cancel a child Pressable when the
 * responder is claimed), so you would get dragged somewhere you never tapped.
 * A dedicated handle makes that impossible.
 *
 * Built on a Modal plus PanResponder rather than a drawer navigator, which
 * would mean restructuring the whole tab tree for a panel one screen opens.
 * Tapping the backdrop or the X closes it on every platform.
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

  /**
   * True while a drag is in flight and briefly after it ends.
   *
   * Claiming the pan responder does not reliably cancel a child Pressable's
   * press state on web, so without this, dragging the panel closed from on top
   * of a row also fires that row's onPress and navigates you somewhere you
   * never tapped.
   */
  const dragging = useRef(false);

  const pan = useRef(
    PanResponder.create({
      // Only claim the gesture for clear horizontal drags, so vertical
      // scrolling inside the panel still works.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        dragging.current = true;
      },
      onPanResponderMove: (_e, g) => {
        // Rightward only; resist leftward pulls past the open position.
        slide.setValue(Math.max(0, g.dx));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx > DISMISS_DISTANCE || g.vx > DISMISS_VELOCITY) dismiss();
        else openPanel();
        // Outlast the click event the browser synthesises on release.
        setTimeout(() => {
          dragging.current = false;
        }, 120);
      },
      onPanResponderTerminate: () => {
        openPanel();
        setTimeout(() => {
          dragging.current = false;
        }, 120);
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
        >
          {/* Drag handle: the only surface that owns the pan gesture. */}
          <View style={styles.grabZone} {...pan.panHandlers}>
            <View style={styles.grabBar} />
          </View>

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
                    onPress={() => {
                      // Swallow the press if this was the end of a drag.
                      if (dragging.current) return;
                      closePanel(() => {
                        onClose();
                        item.onPress();
                      });
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
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  grabZone: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  grabBar: {
    width: 4,
    height: 56,
    borderRadius: 2,
    backgroundColor: colors.creamDark,
  },
  panel: {
    width: PANEL_WIDTH,
    height: '100%',
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    paddingLeft: spacing.lg + 14,
    paddingRight: spacing.lg,
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
