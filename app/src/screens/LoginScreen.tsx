import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Api, Health, User } from '../api';
import { theme } from '../theme';

export default function LoginScreen({
  server,
  onServerChange,
  onAuthed,
}: {
  server: string;
  onServerChange: (s: string) => void;
  onAuthed: (token: string, user: User) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(server);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveServerAndTest = useCallback(async () => {
    let u = urlDraft.trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    u = u.replace(/\/+$/, '');
    onServerChange(u);
    setUrlDraft(u);
    setChecking(true);
    setHealthErr(null);
    try {
      const h = await new Api(u).health();
      setHealth(h);
      setChecking(false);
      return u;
    } catch (e: any) {
      setHealth(null);
      setHealthErr(e?.message || 'Unreachable');
      setChecking(false);
      return null;
    }
  }, [urlDraft, onServerChange]);

  const submit = async () => {
    setError(null);
    if (!email.trim() || password.length < 6) {
      setError('Enter your email and a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      let base = server;
      if (!health) {
        const ok = await saveServerAndTest();
        if (!ok) throw new Error('Could not reach the server — check the address above.');
        base = ok;
      }
      const api = new Api(base);
      const res = mode === 'signup' ? await api.signup(email.trim(), password) : await api.login(email.trim(), password);
      onAuthed(res.token, res.user);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const connected = !!health && health.ok;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.logo}>⚡ VibeForge</Text>
          <Text style={styles.heroSub}>Turn plain words into working apps</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>1 · Server address</Text>
          <TextInput
            style={styles.input}
            value={urlDraft}
            onChangeText={setUrlDraft}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://your-app.onrender.com  or  http://192.168.1.5:8787"
            placeholderTextColor={theme.sub}
            keyboardType="url"
          />
          <Pressable style={styles.ghostBtn} onPress={saveServerAndTest} disabled={checking}>
            {checking ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <Text style={styles.ghostBtnText}>Test connection</Text>
            )}
          </Pressable>
          {connected ? (
            <Text style={styles.okText}>
              ✓ Server online · AI: {health?.aiConfigured ? 'ready' : 'demo mode'} · payments:{' '}
              {health?.billingConfigured ? 'ready' : 'not set up'}
            </Text>
          ) : healthErr ? (
            <Text style={styles.errText}>{healthErr}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>2 · {mode === 'login' ? 'Log in' : 'Create your account'}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={theme.sub}
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password (6+ characters)"
            placeholderTextColor={theme.sub}
          />
          {error ? <Text style={styles.errText}>{error}</Text> : null}
          <Pressable style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>{mode === 'login' ? 'Log in' : 'Sign up free'}</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
            }}
          >
            <Text style={styles.switchText}>
              {mode === 'login' ? "New here? Create a free account (10 free builds)" : 'Already have an account? Log in'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.tip}>
          <Ionicons name="information-circle-outline" size={16} color={theme.sub} />
          <Text style={styles.tipText}>
            No server yet? Read DEPLOY.md in the project — it takes about 10 minutes, all from your
            phone.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingTop: 40, gap: 14 },
  hero: { alignItems: 'center', marginBottom: 8 },
  logo: { color: theme.text, fontSize: 30, fontWeight: '800' },
  heroSub: { color: theme.sub, fontSize: 14, marginTop: 6 },
  card: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  label: { color: theme.sub, fontSize: 12.5, fontWeight: '700' },
  input: {
    backgroundColor: theme.card2,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: theme.text,
    fontSize: 14.5,
  },
  primaryBtn: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghostBtn: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  ghostBtnText: { color: theme.text, fontWeight: '600', fontSize: 14 },
  okText: { color: theme.green, fontSize: 12.5, lineHeight: 18 },
  errText: { color: theme.red, fontSize: 12.5, lineHeight: 18 },
  switchText: { color: theme.accent, fontSize: 13, textAlign: 'center', marginTop: 6 },
  tip: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, alignItems: 'flex-start' },
  tipText: { color: theme.sub, fontSize: 12.5, lineHeight: 18, flex: 1 },
});
