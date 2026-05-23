// Pint-me — Combined top block (v3)
// Slider enabled once Group + Name + Time + Radius filled.
// Toggling ON requests location and publishes.
// Toggling OFF deletes presence doc.
// Location row can be tappable (if #locRow exists): refresh location (+ sync if ON).
// Matches shown via Firestore realtime listener.
// Meet here optional (below matches).
// No service worker logic.

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  }[c]));
}

function showToast(title, subtitle = "", ms = 4500) {
  const el = $("toast");
  if (!el) return;
  el.innerHTML = subtitle
    ? `${escapeHtml(title)}<small>${escapeHtml(subtitle)}</small>`
    : escapeHtml(title);
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function mapsLink(lat, lon, label) {
  const q = label ? `${label} @ ${lat},${lon}` : `${lat},${lon}`;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
}

function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Geolocation not supported."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

const STORAGE_KEY = "pintme_combined_top_v3";

const state = {
  on: false,
  duration: 60,
  radiusKm: 1,
  location: null, // {lat, lon, accuracy, at}
  savedAt: null,
  expiresAt: null,
  groupCode: "cominghome",
  displayName: "",
  // meet here optional
  venueName: "",
  meet: null // {name, lat, lon, url, createdAt}
};

let uid = null;
let unsub = null;            // Firestore listener unsubscribe
let expireTimer = null;
let lastToastKey = "";
let lastGroupCodeWhileOn = null; // to delete old doc if group changes while ON

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function hydrate() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { Object.assign(state, JSON.parse(raw)); } catch {}
  }

  state.groupCode = (state.groupCode || "cominghome").trim().toLowerCase();
  state.displayName = (state.displayName || "").trim();
  state.venueName = (state.venueName || "").trim();

  // local auto-expire
  if (state.expiresAt && Date.now() > state.expiresAt) {
    state.on = false;
    state.expiresAt = null;
    state.meet = null;
    persist();
  }
}

function readyForToggle() {
  return !!(
    state.groupCode && state.groupCode.length >= 2 &&
    state.displayName && state.displayName.length >= 1 &&
    state.duration && state.radiusKm
  );
}

function presenceRef(groupCodeOverride = null) {
  const g = (groupCodeOverride || state.groupCode || "").trim().toLowerCase();
  if (!uid || !g) return null;
  return window.fb.db
    .collection("groups")
    .doc(g)
    .collection("presence")
    .doc(uid);
}

async function deletePresence(groupCodeOverride = null) {
  const ref = presenceRef(groupCodeOverride);
  if (!ref) return;
  try { await ref.delete(); } catch (e) { console.log("deletePresence", e); }
}

async function savePresence() {
  if (!uid) throw new Error("Not signed in yet");
  if (!state.groupCode) throw new Error("Group code required");
  if (!state.displayName) throw new Error("Name required");
  if (!state.location) throw new Error("Location not set");

  const ref = presenceRef();
  if (!ref) throw new Error("Presence ref not available");

  const payload = {
    uid,
    name: state.displayName,
    on: true,
    duration: state.duration,
    radiusKm: state.radiusKm,
    location: {
      lat: state.location.lat,
      lon: state.location.lon,
      accuracy: state.location.accuracy
    },
    savedAt: state.savedAt || Date.now(),
    expiresAt: state.expiresAt || (Date.now() + state.duration * 60000),
    updatedAt: Date.now(),
    meet: state.meet || null
  };

  await ref.set(payload, { merge: true });
}

function stopRealtime() {
  if (unsub) { try { unsub(); } catch {} unsub = null; }
}

function startRealtime() {
  stopRealtime();
  if (!uid || !state.groupCode) return;

  const col = window.fb.db
    .collection("groups")
    .doc(state.groupCode)
    .collection("presence");

  unsub = col.onSnapshot((snap) => {
    if (!state.on || !state.location) {
      renderMatches([]);
      return;
    }

    const now = Date.now();
    const others = [];

    snap.forEach((doc) => {
      const p = doc.data();
      if (!p) return;
      if (p.uid === uid) return;
      if (!p.on) return;
      if (p.expiresAt && p.expiresAt < now) return;
      if (!p.location) return;

      const dKm = haversineKm(
        state.location.lat, state.location.lon,
        p.location.lat, p.location.lon
      );

      // filter by *your* radius
      if (dKm <= state.radiusKm) {
        others.push({ name: p.name, dKm, meet: p.meet || null });
      }
    });

    renderMatches(others);
  }, (err) => console.log("snapshot", err));
}

function renderMeetStatus() {
  const status = $("meetStatus");
  const dot = $("meetDot");
  if (!status || !dot) return;

  if (state.meet && state.meet.url) {
    status.textContent = state.meet.name ? `Set: ${state.meet.name}` : "Set";
    dot.classList.add("on");
  } else {
    status.textContent = "Not set";
    dot.classList.remove("on");
  }
}

function renderMatches(matches) {
  const list = $("matchesList");
  const empty = $("matchesEmpty");
  const count = $("matchCount");
  const summary = $("matchSummary");

  if (!list || !empty || !count || !summary) return;

  const sorted = (matches || []).slice().sort((a, b) => a.dKm - b.dKm);
  count.textContent = String(sorted.length);
  list.innerHTML = "";

  if (sorted.length === 0) {
    empty.style.display = "block";
    summary.textContent = state.on ? "No matches yet." : "Turn ON to see who’s up for one nearby.";
    lastToastKey = "";
    return;
  }

  empty.style.display = "none";
  summary.textContent = `${sorted.length} match${sorted.length === 1 ? "" : "es"} in radius.`;

  sorted.forEach((m) => {
    const li = document.createElement("li");
    li.className = "rowcard";

    // Optional: show their meet link if present
    const meetBlock = (m.meet && m.meet.url)
      ? `
        <div class="meetline">
          <span class="meetpill">📍 <a href="${escapeHtml(m.meet.url)}" target="_blank" rel="noopener">${escapeHtml(m.meet.name || "Meet here")}</a></span>
          <span class="rowactions">
            <a class="btn small" href="${escapeHtml(m.meet.url)}" target="_blank" rel="noopener">Open</a>
            <button class="btn small" data-copy="${escapeHtml(m.meet.url)}">Copy</button>
          </span>
        </div>
      `
      : `
        <div class="meetline">
          <span class="muted" style="font-size:12px">No meet point posted</span>
        </div>
      `;

    li.innerHTML = `
      <div class="rowtop">
        <div class="name">${escapeHtml(m.name)}</div>
        <div class="dist">~${m.dKm.toFixed(1)} km</div>
      </div>
      ${meetBlock}
    `;

    li.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const url = btn.getAttribute("data-copy");
        try {
          await navigator.clipboard.writeText(url);
          showToast("Copied", "Meet link copied");
        } catch {
          showToast("Copy failed", "Long-press to copy the link");
        }
      });
    });

    list.appendChild(li);
  });

  // Toast only when closest match changes
  const top = sorted[0];
  const key = `${top.name}|${top.dKm.toFixed(1)}|${state.groupCode}|${state.radiusKm}`;
  if (key !== lastToastKey) {
    lastToastKey = key;
    showToast(`🍺 Match: ${top.name}`, `~${top.dKm.toFixed(1)} km away • ${state.groupCode}`);
  }
}

function updateUI() {
  // inputs
  $("groupCode") && ($("groupCode").value = state.groupCode || "");
  $("displayName") && ($("displayName").value = state.displayName || "");
  $("duration") && ($("duration").value = String(state.duration));
  $("radius") && ($("radius").value = String(state.radiusKm));
  $("venueName") && ($("venueName").value = state.venueName || "");

  // status chip
  const chip = $("topStatusChip");
  if (chip) {
    chip.textContent = state.on ? "ON" : "OFF";
    chip.style.borderColor = state.on ? "rgba(93,211,158,.40)" : "rgba(255,255,255,.14)";
    chip.style.background = state.on ? "rgba(93,211,158,.16)" : "rgba(255,255,255,.06)";
  }

  // location
  const locEl = $("loc");
  if (locEl) {
    locEl.textContent = state.location
      ? `${state.location.lat.toFixed(5)}, ${state.location.lon.toFixed(5)} (±${Math.round(state.location.accuracy)}m)`
      : "not set";
  }

  // saved
  const savedEl = $("saved");
  if (savedEl) savedEl.textContent = state.savedAt ? new Date(state.savedAt).toLocaleString() : "never";

  // expiry
  const expEl = $("expiresText");
  if (expEl) {
    if (state.on && state.expiresAt) {
      const minsLeft = Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000));
      expEl.textContent = `~${minsLeft} min${minsLeft === 1 ? "" : "s"}`;
    } else {
      expEl.textContent = "—";
    }
  }

  // toggle enabled/disabled
  const toggle = $("toggleOn");
  const help = $("pintHelp");
  if (toggle) {
    toggle.disabled = !readyForToggle();
    toggle.checked = !!state.on;
  }
  if (help) {
    help.textContent = readyForToggle()
      ? (state.on ? "You’re ON. Toggle OFF to disappear." : "Ready. Toggle ON to request location and publish.")
      : "Fill Group + Name + Time + Radius to enable ON.";
  }

  renderMeetStatus();
}

function scheduleExpiry() {
  clearTimeout(expireTimer);
  if (!state.on || !state.expiresAt) return;

  const ms = Math.max(0, state.expiresAt - Date.now() + 1000);
  expireTimer = setTimeout(async () => {
    await goOff(true);
    showToast("Expired", "You’re now OFF");
  }, ms);
}

async function refreshLocationAndMaybeSync() {
  showToast("Getting location…", "Allow location to refresh");
  try {
    const pos = await requestLocation();
    state.location = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      at: Date.now()
    };
    state.savedAt = Date.now();
    persist();
    updateUI();

    if (state.on && uid) {
      // keep same expiry, just update location + updatedAt
      await savePresence();
      startRealtime(); // immediate recalc
      showToast("Location updated", "Synced");
    } else {
      showToast("Location updated", "Ready to go ON");
    }
  } catch (err) {
    console.log(err);
    showToast("Location failed", "Check permission settings");
  }
}

async function goOn() {
  if (!readyForToggle()) {
    state.on = false;
    persist();
    updateUI();
    showToast("Missing fields", "Fill Group + Name + Time + Radius first");
    return;
  }

  if (!uid) {
    state.on = false;
    persist();
    updateUI();
    showToast("Signing in…", "Try again in 2 seconds");
    return;
  }

  // If group changed while ON last time, clean up that old presence doc
  if (lastGroupCodeWhileOn && lastGroupCodeWhileOn !== state.groupCode) {
    await deletePresence(lastGroupCodeWhileOn);
    lastGroupCodeWhileOn = null;
  }

  // Always fetch/refresh location when turning ON
  showToast("Getting location…", "Allow location to go ON");
  try {
    const pos = await requestLocation();
    state.location = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      at: Date.now()
    };
  } catch (err) {
    console.log(err);
    state.on = false;
    persist();
    updateUI();
    showToast("Location blocked", "Allow location for this site");
    return;
  }

  state.savedAt = Date.now();
  state.expiresAt = Date.now() + state.duration * 60000;
  persist();
  updateUI();

  try {
    await savePresence();
    lastGroupCodeWhileOn = state.groupCode;
    startRealtime();
    scheduleExpiry();
    showToast("You’re ON", "Visible to your group");
  } catch (e) {
    console.log(e);
    state.on = false;
    state.expiresAt = null;
    persist();
    updateUI();
    showToast("Couldn’t go ON", "Check Firebase rules/auth");
  }
}

async function goOff(fromExpiry = false) {
  // remember group so we can delete correct doc even if user changes group while ON
  const groupToDelete = state.groupCode;

  state.on = false;
  state.expiresAt = null;
  state.meet = null;
  state.savedAt = Date.now();
  persist();
  updateUI();

  stopRealtime();
  await deletePresence(groupToDelete);
  renderMatches([]);

  if (!fromExpiry) showToast("You’re OFF", "Removed from matches");
}

function wireUI() {
  // Field updates
  $("groupCode")?.addEventListener("input", (e) => {
    const newCode = (e.target.value || "").trim().toLowerCase();
    const changed = newCode !== state.groupCode;
    state.groupCode = newCode;
    persist();
    updateUI();

    // If ON and group changed, we need to move presence to new group (delete old and re-save)
    if (state.on && uid && changed) {
      const old = lastGroupCodeWhileOn || newCode;
      // delete old doc and re-save into new group
      deletePresence(old).finally(async () => {
        try { await savePresence(); startRealtime(); } catch {}
      });
      lastGroupCodeWhileOn = state.groupCode;
    }
  });

  $("displayName")?.addEventListener("input", (e) => {
    state.displayName = (e.target.value || "").trim();
    persist();
    updateUI();
    if (state.on && uid) {
      // update name while ON
      state.savedAt = Date.now();
      persist();
      savePresence().catch(() => {});
    }
  });

  $("duration")?.addEventListener("change", (e) => {
    state.duration = Number(e.target.value);
    persist();
    updateUI();
    if (state.on) {
      // extend expiry + re-save
      state.savedAt = Date.now();
      state.expiresAt = Date.now() + state.duration * 60000;
      persist();
      updateUI();
      scheduleExpiry();
      if (uid) savePresence().catch(() => {});
    }
  });

  $("radius")?.addEventListener("change", (e) => {
    state.radiusKm = Number(e.target.value);
    persist();
    updateUI();
    if (state.on) startRealtime();
    if (state.on && uid) {
      state.savedAt = Date.now();
      persist();
      savePresence().catch(() => {});
    }
  });

  // Toggle ON/OFF
  $("toggleOn")?.addEventListener("change", async (e) => {
    const wantOn = e.target.checked;

    state.on = wantOn;
    persist();
    updateUI();

    if (wantOn) await goOn();
    else await goOff(false);
  });

  // Location row tap-to-refresh (optional element)
  $("locRow")?.addEventListener("click", refreshLocationAndMaybeSync);
  $("locRow")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      refreshLocationAndMaybeSync();
    }
  });

  // Meet Here (optional)
  $("venueName")?.addEventListener("input", (e) => {
    state.venueName = (e.target.value || "").trim();
    persist();
    updateUI();
  });

  $("meetHere")?.addEventListener("click", async () => {
    if (!state.on) return showToast("Turn ON first", "Meet here only posts while you’re ON");
    if (!state.location) return showToast("No location", "Turn ON again to refresh location");
    if (!uid) return showToast("Signing in…", "Try again in 2 seconds");

    const name = (state.venueName || "").trim();
    const lat = state.location.lat;
    const lon = state.location.lon;
    const url = mapsLink(lat, lon, name || (state.displayName ? `${state.displayName} meet` : "Meet"));

    state.meet = { name: name || "Meet here", lat, lon, url, createdAt: Date.now() };
    state.savedAt = Date.now();
    persist();
    updateUI();

    try {
      await savePresence();
      showToast("Meet posted", name ? name : "Pin added");
    } catch (e2) {
      console.log(e2);
      showToast("Meet failed", "Couldn’t update Firebase");
    }
  });

  $("clearMeet")?.addEventListener("click", async () => {
    state.meet = null;
    state.savedAt = Date.now();
    persist();
    updateUI();

    if (state.on && uid) {
      try { await savePresence(); showToast("Cleared", "Meet removed"); } catch {}
    } else {
      showToast("Cleared", "Meet removed");
    }
  });
}

async function initFirebaseAuth() {
  const { auth } = window.fb;

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      uid = user.uid;

      // If OFF, ensure no lingering doc
      if (!state.on) await deletePresence();

      // If ON on refresh, only republish if we still have location
      if (state.on && state.location) {
        try { await savePresence(); } catch {}
        startRealtime();
        scheduleExpiry();
      }

      updateUI();
    }
  });

  if (!auth.currentUser) {
    try { await auth.signInAnonymously(); }
    catch (e) { alert("Firebase auth error: " + e.message); }
  }
}

// Boot
hydrate();
wireUI();
updateUI();
initFirebaseAuth();
