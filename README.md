# NeoNexus User App (Mac)

Standalone user desktop app repository for macOS testing.

## Backend Connection
This app is already configured to use hosted backend API:

- `VITE_BACKEND_URL=http://187.77.189.99/neonexus-api`

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Run app in development:

```bash
npm run dev
```

## Build on macOS (Test, unsigned)

Run these on a Mac machine:

```bash
npm install
npm run build
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run dist:mac:test
```

Generated DMG is placed in `release/`.

## Build on macOS (Production, signed)

1. Configure Apple signing/notarization environment variables.
2. Build:

```bash
npm install
npm run dist:mac
```

## Runtime Permissions on macOS
After first launch, allow:

1. Microphone
2. Screen Recording

Without these permissions, live transcript/help features can fail or be partial.

## Already Configured for macOS

This repository already includes macOS compatibility settings for media features:

1. Electron Builder `mac` target (`dmg`, `x64`, `arm64`)
2. `NSMicrophoneUsageDescription` in app metadata
3. `NSScreenCaptureDescription` in app metadata
4. Hardened runtime + entitlements files:
	1. `build/entitlements.mac.plist`
	2. `build/entitlements.mac.inherit.plist`

If you later sign and notarize the app, keep these files as-is unless you have a specific Apple signing policy requirement.
