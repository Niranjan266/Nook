# Nook — mobile

The React Native app, built with Expo. Same API, same account, same data as the web app.

---

## Run it

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** ([iOS](https://apps.apple.com/app/expo-go/id982107779) · [Android](https://play.google.com/store/apps/details?id=host.exp.exponent)).

**The server must be running too** (`npm run dev:server` from the project root, or `Nook.bat`).

### Finding the server from your phone

`localhost` on your phone means *the phone*, not your laptop — this is the single most common reason a new React Native app can't reach its API. The app handles it automatically: it reads the LAN address from the Expo packager and points at `http://<your-laptop-ip>:4000`.

If your network blocks that, set it explicitly:

```bash
# mobile/.env
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000
```

Your laptop and phone must be on the same Wi-Fi.

---

## What's in it

Everything the web app has, except calls:

- **Auth** — the Front Door, with the session in the device keychain
- **Chats** — list with folders, search, unread, presence, typing
- **Conversation** — bubbles, day markers, receipts, reply quotes, media, link previews
- **Swipe to reply** — a real pan gesture on the UI thread via Reanimated
- **Long-press** — reactions, thread, star, pin, delete
- **Voice notes** — record, waveform, playback speed, transcript
- **Media** — camera, library, documents, snaps
- **Threads** — the same one-level side-threads
- **Rooms** — mood, wallpaper, per-person sound, conversation prefs
- **Push** — Expo notifications, one Android channel per tone
- **Quiet hours**, read receipts, accent colour, sign out

### Calls need a dev build

WebRTC needs a native module (`react-native-webrtc`) which **cannot run in Expo Go**. The call screens are in place and the signalling works — to actually connect audio and video:

```bash
npx expo install react-native-webrtc
npx expo prebuild
npx expo run:android      # or run:ios
```

That produces a custom dev client. Everything else keeps working in Expo Go, which is why calls were left out of the default build rather than breaking the "scan a QR code and it runs" path.

---

## Building an installable app

```bash
npm install -g eas-cli
eas login
eas build:configure
```

Set your real API URL in `eas.json` (all three profiles), then:

```bash
eas build --platform android --profile preview   # → an APK you can sideload
eas build --platform ios --profile preview       # → needs an Apple Developer account
```

---

## How the design system was ported

React Native has no dual shadows, no inset shadows, and no `box-shadow: 4px 4px 0`. So:

- **Clay** — one soft shadow plus a hairline top highlight. Reads as the same material without pretending the platform has features it doesn't.
- **Sunken surfaces** — a darker fill and a top border instead of an inset shadow, which is what an inset shadow mostly communicates anyway.
- **Slab** — the hard offset shadow is a second view positioned behind the button. Pressing still moves the button onto its own shadow, because that physicality is the whole point of the language.
- **Fonts** — system faces rather than the web's three custom families. Bundling them would add megabytes to the download for a difference few people consciously notice on a phone.
- **Wallpapers** — gradients rather than the CSS radial-gradient presets. The drifting blob field on the sign-in screen became a static gradient: animating four large blurred shapes at 60fps is fine on a desktop GPU and a battery drain on a phone.

---

## Notes worth knowing

- **The session lives in the keychain.** A phone can't use httpOnly cookies, so the refresh token is stored with `expo-secure-store` (Keychain on iOS, EncryptedSharedPreferences on Android) and sent explicitly. The server tells web and native apart with an `x-nook-client` header and only ever hands the refresh token to native.
- **Coming back from the background re-syncs.** The OS can kill a socket while the app is suspended, so on resume the app reconnects and refetches rather than trusting stale state.
- **No unread badge on the app icon by default** — the same anti-engagement stance as the web app.
- **`expo-av` sounds are unloaded on unmount.** Skip that and Android eventually runs out of audio players and voice notes go silent.
