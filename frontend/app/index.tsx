import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, Modal, Image, KeyboardAvoidingView,
  Platform, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { addRecord } from '../src/database';
import { C, COUNTRY_CODES, SHOP, ITEM_TYPES } from '../src/constants';
import { RepairRecord } from '../src/types';

export default function NewEntry() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [selectedItem, setSelectedItem] = useState('');
  const [issue, setIssue] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [savedRecord, setSavedRecord] = useState<RepairRecord | null>(null);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedCountry = COUNTRY_CODES.find(c => c.code === countryCode);

  function showToastMsg(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleTakePhoto() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Camera access is required to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 });
      if (!result.canceled && result.assets[0]?.base64) {
        setPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch (e) {
      showToastMsg('Camera not available', true);
    }
  }

  async function handlePickGallery() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Gallery access is required.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5 });
      if (!result.canceled && result.assets[0]?.base64) {
        setPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch (e) {
      showToastMsg('Gallery not available', true);
    }
  }

  async function handleSave() {
    if (!name.trim()) { showToastMsg('Please enter customer name', true); return; }
    if (!phone.trim()) { showToastMsg('Please enter mobile number', true); return; }
    if (!selectedItem) { showToastMsg('Please select an item type', true); return; }

    setSaving(true);
    const record: RepairRecord = {
      id: Date.now().toString(),
      name: name.trim(),
      phone: phone.trim(),
      countryCode,
      item: selectedItem,
      issue: issue.trim(),
      photo,
      status: 'Pending',
      date: new Date().toLocaleString(),
      repairedAt: null,
      deliveredAt: null,
    };

    try {
      await addRecord(record);
      setSavedRecord(record);
      setShowReceipt(true);
      showToastMsg('Record saved successfully!');
      setName(''); setPhone(''); setSelectedItem(''); setIssue(''); setPhoto(null);
    } catch (e) {
      showToastMsg('Failed to save record', true);
    } finally {
      setSaving(false);
    }
  }

  function shareReceiptWA() {
    if (!savedRecord) return;
    const r = savedRecord;
    const cleanPhone = (r.countryCode + r.phone).replace(/\D/g, '');
    const msg = `🏪 *SWISSA — Watch & Opticals*\n${SHOP.address}\n\n📋 *REPAIR RECEIPT*\n\n🔖 Job ID: #${r.id}\n👤 Name: ${r.name}\n📱 Phone: ${r.countryCode} ${r.phone}\n🔧 Item: ${r.item}\n❓ Issue: ${r.issue || 'N/A'}\n📅 Date In: ${r.date}\n📊 Status: ${r.status}\n\nHI ${r.name.toUpperCase()}! IT'S OUR SINCERE REQUEST TO PLEASE SAVE THIS NUMBER TO RECEIVE UPDATES ABOUT YOUR ${r.item.toUpperCase()}.\n\nThank you for choosing SWISSA! 🙏\nWe will notify you once your item is ready.`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.header}>
          <Text testID="header-title" style={s.headerTitle}>{SHOP.name}</Text>
          <Text style={s.headerSub}>{SHOP.tagline}</Text>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={s.sectionTitle}>New Customer Entry</Text>

          <View style={s.field}>
            <Text style={s.label}>FULL NAME</Text>
            <TextInput testID="input-name" style={s.input} value={name} onChangeText={setName}
              placeholder="Customer name" placeholderTextColor={C.textMuted} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>MOBILE NUMBER</Text>
            <View style={s.phoneRow}>
              <TouchableOpacity testID="country-code-picker" style={s.countryBtn} onPress={() => setShowCountryPicker(true)}>
                <Text style={s.countryText}>{selectedCountry?.flag} {countryCode}</Text>
                <Ionicons name="chevron-down" size={14} color={C.textMuted} />
              </TouchableOpacity>
              <TextInput testID="input-phone" style={[s.input, { flex: 1 }]} value={phone}
                onChangeText={setPhone} placeholder="Mobile number" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
            </View>
          </View>

          <View style={s.field}>
            <Text style={s.label}>ITEM TYPE</Text>
            <View style={s.itemRow}>
              {ITEM_TYPES.map(it => (
                <TouchableOpacity key={it.key} testID={`item-${it.key.toLowerCase()}`}
                  style={[s.itemBtn, selectedItem === it.key && s.itemBtnActive]}
                  onPress={() => setSelectedItem(it.key)}>
                  <Text style={s.itemIcon}>{it.icon}</Text>
                  <Text style={[s.itemLabel, selectedItem === it.key && s.itemLabelActive]}>{it.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.field}>
            <Text style={s.label}>ISSUE / FAULT</Text>
            <TextInput testID="input-issue" style={[s.input, s.textarea]} value={issue}
              onChangeText={setIssue} placeholder="Describe the problem..." placeholderTextColor={C.textMuted}
              multiline numberOfLines={3} textAlignVertical="top" />
          </View>

          <View style={s.field}>
            <Text style={s.label}>PHOTO OF ITEM</Text>
            <View style={s.photoRow}>
              <TouchableOpacity testID="btn-camera" style={s.photoBtn} onPress={handleTakePhoto}>
                <Ionicons name="camera-outline" size={20} color={C.primary} />
                <Text style={s.photoBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="btn-gallery" style={s.photoBtn} onPress={handlePickGallery}>
                <Ionicons name="images-outline" size={20} color={C.primary} />
                <Text style={s.photoBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
            {photo && (
              <View style={s.photoPreview}>
                <Image source={{ uri: photo }} style={s.previewImg} />
                <TouchableOpacity testID="btn-remove-photo" style={s.removePhoto} onPress={() => setPhoto(null)}>
                  <Ionicons name="close-circle" size={28} color={C.red} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          <TouchableOpacity testID="btn-save" style={s.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={C.primaryFg} /> : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={C.primaryFg} />
                <Text style={s.saveBtnText}>Save & Send Receipt</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Country Code Picker */}
        <Modal visible={showCountryPicker} transparent animationType="slide">
          <View style={s.modalOverlay}>
            <View style={s.modalBox}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Select Country Code</Text>
                <TouchableOpacity testID="close-country-picker" onPress={() => setShowCountryPicker(false)}>
                  <Ionicons name="close" size={24} color={C.primary} />
                </TouchableOpacity>
              </View>
              <FlatList data={COUNTRY_CODES} keyExtractor={item => item.code}
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.countryItem}
                    onPress={() => { setCountryCode(item.code); setShowCountryPicker(false); }}>
                    <Text style={s.countryItemText}>{item.flag}  {item.code}</Text>
                  </TouchableOpacity>
                )} />
            </View>
          </View>
        </Modal>

        {/* Receipt Modal */}
        <Modal visible={showReceipt} transparent animationType="fade">
          <View style={s.modalOverlay}>
            <ScrollView contentContainerStyle={s.receiptScrollContent}>
              <View style={s.receiptBox}>
                <TouchableOpacity testID="close-receipt" style={s.receiptClose} onPress={() => setShowReceipt(false)}>
                  <Ionicons name="close" size={24} color={C.primary} />
                </TouchableOpacity>
                <Text style={s.receiptShopName}>{SHOP.name}</Text>
                <Text style={s.receiptTagline}>{SHOP.tagline}</Text>
                <Text style={s.receiptAddr}>{SHOP.address}</Text>
                <View style={s.divider} />
                {savedRecord?.photo && <Image source={{ uri: savedRecord.photo }} style={s.receiptPhoto} />}
                <View style={s.divider} />
                {savedRecord && (
                  <>
                    <ReceiptRow label="Job ID" value={`#${savedRecord.id}`} />
                    <ReceiptRow label="Name" value={savedRecord.name} />
                    <ReceiptRow label="Phone" value={`${savedRecord.countryCode} ${savedRecord.phone}`} />
                    <ReceiptRow label="Item" value={savedRecord.item} />
                    {savedRecord.issue ? <ReceiptRow label="Issue" value={savedRecord.issue} /> : null}
                    <ReceiptRow label="Date In" value={savedRecord.date} />
                    <ReceiptRow label="Status" value={savedRecord.status} valueColor={C.amber800} />
                  </>
                )}
                <View style={s.divider} />
                <Text style={s.receiptMsg}>
                  HI {savedRecord?.name.toUpperCase()}! PLEASE SAVE THIS NUMBER TO RECEIVE UPDATES ABOUT YOUR {savedRecord?.item.toUpperCase()}.
                </Text>
                <Text style={s.receiptThank}>Thank you for choosing SWISSA! 🙏</Text>
                <TouchableOpacity testID="btn-share-receipt-wa" style={s.waBtn} onPress={shareReceiptWA}>
                  <Ionicons name="logo-whatsapp" size={20} color="#FFF" />
                  <Text style={s.waBtnText}>Send Receipt via WhatsApp</Text>
                </TouchableOpacity>
                <Text style={s.receiptHint}>📸 Screenshot this card to share with photo via WhatsApp</Text>
              </View>
            </ScrollView>
          </View>
        </Modal>

        {toast && (
          <View style={[s.toast, toast.err && s.toastErr]}>
            <Text style={s.toastText}>{toast.msg}</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ReceiptRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.receiptRow}>
      <Text style={s.receiptLabel}>{label}</Text>
      <Text style={[s.receiptValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.surface, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 28, fontWeight: '900', color: C.primary, letterSpacing: -1 },
  headerSub: { fontSize: 13, color: C.textMuted, fontWeight: '600', letterSpacing: 1, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: C.primary, marginBottom: 20 },
  field: { marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 1.5, marginBottom: 8 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: C.text },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  phoneRow: { flexDirection: 'row', gap: 10 },
  countryBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, gap: 6 },
  countryText: { fontSize: 15, color: C.text, fontWeight: '600' },
  itemRow: { flexDirection: 'row', gap: 12 },
  itemBtn: { flex: 1, alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 16, gap: 6 },
  itemBtnActive: { borderColor: C.primary, backgroundColor: C.primary },
  itemIcon: { fontSize: 28 },
  itemLabel: { fontSize: 13, fontWeight: '700', color: C.text },
  itemLabelActive: { color: C.primaryFg },
  photoRow: { flexDirection: 'row', gap: 12 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 14 },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: C.primary },
  photoPreview: { marginTop: 12, position: 'relative' },
  previewImg: { width: '100%', height: 200, borderRadius: 10, backgroundColor: C.secondary },
  removePhoto: { position: 'absolute', top: 8, right: 8 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, marginTop: 8 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: C.primaryFg },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.primary },
  countryItem: { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  countryItemText: { fontSize: 16, color: C.text },
  receiptScrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  receiptBox: { backgroundColor: C.surface, borderRadius: 16, padding: 24, position: 'relative' },
  receiptClose: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  receiptShopName: { fontSize: 26, fontWeight: '900', color: C.primary, textAlign: 'center', letterSpacing: -1 },
  receiptTagline: { fontSize: 13, color: C.textMuted, textAlign: 'center', fontWeight: '600', letterSpacing: 1 },
  receiptAddr: { fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 16 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  receiptPhoto: { width: '100%', height: 180, borderRadius: 10, marginBottom: 8 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  receiptLabel: { fontSize: 13, color: C.textMuted, fontWeight: '600' },
  receiptValue: { fontSize: 14, color: C.text, fontWeight: '700', maxWidth: '60%', textAlign: 'right' },
  receiptMsg: { fontSize: 12, color: C.text, fontWeight: '700', textAlign: 'center', lineHeight: 18, marginTop: 8 },
  receiptThank: { fontSize: 14, color: C.textMuted, textAlign: 'center', marginTop: 8 },
  waBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.whatsapp, borderRadius: 12, paddingVertical: 14, marginTop: 16 },
  waBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  receiptHint: { fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 12 },
  toast: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center' },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
