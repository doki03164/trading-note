# Trading Journal

Cross-platform crypto trading journal for **Windows, macOS, iOS, and Android**. It is a TradeZella-style performance workspace with an original interface and implementation: trade logging, reports, strategy playbooks, chart notes, cloud sync, daily-profit heatmaps, and Bitget account holdings.

## Features

- Binance and Bitget live public market heatmaps.
- Bitget read-only account connection using API key, secret, and passphrase.
- USDT futures equity, available balance, locked margin, and unrealized P&L.
- Current USDT futures contracts with long/short side, quantity, value, and daily P&L.
- Current spot crypto holdings with quantity, price, value, and daily P&L.
- Automatic profit snapshots every five minutes and past heatmap review.
- Encrypted saved Bitget login protected by the user's Trading Journal password.
- **Trading Notes:** upload a chart screenshot, record symbol/market/direction/setup/review, search history, reopen past notes, and delete notes.
- Responsive desktop and phone layouts.
- Searchable Trade Log with automatic net P&L and R-multiple calculations.
- Performance reports for win rate, profit factor, expectancy, equity curve, and strategy results.
- Strategy playbooks with rules and linked-trade performance.
- Optional Supabase online database sync; GitHub stores source code only.

## Data and security

- Use a Bitget API key with **read-only spot and futures account/position permissions**. Do not enable withdrawals.
- Desktop API credentials are encrypted with Argon2 + AES-256-GCM by the Rust backend.
- Mobile saved credentials are encrypted with PBKDF2-SHA-256 + AES-256-GCM before local storage.
- Trading-note screenshots are stored locally in IndexedDB on the current device. They are not uploaded by this project.
- Profit history is stored locally. Desktop uses the Tauri application-data directory; mobile uses the app WebView storage.
- Desktop and mobile installations keep separate local vaults and histories.

## Project structure

```text
src/                         React/TypeScript interface
src/components/TradingNotes.tsx
src/services/accountBridge.ts  Desktop/mobile Bitget bridge
src/services/tradingNotes.ts   IndexedDB note persistence
src-tauri/                   Tauri 2 Windows desktop backend
android/                     Capacitor Android Studio project
ios/                         Capacitor Xcode project
```

## Requirements

All platforms require:

- Node.js 20 or newer
- npm
- Git

Windows desktop additionally requires:

- Rust stable through `rustup`
- Microsoft Visual Studio Build Tools with **Desktop development with C++**
- Microsoft Edge WebView2 Runtime

macOS desktop additionally requires:

- A Mac running macOS
- Xcode Command Line Tools (`xcode-select --install`)

iOS additionally requires:

- A Mac running macOS
- Xcode with iOS platform support
- CocoaPods (`brew install cocoapods`)
- An Apple Account for installation on a physical iPhone

Android additionally requires:

- Android Studio
- JDK 21
- Android SDK and an installed SDK platform

Official prerequisite references: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and [Capacitor documentation](https://capacitorjs.com/docs).

## Clone and install dependencies

```bash
git clone https://github.com/doki03164/trading-note.git
cd trading-note
npm ci
```

## Run tests

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## Run the web preview

```bash
npm run dev
```

Open the local URL printed by Vite. The web preview supports public heatmaps and Trading Notes. Native iOS/Android containers use Capacitor HTTP for signed account requests.

## Build and install Windows desktop

Development:

```powershell
npm.cmd run desktop:dev
```

Production installers:

```powershell
npm.cmd run desktop:build
```

Tauri writes packages under:

```text
src-tauri/target/release/bundle/
```

Run the generated `.exe` or `.msi` installer. If Windows reports a missing WebView runtime, install the Microsoft Edge WebView2 Evergreen Runtime.

## Build and install macOS desktop

On a Mac with Xcode Command Line Tools installed:

```bash
git clone https://github.com/doki03164/trading-note.git
cd trading-note
npm ci
npm run desktop:build -- --bundles dmg
```

The DMG is created under `src-tauri/target/release/bundle/dmg/`. Open it and drag **Trading Journal** into Applications. Public GitHub builds are unsigned, so the first launch may require Control-clicking the app and choosing **Open**. Apple Developer signing and notarization are used for wider distribution.

## Build and install Android

1. Install Android Studio, JDK 21, and the Android SDK.
2. Set `JAVA_HOME` and `ANDROID_HOME` for your installation.
3. Synchronize the current web build into Android:

```bash
npm run mobile:sync
npm run android:open
```

4. In Android Studio, allow Gradle sync to finish.
5. Select a connected Android phone or emulator and press **Run**.

Build a debug APK from the command line:

```bash
cd android
./gradlew assembleDebug          # macOS/Linux
gradlew.bat assembleDebug        # Windows
```

Debug APK location:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

For Google Play, create a signing key in Android Studio and use **Build ??Generate Signed Bundle / APK ??Android App Bundle**.

## Build and install iOS

The iOS build and signing steps run on a Mac:

```bash
npm ci
npm run mobile:sync
cd ios/App
pod install
open App.xcworkspace
```

In Xcode:

1. Select the **App** project and **App** target.
2. Open **Signing & Capabilities**.
3. Enable **Automatically manage signing**.
4. Choose your Apple development team.
5. If `com.pulsegrid.app` is already registered, choose a unique bundle identifier.
6. Connect an iPhone, enable Developer Mode on it, choose it as the run destination, and press **Run**.

For TestFlight or the App Store, choose a generic iOS device, select **Product ??Archive**, and distribute the archive through App Store Connect.

## Refresh native projects after frontend changes

Every time React/CSS assets change, run:

```bash
npm run mobile:sync
```

This runs the production web build and copies it into both `android/` and `ios/`.

## Bitget API setup

Create a Bitget API key and enable read access for:

- Spot account assets
- Futures account information
- Futures holdings/positions
- Futures account bills/history

Enter the API key, API secret, and Bitget API passphrase in **Connect Bitget**. The app performs no trading or withdrawal commands.

Both Bitget Classic Account (`/api/v2/mix`) and Unified Trading Account (`/api/v3`) open-position APIs are supported. If both APIs reject the request, Trading Journal displays the permission error instead of silently showing an empty contract list.

## Trading Notes workflow

1. Open **Trading Notes** from the navigation bar.
2. Select **New trading note**.
3. Upload a PNG, JPEG, WEBP, or GIF chart screenshot up to 15 MB.
4. Add the symbol, trade date, market, direction, setup, and review text.
5. Save the note.
6. Use Trading Note History to search and review previous screenshots.

## Online database and cross-device sync

Optional cloud sync uses **Supabase PostgreSQL**, Auth, Row Level Security, and private Storage. GitHub stores source code and releases only.

1. Create a Supabase project.
2. Run `supabase/migrations/001_cloud_journal.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env`.
4. Add the project values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

5. Rebuild the application.
6. Open **Cloud**, create an account or sign in, then select **Sync now**.

The supplied RLS policies restrict every journal row and screenshot to its authenticated owner. Keep the Supabase service-role key outside the app.

## Useful commands

```bash
npm run dev             # Vite development server
npm test                # Vitest regression tests
npm run build           # TypeScript + production web build
npm run desktop:dev     # Tauri desktop development
npm run desktop:build   # Tauri desktop package
npm run mobile:sync     # Build and sync Android/iOS assets
npm run android:open    # Open Android Studio
npm run ios:open        # Open Xcode on macOS
```

## Troubleshooting

- **Bitget connection error:** verify the key, secret, API passphrase, IP whitelist, and read permissions.
- **Empty futures balance:** enable futures account and holdings read permissions.
- **Can't connect to Binance API:** check internet, DNS, firewall, and regional API availability, then retry. The heatmap remains empty rather than displaying generated market data.
- **Cloud not configured:** create `.env` from `.env.example`, apply the Supabase migration, and rebuild.
- **Android Gradle reports Java missing:** install JDK 21 and set `JAVA_HOME`.
- **Android SDK not found:** set `ANDROID_HOME` or create `android/local.properties` with `sdk.dir=...`.
- **iOS CocoaPods error:** run `pod repo update`, followed by `pod install` inside `ios/App`.
- **Notes missing after reinstall:** notes live in device-local application storage; uninstalling or clearing app data removes that local history.
