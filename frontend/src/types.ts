// ============ REPAIR PHOTO ============
export type PhotoUploadStatus = 'local' | 'pending' | 'uploading' | 'uploaded' | 'failed';

/** One repair image — supports local device URI + Firebase Storage cloud URL. */
export interface RepairPhoto {
  id: string;
  localUri?: string;
  cloudUrl?: string;
  storagePath?: string;
  uploadStatus: PhotoUploadStatus;
  uploadedAt?: string;
}

// ============ REPAIR JOB (Parent) ============
export interface RepairJob {
  id: string;
  jobNumber: string;
  customerName: string;
  mobileNumber: string;
  countryCode: string;
  receivedDate: string;
  advanceAmount: number;
  overallNotes: string;
  googleReviewSent: boolean;
  /**
   * When true, this job is eligible for Firestore upload/update/delete sync.
   * Historical local jobs stay false until staff enables cloud sync for that job
   * (or bulk migration is turned on).
   */
  cloudSyncEnabled: boolean;
  items: RepairItem[];
  createdAt: string;
  updatedAt: string;
}

// ============ REPAIR ITEM (Child) ============
export interface RepairItem {
  id: string;
  jobId: string;
  itemNumber: number;
  itemType: string;
  brand: string;
  model: string;
  color: string;
  identification: string;
  description: string;
  selectedPhrases: string[];
  customerComplaint: string;
  accessoriesReceived: string;
  estimatedAmount: number;
  finalAmount: number;
  amountPaid: number;
  /**
   * Portion of the job-level advance applied to this item at delivery.
   * Job advance is NOT auto-assigned to items before delivery.
   */
  advanceApplied: number;
  /** Amount refunded to customer when item is returned / not repaired */
  refundAmount: number;
  /** Non-refundable charges kept (inspection, transport, parts used, etc.) */
  nonRefundableCharges: number;
  returnedDate: string;
  technicianNotes: string;
  /**
   * Image records (legacy string URIs are normalized on read into RepairPhoto).
   * Prefer cloudUrl for display across devices; localUri is device-local only.
   */
  photos: RepairPhoto[];
  status: string;
  expectedDeliveryDate: string;
  warrantyDetails: string;
  delivered: boolean;
  deliveredDate: string;
  createdAt: string;
  updatedAt: string;
}

// ============ CUSTOM PHRASE (Service Performed / Work Done — separate from diagnosis) ============
export interface CustomPhrase {
  id: string;
  itemType: string; // Watch | Spectacle | Goggle | Wall Clock | All Items
  phrase: string;
  isEnabled: boolean;
  sortOrder: number;
}

export const SERVICE_PHRASE_ALL_ITEMS = 'All Items';

export const SERVICE_PHRASE_ITEM_TYPES = [
  'Watch', 'Spectacle', 'Goggle', 'Wall Clock', SERVICE_PHRASE_ALL_ITEMS,
] as const;

export function normalizeServicePhraseKey(phrase: string): string {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ============ TECHNICIAN DIAGNOSIS PHRASE LIBRARY ============
/** Diagnosis phrases are organized by repair item type (not Battery/Machine/etc.). */
export interface DiagnosisPhrase {
  id: string;
  phrase: string;
  /** Watch | Spectacle | Goggle | Wall Clock — stored in DB column `category` */
  itemType: string;
  isFavourite: boolean;
  isEnabled: boolean;
  sortOrder: number;
  useCount: number;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const DIAGNOSIS_ITEM_TYPES = ['Watch', 'Spectacle', 'Goggle', 'Wall Clock'] as const;

/** @deprecated kept for migration / backup typing only */
export interface DiagnosisCategory {
  id: string;
  name: string;
  sortOrder: number;
}

/** Default seed — keyed by item type; written to SQLite once / on v2 migrate */
export const DEFAULT_DIAGNOSIS_PHRASES: { phrase: string; itemType: string }[] = [
  // Watch
  { phrase: 'Battery weak', itemType: 'Watch' },
  { phrase: 'Battery leakage', itemType: 'Watch' },
  { phrase: 'Machine rusted', itemType: 'Watch' },
  { phrase: 'Machine jammed', itemType: 'Watch' },
  { phrase: 'Balance wheel broken', itemType: 'Watch' },
  { phrase: 'Stem broken', itemType: 'Watch' },
  { phrase: 'Crown damaged', itemType: 'Watch' },
  { phrase: 'Glass broken', itemType: 'Watch' },
  { phrase: 'Hands loose', itemType: 'Watch' },
  { phrase: 'Dial damaged', itemType: 'Watch' },
  { phrase: 'Coil faulty', itemType: 'Watch' },
  { phrase: 'Magnetized', itemType: 'Watch' },
  { phrase: 'Needs complete service', itemType: 'Watch' },
  // Spectacle
  { phrase: 'Frame bent', itemType: 'Spectacle' },
  { phrase: 'Screw loose', itemType: 'Spectacle' },
  { phrase: 'Nose pad damaged', itemType: 'Spectacle' },
  { phrase: 'Temple loose', itemType: 'Spectacle' },
  { phrase: 'Temple broken', itemType: 'Spectacle' },
  { phrase: 'Lens scratched', itemType: 'Spectacle' },
  { phrase: 'Lens cracked', itemType: 'Spectacle' },
  { phrase: 'Needs alignment', itemType: 'Spectacle' },
  { phrase: 'Needs soldering', itemType: 'Spectacle' },
  // Goggle
  { phrase: 'Lens scratched', itemType: 'Goggle' },
  { phrase: 'Foam damaged', itemType: 'Goggle' },
  { phrase: 'Elastic damaged', itemType: 'Goggle' },
  { phrase: 'Frame cracked', itemType: 'Goggle' },
  { phrase: 'Needs cleaning', itemType: 'Goggle' },
  // Wall Clock
  { phrase: 'Machine faulty', itemType: 'Wall Clock' },
  { phrase: 'Pendulum problem', itemType: 'Wall Clock' },
  { phrase: 'Hands touching', itemType: 'Wall Clock' },
  { phrase: 'Glass broken', itemType: 'Wall Clock' },
  { phrase: 'Battery leakage', itemType: 'Wall Clock' },
  { phrase: 'Movement jammed', itemType: 'Wall Clock' },
  { phrase: 'Needs servicing', itemType: 'Wall Clock' },
];

/** Map legacy Battery/Machine/... categories (or free text) → item type */
export function mapDiagnosisCategoryToItemType(categoryOrType: string, phrase = ''): string {
  const c = (categoryOrType || '').trim();
  if (DIAGNOSIS_ITEM_TYPES.includes(c as any)) return c;
  const lower = c.toLowerCase();
  if (lower === 'spectacle' || lower === 'spectacles' || lower === 'optical') return 'Spectacle';
  if (lower === 'goggle' || lower === 'goggles' || lower === 'sunglasses') return 'Goggle';
  if (lower.includes('wall') || lower === 'clock') return 'Wall Clock';
  const p = (phrase || '').toLowerCase();
  if (/goggle|foam|elastic/.test(p)) return 'Goggle';
  if (/pendulum|wall clock|movement jammed|chime|cuckoo/.test(p)) return 'Wall Clock';
  if (/nose pad|temple|spectacle|frame bent|soldering|alignment|lens cracked/.test(p)) return 'Spectacle';
  // Legacy part categories (Battery, Machine, Glass, Dial, Hands, …) were watch-oriented
  return 'Watch';
}

export const MAX_DIAGNOSIS_FAVOURITES = 15;

/** Normalize for duplicate checks: trim, collapse spaces, lowercase. */
export function normalizeDiagnosisPhraseKey(phrase: string): string {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Merge diagnosis phrases into existing text without duplicates (one phrase per line). */
export function appendDiagnosisPhrases(existing: string, phrases: string[]): string {
  const lines = existing
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const lower = new Set(lines.map(l => normalizeDiagnosisPhraseKey(l)));
  for (const p of phrases) {
    const t = p.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const key = normalizeDiagnosisPhraseKey(t);
    if (lower.has(key)) continue;
    lines.push(t);
    lower.add(key);
  }
  return lines.join('\n');
}

// ============ BACKUP DATA ============
export interface BackupData {
  version: string;
  timestamp: string;
  jobs?: RepairJob[];
  records?: OldRepairRecord[];
  customPhrases?: CustomPhrase[];
  diagnosisPhrases?: DiagnosisPhrase[];
  diagnosisCategories?: DiagnosisCategory[];
  appConfig?: Record<string, string>;
}

// ============ OLD FORMAT (for migration) ============
export interface OldRepairRecord {
  id: string;
  name: string;
  phone: string;
  countryCode: string;
  item: string;
  issue: string;
  photo: string | null;
  status: string;
  date: string;
  repairedAt: string | null;
  deliveredAt: string | null;
}

// ============ HELPERS ============
export const ITEM_STATUSES = [
  'Received',
  'Checking',
  'Estimate Pending',
  'Customer Approval Pending',
  'Approved',
  'Under Repair',
  'Sent Outside',
  'Parts Pending',
  'Ready',
  'Delivered',
  'Not Repaired',
  'Cancelled',
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Simplified status choices for Records quick-status popup only (Edit Job keeps full list). */
export const RECORDS_QUICK_STATUSES = [
  'Received',
  'Ready',
  'Delivered',
  'Cancelled',
] as const;

function normalizeStatus(status: string): string {
  return (status || '').trim().toLowerCase();
}

/** Compatibility mapping for legacy labels — used for logic, not silent DB rewrite */
export function mapLegacyStatus(status: string): string {
  const s = normalizeStatus(status);
  switch (s) {
    case 'pending':
      return 'Received';
    case 'not repaired':
    case 'returned':
      return 'Not Repaired';
    case 'repaired':
    case 'repaired reminder':
    case 'ready for delivery':
      return 'Ready';
    case 'completed':
      return 'Delivered';
    default:
      return status || 'Received';
  }
}

export function isStatusCancelled(status: string): boolean {
  return normalizeStatus(status) === 'cancelled';
}

export function isStatusReady(status: string): boolean {
  const s = normalizeStatus(status);
  return s === 'ready' || s === 'repaired' || s === 'repaired reminder' || s === 'ready for delivery';
}

export function isItemDelivered(item: { status: string; delivered?: boolean }): boolean {
  if (item.delivered) return true;
  const s = normalizeStatus(item.status);
  return s === 'delivered' || s === 'completed';
}

/** True when item was returned / could not be repaired. */
export function isItemReturned(item: { status?: string }): boolean {
  const s = normalizeStatus(item.status || '');
  return s === 'not repaired' || s === 'returned';
}

/** Items that can be selected for Returned / Not Repaired. */
export function isItemReturnable(item: { status?: string; delivered?: boolean }): boolean {
  if (isItemDelivered({ status: item.status || '', delivered: item.delivered })) return false;
  if (isItemReturned(item)) return false;
  if (isStatusCancelled(item.status || '')) return false;
  return true;
}

/** Still on the repair track and payable (not delivered, returned, or cancelled). */
export function isItemActivePayable(item: { status?: string; delivered?: boolean }): boolean {
  return isItemReturnable(item);
}

export function getItemRefund(item: { refundAmount?: number }): number {
  return Math.max(0, Number(item.refundAmount) || 0);
}

export function getItemNonRefundable(item: { nonRefundableCharges?: number }): number {
  return Math.max(0, Number(item.nonRefundableCharges) || 0);
}

/**
 * Refundable = Amount Paid − Non-refundable charges (never negative, never above paid).
 */
export function calcRefundableAmount(amountPaid: number, nonRefundableCharges: number): number {
  const paid = Math.max(0, Number(amountPaid) || 0);
  const charges = Math.max(0, Number(nonRefundableCharges) || 0);
  return Math.max(0, Math.min(paid, paid - charges));
}

export function isItemReadyUndelivered(item: { status: string; delivered?: boolean }): boolean {
  return (
    !isItemDelivered(item) &&
    !isItemReturned(item) &&
    !isStatusCancelled(item.status) &&
    isStatusReady(item.status)
  );
}

export function isItemUnfinishedNotReady(item: { status: string; delivered?: boolean }): boolean {
  return (
    !isItemDelivered(item) &&
    !isItemReturned(item) &&
    !isStatusCancelled(item.status) &&
    !isStatusReady(item.status)
  );
}

export function getItemAmount(item: { finalAmount?: number; estimatedAmount?: number }): number {
  const final = Math.max(0, Number(item.finalAmount) || 0);
  const est = Math.max(0, Number(item.estimatedAmount) || 0);
  return final > 0 ? final : est;
}

export function getItemPaid(item: { amountPaid?: number }): number {
  return Math.max(0, Number(item.amountPaid) || 0);
}

/** Item-specific payments only (never includes job-level advance). */
export function getItemSpecificPaid(item: { amountPaid?: number }): number {
  return getItemPaid(item);
}

/** Job advance applied to this item at delivery (0 until delivered with advance credit). */
export function getItemAdvanceApplied(item: { advanceApplied?: number }): number {
  return Math.max(0, Number(item.advanceApplied) || 0);
}

export function getJobAdvancePaid(advanceAmount: number): number {
  return Math.max(0, Number(advanceAmount) || 0);
}

/** Sum of job advance already applied across deliveries. */
export function getAdvanceAppliedTotal(
  items: Array<{ advanceApplied?: number }>,
): number {
  return items.reduce((s, i) => s + getItemAdvanceApplied(i), 0);
}

/** Job advance still available for future deliveries. */
export function getUnallocatedAdvance(
  advanceAmount: number,
  items: Array<{ advanceApplied?: number }>,
): number {
  return Math.max(0, getJobAdvancePaid(advanceAmount) - getAdvanceAppliedTotal(items));
}

/** Sum of item-specific delivery/collection payments (excludes job advance). */
export function getDeliveryPaymentsTotal(
  items: Array<{ amountPaid?: number }>,
): number {
  return items.reduce((s, i) => s + getItemSpecificPaid(i), 0);
}

/**
 * Amount that still counts toward the original job total.
 * Delivered items keep their full amount. Cancelled = 0.
 * Returned / not repaired: only non-refundable retained charges (if any).
 */
export function getChargeableJobItemAmount(item: {
  finalAmount?: number;
  estimatedAmount?: number;
  nonRefundableCharges?: number;
  status?: string;
  delivered?: boolean;
}): number {
  if (isStatusCancelled(item.status || '')) return 0;
  if (isItemReturned(item)) return getItemNonRefundable(item);
  return getItemAmount(item);
}

/**
 * Total Paid = Job Advance + All Delivery Payments − Total Refunds
 * Balance Payable = Full Job Total − Total Paid
 */
export function getJobPaymentBreakdown(
  items: Array<{
    finalAmount?: number;
    estimatedAmount?: number;
    amountPaid?: number;
    advanceApplied?: number;
    refundAmount?: number;
    nonRefundableCharges?: number;
    status?: string;
    delivered?: boolean;
  }>,
  advanceAmount = 0,
) {
  const jobTotal = items.reduce((s, i) => s + getChargeableJobItemAmount(i), 0);
  const jobAdvancePaid = getJobAdvancePaid(advanceAmount);
  const deliveryPayments = getDeliveryPaymentsTotal(items);
  const totalRefunded = items.reduce((s, i) => s + getItemRefund(i), 0);
  const totalPaid = Math.max(0, jobAdvancePaid + deliveryPayments - totalRefunded);
  const balancePayable = Math.max(0, jobTotal - totalPaid);
  const unallocatedAdvance = getUnallocatedAdvance(advanceAmount, items);
  return {
    jobTotal,
    jobAdvancePaid,
    deliveryPayments,
    totalRefunded,
    totalPaid,
    balancePayable,
    unallocatedAdvance,
    advanceAppliedTotal: getAdvanceAppliedTotal(items),
  };
}

/**
 * Delivery credit for currently selected items.
 * Uses unallocated job advance + item-specific payments + payment received now.
 */
export function getSelectedDeliveryPaymentSummary<T extends {
  id: string;
  finalAmount?: number;
  estimatedAmount?: number;
  amountPaid?: number;
  advanceApplied?: number;
}>(
  selectedItems: T[],
  allItems: Array<{ advanceApplied?: number }>,
  jobAdvanceAmount: number,
  paymentReceivedNow: number,
) {
  const selectedItemsTotal = selectedItems.reduce((s, i) => s + getItemAmount(i), 0);
  const itemSpecificPaid = selectedItems.reduce((s, i) => s + getItemSpecificPaid(i), 0);
  const selectedDueBeforeCredit = Math.max(0, selectedItemsTotal - itemSpecificPaid);
  const unallocatedAdvance = getUnallocatedAdvance(jobAdvanceAmount, allItems);
  const advanceAppliedThisDelivery = Math.min(selectedDueBeforeCredit, unallocatedAdvance);
  const dueAfterAdvance = Math.max(0, selectedDueBeforeCredit - advanceAppliedThisDelivery);
  const paymentNow = Math.max(0, Number(paymentReceivedNow) || 0);
  const paymentExceeds = paymentNow > dueAfterAdvance + 0.0001;
  const balanceAfterPayment = paymentExceeds
    ? dueAfterAdvance
    : Math.max(0, dueAfterAdvance - paymentNow);
  const canConfirm =
    selectedItems.length > 0 &&
    !paymentExceeds &&
    balanceAfterPayment <= 0.0001;

  return {
    selectedItemsTotal,
    itemSpecificPaid,
    selectedDueBeforeCredit,
    unallocatedAdvance,
    advanceAppliedThisDelivery,
    dueAfterAdvance,
    paymentReceivedNow: paymentNow,
    balanceAfterPayment,
    paymentExceeds,
    canConfirm,
  };
}

/**
 * Allocate unallocated job advance across selected items (FIFO by selection order).
 */
export function allocateAdvanceAcrossItems<T extends {
  id: string;
  finalAmount?: number;
  estimatedAmount?: number;
  amountPaid?: number;
}>(selectedItems: T[], advancePool: number): Map<string, number> {
  let remaining = Math.max(0, Number(advancePool) || 0);
  const applied = new Map<string, number>();
  for (const item of selectedItems) {
    if (remaining <= 0) {
      applied.set(item.id, 0);
      continue;
    }
    const due = Math.max(0, getItemAmount(item) - getItemSpecificPaid(item));
    const take = Math.min(due, remaining);
    applied.set(item.id, take);
    remaining -= take;
  }
  return applied;
}

/**
 * Overall job payment summary AFTER saving the current delivery.
 * Total Paid = Job Advance + Delivery Payments − Refunds (advance counted once).
 */
export function getOverallJobPaymentSummaryAfterDelivery(
  allItems: Array<{
    id: string;
    finalAmount?: number;
    estimatedAmount?: number;
    amountPaid?: number;
    advanceApplied?: number;
    refundAmount?: number;
    nonRefundableCharges?: number;
    status?: string;
    delivered?: boolean;
  }>,
  jobAdvanceAmount: number,
  selectedIds: Set<string>,
  paymentAppliedById: Map<string, number>,
  advanceAppliedById: Map<string, number>,
) {
  const jobTotal = allItems.reduce((s, i) => s + getChargeableJobItemAmount(i), 0);
  const jobAdvancePaid = getJobAdvancePaid(jobAdvanceAmount);

  const deliveryPayments = allItems.reduce((s, i) => {
    const base = getItemSpecificPaid(i);
    if (selectedIds.has(i.id)) {
      return s + base + (paymentAppliedById.get(i.id) || 0);
    }
    return s + base;
  }, 0);

  const totalRefunded = allItems.reduce((s, i) => s + getItemRefund(i), 0);
  const totalPaid = Math.max(0, jobAdvancePaid + deliveryPayments - totalRefunded);
  const balancePayable = Math.max(0, jobTotal - totalPaid);

  return {
    jobTotal,
    jobAdvancePaid,
    deliveryPayments,
    deliveryPaymentsThisDelivery: [...paymentAppliedById.values()].reduce(
      (s, n) => s + Math.max(0, n),
      0,
    ),
    advanceAppliedThisDelivery: [...advanceAppliedById.values()].reduce(
      (s, n) => s + Math.max(0, n),
      0,
    ),
    totalRefunded,
    totalPaid,
    balancePayable,
  };
}

/**
 * Item face balance for display: amount − item-specific paid only.
 * Does NOT subtract job-level advance.
 */
export function getItemBalance(item: {
  finalAmount?: number;
  estimatedAmount?: number;
  amountPaid?: number;
  status?: string;
}): number {
  if (isItemReturned(item)) return 0;
  return Math.max(0, getItemAmount(item) - getItemSpecificPaid(item));
}

export type ItemPaymentStatus = 'Unpaid' | 'Partially Paid' | 'Paid';

export function getItemPaymentStatus(item: {
  finalAmount?: number;
  estimatedAmount?: number;
  amountPaid?: number;
}): ItemPaymentStatus {
  const amount = getItemAmount(item);
  const paid = getItemPaid(item);
  if (amount <= 0) return paid > 0 ? 'Paid' : 'Unpaid';
  if (paid <= 0) return 'Unpaid';
  if (paid + 0.0001 >= amount) return 'Paid';
  return 'Partially Paid';
}

/**
 * Allocate a payment pool across items in order (itemNumber / array order).
 * Each item receives at most its remaining balance. Never overpays an item.
 * Returns a map of itemId → additional amount applied this allocation.
 */
export function allocatePaymentAcrossItems<T extends {
  id: string;
  finalAmount?: number;
  estimatedAmount?: number;
  amountPaid?: number;
}>(items: T[], paymentPool: number): Map<string, number> {
  let remaining = Math.max(0, Number(paymentPool) || 0);
  const applied = new Map<string, number>();
  for (const item of items) {
    if (remaining <= 0) {
      applied.set(item.id, 0);
      continue;
    }
    const due = getItemBalance(item);
    const take = Math.min(due, remaining);
    applied.set(item.id, take);
    remaining -= take;
  }
  return applied;
}

/**
 * Split an advance across items FIFO by order (used at job create / migrate).
 * Returns amountPaid values for each item (same length as amounts[]).
 */
export function allocateAdvanceToAmounts(amounts: number[], advance: number): number[] {
  let remaining = Math.max(0, Number(advance) || 0);
  return amounts.map(raw => {
    const amt = Math.max(0, Number(raw) || 0);
    const take = Math.min(amt, remaining);
    remaining -= take;
    return take;
  });
}

/**
 * Parent job status derived from child item statuses (never overwrites children).
 */
export function getOverallStatus(items: Array<{ status: string; delivered?: boolean }>): string {
  if (items.length === 0) return 'No Items';

  const active = items.filter(i => !isStatusCancelled(i.status));
  if (active.length === 0) return 'Cancelled';

  const stillOpen = active.filter(i => !isItemDelivered(i) && !isItemReturned(i));
  if (stillOpen.length === 0) return 'Completed';

  const hasDelivered = active.some(isItemDelivered);
  const hasReady = stillOpen.some(i => isStatusReady(i.status));
  const hasNonReady = stillOpen.some(i => !isStatusReady(i.status));

  if (hasDelivered && stillOpen.length > 0) return 'Partially Delivered';
  if (stillOpen.every(i => isStatusReady(i.status))) return 'Ready';
  if (hasReady && hasNonReady) return 'Partially Ready';
  return 'In Progress';
}

/** Compact summary like "1 Ready • 1 Under Repair • 1 Parts Pending" */
export function getItemStatusSummary(items: Array<{ status: string; delivered?: boolean }>): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = isItemDelivered(item)
      ? 'Delivered'
      : isItemReturned(item)
        ? 'Not Repaired'
        : (item.status || 'Received');
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, n]) => `${n} ${label}`).join(' • ');
}

/**
 * Job totals — job advance stays separate from item-specific payments.
 * Total Paid = Job Advance + Delivery Payments − Refunds
 * Balance = Job Total − Total Paid
 */
export function getJobTotals(
  items: Array<{
    finalAmount?: number;
    estimatedAmount?: number;
    amountPaid?: number;
    advanceApplied?: number;
    refundAmount?: number;
    nonRefundableCharges?: number;
    status?: string;
    delivered?: boolean;
  }>,
  advance = 0,
) {
  const totalEstimated = items.reduce((s, i) => s + Math.max(0, Number(i.estimatedAmount) || 0), 0);
  const totalFinal = items.reduce((s, i) => s + Math.max(0, Number(i.finalAmount) || 0), 0);
  const grossTotal = items.reduce((s, i) => s + getItemAmount(i), 0);
  const pay = getJobPaymentBreakdown(items, advance);
  const activeItems = items.filter(i =>
    isItemActivePayable({ status: i.status || '', delivered: i.delivered }),
  );
  const activeTotal = activeItems.reduce((s, i) => s + getItemAmount(i), 0);
  const netRetained = Math.max(0, pay.totalPaid);

  return {
    totalEstimated,
    totalFinal,
    displayTotal: pay.jobTotal,
    grossTotal,
    totalPaid: pay.totalPaid,
    totalRefunded: pay.totalRefunded,
    netPaid: pay.totalPaid,
    netRetained,
    balance: pay.balancePayable,
    activeTotal,
    advance: pay.jobAdvancePaid,
    jobAdvancePaid: pay.jobAdvancePaid,
    deliveryPayments: pay.deliveryPayments,
    unallocatedAdvance: pay.unallocatedAdvance,
  };
}

/**
 * Payment summary for a delivery selection (selected items only).
 * Does not use the full job remaining balance for the selected subset.
 */
export function getSubsetPaymentSummary(
  allItems: Array<{
    id: string;
    finalAmount?: number;
    estimatedAmount?: number;
    amountPaid?: number;
    delivered?: boolean;
    status?: string;
  }>,
  subset: Array<{
    id: string;
    finalAmount?: number;
    estimatedAmount?: number;
    amountPaid?: number;
  }>,
  _advance = 0,
) {
  const subsetAmount = subset.reduce((s, i) => s + getItemAmount(i), 0);
  const subsetPaid = subset.reduce((s, i) => s + getItemPaid(i), 0);
  const subsetBalance = subset.reduce((s, i) => s + getItemBalance(i), 0);
  const subsetIds = new Set(subset.map(i => i.id));
  const otherPending = allItems.filter(i => {
    if (subsetIds.has(i.id)) return false;
    const asItem = { status: i.status || '', delivered: i.delivered };
    return isItemActivePayable(asItem);
  });
  const otherPendingBalance = otherPending.reduce((s, i) => s + getItemBalance(i), 0);
  const job = getJobTotals(allItems, _advance);
  return {
    subsetTotal: subsetAmount,
    subsetPaid,
    subsetBalance,
    otherPendingBalance,
    jobTotal: job.displayTotal,
    jobPaid: job.totalPaid,
    jobBalance: job.balance,
    advance: job.advance,
  };
}

export function formatINR(amount: number): string {
  const n = Math.max(0, Number(amount) || 0);
  const formatted = n % 1 === 0
    ? n.toLocaleString('en-IN')
    : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₹${formatted}`;
}

export function createEmptyItem(jobId: string, itemNumber: number): RepairItem {
  const now = new Date().toISOString();
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    jobId,
    itemNumber,
    itemType: 'Watch',
    brand: '',
    model: '',
    color: '',
    identification: '',
    description: '',
    selectedPhrases: [],
    customerComplaint: '',
    accessoriesReceived: '',
    estimatedAmount: 0,
    finalAmount: 0,
    amountPaid: 0,
    advanceApplied: 0,
    refundAmount: 0,
    nonRefundableCharges: 0,
    returnedDate: '',
    technicianNotes: '',
    photos: [],
    status: 'Received',
    expectedDeliveryDate: '',
    warrantyDetails: '',
    delivered: false,
    deliveredDate: '',
    createdAt: now,
    updatedAt: now,
  };
}
