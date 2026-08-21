// ==============================================================
// WISMA ATRIA FCC PORTAL - APPLICATION LOGIC (app.js)
// ==============================================================

// FIREBASE REALTIME DATABASE CONFIGURATION
const firebaseConfig = {
    apiKey: "AIzaSyDnZv3wMkQb3Bu0Gy3l7d5Iy9fw4EtKKVA",
    authDomain: "wa-fcc-portal.firebaseapp.com",
    databaseURL: "https://wa-fcc-portal-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "wa-fcc-portal",
    storageBucket: "wa-fcc-portal.firebasestorage.app",
    messagingSenderId: "609256707693",
    appId: "1:609256707693:web:01aba2ff9f7d34d3bd5164"
};

let dbRef = null;
let broadcastRef = null;
let firebaseAuthPromise = null;

try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        if (firebase.auth) {
            firebaseAuthPromise = firebase.auth().signInAnonymously().catch(err => console.log('Firebase Auth error:', err));
        }
        dbRef = firebase.database().ref('portalData');
        broadcastRef = firebase.database().ref('portalData/broadcast');
    }
} catch(e) {
    console.log('Firebase init error:', e);
}

// HELPER: ENSURE FIREBASE AUTH READINESS
async function ensureFirebaseAuth() {
    if (firebaseAuthPromise) {
        try { await firebaseAuthPromise; } catch(e) {}
    }
}

// PORTAL CONSTANTS & CONFIGURATION
const WORKPLACE_LAT = 1.3040;        
const WORKPLACE_LNG = 103.8333;      
const ALLOWED_RADIUS_METERS = 200;   
const SETTINGS_PASSWORD = "wisma123"; 

// BUILT-IN MASTER ACCOUNTS FALLBACK (PREVENTS ANY LOCKOUT)
const DEFAULT_OFFICER_DATABASE = [
    { username: "m2", password: "424F", role: "admin", shift: "any", bypassGps: true, comaBypass: true },
    { username: "keekc", password: "690E", role: "admin", shift: "any", bypassGps: true, comaBypass: true }
];

const FIVE_MINUTES_MS = 5 * 60 * 1000; 

// DYNAMIC ADMIN CHECK
function isAdminAccount(username = "", role = "") {
    const activeUser = (username || localStorage.getItem('portal_active_user') || '').toLowerCase().trim();
    const userRole = (role || localStorage.getItem('portal_user_role') || '').toLowerCase().trim();
    
    if (userRole === 'admin') return true;
    if (userRole === 'officer') return false;

    try {
        const localAcc = JSON.parse(localStorage.getItem('portal_officer_accounts_db') || '[]');
        const matched = localAcc.find(a => String(a.username || '').toLowerCase().trim() === activeUser);
        if (matched && matched.role) {
            return matched.role === 'admin';
        }
    } catch(e) {}

    return ['m2', 'keekc'].includes(activeUser);
}

function isRemoteBypassAccount(account) {
    if (!account) return false;
    if (isAdminAccount(account.username, account.role)) return true; // Admins always have remote bypass
    return account.bypassGps === true || 
           account.bypassGps === 'true' || 
           account.bypassGps === 1 || 
           account.bypassGps === '1';
}

let settingsIdleTimer;
let realTimeGpsWatchId = null;
let isPerformingLocalLogout = false;

// RELIABLE MODAL CONFIRM / ALERT HANDLERS
function showCustomAlert(title, message, icon = "ℹ️") {
    return new Promise((resolve) => {
        alert(`${title}\n\n${message}`);
        resolve(true);
    });
}

function showCustomConfirm(title, message, icon = "❓") {
    return new Promise((resolve) => {
        const res = confirm(`${title}\n\n${message}`);
        resolve(res);
    });
}

function getOrCreateDeviceId() {
    let id = localStorage.getItem('portal_device_id');
    if (!id) {
        id = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
        localStorage.setItem('portal_device_id', id);
    }
    return id;
}

function isLikelyMockLocation(position) {
    return position.coords.accuracy <= 1.0;
}

function getCurrentShiftCycleStartTime() {
    const now = new Date();
    const cycleStart = new Date(now);
    cycleStart.setHours(8, 0, 0, 0);
    if (now.getTime() < cycleStart.getTime()) {
        cycleStart.setDate(cycleStart.getDate() - 1);
    }
    return cycleStart.getTime();
}

function getShiftCycleLabel() {
    const startTimeMs = getCurrentShiftCycleStartTime();
    const startDate = new Date(startTimeMs);
    const dateStr = startDate.toLocaleDateString('en-SG', { day: '2-digit', month: 'short' });
    return `Since ${dateStr}, 08:00 AM`;
}

function pruneLogsToCurrent24hCycle(logs) {
    const currentCycleStart = getCurrentShiftCycleStartTime();
    return (logs || []).filter(log => {
        if (!log || !log.timestamp) return true;
        return log.timestamp >= currentCycleStart;
    });
}

function normalizeArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') return Object.values(data);
    return [];
}

function mergeLogsList(localLogs, cloudLogs) {
    const combined = [...normalizeArray(cloudLogs), ...normalizeArray(localLogs)];
    const seen = new Set();
    const merged = [];

    for (const log of combined) {
        if (!log) continue;
        const key = log.timestamp || `${log.username}_${log.time}_${log.type}`;
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(log);
        }
    }
    merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return pruneLogsToCurrent24hCycle(merged);
}

function mergeActiveSessionsList(localSessions, cloudSessions) {
    const now = Date.now();
    const combined = [...normalizeArray(cloudSessions), ...normalizeArray(localSessions)].filter(s => s && now < s.expiry);
    const sessMap = new Map();

    for (const sess of combined) {
        if (sess && sess.username) {
            const key = String(sess.username).trim().toLowerCase();
            if (!sessMap.has(key) || sess.expiry > sessMap.get(key).expiry) {
                sessMap.set(key, sess);
            }
        }
    }
    return Array.from(sessMap.values());
}

// CLOUD DATABASE FETCH & SAVE OPERATIONS (FIREBASE IS SOLE TRUTH)
async function fetchCloudData() {
    let accounts = DEFAULT_OFFICER_DATABASE;
    let logs = [];
    let activeSessions = [];

    try {
        const localAcc = localStorage.getItem('portal_officer_accounts_db');
        if (localAcc) accounts = JSON.parse(localAcc);
        const localLogs = localStorage.getItem('portal_audit_logs_db');
        if (localLogs) logs = JSON.parse(localLogs);
        const localSess = localStorage.getItem('portal_active_sessions_db');
        if (localSess) activeSessions = JSON.parse(localSess);
    } catch(e) {}

    let fetchSuccess = false;

    if (dbRef) {
        try {
            const snapshot = await dbRef.once('value');
            if (snapshot.exists()) {
                const data = snapshot.val();
                const cloudAccounts = normalizeArray(data.accounts);
                const cloudLogs = normalizeArray(data.logs);
                const cloudSessions = normalizeArray(data.activeSessions);

                // DIRECT ASSIGNMENT PREVENTS REVERTING
                if (cloudAccounts && cloudAccounts.length > 0) accounts = cloudAccounts;
                if (cloudLogs) logs = mergeLogsList(logs, cloudLogs);
                if (cloudSessions) activeSessions = mergeActiveSessionsList(activeSessions, cloudSessions);
                
                fetchSuccess = true;
                logs = pruneLogsToCurrent24hCycle(logs);
                localStorage.setItem('portal_officer_accounts_db', JSON.stringify(accounts));
                localStorage.setItem('portal_audit_logs_db', JSON.stringify(logs));
                localStorage.setItem('portal_active_sessions_db', JSON.stringify(activeSessions));
            }
        } catch(e) {
            console.log('Firebase fetch error:', e);
        }
    }

    const badgeEl = document.getElementById('cloudStatusBadge');
    if (badgeEl) {
        badgeEl.innerText = dbRef 
            ? `🟢 Firebase Realtime Active • ${(accounts || []).length} Accounts`
            : `🟠 Local Mode Active (${(accounts || []).length} Accounts)`;
    }

    return { accounts, logs, activeSessions, fetchSuccess };
}

async function saveCloudData(accounts, logs, activeSessions = []) {
    const prunedLogs = pruneLogsToCurrent24hCycle(logs);

    let validAccounts = accounts;
    if (!validAccounts || validAccounts.length === 0) {
        validAccounts = DEFAULT_OFFICER_DATABASE;
    }

    localStorage.setItem('portal_officer_accounts_db', JSON.stringify(validAccounts));
    localStorage.setItem('portal_audit_logs_db', JSON.stringify(prunedLogs));
    localStorage.setItem('portal_active_sessions_db', JSON.stringify(activeSessions));

    if (dbRef && validAccounts && validAccounts.length > 0) {
        await ensureFirebaseAuth();
        await dbRef.set({ accounts: validAccounts, logs: prunedLogs, activeSessions });
    }
}

// LOGOUT ENFORCEMENT
async function enforceImmediateLocalLogout(logoutReason = null) {
    if (isPerformingLocalLogout) return;
    isPerformingLocalLogout = true;

    const activeUser = (localStorage.getItem('portal_active_user') || '').toLowerCase();
    const isAuth = localStorage.getItem('portal_authenticated') === 'true';

    localStorage.removeItem('portal_authenticated');
    localStorage.removeItem('portal_auth_expiry');
    localStorage.removeItem('portal_user_role');
    localStorage.removeItem('portal_active_user');
    localStorage.removeItem('portal_location_text');
    localStorage.removeItem('wa_directory_admin');
    sessionStorage.removeItem('wa_directory_admin');
    sessionStorage.removeItem('wafp_officer');
    sessionStorage.removeItem('wafp_session_start_time');
    sessionStorage.removeItem('wafp_15m_notified');
    sessionStorage.removeItem('wafp_broadcast_acknowledged');
    localStorage.removeItem('wafp_officer');
    localStorage.removeItem('wafp_logged_officer');
    localStorage.removeItem('currentUser');

    if (isAuth && activeUser && logoutReason) {
        try {
            const { accounts, logs, activeSessions } = await fetchCloudData();
            const updatedSessions = (activeSessions || []).filter(s => String(s.username || '').toLowerCase() !== activeUser);
            
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });
            
            const matchedAcc = (accounts || []).find(a => String(a.username || '').toLowerCase() === activeUser);
            const userShift = matchedAcc ? (matchedAcc.shift || 'N/A').toUpperCase() : 'N/A';

            logs.unshift({
                username: activeUser,
                shift: userShift,
                time: `${dateStr}, ${timeStr}`,
                type: logoutReason,
                success: true,
                timestamp: now.getTime()
            });

            await saveCloudData(accounts, logs, updatedSessions);
        } catch(e) {}
    }

    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('settingsBtn').style.display = 'none';
    const fabSpeed = document.getElementById('emergencySpeedDialBtn');
    if (fabSpeed) fabSpeed.style.display = 'none';
    const locBadge = document.getElementById('locationBadge');
    if (locBadge) locBadge.style.display = 'none';
    const offBadge = document.getElementById('officerBadge');
    if (offBadge) offBadge.style.display = 'none';

    setTimeout(() => { isPerformingLocalLogout = false; }, 1000);
}

// REALTIME LISTENER FOR FIREBASE DB & LIVE BROADCAST
function initFirebaseRealtimeListener() {
    if (!dbRef) return;

    dbRef.on('value', async (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            const cloudAccounts = normalizeArray(data.accounts);
            const cloudLogs = normalizeArray(data.logs);
            const cloudSessions = normalizeArray(data.activeSessions);

            // DIRECTLY SYNC CLOUD ACCOUNTS (NO RE-MERGING)
            if (cloudAccounts && cloudAccounts.length > 0) {
                localStorage.setItem('portal_officer_accounts_db', JSON.stringify(cloudAccounts));
            }
            localStorage.setItem('portal_audit_logs_db', JSON.stringify(cloudLogs));
            localStorage.setItem('portal_active_sessions_db', JSON.stringify(cloudSessions));

            const settingsOverlay = document.getElementById('settingsOverlay');
            if (settingsOverlay && settingsOverlay.style.display === 'flex') {
                const viewAudit = document.getElementById('viewAudit');
                if (viewAudit && viewAudit.style.display !== 'none') {
                    await renderAuditLogs();
                } else if (document.getElementById('viewOfficers').style.display !== 'none') {
                    await renderOfficersList();
                }
            }

            const isAuth = localStorage.getItem('portal_authenticated') === 'true';
            const activeUser = localStorage.getItem('portal_active_user');

            if (isAuth && activeUser && !isAdminAccount(activeUser) && !isPerformingLocalLogout) {
                const now = Date.now();
                const activeSessions = cloudSessions || [];
                const userSession = activeSessions.find(s => String(s.username || '').toLowerCase() === activeUser.toLowerCase() && now < s.expiry);

                if (!userSession) {
                    await enforceImmediateLocalLogout();
                    await showCustomAlert("Session Logged Out", "Your session has been logged out by Administrator.", "🔴");
                }
            }
        }
    });

    if (broadcastRef) {
        broadcastRef.on('value', (snap) => {
            const val = snap.val();
            const bottomContainer = document.getElementById('broadcastBannerContainer');
            const bottomText = document.getElementById('broadcastTextDisplay');
            const inputEl = document.getElementById('broadcastInput');
            const popupModal = document.getElementById('broadcastPopupModal');
            const popupText = document.getElementById('broadcastPopupText');

            if (val && val.active === true && val.message && val.message.trim() !== '') {
                const cleanMsg = val.message.trim();
                if (bottomText) bottomText.innerText = cleanMsg;
                if (bottomContainer) bottomContainer.style.display = 'block';
                if (inputEl) inputEl.value = cleanMsg;

                const isAuth = localStorage.getItem('portal_authenticated') === 'true';
                const alreadyAcked = sessionStorage.getItem('wafp_broadcast_acknowledged');
                if (isAuth && !alreadyAcked && popupModal && popupText) {
                    popupText.innerText = cleanMsg;
                    popupModal.style.display = 'flex';
                    sessionStorage.setItem('wafp_broadcast_acknowledged', 'true');
                }
            } else {
                if (bottomContainer) bottomContainer.style.display = 'none';
                if (popupModal) popupModal.style.display = 'none';
                if (inputEl && (!val || !val.message)) inputEl.value = '';
            }
        });
    }
}

// LIVE BROADCAST PUBLISH / CLEAR
async function publishLiveBroadcast() {
    const inputEl = document.getElementById('broadcastInput');
    const msg = inputEl ? inputEl.value.trim() : '';
    if (!msg) {
        alert("Please enter announcement text before publishing.");
        return;
    }
    const author = localStorage.getItem('portal_active_user') || 'Admin';

    if (broadcastRef) {
        await ensureFirebaseAuth();
        await broadcastRef.set({
            message: msg,
            author: author,
            active: true,
            timestamp: Date.now()
        });
        sessionStorage.removeItem('wafp_broadcast_acknowledged');
        showCustomAlert("Announcement Published", "Live duty announcement is now active.", "📢");
    }
}

async function clearLiveBroadcast() {
    if (broadcastRef) {
        await ensureFirebaseAuth();
        await broadcastRef.set({
            message: "",
            author: "",
            active: false,
            timestamp: Date.now()
        });
        const inputEl = document.getElementById('broadcastInput');
        if (inputEl) inputEl.value = '';
        showCustomAlert("Announcement Cleared", "Broadcast banner has been removed.", "✅");
    }
}

function isExcludedFromSingleDeviceLock(account) {
    return isRemoteBypassAccount(account) || isAdminAccount(account.username, account.role);
}

async function validateSingleDeviceSession(account) {
    if (isExcludedFromSingleDeviceLock(account)) return { allowed: true };

    const { activeSessions } = await fetchCloudData();
    const now = Date.now();
    const deviceId = getOrCreateDeviceId();

    const validSessions = (activeSessions || []).filter(s => now < s.expiry);
    const existingSession = validSessions.find(s => String(s.username || '').toLowerCase() === String(account.username || '').toLowerCase());

    if (existingSession && existingSession.deviceId !== deviceId) {
        return { allowed: false, reason: `❌ Account "${account.username}" is currently logged in on another device.` };
    }
    return { allowed: true };
}

// FORCE LOGOUT OFFICER
async function forceLogoutUser(username) {
    const confirmed = await showCustomConfirm(
        "Force Log Out", 
        `Are you sure you want to forcibly log out "${username}"?\nThis will clear their active session immediately.`,
        "🚪"
    );

    if (confirmed) {
        let { accounts, logs, activeSessions } = await fetchCloudData();
        const updatedSessions = (activeSessions || []).filter(s => String(s.username || '').toLowerCase() !== String(username).toLowerCase());
        
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });

        logs.unshift({
            username: username.toLowerCase(),
            shift: "N/A",
            time: `${dateStr}, ${timeStr}`,
            type: "🔴 Force Logged Out by Admin",
            success: false,
            timestamp: now.getTime()
        });

        await saveCloudData(accounts, logs, updatedSessions);
        await renderAuditLogs();
        await showCustomAlert("User Logged Out", `Account "${username}" has been forcibly logged out.`, "✅");
    }
}

// DELETE AUDIT RECORD
async function deleteAuditLog(logIdentifier) {
    const confirmed = await showCustomConfirm("Delete Record", "Delete this login record from history?", "🗑️");
    if (confirmed) {
        let { accounts, logs, activeSessions } = await fetchCloudData();
        if (logs) {
            if (typeof logIdentifier === 'number' && logIdentifier > 1000000000) {
                logs = logs.filter(l => l.timestamp !== logIdentifier);
            } else if (typeof logIdentifier === 'number') {
                logs.splice(logIdentifier, 1);
            }
            await saveCloudData(accounts, logs, activeSessions);
            await renderAuditLogs();
        }
    }
}

// SHIFT TIMINGS & EXPIRY COMPUTATION
function isTimeInShift(shift, username = "", account = null) {
    if (shift === "any" || isAdminAccount(username, account?.role)) return true;
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    if (account && account.comaBypass) {
        return currentMins >= (7 * 60 + 55) && currentMins <= (22 * 60 + 30);
    }
    if (shift === "day") return currentMins >= (7 * 60 + 55) && currentMins < (20 * 60);
    if (shift === "mid") return currentMins >= (9 * 60 + 55) && currentMins <= (22 * 60 + 30);
    if (shift === "night") return currentMins >= (19 * 60 + 55) || currentMins < (8 * 60);

    return false;
}

function calculateShiftExpiryMs(shift, account = null) {
    const now = new Date();

    if (account && (isAdminAccount(account.username, account.role) || account.shift === "any")) {
        return now.getTime() + (30 * 24 * 60 * 60 * 1000);
    }

    const year = now.getFullYear();
    const month = now.getMonth();
    const date = now.getDate();

    let expiry = now.getTime() + (12 * 60 * 60 * 1000);

    if (account && account.comaBypass) {
        expiry = new Date(year, month, date, 22, 30, 0, 0).getTime();
    } else if (shift === "day") {
        expiry = new Date(year, month, date, 20, 0, 0, 0).getTime();
    } else if (shift === "mid") {
        expiry = new Date(year, month, date, 22, 30, 0, 0).getTime();
    } else if (shift === "night") {
        const hour = now.getHours();
        if (hour >= 19) expiry = new Date(year, month, date + 1, 8, 0, 0, 0).getTime();
        else expiry = new Date(year, month, date, 8, 0, 0, 0).getTime();
    }

    // Safety fallback: Expiry must be in future
    if (expiry <= now.getTime()) {
        expiry = now.getTime() + (2 * 60 * 60 * 1000);
    }
    return expiry;
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

function startAdminRealtimeGpsTracker() {
    if (realTimeGpsWatchId !== null) return;
    const activeUser = localStorage.getItem('portal_active_user');
    if (!isAdminAccount(activeUser) || !navigator.geolocation) return;

    realTimeGpsWatchId = navigator.geolocation.watchPosition(
        function(position) {
            const distance = calculateDistanceMeters(position.coords.latitude, position.coords.longitude, WORKPLACE_LAT, WORKPLACE_LNG);
            const locBadge = document.getElementById('locationBadge');

            let badgeText = "🟢 Location: Wisma Atria";
            if (distance > ALLOWED_RADIUS_METERS) {
                badgeText = "🟢 Location: Remote";
            }

            localStorage.setItem('portal_location_text', badgeText);
            if (locBadge && locBadge.style.display !== 'none') {
                locBadge.innerText = badgeText;
            }
        },
        function(error) {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
    );
}

function stopAdminRealtimeGpsTracker() {
    if (realTimeGpsWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(realTimeGpsWatchId);
        realTimeGpsWatchId = null;
    }
}

// SESSION AUTHENTICATION CHECK
async function checkSessionAuth() {
    const isAuth = localStorage.getItem('portal_authenticated') === 'true';
    const authExpiry = parseInt(localStorage.getItem('portal_auth_expiry') || '0', 10);
    const activeUser = (localStorage.getItem('portal_active_user') || '').toLowerCase().trim();
    const userRole = (localStorage.getItem('portal_user_role') || '').toLowerCase().trim();
    const badgeText = localStorage.getItem('portal_location_text') || "🟢 Location: Wisma Atria";
    const now = Date.now();
    const locBadge = document.getElementById('locationBadge');
    const settingsBtn = document.getElementById('settingsBtn');
    const fabSpeed = document.getElementById('emergencySpeedDialBtn');

    if (isAuth && activeUser) {
        if (now >= authExpiry) {
            await enforceImmediateLocalLogout("⚪ Auto Logout (Shift Expired)");
            await showCustomAlert("Shift Ended", "Your shift has ended. You have been automatically logged out.", "⏰");
            return;
        }

        if (!isAdminAccount(activeUser, userRole) && !isPerformingLocalLogout) {
            try {
                const localSess = localStorage.getItem('portal_active_sessions_db');
                if (localSess) {
                    const activeSessions = JSON.parse(localSess);
                    const userSess = activeSessions.find(s => String(s.username || '').toLowerCase() === activeUser && now < s.expiry);
                    if (!userSess) {
                        await enforceImmediateLocalLogout();
                        return;
                    }
                }
            } catch(e) {}
        }

        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'flex';
        if (locBadge) {
            locBadge.innerText = badgeText;
            locBadge.style.display = 'inline-flex';
        }

        const isUserAdmin = isAdminAccount(activeUser, userRole);
        if (settingsBtn) settingsBtn.style.display = isUserAdmin ? 'flex' : 'none';
        if (fabSpeed) fabSpeed.style.display = isUserAdmin ? 'flex' : 'none';

        if (isUserAdmin) {
            startAdminRealtimeGpsTracker();
        } else {
            stopAdminRealtimeGpsTracker();
        }
    } else {
        await enforceImmediateLocalLogout();
    }
}

// MAIN LOGOUT BUTTON HANDLER
async function handleManualLogout() {
    const confirmed = await showCustomConfirm("Portal Logout", "Are you sure you want to log out of the portal?", "🚪");
    if (confirmed) {
        await enforceImmediateLocalLogout("⚪ Manual Logout");
        window.location.reload();
    }
}

// LOGIN ACCESS GRANTING
async function grantLoginAccess(matchedAccount, loginMethod, distanceMeters = null) {
    const username = String(matchedAccount.username || '').toLowerCase().trim();
    const isUserAdmin = (matchedAccount.role === 'admin') || (matchedAccount.role !== 'officer' && isAdminAccount(username));
    const isRemote = isRemoteBypassAccount(matchedAccount);
    const expiryMs = calculateShiftExpiryMs(matchedAccount.shift, matchedAccount);

    localStorage.removeItem('wa_directory_admin');
    sessionStorage.removeItem('wa_directory_admin');
    sessionStorage.removeItem('wafp_15m_notified');
    sessionStorage.removeItem('wafp_broadcast_acknowledged');

    localStorage.setItem('portal_authenticated', 'true');
    localStorage.setItem('portal_auth_expiry', expiryMs.toString());
    localStorage.setItem('portal_user_role', isUserAdmin ? 'admin' : 'officer');
    localStorage.setItem('portal_active_user', username);
    
    sessionStorage.setItem('wafp_officer', username);
    localStorage.setItem('wafp_officer', username);
    localStorage.setItem('wafp_logged_officer', username);
    localStorage.setItem('currentUser', username);
    sessionStorage.setItem('wafp_session_start_time', Date.now().toString());

    let badgeText = "🟢 Location: Wisma Atria";
    if (isRemote) {
        if (distanceMeters !== null && distanceMeters > ALLOWED_RADIUS_METERS) {
            badgeText = "🟢 Location: Remote";
        } else if (distanceMeters === null) {
            badgeText = "🟢 Location: Remote";
        }
    }
    localStorage.setItem('portal_location_text', badgeText);

    const { accounts, logs, activeSessions } = await fetchCloudData();
    const now = new Date();
    const deviceId = getOrCreateDeviceId();

    let updatedSessions = (activeSessions || []).filter(s => now.getTime() < s.expiry && String(s.username || '').toLowerCase() !== username);
    updatedSessions.push({ username, deviceId, expiry: expiryMs, loginTime: now.getTime() });

    const dateStr = now.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });
    const statusLabel = isRemote ? "🟢 Success (Remote Access)" : "🟢 Success (Workplace GPS)";

    const newLog = {
        username,
        shift: (matchedAccount.shift || "N/A").toUpperCase(),
        time: `${dateStr}, ${timeStr}`,
        type: statusLabel,
        success: true,
        timestamp: now.getTime()
    };

    logs.unshift(newLog);
    await saveCloudData(accounts, logs, updatedSessions);

    saveTimestamp();
    checkSessionAuth();
}

async function recordFailedLoginAttempt(username, shift, statusLabel) {
    try {
        const { accounts, logs, activeSessions } = await fetchCloudData();
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });

        const newLog = {
            username: username ? String(username).toLowerCase() : "unknown",
            shift: (shift || "N/A").toUpperCase(),
            time: `${dateStr}, ${timeStr}`,
            type: statusLabel,
            success: false,
            timestamp: now.getTime()
        };

        logs.unshift(newLog);
        await saveCloudData(accounts, logs, activeSessions);
        
        if (document.getElementById('settingsOverlay').style.display === 'flex') {
            await renderAuditLogs();
        }
    } catch(e) {}
}

// OFFICER LOGIN SUBMISSION
async function handleOfficerLogin(event) {
    event.preventDefault();
    
    const userIn = document.getElementById('usernameInput').value.trim().toLowerCase();
    const passIn = document.getElementById('passwordInput').value.trim().toUpperCase();
    const statusBox = document.getElementById('statusBox');
    const loginBtn = document.getElementById('loginBtn');

    statusBox.className = "status-box info";
    statusBox.innerText = "⏳ Verifying account details...";

    const { accounts } = await fetchCloudData();
    
    const matchedAccount = (accounts || []).find(acc => {
        if (!acc || acc.username === undefined || acc.password === undefined) return false;
        const u = String(acc.username).trim().toLowerCase();
        const p = String(acc.password).trim().toUpperCase();
        return u === userIn && p === passIn;
    });

    if (!matchedAccount) {
        statusBox.className = "status-box error";
        statusBox.innerText = "❌ Invalid Username or Password.";
        await recordFailedLoginAttempt(userIn, "N/A", "❌ Rejected: Invalid Credentials");
        return;
    }

    if (!isTimeInShift(matchedAccount.shift, matchedAccount.username, matchedAccount)) {
        let shiftName = "Day Shift (07:55 AM - 8:00 PM)";
        if (matchedAccount.shift === "mid") shiftName = "Mid-Shift (09:55 AM - 10:30 PM)";
        if (matchedAccount.shift === "night") shiftName = "Night Shift (07:55 PM - 8:00 AM)";
        if (matchedAccount.comaBypass) shiftName = "CO/MA Bypass Shift (0755hrs - 2230hrs)";

        statusBox.className = "status-box error";
        statusBox.innerText = `❌ Shift Access Denied.\nYour account is assigned to ${shiftName}.`;
        await recordFailedLoginAttempt(matchedAccount.username, matchedAccount.shift, "❌ Rejected: Out of Shift Hours");
        return;
    }

    const sessionCheck = await validateSingleDeviceSession(matchedAccount);
    if (!sessionCheck.allowed) {
        statusBox.className = "status-box error";
        statusBox.innerText = sessionCheck.reason;
        await recordFailedLoginAttempt(matchedAccount.username, matchedAccount.shift, "❌ Rejected: Duplicate Session Locked");
        return;
    }

    if (isRemoteBypassAccount(matchedAccount)) {
        statusBox.className = "status-box info";
        statusBox.innerText = "⚡ Remote Access Login Granted...";
        await grantLoginAccess(matchedAccount, "Remote Bypass", null);
        return;
    }

    if (!navigator.geolocation) {
        statusBox.className = "status-box error";
        statusBox.innerText = "❌ Geolocation is not supported on this device/browser.";
        await recordFailedLoginAttempt(matchedAccount.username, matchedAccount.shift, "❌ Rejected: No Geolocation Support");
        return;
    }

    statusBox.className = "status-box info";
    statusBox.innerText = "📡 Verifying GPS location at Wisma Atria...";
    loginBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        async function(position) {
            loginBtn.disabled = false;

            if (isLikelyMockLocation(position)) {
                statusBox.className = "status-box error";
                statusBox.innerText = "❌ Fake GPS / Mock Location Detected.\nPlease disable fake location apps and use genuine phone GPS.";
                await recordFailedLoginAttempt(matchedAccount.username, matchedAccount.shift, "❌ Rejected: Fake GPS Detected");
                return;
            }

            const distance = calculateDistanceMeters(position.coords.latitude, position.coords.longitude, WORKPLACE_LAT, WORKPLACE_LNG);

            if (distance <= ALLOWED_RADIUS_METERS) {
                await grantLoginAccess(matchedAccount, "Workplace GPS", distance);
            } else {
                statusBox.className = "status-box error";
                statusBox.innerText = `❌ Location Access Denied.\nYou are ${Math.round(distance)}m away. You must be at Wisma Atria to log in.`;
                await recordFailedLoginAttempt(matchedAccount.username, matchedAccount.shift, `❌ Rejected: Location ${Math.round(distance)}m Off-Site`);
            }
        },
        async function(error) {
            loginBtn.disabled = false;
            statusBox.className = "status-box error";
            statusBox.innerText = "❌ Location permission required. Please allow GPS access.";
            await recordFailedLoginAttempt(matchedAccount.username, matchedAccount.shift, "❌ Rejected: GPS Permission Denied");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// ADMIN SETTINGS MODAL
function resetSettingsIdleTimer() {
    clearTimeout(settingsIdleTimer);
    if (document.getElementById('settingsOverlay').style.display === 'flex') {
        settingsIdleTimer = setTimeout(() => { closeAdminSettings(); }, FIVE_MINUTES_MS);
    }
}

function clickSettingsBtn() {
    const activeUser = (localStorage.getItem('portal_active_user') || '').toLowerCase().trim();
    const userRole = (localStorage.getItem('portal_user_role') || '').toLowerCase().trim();

    if (!isAdminAccount(activeUser, userRole)) {
        showCustomAlert("Access Denied", "Settings are restricted to Administrator accounts only.", "⛔");
        return;
    }
    openAdminSettings();
}

function handleSettingsPasswordSubmit(event) {
    event.preventDefault();
    const passIn = document.getElementById('settingsPwInput').value.trim();
    const statusBox = document.getElementById('settingsAuthStatus');

    if (passIn === SETTINGS_PASSWORD) {
        document.getElementById('settingsAuthOverlay').style.display = 'none';
        document.getElementById('settingsPwInput').value = '';
        openAdminSettings();
    } else {
        statusBox.className = "status-box error";
        statusBox.innerText = "❌ Incorrect Settings Password!";
    }
}

function closeSettingsAuthOverlay() {
    document.getElementById('settingsAuthOverlay').style.display = 'none';
}

async function openAdminSettings() {
    const activeUser = (localStorage.getItem('portal_active_user') || '').toLowerCase().trim();
    const userRole = (localStorage.getItem('portal_user_role') || '').toLowerCase().trim();

    if (!isAdminAccount(activeUser, userRole)) {
        await showCustomAlert("Access Denied", "Settings are restricted to Administrator accounts only.", "⛔");
        return;
    }

    document.getElementById('settingsOverlay').style.display = 'flex';
    switchSettingsTab('audit');
    resetSettingsIdleTimer();
}

function closeAdminSettings() {
    clearTimeout(settingsIdleTimer);
    document.getElementById('settingsOverlay').style.display = 'none';
    resetOfficerForm();
}

function switchSettingsTab(tabName) {
    const btnOfficers = document.getElementById('tabOfficersBtn');
    const btnAudit = document.getElementById('tabAuditBtn');
    const btnBroadcast = document.getElementById('tabBroadcastBtn');
    
    const viewOfficers = document.getElementById('viewOfficers');
    const viewAudit = document.getElementById('viewAudit');
    const viewBroadcast = document.getElementById('viewBroadcast');

    [btnOfficers, btnAudit, btnBroadcast].forEach(b => b.className = 'tab-btn');
    [viewOfficers, viewAudit, viewBroadcast].forEach(v => v.style.display = 'none');

    if (tabName === 'officers') {
        btnOfficers.className = 'tab-btn active';
        viewOfficers.style.display = 'flex';
        renderOfficersList();
    } else if (tabName === 'broadcast') {
        btnBroadcast.className = 'tab-btn active';
        viewBroadcast.style.display = 'flex';
    } else {
        btnAudit.className = 'tab-btn active';
        viewAudit.style.display = 'flex';
        renderAuditLogs();
    }
    resetSettingsIdleTimer();
}

function toggleOfficerSearchClearBtn() {
    const input = document.getElementById('officerSearchInput');
    const clearBtn = document.getElementById('clearOfficerSearchBtn');
    if (input && clearBtn) {
        clearBtn.style.display = input.value.trim().length > 0 ? 'block' : 'none';
    }
}

function clearOfficerSearch() {
    const input = document.getElementById('officerSearchInput');
    if (input) {
        input.value = '';
        toggleOfficerSearchClearBtn();
        renderOfficersList();
        input.focus();
    }
}

// RENDER OFFICERS MANAGEMENT LIST WITH SIDE-BY-SIDE BADGES
async function renderOfficersList() {
    toggleOfficerSearchClearBtn();
    const { accounts } = await fetchCloudData();
    const searchVal = document.getElementById('officerSearchInput').value.trim().toLowerCase();
    const listContainer = document.getElementById('officersList');
    listContainer.innerHTML = '';

    const filtered = (accounts || []).filter(acc => {
        const u = String(acc.username || '').toLowerCase();
        const s = String(acc.shift || '').toLowerCase();
        const r = String(acc.role || '').toLowerCase();
        return u.includes(searchVal) || s.includes(searchVal) || r.includes(searchVal);
    });

    filtered.sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));

    if (filtered.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:16px; color:#94a3b8; font-size:0.8rem;">No officers found in Cloud Master List.</div>';
        return;
    }

    filtered.forEach(acc => {
        const row = document.createElement('div');
        row.className = 'officer-row';

        let badgeClass = 'badge-any';
        let shiftText = '🔄 24 Hours';
        if (acc.shift === 'day') { badgeClass = 'badge-day'; shiftText = '☀️ Day'; }
        if (acc.shift === 'mid') { badgeClass = 'badge-mid'; shiftText = '🌤️ Mid'; }
        if (acc.shift === 'night') { badgeClass = 'badge-night'; shiftText = '🌙 Night'; }

        // STRICT ROLE DISPLAY (👑 Admin vs 👮 Normal)
        const isUserAdmin = (acc.role === 'admin') || (acc.role !== 'officer' && isAdminAccount(acc.username));
        const roleBadgeHtml = isUserAdmin 
            ? `<span class="badge-role-admin">👑 Admin</span>` 
            : `<span class="badge-role-normal">👮 Normal</span>`;

        const isRemote = isRemoteBypassAccount(acc);
        const comaTag = acc.comaBypass ? ' • ⚡ CO/MA' : '';

        row.innerHTML = `
            <div class="officer-info">
                <div class="officer-name" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:2px;">
                    <span style="font-weight:800; font-size:0.88rem; color:#f8fafc;">${acc.username}</span>
                    ${roleBadgeHtml}
                    <span class="badge ${badgeClass}">${shiftText}</span>
                </div>
                <div class="officer-tag">Pass: ${acc.password} ${isRemote ? '• 📍 Remote Bypass' : ''}${comaTag}</div>
            </div>
            <div class="action-btns">
                <button class="btn-sm btn-edit" onclick="editOfficerAccount('${acc.username}')">Edit</button>
                <button class="btn-sm btn-del" onclick="deleteOfficerAccount('${acc.username}')">Del</button>
            </div>
        `;
        listContainer.appendChild(row);
    });
}

// RENDER AUDIT LOGS
async function renderAuditLogs() {
    const { logs, activeSessions } = await fetchCloudData();
    const logContainer = document.getElementById('auditList');
    const cycleLabel = document.getElementById('auditCycleLabel');

    if (cycleLabel) cycleLabel.innerText = `📅 Showing Current 24h Shift Cycle (${getShiftCycleLabel()})`;
    logContainer.innerHTML = '';

    const currentCycleStart = getCurrentShiftCycleStartTime();
    const now = Date.now();
    const activeUsernames = (activeSessions || []).filter(s => now < s.expiry).map(s => String(s.username || '').toLowerCase());
    const cycleLogs = pruneLogsToCurrent24hCycle(logs || []);

    if (!cycleLogs || cycleLogs.length === 0) {
        logContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8; font-size:0.8rem;">No login records found for current 24h shift cycle.</div>';
        return;
    }

    const seenActiveUsernames = new Set();

    cycleLogs.forEach((log, index) => {
        const row = document.createElement('div');
        row.className = 'audit-row';

        let badgeClass = 'badge-any';
        if (log.shift === 'DAY') badgeClass = 'badge-day';
        if (log.shift === 'MID') badgeClass = 'badge-mid';
        if (log.shift === 'NIGHT') badgeClass = 'badge-night';

        const isSuccess = log.success !== false;
        const u = String(log.username || '').toLowerCase();

        let isActive = false;
        if (isSuccess && activeUsernames.includes(u) && !seenActiveUsernames.has(u)) {
            isActive = true;
            seenActiveUsernames.add(u);
        }
        
        let statusBadgeHtml = '';
        if (isActive) {
            const startTs = log.timestamp || Date.now();
            const elapsedSec = Math.max(0, Math.floor((now - startTs) / 1000));
            const hrs = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
            const mins = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
            const secs = String(elapsedSec % 60).padStart(2, '0');
            const initialTimer = `${hrs}:${mins}:${secs}`;

            statusBadgeHtml = `<span class="badge badge-active">🟢 Active</span> <span class="audit-item-timer">⏱️ <span class="live-audit-timer" data-start="${startTs}">${initialTimer}</span></span>`;
        } else if (isSuccess) {
            statusBadgeHtml = `<span class="badge badge-inactive">⚪ Logged Out</span>`;
        } else {
            statusBadgeHtml = `<span class="badge badge-rejected">❌ Rejected</span>`;
        }

        const logoutBtnHtml = isActive 
            ? `<button class="btn-audit-icon btn-audit-logout" onclick="forceLogoutUser('${log.username}')" title="Force Log Out">🚪</button>` 
            : '';

        const nameColor = isSuccess ? '#f8fafc' : '#fca5a5';
        const typeColor = isSuccess ? '#34d399' : '#fb7185';

        row.innerHTML = `
            <div class="audit-info">
                <div class="audit-name" style="color: ${nameColor};">
                    👤 ${log.username} <span class="badge ${badgeClass}">${log.shift}</span> ${statusBadgeHtml}
                </div>
                <div class="audit-time">🕒 ${log.time}</div>
                <div class="audit-status" style="color: ${typeColor};">⚡ ${log.type}</div>
            </div>
            <div class="action-btns" style="display:flex; gap:6px; align-items:center;">
                ${logoutBtnHtml}
                <button class="btn-audit-icon btn-audit-del" onclick="deleteAuditLog(${log.timestamp || index})" title="Delete Record">🗑️</button>
            </div>
        `;
        logContainer.appendChild(row);
    });
}

async function clearLoginLogs() {
    const confirmed = await showCustomConfirm(
        "Clear History",
        "Clear past login history records?\n\nNote: All active officer logins will be kept.",
        "🗑️"
    );
    if (confirmed) {
        const { accounts, logs, activeSessions } = await fetchCloudData();
        const now = Date.now();
        
        const activeUsernames = (activeSessions || []).filter(s => now < s.expiry).map(s => String(s.username || '').toLowerCase());
        const retainedLogs = (logs || []).filter(log => activeUsernames.includes(String(log.username || '').toLowerCase()));

        await saveCloudData(accounts, retainedLogs, activeSessions);
        await renderAuditLogs();
    }
}

// OFFICER ACCOUNT CREATE / EDIT / SAVE
async function saveOfficerAccount(event) {
    event.preventDefault();
    resetSettingsIdleTimer();

    const saveBtn = document.getElementById('saveAccountBtn');
    saveBtn.disabled = true;
    saveBtn.innerText = "Saving to Master...";

    const originalUser = document.getElementById('editOriginalUsername').value.trim().toLowerCase();
    const newUser = document.getElementById('adminUserIn').value.trim().toLowerCase();
    const newPass = document.getElementById('adminPassIn').value.trim().toUpperCase();
    const newRole = document.getElementById('adminRoleIn').value;
    const newShift = document.getElementById('adminShiftIn').value;
    const newBypass = document.getElementById('adminBypassGps').checked === true;
    const newComaBypass = document.getElementById('adminComaBypass').checked === true;

    let { accounts, logs, activeSessions } = await fetchCloudData();
    const rawAccounts = normalizeArray(accounts);

    const accMap = new Map();
    for (const acc of rawAccounts) {
        if (acc && acc.username) accMap.set(String(acc.username).trim().toLowerCase(), acc);
    }

    if (originalUser && originalUser !== newUser) {
        accMap.delete(originalUser);
    }

    accMap.set(newUser, {
        username: newUser,
        password: newPass,
        role: newRole,
        shift: newShift,
        bypassGps: newBypass,
        comaBypass: newComaBypass
    });

    const updatedAccounts = Array.from(accMap.values());

    try {
        await saveCloudData(updatedAccounts, logs, activeSessions);
        saveBtn.disabled = false;
        saveBtn.innerText = "Save Account";

        await renderOfficersList();
        resetOfficerForm();
        await showCustomAlert("Account Saved", `Officer account "${newUser}" (${newRole === 'admin' ? '👑 Admin' : '👮 Normal'}) successfully saved!`, "✅");
    } catch(err) {
        saveBtn.disabled = false;
        saveBtn.innerText = "Save Account";
        await showCustomAlert("Save Failed", `Failed to save account:\n${err.message || err}`, "❌");
    }
}

async function editOfficerAccount(username) {
    resetSettingsIdleTimer();
    const { accounts } = await fetchCloudData();
    const acc = (accounts || []).find(a => String(a.username || '').toLowerCase() === String(username).toLowerCase());
    if (!acc) return;

    document.getElementById('editOriginalUsername').value = acc.username;
    document.getElementById('adminUserIn').value = acc.username;
    document.getElementById('adminPassIn').value = acc.password;
    
    const roleSelect = document.getElementById('adminRoleIn');
    if (roleSelect) {
        roleSelect.value = acc.role === 'admin' ? 'admin' : 'officer';
    }

    document.getElementById('adminShiftIn').value = acc.shift || 'day';
    document.getElementById('adminBypassGps').checked = isRemoteBypassAccount(acc);
    document.getElementById('adminComaBypass').checked = Boolean(acc.comaBypass);

    document.getElementById('formTitle').innerText = `✏️ EDIT OFFICER: ${acc.username}`;
}

// DELETE OFFICER ACCOUNT
async function deleteOfficerAccount(username) {
    resetSettingsIdleTimer();
    const confirmed = await showCustomConfirm(
        "Delete Officer",
        `Are you sure you want to delete officer "${username}" from the Cloud Master List?`,
        "🗑️"
    );
    if (confirmed) {
        let { accounts, logs, activeSessions } = await fetchCloudData();
        const targetClean = String(username || '').toLowerCase().trim();
        const updatedAccounts = (accounts || []).filter(acc => String(acc.username || '').toLowerCase().trim() !== targetClean);
        
        await saveCloudData(updatedAccounts, logs, activeSessions);
        await renderOfficersList();
        await showCustomAlert("Officer Deleted", `Officer "${username}" removed successfully.`, "🗑️");
    }
}

function resetOfficerForm() {
    document.getElementById('editOriginalUsername').value = '';
    document.getElementById('adminUserIn').value = '';
    document.getElementById('adminPassIn').value = '';
    document.getElementById('adminRoleIn').value = 'officer';
    document.getElementById('adminShiftIn').value = 'day';
    document.getElementById('adminBypassGps').checked = false;
    document.getElementById('adminComaBypass').checked = false;
    document.getElementById('formTitle').innerText = '➕ ADD NEW OFFICER';
}

async function refreshCloudMasterData() {
    try {
        const { accounts, logs, activeSessions } = await fetchCloudData();
        await saveCloudData(accounts, logs, activeSessions);
        await renderOfficersList();
        await showCustomAlert("Master Synced", `Officers Master List successfully synced (${(accounts || []).length} Accounts).`, "🔄");
    } catch(err) {
        console.error('Sync error:', err);
        await showCustomAlert("Sync Failed", `Firebase Cloud sync failed:\n${err.message || err}`, "❌");
    }
}

// TIMESTAMP & NAVIGATION
function saveTimestamp() {
    localStorage.setItem('portal_last_active_time', Date.now().toString());
}

async function recordNavigation(event) {
    const activeUser = localStorage.getItem('portal_active_user');
    const isAuth = localStorage.getItem('portal_authenticated') === 'true';

    if (isAuth && activeUser && !isAdminAccount(activeUser)) {
        try {
            const localSess = localStorage.getItem('portal_active_sessions_db');
            if (localSess) {
                const now = Date.now();
                const activeSessions = JSON.parse(localSess);
                const userSess = activeSessions.find(s => s.username.toLowerCase() === activeUser.toLowerCase() && now < s.expiry);
                
                if (!userSess) {
                    if (event) event.preventDefault();
                    await enforceImmediateLocalLogout();
                    await showCustomAlert("Session Logged Out", "Your session has been logged out by Administrator.", "🔴");
                    return false;
                }
            }
        } catch(e) {}
    }

    saveTimestamp();
    sessionStorage.setItem('portal_navigated_away', 'true');
    return true;
}

function checkAndForceFreshLoad(event) {
    sessionStorage.removeItem('portal_navigated_away');
    saveTimestamp();
    checkSessionAuth();
}

// INITIALIZATION & LISTENERS
['click', 'touchstart', 'mousemove', 'keydown', 'scroll'].forEach(evt => {
    window.addEventListener(evt, () => { resetSettingsIdleTimer(); }, { passive: true });
});

window.addEventListener('pageshow', (event) => {
    sessionStorage.removeItem('portal_navigated_away');
    saveTimestamp();
    checkSessionAuth();
});

setInterval(checkSessionAuth, 10000);

initFirebaseRealtimeListener();

checkAndForceFreshLoad();

// iOS STANDALONE APP VIEWPORT KEEP-ALIVE SCRIPT
(function() {
    if (("standalone" in window.navigator) && window.navigator.standalone) {
        var noddy, remotes = false;
        document.addEventListener('click', function(event) {
            noddy = event.target;
            while (noddy.nodeName !== "A" && noddy.nodeName !== "HTML") {
                noddy = noddy.parentNode;
            }
            if ('href' in noddy && noddy.href.indexOf('http') !== -1 && (noddy.href.indexOf(document.location.host) !== -1 || remotes)) {
                event.preventDefault();
                document.location.href = noddy.href;
            }
        }, false);
    }
})();
