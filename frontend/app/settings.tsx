import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Switch, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { getJobCount, importData, clearAllRecords, getAllJobs, updateItem } from '../src/database';
import {
  getAutoBackupStatus,
  setAutoBackupEnabled,
  backupNow,
  exportManualBackupFile,
  peekBackupMeta,
  getAutoBackupLocationLabel,
  type AutoBackupStatus,
} from '../src/backup';
import { syncNow, SYNC_ENABLED, SYNC_MIGRATE_EXISTING_LOCAL_JOBS, scheduleJobSync } from '../src/sync';
import { SyncStatusBadge, useSyncStatus } from '../src/SyncStatus';
import { getFirebaseConfigStatus } from '../src/firebase';
import {
  getGoogleReviewLink,
  setGoogleReviewLink,
  getIncludeGoogleReviewDefault,
  setIncludeGoogleReviewDefault,
} from '../src/shopSettings';
import { countLocalOnlyPhotos, uploadExistingLocalPhotos, normalizePhotos } from '../src/photos';
import { C, SHOP } from '../src/constants';
import DiagnosisPhraseLibrary from '../src/components/DiagnosisPhraseLibrary';
import ServicePhraseLibrary from '../src/components/ServicePhraseLibrary';

export default function Settings() {
  const [jobCount, setJobCount] = useState(0);
  const [autoStatus, setAutoStatus] = useState<AutoBackupStatus | null>(null);
  const [reviewLink, setReviewLink] = useState('');
  const [includeReviewDefault, setIncludeReviewDefault] = useState(true);
  const [localOnlyPhotoCount, setLocalOnlyPhotoCount] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const [showPhraseManager, setShowPhraseManager] = useState(false);
  const [showDiagnosisLibrary, setShowDiagnosisLibrary] = useState(false);
  const syncMeta = useSyncStatus();
  const firebaseCfg = getFirebaseConfigStatus();

  useFocusEffect(useCallback(() => { loadSettings(); }, []));

  async function loadSettings() {
    setJobCount(await getJobCount());
    setAutoStatus(await getAutoBackupStatus());
    setReviewLink(await getGoogleReviewLink());
    setIncludeReviewDefault(await getIncludeGoogleReviewDefault());
    const jobs = await getAllJobs();
    setLocalOnlyPhotoCount(countLocalOnlyPhotos(jobs));
  }

  function showToastMsg(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  async function toggleAutoBackup(value: boolean) {
    await setAutoBackupEnabled(value);
    setAutoStatus(await getAutoBackupStatus());
    showToastMsg(value ? 'Automatic backup ON' : 'Automatic backup OFF');
  }

  async function saveReviewLink() {
    await setGoogleReviewLink(reviewLink.trim());
    showToastMsg('Google Review link saved!');
  }

  async function toggleIncludeReviewDefault(value: boolean) {
    setIncludeReviewDefault(value);
    await setIncludeGoogleReviewDefault(value);
    showToastMsg(value
      ? 'Google Review Link will be included in Delivered messages by default'
      : 'Google Review Link default is OFF for Delivered messages');
  }

  async function handleUploadExistingImages() {
    setLoading(true);
    setUploadProgress('Starting…');
    try {
      const jobs = await getAllJobs();
      const result = await uploadExistingLocalPhotos(
        jobs,
        p => setUploadProgress(`Uploading ${p.done}/${p.total}…`),
        async (itemId, photos) => {
          for (const j of jobs) {
            const item = j.items.find(i => i.id === itemId);
            if (item) {
              await updateItem({
                ...item,
                photos: normalizePhotos(photos),
                updatedAt: new Date().toISOString(),
              });
              return;
            }
          }
        },
        jobId => scheduleJobSync(jobId),
      );
      await loadSettings();
      setUploadProgress(null);
      showToastMsg(
        result.total === 0
          ? 'No local-only images to upload'
          : `Uploaded ${result.done - result.failed}/${result.total}` +
            (result.failed ? ` (${result.failed} failed — retry later)` : ''),
        result.failed > 0,
      );
    } catch (e: any) {
      setUploadProgress(null);
      showToastMsg('Image upload failed: ' + (e?.message || ''), true);
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoBackupNow() {
    setLoading(true);
    try {
      const result = await backupNow();
      await loadSettings();
      if (result.ok) showToastMsg(`Backup saved (${result.jobCount ?? 0} jobs)`);
      else showToastMsg(result.error || 'Backup failed', true);
    } catch (e: any) {
      showToastMsg('Backup failed: ' + (e?.message || ''), true);
      await loadSettings();
    } finally {
      setLoading(false);
    }
  }

  async function handleExportBackup() {
    setLoading(true);
    try {
      const { uri, json } = await exportManualBackupFile();
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swissa_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable && uri) {
          await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Save Swissa Backup' });
        } else {
          showToastMsg(uri ? 'Saved to app storage' : 'Export ready');
        }
      }
      await loadSettings();
      showToastMsg('Manual backup exported!');
    } catch (e: any) {
      showToastMsg('Export failed: ' + (e?.message || ''), true);
    } finally {
      setLoading(false);
    }
  }

  async function restoreFromContent(content: string) {
    const meta = await peekBackupMeta(content);
    if (!meta) {
      showToastMsg('Invalid backup file', true);
      return;
    }
    const when = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : 'Unknown date';
    Alert.alert(
      'Restore Backup?',
      `Backup date: ${when}\nJobs in file: ${meta.jobCount}\n\nA safety backup of your current data will be created first.\nThis does not run automatically — confirm to continue.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await backupNow();
              const count = await importData(content);
              await loadSettings();
              showToastMsg(`Restored ${count} jobs from backup`);
            } catch (e: any) {
              showToastMsg('Restore failed: ' + (e?.message || ''), true);
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }

  async function handleImport() {
    setLoading(true);
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e: any) => {
          const f = e.target.files?.[0];
          if (!f) { setLoading(false); return; }
          const t = await f.text();
          setLoading(false);
          await restoreFromContent(t);
        };
        input.click();
        return;
      }
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (!result.canceled && result.assets?.[0]) {
        const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
        setLoading(false);
        await restoreFromContent(content);
        return;
      }
    } catch (e: any) {
      showToastMsg('Import failed: ' + (e?.message || ''), true);
    } finally {
      setLoading(false);
    }
  }

  async function handleExportCSV() {
    setLoading(true);
    try {
      const jobs = await getAllJobs();
      let csv = 'Job No,Customer,Phone,Item Type,Brand,Description,Status,Estimate,Final,Balance\n';
      for (const j of jobs) {
        for (const i of j.items) {
          csv += `${j.jobNumber},"${j.customerName}",${j.countryCode}${j.mobileNumber},${i.itemType},"${i.brand}","${i.description}",${i.status},${i.estimatedAmount},${i.finalAmount},${(i.finalAmount || i.estimatedAmount) - (i.amountPaid || 0)}\n`;
        }
      }
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swissa_customers_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
      } else {
        const fileUri = FileSystem.documentDirectory + `swissa_customers_${new Date().toISOString().split('T')[0]}.csv`;
        await FileSystem.writeAsStringAsync(fileUri, csv);
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Customer List' });
      }
      showToastMsg('CSV exported!');
    } catch (e: any) {
      showToastMsg('Export failed: ' + (e?.message || ''), true);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearAll() {
    Alert.alert('Clear All Records', 'This will permanently delete ALL repair jobs and items.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Everything', style: 'destructive', onPress: () => {
          Alert.alert('Final Confirmation', 'Are you absolutely sure?', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Yes, Clear All', style: 'destructive', onPress: async () => {
                await clearAllRecords();
                await loadSettings();
                showToastMsg('All records cleared');
              },
            },
          ]);
        },
      },
    ]);
  }

  async function handleSyncNow() {
    setLoading(true);
    try {
      const result = await syncNow();
      await loadSettings();
      if (result.ok) {
        showToastMsg(result.message || 'Cloud sync complete');
      } else {
        showToastMsg(result.error || 'Sync failed', true);
      }
    } catch (e: any) {
      showToastMsg('Sync failed: ' + (e?.message || ''), true);
    } finally {
      setLoading(false);
    }
  }

  const autoOn = autoStatus?.enabled !== false;
  const lastBackupLabel = autoStatus?.lastSuccessAt
    ? new Date(autoStatus.lastSuccessAt).toLocaleString()
    : 'Never';
  const resultLabel = autoStatus?.lastResult || 'Never';
  const showFailWarn = resultLabel === 'Failed';
  const lastCloudSyncLabel = syncMeta.lastSuccessAt
    ? new Date(syncMeta.lastSuccessAt).toLocaleString()
    : 'Never';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={s.headerTitle}>Settings</Text>
          <SyncStatusBadge compact />
        </View>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="cloud-outline" size={22} color={C.primary} />
            <Text style={s.cardTitle}>Firebase Cloud Sync</Text>
          </View>
          <Text style={s.hint}>
            New jobs sync to Firestore automatically. Historical local jobs stay on this device until you enable cloud sync for that job (or turn on bulk migration).
          </Text>
          <View style={[s.infoRow, { marginTop: 8 }]}>
            <Text style={s.infoLabel}>Web app config</Text>
            <Text
              testID="firebase-web-config"
              style={[s.infoValue, !firebaseCfg.ok && { color: C.red }]}
            >
              {firebaseCfg.ok ? 'Loaded' : 'Missing appId'}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>SDK</Text>
            <Text style={s.infoValue}>Firebase JS (firebase)</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Live sync (SYNC_ENABLED)</Text>
            <Text style={s.infoValue}>{SYNC_ENABLED ? 'ON' : 'OFF'}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Bulk historical migrate</Text>
            <Text style={s.infoValue}>{SYNC_MIGRATE_EXISTING_LOCAL_JOBS ? 'ON' : 'OFF'}</Text>
          </View>
          {!firebaseCfg.ok ? (
            <View style={s.warnBox}>
              <Ionicons name="alert-circle" size={16} color={C.red} />
              <Text style={s.warnText}>{firebaseCfg.message}</Text>
            </View>
          ) : null}
          <View style={[s.infoRow, { marginTop: 8 }]}>
            <Text style={s.infoLabel}>Sync status</Text>
            <SyncStatusBadge compact />
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Authenticated</Text>
            <Text style={[s.infoValue, !syncMeta.authenticated && { color: C.red }]}>
              {syncMeta.authenticated ? 'Yes' : 'No'}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Firestore reachable</Text>
            <Text style={[s.infoValue, !syncMeta.firestoreReachable && syncMeta.lastError && { color: C.red }]}>
              {syncMeta.firestoreReachable ? 'Yes' : 'No'}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Pending uploads</Text>
            <Text testID="sync-pending" style={s.infoValue}>{syncMeta.pendingCount}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Uploaded documents</Text>
            <Text style={s.infoValue}>{syncMeta.uploadedCount}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Downloaded documents</Text>
            <Text style={s.infoValue}>{syncMeta.downloadedCount}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Last sync</Text>
            <Text testID="last-cloud-sync" style={s.infoValue}>{lastCloudSyncLabel}</Text>
          </View>
          {syncMeta.lastMessage ? (
            <View style={[s.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={s.infoLabel}>Last result</Text>
              <Text style={[s.infoValue, { flex: 1, textAlign: 'right', fontSize: 12 }]} numberOfLines={3}>
                {syncMeta.lastMessage}
              </Text>
            </View>
          ) : null}
          {syncMeta.lastError ? (
            <View style={s.warnBox}>
              <Ionicons name="alert-circle" size={16} color={C.red} />
              <Text style={s.warnText}>{syncMeta.lastError}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            testID="btn-sync-now"
            style={s.primaryBtn}
            onPress={handleSyncNow}
            disabled={loading || syncMeta.status === 'offline'}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="sync-outline" size={20} color="#fff" />}
            <Text style={s.primaryBtnText}>Sync Now</Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="shield-checkmark-outline" size={22} color={C.primary} />
            <Text style={s.cardTitle}>Automatic Backup</Text>
          </View>
          <Text style={s.hint}>
            Saves after important changes (debounced ~8s). Keeps latest + last 7 daily + last 4 weekly snapshots. Manual exports are never deleted.
          </Text>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Automatic Backup: {autoOn ? 'ON' : 'OFF'}</Text>
              <Text style={s.switchHint}>Runs in the background — does not interrupt work</Text>
            </View>
            <Switch
              testID="auto-backup-toggle"
              value={autoOn}
              onValueChange={toggleAutoBackup}
              trackColor={{ false: C.border, true: C.green100 }}
              thumbColor={autoOn ? C.green800 : C.textMuted}
            />
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Jobs in database</Text>
            <Text testID="job-count" style={s.infoValue}>{jobCount}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Last successful backup</Text>
            <Text testID="last-backup" style={s.infoValue}>{lastBackupLabel}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Last backup result</Text>
            <Text testID="last-backup-result" style={[s.infoValue, showFailWarn && { color: C.red }]}>
              {resultLabel}
            </Text>
          </View>
          <View style={[s.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={s.infoLabel}>Backup location</Text>
            <Text style={[s.infoValue, { flex: 1, textAlign: 'right', fontSize: 11 }]} numberOfLines={2}>
              {autoStatus?.location || getAutoBackupLocationLabel()}
            </Text>
          </View>
          {showFailWarn ? (
            <View style={s.warnBox}>
              <Ionicons name="warning-outline" size={16} color={C.red} />
              <Text style={s.warnText}>
                Last automatic backup failed{autoStatus?.lastError ? `: ${autoStatus.lastError}` : ''}.
                Live data is still saved on this device. Retry runs on next app open or Back Up Now.
              </Text>
            </View>
          ) : null}
          <TouchableOpacity testID="btn-backup-now" style={s.primaryBtn} onPress={handleAutoBackupNow} disabled={loading}>
            {loading
              ? <ActivityIndicator color={C.primaryFg} />
              : <><Ionicons name="save-outline" size={20} color={C.primaryFg} /><Text style={s.primaryBtnText}>Back Up Now</Text></>}
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="cloud-upload-outline" size={22} color={C.primary} />
            <Text style={s.cardTitle}>Export Backup</Text>
          </View>
          <Text style={s.hint}>
            Create a manual copy for Drive / laptop. These files are never removed by automatic cleanup.
          </Text>
          <TouchableOpacity testID="btn-export-backup" style={[s.secondaryBtn, { marginTop: 12 }]} onPress={handleExportBackup} disabled={loading}>
            <Ionicons name="download-outline" size={20} color={C.primary} />
            <Text style={s.secondaryBtnText}>Export Backup File</Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="cloud-download-outline" size={22} color={C.primary} />
            <Text style={s.cardTitle}>Restore Backup</Text>
          </View>
          <Text style={s.hint}>
            Always asks for confirmation. Creates a safety backup of current data before restoring.
          </Text>
          <TouchableOpacity testID="btn-import" style={[s.secondaryBtn, { marginTop: 12 }]} onPress={handleImport} disabled={loading}>
            <Ionicons name="folder-open-outline" size={20} color={C.primary} />
            <Text style={s.secondaryBtnText}>Import Backup File</Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="grid-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Export Customer List</Text></View>
          <TouchableOpacity testID="btn-export-csv" style={s.secondaryBtn} onPress={handleExportCSV} disabled={loading}>
            <Ionicons name="document-text-outline" size={20} color={C.primary} /><Text style={s.secondaryBtnText}>Export as Excel/CSV</Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="star-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Google Review Link</Text></View>
          <Text style={s.hint}>
            Used only in Delivered Successfully WhatsApp messages. Staff can still turn it off per customer at delivery.
          </Text>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Include Google Review Link in Delivered Message</Text>
              <Text style={s.switchHint}>Default for each delivery — ON recommended</Text>
            </View>
            <Switch
              testID="include-review-default-toggle"
              value={includeReviewDefault}
              onValueChange={toggleIncludeReviewDefault}
              trackColor={{ false: C.border, true: C.green100 }}
              thumbColor={includeReviewDefault ? C.green800 : C.textMuted}
            />
          </View>
          <TextInput testID="review-link-input" style={[s.input, { marginTop: 10 }]} value={reviewLink} onChangeText={setReviewLink} placeholder="Paste your Google Review link..." placeholderTextColor={C.textMuted} />
          <TouchableOpacity testID="btn-save-review" style={[s.secondaryBtn, { marginTop: 10 }]} onPress={saveReviewLink}>
            <Ionicons name="checkmark-circle-outline" size={20} color={C.primary} /><Text style={s.secondaryBtnText}>Save Link</Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Ionicons name="images-outline" size={22} color={C.primary} />
            <Text style={s.cardTitle}>Repair Images (Cloud)</Text>
          </View>
          <Text style={s.hint}>
            New photos upload to Firebase Storage automatically. Older local-only images need a one-time upload to appear on web / other devices.
            Requires Firebase Storage (Blaze plan may be needed).
          </Text>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Local-only images</Text>
            <Text testID="local-only-photo-count" style={s.infoValue}>{localOnlyPhotoCount}</Text>
          </View>
          {uploadProgress ? (
            <Text style={[s.hint, { marginTop: 8 }]}>{uploadProgress}</Text>
          ) : null}
          <TouchableOpacity
            testID="btn-upload-existing-images"
            style={[s.secondaryBtn, { marginTop: 12 }]}
            onPress={handleUploadExistingImages}
            disabled={loading || localOnlyPhotoCount === 0}
          >
            <Ionicons name="cloud-upload-outline" size={20} color={C.primary} />
            <Text style={s.secondaryBtnText}>
              Upload Existing Images to Cloud{localOnlyPhotoCount ? ` (${localOnlyPhotoCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="medkit-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Diagnosis Phrases</Text></View>
          <Text style={s.hint}>Organize by item type. Separate from Work Performed phrases.</Text>
          <TouchableOpacity testID="btn-diagnosis-phrase-library" style={[s.secondaryBtn, { marginTop: 10 }]} onPress={() => setShowDiagnosisLibrary(true)}>
            <Ionicons name="construct-outline" size={20} color={C.primary} /><Text style={s.secondaryBtnText}>Open Diagnosis Phrases</Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="list-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Service Performed Phrases</Text></View>
          <Text style={s.hint}>Manage service / work-done phrases used from Records → Edit Job.</Text>
          <TouchableOpacity testID="btn-manage-phrases" style={[s.secondaryBtn, { marginTop: 10 }]} onPress={() => setShowPhraseManager(true)}>
            <Ionicons name="create-outline" size={20} color={C.primary} /><Text style={s.secondaryBtnText}>Open Service Phrase Manager</Text>
          </TouchableOpacity>
        </View>

        <View style={[s.card, { borderColor: '#FCA5A5' }]}>
          <View style={s.cardHeader}><Ionicons name="warning-outline" size={22} color={C.red} /><Text style={[s.cardTitle, { color: C.red }]}>Danger Zone</Text></View>
          <TouchableOpacity testID="btn-clear-all" style={s.dangerBtn} onPress={handleClearAll}>
            <Ionicons name="trash-outline" size={20} color={C.red} /><Text style={s.dangerBtnText}>Clear All Records</Text>
          </TouchableOpacity>
        </View>

        <View style={s.card}>
          <Text style={s.aboutName}>{SHOP.name}</Text>
          <Text style={s.aboutTag}>{SHOP.tagline}</Text>
          <Text style={s.aboutAddr}>{SHOP.address}</Text>
          <View style={s.divider} />
          <Text style={s.aboutVer}>App Version 2.0 • Multi-Item Support</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <ServicePhraseLibrary visible={showPhraseManager} onClose={() => setShowPhraseManager(false)} />
      <DiagnosisPhraseLibrary visible={showDiagnosisLibrary} onClose={() => setShowDiagnosisLibrary(false)} />

      {toast && <View style={[s.toast, toast.err && s.toastErr]}><Text style={s.toastText}>{toast.msg}</Text></View>}
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: C.primary },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.secondary, gap: 12 },
  infoLabel: { fontSize: 14, color: C.textMuted },
  infoValue: { fontSize: 14, color: C.text, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.secondary, gap: 12 },
  switchLabel: { fontSize: 14, color: C.text, fontWeight: '600' },
  switchHint: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, marginTop: 16 },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: C.primaryFg },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 14 },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: C.primary },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FCA5A5', borderRadius: 12, paddingVertical: 14, marginTop: 8 },
  dangerBtnText: { fontSize: 15, fontWeight: '700', color: C.red },
  hint: { fontSize: 12, color: C.textMuted, lineHeight: 18 },
  warnBox: { flexDirection: 'row', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FCA5A5' },
  warnText: { flex: 1, fontSize: 12, color: C.red, lineHeight: 18, fontWeight: '600' },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  aboutName: { fontSize: 22, fontWeight: '900', color: C.primary, textAlign: 'center' },
  aboutTag: { fontSize: 14, color: C.textMuted, textAlign: 'center', fontWeight: '600', letterSpacing: 1 },
  aboutAddr: { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  aboutVer: { fontSize: 13, color: C.textMuted, textAlign: 'center', fontWeight: '600' },
  toast: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center' },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
