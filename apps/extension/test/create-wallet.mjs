/**
 * Create a real Solana wallet (devnet) with seed phrase + keypair.
 * Saves to test/wallet.json so the fake-phantom-ext can use real signatures
 * and so the test runner can request SOL from the faucet.
 */
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import * as bip39 from 'bip39';
import bs58 from 'bs58';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'wallet.json');

// 1. Generate 12-word BIP39 mnemonic and derive a Solana ed25519 keypair from it.
const mnemonic = bip39.generateMnemonic();
const seed = await bip39.mnemonicToSeed(mnemonic);
// Solana uses the first 32 bytes of the seed as the ed25519 secret key.
const seedSlice = new Uint8Array(seed).slice(0, 32);
const keypair = Keypair.fromSeed(seedSlice);

const wallet = {
  network: 'devnet',
  mnemonic,
  publicKey: keypair.publicKey.toBase58(),
  secretKeyBase58: bs58.encode(keypair.secretKey),
  secretKeyBytes: Array.from(keypair.secretKey),
};

writeFileSync(OUT, JSON.stringify(wallet, null, 2));

console.log('=== REAL SOLANA WALLET CREATED ===');
console.log('Network:    ', wallet.network);
console.log('Public Key: ', wallet.publicKey);
console.log('Mnemonic:   ', wallet.mnemonic);
console.log('Saved to:   ', OUT);
console.log('');

// 2. Try to fund it from the public devnet faucet.
console.log('Requesting 1 SOL from devnet faucet…');
try {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  const sig = await conn.requestAirdrop(new PublicKey(wallet.publicKey), 1 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
  const bal = await conn.getBalance(new PublicKey(wallet.publicKey));
  console.log('Balance:    ', bal / LAMPORTS_PER_SOL, 'SOL');
  console.log('Funded ✓');
} catch (err) {
  console.log('Airdrop failed (faucet rate-limit is common):', err.message);
  console.log('Wallet still works for signing tests, just no on-chain balance.');
}
