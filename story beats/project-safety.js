/**
 * Project Safety Helper
 * This script ensures every page can safely get the current projectId,
 * even if it’s not in the URL, by falling back to:
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

  // 1️⃣ Try URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  projectId = urlParams.get("projectId") || urlParams.get("id");

  // 2️⃣ Try loading from project_config.json if not found in URL
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

  // 3️⃣ Try localStorage
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
async function ensureProjectIdOrRedirect(redirectUrl = "dashboard.html") {
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
