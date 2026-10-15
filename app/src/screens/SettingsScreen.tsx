import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Api, Health, Plan, ProjectSummary, User } from '../api';
import { theme } from '../theme';

const BYOK_PROVIDERS = ['anthropic', 'openai', 'openrouter', 'gemini'];

export default function SettingsScreen({
  api,
  server,
  onServerChange,
  project,
  onProjectChange,
  user,
  onUserChange,
  onRefreshMe,
  onLogout,
}: {
  api: Api;
  server: string;
  onServerChange: (s: string) => void;
  project: ProjectSummary | null;
  onProjectChange: (p: ProjectSummary | null) => void;
  user: User | null;
  onUserChange: (u: User | null) => void;
  onRefreshMe: () => void;
  onLogout: () => void;
}) {
  const [urlDraft, setUrlDraft] = useState(server);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [payBusy, setPayBusy] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [byokProvider, setByokProvider] = useState('anthropic');
  const [byokKey, setByokKey] = useState('');
  const [byokBusy, setByokBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setUrlDraft(server);
  }, [server]);

  const check = useCallback(async () => {
    setChecking(true);
    setHealthErr(null);
    try {
      setHealth(await api.health());
    } catch (e: any) {
      setHealth(null);
      setHealthErr(e?.message || 'Unreachable');
    } finally {
      setChecking(false);
    }
  }, [api]);

  const loadProjects = useCallback(async () => {
    try {
      const d = await api.listProjects();
      setProjects(d.projects || []);
    } catch {}
  }, [api]);

  const loadPlans = useCallback(async () => {
    try {
      const d = await api.me();
      setPlans(d.plans || []);
      onUserChange(d.user);
    } catch {}
  }, [api, onUserChange]);

  useEffect(() => {
    check();
    loadProjects();
    loadPlans();
  }, [check, loadProjects, loadPlans, project?.id]);

  const saveUrl = async () => {
    let u = urlDraft.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    u = u.replace(/\/+$/, '');
    onServerChange(u);
    setUrlDraft(u);
    check();
  };

  const createProject = async () => {
    const name = newName.trim() || 'my app';
    setBusy(true);
    try {
      const r = await api.createProject(name);
      onProjectChange(r.project);
      setNewName('');
      loadProjects();
    } catch (e: any) {
      Alert.alert('Could not create project', e?.message || '');
    } finally {
      setBusy(false);
    }
  };

  const removeProject = (p: ProjectSummary) => {
    Alert.alert('Delete project?', '"' + p.name + '" will be removed from the server.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteProject(p.id);
            if (project?.id === p.id) onProjectChange(null);
            loadProjects();
          } catch (e: any) {
            Alert.alert('Delete failed', e?.message || '');
          }
        },
      },
    ]);
  };

  const upgrade = async (plan: Plan) => {
    setNote(null);
    setPayBusy(plan.id);
    try {
      const link = await api.checkout(plan.id, period);
      setPendingLink(link.id);
      await Linking.openURL(link.url);
      setNote('Complete the payment in your browser, then come back and tap "I have paid — check now".');
    } catch (e: any) {
      setNote('⚠ ' + (e?.message || 'Could not start payment'));
    } finally {
      setPayBusy(null);
    }
  };

  const checkPayment = async () => {
    if (!pendingLink) return;
    setNote('Checking your payment…');
    try {
      const r = await api.verifyPayment(pendingLink);
      if (r.paid && r.user) {
        onUserChange(r.user);
        setNote('🎉 Payment received — your plan is active!');
        setPendingLink(null);
      } else {
        setNote('Payment not confirmed yet (status: ' + (r.status || 'unknown') + '). Finish paying, then try again.');
      }
    } catch (e: any) {
      setNote('⚠ ' + (e?.message || 'Could not check'));
    }
  };

  const redeem = async () => {
    if (!code.trim()) return;
    setRedeemBusy(true);
    setNote(null);
    try {
      const r = await api.redeem(code.trim());
      onUserChange(r.user);
      setCode('');
      setNote('🎉 Code applied — plan activated!');
    } catch (e: any) {
      setNote('⚠ ' + (e?.message || 'Invalid code'));
    } finally {
      setRedeemBusy(false);
    }
  };

  const saveByok = async () => {
    if (byokKey.trim().length < 12) {
      setNote('⚠ That key looks too short.');
      return;
    }
    setByokBusy(true);
    setNote(null);
    try {
      await api.setByok(byokProvider, byokKey.trim());
      setByokKey('');
      setNote('✓ Your key is saved and encrypted on the server. You now have unlimited generations.');
      onRefreshMe();
    } catch (e: any) {
      setNote('⚠ ' + (e?.message || 'Could not save key'));
    } finally {
      setByokBusy(false);
    }
  };

  const removeByok = () => {
    Alert.alert('Remove your API key?', 'Your usage will go back to the plan quota.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        onPress: async () => {
          try {
            await api.removeByok();
            onRefreshMe();
            setNote('Your key was removed.');
          } catch (e: any) {
            setNote('⚠ ' + (e?.message || 'Failed'));
          }
        },
      },
    ]);
  };

  const ok = !!health && health.ok;
  const planBadge = user?.byok ? 'using your own key' : user ? user.plan + ' plan' : '';
  const expiry = user?.planExpiresAt
    ? new Date(user.planExpiresAt).toLocaleDateString()
    : null;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* ── account & plans ── */}
      <Text style={styles.section}>ACCOUNT</Text>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.email}>{user?.email || '…'}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{planBadge}</Text>
          </View>
        </View>

        {user?.byok ? (
          <Text style={styles.muted}>
            Unlimited generations using your own {user.byok.provider} key.
          </Text>
        ) : user ? (
          <Text style={styles.muted}>
            {user.usage.period === 'total' ? 'Lifetime usage' : 'This month'}: {user.usage.used} /{' '}
            {user.usage.limit} generations used{expiry ? ' · plan renews/expires ' + expiry : ''}
          </Text>
        ) : null}

        {note ? <Text style={styles.note}>{note}</Text> : null}
        {pendingLink ? (
          <Pressable style={styles.ghostBtn} onPress={checkPayment}>
            <Text style={styles.ghostBtnText}>I have paid — check now</Text>
          </Pressable>
        ) : null}

        <View style={styles.periodRow}>
          {(['month', 'year'] as const).map((p) => (
            <Pressable
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnOn]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextOn]}>
                {p === 'month' ? 'Monthly' : 'Yearly (save ~30%)'}
              </Text>
            </Pressable>
          ))}
        </View>

        {plans
          .filter((pl) => pl.id !== 'free')
          .map((pl) => {
            const isCurrent = user?.plan === pl.id;
            const price = period === 'month' ? pl.monthly : pl.yearly;
            return (
              <View key={pl.id} style={[styles.planCard, isCurrent && styles.planCardOn]}>
                <View style={styles.rowBetween}>
                  <Text style={styles.planName}>{pl.name}</Text>
                  <Text style={styles.planPrice}>
                    ₹{price}
                    <Text style={styles.muted}>/{period === 'month' ? 'mo' : 'yr'}</Text>
                  </Text>
                </View>
                <Text style={styles.muted}>
                  {pl.tagline} · {pl.model} · {pl.genLimit} generations
                </Text>
                <Pressable
                  style={[styles.primaryBtn, (isCurrent || payBusy === pl.id) && { opacity: 0.6 }]}
                  disabled={isCurrent || payBusy === pl.id}
                  onPress={() => upgrade(pl)}
                >
                  {payBusy === pl.id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {isCurrent ? 'Current plan' : 'Upgrade to ' + pl.name}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })}

        <Text style={styles.label}>Have an activation code?</Text>
        <View style={styles.rowInline}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            placeholder="VF-XXXXXX-XXXXXX"
            placeholderTextColor={theme.sub}
          />
          <Pressable style={styles.smallBtn} onPress={redeem} disabled={redeemBusy}>
            <Text style={styles.smallBtnText}>{redeemBusy ? '…' : 'Redeem'}</Text>
          </Pressable>
        </View>
      </View>

      {/* ── BYOK ── */}
      <Text style={styles.section}>USE YOUR OWN API KEY (FREE, UNLIMITED)</Text>
      <View style={styles.card}>
        {user?.byok ? (
          <>
            <Text style={styles.muted}>
              Active: {user.byok.provider} key (encrypted at rest). Your key never leaves the
              server.
            </Text>
            <Pressable style={styles.ghostBtn} onPress={removeByok}>
              <Text style={styles.ghostBtnText}>Remove my key</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.muted}>
              Get a key from your AI provider (e.g. console.anthropic.com), paste it here, and build
              without limits — you pay the provider directly.
            </Text>
            <View style={styles.provRow}>
              {BYOK_PROVIDERS.map((p) => (
                <Pressable
                  key={p}
                  style={[styles.provChip, byokProvider === p && styles.provChipOn]}
                  onPress={() => setByokProvider(p)}
                >
                  <Text style={[styles.provText, byokProvider === p && styles.provTextOn]}>{p}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={byokKey}
              onChangeText={setByokKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder={'Paste your ' + byokProvider + ' API key'}
              placeholderTextColor={theme.sub}
            />
            <Pressable style={styles.primaryBtn} onPress={saveByok} disabled={byokBusy}>
              <Text style={styles.primaryBtnText}>{byokBusy ? 'Saving…' : 'Save key'}</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* ── server ── */}
      <Text style={styles.section}>SERVER</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={urlDraft}
          onChangeText={setUrlDraft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://your-app.onrender.com"
          placeholderTextColor={theme.sub}
        />
        <Pressable style={styles.ghostBtn} onPress={saveUrl} disabled={checking}>
          {checking ? (
            <ActivityIndicator color={theme.accent} size="small" />
          ) : (
            <Text style={styles.ghostBtnText}>Save & test connection</Text>
          )}
        </Pressable>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.dot,
              { backgroundColor: ok ? theme.green : healthErr ? theme.red : theme.amber },
            ]}
          />
          <Text style={styles.statusText}>
            {ok
              ? 'Connected · AI: ' + (health?.aiConfigured ? 'ready' : 'demo') + ' · users: ' + health?.users
              : healthErr
              ? 'Not connected'
              : 'Testing…'}
          </Text>
        </View>
        {healthErr ? <Text style={styles.errText}>{healthErr}</Text> : null}
      </View>

      {/* ── projects ── */}
      <Text style={styles.section}>MY PROJECTS</Text>
      <View style={styles.card}>
        {projects.length === 0 ? (
          <Text style={styles.muted}>No projects yet — create one from the Chat tab.</Text>
        ) : (
          projects.map((p) => {
            const active = project?.id === p.id;
            return (
              <View key={p.id} style={styles.projectRow}>
                <Pressable style={styles.projectMain} onPress={() => onProjectChange(p)}>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={active ? theme.accent : theme.sub}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.projectName, active && { color: theme.accent }]}>
                      {p.name}
                    </Text>
                    <Text style={styles.projectId}>{p.id}</Text>
                  </View>
                </Pressable>
                <Pressable hitSlop={10} onPress={() => removeProject(p)}>
                  <Ionicons name="trash-outline" size={18} color={theme.sub} />
                </Pressable>
              </View>
            );
          })
        )}
        <View style={styles.rowInline}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={newName}
            onChangeText={setNewName}
            placeholder="New project name"
            placeholderTextColor={theme.sub}
          />
          <Pressable style={styles.smallBtn} onPress={createProject} disabled={busy}>
            <Text style={styles.smallBtnText}>{busy ? '…' : 'Create'}</Text>
          </Pressable>
        </View>
      </View>

      {/* ── about ── */}
      <Text style={styles.section}>ABOUT</Text>
      <View style={styles.card}>
        <Text style={styles.muted}>
          VibeForge v2 — describe an app, the AI writes the files on your server, and the live
          preview appears on this phone.
        </Text>
        <Text style={[styles.muted, { marginTop: 6 }]}>
          Free plan: 10 builds on the fast model. Paid plans unlock stronger models and more builds.
          Bring your own API key for unlimited use.
        </Text>
      </View>

      <Pressable style={styles.logoutBtn} onPress={onLogout}>
        <Ionicons name="log-out-outline" size={18} color={theme.red} />
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 40, gap: 10 },
  section: { color: theme.sub, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: 8 },
  card: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  email: { color: theme.text, fontSize: 15, fontWeight: '600', flex: 1 },
  badge: { backgroundColor: theme.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#B7A6FF', fontSize: 11.5, fontWeight: '700' },
  label: { color: theme.sub, fontSize: 12.5, marginTop: 4 },
  note: { color: theme.amber, fontSize: 12.5, lineHeight: 18 },
  muted: { color: theme.sub, fontSize: 13, lineHeight: 19 },
  errText: { color: theme.red, fontSize: 12.5, lineHeight: 18 },
  input: {
    backgroundColor: theme.card2,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 14,
  },
  primaryBtn: { backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  ghostBtn: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  ghostBtnText: { color: theme.text, fontWeight: '600', fontSize: 13.5 },
  smallBtn: { backgroundColor: theme.accent, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  periodRow: { flexDirection: 'row', gap: 8 },
  periodBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  periodBtnOn: { backgroundColor: theme.accentSoft, borderColor: theme.accent },
  periodText: { color: theme.sub, fontSize: 12.5, fontWeight: '600' },
  periodTextOn: { color: '#B7A6FF' },
  planCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    backgroundColor: theme.card2,
  },
  planCardOn: { borderColor: theme.accent },
  planName: { color: theme.text, fontSize: 15.5, fontWeight: '700' },
  planPrice: { color: theme.text, fontSize: 16, fontWeight: '800' },
  provRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  provChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  provChipOn: { backgroundColor: theme.accentSoft, borderColor: theme.accent },
  provText: { color: theme.sub, fontSize: 12.5, fontWeight: '600' },
  provTextOn: { color: '#B7A6FF' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { color: theme.text, fontSize: 13, flex: 1 },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  projectMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  projectName: { color: theme.text, fontSize: 14.5, fontWeight: '600' },
  projectId: { color: theme.sub, fontSize: 11.5, fontFamily: theme.mono },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#3A1D22',
    backgroundColor: '#22141a',
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 12,
  },
  logoutText: { color: theme.red, fontWeight: '700', fontSize: 14 },
});
