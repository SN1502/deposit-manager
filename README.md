# Deposit Manager — Android app

Tracks every family deposit, reminds you before each maturity and interest Income Date, and keeps
everything in your own Excel sheet with its 16 columns:

`S.No · Bank Name · Deposit No · Depositer Name · Interest type · percentage · Deposit Value ·
Deposit Date · No of Days · Mature Date · Deposit position · monthly Renewal Date · Income Date ·
Amount of Intersest · Deposited Village · Remarks`

The app adds `FamilyMembers` (phone numbers), `Payments` (interest received / pending / overdue)
and `Notifications` sheets beside it.

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

* **Open my Excel file** loads every deposit at once from your 16-column sheet (whatever the sheet
  is called — it is recognised by its headings). Each Depositer Name becomes a family member.
  Don't have one? **Get a blank Excel template** (the `Instructions` sheet explains each column).
* Or **Start with an empty book** and add members and deposits in the app.

When asked, choose where the Excel file lives (for example *Downloads/DepositManager.xlsx*).
From then on **every change is saved into that file automatically**. If you edit the file in
Excel or Sheets, the app notices next time it opens and asks whether to load those changes.

## What the app does

| Screen | What it's for |
|---|---|
| Home (Dashboard) | Totals, maturing soon, overdue and upcoming interest, expected interest by type (Simple / Cumulative) |
| Family | Depositers, their deposits and totals; add / edit members and phone numbers |
| Deposits | Active and Closed tabs with S.No and position (Active / Maturing Soon / Matured / Closed) |
| Add / Edit deposit | The 16 columns; No of Days ↔ Mature Date fill each other in; interest calculated like your sheet |
| Deposit details | Masked Deposit No (tap *Show*, PIN asked if the lock is on), interest income, maturity, all 16 columns, renew / close / reopen |
| Payments | Upcoming interest (overdue, today, next 7 days, later), monthly renewal dates, and History with monthly totals |
| Search & filters | By name, village, bank, S.No, Deposit No; filter by position, interest type, depositer, village, bank |
| Settings | Excel file (open / create / save copy / share / template), reminders, PIN & fingerprint, theme, backup/restore |

How the worked-out columns are calculated:

* **Mature Date** = Deposit Date + No of Days (enter either one).
* **Amount of Intersest** (when left blank) = Deposit Value × percentage × months ÷ 12, with months
  = No of Days × 12 ÷ 365 rounded (180 days = 6 months) — the same way the family sheet does it.
* **Deposit position**: Closed if closed; Matured if the Mature Date has passed; Maturing Soon within
  30 days; otherwise Active.
* **monthly Renewal Date**: the next date on the deposit's day of the month, never after the Mature Date.
* **Income Date**: the Mature Date unless you set another date.
* A deposit closed before its Mature Date gets "Closed early on DD-MM-YYYY" in Remarks, so the date
  is kept in Excel.

Reminders: 30, 7 and 1 day before maturity and on the day; 7, 3 and 1 day before an Income Date and
on the day (one reminder when both fall on the same day); monthly renewal dates if switched on
(all adjustable, default at 9:00 AM). They arrive even when the app is closed and come
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
web/src/js/data.js       deposits (16 columns), interest income, reminders, import/export
web/src/js/platform.js   Android bridge / browser file access
web/src/js/app.js        state, autosave to Excel, navigation, PIN lock
web/src/js/screens.js    all screens
web/src/css/app.css      styles (light + dark)
```

After editing, run `node web/tools/build.js` — it writes `web/dist/DepositManager.html` and
copies it to `app/src/main/assets/index.html`. Commit and push; GitHub builds a new APK.
Tests (need Playwright + Chromium): `node web/tests/engine.test.js`, `web/tests/e2e-android.js`,
`web/tests/e2e-browser.js`. `web/tests/fixtures/family-16-columns.xlsx` is the family's sample sheet.
