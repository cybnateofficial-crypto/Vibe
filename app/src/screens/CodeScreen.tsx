import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Api, FileEntry, ProjectSummary } from '../api';
import { theme } from '../theme';

function formatSize(n: number): string {
  if (n < 1024) return n + ' B';
  return (n / 1024).toFixed(1) + ' KB';
}

export default function CodeScreen({
  api,
  project,
  refreshKey,
}: {
  api: Api;
  project: ProjectSummary | null;
  refreshKey: number;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ path: string; content: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const load = useCallback(async () => {
    if (!project) {
      setFiles([]);
      return;
    }
    try {
      const d = await api.getProject(project.id);
      setFiles(d.files || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load files');
    }
  }, [api, project]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const open = async (path: string) => {
    if (!project) return;
    setLoadingFile(true);
    try {
      const d = await api.getFile(project.id, path);
      setSelected(d);
    } catch (e: any) {
      setError(e?.message || 'Could not open file');
    } finally {
      setLoadingFile(false);
    }
  };

  if (!project) {
    return (
      <View style={styles.empty}>
        <Ionicons name="code-slash-outline" size={40} color={theme.sub} />
        <Text style={styles.emptyTitle}>No files yet</Text>
        <Text style={styles.emptySub}>Build something in the Chat tab and the code will show up here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Text style={styles.barText}>
          {files.length} file{files.length === 1 ? '' : 's'}
        </Text>
        <Pressable hitSlop={10} onPress={load}>
          <Ionicons name="refresh" size={20} color={theme.text} />
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={files}
        keyExtractor={(f) => f.path}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => open(item.path)}>
            <Ionicons name="document-text-outline" size={18} color={theme.accent} />
            <Text style={styles.rowPath} numberOfLines={1}>
              {item.path}
            </Text>
            <Text style={styles.rowSize}>{formatSize(item.size)}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.sub} />
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyList}>
            No files in this project yet. Ask the AI to build something!
          </Text>
        }
      />

      <Modal
        visible={!!selected || loadingFile}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modal}>
          <View style={styles.modalBar}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {selected?.path || 'Loading…'}
            </Text>
            <Pressable hitSlop={10} onPress={() => setSelected(null)}>
              <Ionicons name="close" size={22} color={theme.text} />
            </Pressable>
          </View>
          {loadingFile && !selected ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 14 }}>
              <Text style={styles.code} selectable>
                {selected?.content}
              </Text>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  barText: { color: theme.sub, fontSize: 12 },
  error: { color: theme.red, fontSize: 12.5, paddingHorizontal: 14, paddingTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowPath: { flex: 1, color: theme.text, fontSize: 14 },
  rowSize: { color: theme.sub, fontSize: 12 },
  emptyList: { color: theme.sub, textAlign: 'center', marginTop: 30, fontSize: 13.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  emptyTitle: { color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 6 },
  emptySub: { color: theme.sub, fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  modal: { flex: 1, backgroundColor: theme.bg },
  modalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  modalTitle: { color: theme.text, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 12 },
  code: {
    color: '#D7E0F5',
    fontFamily: theme.mono,
    fontSize: 12,
    lineHeight: 18,
  },
});
