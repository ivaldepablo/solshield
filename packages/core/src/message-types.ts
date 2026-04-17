import type { Finding } from './types';

export interface SignMessageInspection {
  /** raw bytes of the message being signed */
  rawBytes: Uint8Array;
  /** utf8 decoded text if possible, else undefined */
  decodedText?: string;
  /** the user-stated purpose, from dapp (e.g., "Sign in to Jupiter") */
  claimedPurpose?: string;
  /** origin of the dapp requesting signature (https://jup.ag) */
  origin?: string;
  /** current timestamp */
  now: Date;
}

export interface MessageRule {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evaluate(msg: SignMessageInspection): Finding[] | Promise<Finding[]>;
}
