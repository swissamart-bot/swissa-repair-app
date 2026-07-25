import React, { useState, useCallback, useMemo, memo, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert, Modal,
  ScrollView, Platform, Switch, Image, ActivityIndicator, LayoutAnimation, UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { getAllJobs, getJob, updateItem, deleteJob, markItemDelivered, markItemReturned, getConfig, setConfig, countJobsByCustomer, getJobsByCustomer } from '../src/database';
import { enableCloudSyncForJob } from '../src/sync';
import {
  getIncludeGoogleReviewDefault,
  getGoogleReviewLink,
  formatGoogleReviewWhatsAppSection,
} from '../src/shopSettings';
import { getFirstDisplayUri, getThumbnailUri, itemHasPhotoRecords } from '../src/photos';
import { C, SHOP, ITEM_ICONS, DELIVERY_MSG, getStatusColor, getOverallStatusColor, formatWhatsAppCustomerHeader, formatWhatsAppItemBreakdown, formatWhatsAppRepairReceiptBody, WA_SECTION_DIVIDER, formatWhatsAppPaymentSummary, formatWhatsAppCommunityFooter, formatWhatsAppDeliveryItems, formatWhatsAppReturnedItemList } from '../src/constants';
import { SyncStatusBadge } from '../src/SyncStatus';
import { subscribeSyncStatus, type SyncUiStatus } from '../src/sync';
import {
  RepairJob, RepairItem, getOverallStatus, getJobTotals, getItemAmount, getItemPaid, getItemBalance,
  getItemPaymentStatus, allocatePaymentAcrossItems, getSubsetPaymentSummary,
  calcRefundableAmount, getItemRefund, getItemNonRefundable, getItemSpecificPaid,
  getSelectedDeliveryPaymentSummary, getOverallJobPaymentSummaryAfterDelivery,
  allocateAdvanceAcrossItems, getUnallocatedAdvance,
  RECORDS_QUICK_STATUSES, formatINR, getItemStatusSummary,
  isItemDelivered, isItemReadyUndelivered, isItemUnfinishedNotReady, isStatusCancelled,
  isItemReturnable, isItemReturned, isItemActivePayable,
} from '../src/types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const EXPAND_ANIM = {
  duration: 220,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

/** Left accent colour for item cards — readable, status-based */
function getItemAccentColor(status: string | undefined): string {
  if (!status) return C.border;
  switch (status) {
    case 'Received':
    case 'Pending':
    case 'Checking':
    case 'Under Repair':
    case 'Parts Pending':
    case 'Estimate Pending':
    case 'Customer Approval Pending':
      return '#D97706'; // amber
    case 'Ready':
    case 'Repaired':
    case 'Repaired Reminder':
    case 'Ready for Delivery':
    case 'Approved':
      return '#2563EB'; // blue
    case 'Delivered':
    case 'Completed':
      return '#166534'; // green
    case 'Not Repaired':
    case 'Returned':
    case 'Cancelled':
      return '#DC2626'; // red
    default:
      return '#94A3B8'; // neutral grey
  }
}

type TabKey = 'all' | 'pending' | 'repaired' | 'delivered';

/** List row: photos stripped — only a boolean flag for the icon */
type ListItem = Omit<RepairItem, 'photos'> & { hasPhotos: boolean; thumbUri: string | null };
type ListJob = Omit<RepairJob, 'items'> & {
  items: ListItem[];
  hasPhotos: boolean;
  thumbUri: string | null;
};

const TAB_PREF_KEY = 'recordsActiveTab';

/**
 * Tab membership (one tab per job, besides ALL):
 * DELIVERED — all active items delivered/cancelled-complete
 * REPAIRED — at least one Ready undelivered item (includes Partially Ready)
 * PENDING — at least one unfinished non-Ready item
 */
function getJobTab(job: { items: Array<{ status: string; delivered?: boolean }> }): Exclude<TabKey, 'all'> {
  const active = job.items.filter(i => !isStatusCancelled(i.status));
  if (active.length === 0) return 'pending';
  const stillOpen = active.filter(i => !isItemDelivered(i) && !isItemReturned(i));
  if (stillOpen.length === 0) return 'delivered';
  if (active.some(isItemReadyUndelivered)) return 'repaired';
  if (active.some(isItemUnfinishedNotReady)) return 'pending';
  return 'pending';
}

function stripPhotosFromJobs(jobs: RepairJob[]): ListJob[] {
  return jobs.map(j => {
    const items: ListItem[] = j.items.map(i => {
      const { photos, ...rest } = i;
      // Keep only a tiny display URI — never embed full photo arrays / base64 in the list.
      const hasPhotos = itemHasPhotoRecords(photos);
      const thumbUri = getThumbnailUri(photos);
      return { ...rest, hasPhotos, thumbUri };
    });
    const thumbUri = items.map(i => i.thumbUri).find(Boolean) || null;
    return {
      ...j,
      items,
      hasPhotos: items.some(i => i.hasPhotos),
      thumbUri,
    };
  });
}

function matchesSearch(job: ListJob, search: string, dateSearch: string): boolean {
  const q = search.toLowerCase().trim();
  const matchSearch = !q ||
    job.customerName.toLowerCase().includes(q) ||
    job.mobileNumber.includes(q) ||
    job.jobNumber.includes(q) ||
    job.items.some(i =>
      i.itemType.toLowerCase().includes(q) ||
      (i.brand || '').toLowerCase().includes(q) ||
      (i.model || '').toLowerCase().includes(q) ||
      (i.description || '').toLowerCase().includes(q) ||
      (i.technicianNotes || '').toLowerCase().includes(q) ||
      (i.status || '').toLowerCase().includes(q) ||
      (i.identification || '').toLowerCase().includes(q)
    );
  const matchDate = !dateSearch ||
    job.receivedDate.includes(dateSearch) ||
    job.items.some(i => i.deliveredDate?.includes(dateSearch));
  return matchSearch && matchDate;
}

function parseFlexibleDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getJobDeliveredDate(job: { items: Array<{ delivered?: boolean; deliveredDate?: string; status: string }> }): string | null {
  const dates = job.items
    .filter(i => i.delivered && i.deliveredDate)
    .map(i => i.deliveredDate as string);
  if (dates.length === 0) return null;
  const active = job.items.filter(i => !isStatusCancelled(i.status));
  if (active.length > 0 && active.every(isItemDelivered)) {
    return dates.slice().sort((a, b) => {
      const da = parseFlexibleDate(a)?.getTime() ?? 0;
      const db = parseFlexibleDate(b)?.getTime() ?? 0;
      return db - da;
    })[0];
  }
  return dates[0];
}

function getDaysTaken(receivedDate: string, createdAt: string, deliveredDate: string | null): string {
  if (!deliveredDate) return '—';
  const start = parseFlexibleDate(createdAt) || parseFlexibleDate(receivedDate);
  const end = parseFlexibleDate(deliveredDate);
  if (!start || !end) return '—';
  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  return `${days} Day${days === 1 ? '' : 's'}`;
}

function formatPrevJobItems(job: { items: Array<{ brand?: string; itemType: string; description?: string }> }): string {
  return job.items.map(i => {
    const title = `${i.brand ? i.brand + ' ' : ''}${i.itemType}`.trim();
    return i.description ? `${title}\n${i.description}` : title;
  }).join('\n');
}

type JobCardProps = {
  job: ListJob;
  expanded: boolean;
  dimmed: boolean;
  previousCount: number;
  onToggleExpand: (id: string) => void;
  onDelete: (job: ListJob) => void;
  onStatusEdit: (item: ListItem) => void;
  onReceipt: (job: ListJob) => void;
  onReadyWA: (job: ListJob) => void;
  onDeliver: (job: ListJob) => void;
  onReturn: (job: ListJob) => void;
  onOpenPhoto: (jobId: string) => void;
  onPreviousJobs: (job: ListJob) => void;
  onEditJob: (job: ListJob) => void;
  onEnableCloudSync: (job: ListJob) => void;
};

const JobCard = memo(function JobCard({
  job, expanded, dimmed, previousCount, onToggleExpand, onDelete, onStatusEdit,
  onReceipt, onReadyWA, onDeliver, onReturn, onOpenPhoto, onPreviousJobs, onEditJob,
  onEnableCloudSync,
}: JobCardProps) {
  const status = getOverallStatus(job.items);
  const statusColor = getOverallStatusColor(status);
  const totals = getJobTotals(job.items, job.advanceAmount);
  const readyCount = job.items.filter(isItemReadyUndelivered).length;
  const canDeliver = readyCount > 0;
  const canReturn = job.items.some(isItemReturnable);
  const statusSummary = getItemStatusSummary(job.items);

  return (
    <View
      style={[
        st.card,
        expanded && st.cardExpandedOuter,
        dimmed && st.cardDimmed,
      ]}
    >
      <View style={[st.cardTop, expanded && st.cardTopExpanded]}>
        <TouchableOpacity
          testID={`photo-btn-${job.id}`}
          style={st.photoIconBtn}
          onPress={() => onOpenPhoto(job.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={job.hasPhotos ? 'View photo' : 'No photo'}
        >
          {job.thumbUri ? (
            <Image
              source={{ uri: job.thumbUri }}
              style={st.photoThumb}
              resizeMode="cover"
            />
          ) : (
            <Ionicons
              name={job.hasPhotos ? 'cloud-offline-outline' : 'image-outline'}
              size={28}
              color={job.hasPhotos ? C.blue : C.textMuted}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          testID={`job-${job.id}`}
          style={{ flex: 1 }}
          onPress={() => onToggleExpand(job.id)}
          activeOpacity={0.7}
        >
          <View style={st.cardNameRow}>
            <Text style={st.cardName} numberOfLines={1}>{job.customerName}</Text>
            <TouchableOpacity testID={`delete-job-${job.id}`} onPress={() => onDelete(job)}>
              <Ionicons name="trash-outline" size={16} color={C.red} />
            </TouchableOpacity>
          </View>
          <Text style={st.cardPhone}>{job.countryCode} {job.mobileNumber} • Job #{job.jobNumber}</Text>
          <View style={st.cardMeta}>
            <Text style={st.cardItems}>{job.items.length} item{job.items.length > 1 ? 's' : ''}</Text>
            <View style={[st.statusBadge, { backgroundColor: statusColor.bg }]}>
              <Text style={[st.statusText, { color: statusColor.text }]}>{status}</Text>
            </View>
          </View>
          <Text style={st.cardSummary} numberOfLines={2}>{statusSummary}</Text>
          {totals.displayTotal > 0 || job.advanceAmount > 0 ? (
            <Text style={st.cardBalance}>
              Balance: {formatINR(totals.balance)}
            </Text>
          ) : null}
          <Text style={st.cardDate}>{job.receivedDate}</Text>
        </TouchableOpacity>
      </View>

      {expanded && (
        <View style={st.cardExpanded}>
          <View style={st.jobBanner} accessibilityRole="header">
            <Text style={st.jobBannerRule}>━━━━━━━━━━━━━━━━━━━━━━</Text>
            <Text style={st.jobBannerTitle}>JOB #{job.jobNumber}</Text>
            <Text style={st.jobBannerRule}>━━━━━━━━━━━━━━━━━━━━━━</Text>
          </View>

          <View style={st.jobMetaBlock}>
            <Text style={st.jobMetaLine}><Text style={st.jobMetaLabel}>Customer: </Text>{job.customerName}</Text>
            <Text style={st.jobMetaLine}><Text style={st.jobMetaLabel}>Mobile: </Text>{job.countryCode} {job.mobileNumber}</Text>
          </View>

          <TouchableOpacity
            testID={`previous-jobs-${job.id}`}
            style={st.prevJobsBtn}
            onPress={() => onPreviousJobs(job)}
          >
            <Text style={st.prevJobsBtnText}>📋 Previous Jobs ({previousCount})</Text>
            <Ionicons name="chevron-forward" size={18} color={C.blue} />
          </TouchableOpacity>

          {job.items.map((item, idx) => {
            const sc = getStatusColor(item.status);
            const accent = getItemAccentColor(item.status);
            const diagnosis = (item.technicianNotes || '').trim();
            const service = (item.description || '').trim();
            return (
              <View
                key={item.id}
                style={[st.itemCard, { borderLeftColor: accent }]}
              >
                <View style={st.itemCardHeaderRow}>
                  <Text style={st.itemCardHeader}>
                    ITEM {idx + 1} — {(item.itemType || 'ITEM').toUpperCase()}
                  </Text>
                  <TouchableOpacity
                    testID={`status-${item.id}`}
                    style={st.statusBtn}
                    onPress={() => onStatusEdit(item)}
                  >
                    <Ionicons name="swap-horizontal" size={16} color={C.blue} />
                  </TouchableOpacity>
                </View>
                {item.brand || item.identification ? (
                  <Text style={st.itemSub}>
                    {[item.brand, item.identification].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                <Text style={st.itemReadOnly}>
                  <Text style={st.itemReadOnlyLabel}>Technician Diagnosis: </Text>
                  {diagnosis || 'Not entered'}
                </Text>
                <Text style={st.itemReadOnly}>
                  <Text style={st.itemReadOnlyLabel}>Service Performed: </Text>
                  {service || 'Not entered'}
                </Text>
                <Text style={st.itemReadOnly}>
                  <Text style={st.itemReadOnlyLabel}>Amount: </Text>
                  {formatINR(getItemAmount(item))}
                </Text>
                <Text style={st.itemReadOnly}>
                  <Text style={st.itemReadOnlyLabel}>Paid specifically for this item: </Text>
                  {formatINR(getItemSpecificPaid(item))}
                  {' · '}
                  <Text style={st.itemReadOnlyLabel}>Item balance: </Text>
                  {formatINR(getItemBalance(item))}
                </Text>
                {isItemReturned(item) ? (
                  <Text style={st.itemReadOnly}>
                    <Text style={st.itemReadOnlyLabel}>Refunded: </Text>
                    {formatINR(getItemRefund(item))}
                    {' · '}
                    <Text style={st.itemReadOnlyLabel}>Non-refundable: </Text>
                    {formatINR(getItemNonRefundable(item))}
                    {item.returnedDate ? ` · ${item.returnedDate}` : ''}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <View style={[st.statusBadge, { backgroundColor: sc.bg }]}>
                    <Text style={[st.statusText, { color: sc.text }]}>{item.status || 'Unknown'}</Text>
                  </View>
                  {ITEM_ICONS[item.itemType] ? (
                    <Text style={st.itemEst}>{ITEM_ICONS[item.itemType]} {item.itemType}</Text>
                  ) : null}
                </View>
                {idx < job.items.length - 1 ? (
                  <View style={[st.itemDivider, { backgroundColor: accent }]} />
                ) : null}
              </View>
            );
          })}

          {(totals.displayTotal > 0 || totals.totalPaid > 0 || totals.totalRefunded > 0 || job.advanceAmount > 0) && (
            <View style={st.paymentSummary}>
              <View style={st.paymentRow}>
                <Text style={st.paymentLabel}>Job Total</Text>
                <Text style={st.paymentValue}>{formatINR(totals.displayTotal)}</Text>
              </View>
              <View style={st.paymentRow}>
                <Text style={st.paymentLabel}>Job Advance Paid</Text>
                <Text style={st.paymentValue}>{formatINR(totals.jobAdvancePaid ?? totals.advance)}</Text>
              </View>
              <View style={st.paymentRow}>
                <Text style={st.paymentLabel}>Delivery Payments</Text>
                <Text style={st.paymentValue}>{formatINR(totals.deliveryPayments ?? 0)}</Text>
              </View>
              {totals.totalRefunded > 0 ? (
                <View style={st.paymentRow}>
                  <Text style={st.paymentLabel}>Total Refunded</Text>
                  <Text style={st.paymentValue}>{formatINR(totals.totalRefunded)}</Text>
                </View>
              ) : null}
              <View style={st.paymentRow}>
                <Text style={st.paymentLabel}>Total Paid</Text>
                <Text style={st.paymentValue}>{formatINR(totals.totalPaid)}</Text>
              </View>
              <View style={st.paymentRow}>
                <Text style={[st.paymentLabel, { fontWeight: '800' }]}>Balance Payable</Text>
                <Text style={[st.paymentValue, { fontWeight: '800', color: totals.balance > 0 ? C.red : C.green800 }]}>
                  {formatINR(totals.balance)}
                </Text>
              </View>
            </View>
          )}

          <TouchableOpacity
            testID={`edit-job-${job.id}`}
            style={st.editJobBtn}
            onPress={() => onEditJob(job)}
          >
            <Ionicons name="create-outline" size={18} color={C.primaryFg} />
            <Text style={st.editJobBtnText}>EDIT JOB</Text>
          </TouchableOpacity>

          {job.cloudSyncEnabled ? (
            <View style={[st.prevJobsBtn, { marginTop: 8, backgroundColor: C.green100 }]}>
              <Text style={[st.prevJobsBtnText, { color: C.green800 }]}>☁ Cloud sync enabled</Text>
            </View>
          ) : (
            <TouchableOpacity
              testID={`enable-cloud-sync-${job.id}`}
              style={[st.prevJobsBtn, { marginTop: 8 }]}
              onPress={() => onEnableCloudSync(job)}
            >
              <Text style={st.prevJobsBtnText}>☁ Enable cloud sync for this job</Text>
              <Ionicons name="cloud-upload-outline" size={18} color={C.blue} />
            </TouchableOpacity>
          )}

          <View style={st.jobActions}>
            <TouchableOpacity testID={`receipt-${job.id}`} style={st.actionBtn} onPress={() => onReceipt(job)}>
              <Ionicons name="receipt-outline" size={16} color={C.primary} />
              <Text style={st.actionText}>Receipt</Text>
            </TouchableOpacity>

            {readyCount > 0 && (
              <TouchableOpacity
                testID={`ready-wa-${job.id}`}
                style={[st.actionBtn, { backgroundColor: '#E8FAF0' }]}
                onPress={() => onReadyWA(job)}
              >
                <Ionicons name="logo-whatsapp" size={16} color={C.whatsapp} />
                <Text style={[st.actionText, { color: C.whatsapp }]}>Ready ({readyCount})</Text>
              </TouchableOpacity>
            )}

            {canDeliver && (
              <TouchableOpacity
                testID={`deliver-${job.id}`}
                style={[st.actionBtn, { backgroundColor: C.slate100 }]}
                onPress={() => onDeliver(job)}
              >
                <Ionicons name="cube-outline" size={16} color={C.slate800} />
                <Text style={[st.actionText, { color: C.slate800 }]}>Delivered Successfully</Text>
              </TouchableOpacity>
            )}

            {canReturn && (
              <TouchableOpacity
                testID={`returned-wa-${job.id}`}
                style={[st.actionBtn, { backgroundColor: C.orange100 }]}
                onPress={() => onReturn(job)}
              >
                <Ionicons name="return-down-back-outline" size={16} color={C.orange800} />
                <Text style={[st.actionText, { color: C.orange800 }]}>Returned (Not Repaired)</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={st.expandedBottomDivider} />
        </View>
      )}
    </View>
  );
});

export default function Records() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ListJob[]>([]);
  const [search, setSearch] = useState('');
  const [dateSearch, setDateSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [tabReady, setTabReady] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveryJob, setDeliveryJob] = useState<ListJob | null>(null);
  const [deliveryItems, setDeliveryItems] = useState<Set<string>>(new Set());
  const [deliveryPayment, setDeliveryPayment] = useState('');
  const [includeReview, setIncludeReview] = useState(false);
  const [reviewLink, setReviewLink] = useState('');
  const [returnJob, setReturnJob] = useState<ListJob | null>(null);
  const [returnStep, setReturnStep] = useState<'select' | 'confirm'>('select');
  const [returnItems, setReturnItems] = useState<Set<string>>(new Set());
  /** Non-refundable charges text per item id */
  const [returnCharges, setReturnCharges] = useState<Record<string, string>>({});
  /** Editable refund amount text per item id */
  const [returnRefunds, setReturnRefunds] = useState<Record<string, string>>({});
  const [statusEditItem, setStatusEditItem] = useState<ListItem | null>(null);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerUnavailable, setViewerUnavailable] = useState(false);

  const [prevCountByJobId, setPrevCountByJobId] = useState<Record<string, number>>({});
  const [prevModalVisible, setPrevModalVisible] = useState(false);
  const [prevModalLoading, setPrevModalLoading] = useState(false);
  const [prevJobs, setPrevJobs] = useState<RepairJob[]>([]);
  const [prevCurrentId, setPrevCurrentId] = useState<string | null>(null);
  const [prevSearch, setPrevSearch] = useState('');
  const listRef = useRef<FlatList<ListJob>>(null);

  const showToastMsg = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadJobs = useCallback(async () => {
    const raw = await getAllJobs();
    setJobs(stripPhotosFromJobs(raw));
  }, []);

  const loadReviewLink = useCallback(async () => {
    const link = await getGoogleReviewLink();
    setReviewLink(link || '');
  }, []);

  const loadTabPref = useCallback(async () => {
    if (tabReady) return;
    const saved = await getConfig(TAB_PREF_KEY);
    if (saved === 'all' || saved === 'pending' || saved === 'repaired' || saved === 'delivered') {
      setActiveTab(saved);
    } else {
      setActiveTab('all');
    }
    setTabReady(true);
  }, [tabReady]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await loadJobs();
        await loadReviewLink();
        await loadTabPref();
        try {
          const focusId = await getConfig('recordsFocusExpandId');
          const focusTab = await getConfig('recordsFocusTab');
          if (cancelled) return;
          if (focusTab === 'all' || focusTab === 'pending' || focusTab === 'repaired' || focusTab === 'delivered') {
            setActiveTab(focusTab);
            setTabReady(true);
            await setConfig('recordsFocusTab', '');
          }
          if (focusId) {
            setExpandedId(focusId);
            await setConfig('recordsFocusExpandId', '');
          }
        } catch { /* ignore */ }
      })();
      return () => { cancelled = true; };
    }, [loadJobs, loadReviewLink, loadTabPref])
  );

  // Refresh list when a cloud sync cycle finishes (pull may have applied remote jobs)
  useEffect(() => {
    let prev: SyncUiStatus = 'synced';
    return subscribeSyncStatus(status => {
      if (prev === 'syncing' && status === 'synced') {
        loadJobs().catch(() => {});
      }
      prev = status;
    });
  }, [loadJobs]);

  const selectTab = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    setConfig(TAB_PREF_KEY, tab).catch(() => {});
  }, []);

  const tabCounts = useMemo(() => {
    let pending = 0;
    let repaired = 0;
    let delivered = 0;
    for (const j of jobs) {
      const t = getJobTab(j);
      if (t === 'pending') pending++;
      else if (t === 'repaired') repaired++;
      else delivered++;
    }
    return { all: jobs.length, pending, repaired, delivered };
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter(j => {
      if (activeTab !== 'all' && getJobTab(j) !== activeTab) return false;
      return matchesSearch(j, search, dateSearch);
    });
  }, [jobs, activeTab, search, dateSearch]);

  const sendReadyWA = useCallback((job: ListJob) => {
    const readyItems = job.items.filter(isItemReadyUndelivered);
    if (readyItems.length === 0) {
      showToastMsg('No repair items are ready for delivery.', true);
      return;
    }
    const pay = getJobTotals(job.items, job.advanceAmount);
    const cleanPhone = (job.countryCode + job.mobileNumber).replace(/\D/g, '');
    const itemsBlock = readyItems.map((i, idx) => formatWhatsAppItemBreakdown(idx + 1, i)).join('\n\n');

    const msg =
`${formatWhatsAppCustomerHeader(job.customerName, job.jobNumber)}

Your following item(s) are *READY* for collection. ✅
આપની નીચે દર્શાવેલ વસ્તુ(ઓ) લેવા માટે *તૈયાર* છે. ✅
आपकी निम्नलिखित वस्तु(एँ) लेने के लिए *तैयार* हैं। ✅
${itemsBlock}

${WA_SECTION_DIVIDER}

${formatWhatsAppPaymentSummary(pay.displayTotal, pay.totalPaid, pay.balance)}

${WA_SECTION_DIVIDER}

📍 ${SHOP.address}

${DELIVERY_MSG}

⚠️ SHOW THIS MESSAGE WHILE TAKING DELIVERY
⚠️ SHARE THIS MESSAGE ONLY TO TRUSTED PEOPLE FOR TAKING DELIVERY

Thank you for visiting Swissa Watch & Opticals.`;

    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }, [showToastMsg]);

  const openDeliveryModal = useCallback(async (job: ListJob) => {
    const ready = job.items.filter(isItemReadyUndelivered);
    if (ready.length === 0) {
      showToastMsg('No repair items are ready for delivery.', true);
      return;
    }
    const [link, includeDefault] = await Promise.all([
      getGoogleReviewLink(),
      getIncludeGoogleReviewDefault(),
    ]);
    setReviewLink(link || '');
    setDeliveryJob(job);
    setDeliveryItems(new Set());
    setDeliveryPayment('');
    // Per-delivery toggle starts from global default; changing it does not alter Settings
    setIncludeReview(includeDefault);
  }, [showToastMsg]);

  const toggleDeliveryItem = useCallback((id: string) => {
    setDeliveryItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const deliverySelection = useMemo(() => {
    if (!deliveryJob) return [];
    return deliveryJob.items.filter(i => deliveryItems.has(i.id) && isItemReadyUndelivered(i));
  }, [deliveryJob, deliveryItems]);

  const deliveryPaySummary = useMemo(() => {
    if (!deliveryJob) return null;
    return getSubsetPaymentSummary(deliveryJob.items, deliverySelection, deliveryJob.advanceAmount);
  }, [deliveryJob, deliverySelection]);

  /** Live payment validation — job advance as unallocated credit, not item "Paid". */
  const deliveryPaymentLive = useMemo(() => {
    if (!deliveryJob) {
      return {
        selectedItemsTotal: 0,
        itemSpecificPaid: 0,
        selectedDueBeforeCredit: 0,
        unallocatedAdvance: 0,
        advanceAppliedThisDelivery: 0,
        dueAfterAdvance: 0,
        paymentReceivedNow: 0,
        balanceAfterPayment: 0,
        paymentExceeds: false,
        canConfirm: false,
      };
    }
    const rawPay = parseFloat(String(deliveryPayment || '').replace(/,/g, '').trim());
    const paymentNow = Number.isFinite(rawPay) ? Math.max(0, rawPay) : 0;
    return getSelectedDeliveryPaymentSummary(
      deliverySelection,
      deliveryJob.items,
      deliveryJob.advanceAmount,
      paymentNow,
    );
  }, [deliveryJob, deliverySelection, deliveryPayment]);

  const confirmDelivery = useCallback(async () => {
    if (!deliveryJob || deliveryItems.size === 0) { showToastMsg('Select items to deliver', true); return; }
    const selected = deliveryJob.items.filter(i => deliveryItems.has(i.id) && isItemReadyUndelivered(i));
    if (selected.length === 0) {
      showToastMsg('Select Ready items only', true);
      return;
    }

    const rawPay = parseFloat(String(deliveryPayment || '').replace(/,/g, '').trim());
    const paymentNow = Number.isFinite(rawPay) ? Math.max(0, rawPay) : 0;
    const partialPay = getSelectedDeliveryPaymentSummary(
      selected,
      deliveryJob.items,
      deliveryJob.advanceAmount,
      paymentNow,
    );

    if (partialPay.paymentExceeds) {
      showToastMsg(
        `Payment cannot exceed balance due (${formatINR(partialPay.dueAfterAdvance)})`,
        true,
      );
      return;
    }
    if (partialPay.balanceAfterPayment > 0.0001) {
      showToastMsg(
        `${formatINR(partialPay.balanceAfterPayment)} is still pending for the selected item(s). Full payment is required before delivery.`,
        true,
      );
      return;
    }

    const advanceMap = allocateAdvanceAcrossItems(selected, partialPay.advanceAppliedThisDelivery);

    // Allocate cash payment against remaining due after advance credit
    const dueAfterAdvItems = selected.map(item => {
      const adv = advanceMap.get(item.id) || 0;
      const due = Math.max(0, getItemAmount(item) - getItemSpecificPaid(item) - adv);
      return { ...item, amountPaid: getItemAmount(item) - due };
    });
    const paymentMap = allocatePaymentAcrossItems(dueAfterAdvItems, paymentNow);

    // Validate Google Review option before marking delivered / sending WhatsApp
    if (includeReview) {
      const link = (reviewLink || '').trim();
      if (!link) {
        showToastMsg(
          'Google Review Link is not configured. Add it in Settings or turn this option off.',
          true,
        );
        return;
      }
    }

    const now = new Date().toLocaleString();
    const deliveredSnap: Array<{
      itemType: string;
      amount: number;
      paymentReceived: number;
      outstanding: number;
      alreadyPaid: number;
    }> = [];

    for (const item of selected) {
      const advAdd = advanceMap.get(item.id) || 0;
      const payAdd = paymentMap.get(item.id) || 0;
      const itemSpecific = getItemSpecificPaid(item);
      const amount = getItemAmount(item);
      const newItemPaid = itemSpecific + payAdd;
      const prevAdv = Math.max(0, Number((item as any).advanceApplied) || 0);
      const newAdvanceApplied = prevAdv + advAdd;
      const covered = newItemPaid + newAdvanceApplied;
      if (amount - covered > 0.0001) {
        showToastMsg(
          `${formatINR(amount - covered)} is still pending for the selected item(s). Full payment is required before delivery.`,
          true,
        );
        return;
      }
      await markItemDelivered(item.id, now, newItemPaid, newAdvanceApplied);
      deliveredSnap.push({
        itemType: item.itemType,
        amount,
        paymentReceived: payAdd,
        outstanding: 0,
        alreadyPaid: itemSpecific,
      });
    }

    const overallPay = getOverallJobPaymentSummaryAfterDelivery(
      deliveryJob.items,
      deliveryJob.advanceAmount,
      new Set(selected.map(i => i.id)),
      paymentMap,
      advanceMap,
    );

    await loadJobs();

    const cleanPhone = (deliveryJob.countryCode + deliveryJob.mobileNumber).replace(/\D/g, '');
    const name = String(deliveryJob.customerName || '').trim() || 'Customer';
    const jobNo = String(deliveryJob.jobNumber ?? '').trim();

    const reviewText =
      includeReview && (reviewLink || '').trim()
        ? formatGoogleReviewWhatsAppSection(reviewLink.trim())
        : '';

    const msg =
`Hi ${name}! 👋

Your item(s) have been successfully *DELIVERED*. ✅

🏷️ Job ID: #${jobNo}

${formatWhatsAppDeliveryItems(
  deliveredSnap,
  {
    selectedItemsTotal: partialPay.selectedItemsTotal,
    paymentReceivedNow: paymentNow,
    advanceAppliedThisDelivery: partialPay.advanceAppliedThisDelivery,
    balanceForDeliveredItems: 0,
  },
  {
    jobTotal: overallPay.jobTotal,
    jobAdvancePaid: overallPay.jobAdvancePaid,
    deliveryPayments: overallPay.deliveryPayments,
    totalPaid: overallPay.totalPaid,
    balancePayable: overallPay.balancePayable,
  },
)}

Thank you for choosing SWISSA Watch & Opticals. 🙏
We hope to serve you again!${reviewText}

${formatWhatsAppCommunityFooter({ largePreview: true })}`;

    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
    setDeliveryJob(null);
    setDeliveryPayment('');
    showToastMsg('Items marked as delivered!');
  }, [deliveryJob, deliveryItems, deliveryPayment, includeReview, reviewLink, loadJobs, showToastMsg]);

  /** Open Returned / Not Repaired selection (job advance stays at job level). */
  const openReturnModal = useCallback(async (job: ListJob) => {
    const returnable = job.items.filter(isItemReturnable);
    if (returnable.length === 0) {
      showToastMsg('No items available to return.', true);
      return;
    }

    const charges: Record<string, string> = {};
    const refunds: Record<string, string> = {};
    for (const item of returnable) {
      charges[item.id] = '0';
      // Refund only item-specific payments (not job-level advance)
      refunds[item.id] = String(calcRefundableAmount(getItemSpecificPaid(item), 0));
    }
    setReturnJob(job);
    setReturnStep('select');
    setReturnItems(new Set());
    setReturnCharges(charges);
    setReturnRefunds(refunds);
  }, [showToastMsg]);

  const closeReturnModal = useCallback(() => {
    setReturnJob(null);
    setReturnStep('select');
    setReturnItems(new Set());
    setReturnCharges({});
    setReturnRefunds({});
  }, []);

  const toggleReturnItem = useCallback((id: string) => {
    setReturnItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setReturnChargeForItem = useCallback((id: string, paid: number, text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    const charges = Math.min(paid, parseFloat(cleaned) || 0);
    setReturnCharges(prev => ({ ...prev, [id]: cleaned }));
    setReturnRefunds(prev => ({
      ...prev,
      [id]: String(calcRefundableAmount(paid, Number.isFinite(charges) ? charges : 0)),
    }));
  }, []);

  const setReturnRefundForItem = useCallback((id: string, text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    setReturnRefunds(prev => ({ ...prev, [id]: cleaned }));
  }, []);

  const returnSelection = useMemo(() => {
    if (!returnJob) return [];
    return returnJob.items.filter(i => returnItems.has(i.id) && isItemReturnable(i));
  }, [returnJob, returnItems]);

  const returnSummary = useMemo(() => {
    let totalPaid = 0;
    let totalCharges = 0;
    let totalRefund = 0;
    const rows = returnSelection.map(item => {
      const paid = getItemSpecificPaid(item);
      const rawCharges = parseFloat(String(returnCharges[item.id] || '0').replace(/,/g, ''));
      const charges = Math.max(0, Math.min(paid, Number.isFinite(rawCharges) ? rawCharges : 0));
      const rawRefund = parseFloat(String(returnRefunds[item.id] ?? '').replace(/,/g, ''));
      const suggested = calcRefundableAmount(paid, charges);
      let refund = Number.isFinite(rawRefund) ? rawRefund : suggested;
      refund = Math.max(0, Math.min(paid, refund));
      totalPaid += paid;
      totalCharges += charges;
      totalRefund += refund;
      return { item, paid, charges, refund };
    });
    return { rows, totalPaid, totalCharges, totalRefund };
  }, [returnSelection, returnCharges, returnRefunds]);

  const goReturnConfirm = useCallback(() => {
    if (returnSelection.length === 0) {
      showToastMsg('Select at least one item to return', true);
      return;
    }
    setReturnStep('confirm');
  }, [returnSelection, showToastMsg]);

  const confirmReturn = useCallback(async (withRefund: boolean) => {
    if (!returnJob || returnSummary.rows.length === 0) {
      showToastMsg('Select items to return', true);
      return;
    }

    const now = new Date().toLocaleString();
    const snap: Array<{ itemNumber: number; itemType: string; refund: number }> = [];

    for (const row of returnSummary.rows) {
      const paid = row.paid;
      let refund = withRefund ? row.refund : 0;
      let charges = withRefund ? row.charges : paid;
      refund = Math.max(0, Math.min(paid, refund));
      charges = Math.max(0, Math.min(paid, charges));
      if (withRefund && charges + refund > paid) {
        charges = Math.max(0, paid - refund);
      }
      if (!withRefund) {
        refund = 0;
        charges = paid;
      }

      await markItemReturned(row.item.id, now, refund, charges);
      snap.push({
        itemNumber: row.item.itemNumber,
        itemType: row.item.itemType,
        refund,
      });
    }

    await loadJobs();

    const cleanPhone = (returnJob.countryCode + returnJob.mobileNumber).replace(/\D/g, '');
    const name = String(returnJob.customerName || '').trim() || 'Customer';
    const jobNo = String(returnJob.jobNumber ?? '').trim();
    const totalRefund = snap.reduce((s, r) => s + r.refund, 0);

    if (cleanPhone) {
      const refundLine = totalRefund > 0
        ? `Refundable Amount: ${formatINR(totalRefund)}`
        : `Refundable Amount: ₹0\nNo refund is due.`;

      const msg =
`Hi ${name}! 👋

The following item(s) have been returned:
${formatWhatsAppReturnedItemList(snap)}

🏷️ Job ID: #${jobNo}

${refundLine}

Thank you for choosing SWISSA Watch & Opticals. 🙏
We hope to serve you again!

${formatWhatsAppCommunityFooter({ largePreview: true })}`;

      Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
    } else {
      showToastMsg('Customer mobile number missing — return saved without WhatsApp', true);
    }

    closeReturnModal();
    showToastMsg(withRefund ? 'Items returned with refund' : 'Items returned without refund');
  }, [returnJob, returnSummary, loadJobs, showToastMsg, closeReturnModal]);

  const changeItemStatus = useCallback(async (item: ListItem, newStatus: string) => {
    try {
      const fullJob = await getJob(item.jobId);
      const fullItem = fullJob?.items.find(i => i.id === item.id);
      if (!fullItem) {
        showToastMsg('Item not found', true);
        return;
      }
      const becomingDelivered = newStatus === 'Delivered';
      const becomingReturned = newStatus === 'Not Repaired' || newStatus === 'Returned';
      await updateItem({
        ...fullItem,
        refundAmount: fullItem.refundAmount || 0,
        nonRefundableCharges: fullItem.nonRefundableCharges || 0,
        returnedDate: becomingReturned
          ? (fullItem.returnedDate || new Date().toLocaleString())
          : (becomingDelivered ? '' : (fullItem.returnedDate || '')),
        status: newStatus,
        delivered: becomingDelivered,
        deliveredDate: becomingDelivered
          ? (fullItem.deliveredDate || new Date().toLocaleString())
          : '',
        updatedAt: new Date().toISOString(),
      });
      await loadJobs();
      setStatusEditItem(null);
      showToastMsg(`Item ${item.itemNumber} → ${newStatus}`);
    } catch (e: any) {
      showToastMsg('Status update failed: ' + (e?.message || ''), true);
    }
  }, [loadJobs, showToastMsg]);

  const handleDeleteJob = useCallback((job: ListJob) => {
    Alert.alert('Delete Job', `Delete ${job.customerName}'s job #${job.jobNumber} and all items?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteJob(job.id);
          await loadJobs();
          if (expandedId === job.id) setExpandedId(null);
          showToastMsg('Job deleted');
        },
      },
    ]);
  }, [loadJobs, expandedId, showToastMsg]);

  const handleEnableCloudSync = useCallback((job: ListJob) => {
    Alert.alert(
      'Enable cloud sync?',
      `Upload job #${job.jobNumber} (${job.customerName}) to Firestore and keep future edits synced.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enable & Upload',
          onPress: async () => {
            try {
              await enableCloudSyncForJob(job.id);
              await loadJobs();
              showToastMsg('Cloud sync enabled — uploading…');
            } catch (e: any) {
              showToastMsg(e?.message || 'Failed to enable cloud sync', true);
            }
          },
        },
      ],
    );
  }, [loadJobs, showToastMsg]);

  const handleReceipt = useCallback((job: ListJob) => {
    const cleanPhone = (job.countryCode + job.mobileNumber).replace(/\D/g, '');
    const pay = getJobTotals(job.items, job.advanceAmount);
    const msg =
`${formatWhatsAppCustomerHeader(job.customerName, job.jobNumber)}

${formatWhatsAppRepairReceiptBody({
  receivedDate: job.receivedDate,
  items: job.items,
  total: pay.displayTotal,
  paid: pay.totalPaid,
  balance: pay.balance,
})}`;

    Linking.openURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`);
  }, []);

  useEffect(() => {
    if (!expandedId) return;
    const job = jobs.find(j => j.id === expandedId);
    if (!job) return;
    let cancelled = false;
    (async () => {
      try {
        const total = await countJobsByCustomer(job.mobileNumber, job.customerName);
        const previous = Math.max(0, total - 1);
        if (!cancelled) {
          setPrevCountByJobId(prev => ({ ...prev, [job.id]: previous }));
        }
      } catch {
        if (!cancelled) setPrevCountByJobId(prev => ({ ...prev, [job.id]: 0 }));
      }
    })();
    return () => { cancelled = true; };
  }, [expandedId, jobs]);

  const openPreviousJobs = useCallback(async (job: ListJob) => {
    setPrevCurrentId(job.id);
    setPrevSearch('');
    setPrevModalVisible(true);
    setPrevModalLoading(true);
    setPrevJobs([]);
    try {
      const list = await getJobsByCustomer(job.mobileNumber, job.customerName);
      setPrevJobs(list);
      const previous = Math.max(0, list.length - 1);
      setPrevCountByJobId(prev => ({ ...prev, [job.id]: previous }));
    } catch {
      showToastMsg('Could not load previous jobs', true);
    } finally {
      setPrevModalLoading(false);
    }
  }, [showToastMsg]);

  const closePreviousJobs = useCallback(() => {
    setPrevModalVisible(false);
    setPrevJobs([]);
    setPrevSearch('');
    setPrevCurrentId(null);
  }, []);

  const filteredPrevJobs = useMemo(() => {
    const q = prevSearch.toLowerCase().trim();
    if (!q) return prevJobs;
    return prevJobs.filter(j =>
      j.jobNumber.toLowerCase().includes(q) ||
      j.items.some(i =>
        i.itemType.toLowerCase().includes(q) ||
        (i.brand || '').toLowerCase().includes(q) ||
        (i.model || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      )
    );
  }, [prevJobs, prevSearch]);

  const openPrevJobRecord = useCallback((jobId: string) => {
    if (jobId === prevCurrentId) return;
    closePreviousJobs();
    setSearch('');
    setDateSearch('');
    selectTab('all');
    setExpandedId(jobId);
    requestAnimationFrame(() => {
      const idx = jobs.findIndex(j => j.id === jobId);
      if (idx >= 0 && listRef.current) {
        try {
          listRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.05 });
        } catch {
          /* item may be off-screen until data settles */
        }
      }
    });
  }, [prevCurrentId, closePreviousJobs, selectTab, jobs]);

  const handleToggleExpand = useCallback((id: string) => {
    LayoutAnimation.configureNext(EXPAND_ANIM);
    setExpandedId(prev => (prev === id ? null : id));
  }, []);

  const handleEditJob = useCallback((job: ListJob) => {
    router.push({
      pathname: '/edit-job',
      params: { id: job.id, tab: activeTab },
    });
  }, [router, activeTab]);

  const openPhotoViewer = useCallback(async (jobId: string) => {
    setViewerVisible(true);
    setViewerLoading(true);
    setViewerUri(null);
    setViewerUnavailable(false);
    try {
      const job = await getJob(jobId);
      let uri: string | null = null;
      let hasAny = false;
      for (const item of job?.items || []) {
        if (itemHasPhotoRecords(item.photos)) hasAny = true;
        uri = getFirstDisplayUri(item.photos);
        if (uri) break;
      }
      if (uri) {
        setViewerUri(uri);
      } else {
        // Local-only images on web (or missing cloud upload) → clear placeholder
        setViewerUnavailable(hasAny);
      }
    } catch {
      setViewerUnavailable(true);
    } finally {
      setViewerLoading(false);
    }
  }, []);

  const closePhotoViewer = useCallback(() => {
    setViewerVisible(false);
    setViewerUri(null);
    setViewerUnavailable(false);
    setViewerLoading(false);
  }, []);

  const renderJob = useCallback(({ item: job }: { item: ListJob }) => (
    <JobCard
      job={job}
      expanded={expandedId === job.id}
      dimmed={!!expandedId && expandedId !== job.id}
      previousCount={prevCountByJobId[job.id] ?? 0}
      onToggleExpand={handleToggleExpand}
      onDelete={handleDeleteJob}
      onStatusEdit={setStatusEditItem}
      onReceipt={handleReceipt}
      onReadyWA={sendReadyWA}
      onDeliver={openDeliveryModal}
      onReturn={openReturnModal}
      onOpenPhoto={openPhotoViewer}
      onPreviousJobs={openPreviousJobs}
      onEditJob={handleEditJob}
      onEnableCloudSync={handleEnableCloudSync}
    />
  ), [
    expandedId, prevCountByJobId, handleToggleExpand, handleDeleteJob, handleReceipt,
    sendReadyWA, openDeliveryModal, openReturnModal, openPhotoViewer, openPreviousJobs, handleEditJob,
    handleEnableCloudSync,
  ]);

  const keyExtractor = useCallback((j: ListJob) => j.id, []);

  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    listRef.current?.scrollToOffset({
      offset: Math.max(0, info.index * (info.averageItemLength || 120)),
      animated: true,
    });
  }, []);

  const renderPrevJob = useCallback(({ item: job }: { item: RepairJob }) => {
    const isCurrent = job.id === prevCurrentId;
    const overall = getOverallStatus(job.items);
    const pay = getJobTotals(job.items, job.advanceAmount);
    const deliveredDate = getJobDeliveredDate(job);
    const daysTaken = getDaysTaken(job.receivedDate, job.createdAt, deliveredDate);
    const sc = getOverallStatusColor(overall);

    return (
      <TouchableOpacity
        testID={`prev-job-${job.id}`}
        style={[st.prevCard, isCurrent && st.prevCardCurrent]}
        activeOpacity={isCurrent ? 1 : 0.7}
        disabled={isCurrent}
        onPress={() => openPrevJobRecord(job.id)}
      >
        <View style={st.prevCardHeader}>
          <Text style={st.prevJobNo}>Job #{job.jobNumber}</Text>
          {isCurrent ? (
            <View style={st.currentPill}>
              <Text style={st.currentPillText}>(Current Job)</Text>
            </View>
          ) : (
            <Ionicons name="open-outline" size={16} color={C.blue} />
          )}
        </View>
        <Text style={st.prevMeta}>Received{'\n'}{job.receivedDate || '—'}</Text>
        <Text style={st.prevMeta}>Delivered{'\n'}{deliveredDate || '—'}</Text>
        <Text style={st.prevMeta}>Days Taken{'\n'}{daysTaken}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Text style={st.prevLabel}>Status</Text>
          <View style={[st.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[st.statusText, { color: sc.text }]}>{overall}</Text>
          </View>
        </View>
        <Text style={st.prevMeta}>Total Amount{'\n'}{formatINR(pay.displayTotal)}</Text>
        <Text style={st.prevMeta}>Balance{'\n'}{formatINR(pay.balance)}</Text>
        <Text style={[st.prevLabel, { marginTop: 8 }]}>Items</Text>
        <Text style={st.prevItems}>{formatPrevJobItems(job) || '—'}</Text>
      </TouchableOpacity>
    );
  }, [prevCurrentId, openPrevJobRecord]);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'all', label: 'ALL', count: tabCounts.all },
    { key: 'pending', label: 'PENDING', count: tabCounts.pending },
    { key: 'repaired', label: 'REPAIRED', count: tabCounts.repaired },
    { key: 'delivered', label: 'DELIVERED', count: tabCounts.delivered },
  ];

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <View style={st.headerTop}>
          <Text style={st.headerTitle}>Records</Text>
          <SyncStatusBadge compact />
        </View>
        <TextInput
          testID="search-input"
          style={st.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone, job#, brand, item..."
          placeholderTextColor={C.textMuted}
        />
        <TextInput
          testID="date-search"
          style={[st.searchInput, { marginTop: 8 }]}
          value={dateSearch}
          onChangeText={setDateSearch}
          placeholder="Search by date..."
          placeholderTextColor={C.textMuted}
        />
      </View>

      <View style={st.tabsRow}>
        {tabs.map(t => {
          const active = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              testID={`tab-${t.key}`}
              style={[st.tab, active && st.tabActive]}
              onPress={() => selectTab(t.key)}
              activeOpacity={0.7}
            >
              <Text style={[st.tabLabel, active && st.tabLabelActive]} numberOfLines={1}>
                {t.label}
              </Text>
              <Text style={[st.tabCount, active && st.tabCountActive]}>{t.count}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={st.countRow}>
        <Text testID="records-count" style={st.countText}>{filtered.length} jobs</Text>
      </View>

      <FlatList
        ref={listRef}
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderJob}
        contentContainerStyle={{ padding: 20, paddingTop: 4, flexGrow: 1 }}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        onScrollToIndexFailed={onScrollToIndexFailed}
        ListEmptyComponent={
          <View style={st.empty}>
            <Ionicons name="document-text-outline" size={48} color={C.border} />
            <Text style={st.emptyText}>No records found</Text>
          </View>
        }
      />

      {/* Status Change Modal — simplified quick statuses only (full list remains in Edit Job) */}
      <Modal visible={!!statusEditItem} transparent animationType="slide">
        <View style={st.modalOverlay}>
          <View style={st.modalBox}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>
                {statusEditItem ? `Item ${statusEditItem.itemNumber} Status` : 'Change Status'}
              </Text>
              <TouchableOpacity onPress={() => setStatusEditItem(null)}>
                <Ionicons name="close" size={24} color={C.primary} />
              </TouchableOpacity>
            </View>
            {statusEditItem && !(RECORDS_QUICK_STATUSES as readonly string[]).includes(statusEditItem.status) ? (
              <View style={st.currentStatusBanner}>
                <Text style={st.currentStatusLabel}>Current status</Text>
                <View style={[st.statusBadge, { backgroundColor: getStatusColor(statusEditItem.status).bg, alignSelf: 'flex-start' }]}>
                  <Text style={[st.statusText, { color: getStatusColor(statusEditItem.status).text }]}>
                    {statusEditItem.status}
                  </Text>
                </View>
                <Text style={st.currentStatusHint}>Select one of the options below to update.</Text>
              </View>
            ) : null}
            <FlatList
              data={[...RECORDS_QUICK_STATUSES]}
              keyExtractor={s => s}
              renderItem={({ item: s }) => {
                const sc = getStatusColor(s);
                const active = statusEditItem?.status === s;
                return (
                  <TouchableOpacity
                    testID={`quick-status-${s}`}
                    style={[st.statusItem, active && { backgroundColor: sc.bg }]}
                    onPress={() => statusEditItem && changeItemStatus(statusEditItem, s)}
                  >
                    <View style={[st.statusDot, { backgroundColor: sc.text }]} />
                    <Text style={[st.statusItemText, active && { fontWeight: '800', color: sc.text }]}>{s}</Text>
                    {active && <Ionicons name="checkmark" size={18} color={sc.text} />}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* Delivery Modal */}
      <Modal visible={!!deliveryJob} transparent animationType="slide">
        <View style={st.modalOverlay}>
          <View style={[st.modalBox, { maxHeight: '80%' }]}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>Select Ready Items to Deliver</Text>
              <TouchableOpacity onPress={() => setDeliveryJob(null)}>
                <Ionicons name="close" size={24} color={C.primary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              {deliveryJob?.items.filter(isItemReadyUndelivered).length === 0 ? (
                <Text style={{ color: C.textMuted, textAlign: 'center', marginBottom: 12 }}>
                  No Ready items available for delivery.
                </Text>
              ) : null}
              {deliveryJob?.items.filter(isItemReadyUndelivered).map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[st.deliveryItem, deliveryItems.has(item.id) && st.deliveryItemSelected]}
                  onPress={() => toggleDeliveryItem(item.id)}
                >
                  <Ionicons
                    name={deliveryItems.has(item.id) ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={deliveryItems.has(item.id) ? C.green800 : C.textMuted}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={st.deliveryItemTitle}>
                      Item {item.itemNumber}: {ITEM_ICONS[item.itemType]} {item.brand ? item.brand + ' ' : ''}{item.itemType}
                    </Text>
                    <Text style={st.deliveryItemDesc}>{item.description || 'N/A'} • {item.status}</Text>
                    <Text style={st.deliveryItemAmt}>
                      Item Amount: {formatINR(getItemAmount(item))}
                    </Text>
                    <Text style={st.deliveryItemAmt}>
                      Paid specifically for this item: {formatINR(getItemSpecificPaid(item))}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}

              {deliverySelection.length > 0 ? (
                <View style={st.deliveryPayBox}>
                  <Text style={st.deliveryPayTitle}>Payment for selected item(s)</Text>
                  <View style={st.paymentRow}>
                    <Text style={st.paymentLabel}>Selected items total</Text>
                    <Text style={st.paymentValue}>{formatINR(deliveryPaymentLive.selectedItemsTotal)}</Text>
                  </View>
                  <View style={st.paymentRow}>
                    <Text style={st.paymentLabel}>Paid specifically for selected</Text>
                    <Text style={st.paymentValue}>{formatINR(deliveryPaymentLive.itemSpecificPaid)}</Text>
                  </View>
                  <View style={st.paymentRow}>
                    <Text style={st.paymentLabel}>Unallocated job advance</Text>
                    <Text style={st.paymentValue}>{formatINR(deliveryPaymentLive.unallocatedAdvance)}</Text>
                  </View>
                  <View style={st.paymentRow}>
                    <Text style={st.paymentLabel}>Advance to apply now</Text>
                    <Text style={st.paymentValue}>{formatINR(deliveryPaymentLive.advanceAppliedThisDelivery)}</Text>
                  </View>
                  <View style={st.paymentRow}>
                    <Text style={[st.paymentLabel, { fontWeight: '800' }]}>Still due after advance</Text>
                    <Text style={[st.paymentValue, { fontWeight: '800', color: C.red }]}>
                      {formatINR(deliveryPaymentLive.dueAfterAdvance)}
                    </Text>
                  </View>
                  {deliveryPaySummary ? (
                    <View style={st.paymentRow}>
                      <Text style={st.paymentLabel}>Other pending items (amounts)</Text>
                      <Text style={st.paymentValue}>{formatINR(deliveryPaySummary.otherPendingBalance)}</Text>
                    </View>
                  ) : null}
                  <Text style={[st.reviewLabel, { marginTop: 12 }]}>Payment received now (₹)</Text>
                  <TextInput
                    testID="delivery-payment-input"
                    style={st.deliveryPayInput}
                    value={deliveryPayment}
                    onChangeText={t => setDeliveryPayment(t.replace(/[^0-9.]/g, ''))}
                    placeholder={
                      deliveryPaymentLive.dueAfterAdvance <= 0
                        ? 'Covered by advance — no payment needed'
                        : 'Enter full amount still due'
                    }
                    placeholderTextColor={C.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <Text style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: deliveryPaymentLive.balanceAfterPayment > 0 || deliveryPaymentLive.paymentExceeds
                      ? C.red
                      : C.green800,
                    marginTop: 8,
                  }}>
                    Balance after payment: {formatINR(deliveryPaymentLive.balanceAfterPayment)}
                  </Text>
                  {deliveryPaymentLive.paymentExceeds ? (
                    <Text style={{ fontSize: 12, color: C.red, marginTop: 6, fontWeight: '600' }}>
                      Payment cannot exceed {formatINR(deliveryPaymentLive.dueAfterAdvance)}.
                    </Text>
                  ) : null}
                  {deliverySelection.length > 0 && !deliveryPaymentLive.canConfirm && !deliveryPaymentLive.paymentExceeds ? (
                    <Text style={{ fontSize: 12, color: C.red, marginTop: 6, fontWeight: '600' }}>
                      {formatINR(deliveryPaymentLive.balanceAfterPayment)} is still pending for the selected item(s). Full payment is required before delivery.
                    </Text>
                  ) : null}
                  {deliveryPaymentLive.canConfirm ? (
                    <Text style={{ fontSize: 12, color: C.green800, marginTop: 6, fontWeight: '600' }}>
                      Selected item(s) are fully covered — ready to deliver.
                    </Text>
                  ) : null}
                  <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                    Job advance is applied as credit for this delivery only — it is not shown as paid against a specific item. Blank/₹0 is allowed when advance covers the full due.
                  </Text>
                </View>
              ) : null}

              <View style={st.reviewRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={st.reviewLabel}>Send Google Review Link</Text>
                  <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 15 }}>
                    Turn this off if the customer is not satisfied or if asking for a review is not appropriate.
                  </Text>
                  {includeReview && !(reviewLink || '').trim() ? (
                    <Text style={{ fontSize: 11, color: C.red, marginTop: 6, fontWeight: '600' }}>
                      Google Review Link is not configured. Add it in Settings or turn this option off.
                    </Text>
                  ) : null}
                </View>
                <Switch
                  testID="delivery-review-toggle"
                  value={includeReview}
                  onValueChange={setIncludeReview}
                  trackColor={{ false: C.border, true: C.green100 }}
                  thumbColor={includeReview ? C.green800 : C.textMuted}
                />
              </View>

              <TouchableOpacity
                testID="confirm-delivery"
                style={[
                  st.confirmDeliveryBtn,
                  (!deliveryPaymentLive.canConfirm) && { opacity: 0.45 },
                ]}
                disabled={!deliveryPaymentLive.canConfirm}
                onPress={confirmDelivery}
              >
                <Ionicons name="checkmark-circle" size={20} color={C.primaryFg} />
                <Text style={st.confirmDeliveryText}>Confirm Delivery & Send WhatsApp</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Returned / Not Repaired Modal */}
      <Modal visible={!!returnJob} transparent animationType="slide" onRequestClose={closeReturnModal}>
        <View style={st.modalOverlay}>
          <View style={[st.modalBox, { maxHeight: '88%' }]}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>
                {returnStep === 'select' ? 'Select Items to Return' : 'Confirm Return'}
              </Text>
              <TouchableOpacity onPress={closeReturnModal}>
                <Ionicons name="close" size={24} color={C.primary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              {returnStep === 'select' ? (
                <>
                  {returnJob?.items.filter(isItemReturnable).length === 0 ? (
                    <Text style={{ color: C.textMuted, textAlign: 'center', marginBottom: 12 }}>
                      No items available to return.
                    </Text>
                  ) : null}
                  {returnJob?.items.filter(isItemReturnable).map(item => {
                    const selected = returnItems.has(item.id);
                    const paid = getItemSpecificPaid(item);
                    const chargesRaw = parseFloat(String(returnCharges[item.id] || '0'));
                    const charges = Math.max(0, Math.min(paid, Number.isFinite(chargesRaw) ? chargesRaw : 0));
                    const refundRaw = parseFloat(String(returnRefunds[item.id] ?? ''));
                    const refundDisplay = Number.isFinite(refundRaw)
                      ? Math.max(0, Math.min(paid, refundRaw))
                      : calcRefundableAmount(paid, charges);
                    return (
                      <View key={item.id} style={[st.deliveryItem, selected && st.deliveryItemSelected, { flexDirection: 'column', alignItems: 'stretch' }]}>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center' }}
                          onPress={() => toggleReturnItem(item.id)}
                        >
                          <Ionicons
                            name={selected ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={selected ? C.orange800 : C.textMuted}
                          />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={st.deliveryItemTitle}>
                              Item {item.itemNumber}: {ITEM_ICONS[item.itemType]} {item.itemType}
                            </Text>
                            <Text style={st.deliveryItemAmt}>
                              Amount {formatINR(getItemAmount(item))} · Paid {formatINR(paid)} · Refundable {formatINR(refundDisplay)}
                            </Text>
                          </View>
                        </TouchableOpacity>
                        {selected ? (
                          <View style={{ marginTop: 10, paddingLeft: 32 }}>
                            <Text style={[st.reviewLabel, { marginBottom: 4 }]}>Non-refundable charges (₹)</Text>
                            <TextInput
                              style={st.deliveryPayInput}
                              value={returnCharges[item.id] ?? '0'}
                              onChangeText={t => setReturnChargeForItem(item.id, paid, t)}
                              placeholder="0"
                              placeholderTextColor={C.textMuted}
                              keyboardType="decimal-pad"
                            />
                            <Text style={[st.reviewLabel, { marginTop: 8, marginBottom: 4 }]}>Refund amount (₹)</Text>
                            <TextInput
                              style={st.deliveryPayInput}
                              value={returnRefunds[item.id] ?? ''}
                              onChangeText={t => setReturnRefundForItem(item.id, t)}
                              placeholder="0"
                              placeholderTextColor={C.textMuted}
                              keyboardType="decimal-pad"
                            />
                            <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                              Max refund {formatINR(paid)}. Refundable = Paid − charges (never negative).
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}

                  <TouchableOpacity
                    testID="return-continue"
                    style={[st.confirmDeliveryBtn, { backgroundColor: C.orange800, marginTop: 8 }]}
                    onPress={goReturnConfirm}
                  >
                    <Ionicons name="arrow-forward-circle" size={20} color="#fff" />
                    <Text style={st.confirmDeliveryText}>Continue to Confirm</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={st.deliveryPayBox}>
                    <Text style={st.deliveryPayTitle}>Selected item(s)</Text>
                    {returnSummary.rows.map(({ item, paid, charges, refund }) => (
                      <View key={item.id} style={{ marginBottom: 12 }}>
                        <Text style={st.deliveryItemTitle}>
                          Item {item.itemNumber}: {ITEM_ICONS[item.itemType]} {item.itemType}
                        </Text>
                        <View style={st.paymentRow}>
                          <Text style={st.paymentLabel}>Amount paid</Text>
                          <Text style={st.paymentValue}>{formatINR(paid)}</Text>
                        </View>
                        <View style={st.paymentRow}>
                          <Text style={st.paymentLabel}>Non-refundable charges</Text>
                          <Text style={st.paymentValue}>{formatINR(charges)}</Text>
                        </View>
                        <View style={st.paymentRow}>
                          <Text style={[st.paymentLabel, { fontWeight: '800' }]}>Refundable amount</Text>
                          <Text style={[st.paymentValue, { fontWeight: '800', color: C.orange800 }]}>
                            {formatINR(refund)}
                          </Text>
                        </View>
                      </View>
                    ))}
                    {returnSummary.rows.length > 1 ? (
                      <View style={[st.paymentRow, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 }]}>
                        <Text style={[st.paymentLabel, { fontWeight: '800' }]}>Total refundable</Text>
                        <Text style={[st.paymentValue, { fontWeight: '800' }]}>
                          {formatINR(returnSummary.totalRefund)}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    testID="confirm-return-refund"
                    style={[st.confirmDeliveryBtn, { backgroundColor: C.orange800 }]}
                    onPress={() => confirmReturn(true)}
                  >
                    <Ionicons name="cash-outline" size={20} color="#fff" />
                    <Text style={st.confirmDeliveryText}>Confirm Return & Refund</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="confirm-return-no-refund"
                    style={[st.confirmDeliveryBtn, { backgroundColor: C.slate800, marginTop: 10 }]}
                    onPress={() => confirmReturn(false)}
                  >
                    <Ionicons name="return-down-back-outline" size={20} color="#fff" />
                    <Text style={st.confirmDeliveryText}>Confirm Return Without Refund</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{ alignItems: 'center', paddingVertical: 14 }}
                    onPress={() => setReturnStep('select')}
                  >
                    <Text style={{ color: C.blue, fontWeight: '600' }}>← Back to selection</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Previous Jobs modal */}
      <Modal visible={prevModalVisible} transparent animationType="slide" onRequestClose={closePreviousJobs}>
        <View style={st.modalOverlay}>
          <View style={[st.modalBox, { maxHeight: '88%' }]}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>Previous Jobs</Text>
              <TouchableOpacity testID="close-previous-jobs" onPress={closePreviousJobs}>
                <Ionicons name="close" size={24} color={C.primary} />
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              <TextInput
                testID="previous-jobs-search"
                style={st.searchInput}
                value={prevSearch}
                onChangeText={setPrevSearch}
                placeholder="Search job #, brand, item, description..."
                placeholderTextColor={C.textMuted}
              />
            </View>
            {prevModalLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={C.primary} />
                <Text style={{ marginTop: 12, color: C.textMuted }}>Loading…</Text>
              </View>
            ) : (
              <FlatList
                data={filteredPrevJobs}
                keyExtractor={j => j.id}
                renderItem={renderPrevJob}
                contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 32 }}
                initialNumToRender={8}
                maxToRenderPerBatch={8}
                windowSize={5}
                ListEmptyComponent={
                  <View style={st.empty}>
                    <Text style={st.emptyText}>
                      {prevSearch.trim() ? 'No matching previous jobs' : 'No previous jobs for this customer'}
                    </Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Lazy image viewer — loads only the tapped job's photo via getJob */}
      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={closePhotoViewer}>
        <View style={st.photoModal}>
          <TouchableOpacity testID="close-photo-modal" style={st.photoClose} onPress={closePhotoViewer}>
            <Ionicons name="close-circle" size={36} color="#FFF" />
          </TouchableOpacity>
          {viewerLoading && (
            <View style={st.photoCenter}>
              <ActivityIndicator size="large" color="#FFF" />
              <Text style={st.photoHint}>Loading image…</Text>
            </View>
          )}
          {!viewerLoading && viewerUnavailable && (
            <View style={st.photoCenter}>
              <Ionicons name="cloud-offline-outline" size={48} color="#FFF" />
              <Text style={st.photoHint}>Image not uploaded to cloud</Text>
            </View>
          )}
          {!viewerLoading && viewerUri ? (
            <Image
              source={{ uri: viewerUri }}
              style={st.photoFull}
              resizeMode="contain"
              onError={() => {
                setViewerUri(null);
                setViewerUnavailable(true);
              }}
            />
          ) : null}
        </View>
      </Modal>

      {toast && (
        <View style={[st.toast, toast.err && st.toastErr]}>
          <Text style={st.toastText}>{toast.msg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    backgroundColor: C.surface, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: C.primary },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  searchInput: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: C.text,
  },
  tabsRow: {
    flexDirection: 'row', backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 8, paddingVertical: 8, gap: 4,
  },
  tab: {
    flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 4, borderRadius: 10, backgroundColor: C.secondary,
  },
  tabActive: { backgroundColor: C.primary },
  tabLabel: { fontSize: 11, fontWeight: '800', color: C.textMuted, letterSpacing: 0.3 },
  tabLabelActive: { color: C.primaryFg },
  tabCount: { fontSize: 16, fontWeight: '800', color: C.text, marginTop: 2 },
  tabCountActive: { color: C.primaryFg },
  countRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 10,
  },
  countText: { fontSize: 13, color: C.textMuted, fontWeight: '600' },
  card: {
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    marginBottom: 12, overflow: 'hidden',
  },
  cardExpandedOuter: {
    borderWidth: 3,
    borderColor: C.primary,
    backgroundColor: '#F8FAFC',
    marginBottom: 28,
    paddingBottom: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  cardDimmed: { opacity: 0.55 },
  cardTop: { padding: 14, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardTopExpanded: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  photoThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: C.border,
  },
  photoIconBtn: {
    width: 48, height: 48, borderRadius: 10, backgroundColor: C.secondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border,
    overflow: 'hidden',
  },
  cardNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { fontSize: 17, fontWeight: '700', color: C.text, flex: 1 },
  cardPhone: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  cardItems: {
    fontSize: 12, fontWeight: '600', color: C.text, backgroundColor: C.secondary,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
  },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardSummary: { fontSize: 12, color: C.textMuted, marginTop: 4 },
  cardBalance: { fontSize: 13, fontWeight: '700', color: C.red, marginTop: 4 },
  cardDate: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  cardExpanded: {
    borderTopWidth: 1, borderTopColor: C.border,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18,
  },
  jobBanner: { alignItems: 'center', marginBottom: 14 },
  jobBannerRule: {
    fontSize: 11, color: C.primary, letterSpacing: 1, fontWeight: '600',
  },
  jobBannerTitle: {
    fontSize: 22, fontWeight: '900', color: C.primary,
    letterSpacing: 0.5, marginVertical: 4, textAlign: 'center',
  },
  jobMetaBlock: { marginBottom: 12 },
  jobMetaLine: { fontSize: 14, color: C.text, marginBottom: 4, lineHeight: 20 },
  jobMetaLabel: { fontWeight: '800', color: C.textMuted },
  prevJobsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
  },
  prevJobsBtnText: { fontSize: 15, fontWeight: '700', color: C.blue },
  itemCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    marginBottom: 12,
  },
  itemCardHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6,
  },
  itemCardHeader: {
    fontSize: 14, fontWeight: '900', color: C.primary, letterSpacing: 0.4, flex: 1,
  },
  itemDivider: {
    height: 3, borderRadius: 2, marginTop: 12, opacity: 0.85,
  },
  itemReadOnly: { fontSize: 13, color: C.text, marginTop: 6, lineHeight: 19 },
  itemReadOnlyLabel: { fontWeight: '700', color: C.textMuted },
  paymentSummary: {
    backgroundColor: '#F1F5F9', borderRadius: 10, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: C.border,
  },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  paymentLabel: { fontSize: 13, color: C.textMuted },
  paymentValue: { fontSize: 13, fontWeight: '700', color: C.text },
  editJobBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14, marginBottom: 12,
  },
  editJobBtnText: { fontSize: 15, fontWeight: '800', color: C.primaryFg, letterSpacing: 0.6 },
  expandedBottomDivider: {
    height: 4, backgroundColor: C.primary, borderRadius: 2, marginTop: 8, opacity: 0.9,
  },
  prevCard: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 14, marginBottom: 12,
  },
  prevCardCurrent: { borderColor: C.blue, backgroundColor: '#F8FAFC' },
  prevCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  prevJobNo: { fontSize: 17, fontWeight: '800', color: C.primary },
  currentPill: { backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  currentPillText: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  prevLabel: { fontSize: 12, fontWeight: '700', color: C.textMuted, letterSpacing: 0.3 },
  prevMeta: { fontSize: 13, color: C.text, marginTop: 8, lineHeight: 18 },
  prevItems: { fontSize: 13, color: C.text, marginTop: 4, lineHeight: 20 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  itemTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  itemSub: { fontSize: 12, color: C.textMuted },
  itemDesc: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  itemDiagnosis: { fontSize: 12, color: C.amber800, marginTop: 4, fontWeight: '600' },
  itemService: { fontSize: 12, color: C.blue, marginTop: 4, fontWeight: '600' },
  itemEst: { fontSize: 12, fontWeight: '600', color: C.green800 },
  statusBtn: { padding: 8, backgroundColor: C.secondary, borderRadius: 8 },
  jobActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10,
    paddingVertical: 8, borderRadius: 6, backgroundColor: C.secondary,
  },
  actionText: { fontSize: 12, fontWeight: '700', color: C.text },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontSize: 16, color: C.textMuted, marginTop: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '70%', paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.primary },
  currentStatusBanner: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginBottom: 4,
  },
  currentStatusLabel: { fontSize: 12, color: C.textMuted, fontWeight: '600', marginBottom: 6 },
  currentStatusHint: { fontSize: 12, color: C.textMuted, marginTop: 8, lineHeight: 16 },
  statusItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusItemText: { fontSize: 15, color: C.text },
  deliveryItem: {
    flexDirection: 'row', alignItems: 'center', padding: 14, borderWidth: 1,
    borderColor: C.border, borderRadius: 10, marginBottom: 10,
  },
  deliveryItemSelected: { borderColor: C.green800, backgroundColor: C.green100 },
  deliveryItemTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  deliveryItemDesc: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  deliveryItemAmt: { fontSize: 13, fontWeight: '700', color: C.green800, marginTop: 2 },
  deliveryPayBox: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 14, marginTop: 8, marginBottom: 8,
  },
  deliveryPayTitle: { fontSize: 14, fontWeight: '800', color: C.primary, marginBottom: 10 },
  deliveryPayInput: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.text, marginTop: 6,
  },
  reviewRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: C.border, marginTop: 10, gap: 10,
  },
  reviewLabel: { fontSize: 14, fontWeight: '600', color: C.text },
  confirmDeliveryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, marginTop: 16,
  },
  confirmDeliveryText: { fontSize: 16, fontWeight: '700', color: C.primaryFg },
  photoModal: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center',
  },
  photoClose: { position: 'absolute', top: 48, right: 20, zIndex: 2 },
  photoFull: { width: '100%', height: '80%' },
  photoCenter: { alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  photoHint: { color: '#FFF', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  toast: {
    position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: '#166534',
    borderRadius: 10, padding: 14, alignItems: 'center',
  },
  toastErr: { backgroundColor: C.red },
  toastText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
