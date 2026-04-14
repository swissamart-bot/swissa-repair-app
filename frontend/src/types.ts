export interface RepairRecord {
  id: string;
  name: string;
  phone: string;
  countryCode: string;
  item: string;
  issue: string;
  photo: string | null;
  status: 'Pending' | 'Repaired' | 'Delivered';
  date: string;
  repairedAt: string | null;
  deliveredAt: string | null;
}

export interface BackupData {
  version: string;
  timestamp: string;
  records: RepairRecord[];
}
