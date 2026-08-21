# TOC Camera - iOS & Web Companion

This is the fully featured, client-side Web Companion for the **TOC Camera (Time of Capture)** Android application. Designed specifically with a premium, responsive Material Design 3 dark theme, it allows iOS users (Safari/Chrome) to capture, timestamp, cache, sync, and clean up photos under the exact same privacy-timing policies as the native Android version.

---

## Key Features

- **Double-Mode Capture Interface:**
  - **In-App Viewfinder:** Real-time camera streaming with camera flipping (front/rear lens), auto-opening on page load and auto-pausing after **10 seconds** of inactivity to conserve battery and system memory.
  - **iOS Native Shutter:** Elegantly styled high-resolution native camera launcher, leveraging iOS's advanced native hardware processing (HDR, ultra-wide) while automatically adding the TOC watermark.
- **Dynamic "Time of Capture" (TOC) Watermark:** Overlays a highly legible, dropshadowed monospace watermark on the bottom-left corner of the captured image.
- **IndexedDB Local Storage:** Securely stores image data URLs on the device's browser memory, preventing loss if the tab is closed.
- **Identical Privacy-Timing Rules:**
  - **Active Hours:** Morning (10:00 AM - 12:00 PM) and Evening (8:00 PM - 11:00 PM).
  - **Auto-Deletion:** Photos captured outside active hours are automatically deleted after **3 minutes** (both locally and on Google Drive).
  - **Selective Manual Deletion:** Manual deletion during active hours removes local cache only (preserving Google Drive copy), while manual deletion outside active hours purges both local cache and Google Drive.
  - **Automatic Display Zoom Adaptation:** Automatically detects iPhone/Android Display Zoom mode and high-DPI scaling, scaling the interface dynamically to maintain compact, non-enlarged proportions.
  - **Day Transition Cleanup:** Photos older than 3:00 AM of the current calendar day are purged.
- **Synchronized Duplicate Cleanup:** Integrates with the exact same Google Apps Script endpoint to trigger duplicate file scans and folder reorganization.

---

## Setup & Deployment Guide

Since this is a client-side Progressive Web App (HTML5/JS/CSS), there are no complex servers to maintain. You can deploy it instantly for free:

### 1. Host the Web Files
Deploy the `/web` folder contents to any static hosting provider. Here are some simple methods:
- **GitHub Pages:** Create a repository, upload the files inside `/web`, and enable GitHub Pages in settings.
- **Vercel / Netlify:** Drag-and-drop the `/web` folder into the dashboard for a custom production URL.
- **Local Testing:** Serve locally using a command like `npx serve .` in the `/web` directory.

### 2. Install on iOS (PWA)
1. Open the hosted URL in **Safari** on your iPhone or iPad.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and select **"Add to Home Screen"**.
4. Tap **"Add"** in the top-right corner.
5. The **TOC Camera** icon will now appear on your iOS home screen as a standalone app, hiding the Safari address bar!

### 3. Connect to Google Drive
1. Open the app on your iPhone and tap the **Settings (Gear) Icon** in the top right.
2. Enter your **Google Apps Script Web App URL** and **Google Drive Folder ID** (use the same credentials configured in your Android app).
3. Tap **"Save Configuration Changes"**.
4. Your offline queue will immediately begin syncing to your Drive!

---

## Architecture & Communication Flow

```
   [ iOS Web Camera / File Capture ]
                  │
                  ▼ (Canvas Watermark)
   [ IndexedDB Local Cache (Pending Queue) ]
                  │
                  ├─► (Every 10s: Check Allowed Timings) ──► [ Auto-Delete if Out of Hours ]
                  │
                  ▼ (POST Payload - base64)
    [ Google Apps Script Web App Broker ]
                  │
                  ▼
         [ Google Drive Folder ]
```

### Folder Organization
Synced photos are automatically organized in Google Drive inside:
`YOUR_FOLDER/YEAR/MONTH/IMG_YYYYMMDD_HHMMSS.jpg`
