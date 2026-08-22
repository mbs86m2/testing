/**
 * =========================================================================
 * FCC FOLLOW-UP DASHBOARD ENGINE (followup.js)
 * Live Google Sheets Integration, Search & Status Updates
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
// 2. CONFIGURATION RESOLVERS
// ==============================================================
function getActiveBreakdownApiUrl() {
  let masterCfg = null;
  try { masterCfg = JSON.parse(localStorage.getItem("wafp_master_config")); } catch (e) {}

  return localStorage.getItem("BREAKDOWN_API_URL") || 
         localStorage.getItem("breakdown_api_url") || 
         (masterCfg && masterCfg.SECTION_API_URLS && masterCfg.SECTION_API_URLS.BREAKDOWN) || 
         (masterCfg && masterCfg.API_URL) || 
         "https://script.google.com/macros/s/AKfycbwJ0YKy16phTOi7yZfAwpUrXiPpaP34MNZNg08EnsuDxKKckhI5XFDNpjJknr1cVz_D/exec";
}

function getActiveBreakdownSpreadsheetId() {
  let masterCfg = null;
  try { masterCfg = JSON.parse(localStorage.getItem("wafp_master_config")); } catch (e) {}

  return localStorage.getItem("BREAKDOWN_SPREADSHEET_ID") || 
         localStorage.getItem("breakdown_sheet_id") || 
         (masterCfg && masterCfg.SPREADSHEET_IDS && masterCfg.SPREADSHEET_IDS.BREAKDOWN) || 
         "1rbjfI3G4DsnAojN7O0w04xRNE6efFPs11ESDDAE76oY";
}

let GOOGLE_SCRIPT_URL = getActiveBreakdownApiUrl();
const PORTAL_URL = "../index.html";
const ADMIN_USERS = ["admin m2", "m2", "keekc", "kee", "kee kc", "admin", "master"];

function getPortalLoggedInUser() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromParam = urlParams.get('user') || urlParams.get('username') || urlParams.get('officer') || urlParams.get('name') || urlParams.get('id');
  if (fromParam && fromParam.trim()) return fromParam.trim();

  const possibleKeys = [
    'portal_active_user', 'wafp_officer', 'wafp_logged_officer', 'currentUser', 
    'wafp_active_officer', 'wafp_user', 'username', 'officer', 'user', 
    'fcc_logged_in_user'
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
// 3. UI HELPERS & SEARCH BAR
// ==============================================================
function formatAssetUnitMultiLine(unitStr) {
  if (!unitStr) return "-";
  const match = unitStr.match(/^(.*?)\s*(\(.*?\))\s*$/);
  if (match) {
    const unitName = match[1].trim();
    const floorText = match[2].trim();
    return `<div class="leading-tight text-left">
              <span class="block font-black text-xs sm:text-sm tracking-wide text-slate-900">${unitName}</span>
              <span class="block text-[10px] font-bold text-slate-600">${floorText}</span>
            </div>`;
  }
  return `<span class="font-black text-xs sm:text-sm text-slate-900">${unitStr}</span>`;
}

function toggleSearchClearBtn() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  if (input && clearBtn) {
    if (input.value.trim().length > 0) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
}

function clearSearchInput() {
  const input = document.getElementById('searchInput');
  if (input) {
    input.value = '';
    toggleSearchClearBtn();
    filterReports();
    input.focus();
  }
}

function checkOrientation() {
  const prompt = document.getElementById('portraitPrompt');
  if (prompt) {
    if (window.innerWidth > window.innerHeight && window.innerHeight < 600) {
      prompt.classList.remove('hidden');
      prompt.classList.add('flex');
    } else {
      prompt.classList.add('hidden');
      prompt.classList.remove('flex');
    }
  }
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);
window.addEventListener('DOMContentLoaded', checkOrientation);

function autoCapitalizeInput(element) {
  if (!element || !element.value) return;
  element.value = element.value.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
}

let inactivityTimer;
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => { window.location.replace(PORTAL_URL); }, 5 * 60 * 1000);
}
['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'].forEach(evt => document.addEventListener(evt, resetInactivityTimer, true));
resetInactivityTimer();

// ==============================================================
// 4. REPORT LOADING & FILTERING
// ==============================================================
let allReports = [];
let showResolved = false;

function getTodayDateString() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

window.addEventListener('DOMContentLoaded', () => {
  GOOGLE_SCRIPT_URL = getActiveBreakdownApiUrl();
  const activeUser = getPortalLoggedInUser();

  if (isUserAdmin()) {
    var formattedName = activeUser ? activeUser.toUpperCase() : "M2";
    localStorage.setItem('fcc_logged_in_user', formattedName);

    const badge = document.getElementById('activeUserBadge');
    if (badge) badge.textContent = `| 👤 ${formattedName}`;

    loadPendingReports();
  } else {
    document.getElementById('mainAppContainer').classList.add('hidden');
    document.getElementById('deniedScreen').classList.remove('hidden');
  }
});

function loadPendingReports() {
  GOOGLE_SCRIPT_URL = getActiveBreakdownApiUrl();
  const spreadsheetId = getActiveBreakdownSpreadsheetId();

  const container = document.getElementById('reportsContainer');
  container.innerHTML = `<div class="text-center text-slate-500 py-8 font-semibold">Loading breakdown list...</div>`;

  const queryUrl = `${GOOGLE_SCRIPT_URL}?action=getBreakdowns&spreadsheetId=${encodeURIComponent(spreadsheetId)}`;

  fetch(queryUrl)
  .then(res => res.json())
  .then(data => {
    if (data.result === "success" || data.status === "success") {
      allReports = data.data || data.records || [];
      filterReports();
    } else {
      container.innerHTML = `<div class="text-center text-rose-600 py-4 font-bold">Error loading reports: ${data.message || data.error}</div>`;
    }
  })
  .catch(err => {
    container.innerHTML = `<div class="text-center text-rose-600 py-4 font-bold">Failed to connect to Google Sheets server.</div>`;
  });
}

function toggleResolvedView() {
  showResolved = !showResolved;
  const btn = document.getElementById('viewToggleBtn');
  if (showResolved) {
    btn.className = "text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-2.5 rounded-lg border border-emerald-500 transition shadow-sm flex items-center gap-1";
    btn.innerHTML = "📜 History ON";
    btn.title = "History Mode Active - Showing Resolved Cases. Click to hide resolved.";
  } else {
    btn.className = "text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold p-2 rounded-lg border border-slate-300 transition";
    btn.innerHTML = "📜";
    btn.title = "Click to show resolved breakdown history";
  }
  filterReports();
}

function filterReports() {
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  const filtered = allReports.filter(r => {
    const unit = (r.assetUnit || r['Asset Unit'] || "").toLowerCase();
    const officer = (r.officerName || r['Officer Name'] || "").toLowerCase();
    const issue = (r.issue || r['Issue / Fault'] || "").toLowerCase();
    const action = (r.actionResult || r['Action Taken / Result'] || "").toLowerCase();
    const fccStatus = (r.fccStatus || r['Status'] || "").toLowerCase();
    const fccRemarks = (r.fccRemarks || r['Remarks'] || "").toLowerCase();

    const matchesSearch = !query || 
                          unit.includes(query) ||
                          officer.includes(query) ||
                          issue.includes(query) ||
                          action.includes(query) ||
                          fccStatus.includes(query) ||
                          fccRemarks.includes(query);
    
    const isResolved = (r.isResolved === true) || fccStatus.includes("resolved");
    const matchesStatus = showResolved ? true : !isResolved;
    return matchesSearch && matchesStatus;
  });

  const descendingReports = [...filtered].sort((a, b) => (b.rowId || b.rowNumber || 0) - (a.rowId || a.rowNumber || 0));
  renderReports(descendingReports);
}

// ==============================================================
// 5. RENDER DASHBOARD CARDS
// ==============================================================
function renderReports(reports) {
  const container = document.getElementById('reportsContainer');
  container.innerHTML = "";

  if (reports.length === 0) {
    container.innerHTML = showResolved 
      ? `<div class="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500 font-bold">📜 No historical breakdown records found.</div>`
      : `<div class="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500 font-bold">🎉 No pending breakdown reports! Click 📜 button to view resolved history.</div>`;
    return;
  }

  const defaultOfficer = localStorage.getItem('fcc_logged_in_user') || 'M2';

  reports.forEach(report => {
    const rowId = report.rowId || report.rowNumber;
    const unitName = report.assetUnit || report['Asset Unit'] || "-";
    const officerName = report.officerName || report['Officer Name'] || "-";
    const faultIssue = report.issue || report['Issue / Fault'] || "-";
    const actionTaken = report.actionResult || report['Action Taken / Result'] || "-";
    const status = report.fccStatus || report['Status'] || "";
    const remarks = report.fccRemarks || report['Remarks'] || report.officerRemarks || "";
    const timestamp = report.timestamp || report['Date/Time'] || report['Date'] || "-";
    const photoLink = report.photoUrl || report['Photo Link'] || report['Photo'] || "";

    const isResolved = report.isResolved || status.toLowerCase().includes('resolved');
    const currentDateValue = report.followUpDate || getTodayDateString();
    const photoHtml = (photoLink && photoLink !== "-") 
      ? `<a href="${photoLink}" target="_blank" class="inline-flex items-center text-xs font-bold text-sky-700 hover:underline mt-1">📷 View Photo</a>`
      : `<span class="text-xs text-slate-400">No Photo</span>`;

    const isEscalator = unitName.toLowerCase().includes('esc') || unitName.toLowerCase().startsWith('ese');
    const card = document.createElement('div');

    if (isResolved) {
      card.className = "bg-emerald-50/80 border border-emerald-300 rounded-xl shadow-sm p-3.5 text-xs space-y-2 text-slate-900";
      card.innerHTML = `
        <div class="flex justify-between items-start border-b border-emerald-200 pb-2">
          <div class="space-y-1">
            <div class="bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded border border-emerald-300 inline-block font-bold">
              ${formatAssetUnitMultiLine(unitName)}
            </div>
            <div class="text-[11px] font-bold text-slate-600 block">
              Reported: ${timestamp}
            </div>
          </div>
          <div class="flex items-center space-x-2 shrink-0">
            <span class="font-extrabold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">✅ RESOLVED</span>
            <button onclick="deleteFCCRecord(${rowId})" class="text-xs bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold py-0.5 px-2 rounded border border-rose-300 transition">🗑️ Delete</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-slate-800 pt-1 font-medium">
          <p><strong class="text-slate-600">Reported By:</strong> ${officerName}</p>
          <p><strong class="text-slate-600">Fault:</strong> ${faultIssue}</p>
          <p><strong class="text-slate-600">Action Taken:</strong> ${actionTaken}</p>
          <p><strong class="text-slate-600">FCC Status:</strong> ${status || 'Resolved'}</p>
          <p class="col-span-2"><strong class="text-slate-600">FCC Remarks:</strong> ${remarks || "Resolved"}</p>
        </div>
        <div class="pt-1 text-slate-600 italic flex justify-between items-center border-t border-emerald-200 font-semibold">
          <span>Resolved Date: ${report.followUpDate || 'On Site'}</span>
          ${photoHtml}
        </div>
      `;
    } else {
      let statusOptionsHtml = `
        <option value="" ${!status ? 'selected' : ''}>-- Select Status --</option>
        <option value="Done Reset" ${status === 'Done Reset' ? 'selected' : ''}>Done Reset</option>
        <option value="Need Vendor Follow Up" ${status === 'Need Vendor Follow Up' ? 'selected' : ''}>Need Vendor Follow Up</option>
      `;

      if (!isEscalator) {
        statusOptionsHtml += `
          <option value="Mantrap Released" ${status === 'Mantrap Released' ? 'selected' : ''}>Mantrap Released</option>
        `;
      }

      card.className = "bg-white border-l-4 border-rose-500 border-y border-r border-slate-200 rounded-xl shadow-md p-3.5 sm:p-4 space-y-3";
      
      card.innerHTML = `
        <div class="flex justify-between items-start border-b border-slate-200 pb-2">
          <div class="space-y-1">
            <div class="bg-rose-50 text-rose-900 px-2.5 py-1 rounded-lg border border-rose-200 shadow-sm inline-block font-bold">
              ${formatAssetUnitMultiLine(unitName)}
            </div>
            <div class="text-xs text-slate-500 font-bold block pt-0.5">
              Reported: ${timestamp}
            </div>
          </div>
          <div class="flex items-center space-x-2 shrink-0">
            <span class="text-xs font-extrabold px-2.5 py-1 rounded bg-amber-50 text-amber-900 border border-amber-300">⏳ PENDING</span>
            <button onclick="deleteFCCRecord(${rowId})" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold py-1 px-2.5 rounded border border-rose-300 transition">🗑️ Delete</button>
          </div>
        </div>

        <div class="text-xs sm:text-sm space-y-1 text-slate-800 font-medium">
          <p><strong class="text-slate-600">Officer:</strong> ${officerName}</p>
          <p><strong class="text-slate-600">Issue / Fault:</strong> ${faultIssue}</p>
          <p><strong class="text-slate-600">Initial Action:</strong> <span class="text-rose-700 font-bold">${actionTaken}</span></p>
          <p class="text-slate-600 italic"><strong>Officer Remarks:</strong> ${remarks}</p>
          <div>${photoHtml}</div>
        </div>

        <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs sm:text-sm space-y-3">
          <div class="font-extrabold text-sky-800 text-xs uppercase tracking-wider border-b border-slate-200 pb-1">FCC Follow Up Details</div>
          
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-start">
            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">FCC Personnel Name *</label>
              <input type="text" id="fccName_${rowId}" value="${defaultOfficer}" placeholder="Enter your name" required onblur="autoCapitalizeInput(this)"
                     class="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 font-semibold text-xs outline-none focus:border-sky-600">
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">Follow-up Action *</label>
              <select id="status_${rowId}" class="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 font-semibold text-xs outline-none focus:border-sky-600">
                ${statusOptionsHtml}
              </select>
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-600 mb-1">Follow Up Date *</label>
              <input type="date" id="date_${rowId}" value="${currentDateValue}" 
                     class="w-full h-9 px-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 font-semibold text-xs outline-none focus:border-sky-600">
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1">FCC Remarks</label>
            <textarea id="remarks_${rowId}" rows="2" placeholder="Type FCC follow-up actions/comments here..." onblur="autoCapitalizeInput(this)" class="w-full p-2 border border-slate-300 rounded-lg bg-white text-slate-900 font-medium text-xs outline-none focus:border-sky-600">${remarks}</textarea>
          </div>

          <div class="flex items-center space-x-2 pt-1 border-t border-slate-200">
            <input type="checkbox" id="check_${rowId}" class="w-4 h-4 text-emerald-600 rounded border-slate-300 cursor-pointer">
            <label for="check_${rowId}" class="text-xs font-bold text-emerald-800 cursor-pointer">
              ☑ Mark Issue as Resolved (Removes from pending list &amp; turns row GREEN in Google Sheet)
            </label>
          </div>

          <button onclick="submitFCCUpdate(${rowId})" id="btn_${rowId}" class="w-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold py-2.5 px-3 rounded-lg text-xs transition shadow-md">
            Save FCC Follow-up Details &amp; Notify Pushover
          </button>
        </div>
      `;
    }

    container.appendChild(card);
  });
}

// ==============================================================
// 6. ACTIONS (UPDATE & DELETE)
// ==============================================================
function submitFCCUpdate(rowId) {
  GOOGLE_SCRIPT_URL = getActiveBreakdownApiUrl();
  const spreadsheetId = getActiveBreakdownSpreadsheetId();

  const btn = document.getElementById(`btn_${rowId}`);
  const fccNameElem = document.getElementById(`fccName_${rowId}`);
  const remarksElem = document.getElementById(`remarks_${rowId}`);

  autoCapitalizeInput(fccNameElem);
  autoCapitalizeInput(remarksElem);

  const fccNameVal = fccNameElem.value.trim();
  const statusVal = document.getElementById(`status_${rowId}`).value;
  const dateVal = document.getElementById(`date_${rowId}`).value;
  const remarksVal = remarksElem.value;
  const isResolved = document.getElementById(`check_${rowId}`).checked;

  if (!fccNameVal) {
    alert("⚠️ Please enter your FCC Personnel Name before saving!");
    fccNameElem.focus();
    return;
  }

  localStorage.setItem('fcc_logged_in_user', fccNameVal);

  btn.disabled = true;
  btn.textContent = "Updating Sheets & Sending Pushover Alert...";

  const formData = new FormData();
  formData.append('action_type', 'fcc_update');
  formData.append('row_id', rowId);
  formData.append('fcc_personnel_name', fccNameVal);
  formData.append('fcc_status', statusVal);
  formData.append('followup_date', dateVal);
  formData.append('fcc_remarks', remarksVal);
  formData.append('is_resolved', isResolved ? 'true' : 'false');
  formData.append('spreadsheet_id', spreadsheetId);

  fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: formData })
  .then(res => res.json())
  .then(data => {
    alert(isResolved ? "✅ Issue marked RESOLVED and Pushover Alert sent!" : "✅ Follow-up details saved and Pushover Alert sent!");
    loadPendingReports();
  })
  .catch(err => {
    alert("⚠️ Error updating status.");
    btn.disabled = false;
    btn.textContent = "Save FCC Follow-up Details & Notify Pushover";
  });
}

function deleteFCCRecord(rowId) {
  if (!confirm("⚠️ Are you sure you want to delete this breakdown record? This will permanently remove it from the FCC Dashboard and Google Sheets.")) return;

  GOOGLE_SCRIPT_URL = getActiveBreakdownApiUrl();
  const spreadsheetId = getActiveBreakdownSpreadsheetId();

  const formData = new FormData();
  formData.append('action_type', 'delete_record');
  formData.append('row_id', rowId);
  formData.append('spreadsheet_id', spreadsheetId);

  fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: formData })
  .then(res => res.json())
  .then(data => {
    alert("🗑️ Record deleted successfully!");
    loadPendingReports();
  })
  .catch(err => {
    alert("⚠️ Error deleting record.");
  });
}
