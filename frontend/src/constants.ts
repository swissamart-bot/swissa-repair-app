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
export const COMMUNITY_MSG = `🤝 Join our *Swissa Watch & Opticals* WhatsApp community for exclusive offers, updates & tips!\n👉 ${COMMUNITY_LINK}`;

export function getStatusColor(status: string) {
  switch (status) {
    case 'Received': return { bg: C.amber100, text: C.amber800 };
    case 'Ready': return { bg: C.green100, text: C.green800 };
    case 'Delivered': return { bg: C.slate100, text: C.slate800 };
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
    case 'Partially Delivered': return { bg: '#DBEAFE', text: '#1D4ED8' };
    case 'In Progress': return { bg: C.amber100, text: C.amber800 };
    case 'Cancelled': return { bg: '#FEE2E2', text: C.red };
    default: return { bg: C.secondary, text: C.text };
  }
}
