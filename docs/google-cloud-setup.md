# Google Cloud setup

What this produces: an **OAuth client ID** that lets the extension ask a user for
permission to write files into their own Drive.

Before you start, the thing that confuses everyone:

> The Cloud project is an **identity for the app**, not a storage account. Zero
> bytes ever live in it. Every user's drawings go into **their own** Drive, under
> **their own** 15 GB quota, owned by them. You never see their files — the
> access token is issued to the extension running in their browser, and since
> there is no backend, it never reaches any machine of yours.
>
> Users do not create a project, an API key, or anything else. They click
> "Connect Google Drive" and pick an account.
>
> This costs nothing. Drive API calls are free and need no billing account.

---

## Before you begin

You need the extension ID. It is pinned by the public key in
`manifest.config.ts`, so it does not change when the folder moves:

```
ceblkplfjlpkgmioaohkodeibecamilh
```

If you regenerated the key, get your own ID from the extension's options page —
it is shown with a copy button — or from `chrome://extensions`.

---

## 1. Create the project

1. Go to <https://console.cloud.google.com/projectcreate>
2. Name it anything (`excalidraw-cloud` is fine). No organization needed.
3. Create, then make sure it is the selected project in the top bar.

## 2. Enable the Drive API

1. Go to **APIs & Services → Library**
2. Search for **Google Drive API**
3. Click **Enable**

Nothing works without this and the error you get otherwise is unhelpful.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External**. (Internal only exists for Workspace orgs and would
   limit you to your own domain.)
3. Fill in app name, support email, developer contact. These are what users see
   on the consent dialog.
4. On the **Scopes** step, click **Add or remove scopes** and add exactly one:

   ```
   https://www.googleapis.com/auth/drive.file
   ```

   Add nothing else. `drive.file` grants access only to files your app itself
   created — it cannot see the rest of the user's Drive. It is a non-sensitive
   scope, which is what keeps you out of Google's verification review. Adding a
   broader Drive scope changes that and pulls you into a security assessment.

## 4. Publish to Production

**This is the step people skip, and it breaks things a week later.**

On the OAuth consent screen, find **Publishing status** and click
**Publish app** so it reads **In production**.

While an app is in *Testing*, Google expires refresh tokens after **7 days**.
Every user gets silently signed out and has to re-authorize, forever. Production
status removes that limit.

You may see an "unverified app" interstitial that users click through once.
Because `drive.file` is non-sensitive, this should not require a full
verification submission — but confirm the current behavior on your own consent
screen rather than taking this document's word for it, since Google's
verification rules move around. Brand verification (to show a custom name and
logo without the warning) is optional and lightweight.

## 5. Create the OAuth client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Chrome Extension**
3. Item ID: paste the extension ID from above
4. Create, and copy the client ID — it looks like
   `123456789-abcdef.apps.googleusercontent.com`

## 6. Wire it into the build

```bash
cp .env.example .env
```

Then set:

```
VITE_GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
```

Rebuild. The manifest only declares the `identity` permission, the
`googleapis.com` host permission, and the `oauth2` block when this value is
present — so a local-only build never asks for permissions it cannot use.

Confirm it took effect on the extension's options page, which reports whether a
client is configured.

### The client ID is not a secret

Installed applications ship theirs in the bundle by design and there is no client
secret. Committing it is fine. What protects the flow is that Google will only
issue tokens to the extension ID the client is bound to.

---

## Forking

An unpacked fork gets a different extension ID unless it keeps the same public
key in `manifest.config.ts`. If you replace the key, the upstream client ID will
not work for you and you need your own project, following the steps above with
your own ID.

---

## Troubleshooting

**`OAuth2 request failed: Service responded with error: 'bad client id'`**
The client ID in `.env` does not match a credential in the enabled project, or
you rebuilt without the `.env` present.

**`Authorization page could not be loaded`**
Usually the Drive API is not enabled (step 2).

**Consent works, but API calls 403**
Check the scope is exactly `drive.file` and that the Drive API is enabled.

**Users get signed out roughly weekly**
Publishing status is still *Testing*. See step 4.

**`invalid_client` after moving the project folder**
The extension ID changed, which means the public key is missing from
`manifest.config.ts`.
