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
  technicianNotes: string;
  photos: string[];
  status: string;
  expectedDeliveryDate: string;
  warrantyDetails: string;
  delivered: boolean;
  deliveredDate: string;
  createdAt: string;
  updatedAt: string;
}

// ============ CUSTOM PHRASE ============
export interface CustomPhrase {
  id: string;
  itemType: string;
  phrase: string;
}

// ============ BACKUP DATA ============
export interface BackupData {
  version: string;
  timestamp: string;
  jobs?: RepairJob[];
  records?: OldRepairRecord[];
  customPhrases?: CustomPhrase[];
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
  'Cancelled',
] as const;

export function getOverallStatus(items: RepairItem[]): string {
  if (items.length === 0) return 'No Items';
  const active = items.filter(i => i.status !== 'Cancelled');
  if (active.length === 0) return 'Cancelled';
  if (active.every(i => i.delivered)) return 'Completed';
  if (active.every(i => i.delivered || i.status === 'Ready')) return 'Ready';
  if (active.some(i => i.delivered) && active.some(i => !i.delivered)) return 'Partially Delivered';
  return 'In Progress';
}

export function getJobTotals(items: RepairItem[], advance: number) {
  const totalEstimated = items.reduce((s, i) => s + (i.estimatedAmount || 0), 0);
  const totalFinal = items.reduce((s, i) => s + (i.finalAmount || 0), 0);
  const totalPaid = items.reduce((s, i) => s + (i.amountPaid || 0), 0) + advance;
  const displayTotal = totalFinal > 0 ? totalFinal : totalEstimated;
  const balance = displayTotal - totalPaid;
  return { totalEstimated, totalFinal, totalPaid, balance, displayTotal };
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
