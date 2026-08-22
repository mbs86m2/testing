/**
 * =========================================================================
 * BREAKDOWN REPORTING ENGINE (report.js)
 * Step 1 (Initial Alert) & Step 2 (Action Taken) Logic
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

let isStep1Done = false;

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
// 3. INITIALIZATION & NAVIGATION
// ==============================================================
window.addEventListener('DOMContentLoaded', () => {
  GOOGLE_SCRIPT_URL = getActiveBreakdownApiUrl();
  checkOrientation();

  const activeUser = getPortalLoggedInUser();
  const fccBtn = document.getElementById('fccLinkBtn');

  if (isUserAdmin()) {
    fccBtn.classList.remove('hidden');
  } else {
    fccBtn.classList.add('hidden');
  }

  const nameInput = document.getElementById('officerName');
  if (nameInput && activeUser) {
    nameInput.value = activeUser.toUpperCase();
  }
});

function navigateToFCC(e) {
  e.preventDefault();
  const activeUser = getPortalLoggedInUser() || document.getElementById('officerName').value.trim();
  if (isUserAdmin()) {
    localStorage.setItem('fcc_logged_in_user', activeUser);
    window.location.href = `fcc-followup.html?user=${encodeURIComponent(activeUser)}`;
  } else {
    alert("🔒 FCC Follow-Up Dashboard is restricted to Admin Officers (M2 / Keekc).");
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
// 4. ASSET DATA & DROPDOWNS
// ==============================================================
const subAssetData = {
  "Escalator (HITACHI)": [
    "Esc 01 (B1 to L1)", "Esc 02 (L1 to B1)", "Esc 03 (L1 to L2)", "Esc 04 (L2 to L1)",
    "Esc 05 (L2 to L3)", "Esc 06 (L3 to L2)", "Esc 07 (L3 to L4)", "Esc 08 (L4 to L3)",
    "Esc 09 (L4 to L5)", "Esc 10 (L5 to L4)", "Esc 11 (L5 to L6)", "Esc 12 (L6 to L5)",
    "Esc 13 (L6 to L7)", "Esc 14 (L7 to L6)"
  ],
  "Escalator (OTIS)": ["Esc E1 (B1 to L1)", "Esc E1A (L1 to B1)"],
  "Escalator (KONE)": ["ESE1"],
  "Lifts (KONE)": ["FL1", "PL2", "PL3", "PL4", "PL5", "SL9", "PL10 (Bubble Lift)", "PL11 (Bubble Lift)"]
};

const escalatorIssues = ["Stopped", "Strange Noise", "Vibration", "Jerking Movement", "Other Fault"];
const liftIssues = ["Stopped", "Mantrap (Passengers Trapped)", "Doors Stuck / Keeps Opening & Closing", "Other Fault"];

function updateAssetsAndIssues() {
  const categorySelect = document.getElementById("assetCategory");
  const unitSelect = document.getElementById("assetUnit");
  const issueSelect = document.getElementById("issueType");
  const actionSelect = document.getElementById("actionResult");
  const selectedCategory = categorySelect.value;

  unitSelect.innerHTML = ""; issueSelect.innerHTML = ""; actionSelect.innerHTML = "";

  if (selectedCategory && subAssetData[selectedCategory]) {
    unitSelect.disabled = false; 
    unitSelect.classList.remove("bg-slate-100", "text-slate-500"); 
    unitSelect.classList.add("bg-slate-50", "text-slate-900");
    
    const defaultUnit = document.createElement("option"); defaultUnit.value = ""; defaultUnit.textContent = "-- Select Specific Unit --";
    unitSelect.appendChild(defaultUnit);
    subAssetData[selectedCategory].forEach(unit => {
      const option = document.createElement("option"); option.value = unit; option.textContent = unit; unitSelect.appendChild(option);
    });

    issueSelect.disabled = false; 
    issueSelect.classList.remove("bg-slate-100", "text-slate-500"); 
    issueSelect.classList.add("bg-slate-50", "text-slate-900");
    
    const defaultIssue = document.createElement("option"); defaultIssue.value = ""; defaultIssue.textContent = "-- Select Issue --";
    issueSelect.appendChild(defaultIssue);
    
    const isLift = selectedCategory.includes("Lift");
    const currentIssues = isLift ? liftIssues : escalatorIssues;
    currentIssues.forEach(issue => {
      const option = document.createElement("option"); option.value = issue; option.textContent = issue; issueSelect.appendChild(option);
    });

    actionSelect.innerHTML = `<option value="">-- Complete Step 1 First --</option>`;
    actionSelect.dataset.options = isLift ? "lift" : "escalator";

  } else {
    unitSelect.disabled = true; unitSelect.classList.add("bg-slate-100", "text-slate-500"); unitSelect.innerHTML = `<option value="">-- Select Category First --</option>`;
    issueSelect.disabled = true; issueSelect.classList.add("bg-slate-100", "text-slate-500"); issueSelect.innerHTML = `<option value="">-- Select Category First --</option>`;
    actionSelect.innerHTML = `<option value="">-- Select Category First --</option>`;
  }
}

function handleIssueSelect() {
  const issueVal = document.getElementById("issueType").value;
  const warningBanner = document.getElementById("step1Warning");
  if (issueVal && !isStep1Done) {
    warningBanner.classList.remove("hidden");
  } else {
    warningBanner.classList.add("hidden");
  }
}

function toggleOfficer2Input() {
  const isSame = document.getElementById('sameOfficerCheck').checked;
  const container = document.getElementById('officer2Container');
  const input = document.getElementById('actionOfficerName');

  if (isSame) {
    container.classList.add('hidden');
    input.required = false;
    input.value = "";
  } else {
    container.classList.remove('hidden');
    input.required = true;
  }
}

function populateActionDropdown() {
  const actionSelect = document.getElementById("actionResult");
  const type = actionSelect.dataset.options;

  actionSelect.innerHTML = `<option value="">-- Select Result --</option>`;
  if (type === "lift") {
    actionSelect.innerHTML += `
      <option value="Reset Done">Reset Done</option>
      <option value="Follow Up Required">Follow Up Required</option>
      <option value="Mantrap Released & Reset Done">Mantrap Released & Reset Done</option>
      <option value="Mantrap Released, Need Follow Up">Mantrap Released, Need Follow Up</option>
    `;
  } else {
    actionSelect.innerHTML += `
      <option value="Reset Done">Reset Done</option>
      <option value="Follow Up Required">Follow Up Required</option>
    `;
  }
}

function toggleRemarksRequirement() {
  const actionResult = document.getElementById("actionResult").value;
  const remarksInput = document.getElementById("remarksDescription");
  const remarksLabel = document.getElementById("remarksLabel");

  if (actionResult.includes("Follow") || actionResult.includes("Need Follow Up")) {
    remarksInput.required = true;
    remarksLabel.innerHTML = 'Remarks / Description <span class="text-rose-600 font-extrabold">* (Required for Follow Up)</span>';
  } else {
    remarksInput.required = false;
    remarksLabel.innerHTML = 'Remarks / Description (Optional)';
  }
}

// ==============================================================
// 5. PHOTO PROCESSING & SUBMISSION
// ==============================================================
function getRawBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

function compressAndTimestampPhoto(file, assetUnit, officerName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const MAX_WIDTH = 1000;
        let width = img.width; let height = img.height;
        if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; }

        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const now = new Date();
        const timeStr = now.toLocaleDateString('en-SG', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const fontSize = Math.max(15, Math.round(width / 30));
        ctx.font = `bold ${fontSize}px sans-serif`;

        const line1 = `WISMA ATRIA | ${assetUnit || 'BREAKDOWN REPORT'}`;
        const line2 = `DATE/TIME: ${timeStr} | OFFICER: ${officerName || 'SECURITY'}`;
        const padding = fontSize * 0.5;
        const boxHeight = fontSize * 2.6 + padding;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, height - boxHeight, width, boxHeight);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(line1, padding, height - boxHeight + fontSize + 2);
        ctx.fillText(line2, padding, height - boxHeight + fontSize * 2 + 6);

        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };
      img.src = e.target.result;
    };
    reader.onerror = err => reject(err);
  });
}

async function triggerSubmit(type) {
  GOOGLE_SCRIPT_URL = getActiveBreakdownApiUrl();
  const spreadsheetId = getActiveBreakdownSpreadsheetId();

  document.getElementById('submissionType').value = type;
  const form = document.getElementById('breakdownForm');

  autoCapitalizeInput(document.getElementById('officerName'));
  autoCapitalizeInput(document.getElementById('actionOfficerName'));
  autoCapitalizeInput(document.getElementById('remarksDescription'));

  if (type === 'initial_report') {
    if (!document.getElementById('officerName').value || 
        !document.getElementById('assetCategory').value || 
        !document.getElementById('assetUnit').value || 
        !document.getElementById('issueType').value) {
      alert("⚠️ Please fill in Name, Asset Category, Unit, and Issue first!");
      return;
    }
  }

  if (type === 'action_outcome') {
    const actionVal = document.getElementById('actionResult').value;
    if (!actionVal) {
      alert("⚠️ Please select Action Taken / Result before submitting Step 2!");
      document.getElementById('actionResult').focus();
      return;
    }

    const isSame = document.getElementById('sameOfficerCheck').checked;
    const actionOfficer = document.getElementById('actionOfficerName').value;
    if (!isSame && !actionOfficer) {
      alert("⚠️ Please enter the name of the officer performing Action Taken!");
      document.getElementById('actionOfficerName').focus();
      return;
    }
  }

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const btnInitial = document.getElementById('btnInitial');
  const btnOutcome = document.getElementById('btnOutcome');
  const statusMsg = document.getElementById('statusMsg');

  btnInitial.disabled = true; btnOutcome.disabled = true;
  statusMsg.classList.add('hidden');

  const catSelect = document.getElementById('assetCategory');
  const unitSelect = document.getElementById('assetUnit');
  const issueSelect = document.getElementById('issueType');

  const catWasDisabled = catSelect.disabled;
  const unitWasDisabled = unitSelect.disabled;
  const issueWasDisabled = issueSelect.disabled;

  catSelect.disabled = false; unitSelect.disabled = false; issueSelect.disabled = false;

  const rawFormData = new FormData(form);
  const submitData = new FormData();

  for (let pair of rawFormData.entries()) {
    if (typeof pair[1] === 'string') {
      submitData.append(pair[0], pair[1]);
    }
  }

  catSelect.disabled = catWasDisabled;
  unitSelect.disabled = unitWasDisabled;
  issueSelect.disabled = issueWasDisabled;

  const photoInput = document.getElementById('photoInput');
  const assetUnitVal = document.getElementById('assetUnit').value;
  
  const isSame = document.getElementById('sameOfficerCheck').checked;
  const actionOfficerVal = document.getElementById('actionOfficerName').value;
  const effectiveOfficerName = (type === 'action_outcome' && !isSame && actionOfficerVal) ? actionOfficerVal : document.getElementById('officerName').value;

  submitData.append('action_officer_name', effectiveOfficerName);
  submitData.append('spreadsheet_id', spreadsheetId);

  if (photoInput.files.length > 0) {
    try {
      const file = photoInput.files[0];
      if (file.type.startsWith('video/')) {
        if (file.size > 35 * 1024 * 1024) {
          alert("⚠️ Video file is too large! Upload a short video under 35MB.");
          btnInitial.disabled = false; btnOutcome.disabled = false;
          return;
        }
        const videoBase64 = await getRawBase64(file);
        submitData.append('photo_base64', videoBase64);
        submitData.append('photo_name', `VIDEO_${file.name}`);
        submitData.append('photo_type', file.type);
      } else {
        const compressedBase64 = await compressAndTimestampPhoto(file, assetUnitVal, effectiveOfficerName);
        submitData.append('photo_base64', compressedBase64);
        submitData.append('photo_name', `STAMPED_${file.name}`);
        submitData.append('photo_type', 'image/jpeg');
      }
    } catch (err) { console.error("Photo error", err); }
  }

  fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    body: submitData
  })
  .then(res => res.json())
  .then(data => {
    if (data.result === "success" || data.status === "success") {
      fetch('/', { method: 'POST', body: rawFormData });

      if (type === 'initial_report') {
        isStep1Done = true;
        statusMsg.className = "text-center text-xs font-bold p-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-300";
        statusMsg.textContent = "🚨 Step 1 Complete! FCC Supervisors alerted. Now select Action Taken below.";
        statusMsg.classList.remove('hidden');

        btnInitial.disabled = true;
        btnInitial.className = "w-full bg-slate-100 text-slate-400 font-bold py-3 px-3 rounded-lg text-xs cursor-not-allowed opacity-50 border border-slate-300";

        document.getElementById('officerName').readOnly = true;
        document.getElementById('assetCategory').disabled = true;
        document.getElementById('assetUnit').disabled = true;
        document.getElementById('issueType').disabled = true;

        document.getElementById('step2OfficerSection').classList.remove('hidden');
        populateActionDropdown();
        document.getElementById('actionResult').disabled = false;
        document.getElementById('actionResult').classList.remove("bg-slate-100", "text-slate-500");
        document.getElementById('actionResult').classList.add("bg-slate-50", "text-slate-900");

        btnOutcome.disabled = false;
        btnOutcome.className = "w-full bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white font-bold py-3 px-3 rounded-lg text-xs shadow-md cursor-pointer transition duration-200";

        const warningBanner = document.getElementById("step1Warning");
        warningBanner.className = "p-3 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 text-xs font-semibold leading-relaxed shadow-sm";
        warningBanner.innerHTML = "👇 <strong>STEP 2:</strong> Select <strong>Action Taken / Result</strong> below and click <span class='text-sky-700 font-bold'>'✅ 2. Report Action Taken'</span>.";

      } else {
        statusMsg.className = "text-center text-xs font-bold p-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-300";
        statusMsg.textContent = "✅ Step 2 Complete! Action report submitted & Google Sheet updated!";
        statusMsg.classList.remove('hidden');

        setTimeout(() => { location.reload(); }, 2500);
      }
    } else {
      throw new Error(data.error || data.message || "Script error");
    }
  })
  .catch(err => {
    statusMsg.className = "text-center text-xs font-bold p-3 rounded-lg bg-rose-50 text-rose-800 border border-rose-300";
    statusMsg.textContent = "⚠️ Report logged to Netlify (Sync Notice: " + err.message + ")";
    statusMsg.classList.remove('hidden');
    btnInitial.disabled = false;
  });
}
