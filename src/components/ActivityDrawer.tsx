import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  drawerTranslate,
  isHorizontalDrag,
  shouldCloseDrawer,
} from '../lib/drawerGesture';
import { fonts, radius, spacing, makeStyles, useColors } from '../theme';

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

/**
 * The side panel behind the profile's menu button.
 *
 * Slides in from the right. A sideways drag from anywhere (a row, the empty
 * space around and between rows, the header, or the dimmed area to its left)
 * slides it back out: the panel follows your finger and snaps open or closed on
 * release depending on distance and flick speed. The `dragging` guard below
 * keeps a drag that started on a row from also firing that row.
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
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // 0 = fully open, PANEL_WIDTH = fully off-screen to the right.
  const slide = useRef(new Animated.Value(PANEL_WIDTH)).current;

  const openPanel = () =>
    // Spring, not a linear timing, so snapping back reads as alive rather than
    // stiff — a little give when you let go.
    Animated.spring(slide, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 70,
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
      // A fresh open starts clean: a drag that was cut off last time (the
      // panel closed under your finger) must not leave every row ignoring taps.
      dragging.current = false;
      slide.setValue(PANEL_WIDTH);
      openPanel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismiss = () => closePanel(onClose);

  /**
   * The row you tapped, waiting for the panel to be fully gone.
   *
   * The panel is a Modal. On iOS, opening a page while that Modal is still
   * being taken down can be silently dropped, so tapping a row (Blocked
   * accounts, say) slid the panel away and then nothing opened. iOS reports
   * when the Modal has actually gone (`onDismiss`), so the page opens then.
   * The timer is a backstop in case that report never comes; whichever runs
   * first clears the slot, so the page only ever opens once.
   */
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const go = pending.current;
    pending.current = null;
    go?.();
  };
  const openItem = (item: Item) => {
    pending.current = item.onPress;
    onClose();
    if (Platform.OS === 'ios') setTimeout(runPending, 500);
    else runPending();
  };

  /**
   * True while a drag is in flight and briefly after it ends.
   *
   * Claiming the pan responder does not reliably cancel a child Pressable's
   * press state on web, so without this, dragging the panel closed from on top
   * of a row also fires that row's onPress and navigates you somewhere you
   * never tapped.
   */
  const dragging = useRef(false);

  // ONE responder on the root (the dimmed area to the left + the whole panel),
  // claiming clear horizontal drags in the capture phase so it wins over
  // whatever owns the touch underneath.
  //
  // Why empty space used to feel dead: a row is a Pressable, so it OWNS the
  // touch from touch-down, and this capture can take it over on the first
  // sideways move — that's why rows always dragged. Empty space owned nothing,
  // so on iOS the menu's native ScrollView grabbed the finger and cancelled the
  // JS touch before a sideways move was ever seen. The fix is `touchSink`
  // below: empty space now claims the touch at touch-down exactly like a row
  // does (and readily hands it over), so it behaves like a row.
  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => isHorizontalDrag(g.dx, g.dy),
      onMoveShouldSetPanResponderCapture: (_e, g) => isHorizontalDrag(g.dx, g.dy),
      // Once you're sliding the drawer, keep it — don't let anything else
      // (a row, the scroll view) take the finger back mid-drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragging.current = true;
      },
      onPanResponderMove: (_e, g) => {
        // Track the finger 1:1, exactly like dragging the comments sheet: follow
        // it toward closed and back toward open, clamped at 0 so it never pulls
        // past fully-open. Hold and slide it over and back freely.
        slide.setValue(drawerTranslate(g.dx));
      },
      onPanResponderRelease: (_e, g) => {
        if (shouldCloseDrawer(g.dx, g.vx, PANEL_WIDTH)) dismiss();
        else openPanel();
        // Outlast the click event the browser synthesises on release, so the
        // drag that just ended doesn't also fire a menu row.
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

  // Only wrap the menu in a ScrollView when it's taller than the space it has
  // (a small phone). Otherwise it's a plain View, so nothing native competes
  // with the drag. Measured: the box's height vs the content's height.
  const [boxH, setBoxH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const needsScroll = boxH > 0 && contentH > boxH + 1;

  // Makes a plain area own the touch from touch-down (like a row does) while
  // happily handing it to the drawer drag or the scroll view. See `drag` above.
  const touchSink = {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => true,
  };

  const backdropOpacity = slide.interpolate({
    inputRange: [0, PANEL_WIDTH],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={dismiss}
      onDismiss={runPending}
    >
      <View testID="drawer-root" style={styles.root} {...drag.panHandlers}>
        <Animated.View style={[styles.backdropFill, { opacity: backdropOpacity }]}>
          <Pressable
            testID="drawer-backdrop"
            style={StyleSheet.absoluteFill}
            onPress={() => {
              // A drag that started here slid the drawer; don't also dismiss.
              if (dragging.current) return;
              dismiss();
            }}
          />
        </Animated.View>

        <Animated.View
          testID="activity-drawer"
          {...touchSink}
          style={[
            styles.panel,
            { paddingTop: insets.top + spacing.md, transform: [{ translateX: slide }] },
          ]}
        >
          {/* Drag horizontally anywhere — on the panel, between rows, or on the
              dimmed area to its left — to slide it, same feel as the comments
              sheet but sideways. The tab on the left edge is just the visible
              affordance. The dragging guard keeps a drag that ends on a row
              from also firing it. */}
          <View style={styles.grabZone} pointerEvents="none">
            <View style={styles.grabBar} />
          </View>

          <View style={styles.head}>
            <Text style={styles.title}>Your stuff</Text>
            <Pressable testID="drawer-close" onPress={dismiss} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.cocoaSoft} />
            </Pressable>
          </View>

          <View style={{ flex: 1 }} onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}>
          {(() => {
            const content = (
              <View
                testID="drawer-content"
                {...touchSink}
                onLayout={(e) => setContentH(e.nativeEvent.layout.height)}
                style={{ paddingBottom: insets.bottom + spacing.xl }}
              >
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
                      closePanel(() => openItem(item));
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
              </View>
            );
            return needsScroll ? <ScrollView>{content}</ScrollView> : content;
          })()}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors, { shadow }) => ({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // No dim: just a tap-outside-to-close area. The panel's shadow sets it apart.
  },
  grabZone: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  grabBar: {
    width: 5,
    height: 60,
    borderRadius: 3,
    backgroundColor: colors.creamDark,
  },
  panel: {
    width: PANEL_WIDTH,
    height: '100%',
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    paddingLeft: spacing.lg + 28,
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
    backgroundColor: colors.card,
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
}));
