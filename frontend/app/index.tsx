import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Modal, Image, KeyboardAvoidingView, Platform, FlatList, ActivityIndicator, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { allocateUniqueJobNumber, createJob, updateItem } from '../src/database';
import { C, COUNTRY_CODES, SHOP, ITEM_TYPES, ITEM_ICONS, generateJobNumber, getStatusColor, formatWhatsAppCustomerHeader, formatWhatsAppRepairReceiptBody } from '../src/constants';
import { RepairJob, RepairItem, getJobTotals, formatINR, ITEM_STATUSES, getItemAmount } from '../src/types';
import DiagnosisSection from '../src/components/DiagnosisSection';
import { createPhotoFromCapture, uploadRepairPhoto, normalizePhotos } from '../src/photos';
import { scheduleJobSync } from '../src/sync';
import { SyncStatusBadge } from '../src/SyncStatus';
import WebWebcamCapture from '../src/components/WebWebcamCapture';

function parseMoneyInput(raw: string): number {
  const n = parseFloat(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return n;
}

/** Allow typing decimals; strip invalid chars but keep a single dot. */
function sanitizeMoneyTyping(raw: string): string {
  let t = String(raw || '').replace(/[^0-9.]/g, '');
  const firstDot = t.indexOf('.');
  if (firstDot !== -1) {
    t = t.slice(0, firstDot + 1) + t.slice(firstDot + 1).replace(/\./g, '');
  }
  return t;
}

export default function NewEntry() {
  const { width: windowWidth } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  /** Desktop / laptop web portal only — Android & phone web keep the existing vertical layout. */
  const isDesktopWeb = isWeb && windowWidth >= 1024;
  const isTabletWeb = isWeb && windowWidth >= 768 && windowWidth < 1024;

  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [itemStatuses, setItemStatuses] = useState<string[]>([]);
  const [itemDiagnoses, setItemDiagnoses] = useState<string[]>([]);
  const [itemAmounts, setItemAmounts] = useState<string[]>([]);
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
  const [statusPickerIndex, setStatusPickerIndex] = useState<number | null>(null);
  /** Web only: full photo opens on thumbnail click — never auto-load large preview. */
  const [showPhotoLightbox, setShowPhotoLightbox] = useState(false);
  /** Web only: laptop webcam modal (MediaDevices). */
  const [showWebcam, setShowWebcam] = useState(false);

  const [jobId, setJobId] = useState(() => `job_${Date.now()}`);
  const [jobNumber, setJobNumber] = useState(() => generateJobNumber());
  const formDateTime = useMemo(() => new Date().toLocaleString(), [jobNumber]);

  /** Live Total = sum of item amounts; Balance = Total − Advance */
  const livePayments = useMemo(() => {
    const total = itemAmounts.reduce((s, a) => s + Math.max(0, parseMoneyInput(a)), 0);
    const advance = Math.max(0, parseMoneyInput(advanceAmount));
    const balance = Math.max(0, total - advance);
    return { total, advance, balance };
  }, [itemAmounts, advanceAmount]);

  const savedPayments = useMemo(() => {
    if (!savedJob) return null;
    return getJobTotals(savedJob.items, savedJob.advanceAmount);
  }, [savedJob]);

  const photoCount = photo ? 1 : 0;

  function showToastMsg(msg: string, err = false) {
    setToast({ msg, err }); setTimeout(() => setToast(null), 3000);
  }

  function onChangeAdvance(text: string) {
    setAdvanceAmount(sanitizeMoneyTyping(text));
  }

  function toggleItem(type: string) {
    setSelectedItems(prev => {
      if (prev.includes(type)) {
        const removeIdx = prev.indexOf(type);
        setItemStatuses(statuses => statuses.filter((_, i) => i !== removeIdx));
        setItemDiagnoses(diags => diags.filter((_, i) => i !== removeIdx));
        setItemAmounts(amts => amts.filter((_, i) => i !== removeIdx));
        return prev.filter(t => t !== type);
      }
      setItemStatuses(statuses => [...statuses, 'Received']);
      setItemDiagnoses(diags => [...diags, '']);
      setItemAmounts(amts => [...amts, '']);
      return [...prev, type];
    });
  }

  function setItemDiagnosisAt(index: number, text: string) {
    setItemDiagnoses(prev => {
      const next = [...prev];
      while (next.length <= index) next.push('');
      next[index] = text;
      return next;
    });
  }

  function setItemAmountAt(index: number, text: string) {
    setItemAmounts(prev => {
      const next = [...prev];
      while (next.length <= index) next.push('');
      next[index] = sanitizeMoneyTyping(text);
      return next;
    });
  }

  function setItemStatusAt(index: number, status: string) {
    setItemStatuses(prev => {
      const next = [...prev];
      while (next.length <= index) next.push('Received');
      next[index] = status;
      return next;
    });
    setStatusPickerIndex(null);
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

  /** Same acceptance path as Gallery — stores URI in `photo` for later persist/upload. */
  function acceptCapturedPhoto(uri: string) {
    setPhoto(uri);
    setShowPhotoLightbox(false);
  }

  async function handlePickGallery() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Gallery access required.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      if (!result.canceled && result.assets[0]?.uri) {
        acceptCapturedPhoto(result.assets[0].uri);
      }
    } catch { showToastMsg('Gallery not available', true); }
  }

  /** Web: open laptop webcam modal. Native: existing ImagePicker camera. */
  async function handleTakePhoto() {
    if (Platform.OS === 'web') {
      const canUseWebcam =
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function';
      if (canUseWebcam) {
        setShowWebcam(true);
        return;
      }
      // No MediaDevices API — fall back to file picker (same as Gallery).
      await handlePickGallery();
      return;
    }

    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Camera access required.'); return; }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (!result.canceled && result.assets[0]?.uri) {
        acceptCapturedPhoto(result.assets[0].uri);
      }
    } catch { showToastMsg('Camera not available', true); }
  }

  function handleWebcamCapture(uri: string) {
    setShowWebcam(false);
    acceptCapturedPhoto(uri);
  }

  function handleWebcamCancel() {
    setShowWebcam(false);
  }

  /** Permission denied / device error → close modal and use file picker. */
  async function handleWebcamUnavailable() {
    setShowWebcam(false);
    await handlePickGallery();
  }

  async function handleSave() {
    if (!customerName.trim()) { showToastMsg('Enter customer name', true); return; }
    if (!mobileNumber.trim()) { showToastMsg('Enter mobile number', true); return; }
    if (selectedItems.length === 0) { showToastMsg('Select at least one item type', true); return; }

    const rawTotal = livePayments.total;
    const rawAdvance = parseMoneyInput(advanceAmount);

    if (rawTotal < 0) { showToastMsg('Total cannot be negative', true); return; }
    if (rawAdvance < 0) { showToastMsg('Advance cannot be negative', true); return; }
    if (rawAdvance > rawTotal && rawTotal > 0) {
      showToastMsg('Advance cannot exceed Total Amount', true);
      return;
    }
    if (rawAdvance > 0 && rawTotal === 0) {
      showToastMsg('Enter item amounts before Advance, or set Advance to 0', true);
      return;
    }

    const advance = Math.max(0, rawAdvance);

    setSaving(true);
    const now = new Date().toISOString();

    // Keep on-screen Mxxxxx when still unique; otherwise allocate another.
    let finalJobNumber = jobNumber;
    try {
      finalJobNumber = await allocateUniqueJobNumber(jobNumber);
      if (finalJobNumber !== jobNumber) setJobNumber(finalJobNumber);
    } catch (allocErr: any) {
      showToastMsg(allocErr?.message || 'Could not allocate Job ID', true);
      setSaving(false);
      return;
    }

    const job: Omit<RepairJob, 'items'> = {
      id: jobId, jobNumber: finalJobNumber, customerName: customerName.trim(), mobileNumber: mobileNumber.trim(),
      countryCode, receivedDate: new Date().toLocaleString(), advanceAmount: advance,
      overallNotes: '', googleReviewSent: false, cloudSyncEnabled: true,
      createdAt: now, updatedAt: now,
    };

    const items: RepairItem[] = selectedItems.map((type, idx) => {
      const status = itemStatuses[idx] || 'Received';
      const isDelivered = status === 'Delivered';
      const amt = Math.max(0, parseMoneyInput(itemAmounts[idx] || ''));
      return {
        id: `item_${Date.now()}_${idx}`,
        jobId, itemNumber: idx + 1, itemType: type,
        brand: '', model: '', color: '', identification: '',
        description: '', selectedPhrases: [],
        customerComplaint: '', accessoriesReceived: '',
        estimatedAmount: amt,
        finalAmount: amt,
        amountPaid: 0,
        advanceApplied: 0,
        refundAmount: 0,
        nonRefundableCharges: 0,
        returnedDate: '',
        technicianNotes: (itemDiagnoses[idx] || '').trim(),
        photos: [],
        status,
        expectedDeliveryDate: '', warrantyDetails: '',
        delivered: isDelivered,
        deliveredDate: isDelivered ? new Date().toLocaleString() : '',
        createdAt: now, updatedAt: now,
      };
    });

    // Persist camera/gallery image into DocumentDirectory; SQLite stores path only.
    if (photo && items[0]) {
      try {
        items[0] = {
          ...items[0],
          photos: [await createPhotoFromCapture(photo)],
        };
      } catch (persistErr) {
        console.warn('Photo file persist failed:', persistErr);
        showToastMsg('Could not save photo file', true);
        setSaving(false);
        return;
      }
    }

    // Keep job advance at job level — do not auto-assign to specific items

    try {
      await createJob(job, items);
      // Upload photo to Firebase Storage (non-blocking for local save success)
      if (photo && items[0] && items[0].photos?.length) {
        try {
          const uploaded = await uploadRepairPhoto(
            normalizePhotos(items[0].photos)[0],
            job.id,
            items[0].id,
          );
          items[0] = { ...items[0], photos: [uploaded], updatedAt: new Date().toISOString() };
          await updateItem(items[0]);
          scheduleJobSync(job.id);
        } catch (uploadErr) {
          console.warn('Photo cloud upload deferred:', uploadErr);
        }
      }
      const saved: RepairJob = { ...job, items };
      setSavedJob(saved);
      setShowReceipt(true);
      showToastMsg('Repair job saved!');
      setCustomerName(''); setMobileNumber(''); setSelectedItems([]); setItemStatuses([]); setItemDiagnoses([]); setItemAmounts([]); setPhoto(null);
      setAdvanceAmount('');
      setShowPhotoLightbox(false);
      setJobId(`job_${Date.now()}`);
      setJobNumber(generateJobNumber());
    } catch (e: any) {
      showToastMsg('Save failed: ' + (e?.message || ''), true);
    } finally { setSaving(false); }
  }

  /** WhatsApp retail receipt — readable item bullets + payment summary */
  function shareReceiptWA() {
    if (!savedJob) return;
    const j = savedJob;
    const pay = getJobTotals(j.items, j.advanceAmount);
    const cleanPhone = (j.countryCode + j.mobileNumber).replace(/\D/g, '');
    const msg =
`${formatWhatsAppCustomerHeader(j.customerName, j.jobNumber)}

${formatWhatsAppRepairReceiptBody({
  receivedDate: j.receivedDate,
  items: j.items,
  total: pay.displayTotal,
  paid: pay.totalPaid,
  balance: pay.balance,
})}`;

    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  const filteredContacts = contactsList.filter(c => { const q = contactSearch.toLowerCase(); return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q); });

  const itemSelectBlock = (
    <View style={[s.field, (isDesktopWeb || isTabletWeb) && s.fieldCompact]}>
      <Text style={s.label}>SELECT ITEMS (tap multiple)</Text>
      <View style={[s.itemRow, (isDesktopWeb || isTabletWeb) && s.itemRowCompact]}>
        {ITEM_TYPES.map(type => {
          const selected = selectedItems.includes(type);
          return (
            <TouchableOpacity key={type} testID={`item-${type.toLowerCase().replace(' ', '-')}`}
              style={[s.itemBtn, (isDesktopWeb || isTabletWeb) && s.itemBtnCompact, selected && s.itemBtnActive]}
              onPress={() => toggleItem(type)}>
              <Text style={[s.itemIcon, (isDesktopWeb || isTabletWeb) && s.itemIconCompact]}>{ITEM_ICONS[type]}</Text>
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
  );

  const diagnosisBlock = selectedItems.length > 0 ? (
    <View style={[s.field, (isDesktopWeb || isTabletWeb) && s.fieldCompact]}>
      <Text style={s.label}>ITEM STATUS & DIAGNOSIS (per item)</Text>
      {selectedItems.map((type, idx) => {
        const stStatus = itemStatuses[idx] || 'Received';
        const sc = getStatusColor(stStatus);
        return (
          <View key={`${type}-${idx}`} style={[s.itemCard, (isDesktopWeb || isTabletWeb) && s.itemCardCompact]}>
            <Text style={s.itemCardTitle}>Item {idx + 1}: {ITEM_ICONS[type]} {type}</Text>
            <TouchableOpacity
              testID={`item-status-${idx}`}
              style={[s.statusSelect, { backgroundColor: sc.bg }]}
              onPress={() => setStatusPickerIndex(idx)}
            >
              <Text style={[s.statusSelectText, { color: sc.text }]}>{stStatus}</Text>
              <Ionicons name="chevron-down" size={16} color={sc.text} />
            </TouchableOpacity>
            <View style={{ marginTop: isDesktopWeb ? 8 : 12 }}>
              <DiagnosisSection
                itemType={type}
                allowInsert
                value={itemDiagnoses[idx] || ''}
                onChange={(text) => setItemDiagnosisAt(idx, text)}
                testID={`diagnosis-section-create-${idx}`}
              />
            </View>
            <Text style={[s.label, { marginTop: isDesktopWeb ? 8 : 12, marginBottom: 6 }]}>AMOUNT (₹)</Text>
            <TextInput
              testID={`item-amount-${idx}`}
              style={[s.input, (isDesktopWeb || isTabletWeb) && s.inputCompact]}
              value={itemAmounts[idx] || ''}
              onChangeText={(t) => setItemAmountAt(idx, t)}
              placeholder="0"
              placeholderTextColor={C.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
        );
      })}
    </View>
  ) : null;

  const photoBlock = (
    <View style={[s.field, (isDesktopWeb || isTabletWeb) && s.fieldCompact]}>
      <Text style={s.label}>PHOTO OF ITEM</Text>
      <View style={s.photoRow}>
        <TouchableOpacity testID="btn-camera" style={[s.photoBtn, (isDesktopWeb || isTabletWeb) && s.photoBtnCompact]} onPress={handleTakePhoto}>
          <Ionicons name="camera-outline" size={20} color={C.primary} />
          <Text style={s.photoBtnText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="btn-gallery" style={[s.photoBtn, (isDesktopWeb || isTabletWeb) && s.photoBtnCompact]} onPress={handlePickGallery}>
          <Ionicons name="images-outline" size={20} color={C.primary} />
          <Text style={s.photoBtnText}>Gallery</Text>
        </TouchableOpacity>
      </View>
      {(isDesktopWeb || isTabletWeb) ? (
        <Text style={s.photoCountText}>{photoCount} photo{photoCount === 1 ? '' : 's'}</Text>
      ) : null}
      {photo ? (
        (isDesktopWeb || isTabletWeb) ? (
          <View style={s.thumbRow}>
            <TouchableOpacity
              testID="photo-thumb"
              style={s.thumbBtn}
              onPress={() => setShowPhotoLightbox(true)}
              accessibilityLabel="Open full photo"
            >
              <Image source={{ uri: photo }} style={s.thumbImg} />
              <Text style={s.thumbHint}>Tap to view</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="btn-remove-photo" style={s.thumbRemove} onPress={() => { setPhoto(null); setShowPhotoLightbox(false); }}>
              <Ionicons name="close-circle" size={24} color={C.red} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.photoPreview}>
            <Image source={{ uri: photo }} style={s.previewImg} />
            <TouchableOpacity testID="btn-remove-photo" style={s.removePhoto} onPress={() => setPhoto(null)}>
              <Ionicons name="close-circle" size={28} color={C.red} />
            </TouchableOpacity>
          </View>
        )
      ) : null}
    </View>
  );

  const paymentBlock = (
    <>
      <View style={[s.field, (isDesktopWeb || isTabletWeb) && s.fieldCompact]}>
        <Text style={s.label}>ADVANCE PAYMENT (₹) — optional</Text>
        <TextInput
          testID="input-advance"
          style={[s.input, (isDesktopWeb || isTabletWeb) && s.inputCompact]}
          value={advanceAmount}
          onChangeText={onChangeAdvance}
          placeholder="0"
          placeholderTextColor={C.textMuted}
          keyboardType="decimal-pad"
        />
      </View>

      {selectedItems.length > 0 && (
        <View style={[s.totalHighlight, (isDesktopWeb || isTabletWeb) && s.totalHighlightCompact]}>
          <Text style={s.totalHighlightLabel}>TOTAL AMOUNT</Text>
          <Text style={[s.totalHighlightValue, (isDesktopWeb || isTabletWeb) && { fontSize: 18 }]}>{formatINR(livePayments.total)}</Text>
        </View>
      )}

      {(livePayments.total > 0 || livePayments.advance > 0 || advanceAmount !== '') && (
        <View style={[s.balanceCard, (isDesktopWeb || isTabletWeb) && s.balanceCardCompact]}>
          <View style={s.balanceRow}><Text style={s.balanceLabel}>Total Amount</Text><Text style={s.balanceValue}>{formatINR(livePayments.total)}</Text></View>
          <View style={s.balanceRow}><Text style={s.balanceLabel}>Advance Paid</Text><Text style={[s.balanceValue, { color: C.green800 }]}>- {formatINR(livePayments.advance)}</Text></View>
          <View style={[s.balanceRow, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10, marginTop: 4 }]}>
            <Text style={[s.balanceLabel, { fontWeight: '800', fontSize: 16 }]}>Balance</Text>
            <Text style={[s.balanceValue, { fontWeight: '800', fontSize: 16, color: livePayments.balance > 0 ? C.red : C.green800 }]}>{formatINR(livePayments.balance)}</Text>
          </View>
          {livePayments.advance > livePayments.total && livePayments.advance > 0 ? (
            <Text style={{ fontSize: 12, color: C.red, marginTop: 8, fontWeight: '600' }}>Advance cannot exceed Total Amount</Text>
          ) : null}
        </View>
      )}
    </>
  );

  const saveButton = (
    <TouchableOpacity
      testID="btn-save"
      style={[s.saveBtn, isDesktopWeb && s.saveBtnDesktop]}
      onPress={handleSave}
      disabled={saving}
    >
      {saving ? <ActivityIndicator color={C.primaryFg} /> : (
        <><Ionicons name="checkmark-circle" size={20} color={C.primaryFg} /><Text style={s.saveBtnText}>Save & Send Receipt</Text></>
      )}
    </TouchableOpacity>
  );

  const jobSummaryPanel = (
    <View style={s.summaryCard} testID="job-summary-panel">
      <Text style={s.summaryTitle}>Job summary</Text>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>Job ID</Text>
        <Text style={s.summaryValueStrong}>{jobNumber}</Text>
      </View>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>Date / time</Text>
        <Text style={s.summaryValue}>{formDateTime}</Text>
      </View>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>Items</Text>
        <Text style={s.summaryValue}>{selectedItems.length}</Text>
      </View>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>Photos</Text>
        <Text style={s.summaryValue}>{photoCount}</Text>
      </View>
      <View style={s.summaryRow}>
        <Text style={s.summaryLabel}>Advance</Text>
        <Text style={s.summaryValue}>{formatINR(livePayments.advance)}</Text>
      </View>
      <View style={[s.summaryRow, { alignItems: 'center', borderBottomWidth: 0 }]}>
        <Text style={s.summaryLabel}>Sync</Text>
        <SyncStatusBadge compact />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[s.header, (isDesktopWeb || isTabletWeb) && s.headerCompact]}>
          <View style={(isDesktopWeb || isTabletWeb) ? s.headerDesktopInner : undefined}>
            <Text testID="header-title" style={[s.headerTitle, (isDesktopWeb || isTabletWeb) && s.headerTitleCompact]}>{SHOP.name}</Text>
            <Text style={[s.headerSub, (isDesktopWeb || isTabletWeb) && { marginTop: 0 }]}>{SHOP.tagline}</Text>
            {(isDesktopWeb || isTabletWeb) ? (
              <View style={s.headerJobRow}>
                <Text style={s.headerJobTitle}>New Repair Job</Text>
                <Text style={s.headerJobId} testID="header-job-id">{jobNumber}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={[
            s.scrollContent,
            isDesktopWeb && s.scrollContentDesktop,
            isTabletWeb && s.scrollContentTablet,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {isDesktopWeb ? (
            <View style={s.desktopShell}>
              <View style={s.desktopColumns}>
                <View style={s.desktopLeft}>
                  <View style={s.customerRowDesktop}>
                    <View style={s.customerNameCol}>
                      <Text style={s.label}>CUSTOMER NAME</Text>
                      <TextInput testID="input-name" style={[s.input, s.inputCompact]} value={customerName} onChangeText={setCustomerName} placeholder="Customer name" placeholderTextColor={C.textMuted} />
                    </View>
                    <View style={s.customerMobileCol}>
                      <View style={s.mobileLabelRow}>
                        <Text style={[s.label, { marginBottom: 0 }]}>MOBILE NUMBER</Text>
                        <TouchableOpacity testID="btn-contacts" style={s.contactsBtnInline} onPress={pickContact}>
                          <Ionicons name="person-circle-outline" size={16} color={C.blue} />
                          <Text style={s.contactsBtnInlineText}>Contacts</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={s.phoneRow}>
                        <TouchableOpacity testID="country-code-picker" style={[s.countryBtn, s.countryBtnCompact]} onPress={() => setShowCountryPicker(true)}>
                          <Text style={s.countryText}>{COUNTRY_CODES.find(c => c.code === countryCode)?.flag} {countryCode}</Text>
                          <Ionicons name="chevron-down" size={14} color={C.textMuted} />
                        </TouchableOpacity>
                        <TextInput testID="input-phone" style={[s.input, s.inputCompact, { flex: 1 }]} value={mobileNumber} onChangeText={setMobileNumber} placeholder="Mobile number" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
                      </View>
                    </View>
                  </View>
                  {itemSelectBlock}
                  {diagnosisBlock}
                </View>

                <View style={s.desktopRight}>
                  <View style={s.desktopRightSticky}>
                    {jobSummaryPanel}
                    {photoBlock}
                    {paymentBlock}
                    {saveButton}
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <>
              <Text style={[s.sectionTitle, isTabletWeb && { marginBottom: 12 }]}>New Repair Job  #{jobNumber}</Text>

              <TouchableOpacity testID="btn-contacts" style={s.contactsBtn} onPress={pickContact}>
                <Ionicons name="person-circle-outline" size={20} color={C.blue} />
                <Text style={s.contactsBtnText}>Pick from Contacts</Text>
              </TouchableOpacity>

              {isTabletWeb ? (
                <View style={s.customerRowTablet}>
                  <View style={[s.field, s.fieldCompact, { flex: 1.1 }]}>
                    <Text style={s.label}>CUSTOMER NAME</Text>
                    <TextInput testID="input-name" style={[s.input, s.inputCompact]} value={customerName} onChangeText={setCustomerName} placeholder="Customer name" placeholderTextColor={C.textMuted} />
                  </View>
                  <View style={[s.field, s.fieldCompact, { flex: 0.9 }]}>
                    <Text style={s.label}>MOBILE NUMBER</Text>
                    <View style={s.phoneRow}>
                      <TouchableOpacity testID="country-code-picker" style={[s.countryBtn, s.countryBtnCompact]} onPress={() => setShowCountryPicker(true)}>
                        <Text style={s.countryText}>{COUNTRY_CODES.find(c => c.code === countryCode)?.flag} {countryCode}</Text>
                        <Ionicons name="chevron-down" size={14} color={C.textMuted} />
                      </TouchableOpacity>
                      <TextInput testID="input-phone" style={[s.input, s.inputCompact, { flex: 1 }]} value={mobileNumber} onChangeText={setMobileNumber} placeholder="Mobile number" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
                    </View>
                  </View>
                </View>
              ) : (
                <>
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
                </>
              )}

              {itemSelectBlock}
              {diagnosisBlock}
              {photoBlock}
              {paymentBlock}
              {saveButton}
              <View style={{ height: 40 }} />
            </>
          )}
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

        {/* Item Status Picker */}
        <Modal visible={statusPickerIndex !== null} transparent animationType="slide">
          <View style={s.modalOverlay}><View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>
                Item {(statusPickerIndex ?? 0) + 1} Status
              </Text>
              <TouchableOpacity onPress={() => setStatusPickerIndex(null)}>
                <Ionicons name="close" size={24} color={C.primary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={[...ITEM_STATUSES]}
              keyExtractor={st => st}
              renderItem={({ item: st }) => {
                const sc = getStatusColor(st);
                const active = (itemStatuses[statusPickerIndex ?? 0] || 'Received') === st;
                return (
                  <TouchableOpacity
                    style={[s.modalItem, active && { backgroundColor: sc.bg }]}
                    onPress={() => statusPickerIndex !== null && setItemStatusAt(statusPickerIndex, st)}
                  >
                    <Text style={[s.modalItemText, active && { fontWeight: '800', color: sc.text }]}>{st}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View></View>
        </Modal>

        {/* Web laptop webcam — MediaDevices; falls back to file picker if unavailable */}
        {Platform.OS === 'web' ? (
          <WebWebcamCapture
            visible={showWebcam}
            onCapture={handleWebcamCapture}
            onCancel={handleWebcamCancel}
            onUnavailable={handleWebcamUnavailable}
          />
        ) : null}

        {/* Web photo lightbox — full image only after thumbnail click */}
        <Modal visible={(isDesktopWeb || isTabletWeb) && showPhotoLightbox && !!photo} transparent animationType="fade" onRequestClose={() => setShowPhotoLightbox(false)}>
          <View style={s.lightboxOverlay}>
            <TouchableOpacity style={s.lightboxClose} onPress={() => setShowPhotoLightbox(false)} testID="close-photo-lightbox">
              <Ionicons name="close" size={28} color="#FFF" />
            </TouchableOpacity>
            {photo ? <Image source={{ uri: photo }} style={s.lightboxImg} resizeMode="contain" /> : null}
          </View>
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
                    <Text style={s.receiptItemTitle}>Item {idx + 1}. {ITEM_ICONS[item.itemType]} {item.itemType}</Text>
                    {item.technicianNotes ? <Text style={s.receiptItemDesc}>Technician Diagnosis: {item.technicianNotes}</Text> : null}
                    {item.description ? <Text style={s.receiptItemDesc}>Service Performed: {item.description}</Text> : null}
                    <Text style={s.receiptItemDesc}>Amount: {formatINR(getItemAmount(item))}</Text>
                  </View>
                ))}
                {savedPayments ? <>
                  <View style={s.divider} />
                  <View style={s.totalHighlight}>
                    <Text style={s.totalHighlightLabel}>TOTAL AMOUNT</Text>
                    <Text style={s.totalHighlightValue}>{formatINR(savedPayments.displayTotal)}</Text>
                  </View>
                  {(savedPayments.displayTotal > 0 || savedPayments.advance > 0) ? (
                  <View style={s.balanceCard}>
                    <View style={s.balanceRow}><Text style={s.balanceLabel}>Advance Paid</Text><Text style={[s.balanceValue, { color: C.green800 }]}>{formatINR(savedPayments.advance)}</Text></View>
                    <View style={s.balanceRow}>
                      <Text style={[s.balanceLabel, { fontWeight: '800' }]}>Balance Amount</Text>
                      <Text style={[s.balanceValue, { fontWeight: '800', color: savedPayments.balance > 0 ? C.red : C.green800 }]}>{formatINR(savedPayments.balance)}</Text>
                    </View>
                  </View>
                  ) : null}
                </> : null}
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
  headerCompact: { paddingVertical: 10, paddingHorizontal: 24 },
  headerDesktopInner: { width: '100%', maxWidth: 1480, alignSelf: 'center' },
  headerTitle: { fontSize: 28, fontWeight: '900', color: C.primary, letterSpacing: -1 },
  headerTitleCompact: { fontSize: 22, letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: C.textMuted, fontWeight: '600', letterSpacing: 1, marginTop: 2 },
  headerJobRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6, gap: 12 },
  headerJobTitle: { fontSize: 16, fontWeight: '700', color: C.primary },
  headerJobId: { fontSize: 18, fontWeight: '900', color: C.primary, letterSpacing: 0.5 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  scrollContentDesktop: { paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center' },
  scrollContentTablet: { padding: 16 },
  desktopShell: { width: '100%', maxWidth: 1480 },
  desktopColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  desktopLeft: { flexGrow: 1, flexShrink: 1, flexBasis: '62%', maxWidth: '65%', gap: 0 },
  desktopRight: { flexGrow: 0, flexShrink: 0, flexBasis: '36%', maxWidth: 420, minWidth: 300 },
  desktopRightSticky: {
    position: 'sticky' as unknown as 'relative',
    top: 12,
    alignSelf: 'flex-start',
    width: '100%',
  },
  customerRowDesktop: { flexDirection: 'row', gap: 16, marginBottom: 14 },
  customerNameCol: { flexGrow: 1, flexShrink: 1, flexBasis: '55%' },
  customerMobileCol: { flexGrow: 1, flexShrink: 1, flexBasis: '45%' },
  customerRowTablet: { flexDirection: 'row', gap: 12 },
  mobileLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  contactsBtnInline: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 6 },
  contactsBtnInlineText: { fontSize: 12, fontWeight: '700', color: C.blue },
  summaryCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 14, marginBottom: 14,
  },
  summaryTitle: { fontSize: 13, fontWeight: '800', color: C.primary, letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border, gap: 10,
  },
  summaryLabel: { fontSize: 12, color: C.textMuted, fontWeight: '600' },
  summaryValue: { fontSize: 13, color: C.text, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  summaryValueStrong: { fontSize: 16, color: C.primary, fontWeight: '900', textAlign: 'right' },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: C.primary, marginBottom: 16 },
  contactsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 10, paddingVertical: 12, marginBottom: 20 },
  contactsBtnText: { fontSize: 15, fontWeight: '700', color: C.blue },
  field: { marginBottom: 20 },
  fieldCompact: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 1.5, marginBottom: 8 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: C.text },
  inputCompact: { paddingVertical: 10, paddingHorizontal: 12, fontSize: 15 },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  phoneRow: { flexDirection: 'row', gap: 10 },
  countryBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, gap: 6 },
  countryBtnCompact: { paddingVertical: 10, paddingHorizontal: 10 },
  countryText: { fontSize: 15, color: C.text, fontWeight: '600' },
  itemRow: { flexDirection: 'row', gap: 8 },
  itemRowCompact: { gap: 6 },
  itemBtn: { flex: 1, alignItems: 'center', backgroundColor: C.surface, borderWidth: 2, borderColor: C.border, borderRadius: 10, paddingVertical: 12, gap: 4, position: 'relative' },
  itemBtnCompact: { paddingVertical: 8, gap: 2, borderRadius: 8 },
  itemBtnActive: { borderColor: C.primary, backgroundColor: C.primary },
  itemIcon: { fontSize: 22 },
  itemIconCompact: { fontSize: 18 },
  itemLabel: { fontSize: 10, fontWeight: '700', color: C.text },
  itemLabelActive: { color: C.primaryFg },
  itemCheck: { position: 'absolute', top: 4, right: 4, backgroundColor: C.green800, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  itemSummary: { fontSize: 13, color: C.green800, fontWeight: '600', marginTop: 10 },
  itemCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 12, marginBottom: 8,
  },
  itemCardCompact: { padding: 10, marginBottom: 8 },
  itemCardTitle: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 8 },
  totalHighlight: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 18,
    marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  totalHighlightCompact: { paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12, borderRadius: 10 },
  totalHighlightLabel: { fontSize: 14, fontWeight: '800', color: C.primaryFg, letterSpacing: 1 },
  totalHighlightValue: { fontSize: 22, fontWeight: '900', color: C.primaryFg },
  statusSelect: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8,
  },
  statusSelectText: { fontSize: 13, fontWeight: '700' },
  photoRow: { flexDirection: 'row', gap: 12 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 14 },
  photoBtnCompact: { paddingVertical: 10 },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: C.primary },
  photoCountText: { fontSize: 12, color: C.textMuted, fontWeight: '600', marginTop: 8 },
  photoPreview: { marginTop: 12, position: 'relative' },
  previewImg: { width: '100%', height: 200, borderRadius: 10, backgroundColor: C.secondary },
  removePhoto: { position: 'absolute', top: 8, right: 8 },
  thumbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  thumbBtn: { alignItems: 'center' },
  thumbImg: { width: 72, height: 72, borderRadius: 8, backgroundColor: C.secondary },
  thumbHint: { fontSize: 11, color: C.textMuted, marginTop: 4, fontWeight: '600' },
  thumbRemove: { padding: 4 },
  lightboxOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  lightboxClose: { position: 'absolute', top: 20, right: 20, zIndex: 2, padding: 8 },
  lightboxImg: { width: '100%', maxWidth: 900, height: '80%', maxHeight: 700 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, marginTop: 8 },
  saveBtnDesktop: { marginTop: 4, paddingVertical: 14, alignSelf: 'stretch', maxWidth: 360 },
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
  balanceCard: { backgroundColor: C.bg, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  balanceCardCompact: { padding: 12, marginBottom: 10 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  balanceLabel: { fontSize: 14, color: C.textMuted, fontWeight: '600' },
  balanceValue: { fontSize: 14, color: C.text, fontWeight: '700' },
  waBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.whatsapp, borderRadius: 12, paddingVertical: 14, marginTop: 8 },
  waBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  toast: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center' },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
