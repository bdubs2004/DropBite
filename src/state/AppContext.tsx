import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { registerPushToken } from '../lib/push';
import { getDataService } from '../services';
import { syncMealtimeNotifications } from '../services/notifications';
import { NotificationPrefs, Post, Streak, User } from '../types';

/** Posts the viewer has reported/hidden, so their photos stop showing. */
const HIDDEN_KEY = 'niblgo.hiddenPosts';

interface AppState {
  booted: boolean;
  user: User | null;
  feed: Post[];
  feedLoading: boolean;
  streak: Streak | null;
  prefs: NotificationPrefs;
  refreshFeed: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setUser: (u: User | null) => void;
  setPrefs: (p: NotificationPrefs) => Promise<void>;
  /** Hide a post everywhere (e.g. after reporting it). Persists. */
  hidePost: (postId: string) => Promise<void>;
  /** Ids of posts the viewer has hidden, so every list can filter them out. */
  hiddenIds: Set<string>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const svc = getDataService();
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [feed, setFeed] = useState<Post[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [prefs, setPrefsState] = useState<NotificationPrefs>({
    breakfast: true,
    lunch: true,
    dinner: true,
  });
  // Posts the viewer reported/hid, so they stop showing ANYWHERE — feed,
  // Discover, profiles, search, and the post screen itself. State-backed so
  // every screen re-renders the moment one is hidden; a mirroring ref lets
  // refreshFeed read the current set without being rebuilt each change. Loaded
  // from storage on boot so a hidden post stays hidden across app launches.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const hiddenRef = useRef(hiddenIds);
  hiddenRef.current = hiddenIds;

  const refreshFeed = useCallback(async () => {
    if (!user) return;
    setFeedLoading(true);
    try {
      const [posts, s] = await Promise.all([svc.getFeed(), svc.getStreak(user.id)]);
      setFeed(posts.filter((p) => !hiddenRef.current.has(p.id)));
      setStreak(s);
    } finally {
      setFeedLoading(false);
    }
  }, [user, svc]);

  const hidePost = useCallback(async (postId: string) => {
    let nextArr: string[] = [];
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(postId);
      nextArr = [...next];
      return next;
    });
    // Drop it from the feed we're already showing so the photo disappears now,
    // without waiting for a refresh.
    setFeed((prev) => prev.filter((p) => p.id !== postId));
    try {
      await AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify(nextArr));
    } catch {
      // A failed write just means the post reappears on next launch — not worth
      // interrupting the report flow over.
    }
  }, []);

  const refreshMe = useCallback(async () => {
    const u = await svc.getCurrentUser();
    setUser(u);
  }, [svc]);

  useEffect(() => {
    (async () => {
      try {
        // Restore hidden posts before the first feed load so they never flash in.
        try {
          const raw = await AsyncStorage.getItem(HIDDEN_KEY);
          if (raw) setHiddenIds(new Set<string>(JSON.parse(raw)));
        } catch {
          // Ignore a corrupt/missing store — start with nothing hidden.
        }
        const u = await svc.getCurrentUser();
        setUser(u);
        const p = await svc.getNotificationPrefs();
        setPrefsState(p);
      } finally {
        setBooted(true);
      }
    })();
  }, [svc]);

  useEffect(() => {
    if (user) {
      refreshFeed();
    } else {
      setFeed([]);
      setStreak(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /**
   * Reminders follow the saved prefs — and must wait for them to load.
   *
   * `booted` is the gate that matters: the boot effect sets the user before it
   * sets prefs, so syncing on the user alone scheduled the DEFAULT times over
   * whatever the user had chosen. Depending on prefs here also means the
   * settings toggles need no sync call of their own; changing prefs re-runs
   * this. Overlapping runs are safe — syncMealtimeNotifications queues them.
   */
  useEffect(() => {
    if (!booted || !user) return;
    syncMealtimeNotifications(prefs);
  }, [booted, user?.id, prefs]);

  // Register this device for DM push once signed in (best-effort, never blocks).
  useEffect(() => {
    if (!booted || !user) return;
    registerPushToken((token, platform) => svc.savePushToken(token, platform)).catch(() => {});
  }, [booted, user?.id, svc]);

  const setPrefs = useCallback(
    async (p: NotificationPrefs) => {
      setPrefsState(p);
      await svc.setNotificationPrefs(p);
    },
    [svc],
  );

  const value = useMemo(
    () => ({
      booted,
      user,
      feed,
      feedLoading,
      streak,
      prefs,
      refreshFeed,
      refreshMe,
      setUser,
      setPrefs,
      hidePost,
      hiddenIds,
    }),
    [booted, user, feed, feedLoading, streak, prefs, refreshFeed, refreshMe, setPrefs, hidePost, hiddenIds],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
