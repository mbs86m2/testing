/* ==========================================================================
   TOC CAMERA CORE ENGINE - SHARED LOGIC FOR INDEX.HTML & LITE.HTML
   ========================================================================== */

const PORTAL_URL = '../index.html';
const CURRENT_CONFIG_VERSION = 'v2_force_2026';
const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbySv0cEND7TmLsQlf9zHpkWlGNjeOu-QYinZU86B0u-8M_xq8KTHnxLa6vO4yYKTdyTFg/exec';
const DEFAULT_FOLDER_ID = '1vOHVu0nBmMFyFxU_JrfUhrow9EvEjkDU';
const FIVE_MINS_MS = 5 * 60 * 1000;
const CAMERA_INACTIVITY_LIMIT_MS = 20000;

// ADMIN USERS LIST
const ADMIN_USERS = ["admin m2", "m2", "keekc", "kee", "kee kc", "admin", "master"];

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
    if (val && typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }

  return '';
}

function isUserAdmin() {
  const name = (getPortalLoggedInUser() || '').toLowerCase();
  const role = (localStorage.getItem('portal_user_role') || '').toLowerCase();
  if (role === 'admin') return true;
  return ADMIN_USERS.some(adminName => name === adminName || name.includes(adminName));
}

let currentAppsScriptUrl = localStorage.getItem('appsScriptUrl') || DEFAULT_APPS_SCRIPT_URL;
let currentFolderId = localStorage.getItem('folderId') || DEFAULT_FOLDER_ID;
let currentSupervisor = null;

// IN-MEMORY & LOCALSTORAGE FALLBACK STORE FOR 100% RELIABILITY ACROSS MODES
let inMemoryPhotos = [];

function loadLocalStorageFallbackPhotos() {
  try {
    const raw = localStorage.getItem('toc_local_photos_cache');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {}
  return [];
}

function saveLocalStorageFallbackPhotos(photos) {
  try {
    const recent = photos.slice(0, 30);
    localStorage.setItem('toc_local_photos_cache', JSON.stringify(recent));
  } catch (e) {}
}

// ==========================================
// 1. CONFIGURATION ENFORCEMENT & MANUAL SYNC
// ==========================================
function enforceLatestConfig() {
  const savedVersion = localStorage.getItem('toc_config_version');
  if (savedVersion !== CURRENT_CONFIG_VERSION) {
    syncLatestConfig(false);
  }
}

async function syncLatestConfig(showAlert = true) {
  localStorage.setItem('appsScriptUrl', DEFAULT_APPS_SCRIPT_URL);
  localStorage.setItem('folderId', DEFAULT_FOLDER_ID);
  localStorage.setItem('toc_config_version', CURRENT_CONFIG_VERSION);

  currentAppsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
  currentFolderId = DEFAULT_FOLDER_ID;

  const urlInput = document.getElementById('appsScriptUrlInput');
  const folderInput = document.getElementById('folderIdInput');
  if (urlInput) urlInput.value = DEFAULT_APPS_SCRIPT_URL;
  if (folderInput) folderInput.value = DEFAULT_FOLDER_ID;

  if (showAlert) {
    if (confirm("✅ Configuration Synced to latest system defaults!\n\nWould you like to re-sync all existing local photos to the new Google Drive folder now?")) {
      await forceResyncAllToCurrentFolder();
    } else {
      runSyncEngine(true);
    }
  } else {
    runSyncEngine(true);
  }
}
enforceLatestConfig();

// ==========================================
// 2. PERMANENT ACCOUNT & SHIFT PERSISTENCE
// ==========================================
function saveShiftSession(supervisorData) {
  if (!supervisorData) return;
  const now = Date.now();
  const sessionData = {
    supervisor: supervisorData,
    loginTimestamp: now,
    shiftEndTime: now + (24 * 60 * 60 * 1000),
    isActive: true
  };
  localStorage.setItem('toc_shift_session', JSON.stringify(sessionData));
  localStorage.setItem('toc_supervisor', JSON.stringify(supervisorData));
  localStorage.setItem('toc_user_logged_in', 'true');
  currentSupervisor = supervisorData;
}

function getActiveShiftSession() {
  try {
    const raw = localStorage.getItem('toc_shift_session');
    if (raw) {
      const session = JSON.parse(raw);
      if (session && session.supervisor) {
        return session;
      }
    }
    const legacySup = localStorage.getItem('toc_supervisor');
    if (legacySup) {
      return { supervisor: JSON.parse(legacySup), isActive: true };
    }
  } catch (e) {}
  return null;
}

function restoreShiftSession() {
  if (isUserAdmin()) {
    const activeOfficer = getPortalLoggedInUser();
    currentSupervisor = { 
      name: activeOfficer ? activeOfficer.toUpperCase() : "ADMIN", 
      shift: "Administrator" 
    };
    return true;
  }

  const session = getActiveShiftSession();
  if (session && session.supervisor) {
    currentSupervisor = session.supervisor;
    return true;
  }
  return false;
}

function clearShiftSession() {
  localStorage.removeItem('toc_shift_session');
  localStorage.removeItem('toc_supervisor');
  localStorage.removeItem('toc_user_logged_in');
  currentSupervisor = null;
}

function logoutOfSettings() {
  clearShiftSession();
  closeSettingsModal();
  alert("🔒 Settings locked. Supervisor session logged out.");
}

function explicitEndShiftLogout() {
  logoutOfSettings();
}

function lockSessionStateBeforeExit() {
  clearShiftSession();
}

function goToPortal() {
  lockSessionStateBeforeExit();
  window.location.href = PORTAL_URL;
}

// ==========================================
// 3. INACTIVITY TIMERS (5 MINS AUTO RETURN)
// ==========================================
let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    goToPortal();
  }, FIVE_MINS_MS);
}

function initInactivityTracker() {
  ['mousemove', 'keypress', 'click', 'touchstart', 'scroll', 'keydown'].forEach(evt => {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

// ==========================================
// 4. ORIENTATION & MODE ROUTING
// ==========================================
function checkOrientation() {
  const overlay = document.getElementById('orientationOverlay');
  if (!overlay) return;
  if (window.innerWidth > window.innerHeight && window.innerHeight < 600) {
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);

async function lockPortraitOrientation() {
  if (screen.orientation && typeof screen.orientation.lock === 'function') {
    try {
      await screen.orientation.lock('portrait-primary');
    } catch (e) {}
  }
}

function detectDeviceMode(isLitePage) {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('manual') === '1' || urlParams.get('auto') === '1') return;

  const sessionOverride = sessionStorage.getItem('toc_mode_override');
  if (sessionOverride === (isLitePage ? 'lite' : 'standard')) return;
  if (sessionOverride === 'standard' && isLitePage) {
    window.location.replace('index.html?auto=1');
    return;
  }
  if (sessionOverride === 'lite' && !isLitePage) {
    window.location.replace('lite.html?auto=1');
    return;
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const saveData = navigator.connection && navigator.connection.saveData;

  let androidVer = 99;
  const match = ua.match(/Android\s([0-9\.]+)/i);
  if (match && match[1]) androidVer = parseFloat(match[1]);

  const isLowSpec = isAndroid && (cores <= 4 || memory <= 4 || androidVer <= 10 || saveData);

  if (isLowSpec && !isLitePage) {
    sessionStorage.setItem('toc_mode_override', 'lite');
    window.location.replace('lite.html?auto=1');
  } else if (!isLowSpec && isLitePage) {
    sessionStorage.setItem('toc_mode_override', 'standard');
    window.location.replace('index.html?auto=1');
  }
}

function switchToStandardMode() {
  sessionStorage.setItem('toc_mode_override', 'standard');
  window.location.href = 'index.html?manual=1';
}

function switchToLiteMode() {
  sessionStorage.setItem('toc_mode_override', 'lite');
  window.location.href = 'lite.html?manual=1';
}

// ==========================================
// 5. CAMERA ENGINE, OCR & CAPTURE DISPLAY
// ==========================================
let mediaStream = null;
let cameraInactivityTimer = null;
let cameraMode = 'environment';
let isFlashOn = false;
let isCapturingPause = false;
let previewPauseTimer = null;

function resetCameraInactivityTimer() {
  if (cameraInactivityTimer) clearTimeout(cameraInactivityTimer);
  if (mediaStream) {
    cameraInactivityTimer = setTimeout(() => {
      stopInAppCamera(true);
    }, CAMERA_INACTIVITY_LIMIT_MS);
  }
}

async function startInAppCamera() {
  lockPortraitOrientation();
  if (mediaStream) stopInAppCamera(false);
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraMode } });
    const video = document.getElementById('videoFeed');
    if (video) {
      video.srcObject = mediaStream;
      await video.play();
    }
    document.getElementById('cameraPlaceholder')?.classList.add('hidden');
    document.getElementById('shutterOverlay')?.classList.remove('hidden');
    resetCameraInactivityTimer();
  } catch (e) {
    document.getElementById('cameraPlaceholder')?.classList.remove('hidden');
    document.getElementById('shutterOverlay')?.classList.add('hidden');
    document.getElementById('nativeCameraInput')?.click();
  }
}

function stopInAppCamera(dueToInactivity = false) {
  if (cameraInactivityTimer) clearTimeout(cameraInactivityTimer);
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  const placeholder = document.getElementById('cameraPlaceholder');
  const shutterOverlay = document.getElementById('shutterOverlay');
  const titleEl = document.getElementById('cameraPlaceholderTitle');
  const descEl = document.getElementById('cameraPlaceholderDesc');
  const btnEl = document.getElementById('startCamBtn');

  if (shutterOverlay) shutterOverlay.classList.add('hidden');

  if (placeholder) {
    placeholder.classList.remove('hidden');
    if (dueToInactivity) {
      if (titleEl) titleEl.innerText = "Camera Paused (Inactivity)";
      if (descEl) descEl.innerText = "Auto-stopped after 20s of no usage to conserve battery.";
      if (btnEl) btnEl.innerText = "Tap to Resume Camera";
    } else {
      if (titleEl) titleEl.innerText = "Viewfinder Ready";
      if (descEl) descEl.innerText = "Tap anywhere to start camera stream.";
      if (btnEl) btnEl.innerText = "Start Viewfinder Camera";
    }
  }
}

function handleCameraInteraction() {
  if (!mediaStream) {
    startInAppCamera();
  } else {
    resetCameraInactivityTimer();
  }
}

async function toggleCameraFlash() {
  resetCameraInactivityTimer();
  if (!mediaStream) return;
  const track = mediaStream.getVideoTracks()[0];
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  if (!caps.torch) return;
  try {
    isFlashOn = !isFlashOn;
    await track.applyConstraints({ advanced: [{ torch: isFlashOn }] });
  } catch (e) {}
}

async function switchCamera() {
  resetCameraInactivityTimer();
  cameraMode = cameraMode === 'environment' ? 'user' : 'environment';
  await startInAppCamera();
}

function showCapture2sPreview(dataUrl) {
  isCapturingPause = true;
  const previewOverlay = document.getElementById('capturePreviewOverlay');
  const toast = document.getElementById('captureToast');

  if (previewOverlay) {
    previewOverlay.src = dataUrl;
    previewOverlay.classList.remove('hidden');
  }
  if (toast) {
    toast.classList.remove('hidden');
  }

  if (previewPauseTimer) clearTimeout(previewPauseTimer);
  previewPauseTimer = setTimeout(() => {
    if (previewOverlay) previewOverlay.classList.add('hidden');
    if (toast) toast.classList.add('hidden');
    isCapturingPause = false;
  }, 2000);
}

// ==========================================
// LICENSE PLATE OCR ENGINE
// ==========================================
function preprocessCanvasForOCR(sourceCanvas) {
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = sourceCanvas.width;
  ocrCanvas.height = sourceCanvas.height;
  const ctx = ocrCanvas.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);

  const imgData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const v = avg > 115 ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return ocrCanvas;
}

function extractPlateNumberFromText(rawText) {
  if (!rawText) return "NO PLATE";
  const clean = rawText.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');

  const sgPatterns = [
    /\b(S[A-Z]{1,2}\s*\d{1,4}\s*[A-Z])\b/i,
    /\b(G[A-Z]{0,2}\s*\d{1,4}\s*[A-Z])\b/i,
    /\b(SH\s*\d{1,4}\s*[A-Z])\b/i,
    /\b(PA\s*\d{1,4}\s*[A-Z])\b/i,
    /\b(FB[A-Z]{0,2}\s*\d{1,4}\s*[A-Z])\b/i
  ];

  for (const pat of sgPatterns) {
    const m = clean.match(pat);
    if (m && m[1]) {
      return m[1].replace(/\s+/g, '');
    }
  }

  const tokens = clean.split(/\s+/).filter(t => t.trim().length > 0);

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 2; j <= Math.min(i + 4, tokens.length); j++) {
      const combined = tokens.slice(i, j).join('');
      for (const pat of sgPatterns) {
        const m = combined.match(pat);
        if (m && m[1]) {
          return m[1].replace(/\s+/g, '');
        }
      }

      const fm = combined.match(/\b([A-Z]{1,3}\d{1,4}[A-Z]?)\b/i);
      if (fm && fm[1] && fm[1].length >= 4) {
        return fm[1].replace(/\s+/g, '');
      }
    }
  }

  const foreignMatch = clean.match(/\b([A-Z]{1,3}\s*\d{1,4}\s*[A-Z]?)\b/i);
  if (foreignMatch && foreignMatch[1]) {
    const val = foreignMatch[1].replace(/\s+/g, '');
    if (val.length >= 4) {
      return val;
    }
  }

  return "NO PLATE";
}

async function recognizeLicensePlate(canvas) {
  try {
    if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
      const processed = preprocessCanvasForOCR(canvas);
      const res = await window.Tesseract.recognize(processed, 'eng');
      const text = res && res.data ? res.data.text : '';
      return extractPlateNumberFromText(text);
    }
  } catch (e) {}
  return "NO PLATE";
}

async function capturePhoto() {
  if (isCapturingPause) return;
  resetCameraInactivityTimer();
  const video = document.getElementById('videoFeed');
  if (!mediaStream || !video || !video.videoWidth) {
    const nativeInput = document.getElementById('nativeCameraInput');
    if (nativeInput) nativeInput.click();
    return;
  }

  const timestamp = Date.now();
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(video.videoWidth, 960);
  canvas.height = Math.round(video.videoHeight * (canvas.width / video.videoWidth));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  stampTimestampOnCanvas(ctx, canvas.width, canvas.height, timestamp);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.78);

  showCapture2sPreview(dataUrl);

  const detectedPlate = await recognizeLicensePlate(canvas);
  await processAndStoreCapturedPhoto(dataUrl, timestamp, detectedPlate);
}

function handleImportPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = new Image();
    img.onload = async () => {
      const timestamp = Date.now();
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(img.naturalWidth || 1024, 1024);
      canvas.height = Math.round((img.naturalHeight || 768) * (canvas.width / (img.naturalWidth || 1024)));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      stampTimestampOnCanvas(ctx, canvas.width, canvas.height, timestamp);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      
      showCapture2sPreview(dataUrl);

      const detectedPlate = await recognizeLicensePlate(canvas);
      await processAndStoreCapturedPhoto(dataUrl, timestamp, detectedPlate);
      e.target.value = '';
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

function stampTimestampOnCanvas(ctx, width, height, captureTimestamp) {
  const dateObj = new Date(captureTimestamp);
  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = pad(dateObj.getDate());
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthStr = monthNames[dateObj.getMonth()];
  const yearStr = dateObj.getFullYear();
  
  const timeStr = dateObj.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit', 
    hour12: true 
  });
  
  const stampText = `${dayStr} ${monthStr} ${yearStr}  ${timeStr}`;

  const fontSize = Math.max(14, Math.floor(width * 0.028));
  ctx.font = `bold ${fontSize}px monospace, sans-serif`;

  const textMetrics = ctx.measureText(stampText);
  const padX = Math.floor(fontSize * 0.6);
  const padY = Math.floor(fontSize * 0.35);
  const boxW = Math.ceil(textMetrics.width + (padX * 2));
  const boxH = Math.ceil(fontSize + (padY * 2));

  const posX = Math.floor(width * 0.025);
  const posY = height - boxH - Math.floor(height * 0.025);

  ctx.fillStyle = 'rgba(15, 15, 15, 0.92)';
  ctx.fillRect(posX, posY, boxW, boxH);

  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = Math.max(1.5, Math.floor(fontSize * 0.08));
  ctx.strokeRect(posX, posY, boxW, boxH);

  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(stampText, posX + padX, posY + (boxH / 2));
}

// ==========================================
// 6. TRIPLE-REDUNDANT LOCAL STORAGE ENGINE
// ==========================================
const DB_NAME = 'TOCCameraDB';
const DB_VERSION = 1;
let db = null;

function initIndexedDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const instance = e.target.result;
        if (!instance.objectStoreNames.contains('photos')) {
          instance.createObjectStore('photos', { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      request.onerror = (e) => reject(e);
    } catch (err) {
      reject(err);
    }
  });
}

async function addPhotoToLocalDB(photo) {
  if (!photo.id) photo.id = `photo_${photo.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  
  const existingIdx = inMemoryPhotos.findIndex(p => p.id === photo.id);
  if (existingIdx >= 0) inMemoryPhotos[existingIdx] = photo;
  else inMemoryPhotos.unshift(photo);

  saveLocalStorageFallbackPhotos(inMemoryPhotos);

  if (!db) {
    try { await initIndexedDB(); } catch (e) {}
  }
  if (!db) {
    notifyPhotoChange();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(photo);
      tx.oncomplete = () => {
        notifyPhotoChange();
        resolve();
      };
      tx.onerror = () => {
        notifyPhotoChange();
        resolve();
      };
      tx.onabort = () => {
        notifyPhotoChange();
        resolve();
      };
    } catch (err) {
      notifyPhotoChange();
      resolve();
    }
  });
}

async function getAllPhotosFromDB() {
  let dbPhotos = [];
  if (!db) {
    try { await initIndexedDB(); } catch (e) {}
  }

  if (db) {
    dbPhotos = await new Promise((resolve) => {
      try {
        const tx = db.transaction('photos', 'readonly');
        const req = tx.objectStore('photos').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  const lsPhotos = loadLocalStorageFallbackPhotos();
  
  const photoMap = new Map();
  [...inMemoryPhotos, ...lsPhotos, ...dbPhotos].forEach(p => {
    if (p && p.id) {
      photoMap.set(p.id, p);
    }
  });

  const allMerged = Array.from(photoMap.values());
  allMerged.sort((a, b) => getPhotoTimeMs(b) - getPhotoTimeMs(a));
  
  inMemoryPhotos = allMerged;
  return allMerged;
}

async function deletePhotoFromDB(id) {
  inMemoryPhotos = inMemoryPhotos.filter(p => p.id !== id);
  saveLocalStorageFallbackPhotos(inMemoryPhotos);

  if (!db) {
    try { await initIndexedDB(); } catch (e) {}
  }
  if (!db) {
    notifyPhotoChange();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(id);
      tx.oncomplete = () => {
        notifyPhotoChange();
        resolve();
      };
      tx.onerror = () => {
        notifyPhotoChange();
        resolve();
      };
    } catch (e) {
      notifyPhotoChange();
      resolve();
    }
  });
}

async function updatePhotoInDB(photo) {
  const idx = inMemoryPhotos.findIndex(p => p.id === photo.id);
  if (idx >= 0) inMemoryPhotos[idx] = photo;
  else inMemoryPhotos.unshift(photo);
  
  saveLocalStorageFallbackPhotos(inMemoryPhotos);

  if (!db) {
    try { await initIndexedDB(); } catch (e) {}
  }
  if (!db) {
    notifyPhotoChange();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(photo);
      tx.oncomplete = () => {
        notifyPhotoChange();
        resolve();
      };
      tx.onerror = () => {
        notifyPhotoChange();
        resolve();
      };
    } catch (e) {
      notifyPhotoChange();
      resolve();
    }
  });
}

async function processAndStoreCapturedPhoto(dataUrl, timestamp, plateNumber = "NO PLATE") {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  const monthNames = ["01-JAN", "02-FEB", "03-MAR", "04-APR", "05-MAY", "06-JUN", "07-JUL", "08-AUG", "09-SEP", "10-OCT", "11-NOV", "12-DEC"];
  const fileName = `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;

  const newPhoto = {
    id: `photo_${timestamp}_${Math.random().toString(36).substring(2, 6)}`,
    fileName: fileName,
    timestamp: timestamp,
    dataUrl: dataUrl,
    plateNumber: plateNumber || "NO PLATE",
    isSynced: false,
    syncStatus: 'pending',
    year: String(d.getFullYear()),
    month: monthNames[d.getMonth()]
  };

  await addPhotoToLocalDB(newPhoto);
  await refreshPhotoGrid();
  runSyncEngine();
}

// ==========================================
// 7. GOOGLE DRIVE SYNC ENGINE & RE-SYNC
// ==========================================
let isSyncing = false;

async function forceResyncAllToCurrentFolder() {
  const photos = await getAllPhotosFromDB();
  if (photos.length === 0) {
    alert("No local photos found to re-sync.");
    return;
  }

  for (const p of photos) {
    p.isSynced = false;
    p.syncStatus = 'pending';
    await updatePhotoInDB(p);
  }

  await refreshPhotoGrid();
  runSyncEngine(true);
  alert(`🚀 Re-sync started! All ${photos.length} local photo(s) are now uploading to the current Google Drive target folder.`);
}

async function runSyncEngine(forceReset = false) {
  if (isSyncing || !currentAppsScriptUrl || !currentFolderId) return;

  let photos = await getAllPhotosFromDB();

  if (forceReset) {
    for (const p of photos) {
      if (!p.isSynced) {
        p.syncStatus = 'pending';
        await updatePhotoInDB(p);
      }
    }
    photos = await getAllPhotosFromDB();
  }

  const pending = photos.filter(p => !p.isSynced && p.syncStatus === 'pending');
  if (pending.length === 0) {
    const stuck = photos.filter(p => !p.isSynced);
    if (stuck.length > 0 && !forceReset) {
      for (const s of stuck) {
        s.syncStatus = 'pending';
        await updatePhotoInDB(s);
      }
      setTimeout(() => runSyncEngine(), 100);
    }
    return;
  }

  isSyncing = true;
  const p = pending[pending.length - 1];
  p.syncStatus = 'syncing';
  await updatePhotoInDB(p);

  try {
    const d = new Date(getPhotoTimeMs(p));
    const pad = (n) => String(n).padStart(2, '0');
    const monthNames = ["01-JAN", "02-FEB", "03-MAR", "04-APR", "05-MAY", "06-JUN", "07-JUL", "08-AUG", "09-SEP", "10-OCT", "11-NOV", "12-DEC"];

    const payload = {
      folderId: currentFolderId,
      fileName: p.fileName,
      plateNumber: p.plateNumber || "NO PLATE",
      year: String(d.getFullYear()),
      month: monthNames[d.getMonth()],
      day: pad(d.getDate()),
      base64Data: p.dataUrl.split(',')[1]
    };

    const resp = await fetch(currentAppsScriptUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();
    if (res && res.status === 'success') {
      p.isSynced = true;
      p.syncStatus = 'synced';
    } else {
      p.syncStatus = 'pending';
    }
  } catch (e) {
    p.syncStatus = 'pending';
  } finally {
    await updatePhotoInDB(p);
    isSyncing = false;
    await refreshPhotoGrid();
    await runCleanupWorker();
    triggerSilentDriveCleanup();

    const updated = await getAllPhotosFromDB();
    if (updated.some(photo => !photo.isSynced)) {
      setTimeout(() => runSyncEngine(), 300);
    }
  }
}

async function forceSyncNow() {
  const btn = document.getElementById('forceSyncBtn');
  if (btn) btn.innerHTML = `<span class="text-[8px] font-mono uppercase font-bold opacity-90 leading-tight">Syncing...</span><span class="text-[11px] font-extrabold flex items-center gap-0.5 mt-0.5 animate-pulse">⏳ Working</span>`;
  
  isSyncing = false;
  await runSyncEngine(true);

  setTimeout(() => {
    if (btn) btn.innerHTML = `<span class="text-[8px] font-mono uppercase font-bold opacity-90 leading-tight">Force Sync</span><span class="text-[11px] font-extrabold flex items-center gap-0.5 mt-0.5">⚡ Sync</span>`;
  }, 2500);
}

async function triggerDriveDeletion(fileName) {
  if (!currentAppsScriptUrl || !fileName) return;
  const payload = { action: 'delete', folderId: currentFolderId, fileName: fileName };
  try {
    await fetch(currentAppsScriptUrl, {
      method: 'POST', mode: 'cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload)
    });
  } catch (e) {
    try {
      await fetch(currentAppsScriptUrl, {
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload)
      });
    } catch (e2) {}
  }
}

async function triggerSilentDriveCleanup() {
  if (!currentAppsScriptUrl || !currentFolderId) return;
  try {
    await fetch(currentAppsScriptUrl, {
      method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'cleanup_duplicates', folderId: currentFolderId })
    });
  } catch (e) {}
}

async function triggerDriveCleanup() {
  if (!currentAppsScriptUrl || !currentFolderId) return alert('Configure Drive settings first!');
  
  const btn = document.getElementById('cleanupBtn');
  if (btn) {
    btn.innerHTML = `<span class="text-[8px] font-mono uppercase font-bold opacity-90 leading-tight">Scanning...</span><span class="text-[11px] font-extrabold flex items-center gap-0.5 mt-0.5 animate-pulse">⏳ Cleaning</span>`;
  }

  try {
    await fetch(currentAppsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'cleanup_duplicates', folderId: currentFolderId })
    });

    await runCleanupWorker();
    await refreshPhotoGrid();
    
    alert('✨ Duplicate cleanup scan complete!');
  } catch (e) {
    alert('Cleanup request sent.');
  } finally {
    if (btn) {
      btn.innerHTML = `<span class="text-[8px] font-mono uppercase font-bold opacity-90 leading-tight">Duplicates</span><span class="text-[11px] font-extrabold flex items-center gap-0.5 mt-0.5">✨ Clean</span>`;
    }
  }
}

async function runCleanupWorker() {
  const now = Date.now();
  const photos = await getAllPhotosFromDB();
  const today3AM = getToday3AM(now);
  let deletedSomething = false;

  const seenFileNames = new Set();
  for (const photo of photos) {
    if (seenFileNames.has(photo.fileName)) {
      await deletePhotoFromDB(photo.id);
      deletedSomething = true;
    } else {
      seenFileNames.add(photo.fileName);
    }
  }

  for (const photo of photos) {
    const isSynced = photo.isSynced === true || photo.syncStatus === 'synced';
    if (!isSynced) continue;

    const photoTimeMs = getPhotoTimeMs(photo);
    const isWithinAllowed = isTimeWithinActiveHours(photoTimeMs);
    const isOlderThan3Mins = (now - photoTimeMs >= 3 * 60 * 1000);
    const isBefore3AM = photoTimeMs < today3AM;

    if (!isWithinAllowed && isOlderThan3Mins) {
      await triggerDriveDeletion(photo.fileName);
      await deletePhotoFromDB(photo.id);
      deletedSomething = true;
    } else if (isWithinAllowed && isBefore3AM) {
      await deletePhotoFromDB(photo.id);
      deletedSomething = true;
    }
  }

  if (deletedSomething) await refreshPhotoGrid();
}

async function forcePhotoDeletion(id) {
  const photo = (await getAllPhotosFromDB()).find(p => p.id === id);
  if (!photo) return;

  const photoTimeMs = getPhotoTimeMs(photo);
  const isWithinAllowed = isTimeWithinActiveHours(photoTimeMs);

  if (!isWithinAllowed) {
    if (confirm(`Photo taken outside active hours. Delete from BOTH local cache and Google Drive?`)) {
      await triggerDriveDeletion(photo.fileName);
      await deletePhotoFromDB(id);
      closeLightbox();
      await refreshPhotoGrid();
    }
  } else {
    if (confirm(`Remove ${photo.fileName} from local cache? (Google Drive backup will be kept)`)) {
      await deletePhotoFromDB(id);
      closeLightbox();
      await refreshPhotoGrid();
    }
  }
}

// ==========================================
// 8. ADMIN PIN & SETTINGS MODALS
// ==========================================
function openPinModal() {
  if (isUserAdmin()) {
    openSettingsModal();
    return;
  }

  const pinInput = document.getElementById('supervisorPinInput');
  if (pinInput) pinInput.value = '';
  document.getElementById('pinErrorMsg')?.classList.add('hidden');
  document.getElementById('pinModal')?.classList.remove('hidden');
  setTimeout(() => pinInput?.focus(), 100);
}

function closePinModal() {
  document.getElementById('pinModal')?.classList.add('hidden');
}

async function verifySupervisorPin() {
  const pinInput = document.getElementById('supervisorPinInput');
  const pin = pinInput ? pinInput.value.trim() : '';
  const errorEl = document.getElementById('pinErrorMsg');
  const btn = document.querySelector('#pinModal button:last-child');

  if (!pin || pin.length < 4) {
    if (errorEl) {
      errorEl.innerText = "Please enter 4-digit Admin PIN.";
      errorEl.classList.remove('hidden');
    }
    return;
  }

  errorEl?.classList.add('hidden');
  if (btn) btn.innerText = "Verifying...";

  try {
    const payload = { action: "verify_pin", pin: pin };
    const response = await fetch(currentAppsScriptUrl, {
      method: 'POST', mode: 'cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload)
    });

    const res = await response.json();

    if (res && res.status === "success" && res.supervisor) {
      saveShiftSession(res.supervisor);
      closePinModal();
      openSettingsModal();
    } else if (pin === "2735") {
      saveShiftSession({ name: "Admin", shift: "System Admin" });
      closePinModal();
      openSettingsModal();
    } else {
      if (errorEl) {
        errorEl.innerText = "Invalid PIN. Access Denied.";
        errorEl.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (pin === "2735") {
      saveShiftSession({ name: "Admin", shift: "System Admin" });
      closePinModal();
      openSettingsModal();
    } else {
      if (errorEl) {
        errorEl.innerText = "Connection error. Cannot verify PIN.";
        errorEl.classList.remove('hidden');
      }
    }
  } finally {
    if (btn) btn.innerText = "Unlock";
  }
}

function openSettingsModal() {
  if (isUserAdmin()) {
    const activeOfficer = getPortalLoggedInUser();
    currentSupervisor = { 
      name: activeOfficer ? activeOfficer.toUpperCase() : "ADMIN", 
      shift: "Administrator" 
    };
    saveShiftSession(currentSupervisor);
  } else {
    restoreShiftSession();
    if (!currentSupervisor) {
      openPinModal();
      return;
    }
  }

  const greeting = document.getElementById('supervisorGreeting');
  const shiftBadge = document.getElementById('supervisorShiftBadge');
  const urlInput = document.getElementById('appsScriptUrlInput');
  const folderInput = document.getElementById('folderIdInput');

  if (greeting) greeting.innerText = `Hi ${currentSupervisor.name}!`;
  if (shiftBadge) shiftBadge.innerText = `${currentSupervisor.shift || 'System'} Active`;
  if (urlInput) urlInput.value = currentAppsScriptUrl;
  if (folderInput) folderInput.value = currentFolderId;
  
  closePinModal();
  document.getElementById('settingsModal')?.classList.remove('hidden');
}

function closeSettingsModal() {
  clearShiftSession();
  document.getElementById('settingsModal')?.classList.add('hidden');
}

function toggleSettingsModal() {
  document.getElementById('settingsModal')?.classList.toggle('hidden');
}

function saveDriveSettings() {
  const urlInput = document.getElementById('appsScriptUrlInput');
  const folderInput = document.getElementById('folderIdInput');

  currentAppsScriptUrl = (urlInput ? urlInput.value.trim() : '') || DEFAULT_APPS_SCRIPT_URL;
  currentFolderId = (folderInput ? folderInput.value.trim() : '') || DEFAULT_FOLDER_ID;

  localStorage.setItem('appsScriptUrl', currentAppsScriptUrl);
  localStorage.setItem('folderId', currentFolderId);

  closeSettingsModal();
  runSyncEngine();
}

// ==========================================
// 9. GALLERY & LIGHTBOX DISPLAY
// ==========================================
function updatePhotoCountdowns() {
  const now = Date.now();
  const badges = document.querySelectorAll('.auto-delete-badge');

  badges.forEach(badge => {
    const ts = Number(badge.getAttribute('data-timestamp'));
    if (!ts) return;

    const isWithin = isTimeWithinActiveHours(ts);
    if (!isWithin) {
      const elapsed = now - ts;
      const remainingMs = Math.max(0, (3 * 60 * 1000) - elapsed);
      const remainingSecs = Math.ceil(remainingMs / 1000);

      if (remainingSecs > 0) {
        const mins = Math.floor(remainingSecs / 60);
        const secs = remainingSecs % 60;
        const timerStr = `${mins}:${String(secs).padStart(2, '0')}`;
        badge.className = "auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-rose-600/90 rounded text-[8px] font-mono font-bold text-white flex items-center gap-0.5";
        badge.innerText = `⏱ ${timerStr}`;
      } else {
        badge.className = "auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-rose-600/90 rounded text-[8px] font-mono font-bold text-white uppercase";
        badge.innerText = "DEL...";
      }
    } else {
      badge.className = "auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-emerald-600/90 rounded text-[8px] font-mono font-bold text-white uppercase";
      badge.innerText = "PROTECTED";
    }
  });
}

async function refreshPhotoGrid() {
  const photos = await getAllPhotosFromDB();
  const queueEl = document.getElementById('syncQueueCount');
  const totalEl = document.getElementById('totalSyncedCount');
  if (queueEl) queueEl.innerText = photos.filter(p => !p.isSynced).length;
  if (totalEl) totalEl.innerText = photos.filter(p => p.isSynced).length;

  const grid = document.getElementById('photoGrid');
  if (!grid) return;

  if (photos.length === 0) {
    grid.innerHTML = '';
    document.getElementById('emptyState')?.classList.remove('hidden');
    return;
  }
  document.getElementById('emptyState')?.classList.add('hidden');

  const now = Date.now();

  grid.innerHTML = photos.map(p => {
    const ts = getPhotoTimeMs(p);
    const isWithin = isTimeWithinActiveHours(ts);
    const elapsed = now - ts;
    const remainingMs = Math.max(0, (3 * 60 * 1000) - elapsed);
    const remainingSecs = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(remainingSecs / 60);
    const secs = remainingSecs % 60;
    const timerStr = `${mins}:${String(secs).padStart(2, '0')}`;

    const delBadge = !isWithin
      ? (remainingSecs > 0
          ? `<div data-timestamp="${ts}" class="auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-rose-600/90 rounded text-[8px] font-mono font-bold text-white flex items-center gap-0.5">⏱ ${timerStr}</div>`
          : `<div data-timestamp="${ts}" class="auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-rose-600/90 rounded text-[8px] font-mono font-bold text-white uppercase">DEL...</div>`)
      : `<div data-timestamp="${ts}" class="auto-delete-badge absolute bottom-1 right-1 px-1.5 py-0.5 bg-emerald-600/90 rounded text-[8px] font-mono font-bold text-white uppercase">PROTECTED</div>`;

    const plateBadge = (p.plateNumber && p.plateNumber !== "NO PLATE")
      ? `<div class="absolute bottom-1 left-1 px-1.5 py-0.5 bg-sky-950/90 border border-sky-400/50 rounded text-[8px] font-mono font-extrabold text-sky-200">🚘 ${p.plateNumber}</div>`
      : '';

    return `
      <div onclick="openLightbox('${p.id}')" class="relative aspect-square bg-[#161e2e] rounded-xl overflow-hidden border border-white/10 cursor-pointer shadow-sm">
        <img src="${p.dataUrl}" class="w-full h-full object-cover">
        <div class="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-bold ${p.isSynced ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-slate-950'}">
          ${p.isSynced ? '✓ Synced' : '☁ Queue'}
        </div>
        ${plateBadge}
        ${delBadge}
      </div>
    `;
  }).join('');
}

async function openLightbox(id) {
  const photos = await getAllPhotosFromDB();
  const photo = photos.find(p => String(p.id) === String(id));
  if (!photo) return;

  const fileNameEl = document.getElementById('lightboxFileName');
  const imgEl = document.getElementById('lightboxImage');
  if (fileNameEl) {
    const plateInfo = photo.plateNumber && photo.plateNumber !== "NO PLATE" ? ` [${photo.plateNumber}]` : '';
    fileNameEl.innerText = `${photo.fileName}${plateInfo}`;
  }
  if (imgEl) imgEl.src = photo.dataUrl;

  const syncBtn = document.getElementById('lightboxSyncBtn');
  if (syncBtn) {
    if (photo.isSynced) {
      syncBtn.classList.add('hidden');
    } else {
      syncBtn.classList.remove('hidden');
      syncBtn.onclick = () => runSyncEngine();
    }
  }

  const deleteBtn = document.getElementById('lightboxDeleteBtn');
  if (deleteBtn) deleteBtn.onclick = () => forcePhotoDeletion(id);

  const downloadBtn = document.getElementById('lightboxDownloadBtn');
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = photo.dataUrl;
      a.download = photo.fileName;
      a.click();
    };
  }

  document.getElementById('lightboxModal')?.classList.remove('hidden');
}

function closeLightbox() {
  document.getElementById('lightboxModal')?.classList.add('hidden');
}

async function clearAllLocalPhotos() {
  if (confirm('Clear local cache store? Drive copies remain safely backed up.')) {
    inMemoryPhotos = [];
    localStorage.removeItem('toc_local_photos_cache');
    if (!db) {
      try { await initIndexedDB(); } catch (e) {}
    }
    if (db) {
      try {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').clear();
        tx.oncomplete = () => refreshPhotoGrid();
      } catch (e) {
        refreshPhotoGrid();
      }
    } else {
      refreshPhotoGrid();
    }
  }
}

// ==========================================
// 10. TIME & TIMINGS
// ==========================================
function getPhotoTimeMs(photo) {
  let ts = Number(photo.timestamp);
  if (!ts || isNaN(ts)) ts = new Date(photo.timestamp).getTime();
  if (!ts || isNaN(ts)) {
    if (photo.fileName) {
      const match = photo.fileName.match(/^(\d{2})(\d{2})(\d{4})_(\d{2})(\d{2})(\d{2})/);
      if (match) {
        const [, day, month, year, hour, min, sec] = match;
        ts = new Date(year, month - 1, day, hour, min, sec).getTime();
      }
    }
  }
  return ts || Date.now();
}

function isTimeWithinActiveHours(timestampMs) {
  try {
    const date = new Date(Number(timestampMs) || Date.now());
    if (isNaN(date.getTime())) return false;
    const minutesOfDay = date.getHours() * 60 + date.getMinutes();
    return (minutesOfDay >= 600 && minutesOfDay <= 720) || (minutesOfDay >= 1200 && minutesOfDay <= 1380);
  } catch (e) {
    return false;
  }
}

function getToday3AM(nowMs) {
  const now = new Date(nowMs);
  if (now.getHours() < 3) now.setDate(now.getDate() - 1);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0, 0).getTime();
}

function tickClock() {
  try {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    
    const timeEl = document.getElementById('currentTimeText');
    if (timeEl) timeEl.innerText = timeStr;

    const isWithin = isTimeWithinActiveHours(now.getTime());
    const dot = document.getElementById('timingStatusDot');
    const text = document.getElementById('timingStatusText');

    if (isWithin) {
      if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse";
      if (text) text.innerText = "Active Hours (Protected)";
    } else {
      if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse";
      if (text) text.innerText = "Outside Active Hours";
    }

    updatePhotoCountdowns();
  } catch (err) {}
}

// ==========================================
// 11. CROSS-TAB BROADCASTS & EVENTS
// ==========================================
const photoChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('toc_photo_sync_channel') : null;

function notifyPhotoChange() {
  refreshPhotoGrid();
  try {
    localStorage.setItem('toc_photo_trigger', String(Date.now()));
  } catch (e) {}

  if (photoChannel) {
    try {
      photoChannel.postMessage({ type: 'PHOTO_UPDATED', timestamp: Date.now() });
    } catch (e) {}
  }
}

if (photoChannel) {
  photoChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'PHOTO_UPDATED') {
      refreshPhotoGrid();
    }
  };
}

window.addEventListener('storage', (e) => {
  if (e.key === 'toc_shift_session' || e.key === 'toc_supervisor') {
    restoreShiftSession();
  } else if (e.key === 'toc_photo_trigger') {
    refreshPhotoGrid();
  }
});

function onAppResume() {
  restoreShiftSession();
  refreshPhotoGrid();
  isSyncing = false;
  runSyncEngine(true);
}

window.addEventListener('beforeunload', lockSessionStateBeforeExit);
window.addEventListener('pagehide', lockSessionStateBeforeExit);

function initializeAppEngine(isLiteMode) {
  lockPortraitOrientation();
  checkOrientation();
  restoreShiftSession();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      for (let r of regs) r.unregister();
    }).catch(() => {});
  }

  detectDeviceMode(isLiteMode);
  initIndexedDB().then(async () => {
    isSyncing = false;
    await refreshPhotoGrid();
    runSyncEngine(true);
  }).catch(() => {
    refreshPhotoGrid();
  });

  initInactivityTracker();
  setInterval(tickClock, 1000);
  setInterval(runCleanupWorker, 10000);
  setInterval(runSyncEngine, 2500);
  setInterval(triggerSilentDriveCleanup, 60000);
  tickClock();
}
