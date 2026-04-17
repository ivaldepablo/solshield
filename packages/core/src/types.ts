export type Verdict = 'safe' | 'suspicious' | 'danger';

export interface Finding {
  ruleId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  instructionIndex?: number;
  details?: Record<string, unknown>;
}

export interface ThreatReport {
  verdict: Verdict;
  score: number;
  findings: Finding[];
  summary: string;
  elapsedMs?: number;
}

export interface DecodedTransaction {
  signatures: Uint8Array[];
  message: DecodedMessage;
}

export interface DecodedMessage {
  version: 'legacy' | 0;
  header: MessageHeader;
  accountKeys: Uint8Array[];
  recentBlockhash: Uint8Array;
  instructions: DecodedInstruction[];
  addressTableLookups: AddressTableLookup[];
}

export interface MessageHeader {
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
}

export interface DecodedInstruction {
  programIdIndex: number;
  accounts: number[];
  data: Uint8Array;
}

export interface AddressTableLookup {
  accountKey: Uint8Array;
  writableIndexes: number[];
  readonlyIndexes: number[];
}

export interface InspectionContext {
  tx: DecodedTransaction;
  network: 'mainnet' | 'devnet';
  now: Date;
}

export interface Rule {
  id: string;
  severity: Finding['severity'];
  description: string;
  evaluate(ctx: InspectionContext): Finding[] | Promise<Finding[]>;
}
