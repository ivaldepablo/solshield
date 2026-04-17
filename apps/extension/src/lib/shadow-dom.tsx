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
  // Attach shadow root in open mode for inspector access
  const shadow = host.attachShadow({ mode: 'open' });

  // Create a div to mount React into
  const container = document.createElement('div');
  container.id = 'solshield-root';
  shadow.appendChild(container);

  // Render React component
  const root = createRoot(container);
  root.render(element);

  // Return unmount function
  return () => {
    root.unmount();
    container.remove();
  };
}
