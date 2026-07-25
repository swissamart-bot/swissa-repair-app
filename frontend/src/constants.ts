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

export function generateJobNumber(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
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
 * PARTIAL = selected items only. OVERALL = full job with job-level advance labeled separately.
 * Figures/calculations are unchanged — only labels and row layout are improved.
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
    jobAdvancePaid: number;
    deliveryPayments: number;
    totalPaid: number;
    balancePayable: number;
  },
): string {
  const blocks = delivered.map(d => {
    const icon = ITEM_ICONS[d.itemType] || '';
    const label = icon ? `${icon} ${d.itemType}` : d.itemType;
    return `Item Delivered: ${label}
Amount : ${formatINR(d.amount)}`;
  }).join('\n\n');

  const selectedItemsTotal = delivered.reduce((s, d) => s + Math.max(0, Number(d.amount) || 0), 0);
  const paymentReceivedNow = Math.max(0, Number(partial.paymentReceivedNow) || 0);
  const advanceApplied = Math.max(0, Number(partial.advanceAppliedThisDelivery) || 0);
  const balanceForDeliveredItems = Math.max(
    0,
    selectedItemsTotal - advanceApplied - paymentReceivedNow,
  );

  const partialRows = formatWhatsAppMoneyRows([
    { label: 'Delivered Items Total', amount: selectedItemsTotal },
    { label: 'Payment Received Now', amount: paymentReceivedNow },
    { label: 'Job Advance Applied', amount: advanceApplied },
    { label: 'Delivered Items Balance', amount: balanceForDeliveredItems },
  ]);

  const overallRows = formatWhatsAppMoneyRows([
    { label: 'Job Total', amount: overall.jobTotal },
    { label: 'Job Advance', amount: overall.jobAdvancePaid },
    { label: 'Delivery Payments', amount: overall.deliveryPayments },
    { label: 'Total Paid', amount: overall.totalPaid },
    { label: 'Balance Payable', amount: overall.balancePayable },
  ]);

  return `${blocks}

${WA_SECTION_DIVIDER}
📦 *PARTIAL DELIVERY SUMMARY*

${partialRows}

${WA_SECTION_DIVIDER}
💰 *OVERALL JOB PAYMENT*

${overallRows}

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
