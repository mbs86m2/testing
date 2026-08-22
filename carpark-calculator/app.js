/**
 * Carpark Booth Charges Calculator - Main Application Logic
 * Wisma Atria MCST 1471 (Soft Light Theme)
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
// 2. FIREBASE REALTIME DATABASE CONFIGURATION
// ==============================================================
const firebaseConfig = {
    databaseURL: "https://wa-fcc-portal-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const ACCOUNTS_SOURCE_PATH = "portalData/accounts";
const PERMISSIONS_STORAGE_PATH = "portalData/barrier_permissions";
const ADMIN_MASTER_PIN = "1251";

// Dedicated Admin Usernames with permanent full access
const ADMIN_USERNAMES = ["admin", "master", "m2", "keekc"];

let isRTDBReady = false;
let isUserAuthorized = false;
let extractedAccounts = [];
let barrierPermissionsMap = {};

// Load cached permissions immediately from local storage
try {
    const cached = localStorage.getItem('wafp_cached_barrier_perms');
    if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') barrierPermissionsMap = parsed;
    }
} catch(e) {}

// Initialize Firebase RTDB and attach persistent real-time listeners
try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    isRTDBReady = true;

    // Real-Time Persistent Listener for Barrier Permissions Node
    firebase.database().ref(PERMISSIONS_STORAGE_PATH).on('value', snap => {
        const data = snap.val();
        if (data && typeof data === 'object') {
            Object.entries(data).forEach(([k, v]) => {
                if (v === true || v === "true" || v === 1) {
                    barrierPermissionsMap[k] = true;
                    barrierPermissionsMap[sanitizeRTDBKey(k)] = true;
                    barrierPermissionsMap[k.toLowerCase()] = true;
                } else if (v === false || v === "false" || v === 0) {
                    barrierPermissionsMap[k] = false;
                    barrierPermissionsMap[sanitizeRTDBKey(k)] = false;
                    barrierPermissionsMap[k.toLowerCase()] = false;
                }
            });
            try {
                localStorage.setItem('wafp_cached_barrier_perms', JSON.stringify(barrierPermissionsMap));
            } catch(e) {}
        }
        renderOfficersListFromAccounts();
        checkOfficerPermission();
    }, err => {
        console.warn("Firebase permissions listener error:", err);
    });

    // Real-Time Listener for Accounts Node
    firebase.database().ref(ACCOUNTS_SOURCE_PATH).on('value', snap => {
        processAccountsSnapshot(snap.val());
        checkOfficerPermission();
    }, err => {
        console.warn("Firebase accounts listener error:", err);
    });

} catch (e) {
    console.warn("Firebase RTDB init error:", e);
}

function extractUsername(item) {
    if (!item) return null;
    if (typeof item === 'string') return item.trim();
    if (typeof item === 'object') {
        return (item.username || item.name || item.user || item.officer || item.accountName || item.id || '').trim();
    }
    return null;
}

function extractPassword(item) {
    if (!item || typeof item !== 'object') return '';
    return String(item.password || item.pass || item.pin || item.passcode || item.pwd || '').trim();
}

function sanitizeRTDBKey(name) {
    return (name || '').replace(/[\.\#\$\[\]\/]/g, '_').trim();
}

function isAccountAdmin(username) {
    if (!username) return false;
    const norm = username.trim().toLowerCase();
    return ADMIN_USERNAMES.includes(norm) || norm.includes('admin') || norm.includes('master');
}

function processAccountsSnapshot(accountsData) {
    extractedAccounts = [];
    if (!accountsData) return;

    if (Array.isArray(accountsData)) {
        accountsData.forEach((item, index) => {
            const u = extractUsername(item);
            const p = extractPassword(item);
            if (u && !extractedAccounts.some(a => a.username.toLowerCase() === u.toLowerCase())) {
                const rawPerm = (item && typeof item === 'object') ? (item.barrier_permission ?? item.canOpen ?? item.canOpenBarrier) : null;
                const hasPerm = (rawPerm === true || rawPerm === "true" || rawPerm === 1);

                extractedAccounts.push({
                    username: u,
                    password: p,
                    raw: item,
                    firebaseKey: String(index),
                    barrier_permission: hasPerm
                });

                if (hasPerm) {
                    barrierPermissionsMap[u] = true;
                    barrierPermissionsMap[sanitizeRTDBKey(u)] = true;
                    barrierPermissionsMap[u.toLowerCase()] = true;
                }
            }
        });
    } else if (typeof accountsData === 'object') {
        Object.entries(accountsData).forEach(([key, item]) => {
            const u = extractUsername(item) || key;
            const p = extractPassword(item);
            if (u && !extractedAccounts.some(a => a.username.toLowerCase() === u.toLowerCase())) {
                const rawPerm = (item && typeof item === 'object') ? (item.barrier_permission ?? item.canOpen ?? item.canOpenBarrier) : null;
                const hasPerm = (rawPerm === true || rawPerm === "true" || rawPerm === 1);

                extractedAccounts.push({
                    username: u,
                    password: p,
                    raw: item,
                    firebaseKey: key,
                    barrier_permission: hasPerm
                });

                if (hasPerm) {
                    barrierPermissionsMap[u] = true;
                    barrierPermissionsMap[sanitizeRTDBKey(u)] = true;
                    barrierPermissionsMap[u.toLowerCase()] = true;
                }
            }
        });
    }

    extractedAccounts.sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));

    try {
        localStorage.setItem('wafp_cached_barrier_perms', JSON.stringify(barrierPermissionsMap));
    } catch(e) {}

    renderOfficersListFromAccounts();
}

function getLoggedInOfficerName() {
    const urlParams = new URLSearchParams(window.location.search);
    let officer = urlParams.get('user') || urlParams.get('officer') || urlParams.get('username') || urlParams.get('name') || urlParams.get('id');
    if (officer && officer.trim()) {
        try {
            localStorage.setItem('wafp_active_officer', officer.trim());
            localStorage.setItem('wafp_user', officer.trim());
        } catch(e) {}
        return officer.trim();
    }

    const possibleKeys = [
        'wafp_active_officer', 'wafp_user', 'username', 'officer', 'user', 
        'loggedInUser', 'currentUser', 'officer_name', 'auth_user', 'session_user',
        'portal_active_user', 'wafp_logged_officer'
    ];

    for (let k of possibleKeys) {
        let val = null;
        try { val = localStorage.getItem(k) || sessionStorage.getItem(k); } catch(e) {}
        if (val) {
            try {
                let parsed = JSON.parse(val);
                if (parsed && typeof parsed === 'object') {
                    val = parsed.username || parsed.name || parsed.user || parsed.id || parsed.officer;
                }
            } catch(e) {}
            if (typeof val === 'string' && val.trim()) return val.trim();
        }
    }
    return null;
}

function isOfficerPermitted(officerName) {
    if (!officerName) return false;
    if (isAccountAdmin(officerName)) return true;

    const normName = officerName.trim().toLowerCase();
    const cleanKey = sanitizeRTDBKey(officerName);
    if (barrierPermissionsMap[cleanKey] === true || barrierPermissionsMap[cleanKey] === "true") return true;
    if (barrierPermissionsMap[officerName] === true || barrierPermissionsMap[officerName] === "true") return true;
    if (barrierPermissionsMap[normName] === true || barrierPermissionsMap[normName] === "true") return true;

    const targetClean = normName.replace(/[^a-z0-9]/g, '');
    for (const [key, val] of Object.entries(barrierPermissionsMap)) {
        const permKeyClean = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (permKeyClean === targetClean) {
            if (val === true || val === "true" || val === 1 || (typeof val === 'object' && val !== null && (val.canOpen === true || val.granted === true))) {
                return true;
            }
        }
    }

    const acc = extractedAccounts.find(a => a.username.toLowerCase() === normName);
    if (acc) {
        if (acc.barrier_permission === true || acc.barrier_permission === "true") return true;
        if (acc.raw && typeof acc.raw === 'object') {
            const rawPerm = acc.raw.barrier_permission ?? acc.raw.canOpen ?? acc.raw.canOpenBarrier ?? acc.raw.role;
            if (rawPerm === true || rawPerm === "true" || rawPerm === 1 || rawPerm === "admin") return true;
        }
    }
    return false;
}

function checkOfficerPermission() {
    const officer = getLoggedInOfficerName();
    const badge = document.getElementById('officerBadge');
    const badgeLabel = document.getElementById('officerNameLabel');
    const barrierContainer = document.getElementById('barrierContainer');

    if (!officer) {
        badgeLabel.innerText = "Login";
        badge.className = 'officer-badge unauthorized';
        isUserAuthorized = false;
        barrierContainer.style.display = 'none';
        return;
    }

    badgeLabel.innerText = officer;

    if (isOfficerPermitted(officer)) {
        isUserAuthorized = true;
        barrierContainer.style.display = 'flex';
        badge.className = 'officer-badge authorized';
    } else {
        isUserAuthorized = false;
        barrierContainer.style.display = 'none';
        badge.className = 'officer-badge unauthorized';
    }
}

// ==============================================================
// 3. OFFICER LOGIN MODAL
// ==============================================================
function openOfficerAuthModal(prefillUsername = '') {
    const userInput = document.getElementById('officerUsernameInput');
    const passInput = document.getElementById('officerPasswordInput');
    const errBox = document.getElementById('officerAuthError');

    errBox.style.display = 'none';
    passInput.value = '';

    const currentOfficer = getLoggedInOfficerName();
    userInput.value = prefillUsername || currentOfficer || '';

    document.getElementById('officerAuthModal').style.display = 'flex';
    setTimeout(() => {
        if (!userInput.value) userInput.focus();
        else passInput.focus();
    }, 150);
}

function closeOfficerAuthModal() {
    document.getElementById('officerAuthModal').style.display = 'none';
}

function submitOfficerAuth() {
    const userInput = document.getElementById('officerUsernameInput');
    const passInput = document.getElementById('officerPasswordInput');
    const errBox = document.getElementById('officerAuthError');

    const enteredUsername = userInput.value.trim();
    const enteredPassword = passInput.value.trim().toUpperCase();

    if (!enteredUsername) {
        errBox.innerText = "Please enter your username.";
        errBox.style.display = 'block';
        userInput.focus();
        return;
    }

    const account = extractedAccounts.find(a => a.username.toLowerCase() === enteredUsername.toLowerCase());
    
    if (!account) {
        errBox.innerText = "Officer username not found in database.";
        errBox.style.display = 'block';
        userInput.focus();
        return;
    }

    const storedPassword = String(account.password || '').trim().toUpperCase();

    const isPasswordCorrect = (storedPassword !== '' && enteredPassword === storedPassword) ||
                              (storedPassword === '' && enteredPassword === '') ||
                              (enteredPassword === ADMIN_MASTER_PIN);

    if (isPasswordCorrect) {
        try {
            localStorage.setItem('wafp_active_officer', account.username);
            localStorage.setItem('wafp_user', account.username);
        } catch(e) {}
        
        closeOfficerAuthModal();
        renderOfficersListFromAccounts();
        checkOfficerPermission();
    } else {
        errBox.innerText = `Incorrect password for ${account.username}. Access denied.`;
        errBox.style.display = 'block';
        passInput.value = '';
        passInput.focus();
    }
}

// ==============================================================
// 4. ADMIN ACCESS CONTROL MODAL
// ==============================================================
function openAdminModal() {
    const currentOfficer = getLoggedInOfficerName();
    
    if (!isAccountAdmin(currentOfficer)) {
        const enteredPin = prompt("Enter Admin Master PIN:");
        if (enteredPin !== ADMIN_MASTER_PIN) {
            alert("Incorrect PIN. Access Denied.");
            return;
        }
    }

    document.getElementById('adminModal').style.display = 'flex';
    loadPortalAccountsFromRTDB();
}

function closeAdminModal() {
    document.getElementById('adminModal').style.display = 'none';
}

async function loadPortalAccountsFromRTDB() {
    const container = document.getElementById('officersListContainer');
    container.innerHTML = '<div style="text-align:center; padding: 25px; color: var(--text-muted); font-size: 12px;">Loading accounts from portalData/accounts...</div>';

    if (!isRTDBReady) {
        container.innerHTML = '<div style="text-align:center; padding: 25px; color: var(--danger); font-size: 12px;">Firebase RTDB not connected.</div>';
        return;
    }

    try {
        const [accountsSnap, permsSnap] = await Promise.all([
            firebase.database().ref(ACCOUNTS_SOURCE_PATH).once('value'),
            firebase.database().ref(PERMISSIONS_STORAGE_PATH).once('value')
        ]);

        const permsData = permsSnap.val();
        if (permsData && typeof permsData === 'object') {
            Object.entries(permsData).forEach(([k, v]) => {
                barrierPermissionsMap[k] = (v === true || v === "true" || v === 1);
                barrierPermissionsMap[sanitizeRTDBKey(k)] = (v === true || v === "true" || v === 1);
                barrierPermissionsMap[k.toLowerCase()] = (v === true || v === "true" || v === 1);
            });
            try {
                localStorage.setItem('wafp_cached_barrier_perms', JSON.stringify(barrierPermissionsMap));
            } catch(e) {}
        }

        processAccountsSnapshot(accountsSnap.val());
        renderOfficersListFromAccounts();
    } catch (err) {
        console.error("Error loading accounts:", err);
        container.innerHTML = `<div style="text-align:center; padding: 25px; color: var(--danger); font-size: 12px;">Error reading accounts: ${err.message}</div>`;
    }
}

function renderOfficersListFromAccounts() {
    const container = document.getElementById('officersListContainer');
    if (!container || document.getElementById('adminModal').style.display !== 'flex') return;

    if (extractedAccounts.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 25px; color: var(--text-muted); font-size: 12px;">No accounts found under portalData/accounts.</div>';
        return;
    }

    const activeOfficer = getLoggedInOfficerName();
    container.innerHTML = '';

    extractedAccounts.forEach(acc => {
        const officerName = acc.username;
        const isGranted = isOfficerPermitted(officerName);
        const isMe = activeOfficer && (activeOfficer.toLowerCase() === officerName.toLowerCase());

        const item = document.createElement('div');
        item.className = 'officer-list-item';
        item.innerHTML = `
            <div class="officer-item-left">
                <span class="officer-item-name">${officerName}</span>
                <button type="button" class="btn-select-as-me" onclick="openOfficerAuthModal('${officerName}')">
                    ${isMe ? '✓ Active' : 'Set as Me'}
                </button>
            </div>
            <div class="btn-group-perm">
                <button type="button" 
                        class="btn-perm-choice ${isGranted ? 'active-grant' : 'inactive'}" 
                        onclick="setOfficerAccessStatus('${officerName}', true)">
                    Grant
                </button>
                <button type="button" 
                        class="btn-perm-choice ${!isGranted ? 'active-revoke' : 'inactive'}" 
                        onclick="setOfficerAccessStatus('${officerName}', false)">
                    Revoke
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

async function setOfficerAccessStatus(officerName, newStatus) {
    const cleanKey = sanitizeRTDBKey(officerName);
    const normName = officerName.trim().toLowerCase();
    
    barrierPermissionsMap[cleanKey] = newStatus;
    barrierPermissionsMap[officerName] = newStatus;
    barrierPermissionsMap[normName] = newStatus;

    const acc = extractedAccounts.find(a => a.username.toLowerCase() === normName);
    if (acc) {
        acc.barrier_permission = newStatus;
        if (acc.raw && typeof acc.raw === 'object') {
            acc.raw.barrier_permission = newStatus;
        }
    }

    try {
        localStorage.setItem('wafp_cached_barrier_perms', JSON.stringify(barrierPermissionsMap));
    } catch(e) {}
    
    renderOfficersListFromAccounts();
    checkOfficerPermission();

    try {
        const permRef = firebase.database().ref(PERMISSIONS_STORAGE_PATH);
        await permRef.child(cleanKey).set(newStatus);
        if (cleanKey !== officerName) {
            await permRef.child(officerName).set(newStatus);
        }

        if (acc && acc.firebaseKey) {
            await firebase.database().ref(`${ACCOUNTS_SOURCE_PATH}/${acc.firebaseKey}/barrier_permission`).set(newStatus);
        } else {
            await firebase.database().ref(`${ACCOUNTS_SOURCE_PATH}/${cleanKey}/barrier_permission`).set(newStatus);
        }
    } catch (err) {
        console.error("Direct Firebase permission write error:", err);
        alert("Database Sync Alert: " + err.message);
    }
}

// ==============================================================
// 5. CALCULATOR ENGINE & PUBLIC HOLIDAYS
// ==============================================================
let currentVehicle = 'car';
let isRealTimeMode = true;
let liveClockInterval = null;

const PORTAL_URL = "../index.html";

function goToPortal() {
    window.location.href = PORTAL_URL;
}

function lockOrientation() {
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {});
    }
}

let idleTimer = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS);
}

function onIdleTimeout() {
    goToPortal();
}

function selectAllText(elem) {
    setTimeout(() => {
        elem.focus();
        if (elem.setSelectionRange) {
            elem.setSelectionRange(0, 9999);
        } else if (elem.select) {
            elem.select();
        }
    }, 20);
}

['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click', 'change', 'input'].forEach(evt => {
    document.addEventListener(evt, () => {
        resetIdleTimer();
        lockOrientation();
    }, true);
});

const sgPublicHolidays = new Set([
    // 2026
    "2026-01-01", "2026-02-17", "2026-02-18", "2026-03-20", "2026-04-03", 
    "2026-05-01", "2026-05-27", "2026-05-31", "2026-06-01", "2026-08-09", 
    "2026-08-10", "2026-11-08", "2026-11-09", "2026-12-25",
    // 2027
    "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-03-10", 
    "2027-03-26", "2027-05-01", "2027-05-17", "2027-05-20", "2027-08-09", 
    "2027-10-29", "2027-12-25",
    // 2028
    "2028-01-01", "2028-01-26", "2028-01-27", "2028-02-27", "2028-02-28", 
    "2028-04-14", "2028-05-01", "2028-05-05", "2028-05-08", "2028-08-09", 
    "2028-10-17", "2028-12-25"
]);

window.onload = function() {
    let now = new Date();
    let entryDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    populateCustomEntryUI(entryDate);
    document.getElementById('settingsExitTime').value = formatToISO(now);

    startRealTimeClock();
    runCalculation();
    resetIdleTimer();
    lockOrientation();
    checkOfficerPermission();
};

function switchTab(tabName) {
    document.getElementById('view-main').classList.toggle('active', tabName === 'main');
    document.getElementById('view-settings').classList.toggle('active', tabName === 'settings');
    
    document.getElementById('navMain').classList.toggle('active', tabName === 'main');
    document.getElementById('navSettings').classList.toggle('active', tabName === 'settings');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startRealTimeClock() {
    if (liveClockInterval) clearInterval(liveClockInterval);
    liveClockInterval = setInterval(() => {
        if (isRealTimeMode) {
            let now = new Date();
            document.getElementById('settingsExitTime').value = formatToISO(now);
            document.getElementById('liveExitTimeDisplay').innerText = now.toLocaleTimeString();
            runCalculation();
        }
    }, 1000);
}

function toggleRealTimeMode(enabled) {
    isRealTimeMode = enabled;
    document.getElementById('chkRealTimeExit').checked = enabled;
    
    let liveBox = document.getElementById('liveStatusContainer');
    let liveDot = document.getElementById('liveDot');
    let modeLabel = document.getElementById('liveModeLabel');

    if (enabled) {
        liveBox.style.background = '#d1fae5';
        liveBox.style.borderColor = '#a7f3d0';
        liveDot.style.backgroundColor = 'var(--success)';
        liveDot.style.animation = 'pulse 1.6s infinite';
        modeLabel.innerText = 'Exit: Real-Time Clock';
        modeLabel.style.color = '#065f46';
        runCalculation();
    } else {
        liveBox.style.background = '#fef3c7';
        liveBox.style.borderColor = '#fde68a';
        liveDot.style.backgroundColor = 'var(--warning)';
        liveDot.style.animation = 'none';
        modeLabel.innerText = 'Exit: Manual Locked Mode';
        modeLabel.style.color = '#92400e';
        let exitVal = document.getElementById('settingsExitTime').value;
        if (exitVal) {
            let d = new Date(exitVal);
            document.getElementById('liveExitTimeDisplay').innerText = d.toLocaleTimeString();
        }
        runCalculation();
    }
}

function populateCustomEntryUI(dateObj) {
    let y = dateObj.getFullYear();
    let m = String(dateObj.getMonth() + 1).padStart(2, '0');
    let d = String(dateObj.getDate()).padStart(2, '0');
    let dateStr = `${y}-${m}-${d}`;

    let hr24 = dateObj.getHours();
    let mn = dateObj.getMinutes();

    let formattedHr = String(hr24).padStart(2, '0');
    let formattedMn = String(mn).padStart(2, '0');

    document.getElementById('entryDateInput').value = dateStr;
    document.getElementById('entryHourInput').value = formattedHr;
    document.getElementById('entryMinuteInput').value = formattedMn;

    document.getElementById('settingsEntryDateInput').value = dateStr;
    document.getElementById('settingsEntryHourInput').value = formattedHr;
    document.getElementById('settingsEntryMinuteInput').value = formattedMn;
}

function handleTimeInput(elem, nextId, source) {
    let val = elem.value.replace(/[^0-9]/g, '');
    if (val.length > 2) val = val.slice(0, 2);
    elem.value = val;

    if (val.length === 2 && nextId) {
        let nextElem = document.getElementById(nextId);
        if (nextElem) selectAllText(nextElem);
    }
    onCustomEntryChange(source);
}

function onCustomEntryChange(source) {
    let prefix = source === 'settings' ? 'settings' : '';
    let dInput = document.getElementById(prefix ? 'settingsEntryDateInput' : 'entryDateInput').value;
    let hInput = document.getElementById(prefix ? 'settingsEntryHourInput' : 'entryHourInput').value;
    let mInput = document.getElementById(prefix ? 'settingsEntryMinuteInput' : 'entryMinuteInput').value;

    let otherPrefix = source === 'settings' ? '' : 'settings';
    document.getElementById(otherPrefix ? 'settingsEntryDateInput' : 'entryDateInput').value = dInput;
    document.getElementById(otherPrefix ? 'settingsEntryHourInput' : 'entryHourInput').value = hInput;
    document.getElementById(otherPrefix ? 'settingsEntryMinuteInput' : 'entryMinuteInput').value = mInput;

    runCalculation();
}

function getParsedEntryDate() {
    let dateStr = document.getElementById('entryDateInput').value;
    let hrVal = parseInt(document.getElementById('entryHourInput').value, 10);
    let mnVal = parseInt(document.getElementById('entryMinuteInput').value, 10);

    if (!dateStr || isNaN(hrVal) || isNaN(mnVal)) return null;

    if (hrVal < 0) hrVal = 0; if (hrVal > 23) hrVal = 23;
    if (mnVal < 0) mnVal = 0; if (mnVal > 59) mnVal = 59;

    let [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d, hrVal, mnVal, 0, 0);
}

function onManualExitChange(val) {
    toggleRealTimeMode(false);
    if (val) {
        let d = new Date(val);
        document.getElementById('liveExitTimeDisplay').innerText = d.toLocaleTimeString();
    }
    runCalculation();
}

function setVehicle(type) {
    currentVehicle = type;
    document.getElementById('btnCar').classList.toggle('active', type === 'car');
    document.getElementById('btnMotor').classList.toggle('active', type === 'motorcycle');
    runCalculation();
}

function formatToISO(date) {
    let year = date.getFullYear();
    let month = String(date.getMonth() + 1).padStart(2, '0');
    let day = String(date.getDate()).padStart(2, '0');
    let hour = String(date.getHours()).padStart(2, '0');
    let minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}`;
}

function isLunchTimeEntry(entryDate) {
    let hrMin = entryDate.getHours() * 100 + entryDate.getMinutes();
    return (hrMin >= 1200 && hrMin < 1400);
}

function runCalculation() {
    let entry = getParsedEntryDate();
    let exitVal = document.getElementById('settingsExitTime').value;
    
    let resultsBox = document.getElementById('resultsContent');
    let errorBox = document.getElementById('errorContainer');
    
    if (!entry || !exitVal) {
        showError("Please specify valid Entry and Exit date/time.");
        return;
    }

    let exit = new Date(exitVal);
    if (exit <= entry) {
        showError("Exit time must be strictly after the Entry time.");
        return;
    }

    resultsBox.style.display = 'block';
    errorBox.style.display = 'none';

    let res = calculateCost(currentVehicle, entry, exit);

    document.getElementById('lblTotal').innerText = `$${res.total.toFixed(2)}`;
    document.getElementById('lblDuration').innerText = res.durationStr;

    let container = document.getElementById('breakdownContainer');
    container.innerHTML = '';
    res.breakdown.forEach(item => {
        let badgeClass = "badge-day";
        if (item.badge === 'Night') badgeClass = 'badge-night';
        if (item.badge === 'Surcharge') badgeClass = 'badge-surcharge';
        if (item.badge === 'Motorcycle') badgeClass = 'badge-motor';

        let div = document.createElement('div');
        div.className = 'breakdown-item';
        div.innerHTML = `
            <div class="breakdown-header">
                <span class="badge ${badgeClass}">${item.badge}</span>
                <span class="breakdown-amt">$${item.amount.toFixed(2)}</span>
            </div>
            <div class="breakdown-text">${item.desc}</div>
        `;
        container.appendChild(div);
    });
}

function showError(msg) {
    document.getElementById('resultsContent').style.display = 'none';
    let err = document.getElementById('errorContainer');
    err.style.display = 'block';
    err.innerText = msg;
}

function calculateCost(vehicleType, entry, exit) {
    let breakdown = [];
    let total = 0.0;
    let durationStr = getDurationString(entry, exit);

    if (vehicleType === 'motorcycle') {
        let baseRate = 4.00;
        total += baseRate;
        breakdown.push({
            desc: "Motorcycle Flat Rate (Per Entry)",
            amount: baseRate,
            badge: "Motorcycle"
        });

        if (isLunchTimeEntry(entry)) {
            let lunchAmt = 1.10;
            total += lunchAmt;
            breakdown.push({
                desc: "Lunch Surcharge (Applicable for Entry between 12:00 PM - 2:00 PM)",
                amount: lunchAmt,
                badge: "Surcharge"
            });
        }
        return { total, breakdown, durationStr };
    }

    let segments = getCarSegments(entry, exit);

    segments.forEach(seg => {
        let durationMin = (seg.end - seg.start) / 60000.0;
        if (durationMin <= 0) return;

        let segmentFee = 0.0;
        let desc = "";
        let badge = "";

        if (!seg.isDay) {
            segmentFee = 5.00;
            desc = `Night Rate (5.01pm - 7.00am) Flat: $5.00 (${formatMins(durationMin)})`;
            badge = "Night";
        } else {
            let dateStr = formatDateKey(seg.start);
            let isWeekendOrPH = (seg.start.getDay() === 0 || seg.start.getDay() === 6 || sgPublicHolidays.has(dateStr));
            
            let rateLabel = isWeekendOrPH ? "Weekend/PH" : "Weekday";
            let baseRate = isWeekendOrPH ? 2.70 : 2.60;

            if (durationMin <= 60) {
                segmentFee = baseRate;
                desc = `Day Rate (${rateLabel}) 1st Hour: $${baseRate.toFixed(2)} (${formatMins(durationMin)})`;
            } else {
                let remaining = durationMin - 60;
                let blocks = Math.ceil(remaining / 30.0);
                let extra = blocks * 1.70;
                segmentFee = baseRate + extra;
                desc = `Day Rate (${rateLabel}): 1st Hour $${baseRate.toFixed(2)} + ${blocks} x 30m block(s) ($${extra.toFixed(2)}) (${formatMins(durationMin)})`;
            }
            badge = "Day";
        }

        total += segmentFee;
        breakdown.push({
            desc: desc,
            amount: segmentFee,
            badge: badge
        });
    });

    if (isLunchTimeEntry(entry)) {
        let lunchAmt = 1.10;
        total += lunchAmt;
        breakdown.push({
            desc: "Lunch Surcharge (Applicable for Entry between 12:00 PM - 2:00 PM)",
            amount: lunchAmt,
            badge: "Surcharge"
        });
    }

    return { total, breakdown, durationStr };
}

function getCarSegments(entry, exit) {
    let current = new Date(entry);
    let segments = [];

    while (current < exit) {
        let hr = current.getHours();
        let mn = current.getMinutes();
        let hrMin = hr * 100 + mn;

        let isDay = (hrMin >= 701 && hrMin <= 1700);

        let candidates = [];
        let offsets = [-1, 0, 1, 2];
        for (let o of offsets) {
            let d = new Date(current);
            d.setDate(d.getDate() + o);
            let b1 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7, 1, 0, 0);
            let b2 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 1, 0, 0);
            candidates.push(b1, b2);
        }

        candidates.sort((a, b) => a - b);
        let nextTransition = null;
        for (let cand of candidates) {
            if (cand > current) {
                nextTransition = cand;
                break;
            }
        }

        let segEnd = (nextTransition && nextTransition < exit) ? nextTransition : exit;
        segments.push({
            start: new Date(current),
            end: new Date(segEnd),
            isDay: isDay
        });

        current = new Date(segEnd);
    }

    return segments;
}

function formatDateKey(date) {
    let y = date.getFullYear();
    let m = String(date.getMonth() + 1).padStart(2, '0');
    let d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getDurationString(entry, exit) {
    let diffMs = exit - entry;
    if (diffMs <= 0) return "0 mins";

    let diffMins = Math.floor(diffMs / 60000);
    let days = Math.floor(diffMins / (24 * 60));
    let hours = Math.floor((diffMins % (24 * 60)) / 60);
    let mins = diffMins % 60;

    let parts = [];
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins} min${mins > 1 ? 's' : ''}`);

    return parts.join(', ');
}

function formatMins(minutes) {
    let m = Math.round(minutes);
    let hrs = Math.floor(m / 60);
    let rem = m % 60;
    return (hrs > 0) ? `${hrs}h ${rem}m` : `${rem} mins`;
}

// ==============================================================
// 6. CLOUD RELAY TRIGGER (AUTHORIZED ONLY)
// ==============================================================
async function triggerOpenExitBarrier() {
    if (!isUserAuthorized) {
        alert("Unauthorized: You do not have permission to open the barrier.");
        return;
    }

    const btn = document.getElementById('btnOpenBarrier');
    const statusLbl = document.getElementById('barrierStatusLabel');
    
    if (!confirm("Are you sure you want to open the EXIT barrier?")) {
        return;
    }

    btn.disabled = true;
    statusLbl.innerText = "Triggering Barrier...";

    const TOPIC_CHANNEL = "wisma-carpark-exit-fcc1471-sec99";

    try {
        let res = await fetch(`https://ntfy.sh/${TOPIC_CHANNEL}`, {
            method: 'POST',
            headers: { 'Title': 'Barrier Open Command' },
            body: 'OPEN_EXIT'
        });

        if (res.ok) {
            statusLbl.innerText = "Command Sent ✓ (Opening)";
        } else {
            statusLbl.innerText = "Failed to Send ✕";
            alert("Could not reach barrier relay server. Please check connection.");
        }
    } catch (err) {
        console.error("Trigger error:", err);
        statusLbl.innerText = "Network Error ✕";
    }

    setTimeout(() => {
        btn.disabled = false;
        statusLbl.innerText = "Collect Cash / Override";
    }, 4000);
}
