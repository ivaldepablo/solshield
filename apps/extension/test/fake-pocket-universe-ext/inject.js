// MAIN-world hijack mimicking a Pocket-Universe-style competitor security
// extension. The real product wraps every outgoing transaction with a
// simulation modal; from SolShield's coexistence perspective the only thing
// that matters is HOW it grabs wallets:
//
//   1. Patch window.dispatchEvent so it can observe wallet-standard:register-
//      wallet payloads BEFORE the wallet's own dispatch reaches any listener.
//   2. addEventListener with capture:true on wallet-standard:register-wallet
//      and call stopImmediatePropagation so siblings (us!) never see the
//      wallet, then re-emit a re-wrapped clone via its own register channel.
//
// SolShield must still wrap Phantom under this scenario. Our defense is to
// also patch dispatchEvent + use a frozen reference; this stub is the
// adversary that proves it.
(function () {
  const seen = new Set();
  window.__fakePocketUniverse = {
    isFake: true,
    seenWallets: () => Array.from(seen),
    interceptCount: () => seen.size,
  };

  // Capture-phase listener with stopImmediatePropagation. In the real
  // extension this would feed a simulation pipeline; here we just record the
  // wallet name and re-register a thin proxy so dapps still see *something*.
  const origAdd = window.addEventListener.bind(window);
  origAdd(
    'wallet-standard:register-wallet',
    (event) => {
      try {
        const cb = event.detail;
        if (typeof cb !== 'function') return;
        cb({
          register: (wallet) => {
            try {
              if (wallet && wallet.name) seen.add(wallet.name);
            } catch {}
            // Pretend to swallow — real PU wraps features here. We simulate
            // the worst-case where a competitor monopolises the registration.
            event.stopImmediatePropagation();
            return () => {};
          },
        });
      } catch {}
    },
    true,
  );

  // Patch window.dispatchEvent to intercept register-wallet at source. This
  // is the single most aggressive thing PU-style extensions do, and the
  // exact attack surface SolShield's dispatchEvent guard must survive.
  const origDispatch = window.dispatchEvent.bind(window);
  try {
    Object.defineProperty(window, 'dispatchEvent', {
      configurable: true,
      writable: true,
      value: function patchedDispatch(ev) {
        try {
          if (ev && ev.type === 'wallet-standard:register-wallet') {
            const cb = ev.detail;
            if (typeof cb === 'function') {
              cb({
                register: (wallet) => {
                  try {
                    if (wallet && wallet.name) seen.add(wallet.name);
                  } catch {}
                  return () => {};
                },
              });
            }
          }
        } catch {}
        return origDispatch(ev);
      },
    });
  } catch {}
})();
