# automatic-happiness

## Installation

```bash
bash install.sh
```

The install script performs the repository setup currently required for this
project and exits successfully when no additional dependencies are needed.

---

## Colonies – Android App

The `colonies/` web game is packaged as an Android app using
[Capacitor](https://capacitorjs.com).

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- [Android Studio](https://developer.android.com/studio) with Android SDK API 34+
- Java 17+

### Setup

Install JavaScript dependencies and sync web assets into the Android project:

```bash
npm install
npx cap sync android
```

### Build & run

**Open in Android Studio** (recommended):

```bash
npx cap open android
```

Android Studio will handle the Gradle build, emulator, and device deployment.

**Build a debug APK from the command line:**

```bash
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

**Build a release AAB for Play Store submission:**

```bash
cd android
./gradlew bundleRelease
# Output: android/app/build/outputs/bundle/release/app-release.aab
```

> Sign the AAB with your upload keystore before uploading to Google Play.
> See the [Android signing docs](https://developer.android.com/studio/publish/app-signing)
> for instructions.

### Update web assets

After editing files in `colonies/`, re-sync them to the Android project:

```bash
npx cap sync android
```

---

## TraderView – Stock Trading Platform

A paper (simulated) stock trading platform in `tradingview/`. Open
`tradingview/index.html` directly in any modern browser — no build step needed.

### Features

- **Candlestick chart** with SMA-20, SMA-50 overlays, volume bars, and crosshair tooltip
- **Timeframes**: 1m · 5m · 15m · 1h · 1d
- **Live ticks**: prices update every few seconds via simulation (or real quotes via Finnhub / Coinbase)
- **Watchlist**: add any ticker symbol, mini sparklines, real-time P&L colour coding
- **Order entry**: market and limit orders (buy/sell) with cost preview and validation
- **Portfolio**: $100,000 virtual starting cash, open positions table with live P&L
- **Trade history**: full log of executed orders
- **Persistent state**: portfolio and API key saved in `localStorage`

### Quick start

```bash
# Just open the file in a browser
open tradingview/index.html
# or
python3 -m http.server 8080   # then visit http://localhost:8080/tradingview/
```

### Live market data

**Crypto symbols** (BTC, ETH, LTC, SOL, DOGE, XRP, ADA, AVAX, MATIC, DOT) are automatically
priced in real-time using the **[Coinbase Exchange public API](https://docs.cdp.coinbase.com/exchange/reference/)**
— no API key or account required.  A **₿ Coinbase Live** badge is shown in the top bar whenever
a crypto symbol is selected.

**Stock symbols** use simulated data by default. To enable real-time stock quotes:

1. Get a free API key at [finnhub.io](https://finnhub.io)
2. Paste it into the **Finnhub API key** field in the top bar and click **Save Key**
3. The status indicator changes from 🟡 Simulated → 🟢 Finnhub Live

Without a Finnhub key, stock symbols run on simulated price data.
