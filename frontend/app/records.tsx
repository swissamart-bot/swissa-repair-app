import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Modal, Image, ScrollView, Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { getAllRecords, updateRecord, deleteRecordById } from '../src/database';
import { C, SHOP, ITEM_TYPES, DELIVERY_MSG } from '../src/constants';
import { RepairRecord } from '../src/types';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'Pending', label: '🕐 Pending' },
  { key: 'Repaired', label: '✅ Repaired' },
  { key: 'Delivered', label: '📦 Delivered' },
];

export default function Records() {
  const [records, setRecords] = useState<RepairRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [receiptRecord, setReceiptRecord] = useState<RepairRecord | null>(null);
  const [photoRecord, setPhotoRecord] = useState<RepairRecord | null>(null);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  // Edit state
  const [editRecord, setEditRecord] = useState<RepairRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editItem, setEditItem] = useState('');
  const [editIssue, setEditIssue] = useState('');

  useFocusEffect(useCallback(() => { loadRecords(); }, []));

  async function loadRecords() {
    const data = await getAllRecords();
    setRecords(data);
  }

  function showToastMsg(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  // Search includes job ID, name, phone, item
  const filtered = records.filter(r => {
    const matchFilter = filter === 'all' || r.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || r.name.toLowerCase().includes(q) || r.phone.includes(q) || r.item.toLowerCase().includes(q) || r.id.includes(q);
    return matchFilter && matchSearch;
  });

  function startEdit(record: RepairRecord) {
    setEditRecord(record);
    setEditName(record.name);
    setEditPhone(record.phone);
    setEditItem(record.item);
    setEditIssue(record.issue);
  }

  async function saveEdit() {
    if (!editRecord) return;
    if (!editName.trim()) { showToastMsg('Name is required', true); return; }
    const updated: RepairRecord = {
      ...editRecord,
      name: editName.trim(),
      phone: editPhone.trim(),
      item: editItem,
      issue: editIssue.trim(),
    };
    await updateRecord(updated);
    await loadRecords();
    setEditRecord(null);
    showToastMsg('Record updated!');
  }

  async function handleMarkRepaired(record: RepairRecord) {
    Alert.alert('Mark Repaired', `Mark ${record.name}'s ${record.item} as repaired?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes', onPress: async () => {
          const updated = { ...record, status: 'Repaired' as const, repairedAt: new Date().toLocaleString() };
          await updateRecord(updated);
          await loadRecords();
          showToastMsg('Marked as Repaired!');
          sendRepairedWA(updated);
        },
      },
    ]);
  }

  async function handleMarkDelivered(record: RepairRecord) {
    Alert.alert('Mark Delivered', `Mark ${record.name}'s ${record.item} as delivered?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes', onPress: async () => {
          const updated = { ...record, status: 'Delivered' as const, deliveredAt: new Date().toLocaleString() };
          await updateRecord(updated);
          await loadRecords();
          showToastMsg('Marked as Delivered!');
          sendDeliveredWA(updated);
        },
      },
    ]);
  }

  function sendRepairedWA(r: RepairRecord) {
    const cleanPhone = (r.countryCode + r.phone).replace(/\D/g, '');
    const msg = `🏪 *SWISSA — Watch & Opticals*\n\nHi ${r.name}! 👋\n\nYour ${r.item} is *READY* for collection. ✅\nઆપનું ${r.item} લેવા *તૈયાર* છે. ✅\nआपकी ${r.item} लेने के लिए *तैयार* है. ✅\n\n🔖 *Job ID: #${r.id}*\n\n📍 ${SHOP.address}\n\n${DELIVERY_MSG}\n\n⚠️ *SHOW THIS MESSAGE WHILE TAKING DELIVERY*\n⚠️ *SHARE THIS MESSAGE ONLY TO TRUSTED PEOPLE FOR TAKING DELIVERY*\n\nThank you for choosing SWISSA! 🙏`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  function sendDeliveredWA(r: RepairRecord) {
    const cleanPhone = (r.countryCode + r.phone).replace(/\D/g, '');
    const msg = `🏪 *SWISSA — Watch & Opticals*\n\nHi ${r.name}! 👋\n\nYour ${r.item} has been successfully *DELIVERED*. ✅\n\n🔖 *Job ID: #${r.id}*\n\nThank you for choosing SWISSA! 🙏\nWe hope to serve you again!`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  // KEY FIX: Send reminder multiple times for repaired items
  function sendReminderWA(r: RepairRecord) {
    const cleanPhone = (r.countryCode + r.phone).replace(/\D/g, '');
    const msg = `🏪 *SWISSA — Watch & Opticals*\n\nHi ${r.name}! 👋 Reminder:\n\nYour ${r.item} is *READY* for collection. ✅\nઆપનું ${r.item} લેવા *તૈયાર* છે. ✅\nआपकी ${r.item} लेने के लिए *तैयार* है. ✅\n\n🔖 *Job ID: #${r.id}*\n\n📍 ${SHOP.address}\n\n${DELIVERY_MSG}\n\n⚠️ *SHOW THIS MESSAGE WHILE TAKING DELIVERY*\n⚠️ *SHARE THIS MESSAGE ONLY TO TRUSTED PEOPLE FOR TAKING DELIVERY*\n\nThank you! 🙏`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  function shareReceiptWA(r: RepairRecord) {
    const cleanPhone = (r.countryCode + r.phone).replace(/\D/g, '');
    const msg = `🏪 *SWISSA — Watch & Opticals*\n${SHOP.address}\n\n📋 *REPAIR RECEIPT*\n\n🔖 *Job ID: #${r.id}*\n👤 Name: ${r.name}\n📱 Phone: ${r.countryCode} ${r.phone}\n🔧 Item: ${r.item}\n❓ Issue: ${r.issue || 'N/A'}\n📅 Date In: ${r.date}\n📊 Status: ${r.status}\n\nThank you for choosing SWISSA! 🙏`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  async function handleDelete(record: RepairRecord) {
    Alert.alert('Delete Record', `Delete ${record.name}'s record?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteRecordById(record.id);
          await loadRecords();
          showToastMsg('Record deleted');
        },
      },
    ]);
  }

  function getStatusStyle(status: string) {
    if (status === 'Pending') return { bg: C.amber100, text: C.amber800 };
    if (status === 'Repaired') return { bg: C.green100, text: C.green800 };
    return { bg: C.slate100, text: C.slate800 };
  }

  function renderRecord({ item: r }: { item: RepairRecord }) {
    const statusStyle = getStatusStyle(r.status);
    return (
      <View style={s.card}>
        <View style={s.cardTop}>
          {r.photo ? (
            <TouchableOpacity testID={`photo-${r.id}`} onPress={() => setPhotoRecord(r)}>
              <Image source={{ uri: r.photo }} style={s.thumb} />
            </TouchableOpacity>
          ) : (
            <View style={s.thumbPlaceholder}>
              <Ionicons name="image-outline" size={24} color={C.textMuted} />
            </View>
          )}
          <View style={s.cardInfo}>
            <Text style={s.cardName} numberOfLines={1}>{r.name}</Text>
            <Text style={s.cardPhone}>{r.countryCode} {r.phone}</Text>
            <Text style={s.cardJobId}>Job #{r.id}</Text>
            <View style={s.badges}>
              <View style={s.itemBadge}><Text style={s.itemBadgeText}>{r.item}</Text></View>
              <View style={[s.statusBadge, { backgroundColor: statusStyle.bg }]}>
                <Text style={[s.statusBadgeText, { color: statusStyle.text }]}>{r.status}</Text>
              </View>
            </View>
            {r.issue ? <Text style={s.cardIssue} numberOfLines={1}>{r.issue}</Text> : null}
            <Text style={s.cardDate}>{r.date}</Text>
          </View>
          <TouchableOpacity testID={`delete-${r.id}`} style={s.deleteBtn} onPress={() => handleDelete(r)}>
            <Ionicons name="trash-outline" size={18} color={C.red} />
          </TouchableOpacity>
        </View>
        <View style={s.cardActions}>
          <TouchableOpacity testID={`edit-${r.id}`} style={s.actionBtn} onPress={() => startEdit(r)}>
            <Ionicons name="create-outline" size={16} color={C.primary} />
            <Text style={s.actionText}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity testID={`receipt-${r.id}`} style={s.actionBtn} onPress={() => setReceiptRecord(r)}>
            <Ionicons name="receipt-outline" size={16} color={C.primary} />
            <Text style={s.actionText}>Receipt</Text>
          </TouchableOpacity>

          {r.status === 'Repaired' && (
            <TouchableOpacity testID={`reminder-${r.id}`} style={[s.actionBtn, { backgroundColor: '#E8FAF0' }]} onPress={() => sendReminderWA(r)}>
              <Ionicons name="logo-whatsapp" size={16} color={C.whatsapp} />
              <Text style={[s.actionText, { color: C.whatsapp }]}>Remind</Text>
            </TouchableOpacity>
          )}

          {r.status === 'Pending' && (
            <TouchableOpacity testID={`mark-repaired-${r.id}`} style={[s.actionBtn, { backgroundColor: C.green100 }]} onPress={() => handleMarkRepaired(r)}>
              <Ionicons name="checkmark-circle-outline" size={16} color={C.green800} />
              <Text style={[s.actionText, { color: C.green800 }]}>Repaired</Text>
            </TouchableOpacity>
          )}

          {r.status === 'Repaired' && (
            <TouchableOpacity testID={`mark-delivered-${r.id}`} style={[s.actionBtn, { backgroundColor: C.slate100 }]} onPress={() => handleMarkDelivered(r)}>
              <Ionicons name="cube-outline" size={16} color={C.slate800} />
              <Text style={[s.actionText, { color: C.slate800 }]}>Delivered</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Records</Text>
        <TextInput testID="search-input" style={s.searchInput} value={search} onChangeText={setSearch}
          placeholder="Search by name, phone, job ID..." placeholderTextColor={C.textMuted} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtersRow} style={s.filtersScroll}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f.key} testID={`filter-${f.key}`}
            style={[s.chip, filter === f.key && s.chipActive]}
            onPress={() => setFilter(f.key)}>
            <Text style={[s.chipText, filter === f.key && s.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.countRow}>
        <Text testID="records-count" style={s.countText}>{filtered.length} entries</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderRecord}
        contentContainerStyle={s.list}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="document-text-outline" size={48} color={C.border} />
            <Text style={s.emptyText}>No records found</Text>
          </View>
        }
      />

      {/* Edit Modal */}
      <Modal visible={!!editRecord} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ justifyContent: 'flex-end' }}>
            <View style={s.editBox}>
              <View style={s.editHeader}>
                <Text style={s.editTitle}>Edit Record #{editRecord?.id}</Text>
                <TouchableOpacity testID="close-edit" onPress={() => setEditRecord(null)}>
                  <Ionicons name="close" size={24} color={C.primary} />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
                <Text style={s.editLabel}>NAME</Text>
                <TextInput testID="edit-name" style={s.editInput} value={editName} onChangeText={setEditName} />
                <Text style={s.editLabel}>PHONE</Text>
                <TextInput testID="edit-phone" style={s.editInput} value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" />
                <Text style={s.editLabel}>ITEM TYPE</Text>
                <View style={s.editItemRow}>
                  {ITEM_TYPES.map(it => (
                    <TouchableOpacity key={it.key} testID={`edit-item-${it.key.toLowerCase()}`}
                      style={[s.editItemBtn, editItem === it.key && s.editItemBtnActive]}
                      onPress={() => setEditItem(it.key)}>
                      <Text style={s.editItemIcon}>{it.icon}</Text>
                      <Text style={[s.editItemLabel, editItem === it.key && s.editItemLabelActive]}>{it.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.editLabel}>ISSUE / FAULT</Text>
                <TextInput testID="edit-issue" style={[s.editInput, { minHeight: 60 }]} value={editIssue} onChangeText={setEditIssue} multiline textAlignVertical="top" />
                <TouchableOpacity testID="btn-save-edit" style={s.editSaveBtn} onPress={saveEdit}>
                  <Ionicons name="checkmark-circle" size={20} color={C.primaryFg} />
                  <Text style={s.editSaveBtnText}>Save Changes</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Receipt Modal */}
      <Modal visible={!!receiptRecord} transparent animationType="fade">
        <View style={s.receiptOverlay}>
          <ScrollView contentContainerStyle={s.receiptScrollContent}>
            <View style={s.receiptBox}>
              <TouchableOpacity testID="close-receipt-modal" style={s.receiptClose} onPress={() => setReceiptRecord(null)}>
                <Ionicons name="close" size={24} color={C.primary} />
              </TouchableOpacity>
              <Text style={s.receiptShopName}>{SHOP.name}</Text>
              <Text style={s.receiptTagline}>{SHOP.tagline}</Text>
              <Text style={s.receiptAddr}>{SHOP.address}</Text>
              <View style={s.divider} />
              {receiptRecord?.photo && <Image source={{ uri: receiptRecord.photo }} style={s.receiptPhoto} />}
              {receiptRecord && (
                <>
                  <RRow label="Job ID" value={`#${receiptRecord.id}`} />
                  <RRow label="Name" value={receiptRecord.name} />
                  <RRow label="Phone" value={`${receiptRecord.countryCode} ${receiptRecord.phone}`} />
                  <RRow label="Item" value={receiptRecord.item} />
                  {receiptRecord.issue ? <RRow label="Issue" value={receiptRecord.issue} /> : null}
                  <RRow label="Date In" value={receiptRecord.date} />
                  <RRow label="Status" value={receiptRecord.status} valueColor={getStatusStyle(receiptRecord.status).text} />
                  {receiptRecord.repairedAt && <RRow label="Repaired" value={receiptRecord.repairedAt} />}
                  {receiptRecord.deliveredAt && <RRow label="Delivered" value={receiptRecord.deliveredAt} />}
                </>
              )}
              <View style={s.divider} />
              <TouchableOpacity testID="btn-receipt-wa" style={s.waBtn} onPress={() => receiptRecord && shareReceiptWA(receiptRecord)}>
                <Ionicons name="logo-whatsapp" size={20} color="#FFF" />
                <Text style={s.waBtnText}>Send Receipt via WhatsApp</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Photo Modal */}
      <Modal visible={!!photoRecord} transparent animationType="fade">
        <View style={s.photoModal}>
          <TouchableOpacity testID="close-photo-modal" style={s.photoClose} onPress={() => setPhotoRecord(null)}>
            <Ionicons name="close-circle" size={36} color="#FFF" />
          </TouchableOpacity>
          {photoRecord?.photo && <Image source={{ uri: photoRecord.photo }} style={s.photoFull} resizeMode="contain" />}
        </View>
      </Modal>

      {toast && (
        <View style={[s.toast, toast.err && s.toastErr]}>
          <Text style={s.toastText}>{toast.msg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function RRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.rrow}>
      <Text style={s.rlabel}>{label}</Text>
      <Text style={[s.rvalue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.surface, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 24, fontWeight: '800', color: C.primary, marginBottom: 12 },
  searchInput: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: C.text },
  filtersScroll: { flexGrow: 0, backgroundColor: C.surface },
  filtersRow: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.secondary, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: C.textMuted },
  chipTextActive: { color: C.primaryFg },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  countText: { fontSize: 13, color: C.textMuted, fontWeight: '600' },
  list: { padding: 20, paddingTop: 4 },
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 12, overflow: 'hidden' },
  cardTop: { flexDirection: 'row', padding: 14, gap: 12 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: C.secondary },
  thumbPlaceholder: { width: 56, height: 56, borderRadius: 8, backgroundColor: C.secondary, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '700', color: C.text },
  cardPhone: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  cardJobId: { fontSize: 12, color: C.blue, fontWeight: '600', marginTop: 2 },
  badges: { flexDirection: 'row', gap: 8, marginTop: 6 },
  itemBadge: { backgroundColor: C.secondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  itemBadgeText: { fontSize: 11, fontWeight: '700', color: C.text },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardIssue: { fontSize: 12, color: C.textMuted, marginTop: 4 },
  cardDate: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  deleteBtn: { padding: 4 },
  cardActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 10, paddingVertical: 8, gap: 6, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: C.secondary },
  actionText: { fontSize: 12, fontWeight: '700', color: C.text },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontSize: 16, color: C.textMuted, marginTop: 12 },
  // Edit Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', paddingTop: 40 },
  editBox: { backgroundColor: C.surface, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, maxHeight: '70%' },
  editHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  editTitle: { fontSize: 18, fontWeight: '700', color: C.primary },
  editLabel: { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 1.5, marginBottom: 6, marginTop: 14 },
  editInput: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text },
  editItemRow: { flexDirection: 'row', gap: 10 },
  editItemBtn: { flex: 1, alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12, gap: 4 },
  editItemBtnActive: { borderColor: C.primary, backgroundColor: C.primary },
  editItemIcon: { fontSize: 22 },
  editItemLabel: { fontSize: 12, fontWeight: '700', color: C.text },
  editItemLabelActive: { color: C.primaryFg },
  editSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, marginTop: 20, marginBottom: 20 },
  editSaveBtnText: { fontSize: 16, fontWeight: '700', color: C.primaryFg },
  // Receipt Modal
  receiptOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  receiptScrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  receiptBox: { backgroundColor: C.surface, borderRadius: 16, padding: 24, position: 'relative' },
  receiptClose: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  receiptShopName: { fontSize: 26, fontWeight: '900', color: C.primary, textAlign: 'center', letterSpacing: -1 },
  receiptTagline: { fontSize: 13, color: C.textMuted, textAlign: 'center', fontWeight: '600', letterSpacing: 1 },
  receiptAddr: { fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 16 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  receiptPhoto: { width: '100%', height: 180, borderRadius: 10, marginBottom: 8 },
  rrow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  rlabel: { fontSize: 13, color: C.textMuted, fontWeight: '600' },
  rvalue: { fontSize: 14, color: C.text, fontWeight: '700', maxWidth: '60%', textAlign: 'right' },
  waBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.whatsapp, borderRadius: 12, paddingVertical: 14, marginTop: 8 },
  waBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  photoModal: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  photoClose: { position: 'absolute', top: 60, right: 20, zIndex: 1 },
  photoFull: { width: '100%', height: '80%' },
  toast: { position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: '#166534', borderRadius: 10, padding: 14, alignItems: 'center' },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
