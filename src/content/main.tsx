import { createRoot } from 'react-dom/client';
import css from './panel.css?inline';
import { Panel } from './Panel';

/**
 * Injects the sidebar into excalidraw.com.
 *
 * Everything renders inside a shadow root. excalidraw.com ships a large global
 * stylesheet and so do we; without the shadow boundary the two would leak into
 * each other and the first symptom would be their canvas UI subtly breaking,
 * which is exactly the thing that makes an extension feel like malware.
 */

const HOST_ID = 'excalidraw-cloud-host';

function mount() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  // Attached to documentElement rather than body: excalidraw.com re-renders
  // body content, and a node it does not own can get swept away.
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.append(style);

  const container = document.createElement('div');
  shadow.append(container);

  createRoot(container).render(<Panel />);
}

mount();
