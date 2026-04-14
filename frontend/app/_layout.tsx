import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { initDB, getSetting, setSetting, exportData } from '../src/database';

export default function Layout() {
  useEffect(() => {
    async function init() {
      await initDB();
      await checkAutoBackup();
    }
    init();
  }, []);

  async function checkAutoBackup() {
    if (Platform.OS === 'web') return;
    try {
      const autoEnabled = await getSetting('autoBackup');
      if (autoEnabled !== 'true') return;

      const lastBackup = await getSetting('lastBackupTime');
      const lastTime = lastBackup ? new Date(lastBackup).getTime() : 0;
      const now = Date.now();

      if (now - lastTime > 24 * 60 * 60 * 1000) {
        const FileSystem = require('expo-file-system');
        const data = await exportData();
        const dir = FileSystem.documentDirectory + 'SwissaBackups/';
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const filename = `swissa_backup_${dateStr}.json`;
        await FileSystem.writeAsStringAsync(dir + filename, data);
        await setSetting('lastBackupTime', new Date().toISOString());
      }
    } catch (e) {
      console.warn('Auto backup check failed:', e);
    }
  }

  return (
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
    </Tabs>
  );
}
