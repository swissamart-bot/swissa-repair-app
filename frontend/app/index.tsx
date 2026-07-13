import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Modal, Image, KeyboardAvoidingView, Platform, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { createJob, getCustomPhrases } from '../src/database';
import { C, COUNTRY_CODES, SHOP, ITEM_TYPES, ITEM_ICONS, DEFAULT_PHRASES, generateJobNumber, COMMUNITY_MSG } from '../src/constants';
import { RepairJob, RepairItem, createEmptyItem, getJobTotals, ITEM_STATUSES, CustomPhrase } from '../src/types';

export default function NewEntry() {
  const jobId = useState(() => `job_${Date.now()}`)[0];
  const jobNumber = useState(() => generateJobNumber())[0];

  // Initialize first item
  const initialItem = useState(() => createEmptyItem(jobId, 1))[0];

  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [overallNotes, setOverallNotes] = useState('');
  const [items, setItems] = useState<RepairItem[]>([initialItem]);
  const [expandedItem, setExpandedItem] = useState<string|null>(initialItem.id);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showPhraseModal, setShowPhraseModal] = useState<string|null>(null);
  const [phrases, setPhrases] = useState<string[]>([]);
  const [customPhrasesList, setCustomPhrasesList] = useState<string[]>([]);
  const [showReceipt, setShowReceipt] = useState(false);
  const [savedJob, setSavedJob] = useState<RepairJob|null>(null);
  const [toast, setToast] = useState<{msg:string;err:boolean}|null>(null);
  const [saving, setSaving] = useState(false);

  function showToastMsg(msg: string, err = false) {
    setToast({ msg, err }); setTimeout(() => setToast(null), 3000);
  }

  function addItem() {
    const newItem = createEmptyItem(jobId, items.length + 1);
    setItems([...items, newItem]);
    setExpandedItem(newItem.id);
  }

  function duplicateItem(item: RepairItem) {
    const dup = { ...item, id: `item_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, itemNumber: items.length + 1, delivered: false, deliveredDate: '', status: 'Received', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setItems([...items, dup]);
    setExpandedItem(dup.id);
  }

  function removeItem(id: string) {
    if (items.length <= 1) { showToastMsg('At least one item required', true); return; }
    Alert.alert('Remove Item', 'Delete this item?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        const newItems = items.filter(i => i.id !== id).map((i, idx) => ({ ...i, itemNumber: idx + 1 }));
        setItems(newItems);
        if (expandedItem === id) setExpandedItem(null);
      }},
    ]);
  }

  function updateItemField(id: string, field: keyof RepairItem, value: any) {
    setItems(items.map(i => i.id === id ? { ...i, [field]: value, updatedAt: new Date().toISOString() } : i));
  }

  async function openPhraseModal(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const defaultP = DEFAULT_PHRASES[item.itemType] || [];
    try {
      const customP = await getCustomPhrases(item.itemType);
      setCustomPhrasesList(customP.map(p => p.phrase));
    } catch { setCustomPhrasesList([]); }
    setPhrases([...defaultP]);
    setShowPhraseModal(itemId);
  }

  function togglePhrase(itemId: string, phrase: string) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const current = item.selectedPhrases || [];
    const updated = current.includes(phrase) ? current.filter(p => p !== phrase) : [...current, phrase];
    updateItemField(itemId, 'selectedPhrases', updated);
  }

  async function handleTakePhoto(itemId: string) {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Camera access required.'); return; }
      const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.3 });
      if (!result.canceled && result.assets[0]?.base64) {
        const item = items.find(i => i.id === itemId);
        if (item) updateItemField(itemId, 'photos', [...(item.photos||[]), `data:image/jpeg;base64,${result.assets[0].base64}`]);
      }
    } catch { showToastMsg('Camera not available', true); }
  }

  async function handlePickGallery(itemId: string) {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Gallery access required.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.3 });
      if (!result.canceled && result.assets[0]?.base64) {
        const item = items.find(i => i.id === itemId);
        if (item) updateItemField(itemId, 'photos', [...(item.photos||[]), `data:image/jpeg;base64,${result.assets[0].base64}`]);
      }
    } catch { showToastMsg('Gallery not available', true); }
  }

  function removePhoto(itemId: string, photoIdx: number) {
    const item = items.find(i => i.id === itemId);
    if (item) updateItemField(itemId, 'photos', item.photos.filter((_, i) => i !== photoIdx));
  }

  async function handleSave() {
    if (!customerName.trim()) { showToastMsg('Enter customer name', true); return; }
    if (!mobileNumber.trim()) { showToastMsg('Enter mobile number', true); return; }
    if (items.length === 0) { showToastMsg('Add at least one item', true); return; }
    for (const item of items) {
      if (!item.itemType) { showToastMsg(`Item ${item.itemNumber}: Select item type`, true); return; }
    }
    setSaving(true);
    const now = new Date().toISOString();
    const job: Omit<RepairJob,'items'> = {
      id: jobId, jobNumber, customerName: customerName.trim(), mobileNumber: mobileNumber.trim(),
      countryCode, receivedDate: new Date().toLocaleString(), advanceAmount: parseFloat(advanceAmount) || 0,
      overallNotes: overallNotes.trim(), googleReviewSent: false, createdAt: now, updatedAt: now,
    };
    const finalItems = items.map(i => ({
      ...i,
      description: i.selectedPhrases.length > 0 ? [...i.selectedPhrases, i.description].filter(Boolean).join(', ') : i.description,
    }));
    try {
      await createJob(job, finalItems);
      const fullJob: RepairJob = { ...job, items: finalItems };
      setSavedJob(fullJob);
      setShowReceipt(true);
      showToastMsg('Repair job saved!');
      // Reset form for next job
      setCustomerName(''); setMobileNumber(''); setAdvanceAmount(''); setOverallNotes('');
      const newItem = createEmptyItem(`job_${Date.now()}`, 1);
      setItems([newItem]); setExpandedItem(newItem.id);
    } catch (e: any) {
      showToastMsg('Save failed: ' + (e?.message||''), true);
    } finally { setSaving(false); }
  }

  function shareReceiptWA() {
    if (!savedJob) return;
    const j = savedJob;
    const cleanPhone = (j.countryCode + j.mobileNumber).replace(/\D/g, '');
    let itemsList = j.items.map((i, idx) => `${idx+1}. ${ITEM_ICONS[i.itemType]||''} ${i.brand ? i.brand+' ' : ''}${i.itemType}\n   Problem: ${i.description||'N/A'}\n   Estimate: ₹${i.estimatedAmount||0}`).join('\n\n');
    const totals = getJobTotals(j.items, j.advanceAmount);
    const msg = `🏪 *SWISSA — Watch & Opticals*\n${SHOP.address}\n\n📋 *REPAIR RECEIPT*\n\n🔖 *Job No: #${j.jobNumber}*\n👤 Customer: ${j.customerName}\n📱 Phone: ${j.countryCode} ${j.mobileNumber}\n📅 Date: ${j.receivedDate}\n\n*Items Received:*\n${itemsList}\n\n💰 Total Estimate: ₹${totals.totalEstimated}\n💵 Advance: ₹${j.advanceAmount}\n📊 Balance: ₹${totals.balance}\n\nPlease save this number for updates.\nThank you for choosing SWISSA! 🙏\n\n${COMMUNITY_MSG}`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  async function pickContact() {
    try {
      if (Platform.OS === 'web') { showToastMsg('Contacts available on mobile only', true); return; }
      const Contacts = require('expo-contacts');
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Contacts access required.'); return; }
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name], sort: Contacts.SortTypes.FirstName });
      const mapped = data.filter((c: any) => c.phoneNumbers?.length).map((c: any) => ({ id: c.id, name: c.name||'', phone: c.phoneNumbers[0].number||'' }));
      setContactsList(mapped); setContactSearch(''); setShowContactPicker(true);
    } catch { showToastMsg('Could not load contacts', true); }
  }

  const [contactsList, setContactsList] = useState<any[]>([]);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactSearch, setContactSearch] = useState('');

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

  const filteredContacts = contactsList.filter(c => { const q = contactSearch.toLowerCase(); return !q || c.name.toLowerCase().includes(q) || c.phone.includes(q); });
  const totals = getJobTotals(items, parseFloat(advanceAmount) || 0);

  function renderItemCard(item: RepairItem) {
    const isExpanded = expandedItem === item.id;
    const icon = ITEM_ICONS[item.itemType] || '🔧';
    return (
      <View key={item.id} style={s.itemCard}>
        <TouchableOpacity testID={`item-header-${item.itemNumber}`} style={s.itemHeader} onPress={() => setExpandedItem(isExpanded ? null : item.id)}>
          <View style={{flex:1}}>
            <Text style={s.itemHeaderTitle}>Item {item.itemNumber} — {icon} {item.brand ? item.brand+' ' : ''}{item.itemType}</Text>
            {item.description ? <Text style={s.itemHeaderSub} numberOfLines={1}>{item.description}</Text> : null}
            {item.estimatedAmount > 0 && <Text style={s.itemHeaderEst}>Est: ₹{item.estimatedAmount}</Text>}
          </View>
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={C.textMuted} />
        </TouchableOpacity>

        {isExpanded && (
          <View style={s.itemBody}>
            <Text style={s.label}>ITEM TYPE</Text>
            <View style={s.typeRow}>
              {ITEM_TYPES.map(t => (
                <TouchableOpacity key={t} testID={`type-${item.id}-${t}`} style={[s.typeBtn, item.itemType===t && s.typeBtnActive]} onPress={() => updateItemField(item.id, 'itemType', t)}>
                  <Text style={s.typeIcon}>{ITEM_ICONS[t]}</Text>
                  <Text style={[s.typeLabel, item.itemType===t && s.typeLabelActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.row}>
              <View style={{flex:1}}><Text style={s.label}>BRAND</Text><TextInput testID={`brand-${item.id}`} style={s.input} value={item.brand} onChangeText={v => updateItemField(item.id,'brand',v)} placeholder="e.g. Titan, Casio" placeholderTextColor={C.textMuted} /></View>
              <View style={{flex:1}}><Text style={s.label}>MODEL</Text><TextInput testID={`model-${item.id}`} style={s.input} value={item.model} onChangeText={v => updateItemField(item.id,'model',v)} placeholder="Model" placeholderTextColor={C.textMuted} /></View>
            </View>

            <Text style={s.label}>COLOR / IDENTIFICATION</Text>
            <TextInput testID={`ident-${item.id}`} style={s.input} value={item.identification} onChangeText={v => updateItemField(item.id,'identification',v)} placeholder="e.g. Golden round watch" placeholderTextColor={C.textMuted} />

            <Text style={s.label}>DESCRIPTION / PROBLEM</Text>
            <TextInput testID={`desc-${item.id}`} style={[s.input, {minHeight:50}]} value={item.description} onChangeText={v => updateItemField(item.id,'description',v)} placeholder="Describe the issue..." placeholderTextColor={C.textMuted} multiline textAlignVertical="top" />

            <TouchableOpacity testID={`phrases-${item.id}`} style={s.phraseBtn} onPress={() => openPhraseModal(item.id)}>
              <Ionicons name="list-outline" size={18} color={C.blue} />
              <Text style={s.phraseBtnText}>Select from Phrases ({item.selectedPhrases?.length || 0} selected)</Text>
            </TouchableOpacity>

            {item.selectedPhrases?.length > 0 && (
              <View style={s.selectedPhrases}>
                {item.selectedPhrases.map((p,i) => (
                  <View key={i} style={s.phraseChip}><Text style={s.phraseChipText}>{p}</Text>
                    <TouchableOpacity onPress={() => togglePhrase(item.id, p)}><Ionicons name="close-circle" size={16} color={C.textMuted} /></TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <View style={s.row}>
              <View style={{flex:1}}><Text style={s.label}>ESTIMATED (₹)</Text><TextInput testID={`est-${item.id}`} style={s.input} value={String(item.estimatedAmount||'')} onChangeText={v => updateItemField(item.id,'estimatedAmount',parseFloat(v)||0)} keyboardType="numeric" placeholder="0" placeholderTextColor={C.textMuted} /></View>
              <View style={{flex:1}}><Text style={s.label}>FINAL (₹)</Text><TextInput testID={`final-${item.id}`} style={s.input} value={String(item.finalAmount||'')} onChangeText={v => updateItemField(item.id,'finalAmount',parseFloat(v)||0)} keyboardType="numeric" placeholder="0" placeholderTextColor={C.textMuted} /></View>
            </View>

            <Text style={s.label}>CUSTOMER COMPLAINT</Text>
            <TextInput style={s.input} value={item.customerComplaint} onChangeText={v => updateItemField(item.id,'customerComplaint',v)} placeholder="Customer's words..." placeholderTextColor={C.textMuted} />

            <Text style={s.label}>ACCESSORIES RECEIVED</Text>
            <TextInput style={s.input} value={item.accessoriesReceived} onChangeText={v => updateItemField(item.id,'accessoriesReceived',v)} placeholder="Box, strap, etc." placeholderTextColor={C.textMuted} />

            <Text style={s.label}>PHOTOS</Text>
            <View style={s.photoActions}>
              <TouchableOpacity testID={`camera-${item.id}`} style={s.photoBtn} onPress={() => handleTakePhoto(item.id)}>
                <Ionicons name="camera-outline" size={18} color={C.primary} /><Text style={s.photoBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity testID={`gallery-${item.id}`} style={s.photoBtn} onPress={() => handlePickGallery(item.id)}>
                <Ionicons name="images-outline" size={18} color={C.primary} /><Text style={s.photoBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
            {item.photos?.length > 0 && (
              <ScrollView horizontal style={s.photosRow} showsHorizontalScrollIndicator={false}>
                {item.photos.map((p, idx) => (
                  <View key={idx} style={s.photoWrap}>
                    <Image source={{uri:p}} style={s.photoThumb} />
                    <TouchableOpacity style={s.photoRemove} onPress={() => removePhoto(item.id, idx)}>
                      <Ionicons name="close-circle" size={20} color={C.red} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={s.itemActions}>
              <TouchableOpacity testID={`dup-${item.id}`} style={s.itemActionBtn} onPress={() => duplicateItem(item)}>
                <Ionicons name="copy-outline" size={16} color={C.blue} /><Text style={[s.itemActionText,{color:C.blue}]}>Duplicate</Text>
              </TouchableOpacity>
              <TouchableOpacity testID={`remove-${item.id}`} style={s.itemActionBtn} onPress={() => removeItem(item.id)}>
                <Ionicons name="trash-outline" size={16} color={C.red} /><Text style={[s.itemActionText,{color:C.red}]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
        <View style={s.header}>
          <Text testID="header-title" style={s.headerTitle}>{SHOP.name}</Text>
          <Text style={s.headerSub}>{SHOP.tagline}</Text>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={s.sectionTitle}>New Repair Job  #{jobNumber}</Text>

          <TouchableOpacity testID="btn-contacts" style={s.contactsBtn} onPress={pickContact}>
            <Ionicons name="person-circle-outline" size={20} color={C.blue} /><Text style={s.contactsBtnText}>Pick from Contacts</Text>
          </TouchableOpacity>

          <Text style={s.label}>CUSTOMER NAME</Text>
          <TextInput testID="input-name" style={s.input} value={customerName} onChangeText={setCustomerName} placeholder="Customer name" placeholderTextColor={C.textMuted} />

          <Text style={s.label}>MOBILE NUMBER</Text>
          <View style={s.phoneRow}>
            <TouchableOpacity testID="country-code-picker" style={s.countryBtn} onPress={() => setShowCountryPicker(true)}>
              <Text style={s.countryText}>{COUNTRY_CODES.find(c=>c.code===countryCode)?.flag} {countryCode}</Text>
              <Ionicons name="chevron-down" size={14} color={C.textMuted} />
            </TouchableOpacity>
            <TextInput testID="input-phone" style={[s.input,{flex:1}]} value={mobileNumber} onChangeText={setMobileNumber} placeholder="Mobile number" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
          </View>

          <View style={s.row}>
            <View style={{flex:1}}>
              <Text style={s.label}>ADVANCE AMOUNT (₹)</Text>
              <TextInput testID="input-advance" style={s.input} value={advanceAmount} onChangeText={setAdvanceAmount} placeholder="0" placeholderTextColor={C.textMuted} keyboardType="numeric" />
            </View>
          </View>

          <Text style={s.label}>OVERALL NOTES</Text>
          <TextInput testID="input-notes" style={[s.input,{minHeight:50}]} value={overallNotes} onChangeText={setOverallNotes} placeholder="General notes..." placeholderTextColor={C.textMuted} multiline textAlignVertical="top" />

          <View style={s.divider} />
          <Text style={s.sectionTitle}>Repair Items ({items.length})</Text>

          {items.map(renderItemCard)}

          <TouchableOpacity testID="btn-add-item" style={s.addItemBtn} onPress={addItem}>
            <Ionicons name="add-circle" size={22} color={C.blue} /><Text style={s.addItemText}>+ Add Another Item</Text>
          </TouchableOpacity>

          <View style={s.totalsCard}>
            <Text style={s.totalsTitle}>Job Totals</Text>
            <View style={s.totalsRow}><Text style={s.totalsLabel}>Total Estimate</Text><Text style={s.totalsValue}>₹{totals.totalEstimated}</Text></View>
            <View style={s.totalsRow}><Text style={s.totalsLabel}>Advance</Text><Text style={s.totalsValue}>₹{parseFloat(advanceAmount)||0}</Text></View>
            <View style={s.totalsRow}><Text style={[s.totalsLabel,{fontWeight:'800'}]}>Balance</Text><Text style={[s.totalsValue,{fontWeight:'800',color:totals.balance>0?C.red:C.green800}]}>₹{totals.balance}</Text></View>
          </View>

          <TouchableOpacity testID="btn-save" style={s.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={C.primaryFg} /> : <><Ionicons name="checkmark-circle" size={20} color={C.primaryFg} /><Text style={s.saveBtnText}>Save & Send Receipt</Text></>}
          </TouchableOpacity>

          <View style={{height:40}} />
        </ScrollView>

        {/* Country Code Modal */}
        <Modal visible={showCountryPicker} transparent animationType="slide">
          <View style={s.modalOverlay}><View style={s.modalBox}>
            <View style={s.modalHeader}><Text style={s.modalTitle}>Country Code</Text><TouchableOpacity onPress={() => setShowCountryPicker(false)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity></View>
            <FlatList data={COUNTRY_CODES} keyExtractor={i=>i.code} renderItem={({item})=>(
              <TouchableOpacity style={s.modalItem} onPress={()=>{setCountryCode(item.code);setShowCountryPicker(false)}}><Text style={s.modalItemText}>{item.flag}  {item.code}</Text></TouchableOpacity>
            )} />
          </View></View>
        </Modal>

        {/* Contact Picker Modal */}
        <Modal visible={showContactPicker} transparent animationType="slide">
          <View style={s.modalOverlay}><View style={[s.modalBox,{maxHeight:'80%'}]}>
            <View style={s.modalHeader}><Text style={s.modalTitle}>Pick Contact</Text><TouchableOpacity onPress={()=>setShowContactPicker(false)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity></View>
            <View style={{paddingHorizontal:16,paddingBottom:8}}><TextInput style={s.input} value={contactSearch} onChangeText={setContactSearch} placeholder="Search..." placeholderTextColor={C.textMuted} /></View>
            <FlatList data={filteredContacts} keyExtractor={i=>i.id} renderItem={({item})=>(
              <TouchableOpacity style={s.modalItem} onPress={()=>selectContact(item)}><Text style={[s.modalItemText,{fontWeight:'700'}]}>{item.name}</Text><Text style={{fontSize:13,color:C.textMuted}}>{item.phone}</Text></TouchableOpacity>
            )} ListEmptyComponent={<Text style={{padding:20,color:C.textMuted,textAlign:'center'}}>No contacts</Text>} />
          </View></View>
        </Modal>

        {/* Phrase Selector Modal */}
        <Modal visible={!!showPhraseModal} transparent animationType="slide">
          <View style={s.modalOverlay}><View style={[s.modalBox,{maxHeight:'80%'}]}>
            <View style={s.modalHeader}><Text style={s.modalTitle}>Select Phrases</Text><TouchableOpacity onPress={()=>setShowPhraseModal(null)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity></View>
            <FlatList data={[...phrases, ...customPhrasesList]} keyExtractor={(p,i)=>p+i} renderItem={({item:phrase})=>{
              const currentItem = items.find(i=>i.id===showPhraseModal);
              const selected = currentItem?.selectedPhrases?.includes(phrase);
              return (
                <TouchableOpacity style={[s.phraseItem, selected && s.phraseItemSelected]} onPress={()=>showPhraseModal && togglePhrase(showPhraseModal, phrase)}>
                  <Ionicons name={selected?'checkbox':'square-outline'} size={20} color={selected?C.green800:C.textMuted} />
                  <Text style={[s.phraseItemText, selected && {color:C.green800,fontWeight:'700'}]}>{phrase}</Text>
                </TouchableOpacity>
              );
            }} />
          </View></View>
        </Modal>

        {/* Receipt Modal */}
        <Modal visible={showReceipt} transparent animationType="fade">
          <View style={s.receiptOverlay}><ScrollView contentContainerStyle={s.receiptScroll}>
            <View style={s.receiptBox}>
              <TouchableOpacity testID="close-receipt" style={s.receiptClose} onPress={()=>setShowReceipt(false)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity>
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
                    <Text style={s.receiptItemTitle}>Item {idx+1} — {ITEM_ICONS[item.itemType]} {item.brand?item.brand+' ':''}{item.itemType}</Text>
                    <Text style={s.receiptItemDesc}>Problem: {item.description||'N/A'}</Text>
                    <Text style={s.receiptItemEst}>Estimate: ₹{item.estimatedAmount||0}</Text>
                  </View>
                ))}
                <View style={s.divider} />
                <View style={s.receiptTotals}>
                  <View style={s.totalsRow}><Text style={s.totalsLabel}>Total Estimate</Text><Text style={s.totalsValue}>₹{getJobTotals(savedJob.items, savedJob.advanceAmount).totalEstimated}</Text></View>
                  <View style={s.totalsRow}><Text style={s.totalsLabel}>Advance</Text><Text style={s.totalsValue}>₹{savedJob.advanceAmount}</Text></View>
                  <View style={s.totalsRow}><Text style={[s.totalsLabel,{fontWeight:'800'}]}>Balance</Text><Text style={[s.totalsValue,{fontWeight:'800'}]}>₹{getJobTotals(savedJob.items, savedJob.advanceAmount).balance}</Text></View>
                </View>
              </>}
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
  safe:{flex:1,backgroundColor:C.bg},
  header:{backgroundColor:C.surface,paddingHorizontal:20,paddingVertical:16,borderBottomWidth:1,borderBottomColor:C.border},
  headerTitle:{fontSize:28,fontWeight:'900',color:C.primary,letterSpacing:-1},
  headerSub:{fontSize:13,color:C.textMuted,fontWeight:'600',letterSpacing:1,marginTop:2},
  scroll:{flex:1},scrollContent:{padding:20},
  sectionTitle:{fontSize:20,fontWeight:'700',color:C.primary,marginBottom:16},
  contactsBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#EFF6FF',borderWidth:1,borderColor:'#BFDBFE',borderRadius:10,paddingVertical:12,marginBottom:16},
  contactsBtnText:{fontSize:15,fontWeight:'700',color:C.blue},
  label:{fontSize:11,fontWeight:'700',color:C.textMuted,letterSpacing:1.5,marginBottom:6,marginTop:14},
  input:{backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:10,paddingHorizontal:14,paddingVertical:12,fontSize:15,color:C.text},
  phoneRow:{flexDirection:'row',gap:10},
  countryBtn:{flexDirection:'row',alignItems:'center',backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:10,paddingHorizontal:14,paddingVertical:12,gap:6},
  countryText:{fontSize:15,color:C.text,fontWeight:'600'},
  row:{flexDirection:'row',gap:10},
  divider:{height:1,backgroundColor:C.border,marginVertical:20},
  // Item Card
  itemCard:{backgroundColor:C.surface,borderRadius:12,borderWidth:1,borderColor:C.border,marginBottom:12,overflow:'hidden'},
  itemHeader:{flexDirection:'row',alignItems:'center',padding:14,gap:10},
  itemHeaderTitle:{fontSize:15,fontWeight:'700',color:C.text},
  itemHeaderSub:{fontSize:12,color:C.textMuted,marginTop:2},
  itemHeaderEst:{fontSize:12,color:C.green800,fontWeight:'600',marginTop:2},
  itemBody:{padding:14,borderTopWidth:1,borderTopColor:C.border},
  typeRow:{flexDirection:'row',gap:8,flexWrap:'wrap'},
  typeBtn:{alignItems:'center',paddingVertical:10,paddingHorizontal:12,borderRadius:8,borderWidth:1,borderColor:C.border,backgroundColor:C.bg,minWidth:70},
  typeBtnActive:{borderColor:C.primary,backgroundColor:C.primary},
  typeIcon:{fontSize:22},
  typeLabel:{fontSize:11,fontWeight:'700',color:C.text,marginTop:4},
  typeLabelActive:{color:C.primaryFg},
  phraseBtn:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'#EFF6FF',borderRadius:8,paddingVertical:10,paddingHorizontal:14,marginTop:10},
  phraseBtnText:{fontSize:13,fontWeight:'600',color:C.blue},
  selectedPhrases:{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:8},
  phraseChip:{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:C.green100,paddingHorizontal:10,paddingVertical:5,borderRadius:20},
  phraseChipText:{fontSize:12,fontWeight:'600',color:C.green800},
  photoActions:{flexDirection:'row',gap:10},
  photoBtn:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:12,paddingVertical:10,borderRadius:8,backgroundColor:C.secondary,borderWidth:1,borderColor:C.border},
  photoBtnText:{fontSize:13,fontWeight:'600',color:C.primary},
  photosRow:{marginTop:10},
  photoWrap:{position:'relative',marginRight:10},
  photoThumb:{width:80,height:80,borderRadius:8,backgroundColor:C.secondary},
  photoRemove:{position:'absolute',top:-5,right:-5},
  itemActions:{flexDirection:'row',gap:12,marginTop:16,paddingTop:12,borderTopWidth:1,borderTopColor:C.border},
  itemActionBtn:{flexDirection:'row',alignItems:'center',gap:4,paddingVertical:8,paddingHorizontal:12,borderRadius:8,backgroundColor:C.bg},
  itemActionText:{fontSize:13,fontWeight:'700'},
  addItemBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderWidth:2,borderColor:C.blue,borderStyle:'dashed',borderRadius:12,paddingVertical:16,marginBottom:16},
  addItemText:{fontSize:16,fontWeight:'700',color:C.blue},
  // Totals
  totalsCard:{backgroundColor:C.surface,borderRadius:12,borderWidth:1,borderColor:C.border,padding:16,marginBottom:16},
  totalsTitle:{fontSize:16,fontWeight:'700',color:C.primary,marginBottom:10},
  totalsRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:6},
  totalsLabel:{fontSize:14,color:C.textMuted,fontWeight:'500'},
  totalsValue:{fontSize:14,color:C.text,fontWeight:'700'},
  saveBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:C.primary,borderRadius:12,paddingVertical:16},
  saveBtnText:{fontSize:16,fontWeight:'700',color:C.primaryFg},
  // Modals
  modalOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'flex-end'},
  modalBox:{backgroundColor:C.surface,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'70%',paddingBottom:20},
  modalHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:20,borderBottomWidth:1,borderBottomColor:C.border},
  modalTitle:{fontSize:18,fontWeight:'700',color:C.primary},
  modalItem:{paddingHorizontal:20,paddingVertical:14,borderBottomWidth:1,borderBottomColor:C.border},
  modalItemText:{fontSize:16,color:C.text},
  phraseItem:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:20,paddingVertical:14,borderBottomWidth:1,borderBottomColor:C.border},
  phraseItemSelected:{backgroundColor:C.green100},
  phraseItemText:{fontSize:15,color:C.text},
  // Receipt
  receiptOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.5)'},
  receiptScroll:{flexGrow:1,justifyContent:'center',padding:20},
  receiptBox:{backgroundColor:C.surface,borderRadius:16,padding:24,position:'relative'},
  receiptClose:{position:'absolute',top:16,right:16,zIndex:1},
  receiptShop:{fontSize:26,fontWeight:'900',color:C.primary,textAlign:'center',letterSpacing:-1},
  receiptTag:{fontSize:13,color:C.textMuted,textAlign:'center',fontWeight:'600',letterSpacing:1},
  receiptAddr:{fontSize:11,color:C.textMuted,textAlign:'center',marginTop:6,lineHeight:16},
  receiptJobNo:{fontSize:18,fontWeight:'800',color:C.primary,textAlign:'center'},
  receiptCust:{fontSize:14,color:C.textMuted,textAlign:'center',marginTop:4},
  receiptItem:{backgroundColor:C.bg,borderRadius:8,padding:12,marginBottom:8},
  receiptItemTitle:{fontSize:14,fontWeight:'700',color:C.text},
  receiptItemDesc:{fontSize:12,color:C.textMuted,marginTop:4},
  receiptItemEst:{fontSize:13,fontWeight:'700',color:C.green800,marginTop:4},
  receiptTotals:{},
  waBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:C.whatsapp,borderRadius:12,paddingVertical:14,marginTop:16},
  waBtnText:{fontSize:15,fontWeight:'700',color:'#FFF'},
  toast:{position:'absolute',bottom:100,left:20,right:20,backgroundColor:'#166534',borderRadius:10,padding:14,alignItems:'center'},
  toastErr:{backgroundColor:C.red},
  toastText:{color:'#FFF',fontSize:14,fontWeight:'600'},
});
