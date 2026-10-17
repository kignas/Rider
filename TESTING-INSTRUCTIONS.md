# Eatswada Rider — Testing Instructions

Updated frontend package (rider application flow, application status, kitchen/order
status, GPS and notification hardening). The existing login, dashboard, order,
earnings and profile behaviour is preserved.

> Status: **not production-ready.** End-to-end API and on-device Android tests
> have **not** been verified. See *Known limitations* at the end.

---

## 1. Extract the ZIP

```bash
unzip Eatswada-Rider-Updated.zip
cd Eatswada-Rider-Updated
```

The archive extracts into a single folder, `Eatswada-Rider-Updated/`, which is the
project root. All commands below are run from that folder.

## 2. Install dependencies

Requires **Node.js 20+** (the build workflow uses Node 22) and npm.

```bash
npm install
```

Only Capacitor dev dependencies are installed. There is no web bundler.

## 3. Run the checks

```bash
npm run check     # lint (inline-script syntax + node --check) then unit tests
npm test          # unit tests only
npm run lint      # syntax checks only
```

Expected: `Syntax OK — 3 inline script block(s)` and `pass 29 / fail 0`.

## 4. Prepare and build the Android APK

Requires the **Android SDK** and **JDK 21**.

```bash
npm run android:prepare      # stages the web files into www/
npx cap add android          # first time only: creates the android/ project
npx cap sync android
cd android
chmod +x gradlew
./gradlew assembleDebug
```

**Push notifications require Firebase:** add a real `android/app/google-services.json`
for the package `com.eatswada.rider` and apply the `com.google.gms.google-services`
Gradle plugin. This file is a secret and is **not** included in the ZIP. Without it
the app builds and runs, but push delivery will not work. See
`.github/workflows/build-android.yml` for the exact CI steps (it reads the
`GOOGLE_SERVICES_JSON` repository secret).

## 5. APK output location

```
android/app/build/outputs/apk/debug/app-debug.apk
```

This is a **debug** APK, not a signed release build.

## 6. Install the APK on an Android phone

Option A — USB (adb):

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Option B — manual transfer: copy `app-debug.apk` to the phone, open it with a file
manager, and allow "install unknown apps" for that file source when prompted.

## 7. Manual test checklist

**Registration (application)**
- [ ] Login screen shows "Become a Delivery Partner" and opens `apply.html`.
- [ ] Submitting an empty form shows per-field errors and sends **no** network request.
- [ ] Submitting a valid application shows the success card with an application ID.
- [ ] The password is never shown again after submission.

**Application status**
- [ ] "Check status" with the application ID + phone shows the correct state.
- [ ] A pending application explains that an admin must approve it first.
- [ ] Airplane mode shows a retryable network message, not a false success.

**Approved rider login**
- [ ] A pending applicant gets clear guidance, not a bare "Invalid credentials".
- [ ] An approved rider logs in with the phone/email and password used to apply.
- [ ] Approval alone does **not** log the applicant in automatically.

**Order acceptance**
- [ ] A newly assigned order appears with a countdown and an "Accept delivery" button.
- [ ] Double-tapping accept does not send two acceptance requests.
- [ ] An order reassigned away or expired disappears / stops showing an action.

**Food-ready pickup restriction**
- [ ] While the kitchen is still preparing, pickup is blocked with a "Not ready yet" note.
- [ ] Pickup becomes available once the kitchen releases the order.

**GPS permissions**
- [ ] Denying location permission shows an explanation and does not crash.
- [ ] GPS off / no fix shows a clear message.
- [ ] Location updates are throttled (no rapid repeated calls).

**Notifications**
- [ ] Denying notification permission does not crash login or the dashboard.
- [ ] A failed push-token registration does not break the dashboard.
- [ ] An assignment notification triggers a dashboard refresh.
- [ ] Tapping a notification opens the dashboard on the right order.
- [ ] After logout, the device token is unregistered.

**Logout**
- [ ] Logout clears the session and returns to the login screen.
- [ ] A different rider logging in does not inherit the previous rider's alerts.

## 8. Known limitations

1. **Not production-ready.** No end-to-end API test and no on-device Android test
   has been run. The backend rate limiter and the absence of staging credentials
   blocked live integration testing.
2. **Firebase `google-services.json` is not included** (it is a secret). Push
   notifications cannot be verified until it is supplied.
3. **The Android APK was not built in this environment** — the Android SDK is not
   available here. Only `npm run check` and `npm run android:prepare` were run.
4. **Admin approval flow** was not exercised; it must be validated by the Eatswada team.
5. **No rider reject endpoint** exists in the backend; riders can only accept or
   ignore an assignment.
6. **No resubmission endpoint** for `needs_changes` applications.
7. The dashboard filters active orders client-side because `activeOnly` is not a
   real backend query parameter.
