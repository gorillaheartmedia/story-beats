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
