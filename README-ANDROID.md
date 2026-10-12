# Eatswada Rider — Android test APK build setup

This package wraps the current web frontend with Capacitor 8.5.2 and adds a cloud build in GitHub Actions. The original source files included in the ZIP are unchanged.

## Build in GitHub Actions

1. Extract the ZIP and add these files to the root of the existing `Rider-main` repository, preserving the `.github/workflows/` and `scripts/` paths. Do not replace the web pages with files from any other version.
2. Commit and push the additions to `main`.
3. Open GitHub → Actions → **Build Android APK**. The workflow should start after the push; alternatively choose **Run workflow**.
4. After it succeeds, open the run and download the `Rider-APK-debug` artifact. It contains `app-debug.apk`.
5. Transfer the APK to an Android device and install it; Android may ask you to allow app installs from the file source.

## Important before distribution

- This workflow currently creates a **debug/test APK**, not a signed production release.
- The existing backend is not modified, redeployed, or switched by this setup.
- Core frontend files are packaged locally into the APK. Check relative file paths and all functions on a real Android device.
- Existing browser Firebase Messaging service workers do not automatically provide native Android push notifications in a Capacitor APK. Native Firebase integration, permission handling, and foreground/background notification testing are still required before depending on order or delivery alerts.
- Test login, API connectivity, navigation/back button, input keyboard, links, location-related flows, uploads if used, and session persistence.
- Do not hand out this APK as production-ready until those tests pass.

## Added files

- `package.json` — pinned Capacitor 8.5.2 dependencies
- `capacitor.config.json` — unique Android application ID
- `scripts/prepare-www.mjs` — stages the existing frontend files without editing them
- `.github/workflows/build-android.yml` — cloud build job
- `README-ANDROID.md` — these instructions
