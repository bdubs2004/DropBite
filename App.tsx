import {
  Baloo2_600SemiBold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoMark } from './src/components/Logo';
import { AuthScreen } from './src/screens/AuthScreen';
import { CommentsScreen } from './src/screens/CommentsScreen';
import { ComposeScreen } from './src/screens/ComposeScreen';
import { FeedScreen } from './src/screens/FeedScreen';
import { DiscoverScreen } from './src/screens/DiscoverScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { InboxScreen } from './src/screens/InboxScreen';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { NewMessageScreen } from './src/screens/NewMessageScreen';
import { ShareSheetScreen } from './src/screens/ShareSheetScreen';
import { PostDetailScreen } from './src/screens/PostDetailScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import { SavedScreen } from './src/screens/SavedScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { UserListScreen } from './src/screens/UserListScreen';
import { AppProvider, useApp } from './src/state/AppContext';
import { APP_LINK_BASE } from './src/config';
import { LINK_PATHS } from './src/lib/links';
import { colors, fonts, radius, shadow } from './src/theme';

/**
 * Deep links. A shared post URL opens straight to that post.
 *
 * Three URL forms all resolve here:
 *   nibl://post/<id>            custom scheme — works on device today
 *   https://<domain>/post/<id>  needs the domain's association files hosted
 *                               (see SETUP_GUIDE.md); until then it opens the
 *                               web build, which routes the same way
 *   /post/<id>                  the web build's own route
 */
const linking: LinkingOptions<any> = {
  prefixes: [Linking.createURL('/'), 'nibl://', APP_LINK_BASE],
  config: {
    screens: {
      Tabs: {
        screens: {
          Feed: 'feed',
          Discover: 'discover',
          Search: 'search',
          Profile: 'me',
        },
      },
      PostDetail: LINK_PATHS.post,
      UserProfile: LINK_PATHS.user,
      Inbox: 'inbox',
      Leaderboard: 'streaks',
    },
  },
};

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const tabs = [
    { name: 'Feed', icon: 'home-outline', iconActive: 'home', label: 'Home' },
    { name: 'Discover', icon: 'compass-outline', iconActive: 'compass', label: 'Discover' },
    { name: '__post', icon: 'add', iconActive: 'add', label: '' },
    { name: 'Search', icon: 'search-outline', iconActive: 'search', label: 'Search' },
    { name: 'Profile', icon: 'person-outline', iconActive: 'person', label: 'Profile' },
  ] as const;
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {tabs.map((t) => {
        if (t.name === '__post') {
          return (
            <Pressable
              key={t.name}
              testID="tab-post"
              style={styles.postBtn}
              onPress={() => navigation.getParent()?.navigate('Compose')}
            >
              <Ionicons name="add" size={30} color={colors.white} />
            </Pressable>
          );
        }
        const idx = state.routes.findIndex((r: any) => r.name === t.name);
        const active = state.index === idx;
        const route = state.routes[idx];
        // A custom tabBar doesn't emit `tabPress` for free, so do it here the
        // way the stock bar does. Screens listen for it to scroll to top and
        // refresh when you tap the tab you're already on (Instagram-style).
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route?.key,
            canPreventDefault: true,
          });
          if (!active && !event.defaultPrevented) navigation.navigate(t.name);
        };
        return (
          <Pressable
            key={t.name}
            testID={`tab-${t.name}`}
            style={styles.tabItem}
            onPress={onPress}
          >
            <Ionicons
              name={active ? t.iconActive : t.icon}
              size={23}
              color={active ? colors.amberDark : colors.cocoaFaint}
            />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="Discover" component={DiscoverScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { booted, user } = useApp();
  if (!booted) {
    return (
      <View style={styles.splash}>
        <LogoMark size={96} />
        <Text style={styles.splashWord}>nibl</Text>
      </View>
    );
  }
  if (!user) return <AuthScreen />;
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen
        name="Compose"
        component={ComposeScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="Comments"
        component={CommentsScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="Report"
        component={ReportScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
      <Stack.Screen name="Inbox" component={InboxScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen
        name="NewMessage"
        component={NewMessageScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen
        name="ShareSheet"
        component={ShareSheetScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="UserProfile" component={ProfileScreen} />
      <Stack.Screen name="UserList" component={UserListScreen} />
      <Stack.Screen name="Saved" component={SavedScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Baloo2_800ExtraBold,
    Baloo2_600SemiBold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });
  if (!fontsLoaded) {
    return <View style={styles.splash} />;
  }
  return (
    <SafeAreaProvider>
      <AppProvider>
        <NavigationContainer linking={linking}>
          <StatusBar style="dark" />
          <Root />
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashWord: {
    fontFamily: fonts.wordmark,
    fontSize: 34,
    color: colors.cocoa,
    marginTop: 12,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 10,
    paddingHorizontal: 8,
    ...(shadow as object),
  },
  tabItem: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 2,
    minWidth: 62,
  },
  tabLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.cocoaFaint,
    marginTop: 2,
  },
  tabLabelActive: {
    color: colors.amberDark,
  },
  postBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -26,
    borderWidth: 4,
    borderColor: colors.cream,
    ...(shadow as object),
  },
});
