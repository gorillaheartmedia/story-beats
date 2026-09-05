/**
 * Project Safety Helper
 * This script ensures every page can safely get the current projectId,
 * even if it is not in the URL, by falling back to:
 *  1. projectId or id in URL parameters
 *  2. project_config.json file
 *  3. localStorage
 *
 * Usage:
 *   getProjectId().then(projectId => {
 *     if (!projectId) { ... handle error ... }
 *   });
 *
 *   // Optional: Save projectId manually if needed
 *   setProjectId("p_12345");
 */

// Get the current projectId from multiple sources
async function getProjectId() {
  let projectId = null;

  // 1. Try URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  projectId = urlParams.get("projectId") || urlParams.get("id");

  // 2. Try loading from project_config.json if not found in URL
  if (!projectId) {
    try {
      const res = await fetch("project_config.json", { cache: "no-store" });
      if (res.ok) {
        const config = await res.json();
        if (config && config.currentProjectId) {
          projectId = config.currentProjectId;
        }
      }
    } catch (e) {
      console.warn("project_config.json not found or unreadable", e);
    }
  }

  // 3. Try localStorage
  if (!projectId) {
    projectId = localStorage.getItem("currentProjectId");
  }

  // Save back to localStorage for consistency
  if (projectId) {
    localStorage.setItem("currentProjectId", projectId);
  }

  return projectId;
}

// Set the projectId manually and sync to localStorage
function setProjectId(projectId) {
  if (!projectId) return;
  localStorage.setItem("currentProjectId", projectId);

  // Optionally update project_config.json here if you have a backend to write to
  // (Not possible with static local HTML/JS without server support)
}

// Redirect to dashboard if no projectId found
async function ensureProjectIdOrRedirect(redirectUrl = "project_core.html") {
  const pid = await getProjectId();
  if (!pid) {
    alert("No project found. Redirecting to dashboard.");
    window.location.href = redirectUrl;
  }
  return pid;
}

// Export functions for use in other scripts
window.getProjectId = getProjectId;
window.setProjectId = setProjectId;
window.ensureProjectIdOrRedirect = ensureProjectIdOrRedirect;

// --- Project storage (IndexedDB-backed) ---
const PROJECT_DB_NAME = "storybeats_db";
const PROJECT_DB_VERSION = 1;
const PROJECT_STORE = "kv";
let projectCache = null;
let projectDbPromise = null;

function openProjectDb() {
  if (projectDbPromise) return projectDbPromise;
  projectDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return projectDbPromise;
}

async function idbGet(key) {
  const db = await openProjectDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECT_STORE, "readonly");
    const store = tx.objectStore(PROJECT_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openProjectDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECT_STORE, "readwrite");
    const store = tx.objectStore(PROJECT_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function getProjects() {
  if (projectCache) return projectCache;
  let data = null;
  try {
    data = await idbGet("plotProjects");
  } catch (e) {
    console.warn("IndexedDB read failed, falling back to localStorage", e);
  }
  if (!data) {
    try {
      data = JSON.parse(localStorage.getItem("plotProjects") || "[]");
      if (data && data.length) {
        await idbSet("plotProjects", data);
        localStorage.removeItem("plotProjects");
      }
    } catch (e) {
      console.warn("plotProjects malformed in localStorage", e);
      data = [];
    }
  }
  projectCache = data || [];
  return projectCache;
}

async function setProjects(arr) {
  projectCache = arr;
  try {
    await idbSet("plotProjects", arr);
    return true;
  } catch (e) {
    console.warn("IndexedDB write failed", e);
    return false;
  }
}

window.projectStoreGetProjects = getProjects;
window.projectStoreSetProjects = setProjects;
window.getProjects = getProjects;
window.setProjects = setProjects;

// --- Shared audio library and player ---
const STORY_AUDIO_KEY = "storyAudioLibrary";
let storyAudioState = {
  tracks: [],
  currentIndex: -1,
  urls: new Map(),
  shuffle: localStorage.getItem("storyAudioShuffle") === "1",
  loop: localStorage.getItem("storyAudioLoop") === "1",
  volume: Number(localStorage.getItem("storyAudioVolume") || "0.85"),
  ready: false
};

function storyAudioFormatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function storyAudioTrackLabel(track, index) {
  return track && track.name ? track.name : `Track ${index + 1}`;
}

function storyAudioClampVolume(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0.85;
  return Math.min(1, Math.max(0, next));
}

async function storyAudioLoadLibrary() {
  let tracks = [];
  try {
    tracks = await idbGet(STORY_AUDIO_KEY);
  } catch (e) {
    console.warn("Audio library read failed", e);
  }
  storyAudioState.tracks = Array.isArray(tracks) ? tracks : [];
  if (storyAudioState.currentIndex >= storyAudioState.tracks.length) {
    storyAudioState.currentIndex = storyAudioState.tracks.length ? 0 : -1;
  }
  if (storyAudioState.currentIndex === -1 && storyAudioState.tracks.length) {
    storyAudioState.currentIndex = 0;
  }
}

async function storyAudioSaveLibrary() {
  try {
    await idbSet(STORY_AUDIO_KEY, storyAudioState.tracks);
  } catch (e) {
    console.warn("Audio library save failed", e);
  }
}

function storyAudioGetUrl(track) {
  if (!track || !track.blob) return "";
  if (!storyAudioState.urls.has(track.id)) {
    storyAudioState.urls.set(track.id, URL.createObjectURL(track.blob));
  }
  return storyAudioState.urls.get(track.id);
}

function storyAudioReleaseTrackUrl(trackId) {
  const url = storyAudioState.urls.get(trackId);
  if (url) URL.revokeObjectURL(url);
  storyAudioState.urls.delete(trackId);
}

function storyAudioRender() {
  const shell = document.getElementById("story-audio-shell");
  if (!shell) return;

  const panel = shell.querySelector(".story-audio-panel");
  const list = shell.querySelector(".story-audio-list");
  const title = shell.querySelector(".story-audio-title");
  const empty = shell.querySelector(".story-audio-empty");
  const audio = shell.querySelector("audio");
  const playButton = shell.querySelector("[data-audio-action='play']");
  const shuffleButton = shell.querySelector("[data-audio-action='shuffle']");
  const loopButton = shell.querySelector("[data-audio-action='loop']");
  const volumeInput = shell.querySelector("[data-audio-volume]");
  const volumeValue = shell.querySelector("[data-audio-volume-value]");
  const homeButton = shell.querySelector(".story-audio-home");
  const isOpen = localStorage.getItem("storyAudioPanelOpen") === "1";

  shell.classList.toggle("is-open", isOpen);
  panel.hidden = !isOpen;
  homeButton.setAttribute("aria-expanded", String(isOpen));

  list.innerHTML = "";
  empty.hidden = storyAudioState.tracks.length > 0;

  storyAudioState.tracks.forEach((track, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "story-audio-track";
    row.dataset.index = String(index);
    row.innerHTML = `
      <span class="story-audio-track-name"></span>
      <span class="story-audio-track-size">${track.size ? Math.round(track.size / 1024 / 1024 * 10) / 10 + " MB" : ""}</span>
    `;
    row.querySelector(".story-audio-track-name").textContent = storyAudioTrackLabel(track, index);
    if (index === storyAudioState.currentIndex) row.classList.add("is-active");
    row.addEventListener("click", () => storyAudioSelect(index, true));
    list.appendChild(row);
  });

  const current = storyAudioState.tracks[storyAudioState.currentIndex];
  title.textContent = current ? storyAudioTrackLabel(current, storyAudioState.currentIndex) : "No audio loaded";
  if (current && audio.dataset.trackId !== current.id) {
    audio.src = storyAudioGetUrl(current);
    audio.dataset.trackId = current.id;
  }
  if (!current) {
    audio.removeAttribute("src");
    audio.dataset.trackId = "";
  }
  audio.volume = storyAudioClampVolume(storyAudioState.volume);
  if (shuffleButton) {
    shuffleButton.classList.toggle("is-active", storyAudioState.shuffle);
    shuffleButton.setAttribute("aria-pressed", String(storyAudioState.shuffle));
  }
  if (loopButton) {
    loopButton.classList.toggle("is-active", storyAudioState.loop);
    loopButton.setAttribute("aria-pressed", String(storyAudioState.loop));
  }
  if (volumeInput) volumeInput.value = String(Math.round(storyAudioClampVolume(storyAudioState.volume) * 100));
  if (volumeValue) volumeValue.textContent = `${Math.round(storyAudioClampVolume(storyAudioState.volume) * 100)}%`;
  playButton.textContent = audio.paused ? "Play" : "Pause";
}

function storyAudioSelect(index, shouldPlay) {
  if (index < 0 || index >= storyAudioState.tracks.length) return;
  storyAudioState.currentIndex = index;
  const audio = document.querySelector("#story-audio-shell audio");
  const current = storyAudioState.tracks[index];
  if (audio && current) {
    audio.src = storyAudioGetUrl(current);
    audio.dataset.trackId = current.id;
    if (shouldPlay) audio.play().catch(() => {});
  }
  storyAudioRender();
}

function storyAudioSkip(delta) {
  if (!storyAudioState.tracks.length) return;
  if (storyAudioState.shuffle && storyAudioState.tracks.length > 1) {
    let next = storyAudioState.currentIndex;
    while (next === storyAudioState.currentIndex) {
      next = Math.floor(Math.random() * storyAudioState.tracks.length);
    }
    storyAudioSelect(next, true);
    return;
  }
  const next = (storyAudioState.currentIndex + delta + storyAudioState.tracks.length) % storyAudioState.tracks.length;
  storyAudioSelect(next, true);
}

function storyAudioFinishTrack() {
  if (!storyAudioState.tracks.length) return;
  const isLast = storyAudioState.currentIndex === storyAudioState.tracks.length - 1;
  if (storyAudioState.loop || storyAudioState.shuffle || !isLast) {
    storyAudioSkip(1);
    return;
  }
  const audio = document.querySelector("#story-audio-shell audio");
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  storyAudioRender();
}

function storyAudioToggleShuffle() {
  storyAudioState.shuffle = !storyAudioState.shuffle;
  localStorage.setItem("storyAudioShuffle", storyAudioState.shuffle ? "1" : "0");
  storyAudioRender();
}

function storyAudioToggleLoop() {
  storyAudioState.loop = !storyAudioState.loop;
  localStorage.setItem("storyAudioLoop", storyAudioState.loop ? "1" : "0");
  storyAudioRender();
}

function storyAudioSetVolume(value) {
  storyAudioState.volume = storyAudioClampVolume(Number(value) / 100);
  localStorage.setItem("storyAudioVolume", String(storyAudioState.volume));
  const audio = document.querySelector("#story-audio-shell audio");
  if (audio) audio.volume = storyAudioState.volume;
  storyAudioRender();
}

async function storyAudioAddFiles(files) {
  const incoming = Array.from(files || []).filter(file => file.type.startsWith("audio/"));
  if (!incoming.length) return;
  incoming.forEach(file => {
    storyAudioState.tracks.push({
      id: `audio_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: file.name,
      type: file.type,
      size: file.size,
      addedAt: new Date().toISOString(),
      blob: file
    });
  });
  if (storyAudioState.currentIndex === -1) storyAudioState.currentIndex = 0;
  await storyAudioSaveLibrary();
  storyAudioRender();
}

async function storyAudioRemoveCurrent() {
  const index = storyAudioState.currentIndex;
  if (index < 0 || index >= storyAudioState.tracks.length) return;
  const removed = storyAudioState.tracks.splice(index, 1)[0];
  if (removed) storyAudioReleaseTrackUrl(removed.id);
  storyAudioState.currentIndex = storyAudioState.tracks.length ? Math.min(index, storyAudioState.tracks.length - 1) : -1;
  await storyAudioSaveLibrary();
  storyAudioRender();
}

function storyAudioInjectStyles() {
  if (document.getElementById("story-audio-styles")) return;
  const style = document.createElement("style");
  style.id = "story-audio-styles";
  style.textContent = `
    #story-audio-shell {
      position: fixed;
      left: 18px;
      bottom: 18px;
      z-index: 9998;
      font-family: Inter, Arial, sans-serif;
      color: #f7fbff;
    }
    .story-audio-home {
      min-width: 88px;
      height: 44px;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px;
      background: linear-gradient(120deg, #10233f, #2475d6);
      color: #fff;
      font-weight: 700;
      box-shadow: 0 10px 28px rgba(0,0,0,0.32);
      cursor: pointer;
    }
    .story-audio-panel {
      width: min(340px, calc(100vw - 36px));
      margin-bottom: 10px;
      background: rgba(14, 28, 52, 0.98);
      border: 1px solid rgba(111, 178, 255, 0.38);
      border-radius: 10px;
      box-shadow: 0 18px 42px rgba(0,0,0,0.42);
      overflow: hidden;
    }
    .story-audio-header,
    .story-audio-controls,
    .story-audio-progress {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
    }
    .story-audio-header {
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .story-audio-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.95rem;
      font-weight: 700;
    }
    .story-audio-btn {
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px;
      background: #1f4f86;
      color: #fff;
      cursor: pointer;
      font-weight: 700;
      padding: 7px 10px;
    }
    .story-audio-btn:hover,
    .story-audio-track:hover {
      background: #2d7bd2;
    }
    .story-audio-btn.is-active {
      background: #55c6a5;
      color: #061922;
      border-color: rgba(255,255,255,0.34);
    }
    .story-audio-btn.danger {
      background: #733047;
    }
    .story-audio-list {
      max-height: 180px;
      overflow: auto;
      padding: 8px;
      display: grid;
      gap: 6px;
    }
    .story-audio-track {
      width: 100%;
      min-height: 42px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      background: rgba(255,255,255,0.07);
      color: #eaf3ff;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 8px;
      text-align: left;
      cursor: pointer;
    }
    .story-audio-track.is-active {
      border-color: #7fd7ff;
      background: rgba(64, 148, 230, 0.32);
    }
    .story-audio-track-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 650;
    }
    .story-audio-track-size,
    .story-audio-empty,
    .story-audio-time {
      color: #b8d6ef;
      font-size: 0.82rem;
    }
    .story-audio-empty {
      padding: 16px 12px;
      text-align: center;
    }
    .story-audio-progress input {
      flex: 1;
      min-width: 0;
    }
    .story-audio-volume {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 8px;
      padding: 0 10px 10px;
    }
    .story-audio-volume input {
      min-width: 0;
    }
    .story-audio-panel audio {
      display: none;
    }
    @media (max-width: 620px) {
      #story-audio-shell {
        left: 10px;
        bottom: 10px;
      }
      .story-audio-panel {
        width: calc(100vw - 20px);
      }
    }
  `;
  document.head.appendChild(style);
}

async function storyAudioBuildPlayer() {
  if (document.getElementById("story-audio-shell")) return;
  storyAudioInjectStyles();
  await storyAudioLoadLibrary();

  const shell = document.createElement("div");
  shell.id = "story-audio-shell";
  shell.innerHTML = `
    <div class="story-audio-panel" hidden>
      <div class="story-audio-header">
        <div class="story-audio-title">No audio loaded</div>
        <button type="button" class="story-audio-btn" data-audio-action="load">Load</button>
        <button type="button" class="story-audio-btn" data-audio-action="close">Close</button>
      </div>
      <input type="file" accept="audio/*" multiple hidden>
      <div class="story-audio-empty">Load audio files to build your writing playlist.</div>
      <div class="story-audio-list"></div>
      <div class="story-audio-progress">
        <span class="story-audio-time" data-audio-time="current">0:00</span>
        <input type="range" min="0" max="100" value="0" step="1" aria-label="Audio progress">
        <span class="story-audio-time" data-audio-time="duration">0:00</span>
      </div>
      <div class="story-audio-controls">
        <button type="button" class="story-audio-btn" data-audio-action="prev">Prev</button>
        <button type="button" class="story-audio-btn" data-audio-action="play">Play</button>
        <button type="button" class="story-audio-btn" data-audio-action="next">Next</button>
        <button type="button" class="story-audio-btn" data-audio-action="shuffle" aria-pressed="false">Shuffle</button>
        <button type="button" class="story-audio-btn" data-audio-action="loop" aria-pressed="false">Loop</button>
        <button type="button" class="story-audio-btn danger" data-audio-action="remove">Remove</button>
      </div>
      <div class="story-audio-volume">
        <span class="story-audio-time">Volume</span>
        <input type="range" min="0" max="100" value="85" step="1" data-audio-volume aria-label="Audio volume">
        <span class="story-audio-time" data-audio-volume-value>85%</span>
      </div>
      <audio></audio>
    </div>
    <button type="button" class="story-audio-home" aria-expanded="false">Audio</button>
  `;
  document.body.appendChild(shell);

  const panel = shell.querySelector(".story-audio-panel");
  const homeButton = shell.querySelector(".story-audio-home");
  const fileInput = shell.querySelector("input[type='file']");
  const audio = shell.querySelector("audio");
  const range = shell.querySelector("input[type='range']");
  const currentTime = shell.querySelector("[data-audio-time='current']");
  const durationTime = shell.querySelector("[data-audio-time='duration']");

  homeButton.addEventListener("click", () => {
    const next = panel.hidden ? "1" : "0";
    localStorage.setItem("storyAudioPanelOpen", next);
    storyAudioRender();
  });
  shell.querySelector("[data-audio-action='close']").addEventListener("click", () => {
    localStorage.setItem("storyAudioPanelOpen", "0");
    storyAudioRender();
  });
  shell.querySelector("[data-audio-action='load']").addEventListener("click", () => fileInput.click());
  shell.querySelector("[data-audio-action='prev']").addEventListener("click", () => storyAudioSkip(-1));
  shell.querySelector("[data-audio-action='next']").addEventListener("click", () => storyAudioSkip(1));
  shell.querySelector("[data-audio-action='shuffle']").addEventListener("click", storyAudioToggleShuffle);
  shell.querySelector("[data-audio-action='loop']").addEventListener("click", storyAudioToggleLoop);
  shell.querySelector("[data-audio-action='remove']").addEventListener("click", storyAudioRemoveCurrent);
  shell.querySelector("[data-audio-action='play']").addEventListener("click", () => {
    if (!storyAudioState.tracks.length) {
      fileInput.click();
      return;
    }
    if (!audio.src) storyAudioSelect(storyAudioState.currentIndex === -1 ? 0 : storyAudioState.currentIndex, false);
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    storyAudioRender();
  });
  fileInput.addEventListener("change", async () => {
    await storyAudioAddFiles(fileInput.files);
    fileInput.value = "";
  });
  shell.querySelector("[data-audio-volume]").addEventListener("input", event => {
    storyAudioSetVolume(event.target.value);
  });
  audio.addEventListener("play", storyAudioRender);
  audio.addEventListener("pause", storyAudioRender);
  audio.addEventListener("ended", storyAudioFinishTrack);
  audio.addEventListener("timeupdate", () => {
    range.value = audio.duration ? String((audio.currentTime / audio.duration) * 100) : "0";
    currentTime.textContent = storyAudioFormatTime(audio.currentTime);
    durationTime.textContent = storyAudioFormatTime(audio.duration);
  });
  range.addEventListener("input", () => {
    if (!audio.duration) return;
    audio.currentTime = (Number(range.value) / 100) * audio.duration;
  });

  storyAudioState.ready = true;
  storyAudioRender();
}

window.openStoryAudioPanel = async function openStoryAudioPanel() {
  await storyAudioBuildPlayer();
  localStorage.setItem("storyAudioPanelOpen", "1");
  storyAudioRender();
};

document.addEventListener("DOMContentLoaded", storyAudioBuildPlayer);

// Optional floating hub navigation helper
document.addEventListener("DOMContentLoaded", async () => {
  // Avoid adding to the hub itself or duplicating
  if (window.location.pathname.includes("project_core.html")) return;
  if (document.getElementById("hub-nav-button")) return;

  const pid = await getProjectId();
  if (!pid) return;

  const params = new URLSearchParams(window.location.search);
  const hubUrl = new URL("project_core.html", window.location.href);
  hubUrl.searchParams.set("id", pid);
  ["sceneId", "characterId", "eventId"].forEach((key) => {
    const val = params.get(key);
    if (val) hubUrl.searchParams.set(key, val);
  });

  const btn = document.createElement("div");
  btn.id = "hub-nav-button";
  btn.textContent = "< Back to Hub";
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    padding: "12px 16px",
    borderRadius: "12px",
    background: "linear-gradient(120deg, #2671f2, #1958ca)",
    color: "#fff",
    fontWeight: "700",
    cursor: "pointer",
    boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
    zIndex: "9999",
    border: "1px solid rgba(255,255,255,0.18)"
  });
  btn.title = "Return to Project Hub";
  btn.onclick = () => {
    window.location.href = hubUrl.toString();
  };

  document.body.appendChild(btn);
});
