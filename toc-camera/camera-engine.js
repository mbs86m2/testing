/**
 * =========================================================================
 * TOC CAMERA ENGINE (camera-engine.js)
 * Standalone Unified Engine for Standard & Lite Viewfinders
 * Hardware Adaptive: Apple Engine Aware + Android <4GB RAM Lock
 * =========================================================================
 */

// ==============================================================
// 1. UNIVERSAL BACK-SWIPE PORTAL GUARD (iOS & Android)
// ==============================================================
(function() {
  const PORTAL_URL = '../index.html';
  if (window.history && window.history.pushState) {
    window.history.pushState({ isSubApp: true }, '', window.location.href);
    window.addEventListener('popstate', function() {
      window.location.replace(PORTAL_URL);
    });
  }
})();

// ==============================================================
// 2. CONFIGURATION & STATE
// ==============================================================
const PORTAL_URL = '../index.html';
const SUPERVISOR_PIN = "1251";
const ADMIN_USERS = ["admin m2", "m2", "keekc", "kee", "kee kc", "admin", "master"];
const AUTO_DELETE_MS = 3 * 60 * 1000;    // 3 Minutes Auto-Deletion for Off-Peak
const CAMERA_INACTIVITY_MS = 20 * 1000;  // 20 Seconds Camera Auto-Pause (Battery Saver)

let currentStream = null;
let currentFacingMode = "environment";
let isFlashOn = false;
let isSyncRunning = false;
let cameraInactivityTimer = null;

let dbInstance = null;
const DB_NAME = "TocCameraDB";
const STORE_NAME = "photos";

function goToPortal() {
  window.location.replace(PORTAL_URL);
}

// ==============================================================
// 3. HARDWARE DETECTION: APPLE AWARE + ANDROID <4GB RAM LOCK
// ==============================================================
function isDeviceLowEnd() {
  // 1. Apple Devices (iPhones/iPads) are ALWAYS high-performance with dedicated hardware video chips
  const isApple = /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isApple) return false;

  // 2. Android: Check Chrome's deviceMemory API (< 4GB RAM)
  if (typeof navigator.deviceMemory !== 'undefined') {
    return navigator.deviceMemory < 4;
  }

  // 3. Android: Check older OS versions or budget hardware indicators
  const isOlderAndroid = /Android [4-9]\b|Android 10\b/i.test(navigator.userAgent);
  const isLowCPU = (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4);

  return isOlderAndroid || isLowCPU;
}

function autoDetectHardwareAndRoute() {
  const isLitePage = window.location.pathname.endsWith('lite.html');

  // If device is genuinely low-end (< 4GB RAM Android), force Lite Mode
  if (isDeviceLowEnd() && !isLitePage) {
    console.log("⚡ Device has < 4GB RAM. Auto-routing to Lite Mode for performance safety...");
    window.location.replace('lite.html?auto=true');
    return;
  }

  // If user previously chose Lite manually on higher-end hardware
  const manualPref = localStorage.getItem('toc_preferred_mode');
  if (manualPref === 'lite' && !isLitePage) {
    window.location.replace('lite.html');
  }
}

// Standard -> Lite is ALWAYS allowed
function switchToLiteMode() {
  localStorage.setItem('toc_preferred_mode', 'lite');
  window.location.href = "lite.html";
}

// Lite -> Standard is BLOCKED on genuine <4GB RAM devices
function switchToStandardMode() {
  if (isDeviceLowEnd()) {
    alert("⚠️ Standard Viewfinder is disabled on devices with less than 4GB RAM to prevent system lag, overheating, and browser crashes.\n\nLite Mode is locked for your device's stability.");
    return;
  }
  localStorage.setItem('toc_preferred_mode', 'standard');
  window.location.href = "index.html";
}

// Run hardware routing check immediately
autoDetectHardwareAndRoute();

function getPortalLoggedInUser() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromParam = urlParams.get('user') || urlParams.get('username') || urlParams.get('officer') || urlParams.get('name') || urlParams.get('id');
  if (fromParam && fromParam.trim()) return fromParam.trim();

  const possibleKeys = [
    'portal_active_user', 'wafp_officer', 'wafp_logged_officer', 'currentUser', 
    'wafp_active_officer', 'wafp_user', 'username', 'officer', 'user'
  ];

  for (let k of possibleKeys) {
    let val = sessionStorage.getItem(k) || localStorage.getItem(k);
    if (val && typeof val === 'string' && val.trim()) return val.trim();
  }
  return '';
}

function isUserAdmin() {
  const name = (getPortalLoggedInUser() || '').toLowerCase();
  const role = (localStorage.getItem('portal_user_role') || '').toLowerCase();
  if (role === 'admin') return true;
  return ADMIN_USERS.some(adminName => name === adminName || name.includes(adminName));
}

function isPhotoInActiveHours(timestamp) {
  const d = new Date(timestamp);
  const hr = d.getHours();
  return (hr >= 10 && hr < 12) || (hr >= 20 && hr < 23);
}

// ==============================================================
// 4. 20-SECOND CAMERA INACTIVITY AUTO-PAUSE (BATTERY SAVER)
// ==============================================================
function resetCameraInactivityTimer() {
  if (cameraInactivityTimer) clearTimeout(cameraInactivityTimer);
  if (currentStream) {
    cameraInactivityTimer = setTimeout(pauseCameraDueToInactivity, CAMERA_INACTIVITY_MS);
  }
}

function pauseCameraDueToInactivity() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }

  const video = document.getElementById("videoFeed");
  if (video) video.srcObject = null;

  const placeholder = document.getElementById("cameraPlaceholder");
  const shutterOverlay = document.getElementById("shutterOverlay");
  const placeholderTitle = document.getElementById("cameraPlaceholderTitle");
  const placeholderDesc = document.getElementById("cameraPlaceholderDesc");
  const startBtn = document.getElementById("startCamBtn");

  if (placeholderTitle) placeholderTitle.innerText = "Camera Paused (Battery Saver)";
  if (placeholderDesc) placeholderDesc.innerText = "Lens turned off after 20s idle. Tap to resume.";
  if (startBtn) startBtn.innerText = "▶ Resume Camera";

  if (placeholder) placeholder.style.display = "flex";
  if (shutterOverlay) shutterOverlay.classList.add("hidden");
}

// Reset 20s camera timer on any interaction
['touchstart', 'mousedown', 'mousemove', 'click', 'keydown', 'scroll'].forEach(evt => {
  document.addEventListener(evt, resetCameraInactivityTimer, { passive: true });
});

// ==============================================================
// 5. INDEXEDDB LOCAL STORAGE ENGINE
// ==============================================================
function initDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("synced", "synced", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    request.onerror = (e) => reject(e);
  });
}

async function savePhotoToLocalDB(photoObj) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(photoObj);
    tx.oncomplete = () => {
      refreshLocalGallery();
      updateMetrics();
      resolve(photoObj);
    };
    tx.onerror = (e) => reject(e);
  });
}

async function getAllLocalPhotos() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e);
  });
}

async function deletePhotoFromLocalDB(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      refreshLocalGallery();
      updateMetrics();
      resolve();
    };
    tx.onerror = (e) => reject(e);
  });
}

async function clearAllLocalPhotos() {
  if (!confirm("Clear all locally cached photos from this device?")) return;
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.clear();
  tx.oncomplete = () => {
    refreshLocalGallery();
    updateMetrics();
  };
}

// ==============================================================
// 6. IN-APP CAMERA STREAM & CAPTURE
// ==============================================================
async function startInAppCamera() {
  const video = document.getElementById("videoFeed");
  const placeholder = document.getElementById("cameraPlaceholder");
  const shutterOverlay = document.getElementById("shutterOverlay");

  if (!video) return;

  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }

  // 3.5s Watchdog: If camera stream stalls on this hardware, auto-route to Lite
  const watchdogTimer = setTimeout(() => {
    if (!currentStream && !window.location.pathname.endsWith('lite.html')) {
      console.warn("Camera stream took too long. Auto-routing to Lite Mode...");
      window.location.replace('lite.html?fallback=true');
    }
  }, 3500);

  const constraints = {
    video: {
      facingMode: { ideal: currentFacingMode },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    clearTimeout(watchdogTimer);
    currentStream = stream;
    video.srcObject = stream;
    await video.play();

    if (placeholder) placeholder.style.display = "none";
    if (shutterOverlay) shutterOverlay.classList.remove("hidden");
    resetCameraInactivityTimer();
  } catch (err) {
    clearTimeout(watchdogTimer);
    console.warn("Camera stream failed, auto-switching to Lite Mode:", err);
    if (!window.location.pathname.endsWith('lite.html')) {
      window.location.replace('lite.html?fallback=true');
    } else {
      triggerNativeCameraFallback();
    }
  }
}

function triggerNativeCameraFallback() {
  const nativeInput = document.getElementById("nativeCameraInput");
  if (nativeInput) nativeInput.click();
}

function handleCameraInteraction() {
  if (!currentStream) {
    startInAppCamera();
  } else {
    resetCameraInactivityTimer();
  }
}

function switchCamera() {
  currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
  startInAppCamera();
}

async function toggleCameraFlash() {
  if (!currentStream) return;
  const track = currentStream.getVideoTracks()[0];
  if (!track) return;

  try {
    const capabilities = track.getCapabilities();
    if (capabilities.torch) {
      isFlashOn = !isFlashOn;
      await track.applyConstraints({ advanced: [{ torch: isFlashOn }] });
    } else {
      alert("Flashlight not supported on this camera lens.");
    }
  } catch (e) {
    console.warn("Flash toggle error:", e);
  }
  resetCameraInactivityTimer();
}

function capturePhoto() {
  resetCameraInactivityTimer();
  const video = document.getElementById("videoFeed");
  if (!video || !currentStream) return;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  applyTimestampOverlay(canvas, ctx);

  const base64Data = canvas.toDataURL("image/jpeg", 0.85);
  showCaptureAnimation(base64Data);

  const now = new Date();
  const filename = generateTocFilename(now);

  const photoObj = {
    id: `TOC_${Date.now()}`,
    filename: filename,
    base64: base64Data,
    timestamp: now.getTime(),
    synced: false
  };

  savePhotoToLocalDB(photoObj).then(() => {
    runSyncEngine();
  });
}

function handleImportPhoto(event) {
  resetCameraInactivityTimer();
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxDim = 1600;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
        else { w = Math.round((w * maxDim) / h); h = maxDim; }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      applyTimestampOverlay(canvas, ctx);

      const base64Data = canvas.toDataURL("image/jpeg", 0.85);
      showCaptureAnimation(base64Data);

      const now = new Date();
      const filename = generateTocFilename(now);

      const photoObj = {
        id: `TOC_${Date.now()}`,
        filename: filename,
        base64: base64Data,
        timestamp: now.getTime(),
        synced: false
      };

      savePhotoToLocalDB(photoObj).then(() => {
        runSyncEngine();
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function generateTocFilename(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `TOC_${yyyy}-${mm}-${dd}_${hh}.${min}.${ss}.jpeg`;
}

function applyTimestampOverlay(canvas, ctx) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const fontSize = Math.max(16, Math.round(canvas.width * 0.03));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";

  const padding = fontSize * 0.6;
  const lineSpacing = fontSize * 1.15;

  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.15));

  ctx.strokeText(timeStr, canvas.width - padding, canvas.height - padding);
  ctx.fillStyle = "#FACC15";
  ctx.fillText(timeStr, canvas.width - padding, canvas.height - padding);

  ctx.strokeText(dateStr, canvas.width - padding, canvas.height - padding - lineSpacing);
  ctx.fillStyle = "#FACC15";
  ctx.fillText(dateStr, canvas.width - padding, canvas.height - padding - lineSpacing);
}

function showCaptureAnimation(base64Data) {
  const overlay = document.getElementById("capturePreviewOverlay");
  const toast = document.getElementById("captureToast");

  if (overlay) {
    overlay.src = base64Data;
    overlay.classList.remove("hidden");
    setTimeout(() => overlay.classList.add("hidden"), 600);
  }

  if (toast) {
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 1800);
  }
}

// ==============================================================
// 7. CLOUD SYNC & CLEANUP ENGINE
// ==============================================================
async function runSyncEngine(forceAll = false) {
  if (isSyncRunning) return;
  isSyncRunning = true;

  const url = localStorage.getItem("TOC_API_URL") || localStorage.getItem("appsScriptUrl");
  const folderId = localStorage.getItem("TOC_FOLDER_ID") || localStorage.getItem("folderId");

  if (!url || !folderId) {
    isSyncRunning = false;
    return;
  }

  const photos = await getAllLocalPhotos();
  const queue = forceAll ? photos : photos.filter(p => !p.synced);

  for (const photo of queue) {
    try {
      const res = await fetch(url, {
        method: "POST",
        mode: "cors",
        redirect: "follow",
        body: JSON.stringify({
          action: "uploadTocPhoto",
          folderId: folderId,
          base64Data: photo.base64,
          filename: photo.filename
        })
      });
      const data = await res.json();
      if (data.status === "success" || data.success) {
        photo.synced = true;
        await savePhotoToLocalDB(photo);
      }
    } catch (e) {
      console.warn("Sync error for photo:", photo.filename, e);
    }
  }

  isSyncRunning = false;
  refreshLocalGallery();
  updateMetrics();
}

function forceSyncNow() {
  runSyncEngine(true);
}

async function triggerDriveCleanup() {
  const url = localStorage.getItem("TOC_API_URL") || localStorage.getItem("appsScriptUrl");
  const folderId = localStorage.getItem("TOC_FOLDER_ID") || localStorage.getItem("folderId");

  if (!url || !folderId) {
    alert("Missing Script URL or Folder ID in configuration.");
    return;
  }

  if (!confirm("Scan Google Drive folder and remove duplicate photos?")) return;

  const btn = document.getElementById("cleanupBtn");
  if (btn) btn.innerText = "⏳ Cleaning...";

  try {
    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      redirect: "follow",
      body: JSON.stringify({ action: "cleanupDuplicates", folderId: folderId })
    });
    const data = await res.json();
    alert(`Duplicate Cleanup Complete!\nRemoved: ${data.removedCount || 0} duplicate file(s).`);
  } catch (e) {
    alert("Cleanup request failed. Please check network connection.");
  } finally {
    if (btn) btn.innerHTML = `<span class="text-[8px] font-mono uppercase font-bold opacity-90 leading-tight">Duplicates</span><span class="text-[11px] font-extrabold flex items-center gap-0.5 mt-0.5">✨ Clean</span>`;
  }
}

// ==============================================================
// 8. UI REFRESH, GALLERY, METRICS & DELETION TIMERS
// ==============================================================
function getDeletionTimerBadge(photo) {
  if (isPhotoInActiveHours(photo.timestamp)) {
    return {
      text: "Protected 🔒",
      class: "bg-emerald-600 text-white border border-emerald-400/40 font-bold"
    };
  }

  const elapsed = Date.now() - photo.timestamp;
  const remaining = AUTO_DELETE_MS - elapsed;

  if (remaining <= 0) {
    return {
      text: "Deleting...",
      class: "bg-rose-600 text-white border border-rose-400/40 font-bold",
      isExpired: true
    };
  }

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return {
    text: `⏱ ${mins}m ${secs < 10 ? '0' : ''}${secs}s`,
    class: "bg-black/75 text-amber-300 border border-amber-400/50 font-mono font-bold",
    isExpired: false
  };
}

async function refreshLocalGallery() {
  const grid = document.getElementById("photoGrid");
  const emptyState = document.getElementById("emptyState");
  if (!grid) return;

  const photos = await getAllLocalPhotos();
  photos.sort((a, b) => b.timestamp - a.timestamp);

  if (photos.length === 0) {
    grid.innerHTML = "";
    if (emptyState) emptyState.classList.remove("hidden");
    return;
  }

  if (emptyState) emptyState.classList.add("hidden");

  // Auto-delete expired off-peak photos past 3 mins
  for (const p of photos) {
    if (!isPhotoInActiveHours(p.timestamp)) {
      if (Date.now() - p.timestamp >= AUTO_DELETE_MS) {
        await deletePhotoFromLocalDB(p.id);
      }
    }
  }

  grid.innerHTML = photos.map(p => {
    const timerBadge = getDeletionTimerBadge(p);
    return `
      <div class="relative aspect-square rounded-xl overflow-hidden border border-slate-300 bg-black cursor-pointer group shadow-sm" onclick="openLightbox('${p.id}')">
        <img src="${p.base64}" class="w-full h-full object-cover">
        
        <!-- TOP-RIGHT BADGE: Sync Status -->
        <div class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold shadow-md ${p.synced ? 'bg-emerald-600 text-white border border-emerald-400/40' : 'bg-amber-500 text-slate-950 border border-amber-300'}">
          ${p.synced ? 'Synced ✓' : 'Queue ⏳'}
        </div>

        <!-- BOTTOM-RIGHT BADGE: Protected or Deletion Timer -->
        <div class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] shadow-md ${timerBadge.class}">
          ${timerBadge.text}
        </div>
      </div>
    `;
  }).join('');
}

async function updateMetrics() {
  const queueEl = document.getElementById("syncQueueCount");
  const totalEl = document.getElementById("totalSyncedCount");

  const photos = await getAllLocalPhotos();
  const queueCount = photos.filter(p => !p.synced).length;
  const syncedCount = photos.filter(p => p.synced).length;

  if (queueEl) queueEl.innerText = queueCount;
  if (totalEl) totalEl.innerText = syncedCount;
}

// Live gallery update & countdown ticker
setInterval(() => {
  refreshLocalGallery();
}, 1000);

// ==============================================================
// 9. LIGHTBOX PREVIEW
// ==============================================================
async function openLightbox(id) {
  const photos = await getAllLocalPhotos();
  const photo = photos.find(p => p.id === id);
  if (!photo) return;

  const modal = document.getElementById("lightboxModal");
  const img = document.getElementById("lightboxImage");
  const name = document.getElementById("lightboxFileName");
  const downloadBtn = document.getElementById("lightboxDownloadBtn");
  const syncBtn = document.getElementById("lightboxSyncBtn");
  const deleteBtn = document.getElementById("lightboxDeleteBtn");

  if (!modal || !img) return;

  img.src = photo.base64;
  if (name) name.innerText = photo.filename;

  if (downloadBtn) {
    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = photo.base64;
      a.download = photo.filename;
      a.click();
    };
  }

  if (syncBtn) {
    syncBtn.onclick = async () => {
      await forceSyncNow();
      closeLightbox();
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (confirm(`Delete local photo: ${photo.filename}?`)) {
        await deletePhotoFromLocalDB(photo.id);
        closeLightbox();
      }
    };
  }

  modal.classList.remove("hidden");
}

function closeLightbox() {
  const modal = document.getElementById("lightboxModal");
  if (modal) modal.classList.add("hidden");
}

// ==============================================================
// 10. ADMIN PIN LOCK & SETTINGS MODAL
// ==============================================================
function openSettingsModal() {
  if (isUserAdmin()) {
    showSettingsModal();
    return;
  }
  const modal = document.getElementById("pinModal");
  const pinInput = document.getElementById("supervisorPinInput");
  const err = document.getElementById("pinErrorMsg");
  if (err) err.classList.add("hidden");
  if (pinInput) pinInput.value = "";
  if (modal) modal.classList.remove("hidden");
  setTimeout(() => { if (pinInput) pinInput.focus(); }, 150);
}

function closePinModal() {
  const modal = document.getElementById("pinModal");
  if (modal) modal.classList.add("hidden");
}

function verifySupervisorPin() {
  const pinInput = document.getElementById("supervisorPinInput");
  const err = document.getElementById("pinErrorMsg");
  if (pinInput && pinInput.value === SUPERVISOR_PIN) {
    closePinModal();
    showSettingsModal();
  } else if (err) {
    err.classList.remove("hidden");
  }
}

function showSettingsModal() {
  const modal = document.getElementById("settingsModal");
  const urlIn = document.getElementById("appsScriptUrlInput");
  const folderIn = document.getElementById("folderIdInput");

  if (urlIn) urlIn.value = localStorage.getItem("TOC_API_URL") || localStorage.getItem("appsScriptUrl") || "";
  if (folderIn) folderIn.value = localStorage.getItem("TOC_FOLDER_ID") || localStorage.getItem("folderId") || "";

  if (modal) modal.classList.remove("hidden");
}

function closeSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (modal) modal.classList.add("hidden");
}

function saveDriveSettings() {
  const urlIn = document.getElementById("appsScriptUrlInput");
  const folderIn = document.getElementById("folderIdInput");

  if (urlIn && urlIn.value.trim()) {
    localStorage.setItem("TOC_API_URL", urlIn.value.trim());
    localStorage.setItem("appsScriptUrl", urlIn.value.trim());
  }

  if (folderIn && folderIn.value.trim()) {
    localStorage.setItem("TOC_FOLDER_ID", folderIn.value.trim());
    localStorage.setItem("folderId", folderIn.value.trim());
  }

  closeSettingsModal();
  alert("Settings Saved Successfully!");
}

function logoutOfSettings() {
  closeSettingsModal();
}

function forceResyncAllToCurrentFolder() {
  closeSettingsModal();
  runSyncEngine(true);
}

// ==============================================================
// 11. LIVE TIMING CLOCK (ACTIVE HOURS 10-12 & 20-23)
// ==============================================================
function updateLiveClock() {
  const timeText = document.getElementById("currentTimeText");
  const dot = document.getElementById("timingStatusDot");
  const statusText = document.getElementById("timingStatusText");

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
  if (timeText) timeText.innerText = timeStr;

  const hr = now.getHours();
  const isActiveSlot = (hr >= 10 && hr < 12) || (hr >= 20 && hr < 23);

  if (dot && statusText) {
    if (isActiveSlot) {
      dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse";
      statusText.innerText = "Active Timing Check (Live)";
      statusText.className = "font-extrabold text-[11px] tracking-wide text-emerald-300";
    } else {
      dot.className = "w-2.5 h-2.5 rounded-full bg-amber-500";
      statusText.innerText = "Off-Peak Hours (Standby)";
      statusText.className = "font-extrabold text-[11px] tracking-wide text-amber-300";
    }
  }
}

setInterval(updateLiveClock, 1000);

// ==============================================================
// 12. INITIALIZATION
// ==============================================================
function initializeAppEngine(isLite = false) {
  initDB().then(() => {
    refreshLocalGallery();
    updateMetrics();
  });

  if (!isLite) {
    startInAppCamera();
  }
}

function onAppResume() {
  refreshLocalGallery();
  updateMetrics();
  if (currentStream) {
    resetCameraInactivityTimer();
  }
}
