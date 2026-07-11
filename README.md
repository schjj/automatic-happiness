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
