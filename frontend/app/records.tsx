import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert, Modal, ScrollView, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { getAllJobs, updateItem, deleteJob, markItemDelivered, getConfig } from '../src/database';
import { C, SHOP, ITEM_ICONS, DELIVERY_MSG, COMMUNITY_MSG, getStatusColor, getOverallStatusColor } from '../src/constants';
import { RepairJob, RepairItem, getOverallStatus, getJobTotals, ITEM_STATUSES } from '../src/types';

export default function Records() {
  const [jobs, setJobs] = useState<RepairJob[]>([]);
  const [search, setSearch] = useState('');
  const [dateSearch, setDateSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState<RepairJob|null>(null);
  const [deliveryJob, setDeliveryJob] = useState<RepairJob|null>(null);
  const [deliveryItems, setDeliveryItems] = useState<Set<string>>(new Set());
  const [includeReview, setIncludeReview] = useState(false);
  const [reviewLink, setReviewLink] = useState('');
  const [statusEditItem, setStatusEditItem] = useState<RepairItem|null>(null);
  const [toast, setToast] = useState<{msg:string;err:boolean}|null>(null);

  useFocusEffect(useCallback(() => { loadJobs(); loadReviewLink(); }, []));

  async function loadJobs() { setJobs(await getAllJobs()); }
  async function loadReviewLink() { const link = await getConfig('googleReviewLink'); setReviewLink(link||''); }

  function showToastMsg(msg: string, err = false) { setToast({ msg, err }); setTimeout(() => setToast(null), 3000); }

  const FILTERS = [
    { key: 'all', label: 'All' }, { key: 'In Progress', label: '🔧 In Progress' },
    { key: 'Ready', label: '✅ Ready' }, { key: 'Partially Delivered', label: '📦 Partial' },
    { key: 'Completed', label: '✓ Done' },
  ];

  const filtered = jobs.filter(j => {
    const status = getOverallStatus(j.items);
    const matchFilter = filter === 'all' || status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || j.customerName.toLowerCase().includes(q) || j.mobileNumber.includes(q) || j.jobNumber.includes(q) ||
      j.items.some(i => i.itemType.toLowerCase().includes(q) || i.brand.toLowerCase().includes(q) || i.model.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || i.status.toLowerCase().includes(q) || i.identification.toLowerCase().includes(q));
    const matchDate = !dateSearch || j.receivedDate.includes(dateSearch) || j.items.some(i => i.deliveredDate?.includes(dateSearch));
    return matchFilter && matchSearch && matchDate;
  });

  // WhatsApp: Ready items message
  function sendReadyWA(job: RepairJob) {
    const readyItems = job.items.filter(i => i.status === 'Ready' && !i.delivered);
    if (readyItems.length === 0) { showToastMsg('No ready items', true); return; }
    const cleanPhone = (job.countryCode + job.mobileNumber).replace(/\D/g, '');
    const itemsList = readyItems.map((i, idx) => `${idx+1}. ${ITEM_ICONS[i.itemType]||''} ${i.brand?i.brand+' ':''}${i.itemType} – ${i.description||'N/A'}`).join('\n');
    const notReady = job.items.filter(i => i.status !== 'Ready' && !i.delivered && i.status !== 'Cancelled');
    let notReadyText = '';
    if (notReady.length > 0) notReadyText = `\n\n${notReady.map(i => `${ITEM_ICONS[i.itemType]||''} ${i.brand?i.brand+' ':''}${i.itemType} is still ${i.status.toLowerCase()}.`).join('\n')}`;
    const readyTotal = readyItems.reduce((s,i) => s + (i.finalAmount || i.estimatedAmount || 0), 0);
    const msg = `🏪 *SWISSA — Watch & Opticals*\n\nHi ${job.customerName}! 👋\n\nThe following items are *READY* for collection:\nઆપની નીચેની વસ્તુઓ લેવા *તૈયાર* છે:\nआपकी निम्न वस्तुएँ लेने के लिए *तैयार* हैं:\n\n${itemsList}${notReadyText}\n\n🔖 *Job No: #${job.jobNumber}*\n💰 Amount due for ready items: ₹${readyTotal}\n\n📍 ${SHOP.address}\n\n${DELIVERY_MSG}\n\n⚠️ *SHOW THIS MESSAGE WHILE TAKING DELIVERY*\n⚠️ *SHARE THIS MESSAGE ONLY TO TRUSTED PEOPLE FOR TAKING DELIVERY*\n\nThank you! 🙏`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }

  // Partial Delivery
  function openDeliveryModal(job: RepairJob) {
    setDeliveryJob(job);
    setDeliveryItems(new Set());
    setIncludeReview(false);
  }

  function toggleDeliveryItem(id: string) {
    const next = new Set(deliveryItems);
    if (next.has(id)) next.delete(id); else next.add(id);
    setDeliveryItems(next);
  }

  async function confirmDelivery() {
    if (!deliveryJob || deliveryItems.size === 0) { showToastMsg('Select items to deliver', true); return; }
    const now = new Date().toLocaleString();
    for (const itemId of deliveryItems) {
      await markItemDelivered(itemId, now);
    }
    await loadJobs();
    // Send WhatsApp
    const cleanPhone = (deliveryJob.countryCode + deliveryJob.mobileNumber).replace(/\D/g, '');
    const deliveredItems = deliveryJob.items.filter(i => deliveryItems.has(i.id));
    const itemsList = deliveredItems.map((i, idx) => `${idx+1}. ${ITEM_ICONS[i.itemType]||''} ${i.brand?i.brand+' ':''}${i.itemType} – ${i.description||'N/A'}`).join('\n');
    let reviewText = '';
    if (includeReview && reviewLink) reviewText = `\n\n⭐ We'd love your feedback! Please leave us a Google review:\n${reviewLink}`;
    const msg = `🏪 *SWISSA — Watch & Opticals*\n\nHi ${deliveryJob.customerName}! 👋\n\nThe following items have been *DELIVERED* successfully:\n\n${itemsList}\n\n🔖 *Job No: #${deliveryJob.jobNumber}*\n\nThank you for choosing SWISSA! 🙏\nWe hope to serve you again!${reviewText}\n\n${COMMUNITY_MSG}`;
    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
    setDeliveryJob(null);
    showToastMsg('Items marked as delivered!');
  }

  // Status change
  async function changeItemStatus(item: RepairItem, newStatus: string) {
    await updateItem({ ...item, status: newStatus, updatedAt: new Date().toISOString() });
    await loadJobs();
    setStatusEditItem(null);
    showToastMsg(`Status updated to ${newStatus}`);
  }

  function handleDeleteJob(job: RepairJob) {
    Alert.alert('Delete Job', `Delete ${job.customerName}'s job #${job.jobNumber} and all items?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteJob(job.id); await loadJobs(); showToastMsg('Job deleted'); }},
    ]);
  }

  function renderJob({ item: job }: { item: RepairJob }) {
    const status = getOverallStatus(job.items);
    const statusColor = getOverallStatusColor(status);
    const totals = getJobTotals(job.items, job.advanceAmount);
    const readyCount = job.items.filter(i => i.status === 'Ready' && !i.delivered).length;
    const deliveredCount = job.items.filter(i => i.delivered).length;

    return (
      <View style={st.card}>
        <TouchableOpacity testID={`job-${job.id}`} style={st.cardTop} onPress={() => setSelectedJob(selectedJob?.id===job.id?null:job)}>
          <View style={{flex:1}}>
            <View style={st.cardNameRow}>
              <Text style={st.cardName} numberOfLines={1}>{job.customerName}</Text>
              <TouchableOpacity testID={`delete-job-${job.id}`} onPress={() => handleDeleteJob(job)}><Ionicons name="trash-outline" size={16} color={C.red} /></TouchableOpacity>
            </View>
            <Text style={st.cardPhone}>{job.countryCode} {job.mobileNumber} • Job #{job.jobNumber}</Text>
            <View style={st.cardMeta}>
              <Text style={st.cardItems}>{job.items.length} item{job.items.length>1?'s':''}</Text>
              <View style={[st.statusBadge, {backgroundColor: statusColor.bg}]}>
                <Text style={[st.statusText, {color: statusColor.text}]}>{status}</Text>
              </View>
            </View>
            <Text style={st.cardSummary} numberOfLines={1}>
              {job.items.map(i => `${ITEM_ICONS[i.itemType]||''} ${i.brand?i.brand+' ':''}${i.itemType} (${i.status})`).join(' • ')}
            </Text>
            {totals.balance > 0 && <Text style={st.cardBalance}>Balance: ₹{totals.balance}</Text>}
            <Text style={st.cardDate}>{job.receivedDate}</Text>
          </View>
        </TouchableOpacity>

        {selectedJob?.id === job.id && (
          <View style={st.cardExpanded}>
            {job.items.map((item, idx) => {
              const sc = getStatusColor(item.status);
              return (
                <View key={item.id} style={st.itemRow}>
                  <View style={{flex:1}}>
                    <Text style={st.itemTitle}>Item {idx+1}: {ITEM_ICONS[item.itemType]} {item.brand?item.brand+' ':''}{item.itemType}</Text>
                    {item.identification ? <Text style={st.itemSub}>{item.identification}</Text> : null}
                    <Text style={st.itemDesc}>{item.description||'No description'}</Text>
                    <View style={{flexDirection:'row',gap:6,marginTop:4,flexWrap:'wrap'}}>
                      <View style={[st.statusBadge,{backgroundColor:sc.bg}]}><Text style={[st.statusText,{color:sc.text}]}>{item.status}</Text></View>
                      {item.estimatedAmount>0 && <Text style={st.itemEst}>Est: ₹{item.estimatedAmount}</Text>}
                      {item.finalAmount>0 && <Text style={st.itemEst}>Final: ₹{item.finalAmount}</Text>}
                    </View>
                  </View>
                  <TouchableOpacity testID={`status-${item.id}`} style={st.statusBtn} onPress={() => setStatusEditItem(item)}>
                    <Ionicons name="swap-horizontal" size={16} color={C.blue} />
                  </TouchableOpacity>
                </View>
              );
            })}

            <View style={st.jobActions}>
              <TouchableOpacity testID={`receipt-${job.id}`} style={st.actionBtn} onPress={() => {
                const cleanPhone = (job.countryCode+job.mobileNumber).replace(/\D/g,'');
                let items = job.items.map((i,idx) => `${idx+1}. ${ITEM_ICONS[i.itemType]||''} ${i.brand?i.brand+' ':''}${i.itemType}\n   Problem: ${i.description||'N/A'}\n   Est: ₹${i.estimatedAmount||0}`).join('\n\n');
                const totals2 = getJobTotals(job.items, job.advanceAmount);
                const msg = `🏪 *SWISSA — Watch & Opticals*\n${SHOP.address}\n\n📋 *REPAIR RECEIPT*\n🔖 *Job No: #${job.jobNumber}*\n👤 ${job.customerName}\n\n${items}\n\n💰 Total: ₹${totals2.displayTotal}\n💵 Advance: ₹${job.advanceAmount}\n📊 Balance: ₹${totals2.balance}\n\n${COMMUNITY_MSG}`;
                Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
              }}>
                <Ionicons name="receipt-outline" size={16} color={C.primary} /><Text style={st.actionText}>Receipt</Text>
              </TouchableOpacity>

              {readyCount > 0 && (
                <TouchableOpacity testID={`ready-wa-${job.id}`} style={[st.actionBtn,{backgroundColor:'#E8FAF0'}]} onPress={() => sendReadyWA(job)}>
                  <Ionicons name="logo-whatsapp" size={16} color={C.whatsapp} /><Text style={[st.actionText,{color:C.whatsapp}]}>Ready ({readyCount})</Text>
                </TouchableOpacity>
              )}

              {job.items.some(i => !i.delivered && (i.status==='Ready'||i.status==='Delivered'===false)) && (
                <TouchableOpacity testID={`deliver-${job.id}`} style={[st.actionBtn,{backgroundColor:C.slate100}]} onPress={() => openDeliveryModal(job)}>
                  <Ionicons name="cube-outline" size={16} color={C.slate800} /><Text style={[st.actionText,{color:C.slate800}]}>Deliver</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Records</Text>
        <TextInput testID="search-input" style={st.searchInput} value={search} onChangeText={setSearch} placeholder="Search name, phone, job#, brand, item..." placeholderTextColor={C.textMuted} />
        <TextInput testID="date-search" style={[st.searchInput,{marginTop:8}]} value={dateSearch} onChangeText={setDateSearch} placeholder="Search by date..." placeholderTextColor={C.textMuted} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filtersRow} style={{flexGrow:0,backgroundColor:C.surface}}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f.key} testID={`filter-${f.key}`} style={[st.chip, filter===f.key && st.chipActive]} onPress={() => setFilter(f.key)}>
            <Text style={[st.chipText, filter===f.key && st.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={st.countRow}><Text testID="records-count" style={st.countText}>{filtered.length} jobs</Text></View>

      <FlatList data={filtered} keyExtractor={j=>j.id} renderItem={renderJob} contentContainerStyle={{padding:20,paddingTop:4}}
        ListEmptyComponent={<View style={st.empty}><Ionicons name="document-text-outline" size={48} color={C.border} /><Text style={st.emptyText}>No records found</Text></View>} />

      {/* Status Change Modal */}
      <Modal visible={!!statusEditItem} transparent animationType="slide">
        <View style={st.modalOverlay}><View style={st.modalBox}>
          <View style={st.modalHeader}><Text style={st.modalTitle}>Change Status</Text><TouchableOpacity onPress={()=>setStatusEditItem(null)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity></View>
          <FlatList data={[...ITEM_STATUSES]} keyExtractor={s=>s} renderItem={({item:s})=>{
            const sc = getStatusColor(s);
            const active = statusEditItem?.status === s;
            return (<TouchableOpacity style={[st.statusItem, active && {backgroundColor:sc.bg}]} onPress={()=>statusEditItem && changeItemStatus(statusEditItem, s)}>
              <View style={[st.statusDot,{backgroundColor:sc.text}]} /><Text style={[st.statusItemText, active && {fontWeight:'800',color:sc.text}]}>{s}</Text>
              {active && <Ionicons name="checkmark" size={18} color={sc.text} />}
            </TouchableOpacity>);
          }} />
        </View></View>
      </Modal>

      {/* Delivery Modal */}
      <Modal visible={!!deliveryJob} transparent animationType="slide">
        <View style={st.modalOverlay}><View style={[st.modalBox,{maxHeight:'80%'}]}>
          <View style={st.modalHeader}><Text style={st.modalTitle}>Select Items to Deliver</Text><TouchableOpacity onPress={()=>setDeliveryJob(null)}><Ionicons name="close" size={24} color={C.primary} /></TouchableOpacity></View>
          <ScrollView contentContainerStyle={{padding:20}}>
            {deliveryJob?.items.filter(i => !i.delivered && i.status !== 'Cancelled').map((item, idx) => (
              <TouchableOpacity key={item.id} style={[st.deliveryItem, deliveryItems.has(item.id) && st.deliveryItemSelected]} onPress={() => toggleDeliveryItem(item.id)}>
                <Ionicons name={deliveryItems.has(item.id)?'checkbox':'square-outline'} size={22} color={deliveryItems.has(item.id)?C.green800:C.textMuted} />
                <View style={{flex:1,marginLeft:10}}>
                  <Text style={st.deliveryItemTitle}>{ITEM_ICONS[item.itemType]} {item.brand?item.brand+' ':''}{item.itemType}</Text>
                  <Text style={st.deliveryItemDesc}>{item.description||'N/A'} • {item.status}</Text>
                  <Text style={st.deliveryItemAmt}>₹{item.finalAmount||item.estimatedAmount||0}</Text>
                </View>
              </TouchableOpacity>
            ))}

            {reviewLink ? (
              <View style={st.reviewRow}>
                <View style={{flex:1}}>
                  <Text style={st.reviewLabel}>Include Google Review link?</Text>
                  <Text style={{fontSize:11,color:C.textMuted}}>Sent in delivery WhatsApp message</Text>
                </View>
                <Switch value={includeReview} onValueChange={setIncludeReview} trackColor={{false:C.border,true:C.green100}} thumbColor={includeReview?C.green800:C.textMuted} />
              </View>
            ) : null}

            <TouchableOpacity testID="confirm-delivery" style={st.confirmDeliveryBtn} onPress={confirmDelivery}>
              <Ionicons name="checkmark-circle" size={20} color={C.primaryFg} /><Text style={st.confirmDeliveryText}>Confirm Delivery & Send WhatsApp</Text>
            </TouchableOpacity>
          </ScrollView>
        </View></View>
      </Modal>

      {toast && <View style={[st.toast, toast.err && st.toastErr]}><Text style={st.toastText}>{toast.msg}</Text></View>}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},
  header:{backgroundColor:C.surface,paddingHorizontal:20,paddingTop:16,paddingBottom:12,borderBottomWidth:1,borderBottomColor:C.border},
  headerTitle:{fontSize:24,fontWeight:'800',color:C.primary,marginBottom:12},
  searchInput:{backgroundColor:C.bg,borderWidth:1,borderColor:C.border,borderRadius:10,paddingHorizontal:14,paddingVertical:10,fontSize:14,color:C.text},
  filtersRow:{flexDirection:'row',paddingHorizontal:20,paddingVertical:10,gap:8},
  chip:{paddingHorizontal:14,paddingVertical:8,borderRadius:20,backgroundColor:C.secondary,borderWidth:1,borderColor:C.border},
  chipActive:{backgroundColor:C.primary,borderColor:C.primary},
  chipText:{fontSize:13,fontWeight:'600',color:C.textMuted},
  chipTextActive:{color:C.primaryFg},
  countRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:20,paddingVertical:10},
  countText:{fontSize:13,color:C.textMuted,fontWeight:'600'},
  // Card
  card:{backgroundColor:C.surface,borderRadius:12,borderWidth:1,borderColor:C.border,marginBottom:12,overflow:'hidden'},
  cardTop:{padding:14},
  cardNameRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  cardName:{fontSize:17,fontWeight:'700',color:C.text,flex:1},
  cardPhone:{fontSize:13,color:C.textMuted,marginTop:2},
  cardMeta:{flexDirection:'row',alignItems:'center',gap:8,marginTop:6},
  cardItems:{fontSize:12,fontWeight:'600',color:C.text,backgroundColor:C.secondary,paddingHorizontal:8,paddingVertical:3,borderRadius:4},
  statusBadge:{paddingHorizontal:8,paddingVertical:3,borderRadius:4},
  statusText:{fontSize:11,fontWeight:'700',textTransform:'uppercase',letterSpacing:0.5},
  cardSummary:{fontSize:12,color:C.textMuted,marginTop:4},
  cardBalance:{fontSize:13,fontWeight:'700',color:C.red,marginTop:4},
  cardDate:{fontSize:11,color:C.textMuted,marginTop:2},
  // Expanded
  cardExpanded:{borderTopWidth:1,borderTopColor:C.border,padding:14},
  itemRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.border},
  itemTitle:{fontSize:14,fontWeight:'700',color:C.text},
  itemSub:{fontSize:12,color:C.textMuted},
  itemDesc:{fontSize:12,color:C.textMuted,marginTop:2},
  itemEst:{fontSize:12,fontWeight:'600',color:C.green800},
  statusBtn:{padding:8,backgroundColor:C.secondary,borderRadius:8},
  jobActions:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:12},
  actionBtn:{flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:10,paddingVertical:8,borderRadius:6,backgroundColor:C.secondary},
  actionText:{fontSize:12,fontWeight:'700',color:C.text},
  // Empty
  empty:{alignItems:'center',justifyContent:'center',paddingTop:80},
  emptyText:{fontSize:16,color:C.textMuted,marginTop:12},
  // Modals
  modalOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'flex-end'},
  modalBox:{backgroundColor:C.surface,borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'70%',paddingBottom:20},
  modalHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:20,borderBottomWidth:1,borderBottomColor:C.border},
  modalTitle:{fontSize:18,fontWeight:'700',color:C.primary},
  statusItem:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:20,paddingVertical:14,borderBottomWidth:1,borderBottomColor:C.border},
  statusDot:{width:8,height:8,borderRadius:4},
  statusItemText:{fontSize:15,color:C.text},
  // Delivery
  deliveryItem:{flexDirection:'row',alignItems:'center',padding:14,borderWidth:1,borderColor:C.border,borderRadius:10,marginBottom:10},
  deliveryItemSelected:{borderColor:C.green800,backgroundColor:C.green100},
  deliveryItemTitle:{fontSize:14,fontWeight:'700',color:C.text},
  deliveryItemDesc:{fontSize:12,color:C.textMuted,marginTop:2},
  deliveryItemAmt:{fontSize:13,fontWeight:'700',color:C.green800,marginTop:2},
  reviewRow:{flexDirection:'row',alignItems:'center',paddingVertical:14,borderTopWidth:1,borderTopColor:C.border,marginTop:10,gap:10},
  reviewLabel:{fontSize:14,fontWeight:'600',color:C.text},
  confirmDeliveryBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,backgroundColor:C.primary,borderRadius:12,paddingVertical:16,marginTop:16},
  confirmDeliveryText:{fontSize:16,fontWeight:'700',color:C.primaryFg},
  toast:{position:'absolute',bottom:100,left:20,right:20,backgroundColor:'#166534',borderRadius:10,padding:14,alignItems:'center'},
  toastErr:{backgroundColor:C.red},
  toastText:{color:'#FFF',fontSize:14,fontWeight:'600'},
});
