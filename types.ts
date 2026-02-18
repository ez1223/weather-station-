
export interface ThingSpeakFeed {
  created_at: string;
  entry_id: number;
  field1: string; // Temperature
  field2: string; // Humidity
}

export interface ThingSpeakChannel {
  id: number;
  name: string;
  description: string;
  latitude: string;
  longitude: string;
  field1: string;
  field2: string;
  created_at: string;
  updated_at: string;
  last_entry_id: number;
}

export interface ThingSpeakResponse {
  channel: ThingSpeakChannel;
  feeds: ThingSpeakFeed[];
}

export interface Alert {
  id: string;
  type: 'danger' | 'warning' | 'info';
  title: string;
  description: string;
  timestamp: Date;
  active: boolean;
  status?: 'active' | 'acknowledged';
  key?: string; // e.g. 'th', 'tl', 'hh', 'hl'
}

export type TimeRange = '24h' | '7d' | '30d';

export type UserRole = 'admin' | 'viewer';

export interface UserProfile {
  id: string;
  email: string | null;
  role: UserRole;
}

export interface AuditLog {
  id: string;
  action: string;
  user_id: string;
  user_email: string;
  timestamp: string;
}

export interface Thresholds {
  tempHigh: number;
  tempLow: number;
  humHigh: number;
  humLow: number;
}
