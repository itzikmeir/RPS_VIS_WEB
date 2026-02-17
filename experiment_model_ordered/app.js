// MODEL-ORDERED EXPERIMENT: Model A (Vis1, Vis2, Vis3) → Model B (Vis1, Vis2, Vis3)
// NASA TLX after each Vis, Trust after each Model, Model selection at end.

// Base path for assets (Scenarios, Images, Videos) - parent folder when running from experiment_model_ordered/
const ASSET_BASE = "../";

function assetPath(p) {
  return ASSET_BASE + p;
}

// Model A/B display (no condition index in this format)
function getDisplayModelLetter(modelIndex) {
  const labelsAB = ["A", "B"];
  return labelsAB[modelIndex] || "?";
}

function getDisplayModelName(modelIndex) {
  return `מודל ${getDisplayModelLetter(modelIndex)}`;
}
// Global state
const state = {
  participantId: null,
  schedule: null,
  questionsConfig: null,
  scenarioQuestions: null,
  debugMode: false,

  // phase and page pointers
  stage: "login",
  pageType: null,

  // indices into schedule (Model-ordered: models → visualizations → trials)
  practiceIndex: 0,
  modelIndex: 0,
  visIndex: 0,
  trialIndex: 0,

  // pre-intro page tracking
  preIntroPageIndex: 0,

  currentPageEnterTs: null,
  currentPageName: null,
  
  // Current trial route selection (from iframe)
  currentTrialSelectedRoute: null,
  // Reference to current trial iframe container for cleanup
  currentTrialIframeContainer: null,
  // Temporary storage for workload answers before trust page
  tempWorkloadAnswers: null,

  // log buffers
  logs: {
    pages: [],
    trials: [],
    questionnaires: [],
    interactions: []
  }
};

// Pre-intro page sequence - mapped to questions.json intro_pages
// These will be populated from questionsConfig when loaded
const PRE_INTRO_PAGE_IDS = [
  "ishihara_test",      // Page 1 - Ishihara Color Test
  "invitation_letter",  // Page 2 - Invitation to Participate
  "consent_form",       // Page 3 - Informed Consent Form
  // Removed experiment_explanation_1 (text page) – jump directly to video
  "experiment_video",   // Page 4 - Experiment Explanation (Video)
  "system_layout",      // Page 5 - System Layout
  // Removed helper_explanation (redundant helper view)
  "experiment_flow"     // Page 7 - Experiment Flow Overview
];

// Optional explicit mapping from scenario_id to HTML file names.
// If not present here, we fall back to a simple convention that also
// respects whether the AI recommendation is meant to be correct or inaccurate.
const SCENARIO_FILE_MAP = {
  // Example of explicit overrides (kept for reference):
  // "SCN_001_OPT": "Scenario_2026-01-09_1767940439432_2026-01-09T06-39-52-484Z.html",
};

// Function to get scenario HTML file path.
// First try an explicit mapping, otherwise use:
//   Scenarios/<subfolder>/<scenarioId>.html
// where <subfolder> is either "Correct_Scenarios" or "Inaccurate_Scenarios".
function getScenarioFilePath(scenarioId, baseFolder) {
  const mapped = SCENARIO_FILE_MAP[scenarioId];
  const relPath = mapped ? `${baseFolder}/${mapped}` : `${baseFolder}/${scenarioId}.html`;
  return assetPath(relPath);
}

// Utility functions
function normalizeId(input) {
  let id = input.toUpperCase().trim();
  if (!id.startsWith("P")) {
    id = "P" + id;
  }
  return id;
}

// Convert English route letter to Hebrew route letter
function convertRouteToHebrew(route) {
  if (!route) return route;
  
  const routeStr = String(route).trim().toUpperCase();
  const routeMap = {
    "A": "א׳",
    "B": "ב׳",
    "C": "ג׳"
  };
  
  // If it's already in Hebrew, return as is
  if (routeStr === "א׳" || routeStr === "ב׳" || routeStr === "ג׳") {
    return routeStr;
  }
  
  // Convert English to Hebrew
  return routeMap[routeStr] || route;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Logging functions
function logPageEntry(pageName, metadata = {}) {
  state.currentPageEnterTs = Date.now();
  state.currentPageName = pageName;
  
  state.logs.pages.push({
    page_name: pageName,
    stage: state.stage,
    page_type: state.pageType,
    metadata: metadata,
    enter_ts: state.currentPageEnterTs,
    exit_ts: null
  });
}

function logPageExit(pageName, exitTs = null) {
  const ts = exitTs || Date.now();
  const pageLog = state.logs.pages.find(p => p.page_name === pageName && p.exit_ts === null);
  if (pageLog) {
    pageLog.exit_ts = ts;
  }
}

function downloadLogs() {
  const blob = new Blob([JSON.stringify(state.logs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.participantId}_log.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Data loading
async function loadParticipantSchedule(id) {
  try {
    const url = `participants_json/${id}.json`;
    const res = await fetch(url, { cache: "no-store" });
    
    if (!res.ok) {
      throw new Error(`Cannot load JSON for ${id} (HTTP ${res.status})`);
    }
    
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Error loading participant schedule:", e);
    throw e;
  }
}

async function loadQuestionsConfig() {
  try {
    const url = `questions/questions.json`;
    const res = await fetch(url, { cache: "no-store" });
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json();
    return data;
  } catch (e) {
    return null;
  }
}

async function loadScenarioQuestions() {
  try {
    const url = `questions/scenario_questions.json`;
    const res = await fetch(url, { cache: "no-store" });
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json();
    return data;
  } catch (e) {
    return null;
  }
}

function getScenarioQuestions(scenarioId) {
  if (!state.scenarioQuestions || !state.scenarioQuestions.scenario_questions) {
    return [];
  }
  
  // Filter questions for this scenario and group by question_id (sa_1, sa_2, sa_3)
  const allQuestions = state.scenarioQuestions.scenario_questions.filter(q => q.scenario_id === scenarioId);
  
  // Group by question_id to get sa_1, sa_2, sa_3
  const grouped = {};
  allQuestions.forEach(q => {
    if (!grouped[q.question_id]) {
      grouped[q.question_id] = [];
    }
    grouped[q.question_id].push(q);
  });
  
  // Return in order: sa_1, sa_2, sa_3
  return [
    grouped["sa_1"] ? grouped["sa_1"][0] : null,
    grouped["sa_2"] ? grouped["sa_2"][0] : null,
    grouped["sa_3"] ? grouped["sa_3"][0] : null
  ].filter(q => q !== null);
}

// Get current trial object (Model-ordered: schedule.models[].visualizations[].trials[])
function getCurrentTrial() {
  if (state.stage === "practice") {
    if (!state.schedule.practice || state.practiceIndex >= state.schedule.practice.length) {
      return null;
    }
    return state.schedule.practice[state.practiceIndex];
  } else if (state.stage === "experiment") {
    const model = state.schedule.models[state.modelIndex];
    if (!model) return null;
    const vis = model.visualizations[state.visIndex];
    if (!vis) return null;
    if (state.trialIndex >= vis.trials.length) return null;
    return vis.trials[state.trialIndex];
  }
  return null;
}

// Generate trial key
function getCurrentTrialKey() {
  if (state.stage === "practice") {
    return `${state.participantId}_practice_T${state.practiceIndex}`;
  } else {
    return `${state.participantId}_experiment_M${state.modelIndex}_V${state.visIndex}_T${state.trialIndex}`;
  }
}

// Page renderers
function renderLoginPage(root) {
  logPageEntry("LoginPage");
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Experiment Login";
  root.appendChild(title);
  
  const form = document.createElement("div");
  
  const pidGroup = document.createElement("div");
  pidGroup.className = "form-group";
  
  const pidLabel = document.createElement("label");
  pidLabel.setAttribute("for", "participantId");
  pidLabel.textContent = "Participant ID (e.g., P001):";
  pidGroup.appendChild(pidLabel);
  
  const pidInput = document.createElement("input");
  pidInput.type = "text";
  pidInput.id = "participantId";
  pidInput.placeholder = "P001";
  pidGroup.appendChild(pidInput);
  
  form.appendChild(pidGroup);
  
  const debugGroup = document.createElement("div");
  debugGroup.className = "form-group";
  
  const debugLabel = document.createElement("label");
  const debugCheckbox = document.createElement("input");
  debugCheckbox.type = "checkbox";
  debugCheckbox.id = "debugMode";
  debugLabel.appendChild(debugCheckbox);
  debugLabel.appendChild(document.createTextNode(" Debug mode"));
  debugGroup.appendChild(debugLabel);
  
  form.appendChild(debugGroup);

  // Experiment instructions for the experimenter and participant (Hebrew, multi-line)
  const instructions = document.createElement("div");
  instructions.className = "info-box";
  instructions.dir = "rtl";
  instructions.style.marginTop = "16px";
  instructions.style.whiteSpace = "pre-line";
  instructions.textContent =
    "הניסוי ייקח כשעה.\n" +
    "במהלך הניסוי אין הפסקות ולכן עכשיו זה הזמן להתפנות לשירותים.\n" +
    "ניתן לשתות במהלך הניסוי, ניתן להביא כוס מים מפינת הקפה.\n" +
    "האם מיקום המסך, המקלדת, העכבר וכן גובה הכיסא נוחים לך? כעת זה זמן טוב לסדר את זה.\n" +
    "האם הטמפרטורה מתאימה?.\n" +
    " טלפון מושתק ולא בהישג יד.\n" +
    "האם התאורה מתאימה?.\n" +
    "וודא אודיו (אוזניות) תקין- נסיין.\n" +
    "נסיין- התחל הקלטת מסך.";
  form.appendChild(instructions);
  
  const errorDiv = document.createElement("div");
  errorDiv.id = "loginError";
  errorDiv.className = "error";
  errorDiv.style.display = "none";
  form.appendChild(errorDiv);
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const startBtn = document.createElement("button");
  startBtn.textContent = "Start";
  startBtn.onclick = async () => {
    const rawId = pidInput.value.trim();
    if (!rawId) {
      errorDiv.textContent = "Please enter a participant ID.";
      errorDiv.style.display = "block";
      return;
    }
    
    const id = normalizeId(rawId);
    state.debugMode = debugCheckbox.checked;
    
    startBtn.disabled = true;
    errorDiv.style.display = "none";
    
    try {
      const schedule = await loadParticipantSchedule(id);
      const questionsConfig = await loadQuestionsConfig();
      const scenarioQuestions = await loadScenarioQuestions();
      
      state.participantId = id;
      state.schedule = schedule;
      state.questionsConfig = questionsConfig;
      state.scenarioQuestions = scenarioQuestions;

      // Ensure new practice trials (one extra per visualization) are included
      // If the experimenter added SCN_031_S, SCN_032_R, SCN_033_H files
      // but participant JSON wasn't updated, append lightweight entries so
      // the practice phase will include them.
      try {
        const extraPractice = ["SCN_031_S", "SCN_032_R", "SCN_033_H"];
        if (!state.schedule.practice) state.schedule.practice = [];
        const existingIds = state.schedule.practice.map(p => p.scenario_id);
        extraPractice.forEach((sid) => {
          if (!existingIds.includes(sid)) {
            state.schedule.practice.push({
              slot: state.schedule.practice.length + 1,
              scenario_id: sid,
              difficulty: "E",
              correct_route: null,
              ai_recommended_route: null,
              correct_answers: {}
            });
          }
        });
        // Reorder practice trials so they appear as:
        //  - two stacked-bars (suffix _S)
        //  - two radar (suffix _R)
        //  - two heatmap (suffix _H)
        try {
          const practice = state.schedule.practice || [];
          const groups = { S: [], R: [], H: [], other: [] };
          practice.forEach(p => {
            const sid = (p && p.scenario_id) ? String(p.scenario_id) : "";
            const m = sid.match(/_([SRH])$/i);
            if (m) {
              const k = m[1].toUpperCase();
              if (groups[k]) groups[k].push(p);
              else groups.other.push(p);
            } else {
              groups.other.push(p);
            }
          });

          const newPractice = [];
          newPractice.push(...groups.S.slice(0, 2));
          newPractice.push(...groups.R.slice(0, 2));
          newPractice.push(...groups.H.slice(0, 2));

          // Append any remaining trials that weren't included above
          const included = new Set(newPractice.map(p => p.scenario_id));
          practice.forEach(p => {
            if (!included.has(p.scenario_id)) newPractice.push(p);
          });

          // Renumber slots
          newPractice.forEach((p, idx) => { p.slot = idx + 1; });
          state.schedule.practice = newPractice;
        } catch (re) {
          console.warn('Could not reorder practice trials', re);
        }
      } catch (err) {
        // non-fatal — proceed without modifying schedule
        console.warn('Could not append extra practice scenarios', err);
      }
      
      logPageExit("LoginPage");
      state.stage = "pre";
      state.pageType = "info";
      state.preIntroPageIndex = 0;
      render();
    } catch (e) {
      errorDiv.textContent = e.message || "Error loading participant data. Please check the ID and try again.";
      errorDiv.style.display = "block";
      startBtn.disabled = false;
    }
  };
  
  buttonGroup.appendChild(startBtn);
  form.appendChild(buttonGroup);
  
  root.appendChild(form);
  
  pidInput.addEventListener("keyup", (ev) => {
    if (ev.key === "Enter") {
      startBtn.click();
    }
  });
}

function renderInfoPage(root, pageId) {
  const pageName = `IntroPage_${pageId}`;
  logPageEntry(pageName, { page_id: pageId });
  
  root.innerHTML = "";
  
  // Get page data from questionsConfig
  let pageData = null;
  if (state.questionsConfig && state.questionsConfig.intro_pages) {
    pageData = state.questionsConfig.intro_pages.find(p => p.id === pageId);
  }
  
  // Fallback if questionsConfig not loaded
  if (!pageData) {
    const fallbackTitles = {
      "ishihara_test": "מבחן צבעים",
      "invitation_letter": "בקשה להשתתפותך במחקר",
      "consent_form": "הסכמה מדעת",
      "experiment_explanation_1": "הסבר על הניסוי",
      "experiment_video": "הסבר על הניסוי",
      "system_layout": "תצוגת המערכת",
      "system_criteria": "תצוגת שיקולי המערכת",
      "helper_explanation": "עזר תצוגת שיקולי מערכת",
      "experiment_flow": "מהלך הניסוי"
    };
    pageData = {
      id: pageId,
      title: fallbackTitles[pageId] || "Introduction Page",
      text: "Content will be loaded from questions.json",
      input_type: "none",
      media: null
    };
  }
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = pageData.title;
  title.dir = "rtl";
  root.appendChild(title);
 
  // Render text content
  if (pageId === "invitation_letter") {
    // Custom rendering to show bullet points for the numbered section
    const text = pageData.text || "";
    const lines = text.split("\n");

    const content = document.createElement("div");
    content.className = "page-content";
    content.dir = "rtl";

    const introLines = [];
    const bulletLines = [];
    const footerLines = [];
    let section = "intro";
    let bulletsHeading = null;

    for (const rawLine of lines) {
      const line = rawLine;
      const trimmed = line.trim();
      if (section === "intro") {
        if (trimmed === "מספר דגשים:") {
          bulletsHeading = line;
          section = "bullets";
        } else {
          if (trimmed !== "") {
            introLines.push(line);
          }
        }
      } else if (section === "bullets") {
        if (trimmed === "") {
          section = "footer";
        } else {
          bulletLines.push(line);
        }
      } else {
        if (trimmed !== "") {
          footerLines.push(line);
        }
      }
    }

    // Intro paragraphs
    introLines.forEach((line) => {
      const p = document.createElement("p");
      p.textContent = line;
      p.style.marginBottom = "8px";
      content.appendChild(p);
    });

    // Bullets heading
    if (bulletsHeading) {
      const headingP = document.createElement("p");
      headingP.textContent = bulletsHeading;
      headingP.style.marginBottom = "4px";
      headingP.style.fontWeight = "700";
      content.appendChild(headingP);
    }

    // Bullet list
    if (bulletLines.length > 0) {
      const ul = document.createElement("ul");
      ul.dir = "rtl";
      ul.style.marginTop = "0";
      bulletLines.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        li.style.marginBottom = "4px";
        ul.appendChild(li);
      });
      content.appendChild(ul);
    }

    // Footer paragraphs
    footerLines.forEach((line) => {
      const p = document.createElement("p");
      p.textContent = line;
      p.style.marginTop = "8px";
      content.appendChild(p);
    });

    root.appendChild(content);

    // Extra emphasized reward line at the end (last bullet-like line, but bold)
    const reward = document.createElement("div");
    reward.className = "page-content";
    reward.dir = "rtl";
    reward.style.whiteSpace = "pre-wrap";
    reward.style.marginTop = "16px";
    reward.style.fontWeight = "700";
    reward.textContent = "כאות תודה על ההשתתפות, תקבל/י 70 ₪ עבור השלמת הניסוי.";
    root.appendChild(reward);
  } else {
    const content = document.createElement("div");
    content.className = "page-content";
    content.textContent = pageData.text || "";
    content.dir = "rtl";
    content.style.whiteSpace = "pre-wrap";
    // If there's no text for this page (common for the video page),
    // remove the default bottom margin so media sits directly below the title.
    if (!pageData.text || String(pageData.text).trim() === "") {
      content.style.marginBottom = "0";
    }
    root.appendChild(content);
  }

  // Extra emphasized warning at the end of experiment_flow page
  if (pageId === "experiment_flow") {
    const warning = document.createElement("div");
    warning.className = "page-content";
    warning.dir = "rtl";
    warning.style.whiteSpace = "pre-wrap";
    warning.style.marginTop = "16px";
    warning.style.fontWeight = "700";
    warning.textContent =
      "בלחיצה על \"המשך לתרגול\" תעבור ישירות לתרחיש התרגול ללא יכולת להפסיק את הניסוי משלב זה.\n\nבהצלחה";
    root.appendChild(warning);
  }
  // Insert a dedicated media slot so all media (images, video, iframe)
  // appear immediately after the page content and before inputs/buttons.
  const mediaSlot = document.createElement("div");
  mediaSlot.id = `mediaSlot_${pageId}`;
  mediaSlot.style.margin = "8px 0";
  // For the experiment video page, show a short instruction above the media
  if (pageId === "experiment_video") {
    const instr = document.createElement("p");
    instr.className = "page-content video-instr";
    instr.dir = "rtl";
    instr.style.marginTop = "2px";
    instr.style.marginBottom = "6px";
    root.appendChild(instr);
  }
  root.appendChild(mediaSlot);
  
  // Render media if present (skip YouTube for the experiment video page
  // because we prefer loading a local file first and will fallback to
  // the configured media if the local file fails).
  if (pageData.media && !(pageId === "experiment_video" && pageData.media.type === "youtube")) {
    const mediaContainer = document.createElement("div");
    mediaContainer.style.margin = "8px 0";
    mediaContainer.style.display = "flex";
    mediaContainer.style.justifyContent = "center";
    mediaContainer.style.alignItems = "center";
    
    if (pageData.media.type === "image") {
      // Show actual image for specific pages (color test, system layout, system criteria), placeholder for others
        if ((pageId === "ishihara_test" || pageId === "system_layout" || pageId === "system_criteria") && pageData.media.src) {
        const img = document.createElement("img");
        img.src = assetPath(pageData.media.src);
        img.alt =
          pageId === "ishihara_test"
            ? "Ishihara Color Test"
            : (pageId === "system_layout" ? "System Layout" : "System Criteria");
        img.style.maxWidth = "80%";
        img.style.height = "auto";
        img.style.borderRadius = "8px";
        img.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
        mediaContainer.appendChild(img);
      } else {
        // Show placeholder box for other images
        const placeholder = document.createElement("div");
        placeholder.className = "iframe-placeholder";
        placeholder.textContent = `IMAGE PLACEHOLDER: ${pageId}`;
        placeholder.style.display = "flex";
        placeholder.style.alignItems = "center";
        placeholder.style.justifyContent = "center";
        mediaContainer.appendChild(placeholder);
      }
    } else if (pageData.media.type === "youtube") {
      const videoContainer = document.createElement("div");
      videoContainer.style.position = "relative";
      videoContainer.style.paddingBottom = "56.25%"; // 16:9 aspect ratio
      videoContainer.style.height = "0";
      videoContainer.style.overflow = "hidden";
      
      const iframe = document.createElement("iframe");
      const videoId = extractYouTubeId(pageData.media.src);
      if (videoId) {
        iframe.src = `https://www.youtube.com/embed/${videoId}`;
        iframe.style.position = "absolute";
        iframe.style.top = "0";
        iframe.style.left = "0";
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.frameBorder = "0";
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        iframe.allowFullscreen = true;
        videoContainer.appendChild(iframe);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "iframe-placeholder";
        placeholder.textContent = `YOUTUBE PLACEHOLDER: ${pageData.media.src}`;
        videoContainer.appendChild(placeholder);
      }
      
      mediaContainer.appendChild(videoContainer);
    }
    
    mediaSlot.appendChild(mediaContainer);
  }

  // For the experiment video page, prefer a local video file but
  // fall back to the configured media (e.g., YouTube) if the local file fails to load.
  if (pageId === "experiment_video") {
    const mediaContainer = document.createElement("div");
    mediaContainer.style.margin = "8px 0";
    mediaContainer.style.display = "flex";
    mediaContainer.style.justifyContent = "center";
    mediaContainer.style.alignItems = "center";

    const videoWrapper = document.createElement("div");
    videoWrapper.className = "video-wrapper";

    const video = document.createElement("video");
    video.id = "experimentVideo";
    video.controls = true;
    // Autoplay muted so browsers allow automatic playback on page load
    video.autoplay = true;
    video.muted = true;
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.playsInline = true;
    video.preload = "metadata";
    video.style.width = "100%";
    video.style.height = "auto";
    video.style.display = "block";

    const source = document.createElement("source");
    source.src = assetPath("Videos/Introduction.mp4");
    source.type = "video/mp4";
    video.appendChild(source);

    // If the local video fails to load, fall back to pageData.media (youtube or placeholder)
    let handled = false;
    function fallbackToConfiguredMedia() {
      if (handled) return;
      handled = true;
      // remove video wrapper
      if (videoWrapper.parentNode) videoWrapper.parentNode.removeChild(videoWrapper);

      // If there's a configured media and it's YouTube, embed it
      if (pageData && pageData.media && pageData.media.type === "youtube") {
        const videoContainer = document.createElement("div");
        videoContainer.style.position = "relative";
        videoContainer.style.paddingBottom = "56.25%";
        videoContainer.style.height = "0";
        videoContainer.style.overflow = "hidden";

        const iframe = document.createElement("iframe");
        const videoId = extractYouTubeId(pageData.media.src);
        if (videoId) {
          iframe.src = `https://www.youtube.com/embed/${videoId}`;
          iframe.style.position = "absolute";
          iframe.style.top = "0";
          iframe.style.left = "0";
          iframe.style.width = "100%";
          iframe.style.height = "100%";
          iframe.frameBorder = "0";
          iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
          iframe.allowFullscreen = true;
          videoContainer.appendChild(iframe);
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "iframe-placeholder";
          placeholder.textContent = `VIDEO PLACEHOLDER: ${pageData.media.src}`;
          videoContainer.appendChild(placeholder);
        }

        mediaContainer.appendChild(videoContainer);
        mediaSlot.appendChild(mediaContainer);
        return;
      }

      // Otherwise show placeholder indicating missing local file
      const placeholder = document.createElement("div");
      placeholder.className = "iframe-placeholder";
      placeholder.textContent = "וידאו לא נמצא (../Videos/Introduction.mp4)";
      mediaContainer.appendChild(placeholder);
      mediaSlot.appendChild(mediaContainer);
    }

    // If loadedmetadata fires, assume file exists and show video
    video.addEventListener("loadedmetadata", () => {
      if (handled) return;
      handled = true;
      videoWrapper.appendChild(video);
      mediaContainer.appendChild(videoWrapper);
      mediaSlot.appendChild(mediaContainer);
    });

    // On error, fallback
    video.addEventListener("error", () => {
      fallbackToConfiguredMedia();
    });

    // Start by attempting to load the local video (append but hidden until loaded)
    // Append to DOM so browser attempts to load resource.
    videoWrapper.appendChild(video);
    mediaContainer.appendChild(videoWrapper);
    mediaSlot.appendChild(mediaContainer);

    // As a safety: if neither loadedmetadata nor error triggers within 2s, fallback
    setTimeout(() => {
      if (!handled) {
        fallbackToConfiguredMedia();
      }
    }, 2000);
  }
  
  // Render input based on input_type
  const inputContainer = document.createElement("div");
  inputContainer.className = "form-group";
  inputContainer.style.marginTop = "20px";
  
  if (pageData.input_type === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.id = `input_${pageId}`;
    input.style.width = "100%";
    input.style.padding = "10px";
    input.style.fontSize = "14px";
    input.style.borderRadius = "6px";
    input.style.border = "1px solid #ccc";
    input.dir = "rtl";
    inputContainer.appendChild(input);
  } else if (pageData.input_type === "checkbox") {
    // Special handling for consent_form page
    if (pageId === "consent_form") {
      // Create form fields for name, ID, and email
      const formFields = [
        { id: "consent_name", label: "שם:", type: "text", required: true, validation: (val) => val.trim().length > 0, errorMsg: "אנא הזן שם" },
        { id: "consent_id", label: "ת\"ז:", type: "text", required: true, validation: (val) => /^\d{9}$/.test(val.trim()), errorMsg: "אנא הזן ת\"ז תקין (9 ספרות)" },
        { id: "consent_email", label: "כתובת / דואר אלקטרוני:", type: "text", required: true, validation: (val) => val.includes("@"), errorMsg: "אנא הזן כתובת תקינה (חייבת להכיל @)" }
      ];
      
      formFields.forEach(field => {
        const fieldWrapper = document.createElement("div");
        fieldWrapper.style.marginBottom = "15px";
        fieldWrapper.dir = "rtl";
        
        const fieldLabel = document.createElement("label");
        fieldLabel.textContent = field.label;
        fieldLabel.style.display = "block";
        fieldLabel.style.marginBottom = "5px";
        fieldLabel.style.fontWeight = "600";
        fieldLabel.setAttribute("for", field.id);
        fieldWrapper.appendChild(fieldLabel);
        
        const fieldInput = document.createElement("input");
        fieldInput.type = field.type;
        fieldInput.id = field.id;
        fieldInput.name = field.id;
        fieldInput.style.width = "100%";
        fieldInput.style.padding = "10px";
        fieldInput.style.fontSize = "14px";
        fieldInput.style.borderRadius = "6px";
        fieldInput.style.border = "1px solid #ccc";
        fieldInput.dir = "rtl";
        fieldInput.required = field.required && !state.debugMode;
        fieldWrapper.appendChild(fieldInput);
        
        inputContainer.appendChild(fieldWrapper);
      });
      
      // Also add the consent checkbox
      const checkboxWrapper = document.createElement("div");
      checkboxWrapper.style.display = "flex";
      checkboxWrapper.style.flexDirection = "row";
      checkboxWrapper.style.alignItems = "center";
      checkboxWrapper.style.gap = "8px";
      checkboxWrapper.style.marginTop = "15px";
      checkboxWrapper.dir = "rtl";
      
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `input_${pageId}`;
      checkbox.required = !state.debugMode;
      const label = document.createElement("label");
      label.setAttribute("for", `input_${pageId}`);
      label.textContent = "אני מאשר/ת";
      label.dir = "rtl";
      label.style.marginRight = "0";
      label.style.cursor = "pointer";
      checkboxWrapper.appendChild(checkbox);
      checkboxWrapper.appendChild(label);
      inputContainer.appendChild(checkboxWrapper);
    } else {
      // Regular checkbox for other pages
      inputContainer.style.display = "flex";
      inputContainer.style.flexDirection = "row";
      inputContainer.style.alignItems = "center";
      inputContainer.style.gap = "8px";
      inputContainer.dir = "rtl";
      
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `input_${pageId}`;
      const label = document.createElement("label");
      label.setAttribute("for", `input_${pageId}`);
      label.textContent = "אני מאשר/ת";
      label.dir = "rtl";
      label.style.marginRight = "0";
      label.style.cursor = "pointer";
      inputContainer.appendChild(checkbox);
      inputContainer.appendChild(label);
    }
  } else if (pageData.input_type === "checkbox_list") {
    // Show checkboxes for פריט 1-5 (or custom labels for specific pages)
    let labels = null;
    if (pageId === "system_layout") {
      labels = [
        "1. פאנל פירוט המטלה ואישור הבחירה.",
        "2. מפה וכלי מפה.",
        "3. גרף זמני המקטעים ובחירת מסלול.",
        "4. ויזואליזציה (משתנה) של פירוט המקטעים במסלול הבחור.",
        "5. מקרא ויזואליזציה."
      ];
    }

    for (let i = 1; i <= 5; i++) {
      const checkboxWrapper = document.createElement("div");
      checkboxWrapper.style.marginBottom = "10px";
      checkboxWrapper.style.display = "flex";
      checkboxWrapper.style.flexDirection = "row";
      checkboxWrapper.style.alignItems = "center";
      checkboxWrapper.style.gap = "8px";
      checkboxWrapper.dir = "rtl";
      
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `input_${pageId}_item${i}`;
      checkbox.name = `checkbox_list_${pageId}`;
      checkbox.required = !state.debugMode;
      
      const label = document.createElement("label");
      label.setAttribute("for", `input_${pageId}_item${i}`);
      if (labels && labels[i - 1]) {
        label.textContent = labels[i - 1];
      } else {
        label.textContent = `פריט ${i}`;
      }
      label.dir = "rtl";
      label.style.marginRight = "0";
      label.style.cursor = "pointer";
      
      checkboxWrapper.appendChild(checkbox);
      checkboxWrapper.appendChild(label);
      inputContainer.appendChild(checkboxWrapper);
    }
  }
  
  if (pageData.input_type !== "none") {
    root.appendChild(inputContainer);
  }
  
  // Navigation buttons
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  buttonGroup.style.display = "flex";
  buttonGroup.style.justifyContent = "space-between";
  buttonGroup.style.gap = "12px";
  buttonGroup.style.flexDirection = "row-reverse"; // Back on right, continue on left
  
  if (state.preIntroPageIndex > 0) {
    const backBtn = document.createElement("button");
    backBtn.textContent = "חזור";
    backBtn.dir = "rtl";
    // Style back button as secondary (gray)
    backBtn.style.backgroundColor = "#6b7280"; // gray
    backBtn.style.borderColor = "#6b7280";
    backBtn.style.color = "#ffffff";
    backBtn.onclick = () => {
      logPageExit(pageName);
      state.preIntroPageIndex--;
      render();
    };
    buttonGroup.appendChild(backBtn);
  }
  
  const nextBtn = document.createElement("button");
  nextBtn.textContent = state.preIntroPageIndex < PRE_INTRO_PAGE_IDS.length - 1 ? "המשך" : "המשך לתרגול";
  // If this is the experiment video page, disable the continue button until
  // the local video finishes playing (or a fallback media is loaded).
  if (pageId === "experiment_video") {
    nextBtn.disabled = true;
    nextBtn.setAttribute('aria-disabled', 'true');
    const enableNext = () => {
      try {
        nextBtn.disabled = false;
        nextBtn.removeAttribute('aria-disabled');
      } catch (e) {}
    };

    const mediaSlotEl = document.getElementById(`mediaSlot_${pageId}`);

    // If video already present, attach ended listener
    const attachToExistingVideo = () => {
      const v = document.getElementById("experimentVideo");
      if (v) {
        v.addEventListener("ended", enableNext);
        v.addEventListener("error", enableNext);
        // If video is already ended (unlikely) or readyState indicates ended, enable
        if (v.ended) enableNext();
        return true;
      }
      return false;
    };

    if (!attachToExistingVideo() && mediaSlotEl) {
      // Observe mediaSlot for additions (video / iframe / placeholder)
      const mo = new MutationObserver((mutations, observer) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            // If a video element appears, attach ended listener
            if (node.id === "experimentVideo" || (node.querySelector && node.querySelector('#experimentVideo'))) {
              attachToExistingVideo();
              observer.disconnect();
              return;
            }
            // If an iframe or placeholder is added (fallback), enable next immediately
            if (node.tagName === 'IFRAME' || (node.classList && node.classList.contains('iframe-placeholder'))) {
              enableNext();
              observer.disconnect();
              return;
            }
            // Also check subtree for iframe
            if (node.querySelector && node.querySelector('iframe')) {
              enableNext();
              observer.disconnect();
              return;
            }
          }
        }
      });
      mo.observe(mediaSlotEl, { childList: true, subtree: true });
      // Safety timeout: if nothing happens after 5s, enable button to avoid blocking
      setTimeout(() => { enableNext(); mo.disconnect(); }, 5000);
    }
  }

  // For the system_layout page, require all checkbox items be checked
  // before enabling the continue button.
  if (pageId === "system_layout") {
    nextBtn.disabled = true;
    nextBtn.setAttribute('aria-disabled', 'true');

    const updateSystemLayoutNext = () => {
      let allChecked = true;
      for (let i = 1; i <= 5; i++) {
        const cb = document.getElementById(`input_${pageId}_item${i}`);
        if (!cb || !cb.checked) { allChecked = false; break; }
      }
      if (allChecked) {
        nextBtn.disabled = false;
        nextBtn.removeAttribute('aria-disabled');
      } else {
        nextBtn.disabled = true;
        nextBtn.setAttribute('aria-disabled', 'true');
      }
    };

    // Attach listeners to existing checkboxes or observe for their addition
    for (let i = 1; i <= 5; i++) {
      const id = `input_${pageId}_item${i}`;
      const cb = document.getElementById(id);
      if (cb) {
        cb.addEventListener('change', updateSystemLayoutNext);
      } else {
        const mo = new MutationObserver((mutations, observer) => {
          const el = document.getElementById(id);
          if (el) {
            el.addEventListener('change', updateSystemLayoutNext);
            observer.disconnect();
          }
        });
        mo.observe(root, { childList: true, subtree: true });
      }
    }

    // Run an initial check (in case checkboxes are pre-checked)
    setTimeout(updateSystemLayoutNext, 0);
  }
  nextBtn.onclick = () => {
    // Validate input if required (skip in debug mode)
    if (!state.debugMode) {
      if (pageData.input_type === "text") {
        const input = document.getElementById(`input_${pageId}`);
        if (!input || !input.value.trim()) {
          alert("אנא מלא את השדה הנדרש");
          return;
        }
        
        // Special validation for color test page
        if (pageId === "ishihara_test" && pageData.correct_answer) {
          const userAnswer = input.value.trim();
          const correctAnswer = pageData.correct_answer.trim();
          if (userAnswer !== correctAnswer) {
            alert("המספר שכתבת שגוי. אנא נסה שוב.");
            return;
          }
        }
      } else if (pageData.input_type === "checkbox") {
        if (pageId === "consent_form") {
          // Validate consent form fields
          const nameInput = document.getElementById("consent_name");
          const idInput = document.getElementById("consent_id");
          const emailInput = document.getElementById("consent_email");
          const checkbox = document.getElementById(`input_${pageId}`);
          
          if (!nameInput || !nameInput.value.trim()) {
            alert("אנא הזן שם");
            return;
          }
          
          if (!idInput || !/^\d{9}$/.test(idInput.value.trim())) {
            alert("אנא הזן ת\"ז תקין (9 ספרות)");
            return;
          }
          
          if (!emailInput || !emailInput.value.includes("@")) {
            alert("אנא הזן כתובת תקינה (חייבת להכיל @)");
            return;
          }
          
          if (!checkbox || !checkbox.checked) {
            alert("אנא סמן את תיבת הסימון");
            return;
          }
        } else {
          const checkbox = document.getElementById(`input_${pageId}`);
          if (!checkbox || !checkbox.checked) {
            alert("אנא סמן את תיבת הסימון");
            return;
          }
        }
      } else if (pageData.input_type === "checkbox_list") {
        // Validate ALL checkboxes are checked (for system_layout page)
        if (pageId === "system_layout") {
          let allChecked = true;
          for (let i = 1; i <= 5; i++) {
            const checkbox = document.getElementById(`input_${pageId}_item${i}`);
            if (!checkbox || !checkbox.checked) {
              allChecked = false;
              break;
            }
          }
          if (!allChecked) {
            alert("אנא סמן את כל הפריטים");
            return;
          }
        } else {
          // For other checkbox_list pages, validate at least one is checked
          let atLeastOneChecked = false;
          for (let i = 1; i <= 5; i++) {
            const checkbox = document.getElementById(`input_${pageId}_item${i}`);
            if (checkbox && checkbox.checked) {
              atLeastOneChecked = true;
              break;
            }
          }
          if (!atLeastOneChecked) {
            alert("אנא סמן לפחות פריט אחד");
            return;
          }
        }
      }
    }
    
    // Collect and log input data
    if (pageId === "consent_form" && pageData.input_type === "checkbox") {
      const nameInput = document.getElementById("consent_name");
      const idInput = document.getElementById("consent_id");
      const emailInput = document.getElementById("consent_email");
      const checkbox = document.getElementById(`input_${pageId}`);
      
      const consentData = {
        name: nameInput ? nameInput.value.trim() : (state.debugMode ? "DBG" : null),
        id_number: idInput ? idInput.value.trim() : (state.debugMode ? "DBG" : null),
        email: emailInput ? emailInput.value.trim() : (state.debugMode ? "DBG" : null),
        consent_checked: checkbox ? checkbox.checked : false
      };
      
      // Log consent data to interactions or pages log
      state.logs.interactions.push({
        page_name: pageName,
        interaction_type: "consent_form_data",
        data: consentData,
        timestamp: Date.now()
      });
    } else if (pageId === "system_layout" && pageData.input_type === "checkbox_list") {
      // Log which items were checked
      const checkedItems = [];
      for (let i = 1; i <= 5; i++) {
        const checkbox = document.getElementById(`input_${pageId}_item${i}`);
        if (checkbox && checkbox.checked) {
          checkedItems.push(i);
        }
      }
      
      state.logs.interactions.push({
        page_name: pageName,
        interaction_type: "system_layout_items",
        data: {
          checked_items: checkedItems,
          all_checked: checkedItems.length === 5
        },
        timestamp: Date.now()
      });
    }
    
    logPageExit(pageName);
    if (state.preIntroPageIndex < PRE_INTRO_PAGE_IDS.length - 1) {
      state.preIntroPageIndex++;
      render();
    } else {
      // Skip standalone practice intro page – go directly to scenario intro
      state.stage = "practice";
      state.pageType = "scenario_intro";
      state.practiceIndex = 0;
      render();
    }
  };
  buttonGroup.appendChild(nextBtn);
  
  root.appendChild(buttonGroup);
}

function extractYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function renderPracticeIntroPage(root) {
  logPageEntry("PracticeIntroPage");
  
  root.innerHTML = "";
  
  // Get practice intro data from questionsConfig
  let pageData = null;
  if (state.questionsConfig && state.questionsConfig.practice_intro) {
    pageData = state.questionsConfig.practice_intro;
  }
  
  // Fallback
  if (!pageData) {
    pageData = {
      title: "התחלת תרגול",
      text: "כעת יוצג לפניך תרחיש תרגול במערכת. בחר/י את המסלול האופטימלי ביותר לפי הבנתך, ולאחר מכן תענה/י על מספר שאלות קצרות."
    };
  }
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = pageData.title;
  title.dir = "rtl";
  root.appendChild(title);
  
  const content = document.createElement("div");
  content.className = "page-content";
  content.textContent = pageData.text;
  content.dir = "rtl";
  content.style.whiteSpace = "pre-wrap";
  root.appendChild(content);
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const startBtn = document.createElement("button");
  startBtn.textContent = "התחל תרגול";
  startBtn.onclick = () => {
    logPageExit("PracticeIntroPage");
    // Show scenario intro before first practice trial
    state.stage = "practice";
    state.pageType = "scenario_intro";
    state.practiceIndex = 0;
    render();
  };
  buttonGroup.appendChild(startBtn);
  
  root.appendChild(buttonGroup);
}

function renderScenarioIntroPage(root) {
  logPageEntry("ScenarioIntroPage");
  
  root.innerHTML = "";

  // --- Practice-specific scenario intro (6 practices: 2 stacked, 2 radar, 2 heatmap) ---
  if (state.stage === "practice") {
    const t = getCurrentTrial();
    const scenarioId = (t && t.scenario_id) ? String(t.scenario_id) : "";
    const suffixMatch = scenarioId.match(/_([SRH])$/i);
    const vizSuffix = suffixMatch ? suffixMatch[1].toUpperCase() : "";

    let titleText = "התחלת תרחיש";
    let imageSrc = null;
    let imageAlt = null;
    let vizLabel = "";

    if (vizSuffix === "S") {
      vizLabel = "עמודות נערמות";
      titleText = `תרגול ${state.practiceIndex + 1} – ${vizLabel}`;
      imageSrc = assetPath("Images/STACKED.png");
      imageAlt = "Stacked visualization";
    } else if (vizSuffix === "R") {
      vizLabel = "רדאר";
      titleText = `תרגול ${state.practiceIndex + 1} – ${vizLabel}`;
      imageSrc = assetPath("Images/RADAR.png");
      imageAlt = "Radar visualization";
    } else if (vizSuffix === "H") {
      vizLabel = "מפת חום";
      titleText = `תרגול ${state.practiceIndex + 1} – ${vizLabel}`;
      imageSrc = assetPath("Images/HEATֹMAP.png");
      imageAlt = "Heatmap visualization";
    } else {
      titleText = `תרגול ${state.practiceIndex + 1}`;
    }

    const title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = titleText;
    title.dir = "rtl";
    root.appendChild(title);

    const content = document.createElement("div");
    content.className = "page-content";
    content.dir = "rtl";
    content.style.whiteSpace = "pre-wrap";

    // Intro lines
    const pIntro = document.createElement("p");
    pIntro.textContent = "בלחיצה על המשך יופיע תרחיש במסך מערכת תכנון הנסיעה הכולל:";
    content.appendChild(pIntro);

    // Bullet list for routes + visualization
    const introList = document.createElement("ul");
    introList.style.marginTop = "4px";
    introList.style.paddingRight = "20px";

    const introLiRoutes = document.createElement("li");
    introLiRoutes.textContent = "שימוש בבינה מלאכותית";
    introList.appendChild(introLiRoutes);

    const introLiViz = document.createElement("li");
    introLiViz.textContent = `ויזואליזציה ${vizLabel}`;
    introList.appendChild(introLiViz);

    content.appendChild(introList);

    // Emphasized bullets under "דגשים:"
    const tipsHeading = document.createElement("p");
    tipsHeading.textContent = "דגשים:";
    tipsHeading.style.marginTop = "12px";
    tipsHeading.style.fontWeight = "700";
    content.appendChild(tipsHeading);

    const tipsList = document.createElement("ul");
    tipsList.style.marginTop = "4px";
    tipsList.style.paddingRight = "20px";

    const tip1 = document.createElement("li");
    tip1.textContent = "בצע את המטלה במהירות";
    tipsList.appendChild(tip1);

    const tip2 = document.createElement("li");
    tip2.textContent = "הקפד/י לבצע השוואה בין כל המסלולים";
    tipsList.appendChild(tip2);

    const tip3 = document.createElement("li");
    tip3.textContent = "וודא שבחירתך עומדת בדרישות המטלה לפני אישור";
    tipsList.appendChild(tip3);

    content.appendChild(tipsList);
    root.appendChild(content);

    if (imageSrc) {
      const imgContainer = document.createElement("div");
      imgContainer.style.margin = "20px 0";
      imgContainer.style.display = "flex";
      imgContainer.style.justifyContent = "center";
      imgContainer.style.alignItems = "center";

      const img = document.createElement("img");
      img.src = imageSrc;
      img.alt = imageAlt || titleText;
      img.style.maxWidth = "90%";
      img.style.height = "auto";
      img.style.borderRadius = "8px";
      img.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";

      imgContainer.appendChild(img);
      root.appendChild(imgContainer);
    }

    const buttonGroup = document.createElement("div");
    buttonGroup.className = "button-group";

    const continueBtn = document.createElement("button");
    continueBtn.textContent = "המשך";
    continueBtn.onclick = () => {
      logPageExit("ScenarioIntroPage");
      state.pageType = "trial";
      render();
    };
    buttonGroup.appendChild(continueBtn);

    root.appendChild(buttonGroup);
    return;
  }

  // --- Default scenario intro (experiment stage) ---
  const model = state.schedule.models[state.modelIndex];
  const vis = model.visualizations[state.visIndex];
  const displayModelName = getDisplayModelName(state.modelIndex);

  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "התחלת תרחיש";
  title.dir = "rtl";
  root.appendChild(title);

  const content = document.createElement("div");
  content.className = "page-content";
  content.dir = "rtl";
  content.style.whiteSpace = "pre-wrap";
  // Intro lines
  const pIntro = document.createElement("p");
  pIntro.textContent = "בלחיצה על המשך יופיע תרחיש במסך מערכת תכנון הנסיעה הכולל:";
  content.appendChild(pIntro);

  // Bullet list for routes + visualization
  const introList = document.createElement("ul");
  introList.style.marginTop = "4px";
  introList.style.paddingRight = "20px";

  const introLiRoutes = document.createElement("li");
  introLiRoutes.textContent = `שימוש בבינה מלאכותית מסוג \"${displayModelName}\"`;
  introList.appendChild(introLiRoutes);

  const introLiViz = document.createElement("li");
  introLiViz.textContent = `ויזואליזציה ${vis.visualization || ""}`;
  introList.appendChild(introLiViz);

  content.appendChild(introList);

  // Emphasized bullets under "דגשים:"
  const tipsHeading = document.createElement("p");
  tipsHeading.textContent = "דגשים:";
  tipsHeading.style.marginTop = "12px";
  tipsHeading.style.fontWeight = "700";
  content.appendChild(tipsHeading);

  const tipsList = document.createElement("ul");
  tipsList.style.marginTop = "4px";
  tipsList.style.paddingRight = "20px";

  const tip1 = document.createElement("li");
  tip1.textContent = "בצע את המטלה במהירות";
  tipsList.appendChild(tip1);

  const tip2 = document.createElement("li");
  tip2.textContent = "הקפד/י לבצע השוואה בין כל המסלולים";
  tipsList.appendChild(tip2);

  const tip3 = document.createElement("li");
  tip3.textContent = "וודא שבחירתך עומדת בדרישות המטלה לפני אישור";
  tipsList.appendChild(tip3);

  content.appendChild(tipsList);
  root.appendChild(content);

  // Visualization image reminder below text and above buttons
  let imageSrc = null;
  let imageAlt = null;
  if (vis.visualization === "עמודות נערמות" || vis.visualization === "עמודות מוערמות") {
    imageSrc = assetPath("Images/STACKED.png");
    imageAlt = "Stacked visualization";
  } else if (vis.visualization === "רדאר") {
    imageSrc = assetPath("Images/RADAR.png");
    imageAlt = "Radar visualization";
  } else if (vis.visualization === "מפת חום") {
    imageSrc = assetPath("Images/HEATֹMAP.png");
    imageAlt = "Heatmap visualization";
  }

  if (imageSrc) {
    const imgContainer = document.createElement("div");
    imgContainer.style.margin = "20px 0";
    imgContainer.style.display = "flex";
    imgContainer.style.justifyContent = "center";
    imgContainer.style.alignItems = "center";

    const img = document.createElement("img");
    img.src = imageSrc;
    img.alt = imageAlt || vis.visualization;
    img.style.maxWidth = "90%";
    img.style.height = "auto";
    img.style.borderRadius = "8px";
    img.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";

    imgContainer.appendChild(img);
    root.appendChild(imgContainer);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    logPageExit("ScenarioIntroPage");
    state.pageType = "trial";
    render();
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderTrialPage(root) {
  const t = getCurrentTrial();
  if (!t) {
    // No more trials, navigate to next stage
    if (state.stage === "practice") {
      state.stage = "experiment";
      state.pageType = "experiment_transition";
      state.modelIndex = 0;
      state.visIndex = 0;
      render();
      return;
    } else {
      // Should not happen, but handle gracefully
      render();
      return;
    }
  }
  
  logPageEntry("TrialPage", {
    scenario_id: t.scenario_id,
    stage: state.stage
  });
  
  root.innerHTML = "";
  
  // Clean up any existing fullscreen iframe containers
  const existingContainers = document.querySelectorAll('[id^="scenario-iframe-container"]');
  existingContainers.forEach(container => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });
  
  // Reset selected route and iframe container reference for this trial
  state.currentTrialSelectedRoute = null;
  state.currentTrialIframeContainer = null;
  
  // Show title and info boxes only in debug mode AND practice stage (hide in real experiment)
  if (state.debugMode && state.stage === "practice") {
    let titleText;
    if (state.stage === "practice") {
      titleText = `Trial – Practice #${state.practiceIndex + 1}`;
    } else {
      const model = state.schedule.models[state.modelIndex];
      const vis = model.visualizations[state.visIndex];
      titleText = `Trial – Model ${state.modelIndex + 1} (${vis.visualization}) Trial ${state.trialIndex + 1}`;
    }
    
    const title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = titleText;
    root.appendChild(title);
    
    const infoBox = document.createElement("div");
    infoBox.className = "info-box";
    
    const infoTitle = document.createElement("h3");
    infoTitle.textContent = "Trial Information";
    infoBox.appendChild(infoTitle);
    
    const infoItems = [
      ["Participant ID", state.participantId],
      ["Stage", state.stage],
      ["Scenario ID", t.scenario_id],
      ["Difficulty", t.difficulty],
      ["Correct Route", t.correct_route],
      ["AI Recommended Route", t.ai_recommended_route]
    ];
    
    if (state.stage === "experiment") {
      const model = state.schedule.models[state.modelIndex];
      const vis = model.visualizations[state.visIndex];
      infoItems.splice(2, 0, ["Model", `${state.modelIndex + 1} (${model.model_type})`]);
      infoItems.splice(3, 0, ["Visualization", vis.visualization]);
      infoItems.splice(3, 0, ["Model", `${model.tag} (${model.model_type})`]);
    }
    
    infoItems.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "info-item";
      const labelSpan = document.createElement("span");
      labelSpan.className = "info-label";
      labelSpan.textContent = `${label}: `;
      item.appendChild(labelSpan);
      item.appendChild(document.createTextNode(String(value)));
      infoBox.appendChild(item);
    });
    
    root.appendChild(infoBox);
    
    // Show debug info only in debug mode
    const debugBox = document.createElement("div");
    debugBox.className = "debug-info";
    
    const debugTitle = document.createElement("h4");
    debugTitle.textContent = "DEBUG - Correct Answers";
    debugBox.appendChild(debugTitle);
    
    const debugItems = [
      ["Scenario ID", t.scenario_id],
      ["Difficulty", t.difficulty],
      ["True Optimal Route", t.correct_route],
      ["AI Recommended Route", t.ai_recommended_route]
    ];
    
    debugItems.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "debug-item";
      item.textContent = `${label}: ${value}`;
      debugBox.appendChild(item);
    });
    
    if (t.correct_answers) {
      Object.entries(t.correct_answers).forEach(([q, ans]) => {
        const item = document.createElement("div");
        item.className = "debug-item";
        item.textContent = `Correct ${q}: ${ans}`;
        debugBox.appendChild(item);
      });
    }
    
    root.appendChild(debugBox);
  }
  
  // Determine scenario folder based on whether the AI recommendation should be correct.
  // If rec_correct === "לא" → use Inaccurate_Scenarios, otherwise use Correct_Scenarios.
  const scenarioFolder =
    t.rec_correct === "לא"
      ? "Scenarios/Inaccurate_Scenarios"
      : "Scenarios/Correct_Scenarios";

  // Check if we have a scenario HTML file for this scenario in the chosen folder
  const scenarioFilePath = getScenarioFilePath(t.scenario_id, scenarioFolder);
  
  if (scenarioFilePath) {
    // Load actual scenario HTML in fullscreen iframe
    const iframeContainer = document.createElement("div");
    iframeContainer.id = `scenario-iframe-container-${t.scenario_id}`;
    iframeContainer.style.position = "fixed";
    iframeContainer.style.top = "0";
    iframeContainer.style.left = "0";
    iframeContainer.style.width = "100vw";
    iframeContainer.style.height = "100vh";
    iframeContainer.style.border = "none";
    iframeContainer.style.margin = "0";
    iframeContainer.style.padding = "0";
    iframeContainer.style.zIndex = "1000";
    iframeContainer.style.backgroundColor = "#0b0f17";
    
    const iframe = document.createElement("iframe");
    iframe.src = scenarioFilePath;
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.id = `scenario-iframe-${t.scenario_id}`;
    iframeContainer.appendChild(iframe);
    
    // Store reference to iframeContainer for cleanup when navigating
    state.currentTrialIframeContainer = iframeContainer;
    
    // Append to body instead of root for fullscreen effect
    document.body.appendChild(iframeContainer);
  } else {
    // Fallback to placeholder if no scenario file found
    const iframePlaceholder = document.createElement("div");
    iframePlaceholder.className = "iframe-placeholder";
    iframePlaceholder.textContent = `MAP IFRAME PLACEHOLDER (${t.scenario_id})`;
    root.appendChild(iframePlaceholder);
    
    // No route selector - route selection will be in scenario iframe
    // In debug mode, use AI recommended route as default
    const buttonGroup = document.createElement("div");
    buttonGroup.className = "button-group";
    
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "המשך";
    confirmBtn.onclick = () => {
      // Use selected route from iframe, or fallback to AI recommended route
      // Convert to Hebrew if needed
      const userRoute = convertRouteToHebrew(state.currentTrialSelectedRoute) || t.ai_recommended_route;
      const followedAi = userRoute === t.ai_recommended_route;
      const choseOptimal = userRoute === t.correct_route;
      
      const trialKey = getCurrentTrialKey();
      const trialLog = {
        trial_id: trialKey,
        participant_id: state.participantId,
        stage: state.stage,
        model_index: (state.stage === "experiment" ? state.modelIndex : null),
        vis_index: (state.stage === "experiment" ? state.visIndex : null),
        trial_index: (state.stage === "practice" ? state.practiceIndex : state.trialIndex),
        scenario_id: t.scenario_id,
        difficulty: t.difficulty,
        true_route: t.correct_route,
        ai_route: t.ai_recommended_route,
        model_type: (state.stage === "experiment"
                     ? state.schedule.models[state.modelIndex].model_type
                     : null),
        user_route: userRoute,
        followed_ai: followedAi,
        chose_true_optimal: choseOptimal,
        start_ts: state.currentPageEnterTs,
        end_ts: Date.now()
      };
      
      state.logs.trials.push(trialLog);
      logPageExit("TrialPage");
      
      // Reset selected route for next trial
      state.currentTrialSelectedRoute = null;
      
      state.pageType = "trial_questions";
      render();
    };
    buttonGroup.appendChild(confirmBtn);
    
    root.appendChild(buttonGroup);
  }
}

function renderTrialQuestionsPage(root) {
  const t = getCurrentTrial();
  if (!t) {
    render();
    return;
  }
  
  logPageEntry("TrialQuestionsPage", {
    scenario_id: t.scenario_id,
    stage: state.stage
  });
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  // Always show generic title without scenario code
  title.textContent = "שאלון לאחר תרחיש";
  title.dir = "rtl";
  root.appendChild(title);
  
  // Show scenario info only in debug mode
  if (state.debugMode) {
    const infoBox = document.createElement("div");
    infoBox.className = "info-box";
    
    const infoTitle = document.createElement("h3");
    infoTitle.textContent = "פרטי התרחיש";
    infoTitle.dir = "rtl";
    infoBox.appendChild(infoTitle);
    
    const scenarioItem = document.createElement("div");
    scenarioItem.className = "info-item";
    scenarioItem.innerHTML = `<span class="info-label">מזהה תרחיש:</span> ${escapeHtml(t.scenario_id)}`;
    scenarioItem.dir = "rtl";
    infoBox.appendChild(scenarioItem);
    
    const stageItem = document.createElement("div");
    stageItem.className = "info-item";
    if (state.stage === "experiment") {
      const model = state.schedule.models[state.modelIndex];
      const vis = model.visualizations[state.visIndex];
      stageItem.innerHTML = `<span class="info-label">שלב:</span> ${state.stage} - מודל ${state.modelIndex + 1}, ויזואליזציה ${state.visIndex + 1}`;
    } else {
      stageItem.innerHTML = `<span class="info-label">שלב:</span> ${state.stage}`;
    }
    stageItem.dir = "rtl";
    infoBox.appendChild(stageItem);
    
    root.appendChild(infoBox);
  }
  
  // Render fixed questions (confidence and mental_workload)
  if (state.questionsConfig && state.questionsConfig.trial_fixed_questions) {
    const fixedQuestionsSection = document.createElement("div");
    fixedQuestionsSection.style.marginTop = "30px";
    
    state.questionsConfig.trial_fixed_questions.forEach((question, idx) => {
      let questionDiv;
      if (question.type === "scale_minus10_10") {
        questionDiv = createMinus10To10Question(question, `trial_fixed_${question.id}`);
      } else {
        // Fallback to old 1-7 scale if type is not specified
        questionDiv = document.createElement("div");
        questionDiv.className = "form-group";
        questionDiv.style.marginBottom = "25px";
        
        const label = document.createElement("label");
        label.textContent = question.text;
        label.dir = "rtl";
        label.style.display = "block";
        label.style.marginBottom = "10px";
        label.style.fontWeight = "600";
        questionDiv.appendChild(label);
        
        // Scale labels
        const scaleLabels = document.createElement("div");
        scaleLabels.style.display = "flex";
        scaleLabels.style.justifyContent = "space-between";
        scaleLabels.style.marginBottom = "8px";
        scaleLabels.dir = "rtl";
        
        const minLabel = document.createElement("span");
        minLabel.textContent = question.min_label;
        minLabel.style.fontSize = "12px";
        minLabel.style.color = "#666";
        
        const maxLabel = document.createElement("span");
        maxLabel.textContent = question.max_label;
        maxLabel.style.fontSize = "12px";
        maxLabel.style.color = "#666";
        
        scaleLabels.appendChild(maxLabel);
        scaleLabels.appendChild(minLabel);
        questionDiv.appendChild(scaleLabels);
        
        // Radio buttons 1-7 (numbers below buttons)
        const radioGroup = document.createElement("div");
        radioGroup.style.display = "flex";
        radioGroup.style.gap = "10px";
        radioGroup.style.justifyContent = "center";
        
        for (let i = 1; i <= 7; i++) {
          const radioWrapper = document.createElement("div");
          radioWrapper.style.display = "flex";
          radioWrapper.style.flexDirection = "column";
          radioWrapper.style.alignItems = "center";
          
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `trial_fixed_${question.id}`;
          radio.value = i;
          radio.id = `trial_fixed_${question.id}_${i}`;
          
          const radioLabel = document.createElement("label");
          radioLabel.setAttribute("for", `trial_fixed_${question.id}_${i}`);
          radioLabel.textContent = i;
          radioLabel.style.fontSize = "14px";
          radioLabel.style.marginTop = "4px";
          radioLabel.style.cursor = "pointer";
          // Slight vertical tweak so text aligns with radio circle
          radioLabel.style.position = "relative";
          radioLabel.style.top = "1px";
          
          radioWrapper.appendChild(radio);
          radioWrapper.appendChild(radioLabel);
          radioGroup.appendChild(radioWrapper);
        }
        
        questionDiv.appendChild(radioGroup);
      }
      
      fixedQuestionsSection.appendChild(questionDiv);
    });
    
    root.appendChild(fixedQuestionsSection);
  }
  
  // Render scenario-specific questions from scenario_questions.json
  const scenarioQuestions = getScenarioQuestions(t.scenario_id);
  const questionKeys = ["Q1", "Q2", "Q3"];
  
  if (scenarioQuestions && scenarioQuestions.length > 0) {
    const scenarioQuestionsSection = document.createElement("div");
    scenarioQuestionsSection.style.marginTop = "30px";
    scenarioQuestionsSection.style.padding = "20px";
    scenarioQuestionsSection.style.background = "#f9f9f9";
    scenarioQuestionsSection.style.borderRadius = "8px";
    
    const sectionTitle = document.createElement("h3");
    sectionTitle.textContent = "שאלות ייעודיות לתרחיש";
    sectionTitle.dir = "rtl";
    sectionTitle.style.marginTop = "0";
    scenarioQuestionsSection.appendChild(sectionTitle);
    
    scenarioQuestions.forEach((questionData, idx) => {
      const questionDiv = document.createElement("div");
      questionDiv.className = "form-group";
      questionDiv.style.marginBottom = "25px";
      questionDiv.style.padding = "15px";
      questionDiv.style.background = "white";
      questionDiv.style.borderRadius = "4px";
      questionDiv.dir = "rtl";
      
      const questionLabel = document.createElement("label");
      questionLabel.textContent = `${idx + 1}. ${questionData.question_text}`;
      questionLabel.style.display = "block";
      questionLabel.style.marginBottom = "12px";
      questionLabel.style.fontWeight = "600";
      questionLabel.style.fontSize = "15px";
      questionDiv.appendChild(questionLabel);
      
      // Radio buttons for options
      if (questionData.options && questionData.options.length > 0) {
        questionData.options.forEach((option, optIdx) => {
          const optionWrapper = document.createElement("div");
          optionWrapper.style.marginBottom = "8px";
          optionWrapper.style.display = "flex";
          optionWrapper.style.flexDirection = "row";
          optionWrapper.style.alignItems = "center";
          optionWrapper.style.gap = "8px";
          optionWrapper.dir = "rtl";
          
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `scenario_question_${questionData.question_id}_${idx}`;
          radio.value = optIdx;
          radio.id = `scenario_${questionData.question_id}_${idx}_opt_${optIdx}`;
          radio.required = true;
          
        const radioLabel = document.createElement("label");
        radioLabel.setAttribute("for", `scenario_${questionData.question_id}_${idx}_opt_${optIdx}`);
        radioLabel.textContent = option;
        radioLabel.dir = "rtl";
        radioLabel.style.marginRight = "0";
        radioLabel.style.cursor = "pointer";
        radioLabel.style.fontSize = "14px";
        radioLabel.style.position = "relative";
        radioLabel.style.top = "1px";
          
          optionWrapper.appendChild(radio);
          optionWrapper.appendChild(radioLabel);
          questionDiv.appendChild(optionWrapper);
        });
      }
      
      // Show correct answer from schedule (Q1, Q2, Q3) - only in debug mode AND practice stage
      if (state.debugMode && state.stage === "practice") {
        const answerKey = questionKeys[idx];
        if (t.correct_answers && t.correct_answers[answerKey]) {
          const answerLabel = document.createElement("div");
          answerLabel.style.marginTop = "12px";
          answerLabel.style.padding = "8px";
          answerLabel.style.background = "#e3f2fd";
          answerLabel.style.borderRadius = "4px";
          answerLabel.style.fontSize = "13px";
          answerLabel.innerHTML = `<strong>תשובה נכונה (${answerKey}):</strong> ${escapeHtml(String(t.correct_answers[answerKey]))}`;
          answerLabel.dir = "rtl";
          questionDiv.appendChild(answerLabel);
        }
        
        // Show expected correct answer index from scenario_questions.json (for debugging)
        if (questionData.correct_answer_index !== undefined && questionData.correct_answer_index !== null) {
          const debugAnswerLabel = document.createElement("div");
          debugAnswerLabel.style.marginTop = "8px";
          debugAnswerLabel.style.padding = "6px";
          debugAnswerLabel.style.background = "#fff3e0";
          debugAnswerLabel.style.borderRadius = "4px";
          debugAnswerLabel.style.fontSize = "12px";
          debugAnswerLabel.style.fontFamily = "monospace";
          const correctOption = questionData.options[questionData.correct_answer_index];
          debugAnswerLabel.innerHTML = `<strong>DEBUG - Correct answer index:</strong> ${questionData.correct_answer_index} (${escapeHtml(correctOption || 'N/A')})`;
          debugAnswerLabel.dir = "ltr";
          questionDiv.appendChild(debugAnswerLabel);
        }
      }
      
      scenarioQuestionsSection.appendChild(questionDiv);
    });
    
    root.appendChild(scenarioQuestionsSection);
  } else {
    // Fallback: show placeholder if no scenario questions found
    const placeholderSection = document.createElement("div");
    placeholderSection.style.marginTop = "30px";
    placeholderSection.style.padding = "20px";
    placeholderSection.style.background = "#fff3e0";
    placeholderSection.style.borderRadius = "8px";
    placeholderSection.dir = "rtl";
    placeholderSection.textContent = `לא נמצאו שאלות ייעודיות לתרחיש ${t.scenario_id}`;
    root.appendChild(placeholderSection);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    // Validate fixed questions are answered (skip in debug mode)
    if (!state.debugMode && state.questionsConfig && state.questionsConfig.trial_fixed_questions) {
      for (const question of state.questionsConfig.trial_fixed_questions) {
        if (question.type === "scale_minus10_10") {
          // For slider-based questions, check hidden input
          const hiddenInput = document.getElementById(`trial_fixed_${question.id}_value`);
          // Check if input exists and has a valid numeric value (including "0" which is valid)
          if (!hiddenInput) {
            alert(`אנא ענה על השאלה: ${question.text}`);
            return;
          }
          const value = parseInt(hiddenInput.value);
          if (isNaN(value) || value < -10 || value > 10) {
            alert(`אנא ענה על השאלה: ${question.text}`);
            return;
          }
        } else {
          // For radio button questions (1-7 scale)
          const selected = document.querySelector(`input[name="trial_fixed_${question.id}"]:checked`);
          if (!selected) {
            alert(`אנא ענה על השאלה: ${question.text}`);
            return;
          }
        }
      }
    }
    
    // Validate scenario-specific questions are answered (skip in debug mode)
    const scenarioQuestions = getScenarioQuestions(t.scenario_id);
    if (!state.debugMode && scenarioQuestions && scenarioQuestions.length > 0) {
      for (let idx = 0; idx < scenarioQuestions.length; idx++) {
        const questionData = scenarioQuestions[idx];
        const selected = document.querySelector(`input[name="scenario_question_${questionData.question_id}_${idx}"]:checked`);
        if (!selected) {
          alert(`אנא ענה על השאלה: ${questionData.question_text}`);
          return;
        }
      }
    }
    
    // Collect answers from fixed questions
    const answers = {};
    if (state.questionsConfig && state.questionsConfig.trial_fixed_questions) {
      state.questionsConfig.trial_fixed_questions.forEach(question => {
        if (question.type === "scale_minus10_10") {
          // For slider-based questions, get value from hidden input
          const hiddenInput = document.getElementById(`trial_fixed_${question.id}_value`);
          if (hiddenInput && hiddenInput.value !== "") {
            answers[question.id] = parseInt(hiddenInput.value);
          } else {
            answers[question.id] = state.debugMode ? "DBG" : null;
          }
        } else {
          // For radio button questions (1-7 scale)
          const selected = document.querySelector(`input[name="trial_fixed_${question.id}"]:checked`);
          if (selected) {
            const value = parseInt(selected.value);
            answers[question.id] = value;
          } else {
            answers[question.id] = state.debugMode ? "DBG" : null;
          }
        }
      });
    }
    
    // Collect answers from scenario-specific questions
    const scenarioAnswers = {};
    if (scenarioQuestions && scenarioQuestions.length > 0) {
      scenarioQuestions.forEach((questionData, idx) => {
        const selected = document.querySelector(`input[name="scenario_question_${questionData.question_id}_${idx}"]:checked`);
        if (selected) {
          const selectedIndex = parseInt(selected.value);
          scenarioAnswers[questionData.question_id] = {
            answer_index: selectedIndex,
            answer_text: questionData.options[selectedIndex],
            correct_answer_index: questionData.correct_answer_index,
            is_correct: selectedIndex === questionData.correct_answer_index
          };
        } else {
          scenarioAnswers[questionData.question_id] = state.debugMode ? "DBG" : null;
        }
      });
    }
    
    // Merge scenario answers into main answers object
    if (Object.keys(scenarioAnswers).length > 0) {
      answers.scenario_questions = scenarioAnswers;
    }
    
    const trialKey = getCurrentTrialKey();
    const questionnaireLog = {
      trial_id: trialKey,
      participant_id: state.participantId,
      stage: state.stage,
        model_index: (state.stage === "experiment" ? state.modelIndex : null),
        vis_index: (state.stage === "experiment" ? state.visIndex : null),
      trial_index: (state.stage === "practice" ? state.practiceIndex : state.trialIndex),
      questionnaire_type: "post_scenario",
      answers: Object.keys(answers).length > 0 ? answers : null,
      correct: t.correct_answers || null,
      enter_ts: state.currentPageEnterTs,
      exit_ts: Date.now()
    };
    
    state.logs.questionnaires.push(questionnaireLog);
    logPageExit("TrialQuestionsPage");
    
    // Navigate to next page
    if (state.stage === "practice") {
      if (state.practiceIndex < state.schedule.practice.length - 1) {
        state.practiceIndex++;
        state.pageType = "scenario_intro";
        render();
      } else {
        state.stage = "experiment";
        state.pageType = "info";
        state.modelIndex = 0;
        state.visIndex = 0;
        state.modelIndex = 0;
        state.trialIndex = 0;
        render();
      }
    } else {
      // Experiment stage
      const model = state.schedule.models[state.modelIndex];
      const vis = model.visualizations[state.visIndex];
      
      if (state.trialIndex < vis.trials.length - 1) {
        state.trialIndex++;
        state.pageType = "scenario_intro";
        render();
      } else {
        // Finished all trials in this vis, go to NASA TLX (after each visualization)
        state.pageType = "nasa_tlx";
        render();
      }
    }
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderExperimentTransitionPage(root) {
  const pageName = "ExperimentTransitionPage";
  logPageEntry(pageName);
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "מעבר לניסוי האמיתי";
  title.dir = "rtl";
  root.appendChild(title);
  
  const content = document.createElement("div");
  content.className = "page-content";
  content.style.marginTop = "30px";
  content.style.padding = "20px";
  content.style.background = "#f9f9f9";
  content.style.borderRadius = "8px";
  content.style.fontSize = "16px";
  content.style.lineHeight = "1.8";
  content.style.whiteSpace = "pre-wrap";
  content.textContent =
    "סיימת את שלב התרגול.\n" +
    "כעת נתחיל בניסוי האמיתי.\n\n" +
    "הניסוי יכלול תרחישים בויזואליזציות שונות (עמודות נערמות, רדאר ומפת חום)\n" +
    "ובכל ויזואליזציה יבוצע שימוש במודלי בינה מלאכותית מסוגים שונים.";
  content.dir = "rtl";
  root.appendChild(content);
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  buttonGroup.style.marginTop = "30px";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך לניסוי";
  continueBtn.onclick = () => {
    logPageExit(pageName);
    state.pageType = "model_intro";
    render();
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderVisIntroPage(root) {
  const model = state.schedule.models[state.modelIndex];
  const vis = model.visualizations[state.visIndex];
  const pageName = `VisIntroPage_M${state.modelIndex}_V${state.visIndex}`;
  logPageEntry(pageName, {
    model_index: state.modelIndex,
    vis_index: state.visIndex,
    visualization: vis.visualization
  });
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = vis.visualization || "תצוגת ויזואליזציה";
  title.dir = "rtl";
  root.appendChild(title);

  // Short description text and visualization image
  const content = document.createElement("div");
  content.className = "page-content";
  content.dir = "rtl";
  content.style.whiteSpace = "pre-wrap";

  let descriptionText = "";
  let imageSrc = null;
  let imageAlt = null;

  if (vis.visualization === "עמודות נערמות" || vis.visualization === "עמודות מוערמות") {
    descriptionText = "ויזואליזציית עמודות נערמות";
    imageSrc = assetPath("Images/STACKED.png");
    imageAlt = "Stacked visualization";
  } else if (vis.visualization === "רדאר") {
    descriptionText = "ויזואליזציית רדאר";
    imageSrc = assetPath("Images/RADAR.png");
    imageAlt = "Radar visualization";
  } else if (vis.visualization === "מפת חום") {
    descriptionText = "ויזואליזציית מפת חום";
    imageSrc = assetPath("Images/HEATֹMAP.png");
    imageAlt = "Heatmap visualization";
  } else {
    descriptionText = vis.visualization || "";
  }

  content.textContent = descriptionText;
  root.appendChild(content);

  if (imageSrc) {
    const imgContainer = document.createElement("div");
    imgContainer.style.margin = "20px 0";
    imgContainer.style.display = "flex";
    imgContainer.style.justifyContent = "center";
    imgContainer.style.alignItems = "center";

    const img = document.createElement("img");
    img.src = imageSrc;
    img.alt = imageAlt || vis.visualization;
    img.style.maxWidth = "90%";
    img.style.height = "auto";
    img.style.borderRadius = "8px";
    img.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";

    imgContainer.appendChild(img);
    root.appendChild(imgContainer);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    logPageExit(pageName);
    state.pageType = "scenario_intro";
    state.trialIndex = 0;
    render();
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderModelIntroPage(root) {
  const model = state.schedule.models[state.modelIndex];
  const pageName = `ModelIntroPage_M${state.modelIndex}`;
  logPageEntry(pageName, {
    model_index: state.modelIndex,
    model_type: model.model_type
  });
  
  root.innerHTML = "";
  
  const displayModelName = getDisplayModelName(state.modelIndex);
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = `התחלת מודל בינה מלאכותית – ${displayModelName}`;
  title.dir = "rtl";
  root.appendChild(title);
  
  const content = document.createElement("div");
  content.className = "page-content";
  content.dir = "rtl";
  content.style.whiteSpace = "pre-wrap";
  content.textContent =
    `במסכים הבאים יוצגו לך מספר תרחישים בהם השתמשנו במודל בינה מסוג \"${displayModelName}\" לחישוב המסלולים ולבחירת ההמלצה.`;
  content.dir = "rtl";
  content.style.whiteSpace = "pre-wrap";
  root.appendChild(content);
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const startBtn = document.createElement("button");
  startBtn.textContent = "המשך";
  startBtn.onclick = () => {
    logPageExit(pageName);
    state.pageType = "vis_intro";
    state.visIndex = 0;
    state.trialIndex = 0;
    render();
  };
  buttonGroup.appendChild(startBtn);
  
  root.appendChild(buttonGroup);
}

function renderNasaTlxPage(root) {
  const model = state.schedule.models[state.modelIndex];
  const vis = model.visualizations[state.visIndex];
  const pageName = `NasaTlxPage_M${state.modelIndex}_V${state.visIndex}`;
  logPageEntry(pageName, {
    model_index: state.modelIndex,
    vis_index: state.visIndex,
    visualization: vis.visualization
  });
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = `שאלון – ${vis.visualization}`;
  title.dir = "rtl";
  root.appendChild(title);
  
  // Render workload questions (NASA TLX)
  if (state.questionsConfig && state.questionsConfig.model_summary_questions) {
    const workloadSection = document.createElement("div");
    workloadSection.style.marginTop = "20px";
    
    if (state.questionsConfig.model_summary_questions.workload) {
      state.questionsConfig.model_summary_questions.workload.forEach((question, idx) => {
        let questionDiv;
        if (question.type === "scale_minus10_10") {
          questionDiv = createMinus10To10Question(question, `nasa_tlx_${question.id}`);
        } else {
          questionDiv = createLikertQuestion(question, `nasa_tlx_${question.id}`);
        }
        workloadSection.appendChild(questionDiv);
      });
    }
    
    root.appendChild(workloadSection);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    if (!state.debugMode && state.questionsConfig && state.questionsConfig.model_summary_questions) {
      if (state.questionsConfig.model_summary_questions.workload) {
        for (const question of state.questionsConfig.model_summary_questions.workload) {
          const hiddenInput = document.getElementById(`nasa_tlx_${question.id}_value`);
          if (!hiddenInput) {
            alert(`אנא ענה על השאלה: ${question.text}`);
            return;
          }
          const value = parseInt(hiddenInput.value);
          if (isNaN(value) || value < -10 || value > 10) {
            alert(`אנא ענה על השאלה: ${question.text}`);
            return;
          }
        }
      }
    }
    
    const workloadAnswers = {};
    if (state.questionsConfig && state.questionsConfig.model_summary_questions) {
      if (state.questionsConfig.model_summary_questions.workload) {
        state.questionsConfig.model_summary_questions.workload.forEach(question => {
          const hiddenInput = document.getElementById(`nasa_tlx_${question.id}_value`);
          if (hiddenInput && hiddenInput.value !== "") {
            workloadAnswers[question.id] = parseInt(hiddenInput.value);
          } else {
            const selected = document.querySelector(`input[name="nasa_tlx_${question.id}"]:checked`);
            workloadAnswers[question.id] = selected ? parseInt(selected.value) : (state.debugMode ? "DBG" : null);
          }
        });
      }
    }
    
    state.logs.questionnaires.push({
      trial_id: null,
      participant_id: state.participantId,
      stage: state.stage,
      model_index: state.modelIndex,
      vis_index: state.visIndex,
      trial_index: null,
      questionnaire_type: "nasa_tlx",
      answers: workloadAnswers,
      correct: null,
      enter_ts: state.currentPageEnterTs,
      exit_ts: Date.now()
    });
    
    logPageExit(pageName);
    
    // Next: more visualizations in this model, or trust
    if (state.visIndex < model.visualizations.length - 1) {
      state.visIndex++;
      state.trialIndex = 0;
      state.pageType = "vis_intro";
      render();
    } else {
      state.pageType = "model_summary_trust";
      render();
    }
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderModelSummaryWorkloadPage(root) {
  const model = state.schedule.models[state.modelIndex];
  const pageName = `ModelSummaryWorkloadPage_M${state.modelIndex}`;
  logPageEntry(pageName, {
    model_index: state.modelIndex
  });
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  const displayModelName = getDisplayModelName(state.modelIndex);
  // Avoid repeating the word "מודל" twice in the title
  title.textContent = `שאלון מסכם ${displayModelName}`;
  title.dir = "rtl";
  root.appendChild(title);
  
  // Render workload questions
  if (state.questionsConfig && state.questionsConfig.model_summary_questions) {
    const workloadSection = document.createElement("div");
    workloadSection.style.marginTop = "20px";
    
    if (state.questionsConfig.model_summary_questions.workload) {
      state.questionsConfig.model_summary_questions.workload.forEach((question, idx) => {
        let questionDiv;
        if (question.type === "scale_minus10_10") {
          questionDiv = createMinus10To10Question(question, `model_workload_${question.id}`);
        } else {
          // Fallback to regular Likert if type not recognized
          questionDiv = createLikertQuestion(question, `model_workload_${question.id}`);
        }
        workloadSection.appendChild(questionDiv);
      });
    }
    
    root.appendChild(workloadSection);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    // Validate answers (skip in debug mode)
    if (!state.debugMode && state.questionsConfig && state.questionsConfig.model_summary_questions) {
      // Validate workload questions
      if (state.questionsConfig.model_summary_questions.workload) {
        for (const question of state.questionsConfig.model_summary_questions.workload) {
          // For slider-based questions, check hidden input
          const hiddenInput = document.getElementById(`model_workload_${question.id}_value`);
          // Check if input exists and has a valid numeric value (including "0" which is valid)
          if (!hiddenInput) {
            alert(`אנא ענה על השאלה: ${question.text}`);
            return;
          }
          const value = parseInt(hiddenInput.value);
          if (isNaN(value) || value < -10 || value > 10) {
            alert(`אנא ענה על השאלה: ${question.text}`);
            return;
          }
        }
      }
    }
    
    // Collect workload answers and store temporarily
    const workloadAnswers = {};
    if (state.questionsConfig && state.questionsConfig.model_summary_questions) {
      if (state.questionsConfig.model_summary_questions.workload) {
        state.questionsConfig.model_summary_questions.workload.forEach(question => {
          // For slider-based questions, get value from hidden input
          const hiddenInput = document.getElementById(`model_workload_${question.id}_value`);
          if (hiddenInput && hiddenInput.value !== "") {
            workloadAnswers[question.id] = parseInt(hiddenInput.value);
          } else {
            // Fallback: try radio button (for backward compatibility)
            const selected = document.querySelector(`input[name="model_workload_${question.id}"]:checked`);
            workloadAnswers[question.id] = selected ? parseInt(selected.value) : (state.debugMode ? "DBG" : null);
          }
        });
      }
    }
    
    // Store workload answers temporarily
    state.tempWorkloadAnswers = workloadAnswers;
    
    logPageExit(pageName);
    
    // Navigate to trust questions page
    state.pageType = "model_summary_trust";
    render();
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderModelSummaryTrustPage(root) {
  const model = state.schedule.models[state.modelIndex];
  const pageName = `ModelSummaryTrustPage_M${state.modelIndex}`;
  logPageEntry(pageName, {
    model_index: state.modelIndex
  });
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  const displayModelName = getDisplayModelName(state.modelIndex);
  // Avoid repeating the word "מודל" twice in the title
  title.textContent = `שאלון מסכם ${displayModelName}`;
  title.dir = "rtl";
  root.appendChild(title);
  
  // Render trust questions in table format
  if (state.questionsConfig && state.questionsConfig.model_summary_questions && state.questionsConfig.model_summary_questions.trust) {
    const trustSection = document.createElement("div");
    trustSection.style.marginTop = "30px";
    trustSection.dir = "rtl";
    
    // Create table
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.marginTop = "20px";
    table.style.fontSize = "14px";
    
    // Scale labels row above header (aligned with specific columns)
    const labelsRow = document.createElement("tr");
    labelsRow.style.borderBottom = "none";
    
    // Empty cell for question column
    const emptyQuestionCell = document.createElement("td");
    emptyQuestionCell.style.padding = "8px 12px";
    emptyQuestionCell.style.width = "40%";
    emptyQuestionCell.style.borderRight = "1px solid transparent";
    labelsRow.appendChild(emptyQuestionCell);
    
    // Create cells for each scale column (1-7)
    for (let i = 1; i <= 7; i++) {
      const labelCell = document.createElement("td");
      labelCell.style.padding = "8px 8px";
      labelCell.style.textAlign = "center";
      labelCell.style.width = `${60 / 7}%`;
      labelCell.style.borderRight = i < 7 ? "1px solid transparent" : "1px solid transparent"; // Keep border for alignment
      labelCell.style.fontSize = "13px";
      labelCell.style.fontWeight = "500";
      labelCell.style.color = "#666";
      
      // Add labels to specific columns
      if (i === 1) {
        labelCell.textContent = "מתנגד מאוד";
      } else if (i === 4) {
        labelCell.textContent = "ניטרלי/ת";
      } else if (i === 7) {
        labelCell.textContent = "מסכים/ה מאוד";
      }
      // Empty cells for columns 2, 3, 5, 6
      
      labelsRow.appendChild(labelCell);
    }
    
    // Create a thead for labels
    const labelsThead = document.createElement("thead");
    labelsThead.appendChild(labelsRow);
    table.appendChild(labelsThead);
    
    // Table header with scale numbers only
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.style.backgroundColor = "#f5f5f5";
    headerRow.style.borderBottom = "2px solid #ddd";
    
    // Question column header
    const questionHeader = document.createElement("th");
    questionHeader.textContent = "שאלה";
    questionHeader.style.padding = "12px";
    questionHeader.style.textAlign = "right";
    questionHeader.style.fontWeight = "600";
    questionHeader.style.width = "40%";
    questionHeader.style.borderRight = "1px solid #ddd";
    headerRow.appendChild(questionHeader);
    
    // Scale headers (1-7 numbers only, equal width)
    for (let i = 1; i <= 7; i++) {
      const scaleHeader = document.createElement("th");
      scaleHeader.textContent = i;
      scaleHeader.style.padding = "12px 8px";
      scaleHeader.style.textAlign = "center";
      scaleHeader.style.fontWeight = "700";
      scaleHeader.style.fontSize = "16px";
      scaleHeader.style.width = `${60 / 7}%`; // Equal width for all scale columns
      scaleHeader.style.borderRight = "1px solid #ddd"; // All columns have right border, including between 6 and 7
      headerRow.appendChild(scaleHeader);
    }
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Table body with questions
    const tbody = document.createElement("tbody");
    
    state.questionsConfig.model_summary_questions.trust.forEach((question, idx) => {
      const row = document.createElement("tr");
      row.style.borderBottom = "1px solid #e0e0e0";
      
      // Question text cell
      const questionCell = document.createElement("td");
      questionCell.textContent = question.text;
      questionCell.style.padding = "12px";
      questionCell.style.textAlign = "right";
      questionCell.style.fontWeight = "500";
      questionCell.style.borderRight = "1px solid #ddd";
      questionCell.style.verticalAlign = "middle";
      row.appendChild(questionCell);
      
      // Radio buttons for each scale point (no numbers below)
      for (let i = 1; i <= 7; i++) {
        const radioCell = document.createElement("td");
        radioCell.style.padding = "12px 8px";
        radioCell.style.textAlign = "center";
        radioCell.style.borderRight = "1px solid #ddd"; // All columns have right border, including between 6 and 7
        radioCell.style.verticalAlign = "middle";
        
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `model_trust_${question.id}`;
        radio.value = i;
        radio.id = `model_trust_${question.id}_${i}`;
        radio.required = !state.debugMode;
        radio.style.cursor = "pointer";
        radio.style.width = "20px";
        radio.style.height = "20px";
        
        const radioLabel = document.createElement("label");
        radioLabel.setAttribute("for", `model_trust_${question.id}_${i}`);
        radioLabel.style.cursor = "pointer";
        radioLabel.style.display = "block";
        radioLabel.style.width = "100%";
        radioLabel.style.height = "100%";
        
        radioCell.appendChild(radio);
        radioCell.appendChild(radioLabel);
        row.appendChild(radioCell);
      }
      
      tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    trustSection.appendChild(table);
    root.appendChild(trustSection);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    // Validate answers (skip in debug mode)
    if (!state.debugMode && state.questionsConfig && state.questionsConfig.model_summary_questions) {
      // Validate trust questions
      if (state.questionsConfig.model_summary_questions.trust) {
        for (const question of state.questionsConfig.model_summary_questions.trust) {
          const selected = document.querySelector(`input[name="model_trust_${question.id}"]:checked`);
          if (!selected) {
            alert(`אנא ענה על השאלה: ${question.text}`);
            return;
          }
        }
      }
    }
    
    // Collect trust answers
    const trustAnswers = {};
    if (state.questionsConfig && state.questionsConfig.model_summary_questions) {
      if (state.questionsConfig.model_summary_questions.trust) {
        state.questionsConfig.model_summary_questions.trust.forEach(question => {
          const selected = document.querySelector(`input[name="model_trust_${question.id}"]:checked`);
          trustAnswers[question.id] = selected ? parseInt(selected.value) : (state.debugMode ? "DBG" : null);
        });
      }
    }
    
    // Trust answers (workload is collected per-vis in nasa_tlx)
    const answers = {
      workload: state.tempWorkloadAnswers || {},
      trust: trustAnswers
    };
    
    logPageExit(pageName);
    
    // Log questionnaire
    state.logs.questionnaires.push({
      trial_id: null,
      participant_id: state.participantId,
      stage: state.stage,
      model_index: state.modelIndex,
      vis_index: null,
      trial_index: null,
      questionnaire_type: "model_summary",
      answers: answers,
      correct: null,
      enter_ts: state.currentPageEnterTs,
      exit_ts: Date.now()
    });
    
    // Clear temporary workload answers
    state.tempWorkloadAnswers = null;
    
    // Navigate to next model or model_selection (at end)
    if (state.modelIndex < state.schedule.models.length - 1) {
      state.modelIndex++;
      state.visIndex = 0;
      state.trialIndex = 0;
      state.pageType = "model_intro";
      render();
    } else {
      // Finished both models, go to model selection (A/B)
      state.pageType = "model_selection";
      render();
    }
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

// Keep old function name for backward compatibility
function renderModelSummaryPage(root) {
  renderModelSummaryWorkloadPage(root);
}

function createLikertQuestion(question, namePrefix) {
  const questionDiv = document.createElement("div");
  questionDiv.className = "form-group";
  questionDiv.style.marginBottom = "25px";
  
  const label = document.createElement("label");
  label.textContent = question.text;
  label.dir = "rtl";
  label.style.display = "block";
  label.style.marginBottom = "10px";
  label.style.fontWeight = "600";
  questionDiv.appendChild(label);
  
  // Check if this is a trust question with labels
  const hasLabels = question.min_label && question.max_label;
  
  // Create container for scale with labels
  const scaleContainer = document.createElement("div");
  scaleContainer.style.position = "relative";
  scaleContainer.style.marginTop = "10px";
  
  // Labels row above radio buttons (for trust questions)
  // Labels span the full width of the scale
  if (hasLabels) {
    const labelsRow = document.createElement("div");
    labelsRow.style.display = "flex";
    labelsRow.style.justifyContent = "space-between";
    labelsRow.style.alignItems = "flex-start";
    labelsRow.style.marginBottom = "15px";
    labelsRow.style.padding = "0 5px";
    labelsRow.style.position = "relative";
    labelsRow.dir = "rtl";
    
    // Left label (מתנגד מאוד) - aligns with radio button 1
    const minLabel = document.createElement("div");
    minLabel.textContent = question.min_label;
    minLabel.style.fontSize = "12px";
    minLabel.style.color = "#666";
    minLabel.style.fontWeight = "500";
    minLabel.style.textAlign = "center";
    minLabel.style.flex = "0 0 auto";
    minLabel.style.minWidth = "80px";
    
    // Right label (מסכים/ה מאוד) - aligns with radio button 7
    const maxLabel = document.createElement("div");
    maxLabel.textContent = question.max_label;
    maxLabel.style.fontSize = "12px";
    maxLabel.style.color = "#666";
    maxLabel.style.fontWeight = "500";
    maxLabel.style.textAlign = "center";
    maxLabel.style.flex = "0 0 auto";
    maxLabel.style.minWidth = "80px";
    
    // Middle label (ניטרלי/ת) - aligns with radio button 4
    if (question.mid_label) {
      const midLabel = document.createElement("div");
      midLabel.textContent = question.mid_label;
      midLabel.style.fontSize = "12px";
      midLabel.style.color = "#666";
      midLabel.style.fontWeight = "500";
      midLabel.style.textAlign = "center";
      midLabel.style.flex = "1 1 auto";
      midLabel.style.padding = "0 10px";
      
      labelsRow.appendChild(maxLabel);
      labelsRow.appendChild(midLabel);
      labelsRow.appendChild(minLabel);
    } else {
      labelsRow.appendChild(maxLabel);
      labelsRow.appendChild(minLabel);
    }
    
    scaleContainer.appendChild(labelsRow);
  }
  
  // Radio buttons 1-7 (numbers below buttons)
  const radioGroup = document.createElement("div");
  radioGroup.style.display = "flex";
  radioGroup.style.gap = "8px";
  radioGroup.style.justifyContent = "center";
  radioGroup.style.flexWrap = "wrap";
  radioGroup.style.position = "relative";
  
  for (let i = 1; i <= 7; i++) {
    const radioWrapper = document.createElement("div");
    radioWrapper.style.display = "flex";
    radioWrapper.style.flexDirection = "column";
    radioWrapper.style.alignItems = "center";
    
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = namePrefix;
    radio.value = i;
    radio.id = `${namePrefix}_${i}`;
    radio.required = !state.debugMode;
    
    const radioLabel = document.createElement("label");
    radioLabel.setAttribute("for", `${namePrefix}_${i}`);
    radioLabel.textContent = i;
    radioLabel.style.fontSize = "14px";
    radioLabel.style.marginTop = "4px";
    radioLabel.style.cursor = "pointer";
    
    radioWrapper.appendChild(radio);
    radioWrapper.appendChild(radioLabel);
    radioGroup.appendChild(radioWrapper);
  }
  
  scaleContainer.appendChild(radioGroup);
  questionDiv.appendChild(scaleContainer);
  return questionDiv;
}

function createMinus10To10Question(question, namePrefix) {
  const questionDiv = document.createElement("div");
  questionDiv.className = "form-group";
  // Space between this question block (text + slider) and the next question
  questionDiv.style.marginBottom = "32px";
  
  const label = document.createElement("label");
  label.dir = "rtl";
  label.style.display = "block";
  // Make question text sit very close to its slider
  label.style.marginBottom = "0px";
  label.style.fontWeight = "600";

  // If text is in the form "Heading: question...", split into heading and body
  const fullText = question.text || "";
  const parts = fullText.split(":");
  if (parts.length > 1) {
    const headingText = parts[0].trim();
    const bodyText = parts.slice(1).join(":").trim();

    const headingSpan = document.createElement("span");
    headingSpan.textContent = headingText + ":";
    headingSpan.style.fontWeight = "700";

    label.appendChild(headingSpan);
    if (bodyText) {
      label.appendChild(document.createElement("br"));
      const bodySpan = document.createElement("span");
      bodySpan.textContent = bodyText;
      bodySpan.style.fontWeight = "400";
      label.appendChild(bodySpan);
    }
  } else {
    label.textContent = fullText;
  }

  questionDiv.appendChild(label);
  
  // Scale container with labels
  const scaleContainer = document.createElement("div");
  scaleContainer.style.position = "relative";
  // Minimal spacing above the slider; keep enough for the min/max labels
  scaleContainer.style.marginTop = "0px";
  scaleContainer.style.paddingTop = "22px"; // Space for labels and slider
  
  // Labels row - positioned at the edges
  const labelsRow = document.createElement("div");
  labelsRow.style.display = "flex";
  labelsRow.style.justifyContent = "space-between";
  // Small gap between labels row and slider
  labelsRow.style.marginBottom = "4px";
  labelsRow.style.padding = "0 5px";
  labelsRow.style.position = "relative";
  labelsRow.dir = "rtl";
  
  const minLabel = document.createElement("span");
  minLabel.textContent = question.min_label || "";
  minLabel.style.fontSize = "13px";
  minLabel.style.color = "#666";
  minLabel.style.fontWeight = "500";
  
  const maxLabel = document.createElement("span");
  maxLabel.textContent = question.max_label || "";
  maxLabel.style.fontSize = "13px";
  maxLabel.style.color = "#666";
  maxLabel.style.fontWeight = "500";
  
  labelsRow.appendChild(maxLabel);
  labelsRow.appendChild(minLabel);
  scaleContainer.appendChild(labelsRow);
  
  // Slider container
  const sliderContainer = document.createElement("div");
  sliderContainer.style.position = "relative";
  sliderContainer.style.width = "100%";
  sliderContainer.style.padding = "20px 40px";
  sliderContainer.style.boxSizing = "border-box";
  // Add some space below the slider so the next question isn't stuck to it
  sliderContainer.style.marginBottom = "16px";
  sliderContainer.dir = "ltr"; // Slider works in LTR for easier calculation
  
  // Slider track
  const sliderTrack = document.createElement("div");
  sliderTrack.style.position = "relative";
  sliderTrack.style.width = "100%";
  sliderTrack.style.height = "8px";
  sliderTrack.style.backgroundColor = "#e0e0e0";
  sliderTrack.style.borderRadius = "4px";
  sliderTrack.style.cursor = "pointer";
  sliderTrack.style.marginTop = "10px";
  
  // Center separator line (at 0)
  const centerSeparator = document.createElement("div");
  centerSeparator.style.position = "absolute";
  centerSeparator.style.left = "50%";
  centerSeparator.style.top = "-10px";
  centerSeparator.style.width = "2px";
  centerSeparator.style.height = "28px";
  centerSeparator.style.backgroundColor = "#999";
  centerSeparator.style.transform = "translateX(-50%)";
  sliderTrack.appendChild(centerSeparator);
  
  // Tick marks container
  const tickMarksContainer = document.createElement("div");
  tickMarksContainer.style.position = "absolute";
  tickMarksContainer.style.top = "8px";
  tickMarksContainer.style.left = "0";
  tickMarksContainer.style.width = "100%";
  tickMarksContainer.style.height = "12px";
  
  // Create 21 tick marks (for -10 to 10)
  for (let i = 0; i <= 20; i++) {
    const tick = document.createElement("div");
    tick.style.position = "absolute";
    tick.style.left = `${(i / 20) * 100}%`;
    tick.style.width = "1px";
    tick.style.height = "8px";
    tick.style.backgroundColor = "#999";
    tick.style.transform = "translateX(-50%)";
    tickMarksContainer.appendChild(tick);
  }
  sliderTrack.appendChild(tickMarksContainer);
  
  // Hidden input to store the value
  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  hiddenInput.name = namePrefix;
  hiddenInput.id = `${namePrefix}_value`;
  hiddenInput.value = "0"; // Default to 0
  hiddenInput.required = !state.debugMode;
  
  // Slider handle
  const sliderHandle = document.createElement("div");
  sliderHandle.style.position = "absolute";
  sliderHandle.style.top = "50%";
  sliderHandle.style.left = "50%";
  sliderHandle.style.width = "28px";
  sliderHandle.style.height = "28px";
  sliderHandle.style.backgroundColor = "#9E9E9E"; // Default grey (neutral/zero)
  sliderHandle.style.borderRadius = "50%";
  sliderHandle.style.border = "2px solid #fff";
  sliderHandle.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
  sliderHandle.style.cursor = "grab";
  sliderHandle.style.transform = "translate(-50%, -50%)";
  sliderHandle.style.zIndex = "10";
  sliderHandle.style.transition = "background-color 0.2s";
  sliderHandle.style.userSelect = "none";
  
  // Add texture/dots pattern to handle (light blue dots on grey background)
  sliderHandle.style.backgroundImage = "radial-gradient(circle, rgba(173,216,230,0.4) 1.5px, transparent 1.5px)";
  sliderHandle.style.backgroundSize = "5px 5px";
  
  // Navigation buttons
  const leftButton = document.createElement("button");
  leftButton.type = "button";
  // Use image icon on the left for decreasing value
  leftButton.style.position = "absolute";
  leftButton.style.left = "0";
  leftButton.style.top = "50%";
  leftButton.style.transform = "translateY(-50%)";
  leftButton.style.width = "30px";
  leftButton.style.height = "30px";
  leftButton.style.border = "1px solid #ccc";
  leftButton.style.borderRadius = "4px";
  leftButton.style.backgroundColor = "#fff";
  leftButton.style.cursor = "pointer";
  leftButton.style.display = "flex";
  leftButton.style.alignItems = "center";
  leftButton.style.justifyContent = "center";
  leftButton.style.padding = "0";
  // Minus image
  const minusImg = new Image();
  minusImg.src = assetPath("Images/minus.jpg");
  minusImg.alt = "-";
  minusImg.style.width = "16px";
  minusImg.style.height = "16px";
  leftButton.appendChild(minusImg);
  
  const rightButton = document.createElement("button");
  rightButton.type = "button";
  // Use image icon on the right for increasing value
  rightButton.style.position = "absolute";
  rightButton.style.right = "0";
  rightButton.style.top = "50%";
  rightButton.style.transform = "translateY(-50%)";
  rightButton.style.width = "30px";
  rightButton.style.height = "30px";
  rightButton.style.border = "1px solid #ccc";
  rightButton.style.borderRadius = "4px";
  rightButton.style.backgroundColor = "#fff";
  rightButton.style.cursor = "pointer";
  rightButton.style.display = "flex";
  rightButton.style.alignItems = "center";
  rightButton.style.justifyContent = "center";
  rightButton.style.padding = "0";
  // Plus image
  const plusImg = new Image();
  plusImg.src = assetPath("Images/plus.png");
  plusImg.alt = "+";
  plusImg.style.width = "16px";
  plusImg.style.height = "16px";
  rightButton.appendChild(plusImg);
  
  // Function to update slider position and value
  const updateSlider = (value) => {
    // Clamp value between -10 and 10
    value = Math.max(-10, Math.min(10, Math.round(value)));
    
    // Update hidden input
    hiddenInput.value = value.toString();
    
    // Update handle position (0% = -10, 50% = 0, 100% = 10)
    const percentage = ((value + 10) / 20) * 100;
    sliderHandle.style.left = `${percentage}%`;
    
    // Keep a neutral color for all values (no red/green)
    sliderHandle.style.backgroundColor = "#9E9E9E";
  };
  
  // Handle drag functionality (mouse and touch)
  let isDragging = false;
  
  const getValueFromEvent = (e) => {
    const rect = sliderTrack.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : e.changedTouches[0].clientX);
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    return Math.round((percentage / 100) * 20 - 10);
  };
  
  const handleMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const value = getValueFromEvent(e);
    updateSlider(value);
  };
  
  const handleEnd = () => {
    isDragging = false;
    sliderHandle.style.cursor = "grab";
    document.removeEventListener("mousemove", handleMove);
    document.removeEventListener("mouseup", handleEnd);
    document.removeEventListener("touchmove", handleMove);
    document.removeEventListener("touchend", handleEnd);
  };
  
  // Mouse events
  sliderHandle.addEventListener("mousedown", (e) => {
    isDragging = true;
    sliderHandle.style.cursor = "grabbing";
    e.preventDefault();
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);
  });
  
  // Touch events for mobile
  sliderHandle.addEventListener("touchstart", (e) => {
    isDragging = true;
    e.preventDefault();
    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd);
  });
  
  // Click on track to move handle
  sliderTrack.addEventListener("click", (e) => {
    const value = getValueFromEvent(e);
    updateSlider(value);
  });
  
  // Touch on track for mobile
  sliderTrack.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const value = getValueFromEvent(e);
    updateSlider(value);
  });
  
  // Navigation buttons
  leftButton.addEventListener("click", () => {
    const currentValue = parseInt(hiddenInput.value) || 0;
    updateSlider(currentValue - 1);
  });
  
  rightButton.addEventListener("click", () => {
    const currentValue = parseInt(hiddenInput.value) || 0;
    updateSlider(currentValue + 1);
  });
  
  // Initialize slider at 0
  updateSlider(0);
  
  // Assemble slider
  sliderContainer.appendChild(leftButton);
  sliderContainer.appendChild(sliderTrack);
  sliderContainer.appendChild(rightButton);
  sliderTrack.appendChild(sliderHandle);
  
  scaleContainer.appendChild(hiddenInput);
  scaleContainer.appendChild(sliderContainer);
  questionDiv.appendChild(scaleContainer);
  
  return questionDiv;
}

function renderModelSelectionPage(root) {
  const pageName = "ModelSelectionPage";
  logPageEntry(pageName);
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "בחירת מודל";
  title.dir = "rtl";
  root.appendChild(title);
  
  let baseQuestion = null;
  if (state.questionsConfig && state.questionsConfig.visualization_condition_question) {
    baseQuestion = state.questionsConfig.visualization_condition_question;
  }
  
  if (baseQuestion) {
    const questionData = {
      id: baseQuestion.id,
      text: baseQuestion.text,
      options: [
        getDisplayModelName(0),
        getDisplayModelName(1)
      ]
    };
    const questionDiv = document.createElement("div");
    questionDiv.className = "form-group";
    questionDiv.style.marginTop = "20px";
    
    const label = document.createElement("label");
    label.textContent = questionData.text;
    label.dir = "rtl";
    label.style.display = "block";
    label.style.marginBottom = "15px";
    label.style.fontWeight = "600";
    label.style.fontSize = "16px";
    questionDiv.appendChild(label);
    
    // Radio buttons for options
    if (questionData.options && questionData.options.length > 0) {
      questionData.options.forEach((option, idx) => {
        const optionWrapper = document.createElement("div");
        optionWrapper.style.marginBottom = "10px";
        optionWrapper.style.display = "flex";
        optionWrapper.style.flexDirection = "row";
        optionWrapper.style.alignItems = "center";
        optionWrapper.style.gap = "8px";
        optionWrapper.dir = "rtl";
        
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "model_selection_preference";
        radio.value = option;
        radio.id = `viz_cond_opt_${idx}`;
        radio.required = true;
        
        const radioLabel = document.createElement("label");
        radioLabel.setAttribute("for", `viz_cond_opt_${idx}`);
        radioLabel.textContent = option;
        radioLabel.dir = "rtl";
        radioLabel.style.marginRight = "0";
        radioLabel.style.cursor = "pointer";
        radioLabel.style.position = "relative";
        radioLabel.style.top = "1px";
        
        optionWrapper.appendChild(radio);
        optionWrapper.appendChild(radioLabel);
        questionDiv.appendChild(optionWrapper);
      });
    }
    
    root.appendChild(questionDiv);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    const selected = document.querySelector('input[name="model_selection_preference"]:checked');
    
    if (!selected && !state.debugMode) {
      alert("אנא בחר מודל מועדף");
      return;
    }
    
    logPageExit(pageName);
    
    state.logs.questionnaires.push({
      trial_id: null,
      participant_id: state.participantId,
      stage: state.stage,
      model_index: null,
      vis_index: null,
      trial_index: null,
      questionnaire_type: "model_selection",
      answers: selected ? { model_preference: selected.value } : (state.debugMode ? { model_preference: "DBG" } : null),
      correct: null,
      enter_ts: state.currentPageEnterTs,
      exit_ts: Date.now()
    });
    
    state.stage = "post";
    state.pageType = "visualization_global";
    render();
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderVisualizationGlobalPage(root) {
  const pageName = "VisualizationGlobalPage";
  logPageEntry(pageName);
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "העדפת תצוגות ויזואליזציה";
  title.dir = "rtl";
  root.appendChild(title);
  
  // Get question from questionsConfig
  let questionData = null;
  if (state.questionsConfig && state.questionsConfig.visualization_global_question) {
    questionData = state.questionsConfig.visualization_global_question;
  }
  
  if (questionData) {
    const questionDiv = document.createElement("div");
    questionDiv.className = "form-group";
    questionDiv.style.marginTop = "20px";
    
    const label = document.createElement("label");
    label.textContent = questionData.text;
    label.dir = "rtl";
    label.style.display = "block";
    label.style.marginBottom = "15px";
    label.style.fontWeight = "600";
    label.style.fontSize = "16px";
    questionDiv.appendChild(label);
    
    // Show reminder images of the three visualizations
    const imagesRow = document.createElement("div");
    imagesRow.style.display = "flex";
    imagesRow.style.justifyContent = "center";
    imagesRow.style.gap = "16px";
    imagesRow.style.marginBottom = "24px";
    imagesRow.dir = "rtl";

    const vizImages = [
      { src: assetPath("Images/STACKED.png"), alt: "עמודות נערמות" },
      { src: assetPath("Images/RADAR.png"), alt: "רדאר" },
      { src: assetPath("Images/HEATֹMAP.png"), alt: "מפת חום" }
    ];

    vizImages.forEach(info => {
      const wrapper = document.createElement("div");
      wrapper.style.maxWidth = "200px";

      const img = document.createElement("img");
      img.src = info.src;
      img.alt = info.alt;
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.borderRadius = "8px";
      img.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";

      const caption = document.createElement("div");
      caption.textContent = info.alt;
      caption.style.textAlign = "center";
      caption.style.marginTop = "4px";
      caption.style.fontSize = "13px";

      wrapper.appendChild(img);
      wrapper.appendChild(caption);
      imagesRow.appendChild(wrapper);
    });

    questionDiv.appendChild(imagesRow);

    // Rank 1-3 for each visualization (no duplicates)
    if (questionData.options && questionData.options.length > 0) {
      // Store references to all selects for reset functionality
      const allSelects = [];
      
      // Function to update available ranks in all dropdowns
      const updateAvailableRanks = (changedIndex) => {
        // Get all currently selected ranks
        const selectedRanks = [];
        questionData.options.forEach((_, idx) => {
          const select = document.getElementById(`viz_global_rank_${idx}`);
          if (select && select.value) {
            selectedRanks.push({
              index: idx,
              rank: parseInt(select.value)
            });
          }
        });
        
        // Update all dropdowns
        questionData.options.forEach((_, idx) => {
          const select = document.getElementById(`viz_global_rank_${idx}`);
          if (!select) return;
          
          const currentValue = select.value ? parseInt(select.value) : null;
          
          // Clear all options except placeholder
          while (select.options.length > 1) {
            select.remove(1);
          }
          
          // Add available ranks
          for (let rank = 1; rank <= 3; rank++) {
            // Check if this rank is selected by another dropdown
            const isSelectedByOther = selectedRanks.some(s => s.index !== idx && s.rank === rank);
            
            // Include rank if it's the current selection OR not selected by others
            if (currentValue === rank || !isSelectedByOther) {
              const option = document.createElement("option");
              option.value = rank;
              // Map numeric rank to descriptive text
              let labelText = "";
              if (rank === 1) labelText = "הטובה ביותר";
              else if (rank === 2) labelText = "בינונית";
              else labelText = "פחות טובה";
              option.textContent = labelText;
              if (currentValue === rank) {
                option.selected = true;
              }
              select.appendChild(option);
            }
          }
        });
      };
      
      // Reset function
      const resetRankings = () => {
        allSelects.forEach(select => {
          select.value = "";
          updateAvailableRanks(-1);
        });
      };
      
      questionData.options.forEach((option, idx) => {
        const optionWrapper = document.createElement("div");
        optionWrapper.style.marginBottom = "15px";
        optionWrapper.style.display = "flex";
        optionWrapper.style.alignItems = "center";
        optionWrapper.style.gap = "10px";
        optionWrapper.dir = "rtl";
        
        const optionLabel = document.createElement("label");
        optionLabel.textContent = option;
        optionLabel.dir = "rtl";
        optionLabel.style.minWidth = "150px";
        
        const select = document.createElement("select");
        select.id = `viz_global_rank_${idx}`;
        select.name = `viz_global_${option}`;
        select.style.padding = "8px";
        select.style.borderRadius = "4px";
        select.style.border = "1px solid #ccc";
        select.dir = "rtl";
        select.required = true;
        
        allSelects.push(select);
        
        // Add change listener to update available ranks
        select.addEventListener("change", () => {
          updateAvailableRanks(idx);
        });
        
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = "בחר דירוג";
        select.appendChild(placeholderOption);
        
        // Initially all ranks are available (with descriptive labels)
        for (let rank = 1; rank <= 3; rank++) {
          const option = document.createElement("option");
          option.value = rank;
          let labelText = "";
          if (rank === 1) labelText = "הטובה ביותר";
          else if (rank === 2) labelText = "בינונית";
          else labelText = "פחות טובה";
          option.textContent = labelText;
          select.appendChild(option);
        }
        
        optionWrapper.appendChild(optionLabel);
        optionWrapper.appendChild(select);
        questionDiv.appendChild(optionWrapper);
      });
      
      // Add reset button
      const resetButtonWrapper = document.createElement("div");
      resetButtonWrapper.style.marginTop = "15px";
      resetButtonWrapper.style.marginBottom = "20px";
      resetButtonWrapper.dir = "rtl";
      
      const resetButton = document.createElement("button");
      resetButton.textContent = "איפוס";
      resetButton.type = "button";
      resetButton.style.padding = "8px 16px";
      resetButton.style.fontSize = "14px";
      resetButton.style.backgroundColor = "#757575";
      resetButton.style.color = "#fff";
      resetButton.style.border = "none";
      resetButton.style.borderRadius = "6px";
      resetButton.style.cursor = "pointer";
      resetButton.onclick = resetRankings;
      resetButtonWrapper.appendChild(resetButton);
      questionDiv.appendChild(resetButtonWrapper);
    }
    
    root.appendChild(questionDiv);
    
    // Add question about which element helped understand the routes (AFTER ranking)
    const helpQuestionDiv = document.createElement("div");
    helpQuestionDiv.className = "form-group";
    helpQuestionDiv.style.marginTop = "30px";
    
    const helpQuestionLabel = document.createElement("label");
    helpQuestionLabel.textContent = "במהלך ביצוע המטלות, איזה רכיב ממשק שימש אותך במידה הרבה ביותר לצורך השוואת החלופות וקבלת החלטה לגבי המסלול?";
    helpQuestionLabel.dir = "rtl";
    helpQuestionLabel.style.display = "block";
    helpQuestionLabel.style.marginBottom = "15px";
    helpQuestionLabel.style.fontWeight = "600";
    helpQuestionLabel.style.fontSize = "16px";
    helpQuestionDiv.appendChild(helpQuestionLabel);

    // Layouts image underneath the question text
    const layoutsImgWrapper = document.createElement("div");
    layoutsImgWrapper.style.margin = "10px 0 20px";
    layoutsImgWrapper.style.display = "flex";
    layoutsImgWrapper.style.justifyContent = "center";
    layoutsImgWrapper.style.alignItems = "center";

    const layoutsImg = document.createElement("img");
    layoutsImg.src = assetPath("Images/LAYOUTS.png");
    layoutsImg.alt = "ממשק המערכת – אזורי מסך";
    layoutsImg.style.maxWidth = "90%";
    layoutsImg.style.height = "auto";
    layoutsImg.style.borderRadius = "8px";
    layoutsImg.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";

    layoutsImgWrapper.appendChild(layoutsImg);
    helpQuestionDiv.appendChild(layoutsImgWrapper);
    
    const helpSelect = document.createElement("select");
    helpSelect.id = "viz_global_help_element";
    helpSelect.name = "help_element";
    helpSelect.style.width = "100%";
    helpSelect.style.padding = "10px";
    helpSelect.style.borderRadius = "6px";
    helpSelect.style.border = "1px solid #ccc";
    helpSelect.style.fontSize = "14px";
    helpSelect.dir = "rtl";
    helpSelect.required = !state.debugMode;
    
    const placeholderHelpOption = document.createElement("option");
    placeholderHelpOption.value = "";
    placeholderHelpOption.textContent = "בחר תשובה";
    helpSelect.appendChild(placeholderHelpOption);
    
    const helpOptions = [
      "א. המפה הגיאוגרפית",
      "ב. גרף זמני המקטעים",
      "ג. אזור הוויזואליזציות (עמודות נערמות / רדאר / מפת חום)"
    ];
    helpOptions.forEach(opt => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt;
      helpSelect.appendChild(option);
    });
    
    helpQuestionDiv.appendChild(helpSelect);
    root.appendChild(helpQuestionDiv);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    // Validate all rankings are selected and unique (even in debug mode)
    if (questionData && questionData.options) {
      const selectedRanks = [];
      for (let idx = 0; idx < questionData.options.length; idx++) {
        const select = document.getElementById(`viz_global_rank_${idx}`);
        if (!select || !select.value) {
          if (!state.debugMode) {
            alert("אנא דרג את כל התצוגות");
            return;
          }
        } else {
          const rank = parseInt(select.value);
          if (selectedRanks.includes(rank)) {
            alert("אנא בחר דירוג שונה לכל תצוגה (1, 2, 3 ללא חזרות)");
            return;
          }
          selectedRanks.push(rank);
        }
      }
    }
    
    // Validate help element question (skip in debug mode)
    const helpElementSelect = document.getElementById("viz_global_help_element");
    if (!state.debugMode && (!helpElementSelect || !helpElementSelect.value)) {
      alert("אנא ענה על השאלה: איזה אזור בממשק סייע לך הכי הרבה בהבנת המסלולים?");
      return;
    }
    
    // Collect rankings
    const answers = {};
    if (questionData && questionData.options) {
      questionData.options.forEach((option, idx) => {
        const select = document.getElementById(`viz_global_rank_${idx}`);
        if (select && select.value) {
          answers[option] = parseInt(select.value);
        }
      });
    }
    
    // Add help element answer
    if (helpElementSelect) {
      answers.help_element = helpElementSelect.value || (state.debugMode ? "DBG" : null);
    }
    
    logPageExit(pageName);
    
    // Log questionnaire
    state.logs.questionnaires.push({
      trial_id: null,
      participant_id: state.participantId,
      stage: "post",
      condition_index: null,
      model_index: null,
      trial_index: null,
      questionnaire_type: "visualization_global",
      answers: Object.keys(answers).length > 0 ? answers : (state.debugMode ? { debug: "DBG" } : null),
      correct: null,
      enter_ts: state.currentPageEnterTs,
      exit_ts: Date.now()
    });
    
    state.pageType = "demographics";
    render();
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderDemographicsPage(root) {
  const pageName = "DemographicsPage";
  logPageEntry(pageName);
  
  root.innerHTML = "";
  // Ensure the page always starts scrolled to the top
  try {
    window.scrollTo(0, 0);
  } catch (e) {
    // Ignore if window is not available (shouldn't happen in browser)
  }
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "שאלון דמוגרפי";
  title.dir = "rtl";
  root.appendChild(title);
  
  // Get demographics questions from questionsConfig
  let questions = [];
  if (state.questionsConfig && state.questionsConfig.demographics_questions) {
    questions = state.questionsConfig.demographics_questions;
  }
  
  const formContainer = document.createElement("div");
  formContainer.style.marginTop = "20px";
  
  questions.forEach((question, idx) => {
    const questionDiv = document.createElement("div");
    questionDiv.className = "form-group";
    questionDiv.style.marginBottom = "20px";
    
    const label = document.createElement("label");
    label.textContent = question.text;
    label.dir = "rtl";
    label.style.display = "block";
    label.style.marginBottom = "8px";
    // Make main question text visually bolder than option labels
    label.style.fontWeight = "700";
    questionDiv.appendChild(label);
    
    if (question.type === "number") {
      const input = document.createElement("input");
      input.type = question.type;
      input.id = `demo_${question.id}`;
      input.name = question.id;
      input.style.width = "100%";
      input.style.padding = "10px";
      input.style.borderRadius = "6px";
      input.style.border = "1px solid #ccc";
      input.dir = "rtl";
      questionDiv.appendChild(input);
    } else if (question.type === "text" && question.id === "native_language") {
      // Native language should be a dropdown
      const select = document.createElement("select");
      select.id = `demo_${question.id}`;
      select.name = question.id;
      select.style.width = "100%";
      select.style.padding = "10px";
      select.style.borderRadius = "6px";
      select.style.border = "1px solid #ccc";
      select.dir = "rtl";
      select.required = !state.debugMode;
      
      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = "בחר שפה";
      select.appendChild(placeholderOption);
      
      const languageOptions = ["עברית", "ערבית", "אנגלית", "רוסית", "אתיופית", "אחר"];
      languageOptions.forEach(opt => {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
      });
      
      questionDiv.appendChild(select);
    } else if (question.type === "text") {
      const input = document.createElement("input");
      input.type = question.type;
      input.id = `demo_${question.id}`;
      input.name = question.id;
      input.style.width = "100%";
      input.style.padding = "10px";
      input.style.borderRadius = "6px";
      input.style.border = "1px solid #ccc";
      input.dir = "rtl";
      questionDiv.appendChild(input);
    } else if (question.type === "single_choice") {
      if (question.options && question.options.length > 0) {
        question.options.forEach((option, optIdx) => {
          const optionWrapper = document.createElement("div");
          optionWrapper.style.marginBottom = "8px";
          optionWrapper.style.display = "flex";
          optionWrapper.style.flexDirection = "row";
          optionWrapper.style.alignItems = "center";
          optionWrapper.style.gap = "8px";
          optionWrapper.dir = "rtl";
          
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = question.id;
          radio.value = option;
          radio.id = `demo_${question.id}_${optIdx}`;
          
          const radioLabel = document.createElement("label");
          radioLabel.setAttribute("for", `demo_${question.id}_${optIdx}`);
          radioLabel.textContent = option;
          radioLabel.dir = "rtl";
          radioLabel.style.marginRight = "0";
          radioLabel.style.cursor = "pointer";
          // Option labels should be normal-weight so question text stands out
          radioLabel.style.fontWeight = "400";
          radioLabel.style.position = "relative";
          radioLabel.style.top = "1px";
          
          optionWrapper.appendChild(radio);
          optionWrapper.appendChild(radioLabel);
          questionDiv.appendChild(optionWrapper);
        });
      }
    } else if (question.type === "scale_1_7") {
      // Check if this is one of the last 3 questions (navigation_use, tech_skill, viz_literacy)
      const isLastThreeQuestions = ["navigation_use", "tech_skill", "viz_literacy"].includes(question.id);
      
      const scaleContainer = document.createElement("div");
      scaleContainer.style.position = "relative";
      scaleContainer.style.marginTop = isLastThreeQuestions ? "10px" : "0";
      scaleContainer.dir = "ltr"; // Use LTR for proper 1-7 order
      
      // Create radio group container
      const radioGroup = document.createElement("div");
      radioGroup.style.display = "flex";
      radioGroup.style.gap = "10px";
      radioGroup.style.justifyContent = "center";
      radioGroup.style.alignItems = "flex-start";
      radioGroup.style.position = "relative";
      radioGroup.style.width = "100%";
      radioGroup.style.marginBottom = isLastThreeQuestions ? "0" : "0";
      
      // Add labels row above the scale if it's one of the last 3 questions
      // Use the same structure as radio group for alignment
      if (isLastThreeQuestions) {
        const labelsRow = document.createElement("div");
        labelsRow.style.display = "flex";
        labelsRow.style.gap = "10px";
        labelsRow.style.justifyContent = "center";
        labelsRow.style.width = "100%";
        labelsRow.style.marginBottom = "10px";
        labelsRow.style.position = "relative";
        
        // Create cells matching radio group structure (reversed 7→1)
        for (let i = 7; i >= 1; i--) {
          const labelCell = document.createElement("div");
          labelCell.style.flex = "0 0 auto";
          labelCell.style.minWidth = "40px";
          labelCell.style.textAlign = "center";
          labelCell.style.fontSize = "12px";
          labelCell.style.color = "#666";
          labelCell.style.fontWeight = "500";
          
          // Add labels to specific columns (now reversed)
          if (i === 1) {
            labelCell.textContent = "כמעט אף פעם";
          } else if (i === 7) {
            labelCell.textContent = "כל יום";
          }
          // Empty cells for columns 2-6
          
          labelsRow.appendChild(labelCell);
        }
        
        scaleContainer.appendChild(labelsRow);
      }
      
      // Create radio buttons in order 7-1 (reversed)
      for (let i = 7; i >= 1; i--) {
        const radioWrapper = document.createElement("div");
        radioWrapper.style.display = "flex";
        radioWrapper.style.flexDirection = "column";
        radioWrapper.style.alignItems = "center";
        radioWrapper.style.flex = "0 0 auto";
        radioWrapper.style.minWidth = "40px";
        
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = question.id;
        radio.value = i;
        radio.id = `demo_${question.id}_${i}`;
        radio.required = !state.debugMode;
        radio.style.cursor = "pointer";
        radio.style.width = "20px";
        radio.style.height = "20px";
        
        const radioLabel = document.createElement("label");
        radioLabel.setAttribute("for", `demo_${question.id}_${i}`);
        radioLabel.textContent = i;
        radioLabel.style.fontSize = "14px";
        radioLabel.style.marginTop = "4px";
        radioLabel.style.cursor = "pointer";
        radioLabel.style.position = "relative";
        radioLabel.style.top = "1px";
        
        radioWrapper.appendChild(radio);
        radioWrapper.appendChild(radioLabel);
        radioGroup.appendChild(radioWrapper);
      }
      
      scaleContainer.appendChild(radioGroup);
      questionDiv.appendChild(scaleContainer);
    }
    
    formContainer.appendChild(questionDiv);
  });
  
  root.appendChild(formContainer);
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    // Collect all answers
    const answers = {};
    
    questions.forEach(question => {
      if (question.type === "number") {
        const input = document.getElementById(`demo_${question.id}`);
        if (input) {
          if (input.value.trim()) {
            answers[question.id] = parseInt(input.value);
          } else {
            answers[question.id] = state.debugMode ? "DBG" : null;
          }
        } else {
          answers[question.id] = state.debugMode ? "DBG" : null;
        }
      } else if (question.type === "text" && question.id === "native_language") {
        // Native language is now a select dropdown
        const select = document.getElementById(`demo_${question.id}`);
        if (select) {
          if (select.value) {
            answers[question.id] = select.value;
          } else {
            answers[question.id] = state.debugMode ? "DBG" : null;
          }
        } else {
          answers[question.id] = state.debugMode ? "DBG" : null;
        }
      } else if (question.type === "text") {
        const input = document.getElementById(`demo_${question.id}`);
        if (input) {
          if (input.value.trim()) {
            answers[question.id] = input.value;
          } else {
            answers[question.id] = state.debugMode ? "DBG" : null;
          }
        } else {
          answers[question.id] = state.debugMode ? "DBG" : null;
        }
      } else if (question.type === "single_choice") {
        const selected = document.querySelector(`input[name="${question.id}"]:checked`);
        answers[question.id] = selected ? selected.value : (state.debugMode ? "DBG" : null);
      } else if (question.type === "scale_1_7") {
        const selected = document.querySelector(`input[name="${question.id}"]:checked`);
        answers[question.id] = selected ? parseInt(selected.value) : (state.debugMode ? "DBG" : null);
      }
    });

    // Before ending the experiment, download the logs (same as end page button)
    downloadLogs();

    logPageExit(pageName);
    
    // Log questionnaire
    state.logs.questionnaires.push({
      trial_id: null,
      participant_id: state.participantId,
      stage: "post",
      condition_index: null,
      model_index: null,
      trial_index: null,
      questionnaire_type: "demographics",
      answers: answers,
      correct: null,
      enter_ts: state.currentPageEnterTs,
      exit_ts: Date.now()
    });
    
    state.stage = "end";
    state.pageType = "end";
    render();
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderEndPage(root) {
  const pageName = "EndPage";
  logPageEntry(pageName);
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "סיום הניסוי";
  title.dir = "rtl";
  root.appendChild(title);
  
  const content = document.createElement("div");
  content.className = "page-content";
  content.dir = "rtl";
  content.style.whiteSpace = "pre-wrap";
  // First sentence bold, with line breaks as requested
  const boldSpan = document.createElement("span");
  boldSpan.textContent = "הניסוי הסתיים";
  boldSpan.style.fontWeight = "700";
  content.appendChild(boldSpan);
  content.appendChild(document.createElement("br"));
  content.appendChild(document.createTextNode("תודה על השתתפותך"));
  content.appendChild(document.createElement("br"));
  content.appendChild(document.createTextNode("כעת הנסיין יעביר לך את התשלום המובטח"));
  content.dir = "rtl";
  root.appendChild(content);
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const downloadBtn = document.createElement("button");
  downloadBtn.textContent = "הורד קובץ לוג JSON";
  downloadBtn.onclick = () => {
    logPageExit(pageName);
    downloadLogs();
  };
  buttonGroup.appendChild(downloadBtn);
  
  root.appendChild(buttonGroup);
}

// Main render function
function render() {
  const root = document.getElementById("app");
  if (!root) return;
  
  if (state.stage === "login") {
    renderLoginPage(root);
  } else if (state.stage === "pre") {
    const pageId = PRE_INTRO_PAGE_IDS[state.preIntroPageIndex];
    renderInfoPage(root, pageId);
  } else if (state.stage === "practice") {
    if (state.pageType === "info") {
      renderPracticeIntroPage(root);
    } else if (state.pageType === "scenario_intro") {
      renderScenarioIntroPage(root);
    } else if (state.pageType === "trial") {
      renderTrialPage(root);
    } else if (state.pageType === "trial_questions") {
      renderTrialQuestionsPage(root);
    }
  } else if (state.stage === "experiment") {
    if (state.pageType === "experiment_transition") {
      renderExperimentTransitionPage(root);
    } else if (state.pageType === "model_intro") {
      renderModelIntroPage(root);
    } else if (state.pageType === "vis_intro") {
      renderVisIntroPage(root);
    } else if (state.pageType === "scenario_intro") {
      renderScenarioIntroPage(root);
    } else if (state.pageType === "trial") {
      renderTrialPage(root);
    } else if (state.pageType === "trial_questions") {
      renderTrialQuestionsPage(root);
    } else if (state.pageType === "nasa_tlx") {
      renderNasaTlxPage(root);
    } else if (state.pageType === "model_summary" || state.pageType === "model_summary_workload") {
      renderModelSummaryWorkloadPage(root);
    } else if (state.pageType === "model_summary_trust") {
      renderModelSummaryTrustPage(root);
    } else if (state.pageType === "model_selection") {
      renderModelSelectionPage(root);
    }
  } else if (state.stage === "post") {
    if (state.pageType === "visualization_global") {
      renderVisualizationGlobalPage(root);
    } else if (state.pageType === "demographics") {
      renderDemographicsPage(root);
    }
  } else if (state.stage === "end") {
    renderEndPage(root);
  }
}

// Global message handler for scenario iframe communication
window.addEventListener("message", (event) => {
  // Listen for route selection from scenario iframes
  if (event.data && event.data.type === "scenario_route_selected") {
    // Convert English route to Hebrew before storing
    state.currentTrialSelectedRoute = convertRouteToHebrew(event.data.route);
    console.log("Route selected from scenario:", event.data.route, "converted to:", state.currentTrialSelectedRoute, "for scenario:", event.data.scenarioName);
    
    // Automatically navigate to next page after confirmation
    const t = getCurrentTrial();
    if (t && state.pageType === "trial") {
      // Use selected route from iframe (already converted to Hebrew)
      const userRoute = convertRouteToHebrew(event.data.route) || t.ai_recommended_route;
      const followedAi = userRoute === t.ai_recommended_route;
      const choseOptimal = userRoute === t.correct_route;
      
      const trialKey = getCurrentTrialKey();
      const trialLog = {
        trial_id: trialKey,
        participant_id: state.participantId,
        stage: state.stage,
        model_index: (state.stage === "experiment" ? state.modelIndex : null),
        vis_index: (state.stage === "experiment" ? state.visIndex : null),
        trial_index: (state.stage === "practice" ? state.practiceIndex : state.trialIndex),
        scenario_id: t.scenario_id,
        difficulty: t.difficulty,
        true_route: t.correct_route,
        ai_route: t.ai_recommended_route,
        model_type: (state.stage === "experiment"
                     ? state.schedule.models[state.modelIndex].model_type
                     : null),
        user_route: userRoute,
        followed_ai: followedAi,
        chose_true_optimal: choseOptimal,
        start_ts: state.currentPageEnterTs,
        end_ts: Date.now()
      };
      
      state.logs.trials.push(trialLog);
      logPageExit("TrialPage");
      
      // Remove fullscreen container
      if (state.currentTrialIframeContainer && state.currentTrialIframeContainer.parentNode) {
        state.currentTrialIframeContainer.parentNode.removeChild(state.currentTrialIframeContainer);
      }
      state.currentTrialIframeContainer = null;
      
      // Reset selected route for next trial
      state.currentTrialSelectedRoute = null;
      
      // Navigate to questions page
      state.pageType = "trial_questions";
      render();
    }
  }
});

// Function to force skip to next page (works in both debug and normal mode)
function forceSkipToNextPage() {
  // Log current page exit
  if (state.currentPageName) {
    logPageExit(state.currentPageName);
  }
  
  // Handle trial page specially - need to clean up iframe and log trial
  if (state.pageType === "trial") {
    const t = getCurrentTrial();
    if (t) {
      // Remove fullscreen iframe if it exists
      const existingContainers = document.querySelectorAll('[id^="scenario-iframe-container"]');
      existingContainers.forEach(container => {
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
      });
      
      // Log trial with default/DBG values
      const trialKey = getCurrentTrialKey();
      const userRoute = convertRouteToHebrew(state.currentTrialSelectedRoute) || t.ai_recommended_route || "DBG";
      const trialLog = {
        trial_id: trialKey,
        participant_id: state.participantId,
        stage: state.stage,
        model_index: (state.stage === "experiment" ? state.modelIndex : null),
        vis_index: (state.stage === "experiment" ? state.visIndex : null),
        trial_index: (state.stage === "practice" ? state.practiceIndex : state.trialIndex),
        scenario_id: t.scenario_id,
        difficulty: t.difficulty,
        true_route: t.correct_route,
        ai_recommended_route: t.ai_recommended_route,
        user_selected_route: userRoute,
        followed_ai: userRoute === t.ai_recommended_route,
        chose_true_optimal: userRoute === t.correct_route,
        enter_ts: state.currentPageEnterTs,
        exit_ts: Date.now()
      };
      state.logs.trials.push(trialLog);
      state.currentTrialSelectedRoute = null;
      state.currentTrialIframeContainer = null;
    }
    // Navigate to trial questions
    state.pageType = "trial_questions";
    render();
    return;
  }
  
  // For other pages, temporarily enable debug mode to use navigateToNextPage
  // This ensures consistent navigation logic
  const wasDebugMode = state.debugMode;
  state.debugMode = true;
  navigateToNextPage();
  state.debugMode = wasDebugMode;
}

// Function to navigate to next page (for debug mode spacebar shortcut)
function navigateToNextPage() {
  if (!state.debugMode) return;
  
  // Log current page exit
  if (state.currentPageName) {
    logPageExit(state.currentPageName);
  }
  
  // Determine next page based on current state
  if (state.stage === "login") {
    // After login, go to first pre-intro page
    state.stage = "pre";
    state.preIntroPageIndex = 0;
    render();
  } else if (state.stage === "pre") {
    // Move to next pre-intro page or to practice
    if (state.preIntroPageIndex < PRE_INTRO_PAGE_IDS.length - 1) {
      state.preIntroPageIndex++;
      render();
    } else {
      // Last pre-intro page, go to practice
      state.stage = "practice";
      state.pageType = "info";
      render();
    }
  } else if (state.stage === "practice") {
    if (state.pageType === "info") {
      // Practice intro -> first scenario intro
      state.pageType = "scenario_intro";
      render();
    } else if (state.pageType === "scenario_intro") {
      // Scenario intro -> trial
      state.pageType = "trial";
      render();
    } else if (state.pageType === "trial") {
      // Trial -> trial questions
      const t = getCurrentTrial();
      if (t) {
        // Log trial with default values
        const trialKey = getCurrentTrialKey();
        const trialLog = {
          trial_id: trialKey,
          participant_id: state.participantId,
          stage: state.stage,
          condition_index: null,
          model_index: null,
          trial_index: state.practiceIndex,
          scenario_id: t.scenario_id,
          difficulty: t.difficulty,
          true_route: t.correct_route,
          ai_route: t.ai_recommended_route,
          model_type: null,
          user_route: t.ai_recommended_route,
          followed_ai: true,
          chose_true_optimal: t.ai_recommended_route === t.correct_route,
          start_ts: state.currentPageEnterTs,
          end_ts: Date.now()
        };
        state.logs.trials.push(trialLog);
      }
      state.pageType = "trial_questions";
      render();
    } else if (state.pageType === "trial_questions") {
      // Log questionnaire for trial questions
      const t = getCurrentTrial();
      if (t) {
        const trialKey = getCurrentTrialKey();
        state.logs.questionnaires.push({
          trial_id: trialKey,
          participant_id: state.participantId,
          stage: state.stage,
          condition_index: null,
          model_index: null,
          trial_index: state.practiceIndex,
          questionnaire_type: "post_scenario",
          answers: { debug: "DBG" },
          correct: t.correct_answers || null,
          enter_ts: state.currentPageEnterTs,
          exit_ts: Date.now()
        });
      }
      
      // Trial questions -> next trial or experiment
      if (t && state.practiceIndex < state.schedule.practice.length - 1) {
        // More practice trials
        state.practiceIndex++;
        state.pageType = "scenario_intro";
        render();
      } else {
        // Finished practice, go to experiment transition page
        state.stage = "experiment";
        state.pageType = "experiment_transition";
        state.modelIndex = 0;
        state.visIndex = 0;
        state.trialIndex = 0;
        render();
      }
    }
  } else if (state.stage === "experiment") {
    if (state.pageType === "model_intro") {
      // Model intro -> vis intro (first vis of model)
      state.pageType = "vis_intro";
      state.visIndex = 0;
      state.trialIndex = 0;
      render();
    } else if (state.pageType === "vis_intro") {
      // Vis intro -> scenario intro
      state.pageType = "scenario_intro";
      render();
    } else if (state.pageType === "scenario_intro") {
      // Scenario intro -> trial
      state.pageType = "trial";
      render();
    } else if (state.pageType === "trial") {
      // Trial -> trial questions
      const t = getCurrentTrial();
      if (t) {
        const trialKey = getCurrentTrialKey();
        const model = state.schedule.models[state.modelIndex];
        const vis = model.visualizations[state.visIndex];
        const trialLog = {
          trial_id: trialKey,
          participant_id: state.participantId,
          stage: state.stage,
          model_index: state.modelIndex,
          vis_index: state.visIndex,
          trial_index: state.trialIndex,
          scenario_id: t.scenario_id,
          difficulty: t.difficulty,
          true_route: t.correct_route,
          ai_route: t.ai_recommended_route,
          model_type: model.model_type,
          user_route: t.ai_recommended_route,
          followed_ai: true,
          chose_true_optimal: t.ai_recommended_route === t.correct_route,
          start_ts: state.currentPageEnterTs,
          end_ts: Date.now()
        };
        state.logs.trials.push(trialLog);
      }
      state.pageType = "trial_questions";
      render();
    } else if (state.pageType === "trial_questions") {
      // Log questionnaire for trial questions
      const t = getCurrentTrial();
      if (t) {
        const trialKey = getCurrentTrialKey();
        state.logs.questionnaires.push({
          trial_id: trialKey,
          participant_id: state.participantId,
          stage: state.stage,
          model_index: state.modelIndex,
          vis_index: state.visIndex,
          trial_index: state.trialIndex,
          questionnaire_type: "post_scenario",
          answers: { debug: "DBG" },
          correct: t.correct_answers || null,
          enter_ts: state.currentPageEnterTs,
          exit_ts: Date.now()
        });
      }
      
      // Trial questions -> next trial or model summary
      const model = state.schedule.models[state.modelIndex];
      const vis = model.visualizations[state.visIndex];
      
      if (state.trialIndex < vis.trials.length - 1) {
        // More trials in this vis
        state.trialIndex++;
        state.pageType = "scenario_intro";
        render();
      } else {
        // Finished all trials in this vis, go to NASA TLX
        state.pageType = "nasa_tlx";
        render();
      }
    } else if (state.pageType === "nasa_tlx") {
      // NASA TLX -> next vis or trust (debug: skip validation)
      state.logs.questionnaires.push({
        trial_id: null,
        participant_id: state.participantId,
        stage: state.stage,
        model_index: state.modelIndex,
        vis_index: state.visIndex,
        trial_index: null,
        questionnaire_type: "nasa_tlx",
        answers: { debug: "DBG" },
        correct: null,
        enter_ts: state.currentPageEnterTs,
        exit_ts: Date.now()
      });
      const model = state.schedule.models[state.modelIndex];
      if (state.visIndex < model.visualizations.length - 1) {
        state.visIndex++;
        state.trialIndex = 0;
        state.pageType = "vis_intro";
        render();
      } else {
        state.pageType = "model_summary_trust";
        render();
      }
    } else if (state.pageType === "model_summary_workload") {
      // Workload page -> trust page
      state.pageType = "model_summary_trust";
      render();
    } else if (state.pageType === "model_summary_trust") {
      // Trust page -> next model or visualization condition
      // Collect debug answers for workload and trust questions
      const debugAnswers = {
        workload: state.tempWorkloadAnswers || {},
        trust: {}
      };
      
      if (state.questionsConfig && state.questionsConfig.model_summary_questions) {
        if (state.questionsConfig.model_summary_questions.trust) {
          state.questionsConfig.model_summary_questions.trust.forEach(q => {
            debugAnswers.trust[q.id] = "DBG";
          });
        }
      }
      
      state.logs.questionnaires.push({
        trial_id: null,
        participant_id: state.participantId,
        stage: state.stage,
        model_index: state.modelIndex,
        vis_index: null,
        trial_index: null,
        questionnaire_type: "model_summary",
        answers: debugAnswers,
        correct: null,
        enter_ts: state.currentPageEnterTs,
        exit_ts: Date.now()
      });
      
      state.tempWorkloadAnswers = null;
      
      // Model summary -> next model or visualization condition
      if (state.modelIndex < state.schedule.models.length - 1) {
        // More models
        state.modelIndex++;
        state.trialIndex = 0;
        state.pageType = "model_intro";
        render();
      } else {
        // Finished both models, go to visualization condition question
        state.pageType = "model_selection";
        render();
      }
    } else if (state.pageType === "model_summary") {
      // Legacy: redirect to workload page
      state.pageType = "model_summary_workload";
      render();
    } else if (state.pageType === "model_selection") {
      // Log questionnaire for visualization condition
      state.logs.questionnaires.push({
        trial_id: null,
        participant_id: state.participantId,
        stage: state.stage,
        model_index: null,
        vis_index: null,
        trial_index: null,
        questionnaire_type: "model_selection",
        answers: { debug: "DBG" },
        correct: null,
        enter_ts: state.currentPageEnterTs,
        exit_ts: Date.now()
      });
      
      // Model selection -> visualization global
      state.stage = "post";
      state.pageType = "visualization_global";
      render();
    }
  } else if (state.stage === "post") {
    if (state.pageType === "visualization_global") {
      // Log questionnaire for visualization global
      state.logs.questionnaires.push({
        trial_id: null,
        participant_id: state.participantId,
        stage: "post",
        model_index: null,
        vis_index: null,
        trial_index: null,
        questionnaire_type: "visualization_global",
        answers: { debug: "DBG" },
        correct: null,
        enter_ts: state.currentPageEnterTs,
        exit_ts: Date.now()
      });
      
      // Visualization global -> demographics
      state.pageType = "demographics";
      render();
    } else if (state.pageType === "demographics") {
      // Log questionnaire for demographics
      state.logs.questionnaires.push({
        trial_id: null,
        participant_id: state.participantId,
        stage: "post",
        model_index: null,
        vis_index: null,
        trial_index: null,
        questionnaire_type: "demographics",
        answers: { debug: "DBG" },
        correct: null,
        enter_ts: state.currentPageEnterTs,
        exit_ts: Date.now()
      });
      
      // Demographics -> end
      state.stage = "end";
      state.pageType = "end";
      render();
    }
  }
  // End page doesn't have a next page
}

// Global keyboard handler for debug mode spacebar navigation and force skip
// Use window.addEventListener to capture events even when iframe is focused
window.addEventListener("keydown", (event) => {
  // Force skip with numpad '9' - works in both debug and normal mode
  if (event.code === "Numpad9" || (event.key === "9" && event.location === 3)) {
    // Don't trigger if user is typing in an input, textarea, or select
    const activeElement = document.activeElement;
    if (activeElement && (
      activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.tagName === "SELECT"
    )) {
      return;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    // Force skip to next page
    console.log("Force skip triggered (Numpad 9)");
    forceSkipToNextPage();
    return;
  }
  
  // Spacebar navigation - only in debug mode
  if (!state.debugMode) return;
  if (event.code !== "Space" && event.key !== " ") return;
  
  // Don't trigger if user is typing in an input, textarea, or select
  const activeElement = document.activeElement;
  if (activeElement && (
    activeElement.tagName === "INPUT" ||
    activeElement.tagName === "TEXTAREA" ||
    activeElement.tagName === "SELECT"
  )) {
    return;
  }
  
  // Special handling for trial page - if iframe is focused, spacebar might not work
  // So we'll force skip instead
  if (state.pageType === "trial") {
    event.preventDefault();
    event.stopPropagation();
    console.log("Spacebar on trial page - force skipping");
    forceSkipToNextPage();
    return;
  }
  
  // Prevent default spacebar behavior (scrolling)
  event.preventDefault();
  
  // Navigate to next page
  navigateToNextPage();
});

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  render();
});

