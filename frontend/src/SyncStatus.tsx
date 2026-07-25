/**
 * React hooks + badge for Firestore sync status.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getSyncMeta,
  getSyncStatus,
  subscribeSyncStatus,
  type SyncDetailMeta,
  type SyncUiStatus,
} from './sync';
import { C } from './constants';

const SyncContext = createContext<SyncDetailMeta>(getSyncMeta());

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState(() => getSyncMeta());

  useEffect(() => {
    return subscribeSyncStatus(() => {
      setMeta(getSyncMeta());
    });
  }, []);

  const value = useMemo(() => meta, [meta]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncStatus(): SyncDetailMeta {
  return useContext(SyncContext);
}

function labelFor(status: SyncUiStatus): string {
  if (status === 'offline') return 'Offline';
  if (status === 'syncing') return 'Syncing';
  if (status === 'error') return 'Error';
  return 'Synced';
}

function colorFor(status: SyncUiStatus): string {
  if (status === 'offline') return C.textMuted;
  if (status === 'syncing') return C.blue;
  if (status === 'error') return C.red;
  return C.green800;
}

function iconFor(status: SyncUiStatus): keyof typeof Ionicons.glyphMap {
  if (status === 'offline') return 'cloud-offline-outline';
  if (status === 'syncing') return 'cloud-upload-outline';
  if (status === 'error') return 'warning-outline';
  return 'cloud-done-outline';
}

export function SyncStatusBadge({ compact = false }: { compact?: boolean }) {
  const { status, lastError } = useSyncStatus();
  const color = colorFor(status);
  const label = labelFor(status);

  return (
    <View
      testID="sync-status-badge"
      accessibilityLabel={`Sync status: ${label}${lastError ? `. ${lastError}` : ''}`}
      style={[styles.badge, compact && styles.badgeCompact]}
    >
      {status === 'syncing' ? (
        <ActivityIndicator size="small" color={color} style={{ marginRight: 6 }} />
      ) : (
        <Ionicons name={iconFor(status)} size={compact ? 14 : 16} color={color} style={{ marginRight: 5 }} />
      )}
      <Text style={[styles.label, { color }, compact && styles.labelCompact]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: C.secondary,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeCompact: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  labelCompact: {
    fontSize: 11,
  },
});
