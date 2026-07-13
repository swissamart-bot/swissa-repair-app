import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Switch, ActivityIndicator, Platform, FlatList, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { getJobCount, getConfig, setConfig, exportData, importData, clearAllRecords, getCustomPhrases, addCustomPhrase, deleteCustomPhrase, getAllJobs } from '../src/database';
import { C, SHOP, ITEM_TYPES, DEFAULT_PHRASES } from '../src/constants';
import { CustomPhrase } from '../src/types';

export default function Settings() {
  const [jobCount, setJobCount] = useState(0);
  const [lastBackup, setLastBackup] = useState<string|null>(null);
  const [autoBackup, setAutoBackup] = useState(false);
  const [reviewLink, setReviewLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{msg:string;err:boolean}|null>(null);
  // Phrase management
  const [showPhraseManager, setShowPhraseManager] = useState(false);
  const [phraseItemType, setPhraseItemType] = useState('Watch');
  const [customPhrasesList, setCustomPhrasesList] = useState<CustomPhrase[]>([]);
  const [newPhrase, setNewPhrase] = useState('');

  useFocusEffect(useCallback(() => { loadSettings(); }, []));

  async function loadSettings() {
    setJobCount(await getJobCount());
    setLastBackup(await getConfig('lastBackupTime'));
    const auto = await getConfig('autoBackup');
    setAutoBackup(auto === 'true');
    const link = await getConfig('googleReviewLink');
    setReviewLink(link || '');
  }

  function showToastMsg(msg: string, err = false) { setToast({ msg, err }); setTimeout(() => setToast(null), 3000); }

  async function toggleAutoBackup(value: boolean) {
    setAutoBackup(value);
    await setConfig('autoBackup', value ? 'true' : 'false');
    showToastMsg(value ? 'Auto backup enabled (9 PM)' : 'Auto backup disabled');
  }

  async function saveReviewLink() {
    await setConfig('googleReviewLink', reviewLink.trim());
    showToastMsg('Google Review link saved!');
  }

  async function handleBackupNow() {
    setLoading(true);
    try {
      const data = await exportData();
      if (Platform.OS === 'web') {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `swissa_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click(); URL.revokeObjectURL(url);
      } else {
        const dir = FileSystem.documentDirectory + 'SwissaBackups/';
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        const filename = `swissa_backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
        const fileUri = dir + filename;
        await FileSystem.writeAsStringAsync(fileUri, data);
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Save Swissa Backup' });
        else showToastMsg('Saved to app storage');
      }
      await setConfig('lastBackupTime', new Date().toISOString());
      setLastBackup(new Date().toISOString());
      showToastMsg('Backup created!');
    } catch (e: any) { showToastMsg('Backup failed: '+(e?.message||''), true); }
    finally { setLoading(false); }
  }

  async function handleImport() {
    setLoading(true);
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
        input.onchange = async (e: any) => { const f = e.target.files?.[0]; if (!f) return; const t = await f.text(); const c = await importData(t); await loadSettings(); showToastMsg(`Imported ${c} jobs!`); setLoading(false); };
        input.click(); return;
      }
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (!result.canceled && result.assets?.[0]) {
        const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
        const count = await importData(content);
        await loadSettings();
        showToastMsg(`Imported ${count} jobs!`);
      }
    } catch (e: any) { showToastMsg('Import failed: '+(e?.message||''), true); }
    finally { setLoading(false); }
  }

  async function handleExportCSV() {
    setLoading(true);
    try {
      const jobs = await getAllJobs();
      let csv = 'Job No,Customer,Phone,Item Type,Brand,Description,Status,Estimate,Final,Balance\n';
      for (const j of jobs) {
        for (const i of j.items) {
          csv += `${j.jobNumber},"${j.customerName}",${j.countryCode}${j.mobileNumber},${i.itemType},"${i.brand}","${i.description}",${i.status},${i.estimatedAmount},${i.finalAmount},${(i.finalAmount||i.estimatedAmount)-(i.amountPaid||0)}\n`;
        }
      }
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `swissa_customers_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
      } else {
        const fileUri = FileSystem.documentDirectory + `swissa_customers_${new Date().toISOString().split('T')[0]}.csv`;
        await FileSystem.writeAsStringAsync(fileUri, csv);
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Customer List' });
      }
      showToastMsg('CSV exported!');
    } catch (e: any) { showToastMsg('Export failed: '+(e?.message||''), true); }
    finally { setLoading(false); }
  }

  async function handleClearAll() {
    Alert.alert('⚠️ Clear All Records', 'This will permanently delete ALL repair jobs and items.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Everything', style: 'destructive', onPress: () => {
        Alert.alert('Final Confirmation', 'Are you absolutely sure?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Yes, Clear All', style: 'destructive', onPress: async () => { await clearAllRecords(); await loadSettings(); showToastMsg('All records cleared'); }},
        ]);
      }},
    ]);
  }

  // Phrase Management
  async function loadPhrases(type: string) {
    setPhraseItemType(type);
    const phrases = await getCustomPhrases(type);
    setCustomPhrasesList(phrases);
  }

  async function handleAddPhrase() {
    if (!newPhrase.trim()) return;
    const id = `phrase_${Date.now()}`;
    await addCustomPhrase(id, phraseItemType, newPhrase.trim());
    setNewPhrase('');
    await loadPhrases(phraseItemType);
    showToastMsg('Phrase added!');
  }

  async function handleDeletePhrase(id: string) {
    Alert.alert('Delete Phrase', 'Remove this custom phrase?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCustomPhrase(id); await loadPhrases(phraseItemType); showToastMsg('Phrase deleted'); }},
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}><Text style={s.headerTitle}>Settings</Text></View>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>

        {/* Backup */}
        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="cloud-upload-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Database Backup</Text></View>
          <View style={s.infoRow}><Text style={s.infoLabel}>Jobs in database</Text><Text testID="job-count" style={s.infoValue}>{jobCount}</Text></View>
          <View style={s.infoRow}><Text style={s.infoLabel}>Last backup</Text><Text testID="last-backup" style={s.infoValue}>{lastBackup ? new Date(lastBackup).toLocaleString() : 'Never'}</Text></View>
          <View style={s.switchRow}>
            <View style={{flex:1}}><Text style={s.switchLabel}>Auto backup at 9 PM</Text><Text style={s.switchHint}>Saves to app storage</Text></View>
            <Switch testID="auto-backup-toggle" value={autoBackup} onValueChange={toggleAutoBackup} trackColor={{false:C.border,true:C.green100}} thumbColor={autoBackup?C.green800:C.textMuted} />
          </View>
          <TouchableOpacity testID="btn-backup-now" style={s.primaryBtn} onPress={handleBackupNow} disabled={loading}>
            {loading ? <ActivityIndicator color={C.primaryFg} /> : <><Ionicons name="download-outline" size={20} color={C.primaryFg} /><Text style={s.primaryBtnText}>Backup Now</Text></>}
          </TouchableOpacity>
        </View>

        {/* Import */}
        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="cloud-download-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Restore / Import</Text></View>
          <TouchableOpacity testID="btn-import" style={s.secondaryBtn} onPress={() => Alert.alert('Restore', 'Import backup file?', [{ text: 'Cancel' }, { text: 'Continue', onPress: handleImport }])} disabled={loading}>
            <Ionicons name="folder-open-outline" size={20} color={C.primary} /><Text style={s.secondaryBtnText}>Import Backup File</Text>
          </TouchableOpacity>
        </View>

        {/* CSV Export */}
        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="grid-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Export Customer List</Text></View>
          <TouchableOpacity testID="btn-export-csv" style={s.secondaryBtn} onPress={handleExportCSV} disabled={loading}>
            <Ionicons name="document-text-outline" size={20} color={C.primary} /><Text style={s.secondaryBtnText}>Export as Excel/CSV</Text>
          </TouchableOpacity>
        </View>

        {/* Google Review Link */}
        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="star-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Google Review Link</Text></View>
          <Text style={s.hint}>This link will be included in delivery WhatsApp messages when toggled on.</Text>
          <TextInput testID="review-link-input" style={[s.input, {marginTop:10}]} value={reviewLink} onChangeText={setReviewLink} placeholder="Paste your Google Review link..." placeholderTextColor={C.textMuted} />
          <TouchableOpacity testID="btn-save-review" style={[s.secondaryBtn, {marginTop:10}]} onPress={saveReviewLink}>
            <Ionicons name="checkmark-circle-outline" size={20} color={C.primary} /><Text style={s.secondaryBtnText}>Save Link</Text>
          </TouchableOpacity>
        </View>

        {/* Phrase Management */}
        <View style={s.card}>
          <View style={s.cardHeader}><Ionicons name="list-outline" size={22} color={C.primary} /><Text style={s.cardTitle}>Manage Phrases</Text></View>
          <Text style={s.hint}>Add or remove custom repair phrases for each item type.</Text>
          <TouchableOpacity testID="btn-manage-phrases" style={[s.secondaryBtn, {marginTop:10}]} onPress={() => { loadPhrases('Watch'); setShowPhraseManager(true); }}>
            <Ionicons name="create-outline" size={20} color={C.primary} /><Text style={s.secondaryBtnText}>Open Phrase Manager</Text>
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <View style={[s.card, {borderColor:'#FCA5A5'}]}>
          <View style={s.cardHeader}><Ionicons name="warning-outline" size={22} color={C.red} /><Text style={[s.cardTitle,{color:C.red}]}>Danger Zone</Text></View>
          <TouchableOpacity testID="btn-clear-all" style={s.dangerBtn} onPress={handleClearAll}>
            <Ionicons name="trash-outline" size={20} color={C.red} /><Text style={s.dangerBtnText}>Clear All Records</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <View style={s.card}>
          <Text style={s.aboutName}>{SHOP.name}</Text>
          <Text style={s.aboutTag}>{SHOP.tagline}</Text>
          <Text style={s.aboutAddr}>{SHOP.address}</Text>
          <View style={s.divider} />
          <Text style={s.aboutVer}>App Version 2.0 • Multi-Item Support</Text>
        </View>

        <View style={{height:40}} />
      </ScrollView>

      {/* Phrase Manager Modal */}
      <Modal visible={showPhraseManager} transparent animationType="slide">
        <View style={s.modalOverlay}><View style={[s.modalBox, {maxHeight:'85%'}]}>
          <View style={s.modalHeader}><Text style={s.modalTitle}>Phrase Manager</Text><TouchableOpacity onPress={() => setShowPhraseManager(false)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal:16,paddingVertical:10,gap:8}}>
            {ITEM_TYPES.map(t => (
              <TouchableOpacity key={t} style={[s.phraseTypeBtn, phraseItemType===t && s.phraseTypeBtnActive]} onPress={() => loadPhrases(t)}>
                <Text style={[s.phraseTypeText, phraseItemType===t && s.phraseTypeTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{paddingHorizontal:16}}>
            <Text style={{fontSize:13,fontWeight:'700',color:C.textMuted,marginBottom:6}}>DEFAULT PHRASES</Text>
            {(DEFAULT_PHRASES[phraseItemType]||[]).map((p,i) => (
              <View key={i} style={s.phraseRow}><Text style={s.phraseText}>{p}</Text><Text style={{fontSize:11,color:C.textMuted}}>default</Text></View>
            ))}
            <Text style={{fontSize:13,fontWeight:'700',color:C.blue,marginTop:16,marginBottom:6}}>CUSTOM PHRASES</Text>
            {customPhrasesList.length === 0 && <Text style={{color:C.textMuted,fontSize:13,marginBottom:8}}>No custom phrases yet</Text>}
            {customPhrasesList.map(p => (
              <View key={p.id} style={s.phraseRow}>
                <Text style={s.phraseText}>{p.phrase}</Text>
                <TouchableOpacity onPress={() => handleDeletePhrase(p.id)}><Ionicons name="trash-outline" size={16} color={C.red} /></TouchableOpacity>
              </View>
            ))}
            <View style={{flexDirection:'row',gap:8,marginTop:12,marginBottom:20}}>
              <TextInput style={[s.input,{flex:1}]} value={newPhrase} onChangeText={setNewPhrase} placeholder="New phrase..." placeholderTextColor={C.textMuted} />
              <TouchableOpacity testID="btn-add-phrase" style={s.addPhraseBtn} onPress={handleAddPhrase}>
                <Ionicons name="add" size={20} color={C.primaryFg} />
              </TouchableOpacity>
            </View>
          </View>
        </View></View>
      </Modal>

      {toast && <View style={[s.toast, toast.err && s.toastErr]}><Text style={s.toastText}>{toast.msg}</Text></View>}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},
  header:{backgroundColor:C.surface,paddingHorizontal:20,paddingVertical:16,borderBottomWidth:1,borderBottomColor:C.border},
  headerTitle:{fontSize:24,fontWeight:'800',color:C.primary},
  scroll:{flex:1},scrollContent:{padding:20},
  card:{backgroundColor:C.surface,borderRadius:12,borderWidth:1,borderColor:C.border,padding:20,marginBottom:16},
  cardHeader:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:12},
  cardTitle:{fontSize:18,fontWeight:'700',color:C.primary},
  infoRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.secondary},
  infoLabel:{fontSize:14,color:C.textMuted},infoValue:{fontSize:14,color:C.text,fontWeight:'700'},
  switchRow:{flexDirection:'row',alignItems:'center',paddingVertical:14,borderBottomWidth:1,borderBottomColor:C.secondary,gap:12},
  switchLabel:{fontSize:14,color:C.text,fontWeight:'600'},switchHint:{fontSize:12,color:C.textMuted,marginTop:2},
  primaryBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:C.primary,borderRadius:12,paddingVertical:16,marginTop:16},
  primaryBtnText:{fontSize:16,fontWeight:'700',color:C.primaryFg},
  secondaryBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:12,paddingVertical:14},
  secondaryBtnText:{fontSize:15,fontWeight:'700',color:C.primary},
  dangerBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:'#FEF2F2',borderWidth:1,borderColor:'#FCA5A5',borderRadius:12,paddingVertical:14,marginTop:8},
  dangerBtnText:{fontSize:15,fontWeight:'700',color:C.red},
  hint:{fontSize:12,color:C.textMuted,lineHeight:18},
  input:{backgroundColor:C.bg,borderWidth:1,borderColor:C.border,borderRadius:10,paddingHorizontal:14,paddingVertical:12,fontSize:15,color:C.text},
  divider:{height:1,backgroundColor:C.border,marginVertical:16},
  aboutName:{fontSize:22,fontWeight:'900',color:C.primary,textAlign:'center'},
  aboutTag:{fontSize:14,color:C.textMuted,textAlign:'center',fontWeight:'600',letterSpacing:1},
  aboutAddr:{fontSize:12,color:C.textMuted,textAlign:'center',marginTop:8,lineHeight:18},
  aboutVer:{fontSize:13,color:C.textMuted,textAlign:'center',fontWeight:'600'},
  // Modal
  modalOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'flex-end'},
  modalBox:{backgroundColor:C.surface,borderTopLeftRadius:20,borderTopRightRadius:20,paddingBottom:20},
  modalHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:20,borderBottomWidth:1,borderBottomColor:C.border},
  modalTitle:{fontSize:18,fontWeight:'700',color:C.primary},
  phraseTypeBtn:{paddingHorizontal:14,paddingVertical:8,borderRadius:20,backgroundColor:C.secondary,borderWidth:1,borderColor:C.border},
  phraseTypeBtnActive:{backgroundColor:C.primary,borderColor:C.primary},
  phraseTypeText:{fontSize:13,fontWeight:'600',color:C.textMuted},
  phraseTypeTextActive:{color:C.primaryFg},
  phraseRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.border},
  phraseText:{fontSize:14,color:C.text},
  addPhraseBtn:{backgroundColor:C.primary,borderRadius:10,paddingHorizontal:14,paddingVertical:12,alignItems:'center',justifyContent:'center'},
  toast:{position:'absolute',bottom:100,left:20,right:20,backgroundColor:'#166534',borderRadius:10,padding:14,alignItems:'center'},
  toastErr:{backgroundColor:C.red},
  toastText:{color:'#FFF',fontSize:14,fontWeight:'600'},
});
