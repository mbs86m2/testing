/* ==============================================================
   PARKING VIOLATION LOG ASSISTANT - APPLICATION LOGIC (app.js)
   Includes Portal-Level Back-Swipe Routing & Forward-Swipe Blocking
   ============================================================== */

// ==============================================================
// 1. BACK-SWIPE TO MAIN MOBILE PORTAL (Main Section Rule)
// ==============================================================
(function() {
  const PORTAL_URL = '../index.html';
  try {
    document.documentElement.style.overscrollBehaviorX = 'none';
    document.body.style.overscrollBehaviorX = 'none';
  } catch(e) {}

  if (window.history && window.history.pushState) {
    window.history.pushState({ isSectionIndex: true }, '', window.location.href);
    window.addEventListener('popstate', function() {
      window.location.replace(PORTAL_URL);
    });
  }
})();

// ==============================================================
// 2. CONFIGURATION RESOLVERS
// ==============================================================
function getActiveParkingApiUrl() {
  let masterCfg = null;
  try { masterCfg = JSON.parse(localStorage.getItem("wafp_master_config")); } catch (e) {}

  return localStorage.getItem("PARKING_API_URL") || 
         localStorage.getItem("parking_api_url") || 
         (masterCfg && masterCfg.SECTION_API_URLS && masterCfg.SECTION_API_URLS.PARKING) || 
         (masterCfg && masterCfg.API_URL) || 
         "https://script.google.com/macros/s/AKfycbz5QdZFTZeuzG-N4vlJwUBFJZ9cK8akHVjxORQjAsTg0neZY8_x60ZUsdtw_qtWH02Y/exec";
}

function getActiveParkingSpreadsheetId() {
  let masterCfg = null;
  try { masterCfg = JSON.parse(localStorage.getItem("wafp_master_config")); } catch (e) {}

  return localStorage.getItem("PARKING_SPREADSHEET_ID") || 
         localStorage.getItem("parking_sheet_id") || 
         (masterCfg && masterCfg.SPREADSHEET_IDS && masterCfg.SPREADSHEET_IDS.PARKING) || 
         "10IARDKGoFNxOaGVcdgyw3DDix1rqbxm_3qL55Zn4oVo";
}

let GAS_API_URL = getActiveParkingApiUrl();
const PORTAL_URL = "../index.html";
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

// ==============================================================
// 3. STATE & VARIABLES
// ==============================================================
let currentStep = 1;
let payload = { officer: null, level: null, plateImage: null, noticeImage: null, vehicleImage: null };
let isSettingsUnlocked = false;
const SETTINGS_PASSWORD = "wisma123";
let activeSearchResults = [];
let itemPendingDeletion = null;
let activeEditQueueIndex = null;

let batchQueue = [];
try {
  let rawQueue = localStorage.getItem('wisma_batch_queue');
  if (rawQueue && rawQueue !== "undefined" && rawQueue !== "null") {
    batchQueue = JSON.parse(rawQueue);
  }
  if (!Array.isArray(batchQueue)) batchQueue = [];
} catch (e) {
  batchQueue = [];
}

// ==============================================================
// 4. INITIALIZATION
// ==============================================================
window.addEventListener('load', () => {
  GAS_API_URL = getActiveParkingApiUrl();
  const activeOfficer = getPortalLoggedInUser();
  const officerInput = document.getElementById('officer-name-input');
  if (officerInput && activeOfficer) {
    officerInput.value = activeOfficer.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
  }
  checkValidation();
  renderBatchQueue();
  updatePlateCameraButtonState();
});

// ==============================================================
// 5. FORMATTING & HELPERS
// ==============================================================
function formatOfficerName(input) {
  if (!input || !input.value) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
  if (start !== null && end !== null) {
    try { input.setSelectionRange(start, end); } catch (e) {}
  }
}

function formatDriveImageUrl(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') return '';
  const str = inputStr.trim();
  if (str.startsWith('data:image')) return str;
  const match = str.match(/(?:\/d\/|id=)([a-zA-Z0-9_-]{25,})/);
  if (match && match[1]) return 'https://lh3.googleusercontent.com/d/' + match[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(str)) return 'https://lh3.googleusercontent.com/d/' + str;
  return str;
}

function formatTimeTo12Hour(timeStr) {
  if (!timeStr || !timeStr.includes(":")) return timeStr || "—";
  const parts = timeStr.split(":");
  let hrs = parseInt(parts[0], 10);
  let mins = parts[1];
  const ampm = hrs >= 12 ? 'pm' : 'am';
  hrs = hrs % 12;
  hrs = hrs ? hrs : 12; 
  return `${hrs}.${mins}${ampm}`;
}

function showToast(msg) {
  const toast = document.getElementById('toast-notification');
  const message = document.getElementById('toast-message');
  message.innerText = msg;
  toast.classList.remove('hidden');
  setTimeout(() => { toast.classList.add('hidden'); }, 3000);
}

function showGlobalLoader(msg) {
  document.getElementById('loader-message').innerText = msg;
  document.getElementById('loader-overlay').classList.remove('hidden');
}

function hideGlobalLoader() {
  document.getElementById('loader-overlay').classList.add('hidden');
}

// ==============================================================
// 6. API CALL ENGINE
// ==============================================================
async function apiCall(action, data = {}) {
  GAS_API_URL = getActiveParkingApiUrl();
  const spreadsheetId = getActiveParkingSpreadsheetId();

  if (!GAS_API_URL) return { status: "error", message: "GAS_API_URL missing." };

  const postPayload = { 
    action: action, 
    spreadsheetId: spreadsheetId,
    data: { ...data, spreadsheetId: spreadsheetId } 
  };

  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      body: JSON.stringify(postPayload)
    });
    const rawText = await response.text();
    try {
      return JSON.parse(rawText);
    } catch (jsonErr) {
      return { status: "error", message: "Invalid response from server." };
    }
  } catch (err) {
    return { status: "error", message: "Network connection error." };
  }
}

// ==============================================================
// 7. LOOKUP & SETTINGS MODAL
// ==============================================================
function openSettingsPrompt() {
  if (isSettingsUnlocked || isUserAdmin()) {
    isSettingsUnlocked = true;
    showSettingsScreen();
    loadRecentViolationsDefault();
  } else {
    const passInput = document.getElementById('input-settings-password');
    if (passInput) passInput.value = '';
    const modal = document.getElementById('password-modal');
    if (modal) modal.classList.remove('hidden');
    setTimeout(() => { if (passInput) passInput.focus(); }, 150);
  }
}

function closePasswordPrompt() {
  document.getElementById('password-modal').classList.add('hidden');
}

function verifySettingsPassword() {
  const typedPass = document.getElementById('input-settings-password').value.trim();
  if (typedPass === SETTINGS_PASSWORD) {
    isSettingsUnlocked = true;
    closePasswordPrompt();
    showSettingsScreen();
    loadRecentViolationsDefault();
  } else {
    showToast("Incorrect lookup password.");
  }
}

function handlePasswordKeydown(event) {
  if (event.key === "Enter" || event.keyCode === 13) {
    event.preventDefault();
    verifySettingsPassword();
  }
}

function showSettingsScreen() {
  document.getElementById('main-logging-container').classList.add('hidden');
  document.getElementById('capture-stepper').classList.add('hidden');
  document.getElementById('queue-box-container').classList.add('hidden');
  document.getElementById('settings-screen').classList.remove('hidden');
  document.getElementById('search-query-input').focus();
}

function closeSettingsScreen() {
  isSettingsUnlocked = false;
  document.getElementById('search-query-input').value = '';
  document.getElementById('search-results').innerHTML = '<p class="text-xs text-slate-400 font-medium text-center py-10">Enter a plate query to scan the database records.</p>';
  document.getElementById('search-flag-stats').classList.add('hidden');
  activeSearchResults = [];

  document.getElementById('settings-screen').classList.add('hidden');
  document.getElementById('main-logging-container').classList.remove('hidden');
  document.getElementById('capture-stepper').classList.remove('hidden');
  renderBatchQueue();
}

function handleSearchInputChange(input) {
  const query = input.value.trim();
  if (query === "") {
    document.getElementById('search-flag-stats').classList.add('hidden');
    loadRecentViolationsDefault();
  }
}

function handleSearchKeydown(event) {
  if (event.key === "Enter" || event.keyCode === 13) {
    event.preventDefault();
    performAppSearch();
  }
}

async function performAppSearch() {
  const query = document.getElementById('search-query-input').value.trim();
  if (!query) {
    showToast("Please enter a plate query.");
    return;
  }
  showGlobalLoader("Searching Google Sheet database...");
  const response = await apiCall("searchViolations", { query: query });
  hideGlobalLoader();

  if (response && response.status === "success") {
    activeSearchResults = response.results || [];
    displaySearchResults(response.results, query);
  } else {
    showToast("Search failed: " + (response ? response.message : "Error"));
  }
}

function displaySearchResults(results, query) {
  const resultsDiv = document.getElementById('search-results');
  const statsDiv = document.getElementById('search-flag-stats');
  const countSpan = document.getElementById('search-flag-count');

  resultsDiv.innerHTML = '';
  if (!results || results.length === 0) {
    statsDiv.classList.add('hidden');
    resultsDiv.innerHTML = `<p class="text-xs text-rose-700 font-bold text-center py-8">No records match: "${query.toUpperCase()}"</p>`;
    return;
  }

  statsDiv.classList.remove('hidden');
  countSpan.innerText = results.length;

  results.forEach(item => {
    const card = document.createElement('div');
    card.className = "p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl space-y-1 text-xs text-slate-800 shadow-sm cursor-pointer transition active:scale-[0.98]";
    card.onclick = (e) => {
      if (!e.target.closest('button')) openPhotoViewerModal(item);
    };

    card.innerHTML = `
      <div class="flex justify-between items-center border-b border-slate-200 pb-1">
        <span class="font-extrabold text-sky-800 text-sm tracking-wide">${item.plate || item.plateNumber}</span>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-slate-500 font-bold">${item.level}</span>
          <button type="button" onclick="openConfirmDeleteModal('${item.date}', '${item.time}', '${item.plate || item.plateNumber}')" class="p-1 hover:bg-rose-100 text-rose-700 rounded-lg transition" title="Delete record and photos">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
      <div class="space-y-0.5 text-[11px] text-slate-600 pt-1">
        <div class="flex justify-between">
          <span><strong>Date:</strong> ${item.date}</span>
          <span><strong>Time:</strong> ${item.time}</span>
        </div>
        <div class="flex justify-between items-center pt-0.5">
          <span><strong>Officer:</strong> ${item.officer || item.officerName}</span>
          <span class="text-[10px] text-sky-700 font-bold underline">Tap to view photos 📷</span>
        </div>
      </div>
    `;
    resultsDiv.appendChild(card);
  });
}

async function loadRecentViolationsDefault() {
  const resultsDiv = document.getElementById('search-results');
  resultsDiv.innerHTML = `
    <div class="flex items-center justify-center py-12 gap-2 text-slate-500 text-xs font-semibold">
      <div class="animate-spin rounded-full h-4 w-4 border-2 border-t-sky-600 border-slate-300"></div>
      Loading recent records...
    </div>
  `;
  const response = await apiCall("getRecentViolations");
  displayRecentViolations(response);
}

function displayRecentViolations(response) {
  const resultsDiv = document.getElementById('search-results');
  resultsDiv.innerHTML = '';
  
  if (response && response.status === "success" && response.results && response.results.length > 0) {
    const results = response.results;
    const container = document.createElement('div');
    container.className = "space-y-1 font-mono text-[11px] text-slate-800 bg-slate-50 border border-slate-200 p-3 rounded-xl max-h-[250px] overflow-y-auto shadow-inner animate-fade-in";
    
    results.forEach(item => {
      const formattedTime = formatTimeTo12Hour(item.time);
      const plateNo = item.plate || item.plateNumber || 'UNKNOWN';

      const row = document.createElement('div');
      row.className = "flex justify-between items-center py-2 px-1 border-b border-slate-200 last:border-0 hover:bg-slate-100 rounded-lg cursor-pointer transition";
      row.onclick = (e) => {
        if (!e.target.closest('button')) openPhotoViewerModal(item);
      };

      row.innerHTML = `
        <div class="flex items-center gap-1.5">
          <span class="font-bold text-slate-900 tracking-wide">${plateNo}</span>
          <span class="text-[9px] text-slate-500 font-bold">(${item.level})</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-[10px] text-slate-500 text-center">${item.date}</span>
          <span class="text-slate-700 text-right w-14 text-[10px]">${formattedTime}</span>
          <button type="button" onclick="openConfirmDeleteModal('${item.date}', '${item.time}', '${plateNo}')" class="p-1 hover:bg-rose-100 text-rose-700 rounded-lg transition" title="Delete record and photos">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      `;
      container.appendChild(row);
    });
    resultsDiv.appendChild(container);
  } else {
    resultsDiv.innerHTML = `<p class="text-xs text-slate-400 font-medium text-center py-10">No recent vehicle logs found.</p>`;
  }
}

// ==============================================================
// 8. RECORD VIEWER, PRINT & EXPORT
// ==============================================================
function openPhotoViewerModal(record) {
  document.getElementById('modal-detail-plate').innerText = record.plate || record.plateNumber || 'UNKNOWN';
  document.getElementById('modal-detail-meta').innerText = `${record.date || ''} at ${formatTimeTo12Hour(record.time) || ''}`;
  document.getElementById('modal-detail-officer').innerText = record.officer || record.officerName || '—';
  document.getElementById('modal-detail-level-badge').innerText = `Lvl ${record.level || '—'}`;

  const placeholder = 'https://via.placeholder.com/400x250?text=No+Photo+Available';
  const rawPlate = record.plateUrl || record.platePhoto || record.plateImage || record.plate_photo || record.plateId || record[5] || '';
  const rawNotice = record.noticeUrl || record.noticePhoto || record.noticeImage || record.notice_photo || record.noticeId || record[6] || '';
  const rawVehicle = record.vehicleUrl || record.vehiclePhoto || record.vehicleImage || record.vehicle_photo || record.vehicleId || record[7] || '';

  document.getElementById('modal-img-plate').src = formatDriveImageUrl(rawPlate) || placeholder;
  document.getElementById('modal-img-notice').src = formatDriveImageUrl(rawNotice) || placeholder;
  document.getElementById('modal-img-vehicle').src = formatDriveImageUrl(rawVehicle) || placeholder;
  document.getElementById('photo-viewer-modal').classList.remove('hidden');
}

function closePhotoViewerModal() {
  document.getElementById('photo-viewer-modal').classList.add('hidden');
}

function zoomImage(srcUrl) {
  if (srcUrl && !srcUrl.includes('placeholder')) window.open(srcUrl, '_blank');
}

function printSearchResults() {
  if (activeSearchResults.length === 0) return;
  const printWindow = window.open('', '_blank');
  let rowsHtml = '';
  
  activeSearchResults.forEach(item => {
    rowsHtml += `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px; font-weight: bold; color: #0284c7;">${item.plate || item.plateNumber}</td>
        <td style="padding: 10px;">${item.date}</td>
        <td style="padding: 10px;">${item.time}</td>
        <td style="padding: 10px;">${item.level}</td>
        <td style="padding: 10px;">${item.officer || item.officerName}</td>
      </tr>
    `;
  });

  printWindow.document.write(`
    <html>
    <head>
      <title>Wisma Atria Parking Violation Report</title>
      <style>
        body { font-family: -apple-system, sans-serif; margin: 30px; color: #0f172a; }
        h1 { font-size: 20px; border-bottom: 2px solid #0284c7; padding-bottom: 10px; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background-color: #f1f5f9; text-align: left; padding: 10px; font-size: 13px; color: #1e293b; border-bottom: 1px solid #cbd5e1; }
        .meta { font-size: 13px; margin-bottom: 20px; line-height: 1.5; }
        .footer { margin-top: 35px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
      </style>
    </head>
    <body>
      <h1>Wisma Atria Parking Violation History</h1>
      <div class="meta">
        <strong>Target Query:</strong> ${document.getElementById('search-query-input').value.toUpperCase()}<br>
        <strong>Total Occurrences:</strong> ${activeSearchResults.length} time(s) flagged
      </div>
      <table>
        <thead><tr><th>License Plate</th><th>Date</th><th>Time</th><th>Carpark Level</th><th>Officer Name</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="footer">Report printed on ${new Date().toLocaleString()} | Wisma Atria Parking Log Assistant</div>
      <script>window.onload = function() { window.print(); window.close(); }<\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

function emailSearchResults() {
  if (activeSearchResults.length === 0) return;
  let queryVal = document.getElementById('search-query-input').value.toUpperCase();
  let bodyText = `Wisma Atria Parking Violation History\nQuery: ${queryVal}\nTotal Flagged: ${activeSearchResults.length} occurrence(s)\n\n`;
  
  activeSearchResults.forEach((item, idx) => {
    bodyText += `${idx + 1}. Plate: ${item.plate || item.plateNumber} | Date: ${item.date} | Time: ${item.time} | Level: ${item.level} | Officer: ${item.officer || item.officerName}\n`;
  });
  
  bodyText += `\nReport generated on ${new Date().toLocaleString()}\nWisma Atria Parking Log Assistant`;
  window.location.href = `mailto:?subject=${encodeURIComponent(`Parking Violation Report: ${queryVal}`)}&body=${encodeURIComponent(bodyText)}`;
}

// ==============================================================
// 9. RECORD DELETION
// ==============================================================
function openConfirmDeleteModal(date, time, plate) {
  itemPendingDeletion = { date: date, time: time, plate: plate };
  document.getElementById('del-modal-plate').innerText = plate;
  document.getElementById('delete-confirm-modal').classList.remove('hidden');
}

function closeConfirmDeleteModal() {
  document.getElementById('delete-confirm-modal').classList.add('hidden');
  itemPendingDeletion = null;
}

async function executeRecordDeletion() {
  if (!itemPendingDeletion) return;
  const target = itemPendingDeletion; 
  closeConfirmDeleteModal();
  showGlobalLoader("Deleting record and trashing related photos...");
  const response = await apiCall("deleteViolationRecord", target);
  hideGlobalLoader();

  if (response && response.status === "success") {
    showToast("Record successfully deleted!");
    const query = document.getElementById('search-query-input').value.trim();
    if (query) performAppSearch();
    else loadRecentViolationsDefault();
  } else {
    showToast("Deletion failed: " + (response ? response.message : "Error"));
  }
}

// ==============================================================
// 10. STEPPER & CAMERA LOGGING
// ==============================================================
function triggerCameraInput(type) {
  document.getElementById('file-' + type).click();
}

function selectLevel(num) {
  payload.level = num;
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.remove('bg-gradient-to-r', 'from-sky-600', 'to-blue-600', 'text-white', 'border-sky-500', 'shadow-md');
    btn.classList.add('border-slate-300', 'text-slate-700', 'bg-slate-100');
  });
  const selectedBtn = document.getElementById('btn-lvl-' + num);
  if (selectedBtn) {
    selectedBtn.classList.remove('border-slate-300', 'text-slate-700', 'bg-slate-100');
    selectedBtn.classList.add('bg-gradient-to-r', 'from-sky-600', 'to-blue-600', 'text-white', 'border-sky-500', 'shadow-md');
  }
  updatePlateCameraButtonState();
  checkValidation();
}

function updatePlateCameraButtonState() {
  const officerName = document.getElementById('officer-name-input').value.trim();
  const btn = document.getElementById('btn-plate-camera');
  const icon = document.getElementById('plate-camera-icon');
  const text = document.getElementById('plate-camera-text');
  if (!btn || !icon || !text) return;

  if (officerName && payload.level) {
    btn.className = "w-full flex flex-col items-center justify-center border-2 border-dashed border-sky-400 py-10 rounded-2xl bg-sky-50 hover:bg-sky-100 active:scale-95 transition cursor-pointer shadow-md";
    icon.className = "h-10 w-10 text-sky-700 mb-2 transition";
    text.className = "text-xs font-extrabold text-sky-900";
    text.innerText = "Open Camera to take Plate Photo";
  } else {
    btn.className = "w-full flex flex-col items-center justify-center border-2 border-dashed border-slate-300 py-10 rounded-2xl transition bg-slate-100 opacity-60 cursor-not-allowed";
    icon.className = "h-10 w-10 text-slate-400 mb-2 transition";
    text.className = "text-xs font-bold text-slate-500";
    if (!officerName && !payload.level) text.innerText = "Enter Name & Level to unlock camera";
    else if (!officerName) text.innerText = "Enter Officer Name to unlock camera";
    else text.innerText = "Select Carpark Level to unlock camera";
  }
}

function handlePlateCameraClick() {
  const officerName = document.getElementById('officer-name-input').value.trim();
  if (!officerName) {
    showToast("Please enter your Officer Name first!");
    document.getElementById('officer-name-input').focus();
    return;
  }
  if (!payload.level) {
    showToast("Please select a Carpark Level first!");
    return;
  }
  triggerCameraInput('plate');
}

function retakePhoto(type) {
  payload[type + 'Image'] = null;
  document.getElementById('file-' + type).value = '';
  document.getElementById(type + '-preview-img').src = '';
  document.getElementById(type + '-preview-box').classList.add('hidden');
  
  const trigger = document.getElementById(type + '-capture-trigger');
  if (trigger) trigger.classList.remove('hidden');

  if (type === 'plate') updatePlateCameraButtonState();
  checkValidation();
  triggerCameraInput(type);
}

function processCapturedFile(input, type) {
  if (input.files && input.files[0]) {
    showGlobalLoader("Applying high-contrast timestamp...");
    const file = input.files[0];
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function(event) {
      input.value = ''; 
      const img = new Image();
      img.src = event.target.result;
      img.onload = function() {
        const stampedBase64 = processAndTimestamp(img);
        payload[type + 'Image'] = stampedBase64;
        
        const previewImg = document.getElementById(type + '-preview-img');
        if (previewImg) previewImg.src = stampedBase64;
        
        const previewBox = document.getElementById(type + '-preview-box');
        if (previewBox) previewBox.classList.remove('hidden');
        
        const trigger = document.getElementById(type + '-capture-trigger');
        if (trigger) trigger.classList.add('hidden');
        
        hideGlobalLoader();
        checkValidation();
        if (type === 'vehicle') addCurrentToBatchQueue();
        else changeStep(1); 
      };
    };
  }
}

function processAndTimestamp(img) {
  const maxDim = 768; 
  let width = img.width;
  let height = img.height;

  if (width > height) {
    if (width > maxDim) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    }
  } else {
    if (height > maxDim) {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const now = new Date();
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dd = ("0" + now.getDate()).slice(-2);
  const mmm = months[now.getMonth()];
  const yyyy = now.getFullYear();
  const hh = ("0" + now.getHours()).slice(-2);
  const min = ("0" + now.getMinutes()).slice(-2);
  const ss = ("0" + now.getSeconds()).slice(-2);
  const timestampString = `${dd}-${mmm}-${yyyy} ${hh}:${min}:${ss}`;

  const fontSize = Math.max(13, Math.round(width * 0.035));
  ctx.font = `bold ${fontSize}px monospace`;
  const textWidth = ctx.measureText(timestampString).width;
  const pad = 8;
  const rectX = 15;
  const rectY = height - fontSize - (pad * 2) - 15;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(rectX, rectY, textWidth + (pad * 2), fontSize + (pad * 2));
  ctx.fillStyle = '#FFFF00'; 
  ctx.textBaseline = 'top';
  ctx.fillText(timestampString, rectX + pad, rectY + pad);

  return canvas.toDataURL('image/jpeg', 0.85);
}

function checkValidation() {
  const nextBtn = document.getElementById('btn-next');
  const officerName = document.getElementById('officer-name-input').value.trim();
  if (currentStep === 1) nextBtn.disabled = !(payload.level && payload.plateImage && officerName);
  else if (currentStep === 2) nextBtn.disabled = !payload.noticeImage;
  else if (currentStep === 3) nextBtn.disabled = !payload.vehicleImage;
  else nextBtn.disabled = false;
}

function changeStep(val) {
  if (currentStep === 3 && val === 1) return; 

  document.getElementById('step-' + currentStep).classList.add('hidden');
  currentStep += val;
  document.getElementById('step-' + currentStep).classList.remove('hidden');

  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById('step' + i + '-dot');
    const line = document.getElementById('line' + i);
    if (i < currentStep) {
      dot.className = "w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center font-extrabold text-xs";
      if (line) line.className = "flex-1 h-0.5 bg-emerald-600 mx-2";
    } else if (i === currentStep) {
      dot.className = "w-7 h-7 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 text-white flex items-center justify-center font-extrabold text-xs shadow-md shadow-sky-600/20";
      if (line) line.className = "flex-1 h-0.5 bg-slate-300 mx-2";
    } else {
      dot.className = "w-7 h-7 rounded-full bg-slate-200 text-slate-600 border border-slate-300 flex items-center justify-center font-extrabold text-xs";
      if (line) line.className = "flex-1 h-0.5 bg-slate-300 mx-2";
    }
  }

  document.getElementById('btn-back').classList.toggle('hidden', currentStep === 1);
  const nextBtn = document.getElementById('btn-next');
  if (nextBtn) nextBtn.classList.toggle('hidden', currentStep === 3);
  checkValidation();
}

// ==============================================================
// 11. BATCH QUEUE & EDITING
// ==============================================================
function addCurrentToBatchQueue() {
  const officerName = document.getElementById('officer-name-input').value.trim();
  const itemToQueue = {
    id: Date.now(),
    officer: officerName, 
    level: payload.level,
    plateImage: payload.plateImage,
    noticeImage: payload.noticeImage,
    vehicleImage: payload.vehicleImage
  };
  
  batchQueue.push(itemToQueue);
  try { localStorage.setItem('wisma_batch_queue', JSON.stringify(batchQueue)); } catch(e){}
  renderBatchQueue();
  showToast("Added to pending queue!");
  resetApp();
}

function renderBatchQueue() {
  const container = document.getElementById('queue-box-container');
  const list = document.getElementById('queue-list');
  const badge = document.getElementById('queue-badge');
  
  list.innerHTML = '';
  badge.innerText = '0';
  if (batchQueue.length === 0) {
    container.classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  badge.innerText = batchQueue.length;
  
  batchQueue.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = "flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs active:bg-slate-100 transition cursor-pointer";
    div.innerHTML = `
      <div onclick="openQueueEditModal(${index})" class="flex items-center gap-3 flex-1 mr-2">
        <div class="w-10 h-10 rounded-lg bg-cover bg-center border border-slate-300" style="background-image: url(${item.plateImage})"></div>
        <div>
          <span class="font-extrabold text-slate-900 block font-sans">Level ${item.level} Vehicle</span>
          <span class="text-slate-500 text-[10px] font-bold font-sans">Logged ${new Date(item.id).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
      </div>
      <button type="button" onclick="event.stopPropagation(); removeFromQueue(${index});" class="px-2.5 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 font-extrabold rounded-lg transition flex items-center gap-1 shadow-sm" title="Delete from Queue">
        <svg class="h-3.5 w-3.5 text-rose-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        Delete
      </button>
    `;
    list.appendChild(div);
  });
}

function removeFromQueue(index) {
  batchQueue.splice(index, 1);
  try { localStorage.setItem('wisma_batch_queue', JSON.stringify(batchQueue)); } catch(e){}
  renderBatchQueue();
}

function openQueueEditModal(index) {
  activeEditQueueIndex = index;
  renderEditModalPreviews();
  document.getElementById('queue-edit-modal').classList.remove('hidden');
}

function closeQueueEditModal() {
  document.getElementById('queue-edit-modal').classList.add('hidden');
  activeEditQueueIndex = null;
}

function renderEditModalPreviews() {
  if (activeEditQueueIndex === null) return;
  const item = batchQueue[activeEditQueueIndex];
  ['plate', 'notice', 'vehicle'].forEach(key => {
    const previewImg = document.getElementById('edit-' + key + '-img');
    const previewBox = document.getElementById('edit-' + key + '-box');
    const triggerBtn = document.getElementById('edit-' + key + '-trigger');
    const b64 = item[key + 'Image'];
    if (b64) {
      previewImg.src = b64;
      previewBox.classList.remove('hidden');
      triggerBtn.classList.add('hidden');
    } else {
      previewImg.src = '';
      previewBox.classList.add('hidden');
      triggerBtn.classList.remove('hidden');
    }
  });
}

function removeEditPhoto(key) {
  if (activeEditQueueIndex === null) return;
  batchQueue[activeEditQueueIndex][key + 'Image'] = null; 
  renderEditModalPreviews(); 
}

function triggerEditCameraInput(key) {
  document.getElementById('edit-file-' + key).click();
}

function processEditPhoto(input, type) {
  if (input.files && input.files[0] && activeEditQueueIndex !== null) {
    showGlobalLoader("Applying high-contrast timestamp...");
    const file = input.files[0];
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function(event) {
      input.value = ''; 
      const img = new Image();
      img.src = event.target.result;
      img.onload = function() {
        const stampedBase64 = processAndTimestamp(img);
        batchQueue[activeEditQueueIndex][type + 'Image'] = stampedBase64;
        renderEditModalPreviews();
        renderBatchQueue(); 
        hideGlobalLoader();
      };
    };
  }
}

function saveQueueEdits() {
  if (activeEditQueueIndex === null) return;
  const item = batchQueue[activeEditQueueIndex];
  if (!item.plateImage || !item.noticeImage || !item.vehicleImage) {
    showToast("All 3 photos must be captured before saving!");
    return;
  }
  try { localStorage.setItem('wisma_batch_queue', JSON.stringify(batchQueue)); } catch(e){}
  closeQueueEditModal();
  renderBatchQueue();
  showToast("Changes saved successfully!");
}

async function uploadBatchQueue() {
  if (batchQueue.length === 0) return;
  const total = batchQueue.length;
  showGlobalLoader(`Preparing upload (0 of ${total})...`);

  let successCount = 0;
  let failedItems = [];
  let lastErrorReason = "";

  for (let i = 0; i < batchQueue.length; i++) {
    const item = batchQueue[i];
    showGlobalLoader(`Uploading vehicle ${i + 1} of ${total}...`);
    try {
      const res = await apiCall("processViolation", item);
      if (res && res.status === "success") successCount++;
      else {
        failedItems.push(item);
        lastErrorReason = res ? res.message : "Server error";
      }
    } catch (err) {
      failedItems.push(item);
      lastErrorReason = err.toString();
    }
  }

  hideGlobalLoader();

  if (failedItems.length === 0) {
    batchQueue = [];
    try { localStorage.setItem('wisma_batch_queue', '[]'); } catch(e){}
    renderBatchQueue(); 
    showSuccessModal("Upload Successful", "All queued vehicles have been successfully saved to Google Drive & Sheets.");
  } else {
    batchQueue = failedItems;
    try { localStorage.setItem('wisma_batch_queue', JSON.stringify(batchQueue)); } catch(e){}
    renderBatchQueue();
    showSuccessModal("Upload Results", `${successCount} uploaded successfully.\n${failedItems.length} failed.\n\nReason: ${lastErrorReason}`);
  }
}

function showSuccessModal(title, bodyText) {
  const titleEl = document.getElementById('success-title');
  const bodyEl = document.getElementById('success-body');
  if (titleEl) titleEl.innerText = title;
  if (bodyEl) bodyEl.innerText = bodyText;
  document.getElementById('result-modal').classList.remove('hidden');
}

function closeConfirmationModal() {
  document.getElementById('result-modal').classList.add('hidden');
  resetApp();
}

function resetApp() {
  payload = { officer: null, level: null, plateImage: null, noticeImage: null, vehicleImage: null };
  currentStep = 1;

  ['plate', 'notice', 'vehicle'].forEach(key => {
    const fileInput = document.getElementById('file-' + key);
    if (fileInput) fileInput.value = '';
    const previewImg = document.getElementById(key + '-preview-img');
    if (previewImg) previewImg.src = '';
    const previewBox = document.getElementById(key + '-preview-box');
    if (previewBox) previewBox.classList.add('hidden');
    const trigger = document.getElementById(key + '-capture-trigger');
    if (trigger) trigger.classList.remove('hidden');
  });

  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.remove('bg-gradient-to-r', 'from-sky-600', 'to-blue-600', 'text-white', 'border-sky-500', 'shadow-md');
    btn.classList.add('border-slate-300', 'text-slate-700', 'bg-slate-100');
  });

  const activeOfficer = getPortalLoggedInUser();
  const officerInput = document.getElementById('officer-name-input');
  if (officerInput && activeOfficer) {
    officerInput.value = activeOfficer.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
  }

  updatePlateCameraButtonState();

  document.getElementById('step-1').classList.remove('hidden');
  document.getElementById('step-2').classList.add('hidden');
  document.getElementById('step-3').classList.add('hidden');

  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById('step' + i + '-dot');
    const line = document.getElementById('line' + i);
    if (dot) {
      dot.className = i === 1 
        ? "w-7 h-7 rounded-full bg-gradient-to-r from-sky-600 to-blue-600 text-white flex items-center justify-center font-extrabold text-xs shadow-md shadow-sky-600/20" 
        : "w-7 h-7 rounded-full bg-slate-200 text-slate-600 border border-slate-300 flex items-center justify-center font-extrabold text-xs";
    }
    if (line) line.className = "flex-1 h-0.5 bg-slate-300 mx-2";
  }

  document.getElementById('btn-back').classList.add('hidden');
  const nextBtn = document.getElementById('btn-next');
  if (nextBtn) {
    nextBtn.innerText = 'Next';
    nextBtn.disabled = true;
    nextBtn.classList.remove('hidden');
  }

  const resultModal = document.getElementById('result-modal').classList.add('hidden');
}

// ==============================================================
// 12. 5-MINUTE AUTO-RETURN TO PORTAL
// ==============================================================
(function() {
  const FIVE_MINS_MS = 5 * 60 * 1000;
  let idleTimer;

  function resetTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      window.location.replace(PORTAL_URL);
    }, FIVE_MINS_MS);
  }

  ["mousemove", "keypress", "touchstart", "scroll", "click", "input"].forEach(evt => {
    window.addEventListener(evt, resetTimer, { passive: true });
  });

  resetTimer();
})();
