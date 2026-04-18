// MAIN-world Phantom-clone wallet registration. This file is the heart of the
// FakePhantom extension. It mimics what real Phantom does:
//   1. At document_start, dispatch wallet-standard:register-wallet so any
//      app-loaded later picks us up via its event listener.
//   2. Listen for wallet-standard:app-ready dispatched by dapps using
//      @wallet-standard/app's getWallets(); respond by calling their register.
//   3. Set window.solana and window.phantom.solana for legacy dapps that
//      bypass wallet-standard.
//
// Real Phantom is more complex (deeplinks, real signing, multi-chain) but
// from SolShield's perspective the entry points are identical, so testing
// against this clone gives us high confidence the wrap works on real Phantom.
(function () {
  const callCounts = {};
  // Expose to test runner so it can assert that our wrap held the call.
  window.__fakeWallets = {
    signMessageCalls: (name) => callCounts[name + ':signMessage'] || 0,
    signTransactionCalls: (name) => callCounts[name + ':signTransaction'] || 0,
    totalSignMessageCalls: () => Object.entries(callCounts).filter(([k]) => k.endsWith(':signMessage')).reduce((s, [, v]) => s + v, 0),
    isFake: true,
  };

  const PUBKEY_BYTES = new Uint8Array(32);
  const PUBKEY_BASE58 = '11111111111111111111111111111111';

  function makeAccount(label) {
    return {
      address: PUBKEY_BASE58,
      publicKey: PUBKEY_BYTES,
      chains: ['solana:mainnet', 'solana:devnet'],
      features: ['solana:signMessage', 'solana:signTransaction', 'standard:connect'],
      label,
      icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    };
  }

  function makeWallet(name) {
    const account = makeAccount(name + ' Account');
    return {
      name,
      version: '1.0.0',
      icon: 'data:image/svg+xml;base64,PHN2Zy8+',
      chains: ['solana:mainnet', 'solana:devnet'],
      accounts: [account],
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async () => ({ accounts: [account] }),
        },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (input) => {
            callCounts[name + ':signMessage'] = (callCounts[name + ':signMessage'] || 0) + 1;
            return [{ signedMessage: input.message, signature: new Uint8Array(64) }];
          },
        },
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signTransaction: async (input) => {
            callCounts[name + ':signTransaction'] = (callCounts[name + ':signTransaction'] || 0) + 1;
            return [{ signedTransaction: input.transaction }];
          },
        },
        'solana:signAndSendTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signAndSendTransaction: async () => {
            callCounts[name + ':signTransaction'] = (callCounts[name + ':signTransaction'] || 0) + 1;
            return [{ signature: new Uint8Array(64) }];
          },
        },
      },
    };
  }

  // Test the full Solana wallet ecosystem — Phantom, Solflare, Backpack, Glow
  const wallets = [
    makeWallet('Phantom'),
    makeWallet('Solflare'),
    makeWallet('Backpack'),
    makeWallet('Glow'),
  ];

  // Track which wallet we're representing on legacy globals (Phantom is the
  // primary one, others are wallet-standard only — same as the real ecosystem).
  const primary = wallets[0];

  // === Wallet Standard registration for ALL wallets ===
  // 1. Dispatch register-wallet so any pre-existing dapp listener picks each up.
  for (const w of wallets) {
    const walletCallback = (api) => {
      try {
        api.register(w);
      } catch {}
    };
    try {
      window.dispatchEvent(
        new CustomEvent('wallet-standard:register-wallet', { detail: walletCallback }),
      );
    } catch {}
  }

  // 2. Listen for app-ready events so future dapps can discover all wallets.
  window.addEventListener('wallet-standard:app-ready', (event) => {
    try {
      const detail = event.detail;
      if (detail && typeof detail.register === 'function') {
        for (const w of wallets) detail.register(w);
      }
    } catch {}
  });

  // === Legacy window.solana shim ===
  // Many dapps (especially older ones) read window.solana directly without
  // going through wallet-standard. This must be defined non-configurable to
  // mimic Phantom's behavior exactly.
  const legacyProvider = {
    isPhantom: true,
    isConnected: true,
    publicKey: { toBase58: () => PUBKEY_BASE58, toBytes: () => PUBKEY_BYTES },
    connect: async () => ({ publicKey: PUBKEY_BASE58 }),
    disconnect: async () => {},
    signMessage: async () => {
      callCounts['Phantom:signMessage'] = (callCounts['Phantom:signMessage'] || 0) + 1;
      return { signature: new Uint8Array(64), publicKey: PUBKEY_BASE58 };
    },
    signTransaction: async (tx) => {
      callCounts['Phantom:signTransaction'] = (callCounts['Phantom:signTransaction'] || 0) + 1;
      return tx;
    },
    signAllTransactions: async (txs) => {
      callCounts['Phantom:signTransaction'] = (callCounts['Phantom:signTransaction'] || 0) + txs.length;
      return txs;
    },
  };
  void primary;

  try {
    Object.defineProperty(window, 'solana', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: legacyProvider,
    });
  } catch {}
  try {
    Object.defineProperty(window, 'phantom', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: { solana: legacyProvider },
    });
  } catch {}
})();
