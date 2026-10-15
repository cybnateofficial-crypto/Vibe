import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { Api, ProjectSummary } from '../api';
import { theme } from '../theme';

export default function PreviewScreen({
  api,
  project,
  refreshKey,
}: {
  api: Api;
  project: ProjectSummary | null;
  refreshKey: number;
}) {
  const [local, setLocal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  if (!project) {
    return (
      <View style={styles.empty}>
        <Ionicons name="phone-portrait-outline" size={40} color={theme.sub} />
        <Text style={styles.emptyTitle}>No preview yet</Text>
        <Text style={styles.emptySub}>
          Start a project in the Chat tab — your app will appear here the moment it's built.
        </Text>
      </View>
    );
  }

  const url = api.previewUrl(project.id) + '?v=' + refreshKey + '-' + local;

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Text style={styles.barText} numberOfLines={1}>
          {project.id}
        </Text>
        <Pressable
          hitSlop={10}
          onPress={() => {
            setErr(null);
            setLocal((v) => v + 1);
          }}
        >
          <Ionicons name="refresh" size={20} color={theme.text} />
        </Pressable>
        <Pressable
          hitSlop={10}
          onPress={() => Linking.openURL(api.previewUrl(project.id)).catch(() => {})}
        >
          <Ionicons name="open-outline" size={20} color={theme.text} />
        </Pressable>
      </View>

      {err ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={40} color={theme.red} />
          <Text style={styles.emptyTitle}>Couldn't load the preview</Text>
          <Text style={styles.emptySub}>{err}</Text>
          <Pressable
            style={styles.retry}
            onPress={() => {
              setErr(null);
              setLocal((v) => v + 1);
            }}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          key={url}
          source={{ uri: url }}
          style={styles.web}
          startInLoadingState
          renderLoading={() => (
            <ActivityIndicator color={theme.accent} style={styles.loading} size="large" />
          )}
          onError={(e: any) => setErr(String(e?.nativeEvent?.description || 'Failed to load'))}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  barText: { flex: 1, color: theme.sub, fontSize: 12 },
  web: { flex: 1, backgroundColor: '#ffffff' },
  loading: { marginTop: 60 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    gap: 8,
  },
  emptyTitle: { color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 6 },
  emptySub: { color: theme.sub, fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  retry: {
    marginTop: 12,
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
