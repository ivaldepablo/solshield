/**
 * Mount a React element into a shadow DOM attached to a host element.
 * Returns an unmount function for cleanup.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

export function mountInShadow(
  host: HTMLElement,
  element: React.ReactElement
): () => void {
  // closed mode: dapp page scripts cannot read host.shadowRoot to inspect or
  // tamper with overlay DOM. Lost inspector access is acceptable — we ship
  // /diagnostic for our own debugging.
  const shadow = host.attachShadow({ mode: 'closed' });

  const container = document.createElement('div');
  container.id = 'solshield-root';
  shadow.appendChild(container);

  const root = createRoot(container);
  root.render(element);

  return () => {
    root.unmount();
    container.remove();
  };
}
