import {
  Baloo2_600SemiBold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  useFonts,
} from '@expo-google-fonts/nunito';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoMark } from './src/components/Logo';
import { AuthScreen } from './src/screens/AuthScreen';
import { ComposeScreen } from './src/screens/ComposeScreen';
import { FeedScreen } from './src/screens/FeedScreen';
import { FriendsScreen } from './src/screens/FriendsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AppProvider, useApp } from './src/state/AppContext';
import { colors, fonts, radius, shadow } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const tabs = [
    { name: 'Feed', icon: '🏠', label: 'Feed' },
    { name: 'Friends', icon: '🧑‍🤝‍🧑', label: 'Friends' },
    { name: '__post', icon: '+', label: '' },
    { name: 'Profile', icon: '🙂', label: 'Profile' },
  ];
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {tabs.map((t) => {
        if (t.name === '__post') {
          return (
            <Pressable
              key={t.name}
              style={styles.postBtn}
              onPress={() => navigation.getParent()?.navigate('Compose')}
            >
              <Text style={styles.postBtnText}>+</Text>
            </Pressable>
          );
        }
        const idx = state.routes.findIndex((r: any) => r.name === t.name);
        const active = state.index === idx;
        return (
          <Pressable
            key={t.name}
            style={styles.tabItem}
            onPress={() => navigation.navigate(t.name)}
          >
            <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{t.icon}</Text>
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
      <Tab.Screen name="Friends" component={FriendsScreen} />
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
        <Text style={styles.splashWord}>dropbite</Text>
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
      <Stack.Screen name="UserProfile" component={ProfileScreen} />
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
  });
  if (!fontsLoaded) {
    return <View style={styles.splash} />;
  }
  return (
    <SafeAreaProvider>
      <AppProvider>
        <NavigationContainer>
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
    fontFamily: fonts.display,
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
    paddingHorizontal: 18,
    paddingVertical: 2,
  },
  tabIcon: {
    fontSize: 22,
    opacity: 0.45,
  },
  tabIconActive: {
    opacity: 1,
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
  postBtnText: {
    color: colors.white,
    fontSize: 30,
    lineHeight: 34,
    fontFamily: fonts.display,
  },
});
