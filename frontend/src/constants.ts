export const C = {
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  primary: '#0A0A0A',
  primaryFg: '#FFFFFF',
  secondary: '#F1F5F9',
  secondaryFg: '#0F172A',
  border: '#E2E8F0',
  text: '#0A0A0A',
  textMuted: '#64748B',
  whatsapp: '#25D366',
  whatsappDark: '#1DA851',
  amber100: '#FEF3C7',
  amber800: '#92400E',
  green100: '#DCFCE7',
  green800: '#166534',
  slate100: '#F1F5F9',
  slate800: '#334155',
  red: '#DC2626',
  blue: '#2563EB',
};

export const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳' },
  { code: '+971', flag: '🇦🇪' },
  { code: '+1', flag: '🇺🇸' },
  { code: '+44', flag: '🇬🇧' },
  { code: '+61', flag: '🇦🇺' },
  { code: '+65', flag: '🇸🇬' },
  { code: '+60', flag: '🇲🇾' },
  { code: '+966', flag: '🇸🇦' },
  { code: '+974', flag: '🇶🇦' },
  { code: '+968', flag: '🇴🇲' },
  { code: '+973', flag: '🇧🇭' },
  { code: '+965', flag: '🇰🇼' },
  { code: '+92', flag: '🇵🇰' },
  { code: '+880', flag: '🇧🇩' },
  { code: '+94', flag: '🇱🇰' },
  { code: '+977', flag: '🇳🇵' },
  { code: '+64', flag: '🇳🇿' },
  { code: '+49', flag: '🇩🇪' },
  { code: '+33', flag: '🇫🇷' },
  { code: '+39', flag: '🇮🇹' },
  { code: '+34', flag: '🇪🇸' },
  { code: '+81', flag: '🇯🇵' },
  { code: '+82', flag: '🇰🇷' },
  { code: '+86', flag: '🇨🇳' },
];

export const SHOP = {
  name: 'SWISSA',
  tagline: 'Watch & Opticals',
  address: '29, Bombay Shopping Centre, Nr. Ambedkar Circle, Racecourse, Alkapuri, Vadodara',
};

export const ITEM_TYPES = [
  { key: 'Watch', icon: '⌚', label: 'Watch' },
  { key: 'Spectacle', icon: '👓', label: 'Spectacle' },
  { key: 'Goggle', icon: '🥽', label: 'Goggle' },
];

export const DELIVERY_MSG = `"Dear Customer,
Thank you for choosing Swissa Watch and Opticals. We request you to please collect your belongings within 7 days. After this time, we may not be in a position to take responsibility. Your understanding is highly appreciated."

"પ્રિય ગ્રાહક,
Swissa Watch and Opticals પસંદ કરવા બદલ આભાર. આપને વિનંતી છે કે કૃપા કરીને 7 દિવસની અંદર આપનો સામાન લઈ જશો. આ સમય બાદ, અમે તેની જવાબદારી લેવા માટે સક્ષમ નહીં હોઈએ. આપના સહકાર બદલ આભાર."

"प्रिय ग्राहक,
Swissa Watch and Opticals को चुनने के लिए धन्यवाद। आपसे अनुरोध है कि कृपया 7 दिनों के भीतर अपना सामान ले जाएँ। इसके बाद, हम इसकी ज़िम्मेदारी लेने में सक्षम नहीं होंगे। आपके सहयोग के लिए धन्यवाद।"`;

export function generateJobId(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}
