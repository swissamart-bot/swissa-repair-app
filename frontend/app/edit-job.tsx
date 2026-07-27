import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Modal,
  Image, KeyboardAvoidingView, Platform, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { getJob, updateJob, updateItem, setConfig } from '../src/database';
import { C, COUNTRY_CODES, ITEM_TYPES, ITEM_ICONS, getStatusColor } from '../src/constants';
import {
  RepairJob, RepairItem, formatINR, ITEM_STATUSES, getItemAmount,
} from '../src/types';
import DiagnosisSection from '../src/components/DiagnosisSection';
import ServicePerformedSection from '../src/components/ServicePerformedSection';
import {
  createPhotoFromCapture,
  getFirstDisplayUri,
  normalizePhotos,
  uploadRepairPhoto,
} from '../src/photos';
import { scheduleJobSync } from '../src/sync';

function parseMoneyInput(raw: string): number {
  const n = parseFloat(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return n;
}

function sanitizeMoneyTyping(raw: string): string {
  let t = String(raw || '').replace(/[^0-9.]/g, '');
  const firstDot = t.indexOf('.');
  if (firstDot !== -1) {
    t = t.slice(0, firstDot + 1) + t.slice(firstDot + 1).replace(/\./g, '');
  }
  return t;
}

function amountToInput(n: number): string {
  const v = Math.max(0, Number(n) || 0);
  if (v <= 0) return '';
  return v % 1 === 0 ? String(v) : String(v);
}

export default function EditJobScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; tab?: string }>();
  const jobId = String(params.id || '');
  const returnTab = String(params.tab || 'all');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);

  const [jobMeta, setJobMeta] = useState<Omit<RepairJob, 'items'> | null>(null);
  const [items, setItems] = useState<RepairItem[]>([]);
  const [itemAmountInputs, setItemAmountInputs] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [originalPhoto, setOriginalPhoto] = useState<string | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [statusPickerIndex, setStatusPickerIndex] = useState<number | null>(null);

  const livePayments = useMemo(() => {
    const total = itemAmountInputs.reduce((s, a) => s + Math.max(0, parseMoneyInput(a)), 0);
    const advance = Math.max(0, parseMoneyInput(advanceAmount));
    return { total, advance, balance: Math.max(0, total - advance) };
  }, [itemAmountInputs, advanceAmount]);

  const showToastMsg = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    if (!jobId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const job = await getJob(jobId);
      if (!job) {
        showToastMsg('Job not found', true);
        setLoading(false);
        return;
      }
      const { items: jobItems, ...meta } = job;
      setJobMeta(meta);
      setItems(jobItems.map(i => ({ ...i, photos: normalizePhotos(i.photos) })));
      setItemAmountInputs(jobItems.map(i => amountToInput(getItemAmount(i))));
      setCustomerName(job.customerName);
      setMobileNumber(job.mobileNumber);
      setCountryCode(job.countryCode || '+91');
      setAdvanceAmount(job.advanceAmount > 0 ? String(job.advanceAmount) : '');
      const firstUri = jobItems.map(i => getFirstDisplayUri(i.photos)).find(Boolean) || null;
      setPhoto(firstUri);
      setOriginalPhoto(firstUri);
    } catch (e: any) {
      showToastMsg('Failed to load job: ' + (e?.message || ''), true);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  function updateItemField(index: number, patch: Partial<RepairItem>) {
    setItems(prev => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function setItemAmountAt(index: number, text: string) {
    const cleaned = sanitizeMoneyTyping(text);
    setItemAmountInputs(prev => {
      const next = [...prev];
      while (next.length <= index) next.push('');
      next[index] = cleaned;
      return next;
    });
    const amt = Math.max(0, parseMoneyInput(cleaned));
    updateItemField(index, { estimatedAmount: amt, finalAmount: amt });
  }

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access required.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhoto(result.assets[0].uri);
    }
  }

  async function handlePickGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Gallery access required.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]?.uri) {
      setPhoto(result.assets[0].uri);
    }
  }

  async function handleSave() {
    if (!jobMeta || !items.length) return;
    if (!customerName.trim()) { showToastMsg('Customer name required', true); return; }
    if (!mobileNumber.trim()) { showToastMsg('Mobile number required', true); return; }

    const total = livePayments.total;
    const advance = Math.max(0, parseMoneyInput(advanceAmount));
    if (advance > total && total >= 0 && advance > 0) {
      showToastMsg('Advance cannot exceed Total Amount', true);
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      await updateJob({
        ...jobMeta,
        customerName: customerName.trim(),
        mobileNumber: mobileNumber.trim(),
        countryCode,
        advanceAmount: advance,
        updatedAt: now,
      });

      const amounts = items.map((_, idx) => Math.max(0, parseMoneyInput(itemAmountInputs[idx] || '')));

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const status = item.status || 'Received';
        const becomingDelivered = status === 'Delivered';
        let photos = normalizePhotos(item.photos);
        const amt = amounts[idx];

        if (idx === 0 && photo !== originalPhoto) {
          if (photo) {
            // Copy into DocumentDirectory; SQLite stores the file path only.
            photos = [await createPhotoFromCapture(photo)];
          } else {
            photos = [];
          }
        }

        let savedPhotos = photos;
        if (idx === 0 && photo && photo !== originalPhoto && photos[0]) {
          try {
            savedPhotos = [await uploadRepairPhoto(photos[0], jobMeta.id, item.id)];
          } catch (uploadErr) {
            console.warn('Photo cloud upload deferred:', uploadErr);
          }
        }

        await updateItem({
          ...item,
          itemNumber: idx + 1,
          estimatedAmount: amt,
          finalAmount: amt,
          // Keep item-specific payments & advanceApplied; do not FIFO-assign job advance
          amountPaid: Math.max(0, item.amountPaid || 0),
          advanceApplied: Math.max(0, item.advanceApplied || 0),
          refundAmount: item.refundAmount || 0,
          nonRefundableCharges: item.nonRefundableCharges || 0,
          returnedDate: item.returnedDate || '',
          photos: savedPhotos,
          status,
          delivered: becomingDelivered,
          deliveredDate: becomingDelivered
            ? (item.deliveredDate || new Date().toLocaleString())
            : '',
          updatedAt: now,
        });
      }

      scheduleJobSync(jobMeta.id);
      await setConfig('recordsFocusExpandId', jobMeta.id);
      await setConfig('recordsFocusTab', returnTab);
      showToastMsg('Job updated');
      router.replace('/records');
    } catch (e: any) {
      showToastMsg('Save failed: ' + (e?.message || ''), true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.center}><ActivityIndicator color={C.primary} size="large" /></View>
      </SafeAreaView>
    );
  }

  if (!jobMeta) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={C.primary} /></TouchableOpacity>
          <Text style={s.headerTitle}>Edit Job</Text>
          <View style={{ width: 24 }} />
        </View>
        <Text style={s.empty}>Job not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity testID="edit-job-back" onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={C.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Edit Job #{jobMeta.jobNumber}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={s.field}>
            <Text style={s.label}>CUSTOMER NAME</Text>
            <TextInput testID="edit-customer" style={s.input} value={customerName} onChangeText={setCustomerName} placeholderTextColor={C.textMuted} />
          </View>

          <View style={s.field}>
            <Text style={s.label}>MOBILE</Text>
            <View style={s.phoneRow}>
              <TouchableOpacity style={s.ccBtn} onPress={() => setShowCountryPicker(true)}>
                <Text style={s.ccText}>{countryCode}</Text>
                <Ionicons name="chevron-down" size={14} color={C.textMuted} />
              </TouchableOpacity>
              <TextInput
                testID="edit-mobile"
                style={[s.input, { flex: 1 }]}
                value={mobileNumber}
                onChangeText={setMobileNumber}
                keyboardType="phone-pad"
                placeholderTextColor={C.textMuted}
              />
            </View>
          </View>

          {items.map((item, idx) => {
            const sc = getStatusColor(item.status);
            return (
              <View key={item.id} style={s.itemCard}>
                <Text style={s.itemHeader}>
                  ITEM {idx + 1} — {(ITEM_ICONS[item.itemType] || '')} {item.itemType.toUpperCase()}
                </Text>

                <Text style={s.subLabel}>ITEM TYPE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 10 }}>
                  {ITEM_TYPES.map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[s.typeChip, item.itemType === type && s.typeChipActive]}
                      onPress={() => updateItemField(idx, { itemType: type })}
                    >
                      <Text style={[s.typeChipText, item.itemType === type && s.typeChipTextActive]}>
                        {ITEM_ICONS[type]} {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={s.subLabel}>STATUS</Text>
                <TouchableOpacity
                  style={[s.statusSelect, { backgroundColor: sc.bg }]}
                  onPress={() => setStatusPickerIndex(idx)}
                >
                  <Text style={[s.statusSelectText, { color: sc.text }]}>{item.status}</Text>
                  <Ionicons name="chevron-down" size={16} color={sc.text} />
                </TouchableOpacity>

                <View style={{ marginTop: 12 }}>
                  <DiagnosisSection
                    itemType={item.itemType}
                    allowInsert={false}
                    value={item.technicianNotes || ''}
                    onChange={(text) => updateItemField(idx, { technicianNotes: text })}
                    testID={`edit-diagnosis-${item.id}`}
                  />
                </View>

                <View style={{ marginTop: 8 }}>
                  <ServicePerformedSection
                    itemType={item.itemType}
                    value={item.description || ''}
                    onChange={(text) => updateItemField(idx, { description: text })}
                    testID={`edit-service-${item.id}`}
                  />
                </View>

                <Text style={[s.subLabel, { marginTop: 12 }]}>AMOUNT (₹)</Text>
                <TextInput
                  testID={`edit-item-amount-${item.id}`}
                  style={s.input}
                  value={itemAmountInputs[idx] || ''}
                  onChangeText={(t) => setItemAmountAt(idx, t)}
                  placeholder="0"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>
            );
          })}

          <View style={s.field}>
            <Text style={s.label}>PHOTO OF ITEM</Text>
            <View style={s.photoRow}>
              <TouchableOpacity style={s.photoBtn} onPress={handleTakePhoto}>
                <Ionicons name="camera-outline" size={20} color={C.primary} />
                <Text style={s.photoBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.photoBtn} onPress={handlePickGallery}>
                <Ionicons name="images-outline" size={20} color={C.primary} />
                <Text style={s.photoBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
            {photo ? (
              <View style={s.photoPreview}>
                <Image source={{ uri: photo }} style={s.previewImg} />
                <TouchableOpacity style={s.removePhoto} onPress={() => setPhoto(null)}>
                  <Ionicons name="close-circle" size={28} color={C.red} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <View style={s.totalHighlight}>
            <Text style={s.totalHighlightLabel}>TOTAL AMOUNT</Text>
            <Text style={s.totalHighlightValue}>{formatINR(livePayments.total)}</Text>
          </View>

          <View style={s.field}>
            <Text style={s.label}>ADVANCE PAYMENT (₹)</Text>
            <TextInput
              testID="edit-advance"
              style={s.input}
              value={advanceAmount}
              onChangeText={(t) => setAdvanceAmount(sanitizeMoneyTyping(t))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={C.textMuted}
            />
          </View>

          <View style={s.balanceCard}>
            <View style={s.balanceRow}>
              <Text style={s.balanceLabel}>Total</Text>
              <Text style={s.balanceValue}>{formatINR(livePayments.total)}</Text>
            </View>
            <View style={s.balanceRow}>
              <Text style={s.balanceLabel}>Advance</Text>
              <Text style={[s.balanceValue, { color: C.green800 }]}>- {formatINR(livePayments.advance)}</Text>
            </View>
            <View style={[s.balanceRow, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, marginTop: 4 }]}>
              <Text style={[s.balanceLabel, { fontWeight: '800' }]}>Balance</Text>
              <Text style={[s.balanceValue, { fontWeight: '800', color: livePayments.balance > 0 ? C.red : C.green800 }]}>
                {formatINR(livePayments.balance)}
              </Text>
            </View>
            {livePayments.advance > livePayments.total && livePayments.advance > 0 ? (
              <Text style={{ fontSize: 12, color: C.red, marginTop: 8, fontWeight: '600' }}>Advance cannot exceed Total Amount</Text>
            ) : null}
          </View>

          <TouchableOpacity testID="btn-save-edit-job" style={s.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={C.primaryFg} /> : (
              <><Ionicons name="checkmark-circle" size={20} color={C.primaryFg} /><Text style={s.saveBtnText}>Save Changes</Text></>
            )}
          </TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>

        <Modal visible={showCountryPicker} transparent animationType="slide">
          <View style={s.modalOverlay}><View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Country Code</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                <Ionicons name="close" size={24} color={C.primary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={COUNTRY_CODES}
              keyExtractor={i => i.code}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.modalItem} onPress={() => { setCountryCode(item.code); setShowCountryPicker(false); }}>
                  <Text style={s.modalItemText}>{item.flag}  {item.code}</Text>
                </TouchableOpacity>
              )}
            />
          </View></View>
        </Modal>

        <Modal visible={statusPickerIndex !== null} transparent animationType="slide">
          <View style={s.modalOverlay}><View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Item Status</Text>
              <TouchableOpacity onPress={() => setStatusPickerIndex(null)}>
                <Ionicons name="close" size={24} color={C.primary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={ITEM_STATUSES}
              keyExtractor={i => i}
              renderItem={({ item: st }) => {
                const sc = getStatusColor(st);
                return (
                  <TouchableOpacity
                    style={s.modalItem}
                    onPress={() => {
                      if (statusPickerIndex !== null) updateItemField(statusPickerIndex, { status: st });
                      setStatusPickerIndex(null);
                    }}
                  >
                    <View style={[s.statusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[s.statusText, { color: sc.text }]}>{st}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View></View>
        </Modal>

        {toast && <View style={[s.toast, toast.err && s.toastErr]}><Text style={s.toastText}>{toast.msg}</Text></View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surface, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: C.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  empty: { textAlign: 'center', marginTop: 40, color: C.textMuted },
  field: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '800', color: C.textMuted, letterSpacing: 0.6, marginBottom: 8 },
  subLabel: { fontSize: 11, fontWeight: '700', color: C.textMuted, marginBottom: 6, marginTop: 4 },
  totalHighlight: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 18,
    marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  totalHighlightLabel: { fontSize: 14, fontWeight: '800', color: C.primaryFg, letterSpacing: 1 },
  totalHighlightValue: { fontSize: 22, fontWeight: '900', color: C.primaryFg },
  input: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text,
  },
  phoneRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  ccBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
  },
  ccText: { fontSize: 15, fontWeight: '700', color: C.text },
  itemCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 14, marginBottom: 16,
  },
  itemHeader: { fontSize: 15, fontWeight: '900', color: C.primary, marginBottom: 12, letterSpacing: 0.3 },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
    backgroundColor: C.secondary, borderWidth: 1, borderColor: C.border,
  },
  typeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipText: { fontSize: 12, fontWeight: '600', color: C.textMuted },
  typeChipTextActive: { color: C.primaryFg },
  statusSelect: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 4,
  },
  statusSelectText: { fontSize: 14, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, alignSelf: 'flex-start' },
  statusText: { fontSize: 12, fontWeight: '700' },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 14,
  },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: C.primary },
  photoPreview: { marginTop: 12, position: 'relative', alignSelf: 'flex-start' },
  previewImg: { width: 120, height: 120, borderRadius: 10 },
  removePhoto: { position: 'absolute', top: -8, right: -8 },
  balanceCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 16, marginBottom: 16,
  },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  balanceLabel: { fontSize: 14, color: C.textMuted },
  balanceValue: { fontSize: 14, fontWeight: '700', color: C.text },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: C.primaryFg },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 18, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.primary },
  modalItem: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  modalItemText: { fontSize: 16, color: C.text },
  toast: {
    position: 'absolute', bottom: 40, left: 20, right: 20,
    backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontWeight: '700' },
});
