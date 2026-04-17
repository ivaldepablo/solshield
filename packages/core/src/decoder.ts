import type { DecodedTransaction, AddressTableLookup } from './types';

const SIG_LEN = 64;
const KEY_LEN = 32;
const HASH_LEN = 32;
const V_PREFIX_MASK = 0x80;

class Reader {
  private offset = 0;
  constructor(private readonly buf: Uint8Array) {}

  u8(): number {
    if (this.offset >= this.buf.length) throw new Error('unexpected end of input');
    return this.buf[this.offset++]!;
  }

  peek(): number {
    if (this.offset >= this.buf.length) throw new Error('unexpected end of input');
    return this.buf[this.offset]!;
  }

  bytes(n: number): Uint8Array {
    if (this.offset + n > this.buf.length) throw new Error('unexpected end of input');
    const out = this.buf.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  shortU16(): number {
    let value = 0;
    let shift = 0;
    for (let i = 0; i < 3; i++) {
      const b = this.u8();
      value |= (b & 0x7f) << shift;
      if ((b & V_PREFIX_MASK) === 0) return value;
      shift += 7;
    }
    throw new Error('compact-u16 exceeds 3 bytes');
  }

  array<T>(read: () => T): T[] {
    const n = this.shortU16();
    const out: T[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = read();
    return out;
  }

  remaining(): number {
    return this.buf.length - this.offset;
  }
}

export function decode(wire: Uint8Array): DecodedTransaction {
  const r = new Reader(wire);
  const signatures = r.array(() => r.bytes(SIG_LEN));

  let version: 'legacy' | 0 = 'legacy';
  if ((r.peek() & V_PREFIX_MASK) !== 0) {
    const v = r.u8() & 0x7f;
    if (v !== 0) throw new Error(`unsupported transaction version: ${v}`);
    version = 0;
  }

  const header = {
    numRequiredSignatures: r.u8(),
    numReadonlySignedAccounts: r.u8(),
    numReadonlyUnsignedAccounts: r.u8(),
  };
  const accountKeys = r.array(() => r.bytes(KEY_LEN));
  const recentBlockhash = r.bytes(HASH_LEN);
  const instructions = r.array(() => ({
    programIdIndex: r.u8(),
    accounts: r.array(() => r.u8()),
    data: r.bytes(r.shortU16()),
  }));

  const addressTableLookups: AddressTableLookup[] =
    version === 0
      ? r.array(() => ({
          accountKey: r.bytes(KEY_LEN),
          writableIndexes: r.array(() => r.u8()),
          readonlyIndexes: r.array(() => r.u8()),
        }))
      : [];

  return {
    signatures,
    message: {
      version,
      header,
      accountKeys,
      recentBlockhash,
      instructions,
      addressTableLookups,
    },
  };
}

export function decodeBase64(input: string): DecodedTransaction {
  const bytes = Uint8Array.from(Buffer.from(input, 'base64'));
  return decode(bytes);
}
