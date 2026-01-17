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

  // indices into schedule
  practiceIndex: 0,
  conditionIndex: 0,
  modelIndex: 0,
  trialIndex: 0,

  // pre-intro page tracking
  preIntroPageIndex: 0,

  currentPageEnterTs: null,
  currentPageName: null,
  
  // Current trial route selection (from iframe)
  currentTrialSelectedRoute: null,
  // Reference to current trial iframe container for cleanup
  currentTrialIframeContainer: null,

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
  "ishihara_test",           // Page 1 - Ishihara Color Test
  "invitation_letter",       // Page 2 - Invitation to Participate
  "consent_form",            // Page 3 - Informed Consent Form
  "experiment_explanation_1", // Page 4 - Experiment Explanation (Text)
  "experiment_video",        // Page 5 - Experiment Explanation (Video)
  "system_layout",           // Page 6 - System Layout
  "system_criteria",         // Page 7 - System Criteria Display
  "helper_explanation",      // Page 8 - Helper View Explanation
  "experiment_flow"          // Page 9 - Experiment Flow Overview
];

// Mapping from scenario_id to HTML file names
const SCENARIO_FILE_MAP = {
  "SCN_001_OPT": "Scenario_2026-01-09_1767940439432_2026-01-09T06-39-52-484Z.html",
  "SCN_002_OPT": "Scenario_2026-01-09_1767940439432_2026-01-09T06-46-03-199Z.html",
  "SCN_003_OPT": "Scenario_2026-01-09_1767940439432_2026-01-09T06-51-26-898Z.html"
};

// Function to get scenario HTML file path
function getScenarioFilePath(scenarioId) {
  const fileName = SCENARIO_FILE_MAP[scenarioId];
  if (fileName) {
    return `Scenarios/${fileName}`;
  }
  return null;
}

// Utility functions
function normalizeId(input) {
  let id = input.toUpperCase().trim();
  if (!id.startsWith("P")) {
    id = "P" + id;
  }
  return id;
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

// Get current trial object
function getCurrentTrial() {
  if (state.stage === "practice") {
    if (!state.schedule.practice || state.practiceIndex >= state.schedule.practice.length) {
      return null;
    }
    return state.schedule.practice[state.practiceIndex];
  } else if (state.stage === "experiment") {
    const cond = state.schedule.conditions[state.conditionIndex];
    if (!cond) return null;
    const model = cond.models[state.modelIndex];
    if (!model) return null;
    if (state.trialIndex >= model.trials.length) return null;
    return model.trials[state.trialIndex];
  }
  return null;
}

// Generate trial key
function getCurrentTrialKey() {
  if (state.stage === "practice") {
    return `${state.participantId}_practice_T${state.practiceIndex}`;
  } else {
    const cond = state.schedule.conditions[state.conditionIndex];
    const model = cond.models[state.modelIndex];
    return `${state.participantId}_experiment_C${state.conditionIndex}_M${state.modelIndex}_T${state.trialIndex}`;
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
      "experiment_video": "הסבר על הניסוי (וידאו)",
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
  const content = document.createElement("div");
  content.className = "page-content";
  content.textContent = pageData.text || "";
  content.dir = "rtl";
  content.style.whiteSpace = "pre-wrap";
  root.appendChild(content);
  
  // Render media if present
  if (pageData.media) {
    const mediaContainer = document.createElement("div");
    mediaContainer.style.margin = "20px 0";
    
    if (pageData.media.type === "image") {
      // Show placeholder box instead of actual image
      const placeholder = document.createElement("div");
      placeholder.className = "iframe-placeholder";
      placeholder.textContent = `IMAGE PLACEHOLDER: ${pageId}`;
      placeholder.style.display = "flex";
      placeholder.style.alignItems = "center";
      placeholder.style.justifyContent = "center";
      mediaContainer.appendChild(placeholder);
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
    
    root.appendChild(mediaContainer);
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
  } else if (pageData.input_type === "checkbox_list") {
    // Show dummy checkboxes for פריט 1-5
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
      
      const label = document.createElement("label");
      label.setAttribute("for", `input_${pageId}_item${i}`);
      label.textContent = `פריט ${i}`;
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
  
  if (state.preIntroPageIndex > 0) {
    const backBtn = document.createElement("button");
    backBtn.textContent = "חזור";
    backBtn.dir = "rtl";
    backBtn.onclick = () => {
      logPageExit(pageName);
      state.preIntroPageIndex--;
      render();
    };
    buttonGroup.appendChild(backBtn);
  }
  
  const nextBtn = document.createElement("button");
  nextBtn.textContent = state.preIntroPageIndex < PRE_INTRO_PAGE_IDS.length - 1 ? "המשך" : "המשך לתרגול";
  nextBtn.onclick = () => {
    // Validate input if required (skip in debug mode)
    if (!state.debugMode) {
      if (pageData.input_type === "text") {
        const input = document.getElementById(`input_${pageId}`);
        if (!input || !input.value.trim()) {
          alert("אנא מלא את השדה הנדרש");
          return;
        }
      } else if (pageData.input_type === "checkbox") {
        const checkbox = document.getElementById(`input_${pageId}`);
        if (!checkbox || !checkbox.checked) {
          alert("אנא סמן את תיבת הסימון");
          return;
        }
      } else if (pageData.input_type === "checkbox_list") {
        // Validate at least one checkbox is checked
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
    
    logPageExit(pageName);
    if (state.preIntroPageIndex < PRE_INTRO_PAGE_IDS.length - 1) {
      state.preIntroPageIndex++;
      render();
    } else {
      state.stage = "practice";
      state.pageType = "info";
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
  
  // Get scenario intro data from questionsConfig
  let pageData = null;
  if (state.questionsConfig && state.questionsConfig.scenario_intro) {
    pageData = state.questionsConfig.scenario_intro;
  }
  
  // Fallback
  if (!pageData) {
    pageData = {
      title: "התחלת תרחיש",
      text: "בלחיצה על המשך יופיע מסך מערכת תכנון הנסיעה. תזכורת: המערכת תמליץ על אחד המסלולים שיסומן בכוכבית (*). עלייך לבחון את כל המסלולים ולבחור את המסלול האופטימלי ביותר. המסלול המומלץ על ידי המערכת אינו בהכרח האופטימלי ביותר."
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
      state.pageType = "info";
      state.conditionIndex = 0;
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
  
  // Show title and info boxes only in debug mode
  if (state.debugMode) {
    let titleText;
    if (state.stage === "practice") {
      titleText = `Trial – Practice #${state.practiceIndex + 1}`;
    } else {
      const cond = state.schedule.conditions[state.conditionIndex];
      const model = cond.models[state.modelIndex];
      titleText = `Trial – Condition ${state.conditionIndex + 1} (${cond.visualization}) Model ${model.tag} Trial ${state.trialIndex + 1}`;
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
      const cond = state.schedule.conditions[state.conditionIndex];
      const model = cond.models[state.modelIndex];
      infoItems.splice(2, 0, ["Condition", `${state.conditionIndex + 1}: ${cond.visualization}`]);
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
  
  // Check if we have a scenario HTML file for this scenario
  const scenarioFilePath = getScenarioFilePath(t.scenario_id);
  
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
      const userRoute = state.currentTrialSelectedRoute || t.ai_recommended_route;
      const followedAi = userRoute === t.ai_recommended_route;
      const choseOptimal = userRoute === t.correct_route;
      
      const trialKey = getCurrentTrialKey();
      const trialLog = {
        trial_id: trialKey,
        participant_id: state.participantId,
        stage: state.stage,
        condition_index: (state.stage === "experiment" ? state.conditionIndex : null),
        model_index: (state.stage === "experiment" ? state.modelIndex : null),
        trial_index: (state.stage === "practice" ? state.practiceIndex : state.trialIndex),
        scenario_id: t.scenario_id,
        difficulty: t.difficulty,
        true_route: t.correct_route,
        ai_route: t.ai_recommended_route,
        model_type: (state.stage === "experiment"
                     ? state.schedule.conditions[state.conditionIndex].models[state.modelIndex].model_type
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
  title.textContent = `שאלון לאחר תרחיש – ${t.scenario_id}`;
  title.dir = "rtl";
  root.appendChild(title);
  
  // Show scenario info at top
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
    const cond = state.schedule.conditions[state.conditionIndex];
    const model = cond.models[state.modelIndex];
    stageItem.innerHTML = `<span class="info-label">שלב:</span> ${state.stage} - תנאי ${state.conditionIndex + 1}, מודל ${model.tag}`;
  } else {
    stageItem.innerHTML = `<span class="info-label">שלב:</span> ${state.stage}`;
  }
  stageItem.dir = "rtl";
  infoBox.appendChild(stageItem);
  
  root.appendChild(infoBox);
  
  // Render fixed questions (confidence and mental_workload)
  if (state.questionsConfig && state.questionsConfig.trial_fixed_questions) {
    const fixedQuestionsSection = document.createElement("div");
    fixedQuestionsSection.style.marginTop = "30px";
    
    state.questionsConfig.trial_fixed_questions.forEach((question, idx) => {
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
      
      // Radio buttons 1-7
      const radioGroup = document.createElement("div");
      radioGroup.style.display = "flex";
      radioGroup.style.gap = "10px";
      radioGroup.style.justifyContent = "center";
      
      for (let i = 1; i <= 7; i++) {
        const radioWrapper = document.createElement("div");
        radioWrapper.style.display = "flex";
        radioWrapper.style.flexDirection = "row";
        radioWrapper.style.alignItems = "center";
        radioWrapper.style.gap = "6px";
        
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `trial_fixed_${question.id}`;
        radio.value = i;
        radio.id = `trial_fixed_${question.id}_${i}`;
        
        const radioLabel = document.createElement("label");
        radioLabel.setAttribute("for", `trial_fixed_${question.id}_${i}`);
        radioLabel.textContent = i;
        radioLabel.style.fontSize = "14px";
        radioLabel.style.marginTop = "0";
        radioLabel.style.marginRight = "0";
        radioLabel.style.marginLeft = "0";
        radioLabel.style.cursor = "pointer";
        
        radioWrapper.appendChild(radio);
        radioWrapper.appendChild(radioLabel);
        radioGroup.appendChild(radioWrapper);
      }
      
      questionDiv.appendChild(radioGroup);
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
          
          optionWrapper.appendChild(radio);
          optionWrapper.appendChild(radioLabel);
          questionDiv.appendChild(optionWrapper);
        });
      }
      
      // Show correct answer from schedule (Q1, Q2, Q3) - only in debug mode
      if (state.debugMode) {
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
        const selected = document.querySelector(`input[name="trial_fixed_${question.id}"]:checked`);
        if (!selected) {
          alert(`אנא ענה על השאלה: ${question.text}`);
          return;
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
        const selected = document.querySelector(`input[name="trial_fixed_${question.id}"]:checked`);
        if (selected) {
          answers[question.id] = parseInt(selected.value);
        } else {
          answers[question.id] = state.debugMode ? "DBG" : null;
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
      condition_index: (state.stage === "experiment" ? state.conditionIndex : null),
      model_index: (state.stage === "experiment" ? state.modelIndex : null),
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
        state.conditionIndex = 0;
        state.modelIndex = 0;
        state.trialIndex = 0;
        render();
      }
    } else {
      // Experiment stage
      const cond = state.schedule.conditions[state.conditionIndex];
      const model = cond.models[state.modelIndex];
      
      if (state.trialIndex < model.trials.length - 1) {
        state.trialIndex++;
        state.pageType = "scenario_intro";
        render();
      } else {
        // Finished all trials in this model, go to model summary
        state.pageType = "model_summary";
        render();
      }
    }
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderConditionIntroPage(root) {
  const cond = state.schedule.conditions[state.conditionIndex];
  const pageName = `ConditionIntroPage_C${state.conditionIndex}`;
  logPageEntry(pageName, {
    condition_index: state.conditionIndex,
    visualization: cond.visualization
  });
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = `Condition ${state.conditionIndex + 1} – Visualization: ${cond.visualization}`;
  root.appendChild(title);
  
  const content = document.createElement("div");
  content.className = "page-content";
  content.textContent = `This is the intro for this visualization type: ${cond.visualization}.`;
  root.appendChild(content);
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "Continue";
  continueBtn.onclick = () => {
    logPageExit(pageName);
    state.pageType = "model_intro";
    render();
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
}

function renderModelIntroPage(root) {
  const cond = state.schedule.conditions[state.conditionIndex];
  const model = cond.models[state.modelIndex];
  const pageName = `ModelIntroPage_C${state.conditionIndex}_M${state.modelIndex}`;
  logPageEntry(pageName, {
    condition_index: state.conditionIndex,
    model_tag: model.tag,
    model_type: model.model_type
  });
  
  root.innerHTML = "";
  
  // Get model intro data from questionsConfig
  let pageData = null;
  let introText = "";
  if (state.questionsConfig && state.questionsConfig.model_intro) {
    pageData = state.questionsConfig.model_intro;
    // Use text_model_a for OPT, text_model_b for SUB (or vice versa based on model order)
    // For now, use text_model_a for first model, text_model_b for second
    if (state.modelIndex === 0) {
      introText = pageData.text_model_a || pageData.text_model_b || "";
    } else {
      introText = pageData.text_model_b || pageData.text_model_a || "";
    }
  }
  
  // Fallback
  if (!pageData) {
    pageData = {
      title: "התחלת מודל בינה מלאכותית",
      text: `בלחיצה על המשך יוצגו לפניך מספר תרחישים שמדמים מערכת לתכנון מסלול נסיעה באמצעות בינה מלאכותית שמשתמשת במודל מסוג ${model.model_type}.`
    };
    introText = pageData.text;
  }
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = pageData.title || `Model ${model.tag} – Type: ${model.model_type}`;
  title.dir = "rtl";
  root.appendChild(title);
  
  const content = document.createElement("div");
  content.className = "page-content";
  content.textContent = introText || `בלחיצה על המשך יוצגו לפניך מספר תרחישים שמדמים מערכת לתכנון מסלול נסיעה באמצעות בינה מלאכותית שמשתמשת במודל מסוג ${model.model_type}.`;
  content.dir = "rtl";
  content.style.whiteSpace = "pre-wrap";
  root.appendChild(content);
  
  const infoBox = document.createElement("div");
  infoBox.className = "info-box";
  
  const infoItems = [
    ["Condition", `${state.conditionIndex + 1}: ${cond.visualization}`],
    ["Model Tag", model.tag],
    ["Model Type", model.model_type]
  ];
  
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
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const startBtn = document.createElement("button");
  startBtn.textContent = "המשך";
  startBtn.onclick = () => {
    logPageExit(pageName);
    state.pageType = "scenario_intro";
    state.trialIndex = 0;
    render();
  };
  buttonGroup.appendChild(startBtn);
  
  root.appendChild(buttonGroup);
}

function renderModelSummaryPage(root) {
  const cond = state.schedule.conditions[state.conditionIndex];
  const model = cond.models[state.modelIndex];
  const pageName = `ModelSummaryPage_C${state.conditionIndex}_M${state.modelIndex}`;
  logPageEntry(pageName, {
    condition_index: state.conditionIndex,
    model_tag: model.tag
  });
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = `שאלון מסכם מודל – תנאי ${state.conditionIndex + 1} מודל ${model.tag}`;
  title.dir = "rtl";
  root.appendChild(title);
  
  // Render workload questions
  if (state.questionsConfig && state.questionsConfig.model_summary_questions) {
    const workloadSection = document.createElement("div");
    workloadSection.style.marginTop = "20px";
    
    const workloadTitle = document.createElement("h3");
    workloadTitle.textContent = "שאלות עומס";
    workloadTitle.dir = "rtl";
    workloadSection.appendChild(workloadTitle);
    
    if (state.questionsConfig.model_summary_questions.workload) {
      state.questionsConfig.model_summary_questions.workload.forEach((question, idx) => {
        const questionDiv = createLikertQuestion(question, `model_workload_${question.id}`);
        workloadSection.appendChild(questionDiv);
      });
    }
    
    root.appendChild(workloadSection);
    
    // Render trust questions
    const trustSection = document.createElement("div");
    trustSection.style.marginTop = "30px";
    
    const trustTitle = document.createElement("h3");
    trustTitle.textContent = "שאלות אמון";
    trustTitle.dir = "rtl";
    trustSection.appendChild(trustTitle);
    
    if (state.questionsConfig.model_summary_questions.trust) {
      state.questionsConfig.model_summary_questions.trust.forEach((question, idx) => {
        const questionDiv = createLikertQuestion(question, `model_trust_${question.id}`);
        trustSection.appendChild(questionDiv);
      });
    }
    
    root.appendChild(trustSection);
  }
  
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "button-group";
  
  const continueBtn = document.createElement("button");
  continueBtn.textContent = "המשך";
  continueBtn.onclick = () => {
    // Collect all answers
    const answers = {};
    
    if (state.questionsConfig && state.questionsConfig.model_summary_questions) {
      // Collect workload answers
      if (state.questionsConfig.model_summary_questions.workload) {
        state.questionsConfig.model_summary_questions.workload.forEach(question => {
          const selected = document.querySelector(`input[name="model_workload_${question.id}"]:checked`);
          answers[question.id] = selected ? parseInt(selected.value) : (state.debugMode ? "DBG" : null);
        });
      }
      
      // Collect trust answers
      if (state.questionsConfig.model_summary_questions.trust) {
        state.questionsConfig.model_summary_questions.trust.forEach(question => {
          const selected = document.querySelector(`input[name="model_trust_${question.id}"]:checked`);
          answers[question.id] = selected ? parseInt(selected.value) : (state.debugMode ? "DBG" : null);
        });
      }
    }
    
    logPageExit(pageName);
    
    // Log questionnaire
    state.logs.questionnaires.push({
      trial_id: null,
      participant_id: state.participantId,
      stage: state.stage,
      condition_index: state.conditionIndex,
      model_index: state.modelIndex,
      trial_index: null,
      questionnaire_type: "model_summary",
      answers: answers,
      correct: null,
      enter_ts: state.currentPageEnterTs,
      exit_ts: Date.now()
    });
    
    // Navigate to next model or condition
    if (state.modelIndex < cond.models.length - 1) {
      state.modelIndex++;
      state.pageType = "model_intro";
      render();
    } else {
      // Finished both models in this condition, go to visualization condition question
      state.pageType = "visualization_condition";
      render();
    }
  };
  buttonGroup.appendChild(continueBtn);
  
  root.appendChild(buttonGroup);
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
  
  // Radio buttons 1-7
  const radioGroup = document.createElement("div");
  radioGroup.style.display = "flex";
  radioGroup.style.gap = "10px";
  radioGroup.style.justifyContent = "center";
  
  for (let i = 1; i <= 7; i++) {
    const radioWrapper = document.createElement("div");
    radioWrapper.style.display = "flex";
    radioWrapper.style.flexDirection = "row";
    radioWrapper.style.alignItems = "center";
    radioWrapper.style.gap = "6px";
    
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = namePrefix;
    radio.value = i;
    radio.id = `${namePrefix}_${i}`;
    radio.required = true;
    
    const radioLabel = document.createElement("label");
    radioLabel.setAttribute("for", `${namePrefix}_${i}`);
    radioLabel.textContent = i;
    radioLabel.style.fontSize = "14px";
    radioLabel.style.marginTop = "0";
    radioLabel.style.marginRight = "0";
    radioLabel.style.marginLeft = "0";
    radioLabel.style.cursor = "pointer";
    
    radioWrapper.appendChild(radio);
    radioWrapper.appendChild(radioLabel);
    radioGroup.appendChild(radioWrapper);
  }
  
  questionDiv.appendChild(radioGroup);
  return questionDiv;
}

function renderVisualizationConditionPage(root) {
  const cond = state.schedule.conditions[state.conditionIndex];
  const pageName = `VisualizationConditionPage_C${state.conditionIndex}`;
  logPageEntry(pageName, {
    condition_index: state.conditionIndex,
    visualization: cond.visualization
  });
  
  root.innerHTML = "";
  
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = `שאלה לאחר תנאי ויזואליזציה ${state.conditionIndex + 1}`;
  title.dir = "rtl";
  root.appendChild(title);
  
  // Get question from questionsConfig
  let questionData = null;
  if (state.questionsConfig && state.questionsConfig.visualization_condition_question) {
    questionData = state.questionsConfig.visualization_condition_question;
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
        radio.name = "visualization_condition_preference";
        radio.value = option;
        radio.id = `viz_cond_opt_${idx}`;
        radio.required = true;
        
        const radioLabel = document.createElement("label");
        radioLabel.setAttribute("for", `viz_cond_opt_${idx}`);
        radioLabel.textContent = option;
        radioLabel.dir = "rtl";
        radioLabel.style.marginRight = "0";
        radioLabel.style.cursor = "pointer";
        
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
    const selected = document.querySelector('input[name="visualization_condition_preference"]:checked');
    
    if (!selected && !state.debugMode) {
      alert("אנא בחר מודל מועדף");
      return;
    }
    
    logPageExit(pageName);
    
    // Log questionnaire
    state.logs.questionnaires.push({
      trial_id: null,
      participant_id: state.participantId,
      stage: state.stage,
      condition_index: state.conditionIndex,
      model_index: null,
      trial_index: null,
      questionnaire_type: "visualization_condition",
      answers: selected ? { model_preference: selected.value } : (state.debugMode ? { model_preference: "DBG" } : null),
      correct: null,
      enter_ts: state.currentPageEnterTs,
      exit_ts: Date.now()
    });
    
    // Navigate to next condition or global questions
    if (state.conditionIndex < state.schedule.conditions.length - 1) {
      state.conditionIndex++;
      state.modelIndex = 0;
      state.pageType = "info";
      render();
    } else {
      // Finished all conditions, go to visualization global question
      state.stage = "post";
      state.pageType = "visualization_global";
      render();
    }
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
    
    // Rank 1-3 for each visualization
    if (questionData.options && questionData.options.length > 0) {
      questionData.options.forEach((option, idx) => {
        const optionWrapper = document.createElement("div");
        optionWrapper.style.marginBottom = "15px";
        optionWrapper.style.display = "flex";
        optionWrapper.style.alignItems = "center";
        optionWrapper.style.gap = "10px";
        
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
        
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = "בחר דירוג";
        select.appendChild(placeholderOption);
        
        for (let rank = 1; rank <= 3; rank++) {
          const option = document.createElement("option");
          option.value = rank;
          option.textContent = rank;
          select.appendChild(option);
        }
        
        optionWrapper.appendChild(optionLabel);
        optionWrapper.appendChild(select);
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
    // Validate all rankings are selected (skip in debug mode)
    if (!state.debugMode && questionData && questionData.options) {
      for (let idx = 0; idx < questionData.options.length; idx++) {
        const select = document.getElementById(`viz_global_rank_${idx}`);
        if (!select || !select.value) {
          alert("אנא דרג את כל התצוגות");
          return;
        }
      }
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
    label.style.fontWeight = "600";
    questionDiv.appendChild(label);
    
    if (question.type === "number" || question.type === "text") {
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
          
          optionWrapper.appendChild(radio);
          optionWrapper.appendChild(radioLabel);
          questionDiv.appendChild(optionWrapper);
        });
      }
    } else if (question.type === "scale_1_7") {
      const radioGroup = document.createElement("div");
      radioGroup.style.display = "flex";
      radioGroup.style.gap = "10px";
      radioGroup.style.justifyContent = "center";
      
      for (let i = 1; i <= 7; i++) {
        const radioWrapper = document.createElement("div");
        radioWrapper.style.display = "flex";
        radioWrapper.style.flexDirection = "row";
        radioWrapper.style.alignItems = "center";
        radioWrapper.style.gap = "6px";
        
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = question.id;
        radio.value = i;
        radio.id = `demo_${question.id}_${i}`;
        
        const radioLabel = document.createElement("label");
        radioLabel.setAttribute("for", `demo_${question.id}_${i}`);
        radioLabel.textContent = i;
        radioLabel.style.fontSize = "14px";
        radioLabel.style.marginTop = "0";
        radioLabel.style.marginRight = "0";
        radioLabel.style.marginLeft = "0";
        radioLabel.style.cursor = "pointer";
        
        radioWrapper.appendChild(radio);
        radioWrapper.appendChild(radioLabel);
        radioGroup.appendChild(radioWrapper);
      }
      
      questionDiv.appendChild(radioGroup);
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
      if (question.type === "number" || question.type === "text") {
        const input = document.getElementById(`demo_${question.id}`);
        if (input) {
          if (input.value.trim()) {
            answers[question.id] = question.type === "number" ? 
              parseInt(input.value) : input.value;
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
  content.textContent = "תודה על השתתפותך בניסוי. לחץ/י למטה כדי לשמור את קובץ הלוג.";
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
    if (state.pageType === "info") {
      renderConditionIntroPage(root);
    } else if (state.pageType === "model_intro") {
      renderModelIntroPage(root);
    } else if (state.pageType === "scenario_intro") {
      renderScenarioIntroPage(root);
    } else if (state.pageType === "trial") {
      renderTrialPage(root);
    } else if (state.pageType === "trial_questions") {
      renderTrialQuestionsPage(root);
    } else if (state.pageType === "model_summary") {
      renderModelSummaryPage(root);
    } else if (state.pageType === "visualization_condition") {
      renderVisualizationConditionPage(root);
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
    state.currentTrialSelectedRoute = event.data.route;
    console.log("Route selected from scenario:", event.data.route, "for scenario:", event.data.scenarioName);
    
    // Automatically navigate to next page after confirmation
    const t = getCurrentTrial();
    if (t && state.pageType === "trial") {
      // Use selected route from iframe
      const userRoute = event.data.route || t.ai_recommended_route;
      const followedAi = userRoute === t.ai_recommended_route;
      const choseOptimal = userRoute === t.correct_route;
      
      const trialKey = getCurrentTrialKey();
      const trialLog = {
        trial_id: trialKey,
        participant_id: state.participantId,
        stage: state.stage,
        condition_index: (state.stage === "experiment" ? state.conditionIndex : null),
        model_index: (state.stage === "experiment" ? state.modelIndex : null),
        trial_index: (state.stage === "practice" ? state.practiceIndex : state.trialIndex),
        scenario_id: t.scenario_id,
        difficulty: t.difficulty,
        true_route: t.correct_route,
        ai_route: t.ai_recommended_route,
        model_type: (state.stage === "experiment"
                     ? state.schedule.conditions[state.conditionIndex].models[state.modelIndex].model_type
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

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  render();
});

