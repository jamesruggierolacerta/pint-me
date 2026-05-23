// Pint-me — layout v3
// Required: group code + display name + location.
// Toggle publishes/unpublishes (no Save button).
// Matches first, Meet here optional below matches.
// No service worker.

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

function mapsLink(lat, lon, label) {
  const q = label ? `${label} @ ${lat},${lon}` : `${lat},${lon}`;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
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

const STORAGE_KEY = "pintme_layout_v3";

const state = {
  on: false,
  duration: 60,
  radiusKm: 1,
  location: null, // {lat, lon, accuracy}
  savedAt: null,
  expiresAt: null,
  groupCode: "cominghome",
  displayName: "",
  showAllInGroup: false,
  venueName: "",
  meet: null // {name, lat, lon, url, createdAt}
};

let uid = null;
let unsubscribe = null;
let lastToastKey = "";
let updateTimer = null;

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
  state.showAllInGroup = !!state.showAllInGroup;
  state.venueName = (state.venueName || "").trim();

  // auto-expire local state
  if (state.expiresAt && Date.now() > state.expiresAt) {
    state.on = false;
    state.expiresAt = null;
    state.meet = null;
    persist();
  }
}

function requiredReady() {
  return !!(
    state.groupCode && state.groupCode.length >= 2 &&
    state.displayName && state.displayName.length >= 1 &&
    state.location &&
    state.duration && state.radiusKm
  );
}

function updateToggleEnabled() {
  const ok = requiredReady();
  const toggle = $("toggleOn");
  const help = $("pintHelp");

  if (!toggle) return;

  toggle.disabled = !ok;

  if (help) {
    if (!ok) help.textContent = "Enter Group + Name and set Location to enable ON.";
    else help.textContent = state.on ? "You’re ON. Toggle OFF to disappear." : "Ready. Switch ON to publish.";
  }
}

function presenceRef() {
  if (!uid || !state.groupCode) return null;
  return window.fb.db
    .collection("groups")
    .doc(state.groupCode)
    .collection("presence")
    .doc(uid);
}

async function deletePresence() {
  const ref = presenceRef();
  if (!ref) return;
  try { await ref.delete(); } catch (e) { console.log("deletePresence", e); }
}

async function savePresence() {
  if (!uid) throw new Error("Not signed in yet");
  if (!requiredReady()) throw new Error("Missing required setup");

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
  if (unsubscribe) { try { unsubscribe(); } catch {} unsubscribe = null; }
}

function startRealtime() {
  stopRealtime();
  if (!uid || !state.groupCode) return;

  const col = window.fb.db
    .collection("groups")
    .doc(state.groupCode)
    .collection("presence");

  unsubscribe = col.onSnapshot((snap) => {
    if (!state.on) {
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

      const within = dKm <= state.radiusKm;
      if (state.showAllInGroup || within) {
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
    summary.textContent = state.on ? "No matches yet." : "Turn ON to see who’s up for one.";
    lastToastKey = "";
    return;
  }

  empty.style.display = "none";
  summary.textContent = state.showAllInGroup
    ? `${sorted.length} ON in group.`
    : `${sorted.length} match${sorted.length === 1 ? "" : "es"} in radius.`;

  sorted.forEach((m) => {
    const li = document.createElement("li");
    li.className = "rowcard";

    const meet = (m.meet && m.meet.url)
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
      ${meet}
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

  const top = sorted[0];
  const key = `${top.name}|${top.dKm.toFixed(1)}|${state.groupCode}|${state.showAllInGroup ? 1 : 0}|${state.radiusKm}`;
  if (key !== lastToastKey) {
    lastToastKey = key;
    showToast(`🍺 Match: ${top.name}`, `~${top.dKm.toFixed(1)} km away • ${state.groupCode}`);
  }
}

function render() {
  $("duration").value = String(state.duration);
  $("radius").value = String(state.radiusKm);
  $("groupCode").value = state.groupCode || "";
  $("displayName").value = state.displayName || "";
  $("showAllInGroup").checked = !!state.showAllInGroup;
  $("venueName").value = state.venueName || "";

  const toggle = $("toggleOn");
  if (toggle) toggle.checked = !!state.on;

  const chip = $("topStatusChip");
  if (chip) {
    chip.textContent = state.on ? "ON" : "OFF";
    chip.style.borderColor = state.on ? "rgba(93,211,158,.40)" : "rgba(255,255,255,.14)";
    chip.style.background = state.on ? "rgba(93,211,158,.16)" : "rgba(255,255,255,.06)";
  }

  const gc = $("groupChip");
  if (gc) gc.textContent = state.groupCode || "";

  $("loc").textContent = state.location
    ? `${state.location.lat.toFixed(5)}, ${state.location.lon.toFixed(5)} (±${Math.round(state.location.accuracy)}m)`
    : "not set";

  $("saved").textContent = state.savedAt ? new Date(state.savedAt).toLocaleString() : "never";

  if (state.on && state.expiresAt) {
    const minsLeft = Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000));
    $("expiresText").textContent = `~${minsLeft} min${minsLeft === 1 ? "" : "s"}`;
  } else {
    $("expiresText").textContent = "—";
  }

  renderMeetStatus();
  updateToggleEnabled();
}

function scheduleUpdateIfOn() {
  if (!state.on) return;
  clearTimeout(updateTimer);
  updateTimer = setTimeout(async () => {
    try {
      state.savedAt = Date.now();
      state.expiresAt = Date.now() + state.duration * 60000;
      persist();
      await savePresence();
      render();
    } catch (e) {
      console.log(e);
    }
  }, 250);
}

function wireUI() {
  $("groupCode").addEventListener("input", (e) => {
    const newCode = (e.target.value || "").trim().toLowerCase();
    if (newCode !== state.groupCode) {
      state.groupCode = newCode;
      persist();
      render();

      if (state.on && uid) {
        deletePresence().finally(() => {
          stopRealtime();
          scheduleUpdateIfOn();
          startRealtime();
        });
      }
    }
  });

  $("displayName").addEventListener("input", (e) => {
    state.displayName = (e.target.value || "").trim();
    persist();
    render();
    scheduleUpdateIfOn();
  });

  $("showAllInGroup").addEventListener("change", (e) => {
    state.showAllInGroup = !!e.target.checked;
    persist();
    render();
    startRealtime();
  });

  $("duration").addEventListener("change", (e) => {
    state.duration = Number(e.target.value);
    if (state.on) state.expiresAt = Date.now() + state.duration * 60000;
    persist();
    render();
    scheduleUpdateIfOn();
  });

  $("radius").addEventListener("change", (e) => {
    state.radiusKm = Number(e.target.value);
    persist();
    render();
    startRealtime();
    scheduleUpdateIfOn();
  });

  $("getLocation").addEventListener("click", () => {
    if (!("geolocation" in navigator)) return alert("Geolocation not supported.");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.location = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        persist();
        render();
        showToast("Location set", "You can now switch ON");
        startRealtime();
        scheduleUpdateIfOn();
      },
      (err) => alert(`Couldn’t get location: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  // Toggle publishes/unpublishes
  $("toggleOn").addEventListener("change", async (e) => {
    const wantOn = e.target.checked;

    if (!requiredReady()) {
      e.target.checked = false;
      showToast("Missing setup", "Group + Name + Location are required");
      return;
    }

    state.on = wantOn;
    state.expiresAt = wantOn ? Date.now() + state.duration * 60000 : null;
    if (!wantOn) state.meet = null;
    state.savedAt = Date.now();
    persist();
    render();

    if (!uid) {
      showToast("Signing in…", "Try again in 2 seconds");
      state.on = false;
      state.expiresAt = null;
      persist();
      render();
      return;
    }

    if (!wantOn) {
      stopRealtime();
      await deletePresence();
      renderMatches([]);
      showToast("You’re OFF", "Removed from matches");
      return;
    }

    try {
      await savePresence();
      showToast("You’re ON", "Visible to your group");
      startRealtime();

      clearTimeout(window.__expireTimer);
      window.__expireTimer = setTimeout(async () => {
        state.on = false;
        state.expiresAt = null;
        state.meet = null;
        state.savedAt = Date.now();
        persist();
        render();
        stopRealtime();
        await deletePresence();
        renderMatches([]);
        showToast("Expired", "You’re now OFF");
      }, state.duration * 60000 + 1000);
    } catch (err) {
      console.log(err);
      showToast("Couldn’t go ON", "Check Firebase rules/auth");
      state.on = false;
      state.expiresAt = null;
      persist();
      render();
    }
  });

  // Meet here (optional)
  $("venueName").addEventListener("input", (e) => {
    state.venueName = (e.target.value || "").trim();
    persist();
    render();
  });

  $("meetHere").addEventListener("click", async () => {
    if (!state.on) return showToast("Turn ON first", "Meet here only posts while you’re ON");
    if (!state.location) return showToast("No location", "Set location first");
    if (!uid) return showToast("Signing you in…", "Try again in 2 seconds");

    const name = (state.venueName || "").trim();
    const lat = state.location.lat;
    const lon = state.location.lon;
    const url = mapsLink(lat, lon, name || (state.displayName ? `${state.displayName} meet` : "Meet"));

    state.meet = { name: name || "Meet here", lat, lon, url, createdAt: Date.now() };
    state.savedAt = Date.now();
    persist();
    render();

    try {
      await savePresence();
      showToast("Meet posted", name ? name : "Pin added");
    } catch (e) {
      console.log(e);
      showToast("Meet failed", "Couldn’t update Firebase");
    }
  });

  $("clearMeet").addEventListener("click", async () => {
    state.meet = null;
    state.savedAt = Date.now();
    persist();
    render();

    if (state.on && uid) {
      try { await savePresence(); showToast("Cleared", "Meet removed"); } catch {}
    } else {
      showToast("Cleared", "Meet removed");
    }
  });

  $("share").addEventListener("click", async () => {
    const url = location.href;
    const text = `Pint-me — join my group code: ${state.groupCode}`;
    try {
      if (navigator.share) await navigator.share({ title: "Pint-me", text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        showToast("Invite copied", "Paste it into WhatsApp/iMessage");
      }
    } catch {}
  });

  $("reset").addEventListener("click", async () => {
    if (!confirm("Reset everything on this device?")) return;
    stopRealtime();
    state.meet = null;
    if (uid) await deletePresence();
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

async function initFirebaseAuth() {
  const { auth } = window.fb;

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      uid = user.uid;

      // Ensure OFF users aren't lingering
      if (!state.on) await deletePresence();

      // If ON, publish immediately
      if (state.on) {
        try { await savePresence(); } catch {}
        startRealtime();
      }

      render();
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
render();
initFirebaseAuth();
