# Deposit Manager — Android app

Tracks every family member's deposits, works out each interest payment date, reminds you before
payments and maturity, and keeps everything in one Excel workbook
(`FamilyMembers`, `Deposits`, `Payments`, `Notifications`).

The app has **no internet permission** — it cannot send your data anywhere. Account numbers are
shown only as `XXXX1234`, and an optional PIN / fingerprint lock protects the app.

---

## Get the APK without a computer (GitHub builds it for you)

You need a free GitHub account. Everything below works in the phone's browser.

1. Go to **github.com → New repository**. Name it `deposit-manager`, choose **Private**, tap
   **Create repository**.
2. Tap **uploading an existing file** (or **Add file → Upload files**), choose
   **`DepositManager-Android.zip`**, and tap **Commit changes**.
3. Tap **Add file → Create new file**. For the name type exactly
   `.github/workflows/build-apk.yml`, paste the whole content of the `build-apk.yml` file, and tap
   **Commit changes**.
4. Open the **Actions** tab. A build starts by itself and takes about 5 minutes. Wait for the
   green tick.
5. Go back to the repository's main page → **Releases** (right side, or scroll down on a phone)
   → tap **DepositManager.apk** to download it.

To publish a new version later: upload the new `DepositManager-Android.zip` over the old one.
A new release appears a few minutes later. Every build is signed with the same key, so it
installs over the old version and **all data stays**.

> Keep the repository **Private**: the project contains the app's signing key.

If you already cloned the whole project into a repository (not the zip), the same workflow is
already in `.github/workflows/` and builds on every push.

## Or build it on a computer

1. Install Android Studio, then **File → Open** this folder.
2. Wait for "Gradle sync finished".
3. **Build → Build App Bundle(s) / APK(s) → Build APK(s)** gives a debug APK, or run
   `./gradlew assembleRelease` for the signed release APK in `app/build/outputs/apk/release/`.

## Install on each phone

1. Send `DepositManager.apk` to the phone (WhatsApp, Drive, email, cable — anything).
2. Tap it. Android asks to allow installing from that app — allow it once, go back, tap **Install**.
3. Open **Deposit Manager**.

## First start

* **Open my Excel file** loads all family members and deposits at once.
  Don't have one? **Get a blank Excel template**, fill in `FamilyMembers` and `Deposits` in Excel or
  Google Sheets (the `Instructions` sheet explains each column), then open it.
* Or **Start with an empty book** and add members and deposits in the app.

When asked, choose where the Excel file lives (for example *Downloads/DepositManager.xlsx*).
From then on **every change is saved into that file automatically**. If you edit the file in
Excel or Sheets, the app notices next time it opens and asks whether to load those changes.

## What the app does

| Screen | What it's for |
|---|---|
| Home (Dashboard) | Totals, overdue and upcoming payments, income expected by frequency, maturing deposits |
| Family | Members, their deposits and totals; add / edit members |
| Deposits | Active and Closed tabs (closed deposits keep their full history) |
| Add / Edit deposit | One form; payment dates are generated automatically from the first payment date |
| Deposit details | Masked account number (tap *Show*, PIN asked if the lock is on), next payment, full schedule, close / reopen |
| Payments | Upcoming (overdue, today, next 7 days, later) and History with monthly totals |
| Search & filters | By name, village, bank, last digits of an account; filter by status, frequency, member, village, bank |
| Settings | Excel file (open / create / save copy / share / template), reminders, PIN & fingerprint, theme, backup/restore |

Reminders: 7, 3 and 1 day before each payment and on the day; 30, 7 and 1 day before maturity and
on the day (all adjustable, default at 9:00 AM). They arrive even when the app is closed and come
back after the phone restarts.

## Project layout

```
app/src/main/assets/index.html   the whole app screen (built from the web source, fully offline)
app/src/main/java/.../
  MainActivity.java              hosts the app, file pickers, back button, system bars
  AppBridge.java                 functions the app screen calls (window.AndroidBridge)
  Storage.java                   private data files + the linked Excel workbook
  Reminders.java                 scheduling and posting notifications
  ReminderReceiver.java          alarm → post due reminders
  BootReceiver.java              re-arm the alarm after restart / time change / update
  ShareProvider.java             lets the share sheet send the Excel file
deposit-manager-release.jks      signing key (keep it; needed for every future update)
keystore.properties              signing key settings
.github/workflows/build-apk.yml  cloud build
```

Requirements: Android 7.0 (API 24) or newer. Built with Android Gradle Plugin 8.9, Gradle 8.11,
Java 17, compile/target SDK 35. No third-party libraries.

## Changing the app screen (web source)

The screen the app shows is a single offline web page built from `web/src`:

```
web/src/js/core.js       dates, money formatting, helpers
web/src/js/xlsx.js       Excel reader/writer (JSZip)
web/src/js/data.js       members, deposits, payment schedules, reminders, import/export
web/src/js/platform.js   Android bridge / browser file access
web/src/js/app.js        state, autosave to Excel, navigation, PIN lock
web/src/js/screens.js    all screens
web/src/css/app.css      styles (light + dark)
```

After editing, run `node web/tools/build.js` — it writes `web/dist/DepositManager.html` and
copies it to `app/src/main/assets/index.html`. Commit and push; GitHub builds a new APK.
Tests (need Playwright + Chromium): `node web/tests/engine.test.js`, `web/tests/e2e-android.js`,
`web/tests/e2e-browser.js`.
