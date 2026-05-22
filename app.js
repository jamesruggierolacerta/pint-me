// Pint-me / Pint Ping — clean app.js (no service worker)
// Realtime matches + Meet-here + deletes presence doc on OFF/Reset/Expiry.

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

const STORAGE_KEY = "pintme_state_clean_v1";

const state = {
  on: false,
  duration: 60,
  radiusKm: 1,
  location: null,
  savedAt: null,
  expiresAt: null,
  groupCode: "cominghome",
  displayName: "",
  showAllInGroup: false,
  venueName: "",
  meet: null
};

let uid = null;
let unsubscribe = null;
let lastToastKey = "";

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

  // If expired locally, ensure we're OFF.
  if (state.expiresAt && Date.now() > state.expiresAt) {
    state.on = false;
    state.expiresAt = null;
    state.meet = null;
    persist();
  }
}

function presenceRef() {
  if (!uid || !state.groupCode) return null;
  return window.fb.db.collection("groups").doc(state.groupCode).collection("presence").doc(uid);
}

async function deletePresence() {
  const ref = presenceRef();
  if (!ref) return;
  try { await ref.delete(); } catch (e) { console.log("deletePresence", e); }
}

async function savePresence() {
  if (!uid) throw new Error("Not signed in yet");
  if (!state.groupCode) throw new Error("Group code required");
  if (!state.location) throw new Error("Location required (tap ‘Use my location’)");

  const ref = presenceRef();
  if (!ref) throw new Error("Presence ref not available");

  const payload = {
    uid,
    name: state.displayName || "Someone",
    on: true,
    duration: state.duration,
    radiusKm: state.radiusKm,
    location: { lat: state.location.lat, lon: state.location.lon, accuracy: state.location.accuracy },
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

  const col = window.fb.db.collection("groups").doc(state.groupCode).collection("presence");
  unsubscribe = col.onSnapshot((snap) => {
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

      const dKm = haversineKm(state.location.lat, state.location.lon, p.location.lat, p.location.lon);
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
    summary.textContent = state.showAllInGroup
      ? "No one ON in your group right now."
      : "No matches right now (group + radius).";
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
  $("toggleOn").checked = !!state.on;
  $("duration").value = String(state.duration);
  $("radius").value = String(state.radiusKm);
  $("groupCode").value = state.groupCode || "";
  $("displayName").value = state.displayName || "";
  $("showAllInGroup").checked = !!state.showAllInGroup;
  $("venueName").value = state.venueName || "";

  const chip = $("topStatusChip");
  if (chip) {
    chip.textContent = state.on ? "ON" : "OFF";
    chip.style.borderColor = state.on ? "rgba(93,211,158,.40)" : "rgba(255,255,255,.14)";
    chip.style.background = state.on ? "rgba(93,211,158,.16)" : "rgba(255,255,255,.06)";
  }

  const gc = $("groupChip");
  if (gc) gc.textContent = state.groupCode || "";

  const expires = $("expiresText");
  if (expires) {
    if (state.on && state.expiresAt) {
      const minsLeft = Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000));
      expires.textContent = `Expires in ~${minsLeft} min${minsLeft === 1 ? "" : "s"}`;
    } else {
      expires.textContent = "";
    }
  }

  $("loc").textContent = state.location
    ? `${state.location.lat.toFixed(5)}, ${state.location.lon.toFixed(5)} (±${Math.round(state.location.accuracy)}m)`
    : "not set";

  $("saved").textContent = state.savedAt ? new Date(state.savedAt).toLocaleString() : "never";
  renderMeetStatus();
}

function wireUI() {
  $("toggleOn").addEventListener("change", async (e) => {
    state.on = e.target.checked;
    state.expiresAt = state.on ? Date.now() + state.duration * 60000 : null;
    if (!state.on) state.meet = null;
    persist();
    render();

    if (!state.on) {
      stopRealtime();
      await deletePresence();
      renderMatches([]);
      showToast("You’re OFF", "Removed from matches");
      return;
    }

    showToast("You’re ON", "Use location, then Save status");

    clearTimeout(window.__expireTimer);
    window.__expireTimer = setTimeout(async () => {
      state.on = false;
      state.expiresAt = null;
      state.meet = null;
      persist();
      render();
      stopRealtime();
      await deletePresence();
      renderMatches([]);
      showToast("Expired", "You’re now OFF");
    }, state.duration * 60000 + 1000);

    if (state.location) startRealtime();
  });

  $("duration").addEventListener("change", (e) => {
    state.duration = Number(e.target.value);
    if (state.on) state.expiresAt = Date.now() + state.duration * 60000;
    persist();
    render();
  });

  $("radius").addEventListener("change", (e) => {
    state.radiusKm = Number(e.target.value);
    persist();
    if (state.on && state.location) startRealtime();
  });

  $("groupCode").addEventListener("input", (e) => {
    const newCode = (e.target.value || "").trim().toLowerCase();
    if (newCode !== state.groupCode) {
      state.groupCode = newCode;
      persist();
      render();
      if (state.on) {
        deletePresence().finally(() => {
          stopRealtime();
          if (state.location) startRealtime();
        });
      }
    }
  });

  $("displayName").addEventListener("input", (e) => {
    state.displayName = (e.target.value || "").trim();
    persist();
  });

  $("showAllInGroup").addEventListener("change", (e) => {
    state.showAllInGroup = !!e.target.checked;
    persist();
    if (state.on && state.location) startRealtime();
  });

  $("venueName").addEventListener("input", (e) => {
    state.venueName = (e.target.value || "").trim();
    persist();
  });

  $("getLocation").addEventListener("click", () => {
    if (!("geolocation" in navigator)) return alert("Geolocation not supported.");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.location = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
        persist();
        render();
        showToast("Location set", "Now Save status");
        if (state.on) startRealtime();
      },
      (err) => alert(`Couldn’t get location: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  $("save").addEventListener("click", async () => {
    state.savedAt = Date.now();
    if (state.on) state.expiresAt = Date.now() + state.duration * 60000;

    state.groupCode = ($("groupCode").value || "").trim().toLowerCase();
    state.displayName = ($("displayName").value || "").trim();
    state.showAllInGroup = !!$("showAllInGroup").checked;
    state.venueName = ($("venueName").value || "").trim();

    persist();
    render();

    if (!state.on) {
      await deletePresence();
      renderMatches([]);
      showToast("You’re OFF", "Removed from matches");
      return;
    }

    if (!uid) return showToast("Signing you in…", "Try again in 2 seconds");

    try {
      await savePresence();
      showToast("Saved", "You’re now visible");
      startRealtime();
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  $("meetHere").addEventListener("click", async () => {
    if (!state.on) return showToast("Turn ON first", "Meet here only posts while you’re ON");
    if (!state.location) return showToast("Set location", "Tap ‘Use my location’ first");
    if (!uid) return showToast("Signing you in…", "Try again in 2 seconds");

    const name = (state.venueName || "").trim();
    const lat = state.location.lat;
    const lon = state.location.lon;
    const url = mapsLink(lat, lon, name || (state.displayName ? `${state.displayName} meet` : "Meet"));

    state.meet = { name: name || "Meet here", lat, lon, url, createdAt: Date.now() };
    persist();
    renderMeetStatus();

    try {
      await savePresence();
      showToast("Meet posted", name ? name : "Pin added");

      const shareText = `${state.displayName || "Someone"}: meet here — ${name || "Meet here"}\n${url}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: "Meet here", text: shareText, url });
        } else {
          await navigator.clipboard.writeText(shareText);
          showToast("Copied", "Meet message copied");
        }
      } catch {}
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  $("clearMeet").addEventListener("click", async () => {
    state.meet = null;
    persist();
    renderMeetStatus();
    if (state.on && uid && state.location) {
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
    await deletePresence();
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

async function initFirebaseAuth() {
  const { auth } = window.fb;

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      uid = user.uid;
      if (!state.on) await deletePresence();
      if (state.on && state.location) startRealtime();
      render();
    }
  });

  if (!auth.currentUser) {
    try { await auth.signInAnonymously(); }
    catch (e) { alert("Firebase auth error: " + e.message); }
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Boot
hydrate();
wireUI();
render();
initFirebaseAuth();
