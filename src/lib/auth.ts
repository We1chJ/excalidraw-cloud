/**
 * OAuth, service-worker side only.
 *
 * chrome.identity is not available to content scripts, so the panel asks the
 * worker to connect and the worker holds the token. Chrome manages refresh; we
 * never see or store a refresh token, and there is no client secret.
 */

export function isConfigured(): boolean {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3 & {
    oauth2?: { client_id: string };
  };
  return Boolean(manifest.oauth2?.client_id);
}

function getToken(interactive: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      // Reading lastError is required; leaving it unread logs a spurious
      // "Unchecked runtime.lastError" for every silent probe.
      if (chrome.runtime.lastError || !token) {
        resolve(null);
        return;
      }
      resolve(typeof token === 'string' ? token : (token as { token: string }).token);
    });
  });
}

/** True when a token can be obtained without showing UI. */
export async function isConnected(): Promise<boolean> {
  if (!isConfigured()) return false;
  return (await getToken(false)) !== null;
}

export async function connect(): Promise<void> {
  if (!isConfigured()) {
    throw new Error(
      'This build has no Google client ID. Add VITE_GOOGLE_CLIENT_ID to .env and rebuild — see docs/google-cloud-setup.md.',
    );
  }
  const token = await getToken(true);
  if (!token) throw new Error('Google sign-in was cancelled or refused.');
}

export async function disconnect(): Promise<void> {
  const token = await getToken(false);
  if (token) {
    await chrome.identity.removeCachedAuthToken({ token });
    // Also revoke, so "Disconnect" actually severs access rather than just
    // forgetting the token locally.
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
  }
}

/**
 * Runs a request with a valid token, retrying once on 401.
 *
 * Chrome caches tokens and hands out expired ones; the documented remedy is to
 * drop the cached token and ask again, exactly once. Retrying more than once
 * turns an auth problem into a request storm.
 */
export async function withToken(
  run: (token: string) => Promise<Response>,
): Promise<Response> {
  const token = await getToken(false);
  if (!token) throw new Error('Not connected to Google Drive.');

  let response = await run(token);
  if (response.status !== 401) return response;

  await chrome.identity.removeCachedAuthToken({ token });
  const fresh = await getToken(false);
  if (!fresh) throw new Error('Google Drive sign-in expired. Reconnect in Settings.');

  response = await run(fresh);
  if (response.status === 401) {
    throw new Error('Google Drive rejected the sign-in. Reconnect in Settings.');
  }
  return response;
}
