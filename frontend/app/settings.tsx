import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Alert, Switch, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { getRecordCount, getSetting, setSetting, exportData, importData } from '../src/database';
import { C, SHOP } from '../src/constants';

export default function Settings() {
  const [recordCount, setRecordCount] = useState(0);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [autoBackup, setAutoBackup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);

  useFocusEffect(useCallback(() => { loadSettings(); }, []));

  async function loadSettings() {
    const count = await getRecordCount();
    setRecordCount(count);
    const lastTime = await getSetting('lastBackupTime');
    setLastBackup(lastTime);
    const auto = await getSetting('autoBackup');
    setAutoBackup(auto === 'true');
  }

  function showToastMsg(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  async function toggleAutoBackup(value: boolean) {
    setAutoBackup(value);
    await setSetting('autoBackup', value ? 'true' : 'false');
    showToastMsg(value ? 'Auto backup enabled' : 'Auto backup disabled');
  }

  async function handleBackupNow() {
    setLoading(true);
    try {
      const data = await exportData();

      if (Platform.OS === 'web') {
        // Web: download as file
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swissa_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Mobile: save to document directory and share
        const FileSystem = require('expo-file-system');
        const Sharing = require('expo-sharing');
        const dir = FileSystem.documentDirectory + 'SwissaBackups/';
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        const filename = `swissa_backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
        const fileUri = dir + filename;
        await FileSystem.writeAsStringAsync(fileUri, data);

        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/json',
            dialogTitle: 'Save Swissa Backup',
          });
        }
      }

      await setSetting('lastBackupTime', new Date().toISOString());
      setLastBackup(new Date().toISOString());
      showToastMsg('Backup created successfully!');
    } catch (e) {
      console.warn('Backup failed:', e);
      showToastMsg('Backup failed', true);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setLoading(true);
    try {
      if (Platform.OS === 'web') {
        // Web: use file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e: any) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          const count = await importData(text);
          await loadSettings();
          showToastMsg(`Imported ${count} records!`);
          setLoading(false);
        };
        input.click();
        return;
      }

      const DocumentPicker = require('expo-document-picker');
      const FileSystem = require('expo-file-system');
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });

      if (!result.canceled && result.assets?.[0]) {
        const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
        const count = await importData(content);
        await loadSettings();
        showToastMsg(`Imported ${count} records!`);
      }
    } catch (e) {
      console.warn('Import failed:', e);
      showToastMsg('Import failed - invalid backup file', true);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString();
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Settings</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Backup Section */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="cloud-upload-outline" size={22} color={C.primary} />
            <Text style={s.cardTitle}>Database Backup</Text>
          </View>

          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Records in database</Text>
            <Text testID="record-count" style={s.infoValue}>{recordCount}</Text>
          </View>

          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Last backup</Text>
            <Text testID="last-backup" style={s.infoValue}>{formatDate(lastBackup)}</Text>
          </View>

          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Auto backup every night</Text>
              <Text style={s.switchHint}>Saves to app storage automatically</Text>
            </View>
            <Switch
              testID="auto-backup-toggle"
              value={autoBackup}
              onValueChange={toggleAutoBackup}
              trackColor={{ false: C.border, true: C.green100 }}
              thumbColor={autoBackup ? C.green800 : C.textMuted}
            />
          </View>

          <TouchableOpacity testID="btn-backup-now" style={s.primaryBtn} onPress={handleBackupNow} disabled={loading}>
            {loading ? <ActivityIndicator color={C.primaryFg} /> : (
              <>
                <Ionicons name="download-outline" size={20} color={C.primaryFg} />
                <Text style={s.primaryBtnText}>Backup Now</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={s.hint}>
            Backup saves all records as a JSON file. On mobile, you can save it to "Downloads/Swissa repair database/" folder or share via WhatsApp/Email.
          </Text>
        </View>

        {/* Import Section */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="cloud-download-outline" size={22} color={C.primary} />
            <Text style={s.cardTitle}>Restore from Backup</Text>
          </View>

          <Text style={s.restoreNote}>Import a previously exported backup file to restore all records. This will replace existing data.</Text>

          <TouchableOpacity testID="btn-import" style={s.secondaryBtn} onPress={() => {
            Alert.alert(
              'Restore Backup',
              'This will replace all current records with the backup data. Continue?',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: handleImport }]
            );
          }} disabled={loading}>
            <Ionicons name="folder-open-outline" size={20} color={C.primary} />
            <Text style={s.secondaryBtnText}>Import Backup File</Text>
          </TouchableOpacity>
        </View>

        {/* About Section */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="information-circle-outline" size={22} color={C.primary} />
            <Text style={s.cardTitle}>About</Text>
          </View>

          <Text style={s.aboutName}>{SHOP.name}</Text>
          <Text style={s.aboutTagline}>{SHOP.tagline}</Text>
          <Text style={s.aboutAddr}>{SHOP.address}</Text>

          <View style={s.divider} />
          <Text style={s.aboutVersion}>App Version 1.0</Text>
          <Text style={s.aboutNote}>All data is stored locally on your device. No internet required.</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {toast && (
        <View style={[s.toast, toast.err && s.toastErr]}>
          <Text style={s.toastText}>{toast.msg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.surface, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 24, fontWeight: '800', color: C.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 20, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: C.primary },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.secondary },
  infoLabel: { fontSize: 14, color: C.textMuted, fontWeight: '500' },
  infoValue: { fontSize: 14, color: C.text, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.secondary, gap: 12 },
  switchLabel: { fontSize: 14, color: C.text, fontWeight: '600' },
  switchHint: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, marginTop: 16 },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: C.primaryFg },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 14, marginTop: 12 },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: C.primary },
  hint: { fontSize: 12, color: C.textMuted, marginTop: 12, lineHeight: 18 },
  restoreNote: { fontSize: 13, color: C.textMuted, lineHeight: 18, marginBottom: 4 },
  aboutName: { fontSize: 22, fontWeight: '900', color: C.primary, textAlign: 'center', letterSpacing: -0.5 },
  aboutTagline: { fontSize: 14, color: C.textMuted, textAlign: 'center', fontWeight: '600', letterSpacing: 1 },
  aboutAddr: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  aboutVersion: { fontSize: 13, color: C.textMuted, textAlign: 'center', fontWeight: '600' },
  aboutNote: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 4 },
  toast: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center' },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
