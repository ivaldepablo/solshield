/**
 * Messaging types for communication between main world (inpage), isolated content script,
 * and service worker. Supports tx, message, and domain checking.
 */

export interface Finding {
  severity: 'low' | 'medium' | 'high' | 'critical';
  ruleId: string;
  message: string;
}

export interface VerdictView {
  kind: 'tx' | 'msg' | 'domain';
  verdict: 'safe' | 'suspicious' | 'danger';
  score: number;
  summary: string;
  findings: Finding[];
  elapsedMs?: number;
  models: string[];
  startedAt: number;
}

// Messages from main world (dapp) to content script
export interface InpageRequest {
  type: 'analyze-tx' | 'analyze-message';
  id: string;
  data: {
    tx?: string; // base64-encoded transaction
    message?: string; // utf8 message text
  };
  timeout?: number; // ms to wait for verdict
}

// Messages from content script back to main world
export interface ContentResponse {
  id: string;
  verdict?: VerdictView;
  error?: string;
  failOpen?: boolean; // if true, caller should proceed despite error
}

// Messages from content script to service worker
export interface BackgroundRequest {
  type: 'inspect-tx' | 'inspect-message' | 'check-domain';
  data: {
    tx?: string; // base64
    message?: string; // utf8
    url?: string;
    encoding?: string;
  };
}

export interface BackgroundResponse {
  verdict?: VerdictView;
  error?: string;
  failOpen?: boolean;
}

/**
 * Generate a correlation ID for matching async request/response pairs.
 * Uses timestamp + random suffix for uniqueness and sortability.
 */
export function newId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
