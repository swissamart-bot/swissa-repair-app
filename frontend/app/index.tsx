import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Modal, Image, KeyboardAvoidingView, Platform, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { createJob } from '../src/database';
import { C, COUNTRY_CODES, SHOP, ITEM_TYPES, ITEM_ICONS, generateJobNumber, COMMUNITY_MSG } from '../src/constants';
import { RepairJob, RepairItem, getJobTotals } from '../src/types';

export default function NewEntry() {
  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [issue, setIssue] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [savedJob, setSavedJob] = useState<RepairJob | null>(null);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [contactsList, setContactsList] = useState<any[]>([]);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactSearch, setContactSearch] = useState('');

  const [jobId] = useState(() => `job_${Date.now()}`);
  const [jobNumber] = useState(() => generateJobNumber());

  function showToastMsg(msg: string, err = false) {
    setToast({ msg, err }); setTimeout(() => setToast(null), 3000);
  }

  function toggleItem(type: string) {
    setSelectedItems(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  }

  async function pickContact() {
    try {
      if (Platform.OS === 'web') { showToastMsg('Contacts available on mobile only', true); return; }
      const Contacts = require('expo-contacts');
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Contacts access required.'); return; }
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name], sort: Contacts.SortTypes.FirstName });
      const mapped = data.filter((c: any) => c.phoneNumbers?.length).map((c: any) => ({ id: c.id || String(Math.random()), name: c.name || '', phone: c.phoneNumbers[0].number || '' }));
      setContactsList(mapped); setContactSearch(''); setShowContactPicker(true);
    } catch { showToastMsg('Could not load contacts', true); }
  }

  function selectContact(c: any) {
    setCustomerName(c.name);
    const raw = c.phone.replace(/[\s\-()]/g, '');
    if (raw.startsWith('+')) {
      const m = COUNTRY_CODES.find(cc => raw.startsWith(cc.code));
      if (m) { setCountryCode(m.code); setMobileNumber(raw.slice(m.code.length)); }
      else setMobileNumber(raw.replace(/^\+/, ''));
    } else setMobileNumber(raw);
    setShowContactPicker(false);
  }

  async function handleTakePhoto() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Camera access required.'); return; }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.3 });
      if (!result.canceled && result.assets[0]?.base64) {
        setPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch { showToastMsg('Camera not available', true); }
  }

  async function handlePickGallery() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Gallery access required.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.3 });
      if (!result.canceled && result.assets[0]?.base64) {
        setPhoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch { showToastMsg('Gallery not available', true); }
  }

  async function handleSave() {
    if (!customerName.trim()) { showToastMsg('Enter customer name', true); return; }
    if (!mobileNumber.trim()) { showToastMsg('Enter mobile number', true); return; }
    if (selectedItems.length === 0) { showToastMsg('Select at least one item type', true); return; }

    setSaving(true);
    const now = new Date().toISOString();
    const advance = parseFloat(advanceAmount) || 0;

    const job: Omit<RepairJob, 'items'> = {
      id: jobId, jobNumber, customerName: customerName.trim(), mobileNumber: mobileNumber.trim(),
      countryCode, receivedDate: new Date().toLocaleString(), advanceAmount: advance,
      overallNotes: '', googleReviewSent: false, createdAt: now, updatedAt: now,
    };

    const items: RepairItem[] = selectedItems.map((type, idx) => ({
      id: `item_${Date.now()}_${idx}`,
      jobId, itemNumber: idx + 1, itemType: type,
      brand: '', model: '', color: '', identification: '',
      description: issue.trim(), selectedPhrases: [],
      customerComplaint: '', accessoriesReceived: '',
      estimatedAmount: 0, finalAmount: 0, amountPaid: 0,
      technicianNotes: '',
      photos: photo && idx === 0 ? [photo] : [],
      status: 'Received', expectedDeliveryDate: '', warrantyDetails: '',
      delivered: false, deliveredDate: '', createdAt: now, updatedAt: now,
    }));

    try {
      await createJob(job, items);
      setSavedJob({ ...job, items });
      setShowReceipt(true);
      showToastMsg('Repair job saved!');
      setCustomerName(''); setMobileNumber(''); setSelectedItems([]); setIssue(''); setPhoto(null); setAdvanceAmount('');
    } catch (e: any) {
      showToastMsg('Save failed: ' + (e?.message || ''), true);
    } finally { setSaving(false); }
  }

  function shareReceiptWA() {
    if (!savedJob) return;
    const j = savedJob;
    const cleanPhone = (j.countryCode + j.mobileNumber).replace(/\D/g, '');
    const itemsList = j.items.map((i, idx) => `${idx + 1}. ${ITEM_ICONS[i.itemType] || ''} ${i.itemType}${i.description ? ' – ' + i.description : ''}`).join('\n');
    const msg = `🏪 *SWISSA — Watch & Opticals*\n${SHOP.address}\n\n📋 *REPAIR RECEIPT*\n\n🔖 *Job No: #${j.jobNumber}*\n👤 Customer: ${j.customerName}\n📱 Phone: ${j.countryCode} ${j.mobileNumber}\n📅 Date: ${j.receivedDate}\n\n*Items Received:*\n${itemsList}\n\n${j.advanceAmount > 0 ? `💵 Advance: ₹${j.advanceAmount}\n` : ''}Please save this number for updates.\nThank you for choosing SWISSA! 🙏\n\n${COMMUNITY_MSG}`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  const filteredContacts = contactsList.filter(c => { const q = contactSearch.toLowerCase(); return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q); });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.header}>
          <Text testID="header-title" style={s.headerTitle}>{SHOP.name}</Text>
          <Text style={s.headerSub}>{SHOP.tagline}</Text>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={s.sectionTitle}>New Repair Job  #{jobNumber}</Text>

          <TouchableOpacity testID="btn-contacts" style={s.contactsBtn} onPress={pickContact}>
            <Ionicons name="person-circle-outline" size={20} color={C.blue} />
            <Text style={s.contactsBtnText}>Pick from Contacts</Text>
          </TouchableOpacity>

          <View style={s.field}>
            <Text style={s.label}>CUSTOMER NAME</Text>
            <TextInput testID="input-name" style={s.input} value={customerName} onChangeText={setCustomerName} placeholder="Customer name" placeholderTextColor={C.textMuted} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>MOBILE NUMBER</Text>
            <View style={s.phoneRow}>
              <TouchableOpacity testID="country-code-picker" style={s.countryBtn} onPress={() => setShowCountryPicker(true)}>
                <Text style={s.countryText}>{COUNTRY_CODES.find(c => c.code === countryCode)?.flag} {countryCode}</Text>
                <Ionicons name="chevron-down" size={14} color={C.textMuted} />
              </TouchableOpacity>
              <TextInput testID="input-phone" style={[s.input, { flex: 1 }]} value={mobileNumber} onChangeText={setMobileNumber} placeholder="Mobile number" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
            </View>
          </View>

          <View style={s.field}>
            <Text style={s.label}>SELECT ITEMS (tap multiple)</Text>
            <View style={s.itemRow}>
              {ITEM_TYPES.map(type => {
                const selected = selectedItems.includes(type);
                const count = selectedItems.filter(t => t === type).length;
                return (
                  <TouchableOpacity key={type} testID={`item-${type.toLowerCase().replace(' ', '-')}`}
                    style={[s.itemBtn, selected && s.itemBtnActive]}
                    onPress={() => toggleItem(type)}>
                    <Text style={s.itemIcon}>{ITEM_ICONS[type]}</Text>
                    <Text style={[s.itemLabel, selected && s.itemLabelActive]}>{type}</Text>
                    {selected && <View style={s.itemCheck}><Ionicons name="checkmark" size={14} color="#FFF" /></View>}
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedItems.length > 0 && (
              <Text style={s.itemSummary}>{selectedItems.length} item{selectedItems.length > 1 ? 's' : ''} selected: {selectedItems.map(t => ITEM_ICONS[t]).join(' ')}</Text>
            )}
          </View>

          <View style={s.field}>
            <Text style={s.label}>ISSUE / FAULT</Text>
            <TextInput testID="input-issue" style={[s.input, s.textarea]} value={issue} onChangeText={setIssue} placeholder="Describe the problem..." placeholderTextColor={C.textMuted} multiline numberOfLines={3} textAlignVertical="top" />
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

          <View style={s.field}>
            <Text style={s.label}>ADVANCE PAYMENT (₹) — optional</Text>
            <TextInput testID="input-advance" style={s.input} value={advanceAmount} onChangeText={setAdvanceAmount} placeholder="0" placeholderTextColor={C.textMuted} keyboardType="numeric" />
          </View>

          <TouchableOpacity testID="btn-save" style={s.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={C.primaryFg} /> : (
              <><Ionicons name="checkmark-circle" size={20} color={C.primaryFg} /><Text style={s.saveBtnText}>Save & Send Receipt</Text></>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Country Code Picker */}
        <Modal visible={showCountryPicker} transparent animationType="slide">
          <View style={s.modalOverlay}><View style={s.modalBox}>
            <View style={s.modalHeader}><Text style={s.modalTitle}>Country Code</Text><TouchableOpacity testID="close-country" onPress={() => setShowCountryPicker(false)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity></View>
            <FlatList data={COUNTRY_CODES} keyExtractor={i => i.code} renderItem={({ item }) => (
              <TouchableOpacity style={s.modalItem} onPress={() => { setCountryCode(item.code); setShowCountryPicker(false); }}><Text style={s.modalItemText}>{item.flag}  {item.code}</Text></TouchableOpacity>
            )} />
          </View></View>
        </Modal>

        {/* Contact Picker */}
        <Modal visible={showContactPicker} transparent animationType="slide">
          <View style={s.modalOverlay}><View style={[s.modalBox, { maxHeight: '80%' }]}>
            <View style={s.modalHeader}><Text style={s.modalTitle}>Pick Contact</Text><TouchableOpacity onPress={() => setShowContactPicker(false)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity></View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}><TextInput style={s.input} value={contactSearch} onChangeText={setContactSearch} placeholder="Search..." placeholderTextColor={C.textMuted} /></View>
            <FlatList data={filteredContacts} keyExtractor={i => i.id} renderItem={({ item }) => (
              <TouchableOpacity style={s.modalItem} onPress={() => selectContact(item)}><Text style={[s.modalItemText, { fontWeight: '700' }]}>{item.name}</Text><Text style={{ fontSize: 13, color: C.textMuted }}>{item.phone}</Text></TouchableOpacity>
            )} ListEmptyComponent={<Text style={{ padding: 20, color: C.textMuted, textAlign: 'center' }}>No contacts</Text>} />
          </View></View>
        </Modal>

        {/* Receipt Modal */}
        <Modal visible={showReceipt} transparent animationType="fade">
          <View style={s.receiptOverlay}><ScrollView contentContainerStyle={s.receiptScroll}>
            <View style={s.receiptBox}>
              <TouchableOpacity testID="close-receipt" style={s.receiptClose} onPress={() => setShowReceipt(false)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity>
              <Text style={s.receiptShop}>{SHOP.name}</Text>
              <Text style={s.receiptTag}>{SHOP.tagline}</Text>
              <Text style={s.receiptAddr}>{SHOP.address}</Text>
              <View style={s.divider} />
              {savedJob && <>
                <Text style={s.receiptJobNo}>Job No: #{savedJob.jobNumber}</Text>
                <Text style={s.receiptCust}>{savedJob.customerName} • {savedJob.countryCode} {savedJob.mobileNumber}</Text>
                <View style={s.divider} />
                {savedJob.items.map((item, idx) => (
                  <View key={item.id} style={s.receiptItem}>
                    <Text style={s.receiptItemTitle}>{idx + 1}. {ITEM_ICONS[item.itemType]} {item.itemType}</Text>
                    {item.description ? <Text style={s.receiptItemDesc}>Issue: {item.description}</Text> : null}
                  </View>
                ))}
                {savedJob.advanceAmount > 0 && <>
                  <View style={s.divider} />
                  <Text style={s.receiptAdvance}>Advance Paid: ₹{savedJob.advanceAmount}</Text>
                </>}
              </>}
              <View style={s.divider} />
              <TouchableOpacity testID="btn-receipt-wa" style={s.waBtn} onPress={shareReceiptWA}>
                <Ionicons name="logo-whatsapp" size={20} color="#FFF" /><Text style={s.waBtnText}>Send Receipt via WhatsApp</Text>
              </TouchableOpacity>
            </View>
          </ScrollView></View>
        </Modal>

        {toast && <View style={[s.toast, toast.err && s.toastErr]}><Text style={s.toastText}>{toast.msg}</Text></View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.surface, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 28, fontWeight: '900', color: C.primary, letterSpacing: -1 },
  headerSub: { fontSize: 13, color: C.textMuted, fontWeight: '600', letterSpacing: 1, marginTop: 2 },
  scroll: { flex: 1 }, scrollContent: { padding: 20 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: C.primary, marginBottom: 16 },
  contactsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 10, paddingVertical: 12, marginBottom: 20 },
  contactsBtnText: { fontSize: 15, fontWeight: '700', color: C.blue },
  field: { marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 1.5, marginBottom: 8 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: C.text },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  phoneRow: { flexDirection: 'row', gap: 10 },
  countryBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, gap: 6 },
  countryText: { fontSize: 15, color: C.text, fontWeight: '600' },
  itemRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  itemBtn: { alignItems: 'center', backgroundColor: C.surface, borderWidth: 2, borderColor: C.border, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, gap: 6, minWidth: 80, position: 'relative' },
  itemBtnActive: { borderColor: C.primary, backgroundColor: C.primary },
  itemIcon: { fontSize: 28 },
  itemLabel: { fontSize: 12, fontWeight: '700', color: C.text },
  itemLabelActive: { color: C.primaryFg },
  itemCheck: { position: 'absolute', top: 4, right: 4, backgroundColor: C.green800, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  itemSummary: { fontSize: 13, color: C.green800, fontWeight: '600', marginTop: 10 },
  photoRow: { flexDirection: 'row', gap: 12 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 14 },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: C.primary },
  photoPreview: { marginTop: 12, position: 'relative' },
  previewImg: { width: '100%', height: 200, borderRadius: 10, backgroundColor: C.secondary },
  removePhoto: { position: 'absolute', top: 8, right: 8 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, marginTop: 8 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: C.primaryFg },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.primary },
  modalItem: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  modalItemText: { fontSize: 16, color: C.text },
  // Receipt
  receiptOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  receiptScroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  receiptBox: { backgroundColor: C.surface, borderRadius: 16, padding: 24, position: 'relative' },
  receiptClose: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  receiptShop: { fontSize: 26, fontWeight: '900', color: C.primary, textAlign: 'center', letterSpacing: -1 },
  receiptTag: { fontSize: 13, color: C.textMuted, textAlign: 'center', fontWeight: '600', letterSpacing: 1 },
  receiptAddr: { fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 16 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  receiptJobNo: { fontSize: 18, fontWeight: '800', color: C.primary, textAlign: 'center' },
  receiptCust: { fontSize: 14, color: C.textMuted, textAlign: 'center', marginTop: 4 },
  receiptItem: { backgroundColor: C.bg, borderRadius: 8, padding: 12, marginBottom: 8 },
  receiptItemTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  receiptItemDesc: { fontSize: 13, color: C.textMuted, marginTop: 4 },
  receiptAdvance: { fontSize: 15, fontWeight: '700', color: C.green800, textAlign: 'center' },
  waBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.whatsapp, borderRadius: 12, paddingVertical: 14, marginTop: 8 },
  waBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  toast: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center' },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
