export type PinStatusValue = 'queued' | 'pinning' | 'pinned' | 'failed';

export interface Pin {
  cid: string;
  name?: string;
  origins?: string[];
  meta?: Record<string, string>;
}

export interface StoredPinRecord {
  requestid: string;
  cid: string;
  name: string | null;
  status: PinStatusValue;
  origins: string[];
  meta: Record<string, string>;
  delegates: string[];
  info: Record<string, unknown>;
  owner: string;
  created: string;
  updated: string;
  expires_at: string | null;
}

export interface PinStatusResponse {
  requestid: string;
  status: PinStatusValue;
  created: string;
  pin: Pin;
  delegates: string[];
  info: Record<string, unknown>;
}

export interface PinResultsResponse {
  count: number;
  results: PinStatusResponse[];
}
