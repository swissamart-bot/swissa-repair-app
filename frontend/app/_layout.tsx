import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { initDB } from '../src/database';
import { initAutoBackupOnLaunch } from '../src/backup';
import { initCloudSync } from '../src/sync';
import { SyncProvider } from '../src/SyncStatus';

export default function Layout() {
  useEffect(() => {
    async function init() {
      await initDB();
      // Automatic backup: ON by default, daily snapshot / retry failed backup
      await initAutoBackupOnLaunch();
      // Firestore: push dirty local changes, then pull & merge by updatedAt
      await initCloudSync();
    }
    init().catch(e => console.warn('App init failed:', e));
  }, []);

  return (
    <SyncProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#E2E8F0',
            borderTopWidth: 1,
            height: 80,
            paddingBottom: 22,
            paddingTop: 8,
          },
          tabBarActiveTintColor: '#0A0A0A',
          tabBarInactiveTintColor: '#94A3B8',
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 0.5,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'New',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="add-circle-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="records"
          options={{
            title: 'Records',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="document-text-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="promo"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="edit-job"
          options={{
            href: null,
          }}
        />
      </Tabs>
    </SyncProvider>
  );
}
