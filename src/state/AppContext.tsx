import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getDataService } from '../services';
import { syncMealtimeNotifications } from '../services/notifications';
import { NotificationPrefs, Post, Streak, User } from '../types';

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

  const refreshFeed = useCallback(async () => {
    if (!user) return;
    setFeedLoading(true);
    try {
      const [posts, s] = await Promise.all([svc.getFeed(), svc.getStreak(user.id)]);
      setFeed(posts);
      setStreak(s);
    } finally {
      setFeedLoading(false);
    }
  }, [user, svc]);

  const refreshMe = useCallback(async () => {
    const u = await svc.getCurrentUser();
    setUser(u);
  }, [svc]);

  useEffect(() => {
    (async () => {
      try {
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
      syncMealtimeNotifications(prefs);
    } else {
      setFeed([]);
      setStreak(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const setPrefs = useCallback(
    async (p: NotificationPrefs) => {
      setPrefsState(p);
      await svc.setNotificationPrefs(p);
      await syncMealtimeNotifications(p);
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
    }),
    [booted, user, feed, feedLoading, streak, prefs, refreshFeed, refreshMe, setPrefs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
