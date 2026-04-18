// ISOLATED-world content script. Real Phantom uses MAIN-world content script
// directly, but loading via <script src> from web_accessible_resources is the
// safer pattern that bypasses any CSP issues. Either way, what matters is the
// inject.js code runs in the MAIN world at document_start.
const s = document.createElement('script');
s.src = chrome.runtime.getURL('inject.js');
s.onload = () => s.remove();
(document.head || document.documentElement).prepend(s);
