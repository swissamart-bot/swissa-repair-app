import { formatINR, getItemAmount } from './types';

export const C = {
  bg: '#FAFAFA', surface: '#FFFFFF', primary: '#0A0A0A', primaryFg: '#FFFFFF',
  secondary: '#F1F5F9', secondaryFg: '#0F172A', border: '#E2E8F0',
  text: '#0A0A0A', textMuted: '#64748B', whatsapp: '#25D366', whatsappDark: '#1DA851',
  amber100: '#FEF3C7', amber800: '#92400E', green100: '#DCFCE7', green800: '#166534',
  slate100: '#F1F5F9', slate800: '#334155', red: '#DC2626', blue: '#2563EB',
  purple100: '#F3E8FF', purple800: '#6B21A8', orange100: '#FFF7ED', orange800: '#9A3412',
};

export const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳' }, { code: '+971', flag: '🇦🇪' }, { code: '+1', flag: '🇺🇸' },
  { code: '+44', flag: '🇬🇧' }, { code: '+61', flag: '🇦🇺' }, { code: '+65', flag: '🇸🇬' },
  { code: '+60', flag: '🇲🇾' }, { code: '+966', flag: '🇸🇦' }, { code: '+974', flag: '🇶🇦' },
  { code: '+968', flag: '🇴🇲' }, { code: '+973', flag: '🇧🇭' }, { code: '+965', flag: '🇰🇼' },
  { code: '+92', flag: '🇵🇰' }, { code: '+880', flag: '🇧🇩' }, { code: '+94', flag: '🇱🇰' },
  { code: '+977', flag: '🇳🇵' }, { code: '+64', flag: '🇳🇿' }, { code: '+49', flag: '🇩🇪' },
  { code: '+33', flag: '🇫🇷' }, { code: '+39', flag: '🇮🇹' }, { code: '+34', flag: '🇪🇸' },
  { code: '+81', flag: '🇯🇵' }, { code: '+82', flag: '🇰🇷' }, { code: '+86', flag: '🇨🇳' },
];

export const SHOP = {
  name: 'SWISSA',
  tagline: 'Watch & Opticals',
  address: '29, Bombay Shopping Centre, Nr. Ambedkar Circle, Racecourse, Alkapuri, Vadodara',
};

export const ITEM_TYPES = ['Watch', 'Spectacle', 'Goggle', 'Wall Clock'];

export const ITEM_ICONS: Record<string, string> = {
  'Watch': '⌚', 'Spectacle': '👓', 'Goggle': '🥽', 'Wall Clock': '🕰️',
};

export const DEFAULT_PHRASES: Record<string, string[]> = {
  'Watch': [
    'Battery replacement', 'Glass broken', 'Glass scratched', 'Strap change',
    'Strap repair', 'Machine not working', 'Crown repair', 'Dial repair',
    'Water damage', 'Cleaning & polishing', 'Bezel repair', 'Hand replacement',
    'Service/overhaul', 'Chain repair', 'Buckle repair', 'Running slow',
    'Running fast', 'Stopped working', 'Date not changing',
  ],
  'Spectacle': [
    'Frame broken', 'Frame bent', 'Lens scratched', 'Lens replacement',
    'Nose pad replacement', 'Hinge repair', 'Temple repair', 'Tightening',
    'Cleaning', 'Welding', 'Spring repair', 'Coating peeling',
  ],
  'Goggle': [
    'Lens scratched', 'Lens replacement', 'Frame repair', 'Nose pad change',
    'Cleaning', 'Hinge repair', 'Temple repair',
  ],
  'Wall Clock': [
    'Battery replacement', 'Machine not working', 'Glass broken',
    'Pendulum repair', 'Dial repair', 'Hand replacement', 'Cleaning',
    'Chime repair', 'Cuckoo repair',
  ],
};

/** Visible Job ID prefix for SWISSA REPAIR PRO (stored + displayed everywhere). */
export const JOB_NUMBER_PREFIX = 'M';

/**
 * New jobs: M + 5 random digits (e.g. M48372).
 * Legacy jobs keep their existing numbers unchanged.
 */
export function generateJobNumber(): string {
  const digits = String(Math.floor(10000 + Math.random() * 90000));
  return `${JOB_NUMBER_PREFIX}${digits}`;
}

/** True when value looks like a Pro Job ID (M + exactly 5 digits). */
export function isProJobNumber(value: string | null | undefined): boolean {
  return /^M\d{5}$/i.test(String(value || '').trim());
}

/**
 * Expand a search query so "48372" and "M48372" both find the same job.
 * Five digits alone → also try with M prefix.
 */
export function expandJobNumberSearchTerms(raw: string): string[] {
  const q = String(raw || '').trim();
  if (!q) return [];
  const terms = new Set<string>([q]);
  if (/^\d{5}$/.test(q)) {
    terms.add(`${JOB_NUMBER_PREFIX}${q}`);
  }
  const mMatch = /^m(\d{5})$/i.exec(q);
  if (mMatch) {
    terms.add(mMatch[1]);
    terms.add(`${JOB_NUMBER_PREFIX}${mMatch[1]}`);
  }
  return [...terms];
}

/** Match a stored jobNumber against a user search (digits-only or M-prefixed). */
export function jobNumberMatchesSearch(
  jobNumber: string | null | undefined,
  search: string | null | undefined,
): boolean {
  const jn = String(jobNumber || '').trim();
  const q = String(search || '').trim();
  if (!q) return true;
  if (!jn) return false;
  const jnLower = jn.toLowerCase();
  return expandJobNumberSearchTerms(q).some(term => {
    const t = term.toLowerCase();
    return jnLower === t || jnLower.includes(t);
  });
}

export const DELIVERY_MSG = `*Please collect your belongings within 7 days of this message. We shall not be responsible thereafter.*
*આ સંદેશાના 7 દિવસની અંદર આપનો સામાન લઈ જશો. ત્યાર બાદ અમે જવાબદાર રહીશું નહીં.*
*इस संदेश के 7 दिनों के भीतर अपना सामान ले जाएँ। इसके बाद हम ज़िम्मेदार नहीं होंगे।*`;

export const COMMUNITY_LINK = 'https://chat.whatsapp.com/ELfRzSHDId8LohNOxh0Hit';

/** WhatsApp section divider (same width as job-header rules). */
export const WA_SECTION_DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Community invite footer for WhatsApp messages.
 * @param opts.largePreview When true, uses the real invite URL so WhatsApp shows
 *   the full community photo card. When false (default), softens the URL so receipt
 *   messages stay focused on Job ID / payment without a large preview at the top.
 */
export function formatWhatsAppCommunityFooter(opts?: { largePreview?: boolean }): string {
  const link = opts?.largePreview
    ? COMMUNITY_LINK
    : COMMUNITY_LINK.replace('https://', 'https://\u200B');
  return `${WA_SECTION_DIVIDER}

🤝 *Join our WhatsApp Community*
*Swissa Watch & Opticals*
Exclusive offers, updates & tips
👉 ${link}`;
}

/** @deprecated use formatWhatsAppCommunityFooter() */
export const COMMUNITY_MSG = formatWhatsAppCommunityFooter();

/**
 * Shared WhatsApp greeting + highlighted Job ID for Ready, Receipt, and Delivery messages.
 * Literal `*` characters must remain so WhatsApp renders bold text.
 * Preserves customer-name capitalization; blank name → "Customer".
 */
export function formatWhatsAppCustomerHeader(
  customerName: string | null | undefined,
  jobId: string | number | null | undefined,
): string {
  const name = String(customerName || '').trim() || 'Customer';
  const id = String(jobId ?? '').trim();
  return `Dear *${name}*,

━━━━━━━━━━━━━━━━━━━━━━
📋 *JOB ID: ${id}*
━━━━━━━━━━━━━━━━━━━━━━`;
}

/** Turn multi-line diagnosis/service text into WhatsApp bullet lines. */
export function formatWhatsAppBullets(text: string | null | undefined): string {
  const lines = String(text || '')
    .split('\n')
    .map(l => l.trim().replace(/^[•\-\*]\s*/, ''))
    .filter(Boolean);
  if (!lines.length) return '• —';
  return lines.map(l => `• ${l}`).join('\n');
}

/**
 * Item-wise WhatsApp block — diagnosis & service as bullets, amount on its own line.
 * Job total must NOT appear here (shown once in payment summary).
 */
export function formatWhatsAppItemBreakdown(
  index: number,
  item: {
    itemType: string;
    brand?: string;
    technicianNotes?: string;
    description?: string;
    finalAmount?: number;
    estimatedAmount?: number;
  },
): string {
  const icon = ITEM_ICONS[item.itemType] || '';
  const typeLabel = icon ? `${icon} ${item.itemType}` : item.itemType;
  return `Item ${index} — ${typeLabel}
Technician Diagnosis :
${formatWhatsAppBullets(item.technicianNotes)}

Service Performed :
${formatWhatsAppBullets(item.description)}

Amount : ${formatINR(getItemAmount(item))}`;
}

/** Bold ITEMS FOR REPAIRING heading + one block per item (works for 1–4+ items). */
export function formatWhatsAppItemsRepairedSection(
  items: Array<{
    itemType: string;
    brand?: string;
    technicianNotes?: string;
    description?: string;
    finalAmount?: number;
    estimatedAmount?: number;
  }>,
): string {
  const list = Array.isArray(items) ? items : [];
  const blocks = list.map((item, idx) => formatWhatsAppItemBreakdown(idx + 1, item)).join('\n\n');
  return `*ITEMS FOR REPAIRING*

${blocks || '• —'}`;
}

/** Payment summary — labels bold; amounts aligned after colons. */
export function formatWhatsAppPaymentSummary(
  total: number,
  paid: number,
  balance: number,
): string {
  return `💰 *PAYMENT SUMMARY*

*TOTAL AMOUNT*      : ${formatINR(total)}
*TOTAL PAID*        : ${formatINR(paid)}
*BALANCE PAYABLE*   : ${formatINR(balance)}`;
}

/**
 * READY message payment summary after at least one partial delivery.
 * Shows remaining undelivered items only — not the original full job total.
 */
export function formatWhatsAppRemainingPaymentSummary(
  remainingItemsTotal: number,
  paidTowardsRemaining: number,
  remainingItemsBalance: number,
): string {
  return `💰 *PAYMENT SUMMARY*

*REMAINING ITEMS TOTAL*   : ${formatINR(remainingItemsTotal)}
*PAID TOWARDS REMAINING*  : ${formatINR(paidTowardsRemaining)}
*BALANCE PAYABLE*         : ${formatINR(remainingItemsBalance)}`;
}

/**
 * Full repair-receipt WhatsApp body (after customer header), including thank-you + community invite.
 */
export function formatWhatsAppRepairReceiptBody(opts: {
  receivedDate: string;
  items: Array<{
    itemType: string;
    brand?: string;
    technicianNotes?: string;
    description?: string;
    finalAmount?: number;
    estimatedAmount?: number;
  }>;
  total: number;
  /** Total paid so far (advance allocated + later collections) */
  paid: number;
  balance: number;
  /** @deprecated use paid */
  advance?: number;
}): string {
  const paid = opts.paid ?? opts.advance ?? 0;
  return `*SWISSA WATCH & OPTICALS*

*Repair Receipt*

*Date:*
${opts.receivedDate}

${formatWhatsAppItemsRepairedSection(opts.items)}

${WA_SECTION_DIVIDER}

${formatWhatsAppPaymentSummary(opts.total, paid, opts.balance)}

${WA_SECTION_DIVIDER}

Thank you for visiting Swissa Watch & Opticals.

${formatWhatsAppCommunityFooter()}`;
}

/** @deprecated prefer formatWhatsAppItemBreakdown */
export function formatWhatsAppReceiptItem(
  index: number,
  item: {
    itemType: string;
    brand?: string;
    description?: string;
    status?: string;
    technicianNotes?: string;
    finalAmount?: number;
    estimatedAmount?: number;
  },
): string {
  return formatWhatsAppItemBreakdown(index, item);
}

/**
 * One WhatsApp payment row: bold label (left) + amount (right).
 * Uses figure-space padding (U+2007) — not regular spaces — so columns stay
 * readable in WhatsApp’s proportional fonts.
 */
function formatWhatsAppMoneyRow(label: string, amount: number, labelColWidth: number): string {
  const amt = formatINR(amount);
  const pad = Math.max(2, labelColWidth - label.length);
  return `*${label}*${'\u2007'.repeat(pad)}${amt}`;
}

function formatWhatsAppMoneyRows(rows: Array<{ label: string; amount: number }>): string {
  const labelColWidth = Math.max(22, ...rows.map(r => r.label.length));
  return rows.map(r => formatWhatsAppMoneyRow(r.label, r.amount, labelColWidth)).join('\n');
}

/**
 * Delivery WhatsApp body after item lines.
 * PARTIAL = this delivery only. OVERALL = full job.
 * Advance application is allocation of money already received — not a new payment.
 */
export function formatWhatsAppDeliveryItems(
  delivered: Array<{
    itemType: string;
    amount: number;
    paymentReceived: number;
    outstanding: number;
    alreadyPaid?: number;
  }>,
  partial: {
    selectedItemsTotal: number;
    paymentReceivedNow: number;
    advanceAppliedThisDelivery: number;
    balanceForDeliveredItems: number;
  },
  overall: {
    jobTotal: number;
    /** Original advance collected for the job */
    originalAdvancePaid?: number;
    /** @deprecated use originalAdvancePaid */
    jobAdvancePaid?: number;
    advanceAppliedTotal?: number;
    remainingAdvanceBalance?: number;
    /** Cash/UPI/card collected during deliveries (excludes advance) */
    deliveryCashPaymentsTotal?: number;
    /** @deprecated use deliveryCashPaymentsTotal */
    deliveryPayments?: number;
    totalPaid: number;
    balancePayable: number;
  },
  /** After this delivery — remaining open items (omit on final delivery). */
  remainingAfter?: {
    remainingItemsTotal: number;
    paidTowardsRemaining: number;
    remainingItemsBalance: number;
  } | null,
): string {
  const blocks = delivered.map(d => {
    const icon = ITEM_ICONS[d.itemType] || '';
    const label = icon ? `${icon} ${d.itemType}` : d.itemType;
    return `Item Delivered: ${label}
Amount : ${formatINR(d.amount)}`;
  }).join('\n\n');

  const selectedItemsTotal = Math.max(0, Number(partial.selectedItemsTotal) || 0);
  const paymentReceivedNow = Math.max(0, Number(partial.paymentReceivedNow) || 0);
  const advanceAppliedNow = Math.max(0, Number(partial.advanceAppliedThisDelivery) || 0);
  // Prefer caller-computed balance (accounts for prior item cash + advance).
  const balanceForDeliveredItems = Math.max(
    0,
    Number(partial.balanceForDeliveredItems) >= 0
      ? Number(partial.balanceForDeliveredItems)
      : selectedItemsTotal - advanceAppliedNow - paymentReceivedNow,
  );

  const partialRows = formatWhatsAppMoneyRows([
    { label: 'Delivered Items Total', amount: selectedItemsTotal },
    { label: 'Advance Applied Now', amount: advanceAppliedNow },
    { label: 'Payment Received Now', amount: paymentReceivedNow },
    { label: 'Delivered Items Balance', amount: balanceForDeliveredItems },
  ]);

  const originalAdvance = Math.max(
    0,
    Number(overall.originalAdvancePaid ?? overall.jobAdvancePaid) || 0,
  );
  const advanceUsed = Math.max(0, Number(overall.advanceAppliedTotal) || 0);
  const advanceBalance = Math.max(
    0,
    overall.remainingAdvanceBalance != null
      ? Number(overall.remainingAdvanceBalance) || 0
      : originalAdvance - advanceUsed,
  );
  const deliveryCash = Math.max(
    0,
    Number(overall.deliveryCashPaymentsTotal ?? overall.deliveryPayments) || 0,
  );

  const overallRows = formatWhatsAppMoneyRows([
    { label: 'Job Total', amount: overall.jobTotal },
    { label: 'Original Advance', amount: originalAdvance },
    { label: 'Advance Already Used', amount: advanceUsed },
    { label: 'Advance Balance', amount: advanceBalance },
    { label: 'Delivery Payments', amount: deliveryCash },
    { label: 'Total Paid', amount: overall.totalPaid },
    { label: 'Balance Payable', amount: overall.balancePayable },
  ]);

  const remainingBlock =
    remainingAfter && remainingAfter.remainingItemsTotal > 0.0001
      ? `

${WA_SECTION_DIVIDER}
📋 *REMAINING ITEMS*

${formatWhatsAppMoneyRows([
  { label: 'Remaining Items Total', amount: remainingAfter.remainingItemsTotal },
  { label: 'Paid Towards Remaining', amount: remainingAfter.paidTowardsRemaining },
  { label: 'Balance Payable', amount: remainingAfter.remainingItemsBalance },
])}`
      : '';

  return `${blocks}

${WA_SECTION_DIVIDER}
📦 *PARTIAL DELIVERY SUMMARY*

${partialRows}

${WA_SECTION_DIVIDER}
💰 *OVERALL JOB PAYMENT*

${overallRows}${remainingBlock}

${WA_SECTION_DIVIDER}`;
}

/** Returned / Not Repaired WhatsApp — selected items list only (no delivery language). */
export function formatWhatsAppReturnedItemList(
  items: Array<{ itemNumber: number; itemType: string }>,
): string {
  return items.map(i => {
    const icon = ITEM_ICONS[i.itemType] || '';
    const label = icon ? `${icon} ${i.itemType}` : i.itemType;
    return `Item ${i.itemNumber} — ${label}`;
  }).join('\n');
}


export function getStatusColor(status: string) {
  switch (status) {
    case 'Received':
    case 'Pending':
    case 'Checking':
      // Amber / orange for Received (Records quick status)
      return { bg: C.orange100, text: C.orange800 };
    case 'Not Repaired':
    case 'Returned':
      return { bg: '#FEE2E2', text: C.red };
    case 'Ready':
    case 'Repaired':
    case 'Repaired Reminder':
    case 'Ready for Delivery':
      return { bg: C.green100, text: C.green800 };
    case 'Delivered':
    case 'Completed':
      // Dark blue / grey for Delivered
      return { bg: C.slate100, text: C.slate800 };
    case 'Cancelled': return { bg: '#FEE2E2', text: C.red };
    case 'Under Repair': case 'Approved': return { bg: '#DBEAFE', text: '#1D4ED8' };
    case 'Sent Outside': case 'Parts Pending': return { bg: C.purple100, text: C.purple800 };
    case 'Estimate Pending': case 'Customer Approval Pending': return { bg: C.orange100, text: C.orange800 };
    default: return { bg: C.secondary, text: C.text };
  }
}

export function getOverallStatusColor(status: string) {
  switch (status) {
    case 'Completed': return { bg: C.slate100, text: C.slate800 };
    case 'Ready': return { bg: C.green100, text: C.green800 };
    case 'Partially Ready': return { bg: C.green100, text: C.green800 };
    case 'Partially Delivered': return { bg: '#DBEAFE', text: '#1D4ED8' };
    case 'In Progress': return { bg: C.amber100, text: C.amber800 };
    case 'Cancelled': return { bg: '#FEE2E2', text: C.red };
    default: return { bg: C.secondary, text: C.text };
  }
}
