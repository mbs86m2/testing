import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, query, where, getDocs, limit, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// EXACT CONFIG FOR WA-FCC-PORTAL
const firebaseConfig = {
  apiKey: "AIzaSyDnZv3wMkQb3BuOGy3l7d5Iy9fw4EtKKVA",
  authDomain: "wa-fcc-portal.firebaseapp.com",
  databaseURL: "https://wa-fcc-portal-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "wa-fcc-portal",
  storageBucket: "wa-fcc-portal.firebasestorage.app",
  messagingSenderId: "609256707693",
  appId: "1:609256707693:web:01aba2ff9f7d34d3bd5164"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.db = db;
window.fs = { collection, query, where, getDocs, limit, onSnapshot };

const API_URL = "https://script.google.com/macros/s/AKfycbyf102SShb6EozCi63GrJXlsh7WVgyDHsFU_DeC8LHNYOwFb5DZtjRcaY1iWZPMTHqw/exec"; 

const DEFAULT_FOLDERS = {
  PARKING_REPORTS: "1bMhOSGlZNM979lXcY3AC9PUC4OzOwx9O",
  PARKING_PHOTOS: "12HLGBUQ4JAe3DB2LRdKsGKJhu7zMUpuc",
  BREAKDOWN_REPORTS: "1l1XWU8lGzWudQsq1cG4gZcZcjrTWZQNh",
  BREAKDOWN_PHOTOS: "1zlDZMiLJYLa35PL659i8m-GblS59X82P",
  TOC: "1vOHVu0nBmMFyFxU_JrfUhrow9EvEjkDU",
  STAIRCASE: "1o6tzEfpDsJGXjs7MabioL8DcaWNlBq_T"
};

const INACTIVITY_LIMIT_MS = 1 * 60 * 1000; // 1 Minute
let lastActivityTime = Date.now();
let loggedInUser = null;
let currentRawData = [];
let currentFilteredData = [];
let currentSection = "";
let currentDisplayLimit = 30;
let activeRealtimeUnsubscribe = null;

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

// INITIALIZE ON DOM LOAD
window.addEventListener('DOMContentLoaded', async () => {
  await fetchUsersFromFirestore();
  restoreSessionIfValid();
});

// ACTIVITY TRACKER
function updateActivityTimestamp() {
  lastActivityTime = Date.now();
  saveSessionState();
}

['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
  window.addEventListener(evt, updateActivityTimestamp, { passive: true });
});

setInterval(function() {
  if (loggedInUser && (Date.now() - lastActivityTime >= INACTIVITY_LIMIT_MS)) {
    triggerAutoLogout();
  }
}, 1000);

function triggerAutoLogout() {
  if (activeRealtimeUnsubscribe) { activeRealtimeUnsubscribe(); activeRealtimeUnsubscribe = null; }
  sessionStorage.removeItem("fcc_session_v8");
  loggedInUser = null;
  document.getElementById("dashboard-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("inactivity-modal").classList.remove("hidden");
}

function closeInactivityModal() {
  document.getElementById("inactivity-modal").classList.add("hidden");
}

function saveSessionState() {
  if (!loggedInUser) {
    sessionStorage.removeItem("fcc_session_v8");
    return;
  }
  const session = {
    user: loggedInUser,
    section: currentSection,
    lastActivity: lastActivityTime
  };
  sessionStorage.setItem("fcc_session_v8", JSON.stringify(session));
}

function restoreSessionIfValid() {
  const stored = sessionStorage.getItem("fcc_session_v8");
  if (!stored) return false;

  try {
    const session = JSON.parse(stored);
    if (session.user && session.lastActivity && (Date.now() - session.lastActivity < INACTIVITY_LIMIT_MS)) {
      loggedInUser = session.user;
      lastActivityTime = Date.now();

      document.getElementById("login-screen").classList.add("hidden");
      document.getElementById("dashboard-screen").classList.remove("hidden");
      document.getElementById("user-badge").innerText = `${loggedInUser.name} | ${loggedInUser.role}`;

      if (session.section) {
        showSection(session.section);
      }
      return true;
    }
  } catch(e) {}

  sessionStorage.removeItem("fcc_session_v8");
  return false;
}

// FETCH USERS
async function fetchUsersFromFirestore() {
  const select = document.getElementById("user-name-select");
  if (!select) return;

  try {
    const { collection, getDocs } = window.fs;
    const querySnapshot = await getDocs(collection(window.db, "approved_users"));

    if (!querySnapshot.empty) {
      select.innerHTML = `<option value="" class="bg-slate-900 text-white">-- Select Your Name --</option>`;
      querySnapshot.forEach(doc => {
        const data = doc.data();
        select.innerHTML += `<option value="${data.name}" class="bg-slate-900 text-white">${data.name}</option>`;
      });
    } else {
      select.innerHTML = `<option value="" class="bg-slate-900 text-white">No users found</option>`;
    }
  } catch (err) {
    select.innerHTML = `<option value="" class="bg-slate-900 text-white">Error loading users</option>`;
  }
}

// LOGIN
async function loginUser() {
  const name = document.getElementById("user-name-select").value;
  const pass = document.getElementById("user-password").value;
  const statusBox = document.getElementById("auth-status");

  if (!name || !pass) { alert("Please select your name and enter password."); return; }

  statusBox.className = "mt-4 p-3 rounded-lg text-sm bg-blue-500/20 text-blue-300 border border-blue-500/30 block font-semibold";
  statusBox.innerText = "Verifying credentials...";

  try {
    const { collection, query, where, getDocs } = window.fs;
    const q = query(collection(window.db, "approved_users"), where("name", "==", name));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      statusBox.className = "mt-4 p-3 rounded-lg text-sm bg-red-500/20 text-red-300 border border-red-500/30 block font-semibold";
      statusBox.innerText = "User account not found.";
      return;
    }

    let userData = null;
    querySnapshot.forEach(doc => userData = doc.data());

    if (userData && userData.password === pass) {
      loggedInUser = { name: userData.name, role: userData.role || "Viewer" };
      lastActivityTime = Date.now();
      saveSessionState();

      statusBox.className = "mt-4 p-3 rounded-lg text-sm bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 block font-semibold";
      statusBox.innerText = "✓ Access Granted";

      setTimeout(() => {
        document.getElementById("login-screen").classList.add("hidden");
        document.getElementById("dashboard-screen").classList.remove("hidden");
        document.getElementById("user-badge").innerText = `${loggedInUser.name} | ${loggedInUser.role}`;
      }, 200);
    } else {
      statusBox.className = "mt-4 p-3 rounded-lg text-sm bg-red-500/20 text-red-300 border border-red-500/30 block font-semibold";
      statusBox.innerText = "Incorrect Password.";
    }
  } catch (err) {
    statusBox.className = "mt-4 p-3 rounded-lg text-sm bg-red-500/20 text-red-300 border border-red-500/30 block font-semibold";
    statusBox.innerText = "Authentication error.";
  }
}

function logout() {
  if (activeRealtimeUnsubscribe) { activeRealtimeUnsubscribe(); activeRealtimeUnsubscribe = null; }
  loggedInUser = null;
  sessionStorage.removeItem("fcc_session_v8");
  document.getElementById("dashboard-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
}

// DYNAMIC YEARS DETECTOR
async function populateDynamicYears(collectionName, targetSelectId) {
  const select = document.getElementById(targetSelectId);
  if (!select) return;

  try {
    const { collection, getDocs } = window.fs;
    const querySnapshot = await getDocs(collection(window.db, collectionName));
    let yearsSet = new Set();

    querySnapshot.forEach(doc => {
      let y = doc.data()._year || doc.data().year;
      if (y) yearsSet.add(y);
    });

    let years = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));

    select.innerHTML = `<option value="" class="bg-slate-900 text-white">-- Select Year --</option>`;
    if (years.length > 0) {
      years.forEach(y => select.innerHTML += `<option value="${y}" class="bg-slate-900 text-white">${y}</option>`);
    } else {
      select.innerHTML += `<option value="2026" class="bg-slate-900 text-white">2026</option>`;
    }
  } catch (err) {
    select.innerHTML = `<option value="" class="bg-slate-900 text-white">-- Select Year --</option><option value="2026" class="bg-slate-900 text-white">2026</option>`;
  }
}

// SHOW SECTIONS (STANDARDIZED FIXED CONTROLS + SCROLLABLE RESULTS)
function showSection(section) {
  currentSection = section;
  currentDisplayLimit = 30;
  saveSessionState();
  const area = document.getElementById("content-area");

  if (activeRealtimeUnsubscribe) {
    activeRealtimeUnsubscribe();
    activeRealtimeUnsubscribe = null;
  }

  if (section === 'parking' || section === 'breakdown') {
    const title = section === 'parking' ? '🚗 Parking Violations Report' : '⚠️ Breakdown Logs Report';
    const colName = section === 'parking' ? 'parking_violations' : 'breakdown_logs';

    area.innerHTML = `
      <div class="flex flex-col h-full">
        <!-- FIXED CONTROLS HEADER -->
        <div class="sticky top-0 z-20 bg-slate-900/90 backdrop-blur-xl p-3.5 rounded-2xl border border-white/15 shadow-2xl mb-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-base font-bold text-white tracking-wide whitespace-nowrap">${title}</h2>

            <div class="flex flex-nowrap items-center gap-2 overflow-x-auto">
              <div class="flex items-center space-x-1 flex-shrink-0">
                <label class="text-xs font-semibold text-slate-300 whitespace-nowrap">1. Year:</label>
                <select id="sel-year" onchange="onReportYearChange()" class="px-3 py-1.5 border border-slate-600 rounded-xl text-xs bg-slate-800 text-white font-medium outline-none">
                  <option value="" class="bg-slate-900">Loading...</option>
                </select>
              </div>

              <div class="flex items-center space-x-1 flex-shrink-0">
                <label class="text-xs font-semibold text-slate-300 whitespace-nowrap">2. Month:</label>
                <select id="sel-month" onchange="fetchRecordsRealtime()" class="px-3 py-1.5 border border-slate-600 rounded-xl text-xs bg-slate-800 text-white font-medium outline-none" disabled>
                  <option value="ALL" class="bg-slate-900">-- All Months --</option>
                  <option value="08-AUG" class="bg-slate-900">08-AUG</option>
                  <option value="07-JUL" class="bg-slate-900">07-JUL</option>
                  <option value="06-JUN" class="bg-slate-900">06-JUN</option>
                  <option value="05-MAY" class="bg-slate-900">05-MAY</option>
                  <option value="04-APR" class="bg-slate-900">04-APR</option>
                  <option value="03-MAR" class="bg-slate-900">03-MAR</option>
                  <option value="02-FEB" class="bg-slate-900">02-FEB</option>
                  <option value="01-JAN" class="bg-slate-900">01-JAN</option>
                </select>
              </div>

              <div class="relative flex items-center flex-shrink-0">
                <input id="search-input" type="text" placeholder="Type to search..." oninput="executeSearch()" class="px-3 py-1.5 border border-slate-600 rounded-xl text-xs w-40 sm:w-56 bg-slate-800 text-white placeholder-slate-400 outline-none">
              </div>

              <div class="h-5 w-px bg-slate-700 flex-shrink-0"></div>

              <button onclick="printReportTextOnly()" class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm flex items-center space-x-1 whitespace-nowrap transition">
                <span>🖨️ Print</span>
              </button>
              <button onclick="emailReportTextOnly()" class="bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm flex items-center space-x-1 whitespace-nowrap transition">
                <span>✉️ Email</span>
              </button>
            </div>
          </div>
          <div id="debug-info" class="mt-2 text-center"></div>
        </div>

        <!-- SCROLLABLE RESULTS VIEWPORT -->
        <div id="records-list" class="flex-1 overflow-y-auto max-h-[calc(100vh-320px)] pr-1 min-h-[300px]">
          <p class="text-center text-slate-400 py-16 font-medium">Select a Year above to load records.</p>
        </div>
      </div>
    `;
    
    populateDynamicYears(colName, "sel-year");
    updateStatusBadge("debug-info", "idle", "Ready. Please select a Year above.");
  } else if (section === 'staircase') {
    renderStaircaseUI();
  } else if (section === 'toc') {
    renderTocUI();
  }
}

function onReportYearChange() {
  const year = document.getElementById("sel-year").value;
  const monthSel = document.getElementById("sel-month");
  if (!year) {
    monthSel.disabled = true;
    document.getElementById("records-list").innerHTML = `<p class="text-center text-slate-400 py-16 font-medium">Select a Year above to load records.</p>`;
    updateStatusBadge("debug-info", "idle", "Ready. Please select a Year.");
    return;
  }
  monthSel.disabled = false;
  fetchRecordsRealtime();
}

// REAL-TIME FIRESTORE LISTENER
function fetchRecordsRealtime() {
  const year = document.getElementById("sel-year") ? document.getElementById("sel-year").value : "";
  const month = document.getElementById("sel-month") ? document.getElementById("sel-month").value : "ALL";
  const listArea = document.getElementById("records-list");

  if (!year) {
    listArea.innerHTML = `<p class="text-center text-slate-400 py-16 font-medium">Select a Year above to load records.</p>`;
    return;
  }

  if (activeRealtimeUnsubscribe) {
    activeRealtimeUnsubscribe();
    activeRealtimeUnsubscribe = null;
  }

  listArea.innerHTML = `<div class="text-center py-16"><div class="animate-spin inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mb-2"></div><p class="text-sm text-slate-300 font-medium">Connecting to real-time Firestore stream...</p></div>`;
  updateStatusBadge("debug-info", "loading", `Connecting to Real-Time Cloud Firestore...`);

  const collectionName = (currentSection === 'parking') ? 'parking_violations' : 'breakdown_logs';

  try {
    const { collection, query, where, onSnapshot, limit } = window.fs;
    const colRef = collection(window.db, collectionName);

    let q;
    if (month !== "ALL") {
      q = query(colRef, where("_year", "==", year), where("_tabMonth", "==", month));
    } else {
      q = query(colRef, where("_year", "==", year), limit(300));
    }

    activeRealtimeUnsubscribe = onSnapshot(q, (querySnapshot) => {
      currentRawData = [];
      querySnapshot.forEach(doc => currentRawData.push(doc.data()));

      currentRawData = sortRecordsDescending(currentRawData);

      updateStatusBadge("debug-info", "success", `Live Stream Connected! ${currentRawData.length} records active.`);
      executeSearch();
    }, (err) => {
      updateStatusBadge("debug-info", "error", `Failed to connect real-time stream.`);
    });

  } catch (err) {
    updateStatusBadge("debug-info", "error", `Failed to load records.`);
  }
}

function getMonthNumFromTab(tabMonth) {
  if (!tabMonth) return null;
  let match = tabMonth.toString().match(/(0[1-9]|1[0-2]|[A-Za-z]{3})/i);
  if (match) {
    let tok = match[1].toLowerCase();
    if (MONTH_MAP[tok]) return MONTH_MAP[tok];
    if (!isNaN(tok)) return tok.padStart(2, '0');
  }
  return null;
}

// STRICT DD/MM/YYYY DATE PARSER & NORMALIZER
function parseAndFormatRecordDate(record) {
  if (record.epoch && !isNaN(record.epoch) && record.Date && record.Date.includes('/')) {
    return { displayDate: record.Date, epoch: parseInt(record.epoch, 10) };
  }

  let rawDate = record['Date'] || record['Timestamp'] || record['createdAt'] || '';
  let tabMonth = record._tabMonth || '';
  let rawYear = record._year || '2026';

  let day = '01';
  let month = getMonthNumFromTab(tabMonth) || '01';
  let year = rawYear;

  if (rawDate) {
    let s = rawDate.toString().trim();

    let mISO = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (mISO) {
      year = mISO[1];
      month = String(parseInt(mISO[2], 10)).padStart(2, '0');
      day = String(parseInt(mISO[3], 10)).padStart(2, '0');
    } else {
      let mJS = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})/i);
      if (mJS) {
        month = MONTH_MAP[mJS[1].toLowerCase()] || month;
        day = String(parseInt(mJS[2], 10)).padStart(2, '0');
        year = mJS[3];
      } else {
        let mSlash = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (mSlash) {
          let n1 = parseInt(mSlash[1], 10);
          let n2 = parseInt(mSlash[2], 10);
          year = mSlash[3];

          let tabM = getMonthNumFromTab(tabMonth);
          if (tabM) {
            let expM = parseInt(tabM, 10);
            if (n2 === expM) {
              day = String(n1).padStart(2, '0');
              month = String(expM).padStart(2, '0');
            } else if (n1 === expM) {
              month = String(expM).padStart(2, '0');
              day = String(n2).padStart(2, '0');
            } else {
              day = String(n1).padStart(2, '0');
              month = String(expM).padStart(2, '0');
            }
          } else {
            day = String(n1).padStart(2, '0');
            month = String(n2).padStart(2, '0');
          }
        }
      }
    }
  }

  let displayDate = `${day}/${month}/${year}`;
  let isoDateStr = `${year}-${month}-${day}T00:00:00Z`;
  let epoch = new Date(isoDateStr).getTime() || 0;

  return { displayDate, epoch };
}

function sortRecordsDescending(records) {
  return records.sort((a, b) => {
    let dateA = parseAndFormatRecordDate(a).epoch;
    let dateB = parseAndFormatRecordDate(b).epoch;

    if (dateB !== dateA) {
      return dateB - dateA;
    }

    let rowA = parseInt(a.rowNumber || 0, 10);
    let rowB = parseInt(b.rowNumber || 0, 10);
    return rowB - rowA;
  });
}

// STANDARDIZED TOC CAMERA UI
function renderTocUI() {
  const area = document.getElementById("content-area");
  area.innerHTML = `
    <div class="flex flex-col h-full">
      <!-- FIXED CONTROLS HEADER -->
      <div class="sticky top-0 z-20 bg-slate-900/90 backdrop-blur-xl p-3.5 rounded-2xl border border-white/15 shadow-2xl mb-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-base font-bold text-white tracking-wide whitespace-nowrap">📷 TOC Camera Photo Navigator</h2>

          <div class="flex flex-nowrap items-center gap-2 overflow-x-auto">
            <div class="flex items-center space-x-1 flex-shrink-0">
              <label class="text-xs font-semibold text-slate-300 whitespace-nowrap">1. Year:</label>
              <select id="sel-toc-year" onchange="onTocYearSelected()" class="px-3 py-1.5 border border-slate-600 rounded-xl text-xs bg-slate-800 text-white font-medium outline-none">
                <option value="" class="bg-slate-900">Loading...</option>
              </select>
            </div>

            <div class="flex items-center space-x-1 flex-shrink-0">
              <label class="text-xs font-semibold text-slate-300 whitespace-nowrap">2. Month:</label>
              <select id="sel-toc-month" onchange="onTocMonthSelected()" class="px-3 py-1.5 border border-slate-600 rounded-xl text-xs bg-slate-800 text-white font-medium outline-none" disabled>
                <option value="" class="bg-slate-900">-- Select Month --</option>
                <option value="08-AUG" class="bg-slate-900">08-AUG</option>
                <option value="07-JUL" class="bg-slate-900">07-JUL</option>
                <option value="06-JUN" class="bg-slate-900">06-JUN</option>
                <option value="05-MAY" class="bg-slate-900">05-MAY</option>
                <option value="04-APR" class="bg-slate-900">04-APR</option>
                <option value="03-MAR" class="bg-slate-900">03-MAR</option>
                <option value="02-FEB" class="bg-slate-900">02-FEB</option>
                <option value="01-JAN" class="bg-slate-900">01-JAN</option>
              </select>
            </div>

            <div class="flex items-center space-x-1 flex-shrink-0">
              <label class="text-xs font-semibold text-slate-300 whitespace-nowrap">3. Date:</label>
              <select id="sel-toc-date" onchange="loadTocPhotosFromFirestore()" class="px-3 py-1.5 border border-slate-600 rounded-xl text-xs bg-slate-800 text-white font-medium outline-none min-w-[120px]" disabled>
                <option value="" class="bg-slate-900">-- Select Date --</option>
              </select>
            </div>
          </div>
        </div>
        <div id="toc-status-bar" class="mt-2 text-center"></div>
      </div>

      <!-- SCROLLABLE PHOTO GRID -->
      <div id="photo-grid" class="flex-1 overflow-y-auto max-h-[calc(100vh-320px)] pr-1 min-h-[300px] text-center text-slate-400 py-16 font-medium">
        Select Year, Month, and Date above to view photos.
      </div>
    </div>
  `;
  populateDynamicYears("toc_photos", "sel-toc-year");
  updateStatusBadge("toc-status-bar", "idle", "Ready. Please select a Year.");
}

function onTocYearSelected() {
  const year = document.getElementById("sel-toc-year").value;
  const monthSel = document.getElementById("sel-toc-month");
  const dateSel = document.getElementById("sel-toc-date");

  if (!year) {
    monthSel.disabled = true;
    dateSel.disabled = true;
    dateSel.innerHTML = `<option value="" class="bg-slate-900">-- Select Date --</option>`;
    document.getElementById("photo-grid").innerHTML = `<p class="text-slate-400 py-16 font-medium">Select Year, Month, and Date above to view photos.</p>`;
    updateStatusBadge("toc-status-bar", "idle", "Ready. Please select a Year.");
    return;
  }

  monthSel.disabled = false;
  dateSel.disabled = true;
  dateSel.innerHTML = `<option value="" class="bg-slate-900">-- Select Date --</option>`;
  updateStatusBadge("toc-status-bar", "idle", "Please select a Month.");
}

async function onTocMonthSelected() {
  const year = document.getElementById("sel-toc-year").value;
  const month = document.getElementById("sel-toc-month").value;
  const dateSel = document.getElementById("sel-toc-date");
  const grid = document.getElementById("photo-grid");

  if (!month) {
    dateSel.disabled = true;
    dateSel.innerHTML = `<option value="" class="bg-slate-900">-- Select Date --</option>`;
    grid.innerHTML = `<p class="text-slate-400 py-16 font-medium">Select Year, Month, and Date above to view photos.</p>`;
    return;
  }

  dateSel.disabled = true;
  dateSel.innerHTML = `<option value="" class="bg-slate-900">Loading dates...</option>`;
  updateStatusBadge("toc-status-bar", "loading", "Fetching available dates...");

  try {
    const { collection, query, where, getDocs } = window.fs;
    const colRef = collection(window.db, "toc_photos");
    const q = query(colRef, where("year", "==", year), where("month", "==", month));
    const querySnapshot = await getDocs(q);

    let datesSet = new Set();
    querySnapshot.forEach(doc => {
      let d = doc.data().date;
      if (d) datesSet.add(d);
    });

    let dates = Array.from(datesSet).sort((a, b) => b.localeCompare(a));

    if (dates.length > 0) {
      dateSel.innerHTML = `<option value="" class="bg-slate-900">-- Select Date --</option>`;
      dates.forEach(d => dateSel.innerHTML += `<option value="${d}" class="bg-slate-900">${d}</option>`);
      dateSel.disabled = false;
      updateStatusBadge("toc-status-bar", "idle", "Please select a Date.");
    } else {
      dateSel.innerHTML = `<option value="ALL" class="bg-slate-900">All Dates in ${month}</option>`;
      for (let i = 31; i >= 1; i--) {
        let dStr = String(i).padStart(2, '0');
        dateSel.innerHTML += `<option value="${dStr}" class="bg-slate-900">${dStr}</option>`;
      }
      dateSel.disabled = false;
      updateStatusBadge("toc-status-bar", "idle", "Select a Date.");
    }
  } catch (err) {
    dateSel.disabled = false;
  }
}

async function loadTocPhotosFromFirestore() {
  const year = document.getElementById("sel-toc-year").value;
  const month = document.getElementById("sel-toc-month").value;
  const dateVal = document.getElementById("sel-toc-date").value;
  const grid = document.getElementById("photo-grid");

  if (!dateVal) {
    grid.innerHTML = `<p class="text-slate-400 py-16 font-medium">Please select a Date above.</p>`;
    return;
  }

  grid.innerHTML = `<div class="text-center py-16"><div class="animate-spin inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mb-2"></div><p class="text-sm text-slate-300 font-medium">Fetching TOC photos...</p></div>`;
  updateStatusBadge("toc-status-bar", "loading", "Fetching TOC Camera photos...");

  try {
    const { collection, query, where, getDocs, limit } = window.fs;
    const colRef = collection(window.db, "toc_photos");

    let q;
    if (dateVal === "ALL") {
      q = query(colRef, where("year", "==", year), where("month", "==", month), limit(150));
    } else {
      q = query(colRef, where("year", "==", year), where("month", "==", month), where("date", "==", dateVal));
    }

    const querySnapshot = await getDocs(q);
    const photos = [];
    querySnapshot.forEach(doc => photos.push(doc.data()));

    if (photos.length > 0) {
      updateStatusBadge("toc-status-bar", "success", `Loaded ${photos.length} photos!`);
      renderPhotoGrid(photos, grid);
    } else {
      updateStatusBadge("toc-status-bar", "idle", "No photos found.");
      grid.innerHTML = `<p class="text-slate-400 py-16 font-medium">No TOC Camera photos found for this date.</p>`;
    }
  } catch (err) {
    updateStatusBadge("toc-status-bar", "error", "Failed to load photos.");
  }
}

// STANDARDIZED L2 STAIRCASE UI
function renderStaircaseUI() {
  const area = document.getElementById("content-area");
  area.innerHTML = `
    <div class="flex flex-col h-full">
      <!-- FIXED CONTROLS HEADER -->
      <div class="sticky top-0 z-20 bg-slate-900/90 backdrop-blur-xl p-3.5 rounded-2xl border border-white/15 shadow-2xl mb-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-base font-bold text-white tracking-wide whitespace-nowrap">🪜 L2 Staircase Photos</h2>

          <div class="flex items-center space-x-1 flex-shrink-0">
            <label class="text-xs font-semibold text-slate-300 whitespace-nowrap">1. Year:</label>
            <select id="sel-staircase-year" onchange="loadStaircasePhotosWithFallback()" class="px-3 py-1.5 border border-slate-600 rounded-xl text-xs bg-slate-800 text-white font-medium outline-none">
              <option value="" class="bg-slate-900">Loading...</option>
            </select>
          </div>
        </div>
        <div id="staircase-status-bar" class="mt-2 text-center"></div>
      </div>

      <!-- SCROLLABLE PHOTO GRID -->
      <div id="staircase-photos-grid" class="flex-1 overflow-y-auto max-h-[calc(100vh-320px)] pr-1 min-h-[300px] text-center text-slate-400 py-16 font-medium">
        Select a Year above to load photos.
      </div>
    </div>
  `;
  populateDynamicYears("staircase_photos", "sel-staircase-year");
  updateStatusBadge("staircase-status-bar", "idle", "Ready. Please select a Year.");
}

async function loadStaircasePhotosWithFallback() {
  const year = document.getElementById("sel-staircase-year").value;
  const grid = document.getElementById("staircase-photos-grid");

  if (!year) {
    grid.innerHTML = `<p class="text-center text-slate-400 py-16 font-medium">Select a Year above to load photos.</p>`;
    updateStatusBadge("staircase-status-bar", "idle", "Ready. Please select a Year.");
    return;
  }

  grid.innerHTML = `<div class="text-center py-16"><div class="animate-spin inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mb-2"></div><p class="text-sm text-slate-300 font-medium">Fetching photos...</p></div>`;
  updateStatusBadge("staircase-status-bar", "loading", "Fetching L2 Staircase photos...");

  try {
    const { collection, query, where, getDocs, limit } = window.fs;
    const colRef = collection(window.db, "staircase_photos");
    const q = query(colRef, where("year", "==", year), limit(200));

    const querySnapshot = await getDocs(q);
    const photos = [];
    querySnapshot.forEach(doc => photos.push(doc.data()));

    if (photos.length > 0) {
      updateStatusBadge("staircase-status-bar", "success", `Loaded ${photos.length} photos in <100ms!`);
      renderPhotoGrid(photos, grid);
      return;
    }
  } catch (err) {}

  fetchStaircaseFromDriveDirectly(year, grid);
}

function fetchStaircaseFromDriveDirectly(year, grid) {
  updateStatusBadge("staircase-status-bar", "loading", "Scanning Google Drive folder directly...");

  fetch(`${API_URL}?action=getSubfolders&folderId=${DEFAULT_FOLDERS.STAIRCASE}`)
    .then(r => r.json())
    .then(res => {
      let yearFolder = (res.folders || []).find(f => f.name.trim() === year);
      let targetFolderId = yearFolder ? yearFolder.id : DEFAULT_FOLDERS.STAIRCASE;

      fetch(`${API_URL}?action=getAllPhotosInFolder&folderId=${targetFolderId}`)
        .then(r => r.json())
        .then(pRes => {
          if (pRes.photos && pRes.photos.length > 0) {
            updateStatusBadge("staircase-status-bar", "success", `Loaded ${pRes.photos.length} photos from Google Drive!`);
            renderPhotoGrid(pRes.photos, grid);
          } else {
            updateStatusBadge("staircase-status-bar", "idle", "Folder is empty.");
            grid.innerHTML = `<p class="text-slate-400 py-16 font-medium">No photos found for ${year}.</p>`;
          }
        })
        .catch(e => {
          grid.innerHTML = `<p class="text-red-400 py-16 font-medium">Error reading Drive photos.</p>`;
        });
    });
}

function renderPhotoGrid(photos, grid) {
  let html = `<div class="grid grid-cols-2 md:grid-cols-4 gap-4">`;
  photos.forEach(p => {
    let name = p.fileName || p.name || 'Photo';
    html += `
      <div onclick="openPhotoModal('${p.imgUrl}', '${name}')" class="bg-slate-900/70 border border-slate-700/80 rounded-2xl p-2.5 group shadow-xl hover:border-blue-400/50 transition cursor-zoom-in">
        <img src="${p.imgUrl}" class="w-full h-40 object-cover rounded-xl mb-2 shadow-md group-hover:scale-[1.02] transition duration-300">
        <p class="text-[11px] text-slate-300 truncate text-center font-medium">${name}</p>
      </div>
    `;
  });
  html += `</div>`;
  grid.innerHTML = html;
}

function executeSearch() {
  const query = (document.getElementById("search-input") ? document.getElementById("search-input").value : "").toLowerCase().trim();
  currentFilteredData = currentRawData;

  if (query) {
    currentFilteredData = currentRawData.filter(r => {
      return Object.values(r).some(val => val && val.toString().toLowerCase().includes(query));
    });
  }

  if (currentSection === 'parking') renderParkingCards(currentFilteredData);
  else if (currentSection === 'breakdown') renderBreakdownCards(currentFilteredData);
}

function loadMoreRecords() {
  currentDisplayLimit += 30;
  executeSearch();
}

// RENDER PARKING CARDS
function renderParkingCards(records) {
  const listArea = document.getElementById("records-list");
  if (!records || records.length === 0) {
    listArea.innerHTML = `<p class="text-center text-slate-400 py-16 font-medium">No parking violation records found.</p>`;
    return;
  }

  let displayRecords = records.slice(0, currentDisplayLimit);
  let isPaginated = records.length > currentDisplayLimit;

  let html = `<div class="text-xs text-slate-400 mb-3 font-semibold tracking-wide">Showing ${displayRecords.length} of ${records.length} records (Latest first)</div>`;
  html += `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">`;

  displayRecords.forEach(r => {
    const plateImg = convertDriveUrl(r['Plate Photo Link'] || r['Plate Photo']);
    const noticeImg = convertDriveUrl(r['Notice Photo Link'] || r['Notice Photo']);
    const vehicleImg = convertDriveUrl(r['Vehicle Photo Link'] || r['Vehicle Photo']);
    const formattedDate = parseAndFormatRecordDate(r).displayDate;

    html += `
      <div class="bg-slate-900/70 border border-slate-700/80 rounded-2xl p-4 shadow-xl backdrop-blur-md text-white hover:border-blue-400/50 transition">
        <div class="flex justify-between items-start mb-2">
          <span class="font-bold text-blue-400 text-lg tracking-wide">${r['License Plate'] || 'N/A'}</span>
          <span class="text-xs bg-slate-800 text-slate-300 font-semibold px-2.5 py-1 rounded-full border border-slate-700">${r._tabMonth || ''}</span>
        </div>
        <p class="text-xs text-slate-300 mb-1"><strong>Officer:</strong> ${r['Officer Name'] || '-'}</p>
        <p class="text-xs text-slate-300 mb-1"><strong>Date/Time:</strong> ${formattedDate} ${r['Time'] || ''}</p>
        <p class="text-xs text-slate-300 mb-3"><strong>Level:</strong> ${r['Level'] || '-'}</p>

        <div class="grid grid-cols-3 gap-2 pt-2 border-t border-slate-700/80 mt-2">
          ${renderPhotoThumbnail(plateImg, 'Plate')}
          ${renderPhotoThumbnail(noticeImg, 'Notice')}
          ${renderPhotoThumbnail(vehicleImg, 'Vehicle')}
        </div>
      </div>
    `;
  });
  html += `</div>`;

  if (isPaginated) {
    html += `
      <div class="text-center mt-6">
        <button onclick="loadMoreRecords()" class="bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-semibold px-6 py-2.5 rounded-xl shadow-sm text-xs transition">
          👇 Load More Records (${records.length - currentDisplayLimit} remaining)
        </button>
      </div>
    `;
  }

  listArea.innerHTML = html;
}

// RENDER BREAKDOWN CARDS
function renderBreakdownCards(records) {
  const listArea = document.getElementById("records-list");
  if (!records || records.length === 0) {
    listArea.innerHTML = `<p class="text-center text-slate-400 py-16 font-medium">No breakdown logs found.</p>`;
    return;
  }

  let displayRecords = records.slice(0, currentDisplayLimit);
  let isPaginated = records.length > currentDisplayLimit;

  let html = `<div class="text-xs text-slate-400 mb-3 font-semibold tracking-wide">Showing ${displayRecords.length} of ${records.length} records (Latest first)</div>`;
  html += `<div class="space-y-3">`;

  displayRecords.forEach(r => {
    const isResolved = (r['Status'] || '').toLowerCase().includes('resolved');
    const badgeClass = isResolved ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-red-500/20 text-red-300 border-red-500/30';
    const photoImg = convertDriveUrl(r['Photo Link'] || r['Photo']);
    const formattedDate = parseAndFormatRecordDate(r).displayDate;

    html += `
      <div class="bg-slate-900/70 border border-slate-700/80 rounded-2xl p-4 shadow-xl backdrop-blur-md text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-red-400/50 transition">
        <div class="flex-1">
          <div class="flex flex-wrap items-center gap-2 mb-1.5">
            <span class="font-bold text-white text-base tracking-wide">${r['Asset Unit'] || 'Asset'}</span>
            <span class="text-xs font-bold px-2.5 py-0.5 rounded-full border ${badgeClass}">${r['Status'] || 'Pending'}</span>
            <span class="text-xs text-slate-400 font-medium">📅 ${formattedDate || r._tabMonth}</span>
          </div>
          <p class="text-xs text-slate-300 mt-1"><strong>Brand/Type:</strong> ${r['Asset Brand/Type'] || '-'}</p>
          <p class="text-xs text-red-400 mt-0.5"><strong>Issue/Fault:</strong> ${r['Issue / Fault'] || '-'}</p>
          <p class="text-xs text-slate-300 mt-0.5"><strong>Action Taken:</strong> ${r['Action Taken / Result'] || '-'}</p>
        </div>
        <div class="w-full md:w-32 flex-shrink-0">
          ${renderPhotoThumbnail(photoImg, 'Photo')}
        </div>
      </div>
    `;
  });
  html += `</div>`;

  if (isPaginated) {
    html += `
      <div class="text-center mt-6">
        <button onclick="loadMoreRecords()" class="bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-semibold px-6 py-2.5 rounded-xl shadow-sm text-xs transition">
          👇 Load More Records (${records.length - currentDisplayLimit} remaining)
        </button>
      </div>
    `;
  }

  listArea.innerHTML = html;
}

// PRINT REPORT
function printReportTextOnly() {
  if (!currentFilteredData || currentFilteredData.length === 0) { alert("No records to print."); return; }
  const area = document.getElementById("printable-area");
  const reportTitle = currentSection === 'parking' ? 'Parking Violations Text Report' : 'Breakdown Logs Text Report';
  
  let html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="font-size: 20px; font-weight: bold; margin-bottom: 5px;">WA FCC Portal Report - ${reportTitle}</h2>
      <p style="font-size: 12px; color: #666; margin-bottom: 20px;">Generated: ${new Date().toLocaleString()} | Records: ${currentFilteredData.length}</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="background-color: #f2f2f2; text-align: left;">
            <th style="border: 1px solid #ddd; padding: 8px;">#</th>
            ${currentSection === 'parking' ? `
              <th style="border: 1px solid #ddd; padding: 8px;">Date/Time</th>
              <th style="border: 1px solid #ddd; padding: 8px;">License Plate</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Officer</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Level</th>
            ` : `
              <th style="border: 1px solid #ddd; padding: 8px;">Date</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Asset Unit</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Issue / Fault</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Action / Result</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Status</th>
            `}
          </tr>
        </thead>
        <tbody>
  `;

  currentFilteredData.forEach((r, idx) => {
    const formattedDate = parseAndFormatRecordDate(r).displayDate;
    html += `
      <tr>
        <td style="border: 1px solid #ddd; padding: 8px;">${idx + 1}</td>
        ${currentSection === 'parking' ? `
          <td style="border: 1px solid #ddd; padding: 8px;">${formattedDate} ${r['Time'] || ''}</td>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">${r['License Plate'] || '-'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${r['Officer Name'] || '-'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${r['Level'] || '-'}</td>
        ` : `
          <td style="border: 1px solid #ddd; padding: 8px;">${formattedDate}</td>
          <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">${r['Asset Unit'] || '-'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${r['Issue / Fault'] || '-'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${r['Action Taken / Result'] || '-'}</td>
          <td style="border: 1px solid #ddd; padding: 8px;">${r['Status'] || '-'}</td>
        `}
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  area.innerHTML = html;
  area.classList.remove("hidden");
  window.print();
  area.classList.add("hidden");
}

// EMAIL REPORT
function emailReportTextOnly() {
  if (!currentFilteredData || currentFilteredData.length === 0) { alert("No records to email."); return; }
  const subject = encodeURIComponent(`WA FCC Portal Report Summary - ${currentSection.toUpperCase()}`);
  let bodyText = `WA FCC Portal Report Summary List (%0D%0ATotal Records: ${currentFilteredData.length})%0D%0A%0D%0A`;

  currentFilteredData.forEach((r, idx) => {
    const formattedDate = parseAndFormatRecordDate(r).displayDate;
    if (currentSection === 'parking') {
      bodyText += `${idx + 1}. Plate: ${r['License Plate']} | Officer: ${r['Officer Name']} | Level: ${r['Level']} | Date: ${formattedDate}%0D%0A`;
    } else {
      bodyText += `${idx + 1}. Asset: ${r['Asset Unit']} | Fault: ${r['Issue / Fault']} | Status: ${r['Status']} | Date: ${formattedDate}%0D%0A`;
    }
  });

  window.location.href = `mailto:?subject=${subject}&body=${bodyText}`;
}

// HELPERS
function convertDriveUrl(url) {
  if (!url || url === '-' || url.toString().trim() === '') return '';
  let s = url.toString().trim();
  let match = s.match(/(?:\/d\/|id=|=HYPERLINK\(")(a-zA-Z0-9_-]{25,})/i) || s.match(/([a-zA-Z0-9_-]{25,})/);
  if (match && match[1] && !match[1].startsWith('http')) {
    return `https://lh3.googleusercontent.com/d/${match[1]}`;
  }
  if (s.startsWith('http')) return s;
  return '';
}

function renderPhotoThumbnail(imgUrl, label) {
  if (!imgUrl) return `<div class="bg-slate-950/80 rounded-lg p-2 text-center text-[10px] text-slate-500 border border-slate-800">No ${label}</div>`;
  return `
    <div onclick="openPhotoModal('${imgUrl}', '${label}')" class="block group relative overflow-hidden rounded-lg bg-slate-950 border border-slate-700/80 cursor-zoom-in">
      <img src="${imgUrl}" class="w-full h-16 object-cover group-hover:scale-105 transition duration-300" loading="lazy">
      <span class="absolute bottom-0 inset-x-0 bg-black/75 text-white text-[9px] text-center py-0.5 font-medium">${label}</span>
    </div>
  `;
}

function openPhotoModal(imgUrl, title) {
  document.getElementById("modal-img").src = imgUrl;
  document.getElementById("modal-caption").innerText = title || "Photo Preview";
  document.getElementById("photo-modal").classList.remove("hidden");
}

function closePhotoModal() {
  document.getElementById("photo-modal").classList.add("hidden");
}

function updateStatusBadge(targetId, state, message) {
  const debugBox = document.getElementById(targetId);
  if (!debugBox) return;
  if (state === "loading") {
    debugBox.innerHTML = `<span class="text-xs text-blue-400 font-semibold animate-pulse">⚙️ ${message}</span>`;
  } else if (state === "success") {
    debugBox.innerHTML = `<span class="text-xs text-emerald-400 font-semibold">✅ ${message}</span>`;
  } else {
    debugBox.innerHTML = `<span class="text-xs text-red-400 font-semibold">⚠️ ${message}</span>`;
  }
}

// BIND FUNCTIONS TO WINDOW OBJECT
window.loginUser = loginUser;
window.logout = logout;
window.showSection = showSection;
window.onReportYearChange = onReportYearChange;
window.fetchRecordsRealtime = fetchRecordsRealtime;
window.onTocYearSelected = onTocYearSelected;
window.onTocMonthSelected = onTocMonthSelected;
window.loadTocPhotosFromFirestore = loadTocPhotosFromFirestore;
window.loadStaircasePhotosWithFallback = loadStaircasePhotosWithFallback;
window.executeSearch = executeSearch;
window.loadMoreRecords = loadMoreRecords;
window.printReportTextOnly = printReportTextOnly;
window.emailReportTextOnly = emailReportTextOnly;
window.openPhotoModal = openPhotoModal;
window.closePhotoModal = closePhotoModal;
window.closeInactivityModal = closeInactivityModal;