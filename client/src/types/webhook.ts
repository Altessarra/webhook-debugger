export type CapturedRequest = {
  id: string;
  inboxId?: string;
  inbox_id?: string;
  method: string;
  path: string;
  headers: string;
  body: string | null;
  query: string;
  createdAt?: number;
  created_at?: number;
};

export type RequestHistoryResponse = {
  requests: CapturedRequest[];
  nextCursor: string | null;
};

export type ConnectionState = "connecting" | "connected" | "disconnected";
export type CopyTarget = "url" | "curl" | "generic" | null;
