import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Api, ApiError, ProjectSummary, User } from './src/api';
import { theme } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import ChatScreen from './src/screens/ChatScreen';
import PreviewScreen from './src/screens/PreviewScreen';
import CodeScreen from './src/screens/CodeScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const KEY_SERVER = '@vibeforge/server';
const KEY_TOKEN = '@vibeforge/token';
const KEY_PROJECT = '@vibeforge/project';
const DEFAULT_SERVER = 'https://your-app.onrender.com';

type Tab = 'chat' | 'preview' | 'code' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'chatbubbles' },
  { id: 'preview', label: 'Preview', icon: 'phone-portrait' },
  { id: 'code', label: 'Code', icon: 'code-slash' },
  { id: 'settings', label: 'Settings', icon: 'settings-sharp' },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem(KEY_SERVER);
        if (s) setServer(s);
        const t = await AsyncStorage.getItem(KEY_TOKEN);
        if (t) setToken(t);
        const p = await AsyncStorage.getItem(KEY_PROJECT);
        if (p) setProject(JSON.parse(p));
      } catch {}
      setReady(true);
    })();
  }, []);

  const saveServer = useCallback((url: string) => {
    setServer(url);
    AsyncStorage.setItem(KEY_SERVER, url).catch(() => {});
  }, []);

  const api = useMemo(() => new Api(server, token), [server, token]);

  const refreshMe = useCallback(async () => {
    if (!token) return;
    try {
      const d = await api.me();
      setUser(d.user);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) logout();
    }
  }, [api, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (token) refreshMe();
  }, [token, refreshMe]);

  const onAuthed = useCallback((newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    AsyncStorage.setItem(KEY_TOKEN, newToken).catch(() => {});
    setTab('chat');
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setProject(null);
    AsyncStorage.removeItem(KEY_TOKEN).catch(() => {});
    AsyncStorage.removeItem(KEY_PROJECT).catch(() => {});
  }, []);

  const saveProject = useCallback((p: ProjectSummary | null) => {
    setProject(p);
    if (p) {
      AsyncStorage.setItem(KEY_PROJECT, JSON.stringify(p)).catch(() => {});
    } else {
      AsyncStorage.removeItem(KEY_PROJECT).catch(() => {});
    }
  }, []);

  const bump = useCallback(() => {
    setRefreshKey((k) => k + 1);
    refreshMe();
  }, [refreshMe]);

  if (!ready) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
        <LoginScreen server={server} onServerChange={saveServer} onAuthed={onAuthed} />
      </SafeAreaView>
    );
  }

  const planLabel = user?.byok
    ? 'Your key'
    : user
    ? user.plan === 'free'
      ? `Free ${user.usage.used}/${user.usage.limit}`
      : `${user.plan === 'pro' ? 'Pro' : 'Starter'} ${user.usage.used}/${user.usage.limit}`
    : '…';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <View style={styles.header}>
        <Text style={styles.logo}>⚡ VibeForge</Text>
        <Pressable style={styles.chip} onPress={() => setTab('settings')}>
          <Ionicons
            name={user?.plan === 'free' && !user?.byok ? 'sparkles-outline' : 'flash-outline'}
            size={13}
            color={user?.plan === 'free' && !user?.byok ? theme.sub : theme.accent}
          />
          <Text style={[styles.chipText, user?.plan !== 'free' && !user?.byok && { color: theme.accent }]}>
            {planLabel}
          </Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {tab === 'chat' && (
          <ChatScreen api={api} project={project} onProjectReady={saveProject} onProjectChanged={bump} />
        )}
        {tab === 'preview' && <PreviewScreen api={api} project={project} refreshKey={refreshKey} />}
        {tab === 'code' && <CodeScreen api={api} project={project} refreshKey={refreshKey} />}
        {tab === 'settings' && (
          <SettingsScreen
            api={api}
            server={server}
            onServerChange={saveServer}
            project={project}
            onProjectChange={saveProject}
            user={user}
            onUserChange={setUser}
            onRefreshMe={refreshMe}
            onLogout={logout}
          />
        )}
      </View>

      <View style={styles.tabbar}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable key={t.id} style={styles.tab} onPress={() => setTab(t.id)}>
              <Ionicons name={t.icon as any} size={22} color={active ? theme.accent : theme.sub} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  logo: { color: theme.text, fontSize: 18, fontWeight: '700' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  chipText: { color: theme.sub, fontSize: 12, fontWeight: '600' },
  body: { flex: 1 },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, gap: 3 },
  tabLabel: { color: theme.sub, fontSize: 11, fontWeight: '600' },
  tabLabelActive: { color: theme.accent },
});
