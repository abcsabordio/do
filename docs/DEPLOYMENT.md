# Deploying

The app is a static website (the `dist` folder) that talks to Supabase. Put it
on any static host with **https**, then optionally wrap it as an Android APK.

## 1. Website (Vercel, free)

1. Push the project to GitHub. `.env.local` is git-ignored, so keys stay on your PC.
2. [vercel.com](https://vercel.com) → **Add New → Project** → pick the repo.
   Vercel detects Vite (build `npm run build`, output `dist`).
3. **Environment Variables:** add the public ones only:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | from `.env.local` |
   | `VITE_SUPABASE_ANON_KEY` | from `.env.local` |
   | `VITE_VAPID_PUBLIC_KEY` | from `.env.local` |
   | `VITE_TURNSTILE_SITE_KEY` | optional, see [README → Security](../README.md#captcha-optional) |

   **Never** add `VAPID_PRIVATE_KEY` or `CRON_SECRET` to the host: they live in
   Supabase secrets.
4. **Deploy.** You get an address like `https://todo-app-xyz.vercel.app`.
5. In Supabase → **Authentication → URL Configuration**:
   - **Site URL** = that address
   - **Redirect URLs**: add the address and `http://localhost:5173`

   Without this, email links and Google sign-in send people to the wrong place.

Every push to GitHub redeploys automatically.

## 2. Install on phones (no store)

- **Android (Chrome):** open the site → menu → **Install app**.
- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.

The app opens full-screen with its own icon, and notifications work (iPhone:
only when opened from the Home Screen icon).

## 3. Android APK (PWABuilder)

1. [pwabuilder.com](https://www.pwabuilder.com) → enter your site address.
2. **Package for stores → Android → Generate package.** Check the name is "To Do".
3. The zip contains:
   - **`.apk`**: install on phones or share.
   - **`.aab`**: for Google Play ($25 one-time developer account).
   - **`signing.keystore`** plus its passwords: **back these up**. You need them
     for every future update. Don't commit them (`.gitignore` already blocks `*.keystore`).
   - **`assetlinks.json`**: needed for step 4.
4. **Remove the address bar** (see [below](#removing-the-address-bar)).
5. On the phone, open the `.apk` and allow installs from that source.

### Removing the address bar

**What you'll see without this:** the app opens with a thin Chrome bar at the
top showing your website address, like a browser tab.

**Why:** Android only hides that bar once your website confirms "this app
belongs to me". `assetlinks.json` is that confirmation. Android downloads it
from your site and compares it with the app's signing key.

**Steps**

1. In the project, create a folder named `.well-known` inside `public`
   (the dot at the start matters):

   ```
   public/
     .well-known/
       assetlinks.json    ← the file from the PWABuilder zip, unchanged
   ```

   Command Prompt, from the project folder:

   ```cmd
   mkdir public\.well-known
   copy "C:\path\to\pwabuilder-zip\assetlinks.json" public\.well-known\
   ```

2. Commit and push. Vercel redeploys on its own in about a minute.

   ```cmd
   git add public/.well-known/assetlinks.json
   git commit -m "Add Android asset links"
   git push
   ```

3. **Check it's live:** open `https://YOUR-SITE/.well-known/assetlinks.json`
   in a browser. You should see a few lines of text starting with `[{"relation"`.
   If you get a 404 page instead, the file is in the wrong folder.

4. **On the phone:** uninstall the app, then install the `.apk` again. Android
   checks the file when the app is installed, so an app that was already
   installed keeps the bar.

**Still seeing the bar?**

| Cause | Fix |
|---|---|
| The page in step 3 shows 404 | The path must be exactly `public/.well-known/assetlinks.json`. |
| The file was edited, or comes from a different PWABuilder package | Use the `assetlinks.json` from the **same** zip as the `.apk`. Each package is signed with its own key. |
| The app was installed before the file went live | Uninstall and reinstall the app. |
| Installed from **Google Play** | Play re-signs apps with its own key. In Play Console → **App integrity**, copy the **SHA-256 certificate fingerprint**, add it to the `sha256_cert_fingerprints` list in `assetlinks.json`, then push again. |

The APK loads your live site, so updates to the website reach the app without
rebuilding it.

## 4. App Store / Play Store as a native app

For a native build (for example with [Capacitor](https://capacitorjs.com)), three
things change: web push doesn't work inside native apps (use
`@capacitor/local-notifications`), Google blocks sign-in inside embedded web
views (open it in the system browser and return with a deep link), and iOS builds
need a Mac with Xcode plus a $99/year Apple developer account.
