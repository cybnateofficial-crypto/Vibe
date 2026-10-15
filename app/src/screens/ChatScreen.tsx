import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Api, ChatMessage, Job, ProjectSummary } from '../api';
import { theme } from '../theme';

type Row = {
  key: string;
  kind: 'user' | 'ai' | 'act';
  text: string;
  icon?: string;
  color?: string;
};

const SUGGESTIONS = [
  'A todo app with dark mode',
  'A landing page for my startup',
  'An expense tracker app',
  'A pomodoro timer',
];

function toolLabel(name?: string): string {
  switch (name) {
    case 'write_file':
      return 'Writing';
    case 'read_file':
      return 'Reading';
    case 'list_files':
      return 'Listing files';
    case 'delete_file':
      return 'Deleting';
    case 'finish':
      return 'Wrapping up';
    default:
      return name || 'Working';
  }
}

export default function ChatScreen({
  api,
  project,
  onProjectReady,
  onProjectChanged,
}: {
  api: Api;
  project: ProjectSummary | null;
  onProjectReady: (p: ProjectSummary) => void;
  onProjectChanged: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Row> | null>(null);

  const loadMessages = useCallback(async () => {
    if (!project) {
      setMessages([]);
      return;
    }
    try {
      const d = await api.getProject(project.id);
      setMessages(d.messages || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server');
    }
  }, [api, project]);

  useEffect(() => {
    setJob(null);
    loadMessages();
  }, [loadMessages]);

  const jobId = job?.id;
  const jobStatus = job?.status;

  useEffect(() => {
    if (!jobId || jobStatus !== 'running') return;
    const iv = setInterval(async () => {
      try {
        const j = await api.getJob(jobId);
        if (j.status === 'running') {
          setJob(j);
        } else if (j.status === 'error') {
          setJob(j);
          onProjectChanged();
          loadMessages();
        } else {
          setJob(null);
          onProjectChanged();
          loadMessages();
        }
      } catch {
        // transient network hiccup — keep polling
      }
    }, 900);
    return () => clearInterval(iv);
  }, [jobId, jobStatus, api, loadMessages, onProjectChanged]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    setError(null);
    try {
      let proj = project;
      if (!proj) {
        const created = await api.createProject(text.slice(0, 28));
        proj = created.project;
        onProjectReady(proj);
      }
      setMessages((m) => [...m, { role: 'user', text, ts: Date.now() }]);
      const res = await api.chat(proj.id, text);
      setJob({
        id: res.jobId,
        projectId: proj.id,
        status: 'running',
        error: null,
        events: [],
        startedAt: Date.now(),
        finishedAt: null,
      });
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: '⚠ ' + (e?.message || 'Something went wrong'), ts: Date.now() },
      ]);
    } finally {
      setSending(false);
    }
  }, [api, input, project, sending, onProjectReady]);

  const busy = sending || jobStatus === 'running';

  const rows: Row[] = [];
  messages.forEach((m, i) =>
    rows.push({ key: 'm' + i + '_' + m.ts, kind: m.role === 'user' ? 'user' : 'ai', text: m.text })
  );
  if (job) {
    for (const ev of job.events) {
      if (ev.type === 'assistant_text' && ev.text) {
        rows.push({ key: 'e' + ev.seq, kind: 'ai', text: ev.text });
      } else if (ev.type === 'tool_call') {
        rows.push({
          key: 'e' + ev.seq,
          kind: 'act',
          icon: 'sparkles',
          text: toolLabel(ev.name) + (ev.path ? ' ' + ev.path : ''),
        });
      } else if (ev.type === 'tool_result') {
        rows.push({
          key: 'e' + ev.seq,
          kind: 'act',
          icon: ev.isError ? 'alert-circle' : 'checkmark-circle',
          color: ev.isError ? theme.red : theme.green,
          text: ev.text || '',
        });
      } else if (ev.type === 'error') {
        rows.push({
          key: 'e' + ev.seq,
          kind: 'act',
          icon: 'alert-circle',
          color: theme.red,
          text: ev.text || 'Error',
        });
      }
    }
  }

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'act') {
      return (
        <View style={styles.actRow}>
          <Ionicons name={(item.icon || 'ellipse') as any} size={14} color={item.color || theme.sub} />
          <Text style={[styles.actText, item.color ? { color: item.color } : null]}>{item.text}</Text>
        </View>
      );
    }
    const isUser = item.kind === 'user';
    return (
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
        <Text style={isUser ? styles.bubbleUserText : styles.bubbleAiText}>{item.text}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.flex}>
        {error ? (
          <View style={styles.errorBar}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          data={rows}
          renderItem={renderItem}
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<EmptyState onPick={(s) => setInput(s)} />}
          ListFooterComponent={
            busy ? (
              <View style={styles.actRow}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={styles.actText}>Working…</Text>
              </View>
            ) : null
          }
        />

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Describe an app, or ask for a change…"
            placeholderTextColor={theme.sub}
            multiline
          />
          <Pressable
            style={[styles.sendBtn, (!input.trim() || busy) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!input.trim() || busy}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>What should we build today?</Text>
      <Text style={styles.emptySub}>
        Describe any app in plain words. The AI writes the files and your preview appears
        instantly.
      </Text>
      <View style={styles.chips}>
        {SUGGESTIONS.map((s) => (
          <Pressable key={s} style={styles.chip} onPress={() => onPick(s)}>
            <Text style={styles.chipText}>{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listContent: { padding: 14, gap: 8, flexGrow: 1 },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: theme.accent,
    borderBottomRightRadius: 6,
  },
  bubbleAi: {
    alignSelf: 'flex-start',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderBottomLeftRadius: 6,
  },
  bubbleUserText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  bubbleAiText: { color: theme.text, fontSize: 15, lineHeight: 21 },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 2 },
  actText: { color: theme.sub, fontSize: 12.5, flex: 1 },
  errorBar: {
    backgroundColor: '#3A1D22',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#5A2A33',
  },
  errorText: { color: '#FFB3B3', fontSize: 12.5 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 10, paddingTop: 30 },
  emptyTitle: { color: theme.text, fontSize: 22, fontWeight: '700', marginBottom: 8 },
  emptySub: { color: theme.sub, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  chip: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipText: { color: theme.text, fontSize: 13 },
});
