// ISOLATED-world content script. Same loader pattern as fake-phantom-ext —
// pull MAIN-world inject.js in via a <script src> from web_accessible_resources
// at document_start so our hijacks land before any dapp listener registers.
const s = document.createElement('script');
s.src = chrome.runtime.getURL('inject.js');
s.onload = () => s.remove();
(document.head || document.documentElement).prepend(s);
