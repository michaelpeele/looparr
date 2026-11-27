'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  const dom = {
    connection: $('connection'),
    connectionText: $('connection-text'),
    navToggle: $('nav-toggle'),
    sidebar: $('sidebar'),
    sidebarNav: $('sidebar-nav'),
    sidebarBackdrop: $('sidebar-backdrop'),
    settingsForm: $('settings-form'),
    maxConcurrent: $('max-concurrent'),
    mode: $('mode'),
    globalRunner: $('global-runner'),
    model: $('model'),
    seedModel: $('seed-model'),
    analyzeModel: $('analyze-model'),
    implementModel: $('implement-model'),
    planModel: $('plan-model'),
    rateLimitSeconds: $('rate-limit-seconds'),
    cooloffSeconds: $('cooloff-seconds'),
    blockThreshold: $('block-threshold'),
    temporaryLiftScope: $('temporary-lift-scope'),
    permanentLift: $('permanent-lift'),
    seedPromptTemplate: $('seed-prompt-template'),
    analyzePromptTemplate: $('analyze-prompt-template'),
    implementPromptTemplate: $('implement-prompt-template'),
    planQuestionsPromptTemplate: $('plan-questions-prompt-template'),
    planWritePromptTemplate: $('plan-write-prompt-template'),
    promptCliToolsNote: $('prompt-cli-tools-note'),
    stickyAddTaskRow: $('sticky-add-task-row'),
    paseoTransport: $('paseo-transport'),
    handoffRecovery: $('handoff-recovery-toggle'),
    selfHealing: $('self-healing-toggle'),
    showCardAccessRoute: $('show-card-access-route'),
    selfHealPill: $('self-heal-pill'),
    selfHealState: $('self-heal-state'),
    selfHealBranch: $('self-heal-branch'),
    settingsStatus: $('settings-status'),
    envSettingsForm: $('env-settings-form'),
    envSettingsFields: $('env-settings-fields'),
    envSettingsStatus: $('env-settings-status'),
    hostRunner: $('host-runner'),
    hostRunnerDetail: $('host-runner-detail'),
    settingsBadge: $('settings-badge'),
    settingsGear: document.querySelector('button.side-link[data-view="settings"]'),
    addForm: $('add-form'),
    projectPath: $('project-path'),
    projectPathSuggestions: $('project-path-suggestions'),
    projectFolders: $('project-folders'),
    createFolder: $('create-folder'),
    browseFolders: $('browse-folders'),
    rootFolderCreate: $('root-folder-create'),
    newRootFolderName: $('new-root-folder-name'),
    confirmRootFolder: $('confirm-root-folder'),
    cancelRootFolder: $('cancel-root-folder'),
    rootFolderStatus: $('root-folder-status'),
    folderBrowser: $('folder-browser'),
    folderBrowserTitle: $('folder-browser-title'),
    folderBrowserClose: $('folder-browser-close'),
    folderUp: $('folder-up'),
    folderRoot: $('folder-root'),
    folderCurrent: $('folder-current'),
    folderBrowserList: $('folder-browser-list'),
    folderSelected: $('folder-selected'),
    folderSelect: $('folder-select'),
    browserFolderCreate: $('browser-folder-create'),
    newBrowserFolderName: $('new-browser-folder-name'),
    confirmBrowserFolder: $('confirm-browser-folder'),
    folderBrowserStatus: $('folder-browser-status'),
    projectName: $('project-name'),
    projectRunner: $('project-runner'),
    drawerRunner: $('drawer-runner'),
    projectModel: $('project-model'),
    projectSeedModel: $('project-seed-model'),
    projectAnalyzeModel: $('project-analyze-model'),
    projectImplementModel: $('project-implement-model'),
    projectPlanModel: $('project-plan-model'),
    projectBlockThreshold: $('project-block-threshold'),
    projectCooloffSeconds: $('project-cooloff-seconds'),
    projectTemporaryLiftScope: $('project-temporary-lift-scope'),
    projectPermanentLift: $('project-permanent-lift'),
    addStatus: $('add-status'),
    projectGrid: $('project-grid'),
    emptyState: $('empty-state'),
    drawerBackdrop: $('drawer-backdrop'),
    drawer: $('drawer'),
    drawerClose: $('drawer-close'),
    drawerVisual: $('drawerProjectVisual'),
    drawerTitle: $('drawer-title'),
    drawerPath: $('drawer-path'),
    drawerStatus: $('drawer-status'),
    drawerTask: $('drawer-task'),
    drawerTaskToggle: $('drawer-task-toggle'),
    drawerNext: $('drawer-next'),
    drawerNextToggle: $('drawer-next-toggle'),
    drawerControls: $('drawer-controls'),
    drawerControlStatus: $('drawer-control-status'),
    drawerBlockPolicy: $('drawer-block-policy'),
    drawerModel: $('drawer-model'),
    drawerCardModel: $('drawer-card-model'),
    drawerModelInput: $('drawer-model-input'),
    drawerSeedModel: $('drawer-seed-model'),
    drawerAnalyzeModel: $('drawer-analyze-model'),
    drawerImplementModel: $('drawer-implement-model'),
    drawerPlanModel: $('drawer-plan-model'),
    projectModelStatus: $('project-model-status'),
    saveProjectModel: $('save-project-model'),
    drawerAutoResume: $('drawer-auto-resume'),
    autoResumeToggle: $('auto-resume-toggle'),
    autoResumeStatus: $('auto-resume-status'),
    saveAutoResume: $('save-auto-resume'),
    answerStatus: $('answer-status'),
    answerEditor: $('answer-editor'),
    refreshAnswer: $('refresh-answer'),
    saveAnswer: $('save-answer'),
    confirmPlan: $('confirm-plan'),
    planConfirmStatus: $('plan-confirm-status'),
    taskInput: $('task-input'),
    addTask: $('add-task'),
    taskLinkDoc: $('task-link-doc'),
    taskDocFile: $('task-doc-file'),
    taskStatus: $('task-status'),
    taskAddRow: document.querySelector('.task-add-row'),
    toggleCompletedTasks: $('toggle-completed-tasks'),
    planStatus: $('plan-status'),
    dependencyStatus: $('dependency-status'),
    checklist: $('checklist'),
    planGuide: $('plan-guide'),
    planGuideSummary: $('plan-format-hint'),
    planEditor: $('plan-editor'),
    insertPlan: $('insert-plan'),
    savePlan: $('save-plan'),
    logList: $('log-list'),
    logStatus: $('log-status'),
    logFollow: $('log-follow'),
    blockPolicyStatus: $('block-policy-status'),
    drawerBlockThreshold: $('drawer-block-threshold'),
    drawerCooloffSeconds: $('drawer-cooloff-seconds'),
    drawerTemporaryLiftScope: $('drawer-temporary-lift-scope'),
    drawerPermanentLift: $('drawer-permanent-lift'),
    saveBlockPolicy: $('save-block-policy'),
    drawerSprintMode: $('drawer-sprint-mode'),
    drawerSprintTestCommand: $('drawer-sprint-test-command'),
    drawerSprintsParallel: $('drawer-sprints-parallel'),
    drawerSprintDeployMain: $('drawer-sprint-deploy-main'),
    drawerSprintList: $('drawer-sprint-list'),
    drawerNewSprint: $('drawer-new-sprint'),
    addSprint: $('add-sprint'),
    saveSprintSettings: $('save-sprint-settings'),
    sprintMerge: $('sprint-merge'),
    sprintStatus: $('sprint-status'),
    sprintSummary: $('sprint-summary'),
    taskSprintSelect: $('task-sprint-select'),
    taskValidationType: $('task-validation-type'),
    taskInsertPosition: $('task-insert-position'),
    taskInsertAfter: $('task-insert-after'),
    planFileModal: $('plan-file-modal'),
    planFileTitle: $('plan-file-title'),
    planFileContent: $('plan-file-content'),
    planFileStatus: $('plan-file-status'),
    planFileSave: $('plan-file-save'),
    planFileCancel: $('plan-file-cancel'),
    planFileClose: $('plan-file-close'),
    terminalOverlay: $('terminal-overlay'),
    terminalPanel: $('terminal-panel'),
    terminalTitle: $('terminal-title'),
    terminalClose: $('terminal-close'),
    terminalFollow: $('terminal-follow'),
    terminalLogList: $('terminal-log-list'),
    drawerTerminalButton: $('drawer-terminal-button')
  };

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const STATUS = {
    idle: ['Idle', 'idle'],
    seed: ['Seed', 'seed'],
    planQuestions: ['Plan Questions', 'plan-questions'],
    planWrite: ['Plan Write', 'plan-write'],
    waitingAnswer: ['Waiting for Answer', 'waiting-answer'],
    waitingConfirm: ['Plan ready for review', 'waiting-confirm'],
    analyze: ['Analyze', 'analyze'],
    implement: ['Implement', 'implement'],
    paused: ['Paused', 'paused'],
    rateLimited: ['Rate Limited', 'rate-limited'],
    done: ['Done', 'done'],
    error: ['Error', 'error'],
    setup: ['Setup Needed', 'setup']
  };

const STARTER_PLAN = '# Build plan\n\n- [ ] First task\n- [ ] Second task\n';
const TASK_LINE_RE = /^\s*[-*+]\s+\[[ xX]\]\s*/;
const TASK_EDIT_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*)$/;
const PLAN_FILE_PREFIXES = 'PLAN|plan|PROMPT|prompt|ANALYSIS|analysis|RESEARCH|research|INVESTIGATION|investigation|HANDOFF|handoff|PROGRESS|progress';
  // Model ids are scoped per runner: an OpenCode id must never reach the Kilo
  // CLI and a `kilo/*` id must never reach OpenCode. `/api/state` carries each
  // runner's catalogue from `src/runners/*.js`; these copies only cover the
  // first paint before state arrives. A runner missing here accepts no model
  // ids at all (Vibe offers its account's free-lane aliases).
  const MODEL_OPTIONS_BY_RUNNER = {
    opencode: [
      'opencode/big-pickle',
      'opencode/tidepool-alpha-free',
      'opencode/hy4-flash-free',
      'opencode/iceman-free',
      'opencode/longcat-2.5-free',
      'opencode/flint-40b-free',
      'opencode/deepseek-v4.1-flash-free',
      'opencode/nemotron-3.5-super-vl-free',
      'opencode/beam-free',
      'opencode/mimo-v2.6-flash-free',
      'opencode/nemotron-3.5-lightning-free',
      'kilo/baidu/ernie-5.5-flash-preview:free',
      'kilo/reflection/beam-free',
      'kilo/recursive/flint-v1.0:free',
      'kilo/nvidia/nemotron-3-ultra-550b-a55b:free',
      'kilo/nvidia/nemotron-3.5-lightning:free',
      'kilo/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'kilo/inclusionai/ling-3.2-flash:free',
      'kilo/particle-ai/particle-1:free',
      'kilo/liquid/lfm-3-1.7b:free'
    ],
    kilo: [
      'kilo/baidu/ernie-5.5-flash-preview:free',
      'kilo/reflection/beam-free',
      'kilo/recursive/flint-v1.0:free',
      'kilo/nvidia/nemotron-3-ultra-550b-a55b:free',
      'kilo/nvidia/nemotron-3.5-lightning:free',
      'kilo/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'kilo/inclusionai/ling-3.2-flash:free',
      'kilo/particle-ai/particle-1:free',
      'kilo/liquid/lfm-3-1.7b:free'
    ],
    vibe: [
      'zai-glm-5-3-flash-vibe-free',
      'zai-glm-5-3-flash'
    ]
  };

  // Every model dropdown owns its own rotation toggle. The select id is the
  // stable anchor; the field name is what the server stores.
  const MODEL_ROTATION_TARGETS = [
    { select: 'model', field: 'modelRotation' },
    { select: 'seed-model', field: 'seedRotation' },
    { select: 'analyze-model', field: 'analyzeRotation' },
    { select: 'implement-model', field: 'implementRotation' },
    { select: 'plan-model', field: 'planRotation' },
    { select: 'project-model', field: 'modelRotation' },
    { select: 'project-seed-model', field: 'seedRotation' },
    { select: 'project-analyze-model', field: 'analyzeRotation' },
    { select: 'project-implement-model', field: 'implementRotation' },
    { select: 'project-plan-model', field: 'planRotation' },
    { select: 'drawer-model-input', field: 'modelRotation' },
    { select: 'drawer-seed-model', field: 'seedRotation' },
    { select: 'drawer-analyze-model', field: 'analyzeRotation' },
    { select: 'drawer-implement-model', field: 'implementRotation' },
    { select: 'drawer-plan-model', field: 'planRotation' },
    { select: 'global-runner', field: 'runnerRotation' },
    { select: 'project-runner', field: 'runnerRotation' },
    { select: 'drawer-runner', field: 'runnerRotation' }
  ];
  // Explicit groups (not index slices) so a new plan field never leaks into
  // the wrong form: global settings, add-project, drawer.
  const GLOBAL_ROTATION_TARGETS = MODEL_ROTATION_TARGETS.filter((target) =>
    ['model', 'seed-model', 'analyze-model', 'implement-model', 'plan-model'].includes(target.select)
  );
  const PROJECT_SETUP_ROTATION_TARGETS = MODEL_ROTATION_TARGETS.filter((target) =>
    ['project-model', 'project-seed-model', 'project-analyze-model', 'project-implement-model', 'project-plan-model'].includes(target.select)
  );
  const DRAWER_ROTATION_TARGETS = MODEL_ROTATION_TARGETS.filter((target) =>
    ['drawer-model-input', 'drawer-seed-model', 'drawer-analyze-model', 'drawer-implement-model', 'drawer-plan-model', 'drawer-runner'].includes(target.select)
  );

  // Local mirrors of src/model-list.js; browser code cannot use Node modules.
  function modelList(value) {
    if (value === undefined || value === null || value === '') return [];
    if (typeof value !== 'string') return [];
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }

  function joinModelList(ids) {
    const seen = new Set();
    const unique = [];
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
    }
    return unique.join(',');
  }

  const app = {
    state: null,
    view: 'projects',
    logs: new Map(),
    drawerId: null,
    terminalId: null,
    logFollow: true,
    terminalFollow: true,
    planDirty: false,
    showCompleted: false,
    savingPlan: false,
    currentPlan: null,
    planTaskCount: 0,
    autoResumeDirty: false,
    lastPlanKey: '',
    planGuideTouched: false,
    nameTouched: false,
    runnerTouched: false,
    envSettings: [],
    envDirty: new Set(),
    envInputs: new Map(),
    browser: {
      relative: '',
      parent: null,
      current: '',
      root: '',
      selected: null,
      folders: []
    }
  };

  let planSaveChain = Promise.resolve();
  let planSavePending = 0;
  let planDrag = null;
  let suppressPlanClick = false;
  let editingTaskIndex = -1;

  const TASK_EXPANSION_KEY = 'looparr.taskExpansion.v1';
  const TASK_FIELDS = ['current', 'next'];
  let expansionMemory = null;
  let expansionStorageAvailable = true;
  let taskTextCounter = 0;

  const SHOW_COMPLETED_KEY = 'looparr.showCompleted.v1';
  let showCompletedMemory = null;
  let showCompletedStorageAvailable = true;

  function normalizeExpansionState(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    Object.keys(raw).forEach((projectId) => {
      const entry = raw[projectId];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const normalized = {};
      TASK_FIELDS.forEach((field) => { normalized[field] = entry[field] === true; });
      result[String(projectId)] = normalized;
    });
    return result;
  }

  function loadExpansionState() {
    if (expansionMemory !== null) return normalizeExpansionState(expansionMemory);
    try {
      const raw = localStorage.getItem(TASK_EXPANSION_KEY);
      expansionMemory = normalizeExpansionState(raw ? JSON.parse(raw) : null);
      return normalizeExpansionState(expansionMemory);
    } catch {
      expansionStorageAvailable = false;
      expansionMemory = normalizeExpansionState(expansionMemory);
      return normalizeExpansionState(expansionMemory);
    }
  }

  function saveExpansionState(state) {
    expansionMemory = normalizeExpansionState(state);
    if (!expansionStorageAvailable) return;
    try {
      localStorage.setItem(TASK_EXPANSION_KEY, JSON.stringify(expansionMemory));
    } catch {
      expansionStorageAvailable = false;
    }
  }

  function isTaskExpanded(projectId, field) {
    if (!projectId || !TASK_FIELDS.includes(field)) return false;
    return loadExpansionState()[String(projectId)]?.[field] === true;
  }

  function setTaskExpansion(projectId, field, expanded) {
    if (!projectId || !TASK_FIELDS.includes(field)) return;
    const state = loadExpansionState();
    if (!state[String(projectId)]) state[String(projectId)] = { current: false, next: false };
    state[String(projectId)][field] = Boolean(expanded);
    saveExpansionState(state);
  }

  function normalizeShowCompletedState(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    Object.keys(raw).forEach((projectId) => {
      result[String(projectId)] = raw[projectId] === true;
    });
    return result;
  }

  function loadShowCompletedState() {
    if (showCompletedMemory !== null) return normalizeShowCompletedState(showCompletedMemory);
    try {
      const raw = localStorage.getItem(SHOW_COMPLETED_KEY);
      showCompletedMemory = normalizeShowCompletedState(raw ? JSON.parse(raw) : null);
      return normalizeShowCompletedState(showCompletedMemory);
    } catch {
      showCompletedStorageAvailable = false;
      showCompletedMemory = normalizeShowCompletedState(showCompletedMemory);
      return normalizeShowCompletedState(showCompletedMemory);
    }
  }

  function saveShowCompletedState(state) {
    showCompletedMemory = normalizeShowCompletedState(state);
    if (!showCompletedStorageAvailable) return;
    try {
      localStorage.setItem(SHOW_COMPLETED_KEY, JSON.stringify(showCompletedMemory));
    } catch {
      showCompletedStorageAvailable = false;
    }
  }

  function isShowCompleted(projectId) {
    if (!projectId) return false;
    return loadShowCompletedState()[String(projectId)] === true;
  }

  function setShowCompleted(projectId, show) {
    if (!projectId) return;
    const state = loadShowCompletedState();
    state[String(projectId)] = show === true;
    saveShowCompletedState(state);
  }

  function restoreShowCompletedForProject(id) {
    app.showCompleted = isShowCompleted(id);
    updateToggleCompletedButton();
  }

  const TASK_LINK_DOC_KEY = 'looparr.taskLinkDoc';
  let taskLinkDocMemory = null;
  let taskLinkDocStorageAvailable = true;

  function loadTaskLinkDocState() {
    if (taskLinkDocMemory !== null) return taskLinkDocMemory;
    if (!taskLinkDocStorageAvailable) return false;
    try {
      const raw = localStorage.getItem(TASK_LINK_DOC_KEY);
      taskLinkDocMemory = raw === 'true';
      return taskLinkDocMemory;
    } catch {
      taskLinkDocStorageAvailable = false;
      return false;
    }
  }

  function saveTaskLinkDocState(value) {
    const next = value === true;
    taskLinkDocMemory = next;
    if (!taskLinkDocStorageAvailable) return;
    try {
      localStorage.setItem(TASK_LINK_DOC_KEY, String(next));
    } catch {
      taskLinkDocStorageAvailable = false;
    }
  }

  const UI_STATE_KEY = 'looparr.uiState.v1';
  const UI_SECTION_KEYS = ['constraint', 'runner', 'startup', 'questions', 'plan', 'logs', 'sprints'];
  let uiStateMemory = null;
  let uiStateStorageAvailable = true;

  function normalizeUiProjectId(projectId) {
    if (projectId === null || projectId === undefined) return null;
    if (typeof projectId === 'object') return null;
    const key = String(projectId);
    return key.trim() ? key : null;
  }

  function normalizeUiState(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    Object.keys(raw).forEach((rawId) => {
      const key = normalizeUiProjectId(rawId);
      if (!key) return;
      const entry = raw[rawId];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const normalized = {};
      if (entry.sections && typeof entry.sections === 'object' && !Array.isArray(entry.sections)) {
        const sections = {};
        UI_SECTION_KEYS.forEach((sectionKey) => {
          if (typeof entry.sections[sectionKey] === 'boolean') sections[sectionKey] = entry.sections[sectionKey];
        });
        if (Object.keys(sections).length) normalized.sections = sections;
      }
      if (entry.planGuide && typeof entry.planGuide === 'object' && !Array.isArray(entry.planGuide)) {
        const planGuide = {};
        if (typeof entry.planGuide.open === 'boolean') planGuide.open = entry.planGuide.open;
        if (typeof entry.planGuide.touched === 'boolean') planGuide.touched = entry.planGuide.touched;
        if (Object.keys(planGuide).length) normalized.planGuide = planGuide;
      }
      if (typeof entry.logFollow === 'boolean') normalized.logFollow = entry.logFollow;
      if (Object.keys(normalized).length) result[key] = normalized;
    });
    return result;
  }

  function loadUiState() {
    if (uiStateMemory !== null) return normalizeUiState(uiStateMemory);
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      uiStateMemory = normalizeUiState(raw ? JSON.parse(raw) : null);
      return normalizeUiState(uiStateMemory);
    } catch {
      uiStateStorageAvailable = false;
      uiStateMemory = normalizeUiState(uiStateMemory);
      return normalizeUiState(uiStateMemory);
    }
  }

  function saveUiState(state) {
    uiStateMemory = normalizeUiState(state);
    if (!uiStateStorageAvailable) return;
    try {
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(uiStateMemory));
    } catch {
      uiStateStorageAvailable = false;
    }
  }

  function getProjectUiState(id) {
    const key = normalizeUiProjectId(id);
    if (!key) return null;
    return loadUiState()[key] || null;
  }

  function setProjectUiState(id, patch) {
    const key = normalizeUiProjectId(id);
    if (!key || !patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    const normalizedPatch = normalizeUiState({ [key]: patch })[key];
    if (!normalizedPatch) return;
    const state = loadUiState();
    const current = state[key] || {};
    const next = Object.assign({}, current);
    if (normalizedPatch.sections) {
      next.sections = Object.assign({}, current.sections || {}, normalizedPatch.sections);
    }
    if (normalizedPatch.planGuide) {
      next.planGuide = Object.assign({}, current.planGuide || {}, normalizedPatch.planGuide);
    }
    if (typeof normalizedPatch.logFollow === 'boolean') next.logFollow = normalizedPatch.logFollow;
    state[key] = next;
    saveUiState(state);
  }

  function isSectionOpen(id, sectionKey) {
    const key = normalizeUiProjectId(id);
    if (!key || !UI_SECTION_KEYS.includes(sectionKey)) return null;
    const value = loadUiState()[key]?.sections?.[sectionKey];
    return typeof value === 'boolean' ? value : null;
  }

  function setSectionOpen(id, sectionKey, open) {
    const key = normalizeUiProjectId(id);
    if (!key || !UI_SECTION_KEYS.includes(sectionKey)) return;
    setProjectUiState(key, { sections: { [sectionKey]: open === true } });
  }

  function getPlanGuideState(id) {
    const entry = getProjectUiState(id);
    return {
      open: entry?.planGuide?.open === true,
      touched: entry?.planGuide?.touched === true,
    };
  }

  function setPlanGuideState(id, open, touched) {
    const key = normalizeUiProjectId(id);
    if (!key) return;
    setProjectUiState(key, { planGuide: { open: open === true, touched: touched === true } });
  }

  function getLogFollow(id) {
    const entry = getProjectUiState(id);
    return typeof entry?.logFollow === 'boolean' ? entry.logFollow : true;
  }

  function setLogFollow(id, value) {
    const key = normalizeUiProjectId(id);
    if (!key) return;
    setProjectUiState(key, { logFollow: value === true });
  }

  function setSectionDomOpen(sectionKey, open) {
    const section = document.querySelector(`[data-section="${sectionKey}"]`);
    if (!section) return;
    const toggle = section.querySelector('[data-action="toggle-section"]');
    if (!toggle) return;
    const bodyId = toggle.getAttribute('aria-controls');
    const body = bodyId ? document.getElementById(bodyId) : null;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (body) body.hidden = !open;
  }

  function syncSectionStates(id) {
    const key = normalizeUiProjectId(id);
    if (!key) return;
    UI_SECTION_KEYS.forEach((sectionKey) => {
      const open = isSectionOpen(key, sectionKey);
      if (typeof open === 'boolean') setSectionDomOpen(sectionKey, open);
    });
  }

  function applyAutoEmptySections(id) {
    const key = normalizeUiProjectId(id);
    if (!key || app.drawerId !== key) return;
    const sections = getProjectUiState(key)?.sections || {};
    ['questions', 'logs'].forEach((sectionKey) => {
      if (Object.prototype.hasOwnProperty.call(sections, sectionKey)) return;
      const empty = sectionKey === 'questions'
        ? dom.answerEditor.value.trim() === ''
        : (app.logs.get(key)?.entries.length || 0) === 0;
      setSectionDomOpen(sectionKey, !empty);
    });
    // Plan waiting states keep their sections visible even while fields are
    // still empty, so the human gate is impossible to miss.
    const project = projectById(key);
    if (project?.status === 'waitingAnswer' && !Object.prototype.hasOwnProperty.call(sections, 'questions')) {
      setSectionDomOpen('questions', true);
    }
    if (project?.status === 'waitingConfirm' && !Object.prototype.hasOwnProperty.call(sections, 'plan')) {
      setSectionDomOpen('plan', true);
    }
  }

  function restoreUiStateForProject(id) {
    const key = normalizeUiProjectId(id);
    if (!key) return;
    const guide = getPlanGuideState(key);
    app.planGuideTouched = guide.touched === true;
    if (app.planGuideTouched) dom.planGuide.open = guide.open === true;
    app.logFollow = getLogFollow(key);
    syncSectionStates(key);
  }

  const GLOBAL_SETTINGS_UI_STATE_KEY = 'looparr.settingsUiState.v1';
  const SETTINGS_UI_KEYS = ['promptTemplates', 'promptOptions', 'blockPolicy', 'envSettings'];
  let settingsUiMemory = null;
  let settingsUiStorageAvailable = true;

  function normalizeSettingsUiState(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    SETTINGS_UI_KEYS.forEach((key) => {
      if (typeof raw[key] === 'boolean') result[key] = raw[key];
    });
    return result;
  }

  function loadSettingsUiState() {
    if (settingsUiMemory !== null) return normalizeSettingsUiState(settingsUiMemory);
    try {
      const raw = localStorage.getItem(GLOBAL_SETTINGS_UI_STATE_KEY);
      settingsUiMemory = normalizeSettingsUiState(raw ? JSON.parse(raw) : null);
      return normalizeSettingsUiState(settingsUiMemory);
    } catch {
      settingsUiStorageAvailable = false;
      settingsUiMemory = normalizeSettingsUiState(settingsUiMemory);
      return normalizeSettingsUiState(settingsUiMemory);
    }
  }

  function saveSettingsUiState(state) {
    settingsUiMemory = normalizeSettingsUiState(state);
    if (!settingsUiStorageAvailable) return;
    try {
      localStorage.setItem(GLOBAL_SETTINGS_UI_STATE_KEY, JSON.stringify(settingsUiMemory));
    } catch {
      settingsUiStorageAvailable = false;
    }
  }

  function getSettingsUiState() {
    return loadSettingsUiState();
  }

  function setSettingsUiState(key, open) {
    if (!SETTINGS_UI_KEYS.includes(key)) return;
    const state = loadSettingsUiState();
    state[key] = open === true;
    saveSettingsUiState(state);
  }

  function syncSettingsUiState() {
    const state = getSettingsUiState();
    SETTINGS_UI_KEYS.forEach((key) => {
      if (typeof state[key] !== 'boolean') return;
      const details = document.querySelector(`[data-settings-section="${key}"]`);
      if (details) details.open = state[key];
    });
  }

  function hasTaskOverflow(textEl) {
    if (!textEl) return false;
    return textEl.scrollHeight > textEl.clientHeight + 1;
  }

  function syncTaskExpansion(projectId, field) {
    if (!TASK_FIELDS.includes(field)) return;
    const targetId = String(projectId ?? '');
    document.querySelectorAll(`[data-project-id][data-task-field="${field}"]`).forEach((wrapper) => {
      if (wrapper.dataset.projectId !== targetId) return;
      const textEl = wrapper.querySelector('.task-detail-text');
      const toggle = wrapper.querySelector('.task-expand-toggle');
      if (!textEl || !toggle) return;
      const text = (textEl.textContent || '').trim();
      const isFallback = wrapper.dataset.fallback === 'true';
      textEl.classList.remove('task-detail-expanded');
      textEl.classList.add('task-detail-clamped');
      const overflow = hasTaskOverflow(textEl);
      const canToggle = Boolean(text) && text !== '—' && !isFallback && overflow;
      const visuallyExpanded = canToggle && isTaskExpanded(projectId, field);
      toggle.hidden = !canToggle;
      textEl.classList.toggle('task-detail-clamped', !visuallyExpanded);
      textEl.classList.toggle('task-detail-expanded', visuallyExpanded);
      const verb = visuallyExpanded ? 'Collapse' : 'Expand';
      const label = field === 'current' ? 'current task' : 'up next';
      toggle.textContent = visuallyExpanded ? '▲' : '▼';
      toggle.setAttribute('aria-expanded', String(visuallyExpanded));
      toggle.setAttribute('aria-label', `${verb} ${label}`);
      toggle.setAttribute('title', `${verb} ${label}`);
    });
  }

  function syncAllTaskExpansion() {
    const seen = new Set();
    document.querySelectorAll('[data-project-id][data-task-field]').forEach((wrapper) => {
      const key = `${wrapper.dataset.projectId}\u0000${wrapper.dataset.taskField}`;
      if (seen.has(key)) return;
      seen.add(key);
      syncTaskExpansion(wrapper.dataset.projectId, wrapper.dataset.taskField);
    });
  }

  function activateTaskToggle(button) {
    const wrapper = button.closest?.('[data-project-id][data-task-field]');
    if (!wrapper) return;
    const projectId = wrapper.dataset.projectId;
    const field = wrapper.dataset.taskField;
    setTaskExpansion(projectId, field, !isTaskExpanded(projectId, field));
    syncTaskExpansion(projectId, field);
  }

  function bindTaskToggle(button) {
    if (!button || button.dataset.expansionBound === 'true') return;
    button.dataset.expansionBound = 'true';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      activateTaskToggle(button);
    });
    button.addEventListener('keydown', (event) => {
      event.stopPropagation();
    });
  }

  const SELF_HEAL_LABELS = {
    idle: 'Idle',
    debugging: 'Debugging',
    healing: 'Healing',
    healed: 'Healed',
    accounted: 'Accounted',
    error: 'Error'
  };

  function renderSelfHealing(state) {
    if (!dom.selfHealPill) return;
    const available = state.selfHealingAvailable === true;
    dom.selfHealPill.hidden = !available;
    if (!available) {
      if (dom.selfHealBranch) dom.selfHealBranch.hidden = true;
      return;
    }
    const engaged = (state.projects || [])
      .map((project) => (project.selfHealer ? { ...project.selfHealer, projectId: project.id } : null))
      .filter(Boolean)
      .find((healer) => healer.state && healer.state !== 'idle') || null;
    const healerState = engaged ? engaged.state : 'idle';
    dom.selfHealPill.dataset.state = healerState;
    if (dom.selfHealState) dom.selfHealState.textContent = SELF_HEAL_LABELS[healerState] || 'Idle';
    if (dom.selfHealBranch) {
      // Show the merge button only while healed and not yet merged; once
      // mergedAt is set the round is done and the button must not reappear.
      const merged = engaged ? Boolean(engaged.mergedAt) : false;
      dom.selfHealBranch.hidden = healerState !== 'healed' || merged;
      dom.selfHealBranch.dataset.projectId = engaged ? engaged.projectId : '';
      dom.selfHealBranch.dataset.branch = engaged ? engaged.branch || '' : '';
    }
  }

  function mergeSelfHealBranch() {
    const button = dom.selfHealBranch;
    if (!button || !button.dataset.projectId) return;
    const branch = button.dataset.branch || 'the healed branch';
    const confirmed = window.confirm(
      `Test complete on ${branch}. Merge to main and rebuild/restart? Nothing is published.`
    );
    if (!confirmed) return;
    // The rebuild recreates the server, so the POST may drop mid-request. Treat a
    // dropped connection as "restarting" and confirm the merge on reconnect.
    dom.settingsStatus.textContent = `merging ${branch}…`;
    button.disabled = true;
    fetch(`/api/projects/${encodeURIComponent(button.dataset.projectId)}/selfheal/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    })
      .then(async (res) => {
        let body = null;
        try { body = await res.json(); } catch { /* no json */ }
        if (!res.ok) {
          dom.settingsStatus.textContent = (body && body.error) || `merge failed (${res.status})`;
          return;
        }
        dom.settingsStatus.textContent = body && body.mergeCommit
          ? `merged ${branch} (${body.mergeCommit}); restarting…`
          : `merged ${branch}; restarting…`;
      })
      .catch(() => {
        // Likely a dropped request during the rebuild/restart. Confirm via the
        // reconnected state rather than reporting a false failure.
        dom.settingsStatus.textContent = `merge submitted for ${branch}; waiting for restart…`;
      })
      .finally(() => {
        button.disabled = false;
      });
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
  }

  function api(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    }).then(async (res) => {
      let body = null;
      try { body = await res.json(); } catch { /* no json body */ }
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      return body;
    });
  }

  function planFileBaseName(relativePath) {
    const value = String(relativePath ?? '');
    return value.slice(value.lastIndexOf('/') + 1);
  }

  function normalizePlanFilePath(target) {
    if (typeof target !== 'string') return null;
    const trimmed = target.trim();
    if (!trimmed) return null;
    let relative = trimmed;
    if (relative.startsWith('./')) relative = relative.slice(2);
    const prefix = '.project_documents/';
    const hasPrefix = relative.startsWith(prefix);
    const basename = hasPrefix ? relative.slice(prefix.length) : relative;
    if (!new RegExp(`^(?:${PLAN_FILE_PREFIXES})-[^/\\\\]+\\.md$`).test(basename)) return null;
    return hasPrefix ? `${prefix}${basename}` : basename;
  }

  function createPlanFileButton(label, projectId, relativePath) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plan-file-ref';
    button.dataset.projectId = String(projectId ?? '');
    button.dataset.planFile = relativePath;
    button.title = 'click to open';
    button.setAttribute('aria-label', 'click to open');
    button.dataset.tooltip = 'click to open';
    button.textContent = label;
    return button;
  }

  function linkPlanReferences(element, projectId) {
    if (!element || element.closest?.('a, button, script, style, textarea')) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest('a, button, script, style, textarea')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const pattern = new RegExp(`\\[([^\\]]+)\\]\\(([^)]+)\\)|((?:\\.\\/|\\.project_documents\\/)?(?:${PLAN_FILE_PREFIXES})-[^/\\\\s\\\\]+\\.md)`, 'g');
    textNodes.forEach((node) => {
      const text = String(node.nodeValue ?? '');
      pattern.lastIndex = 0;
      let match;
      let lastIndex = 0;
      let fragment = null;
      while ((match = pattern.exec(text)) !== null) {
        let label;
        let rawTarget;
        if (match[1] !== undefined) {
          label = match[1];
          rawTarget = match[2];
        } else {
          rawTarget = match[3];
          const before = match.index > 0 ? text[match.index - 1] : '';
          if (before && /[\w/\\.-]/.test(before)) continue;
          label = planFileBaseName(rawTarget);
        }
        const relativePath = normalizePlanFilePath(rawTarget);
        if (!relativePath) continue;
        if (!fragment) fragment = document.createDocumentFragment();
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        fragment.appendChild(createPlanFileButton(label, projectId, relativePath));
        lastIndex = match.index + match[0].length;
      }
      if (fragment) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        node.parentNode?.replaceChild(fragment, node);
      }
    });
  }

  function setPlanFileStatus(message, isError = false) {
    if (!dom.planFileStatus) return;
    dom.planFileStatus.setAttribute('aria-live', 'polite');
    dom.planFileStatus.textContent = message;
    dom.planFileStatus.classList.toggle('error', Boolean(isError));
    dom.planFileStatus.classList.toggle('ok', Boolean(message) && !isError);
  }

  function isPlanFileModalOpen() {
    return Boolean(dom.planFileModal && (dom.planFileModal.open || dom.planFileModal.hasAttribute?.('open')));
  }

  function closePlanFileModal() {
    if (!dom.planFileModal) return;
    if (typeof dom.planFileModal.close === 'function') dom.planFileModal.close();
    else dom.planFileModal.removeAttribute('open');
    if (dom.planFileContent) {
      dom.planFileContent.value = '';
      delete dom.planFileContent.dataset.projectId;
      delete dom.planFileContent.dataset.planFile;
    }
    setPlanFileStatus('');
  }

  function planFileUrl(projectId, relativePath) {
    return `/api/projects/${encodeURIComponent(projectId)}/plan-file?path=${encodeURIComponent(relativePath)}`;
  }

  async function openPlanFileModal(projectId, relativePath) {
    if (!dom.planFileModal || !dom.planFileContent || !relativePath) return;
    if (dom.planFileTitle) dom.planFileTitle.textContent = planFileBaseName(relativePath);
    dom.planFileContent.value = '';
    dom.planFileContent.dataset.projectId = String(projectId ?? '');
    dom.planFileContent.dataset.planFile = relativePath;
    setPlanFileStatus('');
    if (!dom.planFileModal.open) {
      if (typeof dom.planFileModal.showModal === 'function') dom.planFileModal.showModal();
      else dom.planFileModal.setAttribute('open', '');
    }
    dom.planFileContent.focus();
    try {
      const data = await api(planFileUrl(projectId, relativePath));
      if (dom.planFileContent.dataset.projectId !== String(projectId ?? '') || dom.planFileContent.dataset.planFile !== relativePath) return;
      dom.planFileContent.value = typeof data?.content === 'string' ? data.content : '';
      setPlanFileStatus('');
    } catch (error) {
      setPlanFileStatus(error.message, true);
    }
  }

  async function savePlanFile() {
    if (!dom.planFileContent) return;
    const projectId = dom.planFileContent.dataset.projectId;
    const relativePath = dom.planFileContent.dataset.planFile;
    if (!projectId || !relativePath) return;
    setPlanFileStatus('saving…');
    if (dom.planFileSave) dom.planFileSave.disabled = true;
    try {
      await api(planFileUrl(projectId, relativePath), {
        method: 'PUT',
        body: JSON.stringify({ content: dom.planFileContent.value })
      });
      setPlanFileStatus('Saved.');
    } catch (error) {
      setPlanFileStatus(error.message, true);
    } finally {
      if (dom.planFileSave) dom.planFileSave.disabled = false;
    }
  }

  function setConnection(kind, text) {
    dom.connection.className = `connection ${kind}`;
    dom.connectionText.textContent = text;
  }

  function setSidebarOpen(open) {
    document.body.classList.toggle('sidebar-open', open);
    dom.navToggle.setAttribute('aria-expanded', String(open));
    dom.navToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Toggle navigation');
    dom.sidebarBackdrop.hidden = !open;
    dom.navToggle.querySelector('span').textContent = open ? '✕' : '☰';
  }

  const VIEWS = ['projects', 'settings', 'add'];

  function showView(view) {
    if (!VIEWS.includes(view)) view = 'projects';
    app.view = view;
    document.querySelectorAll('.view').forEach((el) => {
      el.hidden = el.dataset.view !== view;
    });
    document.querySelectorAll('.side-link[data-view]').forEach((link) => {
      const active = link.dataset.view === view;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function refreshState() {
    return api('/api/state').then(applyState);
  }

  function setIfIdle(element, value) {
    if (document.activeElement === element) return;
    const next = String(value ?? '');
    if (element.value !== next) element.value = next;
  }

  function isPlanSetup(project) {
    return String(project?.error || '').startsWith('plan.md:');
  }

  function updateStarterPlanButton() {
    const locked = !app.drawerId || app.savingPlan;
    dom.insertPlan.disabled = locked || Boolean(dom.planEditor.value.trim());
    dom.addTask.disabled = locked;
  }

  function updateToggleCompletedButton() {
    if (!dom.toggleCompletedTasks) return;
    const label = app.showCompleted ? 'Hide completed' : 'Show completed';
    const hint = app.showCompleted
      ? 'Hide completed tasks from the checklist'
      : 'Show completed tasks in the checklist';
    dom.toggleCompletedTasks.innerHTML = `<span aria-hidden="true">${app.showCompleted ? '⊟' : '⊞'}</span> ${label}`;
    dom.toggleCompletedTasks.setAttribute('aria-pressed', String(app.showCompleted));
    dom.toggleCompletedTasks.setAttribute('aria-label', hint);
    dom.toggleCompletedTasks.title = hint;
  }

  function updatePlanControls() {
    const noDrawer = !app.drawerId;
    const locked = noDrawer || app.savingPlan || app.planDirty;
    const visibleIndexes = visibleTaskIndexes(app.currentPlan?.tasks, app.showCompleted);
    dom.checklist.querySelectorAll('button[data-action]').forEach((button) => {
      const action = button.dataset.action;
      if (action === 'toggle-completed') {
        button.disabled = noDrawer || app.savingPlan;
        return;
      }
      const taskIndex = Number(button.dataset.taskIndex);
      let disabled = locked || !Number.isInteger(taskIndex);
      if (!disabled && taskIndex === editingTaskIndex && action !== 'save-task') disabled = true;
      if (!disabled && action === 'save-task') {
        const input = dom.checklist.querySelector(`.task-edit-input[data-task-index="${taskIndex}"]`);
        disabled = locked || taskIndex !== editingTaskIndex || !input || !cleanTaskText(input.value);
      }
      if (!disabled && (action === 'move-up' || action === 'move-top')) disabled = visibleTaskNeighbor(visibleIndexes, taskIndex, -1) == null;
      if (!disabled && (action === 'move-down' || action === 'move-bottom')) disabled = visibleTaskNeighbor(visibleIndexes, taskIndex, 1) == null;
      if (!disabled && action === 'toggle-flag') disabled = app.currentPlan?.started?.[taskIndex] === true;
      button.disabled = disabled;
    });
    dom.checklist.querySelectorAll('input[data-index]').forEach((input) => {
      const row = input.closest('.check-item');
      const taskIndex = row ? Number(row.dataset.taskIndex) : -1;
      input.disabled = locked || taskIndex === editingTaskIndex;
    });
    dom.checklist.querySelectorAll('.drag-handle').forEach((handle) => {
      const disabled = locked || Number(handle.dataset.taskIndex) === editingTaskIndex;
      handle.disabled = disabled;
      handle.setAttribute('aria-disabled', String(disabled));
    });
    dom.checklist.querySelectorAll('.task-edit-input').forEach((input) => {
      input.disabled = locked;
    });
    if (dom.toggleCompletedTasks) dom.toggleCompletedTasks.disabled = noDrawer || app.savingPlan;
    if (dom.savePlan) dom.savePlan.disabled = noDrawer || app.savingPlan;
    updateStarterPlanButton();
    if (!noDrawer && !app.savingPlan && app.planDirty) dom.taskStatus.textContent = 'Save plan.md first';
  }

  function updatePlanGuide(plan) {
    if (app.planGuideTouched) return;
    dom.planGuide.open = !plan.ok || !plan.stats?.total;
    setPlanGuideState(app.drawerId, dom.planGuide.open, false);
  }

  function statusInfo(project) {
    if (isPlanSetup(project)) return { label: STATUS.setup[0], cls: STATUS.setup[1] };
    if (project.awaitingSlot) return { label: 'Awaiting Slot', cls: 'idle' };
    const found = STATUS[project.status] || STATUS.idle;
    return { label: found[0], cls: found[1] };
  }

  function initial(project) {
    return (project.name || project.path || '?').trim().charAt(0).toUpperCase() || '?';
  }

  function projectById(id) {
    return app.state?.projects.find((project) => project.id === id) || null;
  }

  function runnerOptions(runners, selected) {
    const chosen = new Set(modelList(selected));
    return (runners || []).map((runner) =>
      `<option value="${esc(runner.id)}"${chosen.has(runner.id) ? ' selected' : ''}>${esc(runner.label)}</option>`
    ).join('');
  }

  function readRunnerSelect(select) {
    if (!select) return '';
    return joinModelList(
      Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean)
    );
  }

  function fillRunnerSelect(select, runners, selected) {
    if (!select) return;
    const markup = runnerOptions(runners, selected);
    if (select.dataset.runnerMarkup !== markup) {
      select.innerHTML = markup;
      select.dataset.runnerMarkup = markup;
    }
    if (document.activeElement === select) return;
    const options = [...select.options];
    if (!options.length) return;
    const chosen = new Set(modelList(selected));
    if (!chosen.size) chosen.add(options[0].value);
    options.forEach((option) => { option.selected = chosen.has(option.value); });
  }

  function runnerLabel(value) {
    const ids = modelList(value);
    if (!ids.length) return 'runner';
    return ids.map((id) => (app.state?.runners || []).find((entry) => entry.id === id)?.label || id).join(' + ');
  }

  // A picker can cover several runners at once. Union their catalogues in the
  // selected order so Vibe's two ids appear alongside OpenCode and Kilo ids when
  // all three runners are selected, instead of only the first runner's models.
  function runnerModelIds(runnerId) {
    const ids = [];
    const seen = new Set();
    for (const id of modelList(runnerId)) {
      const runner = (app.state?.runners || []).find((entry) => entry.id === id);
      const models = runner && Array.isArray(runner.models)
        ? runner.models
        : (MODEL_OPTIONS_BY_RUNNER[id] || []);
      for (const modelId of models) {
        if (seen.has(modelId)) continue;
        seen.add(modelId);
        ids.push(modelId);
      }
    }
    return ids;
  }

  // Attribute each selected model to the runner that can actually resolve it.
  // Ids no runner claims (custom providers/BYOK) stay available to every
  // selected runner, matching runnerSupportsModel on the server.
  function runnerModelAssignments(runnerId, selected) {
    const chosen = modelList(selected);
    const catalogues = new Map(
      (app.state?.runners || []).map((runner) => [runner.id, Array.isArray(runner.models) ? runner.models : []])
    );
    const claimed = new Set();
    for (const models of catalogues.values()) for (const id of models) claimed.add(id);
    return modelList(runnerId).map((id) => {
      const own = catalogues.get(id) || MODEL_OPTIONS_BY_RUNNER[id] || [];
      return {
        id,
        label: (app.state?.runners || []).find((runner) => runner.id === id)?.label || id,
        models: chosen.filter((modelId) => own.includes(modelId) || !claimed.has(modelId))
      };
    });
  }

  function updateModelOwnerHint(select, runnerId, selected) {
    const row = select.closest('.model-field-row');
    if (!row || !row.parentElement) return;
    const assignments = runnerModelAssignments(runnerId, selected);
    const parts = assignments.filter((entry) => entry.models.length)
      .map((entry) => `${entry.label}: ${entry.models.join(', ')}`);
    const hint = row.parentElement.querySelector(':scope > .model-owner-hint');
    if (assignments.length < 2 || !parts.length) {
      if (hint) hint.remove();
      return;
    }
    const target = hint || Object.assign(document.createElement('small'), {
      className: 'field-hint model-owner-hint'
    });
    target.textContent = parts.join(' · ');
    if (!hint) row.insertAdjacentElement('afterend', target);
  }

  function modelOptions(selected, placeholder, runnerId) {
    const blank = placeholder || 'Runner default';
    const allowed = runnerModelIds(runnerId);
    const allowedSet = new Set(allowed);
    const ids = modelList(selected).filter((id) => allowedSet.has(id));
    const selectedIds = new Set(ids);
    const blankSelected = ids.length ? '' : ' selected';
    return `<option value=""${blankSelected}>${esc(blank)}</option>` + allowed.map((id) =>
      `<option value="${esc(id)}"${selectedIds.has(id) ? ' selected' : ''}>${esc(id)}</option>`
    ).join('');
  }

  function fillModelSelect(select, selected, placeholder, runnerId) {
    if (!select || document.activeElement === select) return;
    select.dataset.modelPlaceholder = placeholder || '';
    select.dataset.modelRunner = runnerId || '';
    const markup = modelOptions(selected, placeholder, runnerId);
    if (select.dataset.modelMarkup !== markup) {
      select.innerHTML = markup;
      select.dataset.modelMarkup = markup;
    }
    const allowed = new Set(runnerModelIds(runnerId));
    const ids = modelList(selected).filter((id) => allowed.has(id));
    const selectedIds = new Set(ids);
    Array.from(select.options).forEach((option) => {
      option.selected = option.value ? selectedIds.has(option.value) : ids.length === 0;
    });
    updateModelOwnerHint(select, runnerId, joinModelList(ids));
  }

  // Rebuild model selects when their runner changes so a stale id from the
  // previous runner cannot stay selected and reach the wrong CLI.
  function refillModelSelectsForRunner(selects, runnerId) {
    for (const select of selects) {
      if (!select) continue;
      fillModelSelect(select, readModelSelect(select), select.dataset.modelPlaceholder || '', runnerId);
    }
  }

  function readModelSelect(select) {
    if (!select) return '';
    return joinModelList(
      Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean)
    );
  }

  function rotationButtonFor(selectId) {
    return document.querySelector(`.model-rotate-button[data-rotate-for="${selectId}"]`);
  }

  function readRotationButtons(targets) {
    const flags = {};
    for (const target of targets) {
      const button = rotationButtonFor(target.select);
      if (button) flags[target.field] = button.getAttribute('aria-pressed') === 'true';
    }
    return flags;
  }

  function applyRotationButtons(targets, values) {
    for (const target of targets) {
      const button = rotationButtonFor(target.select);
      if (!button) continue;
      button.setAttribute('aria-pressed', values && values[target.field] === true ? 'true' : 'false');
    }
  }

  function effectiveRotationFlags(project) {
    if (project && project.effectiveRotations) return project.effectiveRotations;
    const settings = app.state?.settings || {};
    const flags = {
      model: settings.modelRotation === true,
      seed: settings.seedRotation === true,
      analyze: settings.analyzeRotation === true,
      implement: settings.implementRotation === true,
      plan: settings.planRotation === true
    };
    if (!project) return flags;
    const fields = {
      model: 'modelRotation',
      seed: 'seedRotation',
      analyze: 'analyzeRotation',
      implement: 'implementRotation',
      plan: 'planRotation'
    };
    for (const [key, field] of Object.entries(fields)) {
      if (typeof project[field] === 'boolean') flags[key] = project[field];
    }
    return flags;
  }

  function rotationSummary(project) {
    const flags = effectiveRotationFlags(project);
    const on = [['default', flags.model], ['seed', flags.seed], ['analyze', flags.analyze], ['implement', flags.implement], ['plan', flags.plan]]
      .filter(([, enabled]) => enabled)
      .map(([label]) => label);
    return on.length ? `on (${on.join(', ')})` : 'off';
  }

  function fillPathSuggestions(projects) {
    const paths = new Set();
    (projects || []).forEach((project) => {
      const path = String(project.path || '');
      if (!path) return;
      paths.add(path);
      const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      if (slash > 0) paths.add(path.slice(0, slash));
    });
    const markup = [...paths].sort().map((path) => `<option value="${esc(path)}"></option>`).join('');
    if (dom.projectPathSuggestions.dataset.markup !== markup) {
      dom.projectPathSuggestions.innerHTML = markup;
      dom.projectPathSuggestions.dataset.markup = markup;
    }
  }

  function appendModelSummary(parts, label, value) {
    const ids = modelList(value);
    if (!ids.length) return;
    parts.push(`${label}: ${ids.join(', ')}`);
  }

  function displayModelList(value, emptyLabel = 'OpenCode default') {
    const ids = modelList(value);
    return ids.length ? ids.join(', ') : emptyLabel;
  }

  function updateHostSummary(state) {
    const settings = state.settings || {};
    const runner = (state.runners || []).find((item) => item.id === settings.globalRunner);
    dom.hostRunner.textContent = runner?.label || settings.globalRunner || 'Unknown';
    const settingsLists = settings.effectiveModelLists || {};
    const modelParts = [];
    appendModelSummary(modelParts, 'default', settingsLists.model ?? settings.model);
    appendModelSummary(modelParts, 'seed', settingsLists.seed ?? settings.seedModel);
    appendModelSummary(modelParts, 'analyze', settingsLists.analyze ?? settings.analyzeModel);
    appendModelSummary(modelParts, 'implement', settingsLists.implement ?? settings.implementModel);
    appendModelSummary(modelParts, 'plan', settingsLists.plan ?? settings.planModel);
    const projects = state.projects || [];
    for (const project of projects) {
      const name = project.name || project.id || 'project';
      const lists = project.effectiveModelLists || project.effectiveModels || {};
      const fallback = project.effectiveModel || '';
      appendModelSummary(modelParts, `${name} default`, lists.model ?? fallback);
      appendModelSummary(modelParts, `${name} seed`, lists.seed ?? fallback);
      appendModelSummary(modelParts, `${name} analyze`, lists.analyze ?? fallback);
      appendModelSummary(modelParts, `${name} implement`, lists.implement ?? fallback);
      appendModelSummary(modelParts, `${name} plan`, lists.plan ?? fallback);
    }
    const detail = runner?.description || 'Server-side executor';
    dom.hostRunnerDetail.textContent = modelParts.length
      ? `${detail} · ${modelParts.join(' · ')}`
      : detail;
    const setupCount = projects.filter(isPlanSetup).length;
    if (dom.settingsBadge) {
      dom.settingsBadge.textContent = String(setupCount);
      dom.settingsBadge.hidden = setupCount === 0;
    }
    if (dom.settingsGear) {
      dom.settingsGear.setAttribute(
        'aria-label',
        setupCount ? `Settings, ${setupCount} item${setupCount === 1 ? '' : 's'} need setup` : 'Settings'
      );
    }
  }

  /* ---------- cards ---------- */

  function createCard(project) {
    const card = document.createElement('article');
    const currentTextId = `task-text-${++taskTextCounter}`;
    const nextTextId = `task-text-${++taskTextCounter}`;
    card.className = 'card';
    card.dataset.id = project.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open ${project.name} details`);
    card.innerHTML = `
      <div class="card-top">
        <div class="project-visual"></div>
        <div class="card-title">
          <strong></strong>
          <span class="mono"></span>
        </div>
        <span class="badge idle"></span>
      </div>
      <p class="card-task task-detail-wrap" data-task-field="current" data-project-id="${esc(project.id)}" data-fallback="true"><span class="task-detail-text task-detail-clamped" id="${currentTextId}"></span><button class="task-expand-toggle" type="button" aria-controls="${currentTextId}" aria-expanded="false" aria-label="Expand current task" title="Expand current task" hidden>▼</button></p>
      <div class="card-model-row"><div class="card-model mono"></div><button class="icon-button terminal-button" type="button" aria-label="Open agent terminal" title="Agent terminal"><svg class="terminal-icon" aria-hidden="true" focusable="false"><use href="#icon-terminal"></use></svg></button><a class="icon-button repo-link" data-repo-link="github" hidden target="_blank" rel="noopener noreferrer" aria-label="Open GitHub repository" title="GitHub repository"><svg class="repo-icon" aria-hidden="true" focusable="false"><use href="#icon-github"></use></svg></a><a class="icon-button repo-link" data-repo-link="docker" hidden target="_blank" rel="noopener noreferrer" aria-label="Open Docker image repository" title="Docker image repository"><svg class="repo-icon" aria-hidden="true" focusable="false"><use href="#icon-docker"></use></svg></a></div>
      <div class="card-up" data-task-field="next" data-project-id="${esc(project.id)}" data-fallback="true"><strong>Up next:</strong> <span class="task-detail-wrap"><span class="task-detail-text task-detail-clamped" id="${nextTextId}"></span><button class="task-expand-toggle" type="button" aria-controls="${nextTextId}" aria-expanded="false" aria-label="Expand up next" title="Expand up next" hidden>▼</button></span></div>
      <div class="progress-row">
        <span>Progress</span>
        <span class="progress-count"></span>
      </div>
      <div class="progress-track"><div class="progress-fill"></div></div>
      <div class="card-controls">
        <button class="button small" type="button" data-action="start">Start</button>
        <button class="button small" type="button" data-action="pause">Pause</button>
        <button class="button small" type="button" data-action="stop">Stop</button>
        <button class="button small danger" type="button" data-action="remove">Remove</button>
      </div>
      <div class="countdown" hidden></div>`;

    card.querySelectorAll('.task-expand-toggle').forEach(bindTaskToggle);

    const terminalButton = card.querySelector('.terminal-button');
    terminalButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openTerminal(project.id);
    });
    card.querySelectorAll('.repo-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.stopPropagation();
      });
    });

    card.querySelector('.card-controls').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      event.stopPropagation();
      handleCardAction(card, button.dataset.action);
    });
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      openDrawer(project.id);
    });
    card.addEventListener('keydown', (event) => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDrawer(project.id);
      }
    });
    return card;
  }

  function visualIconKey(project) {
    return project.iconVersion || project.icon || '';
  }

  function renderProjectVisual(holder, project, iconKey) {
    holder.innerHTML = '';

    if (!iconKey) {
      const badge = document.createElement('div');
      badge.className = 'initial-badge';
      badge.textContent = initial(project);
      holder.appendChild(badge);
      return;
    }

    const img = document.createElement('img');
    img.className = 'project-icon';
    img.alt = '';
    img.src = `/api/projects/${encodeURIComponent(project.id)}/icon?v=${encodeURIComponent(iconKey)}`;
    img.addEventListener('error', () => {
      const badge = document.createElement('div');
      badge.className = 'initial-badge';
      badge.textContent = initial(project);
      img.replaceWith(badge);
    });
    holder.appendChild(img);
  }

  function setCardVisual(card, project) {
    const holder = card.querySelector('.project-visual');
    const iconKey = visualIconKey(project);
    if (card.dataset.iconKey === iconKey && holder.firstChild) return;
    card.dataset.iconKey = iconKey;
    renderProjectVisual(holder, project, iconKey);
  }

  function setDrawerVisual(project) {
    const holder = dom.drawerVisual;
    if (!holder) return;
    if (!project) {
      holder.dataset.iconKey = '';
      holder.innerHTML = '';
      return;
    }
    const iconKey = visualIconKey(project);
    const cacheKey = `${project.id}:${iconKey}`;
    if (holder.dataset.iconKey === cacheKey && holder.firstChild) return;
    holder.dataset.iconKey = cacheKey;
    renderProjectVisual(holder, project, iconKey);
  }

  function taskFallback(project) {
    if (isPlanSetup(project)) return 'Setup needed. Create plan.md in the drawer, then press Start.';
    if (project.error) return project.error;
    if (project.status === 'paused') return 'Paused. Press Start to continue.';
    if (project.status === 'rateLimited') return 'Rate limit backoff active. Auto-retry pending; press Retry to start immediately.';
    if (project.status === 'done') return 'All tasks complete.';
    if (project.awaitingSlot) return 'Awaiting worker slot…';
    return 'Idle. Press Start to run the checklist.';
  }

  function updateCountdown(card, project) {
    const element = card.querySelector('.countdown');
    const now = Date.now();
    if (project?.status === 'rateLimited' && project.resumeAt) {
      const seconds = Math.max(0, Math.ceil((project.resumeAt - now) / 1000));
      element.textContent = `rate limit · retry in ${seconds}s`;
      element.hidden = false;
      return;
    }
    if (card.flash && now < card.flash.until) {
      element.textContent = card.flash.message;
      element.hidden = false;
      return;
    }
    card.flash = null;
    element.hidden = true;
  }

  function startActionLabel(project) {
    return project.status === 'rateLimited' ? 'Retry' : 'Start';
  }

  function controlDisabled(project) {
    const total = Number(project.progress?.total) || 0;
    const completed = Number(project.progress?.completed) || 0;
    const hasPending = Boolean(project.nextTask) || completed < total;
    const rateLimited = project.status === 'rateLimited';
    // A waiting plan project advances only via its answer or plan-confirm;
    // Start/Pause cannot bypass the human gate. Stop stays available.
    const waiting = project.status === 'waitingAnswer' || project.status === 'waitingConfirm';
    return {
      start: !(rateLimited || waiting) && ((project.active && !project.paused) || (project.status === 'done' && !hasPending)),
      pause: !project.active || project.paused || project.pauseRequested || waiting,
      stop: !project.active
    };
  }

  function renderRepoLinks(rowElement, project) {
    if (!rowElement) return;
    const apply = (key, value) => {
      const link = rowElement.querySelector(`.repo-link[data-repo-link="${key}"]`);
      if (!link) return;
      const url = key === 'docker' ? normalizedDockerRepoLink(value) : normalizedRepoLink(value);
      if (url) {
        link.setAttribute('href', url);
        link.setAttribute('title', key === 'github' ? 'GitHub repository' : 'Docker image repository');
        link.hidden = false;
      } else {
        link.removeAttribute('href');
        link.hidden = true;
      }
    };
    apply('github', project.githubRepoUrl);
    apply('docker', project.dockerRepoUrl);
  }

  function normalizedRepoLink(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return trimmed;
  }

  function normalizedDockerRepoLink(value) {
    const normalized = normalizedRepoLink(value);
    if (!normalized) return normalized;
    let parsed;
    try {
      parsed = new URL(normalized);
    } catch {
      return normalized;
    }
    if (parsed.hostname !== 'ghcr.io' && parsed.host !== 'ghcr.io') return normalized;
    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    if (segments.length !== 2) return normalized;
    const [owner, image] = segments;
    return `https://github.com/users/${encodeURIComponent(owner)}/packages/container/package/${encodeURIComponent(image)}`;
  }

  function updateCard(card, project) {
    card._project = project;
    setCardVisual(card, project);
    card.setAttribute('aria-label', `Open ${project.name} details`);

    card.querySelector('.card-title strong').textContent = project.name;
    const cardPath = card.querySelector('.card-title span');
    const showAccessRoute = app.state?.settings?.showCardAccessRoute === true;
    cardPath.textContent = showAccessRoute ? project.path : '';
    cardPath.hidden = !showAccessRoute;

    const info = statusInfo(project);
    const badge = card.querySelector('.badge');
    badge.className = `badge ${info.cls}${project.active && !project.paused ? ' active' : ''}`;
    badge.textContent = info.label;

    const currentWrapper = card.querySelector('.card-task');
    const currentText = currentWrapper.querySelector('.task-detail-text');
    currentWrapper.dataset.projectId = String(project.id);
    currentWrapper.dataset.fallback = project.currentTask ? 'false' : 'true';
    currentText.textContent = project.currentTask || taskFallback(project);
    linkPlanReferences(currentText, project.id);
    currentWrapper.classList.toggle('empty', !project.currentTask);

    const upWrapper = card.querySelector('.card-up');
    const upText = upWrapper.querySelector('.task-detail-text');
    upWrapper.dataset.projectId = String(project.id);
    upWrapper.dataset.fallback = project.nextTask ? 'false' : 'true';
    upText.textContent = project.nextTask || '—';
    linkPlanReferences(upText, project.id);
    syncTaskExpansion(project.id, 'current');
    syncTaskExpansion(project.id, 'next');

    const total = Number(project.progress?.total) || 0;
    const completed = Number(project.progress?.completed) || 0;
    card.querySelector('.progress-count').textContent = `${completed} / ${total}`;
    card.querySelector('.progress-fill').style.width = total ? `${(completed / total) * 100}%` : '0%';

    const modelLine = card.querySelector('.card-model');
    if (modelLine) {
      const modelName = project.activeModel || project.effectiveModel || '';
      modelLine.textContent = `${runnerLabel(project.activeRunner || project.runner)}${modelName ? ` · ${modelName}` : ' · default'}`;
      modelLine.title = modelLine.textContent;
    }

    renderRepoLinks(card.querySelector('.card-model-row'), project);

    const buttons = card.querySelectorAll('.card-controls button');
    const disabled = controlDisabled(project);
    buttons[0].textContent = startActionLabel(project);
    buttons[0].disabled = disabled.start;
    buttons[1].disabled = disabled.pause;
    buttons[2].disabled = disabled.stop;
    buttons[3].disabled = false;

    updateCountdown(card, project);
  }

  function renderCards(projects) {
    const existing = new Map([...dom.projectGrid.children].map((card) => [card.dataset.id, card]));
    projects.forEach((project) => {
      let card = existing.get(project.id);
      if (!card) {
        card = createCard(project);
        dom.projectGrid.appendChild(card);
      } else {
        existing.delete(project.id);
      }
      updateCard(card, project);
    });
    existing.forEach((card) => card.remove());

    dom.emptyState.hidden = projects.length > 0;
  }

  function flashCard(card, message) {
    card.flash = { message, until: Date.now() + 5000 };
    updateCountdown(card, card._project);
  }

  async function handleCardAction(card, action) {
    const project = card._project;
    if (!project) return;
    if (action === 'remove') {
      const ok = window.confirm(
        `Remove ${project.name} from looparr? The project directory and plan.md will not be deleted.`
      );
      if (!ok) return;
    }
    try {
      if (action === 'remove') {
        await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      } else {
        await api(`/api/projects/${encodeURIComponent(project.id)}/${action}`, { method: 'POST' });
      }
    } catch (error) {
      flashCard(card, error.message);
    }
  }

  function updateAllCountdowns() {
    [...dom.projectGrid.children].forEach((card) => updateCountdown(card, card._project));
    if (app.drawerId) {
      const project = projectById(app.drawerId);
      if (project) {
        const info = statusInfo(project);
        let label = info.label;
        if (project.status === 'rateLimited' && project.resumeAt) {
          const seconds = Math.max(0, Math.ceil((project.resumeAt - Date.now()) / 1000));
          label += ` · ${seconds}s`;
        }
        dom.drawerStatus.textContent = label;
      }
    }
  }

  /* ---------- logs ---------- */

  function logBucket(id) {
    if (!app.logs.has(id)) app.logs.set(id, { entries: [], seen: new Set() });
    return app.logs.get(id);
  }

  function streamClass(stream) {
    if (stream === 'out') return 'stdout';
    if (stream === 'err') return 'stderr';
    if (stream === 'system') return 'system';
    return String(stream || 'system').replace(/[^a-z0-9-]/gi, '');
  }

  function formatLogText(text) {
    const input = text == null ? '' : String(text);

    function plain(value, limit = 160) {
      if (value == null) return '';
      let output = String(value).replace(/\s+/g, ' ').trim();
      if (output.length > limit) output = `${output.slice(0, limit - 1)}…`;
      return output;
    }

    function firstText(value, depth = 0) {
      if (depth > 2 || value == null) return '';
      if (typeof value === 'string' || typeof value === 'number') return plain(value);
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = firstText(item, depth + 1);
          if (found) return found;
        }
        return '';
      }
      if (typeof value === 'object') {
        for (const key of ['text', 'message', 'content', 'summary', 'title', 'detail', 'display']) {
          const found = firstText(value[key], depth + 1);
          if (found) return found;
        }
      }
      return '';
    }

    function summary(event) {
      const type = plain(event.type || event.kind || '', 40);
      const role = plain(event.role || '', 40);
      const part = event.part && typeof event.part === 'object' && !Array.isArray(event.part)
        ? event.part
        : null;
      const partType = part ? plain(part.type || '', 40) : '';
      const label = type || role || partType || 'event';

      if (type === 'text' || partType === 'text') {
        const detail = firstText(part && part.text != null ? part.text : event.text);
        return detail ? `${label}: ${detail}` : label;
      }
      if (type === 'reasoning') {
        const detail = firstText(event.text || event.summary);
        return detail ? `${label}: ${detail}` : label;
      }
      if (type === 'message') {
        const detail = firstText(event.content);
        const who = role || label;
        return detail ? `${who}: ${detail}` : who;
      }
      if (type === 'effect') {
        const detailObj = event.detail && typeof event.detail === 'object' ? event.detail : null;
        const display = detailObj && detailObj.display && typeof detailObj.display === 'object'
          ? detailObj.display
          : null;
        const detail = plain(event.title || (display && display.summary) || (display && display.message) || '');
        return detail ? `${label}: ${detail}` : label;
      }
      if (type === 'error' || type === 'retry') {
        const error = event.error && typeof event.error === 'object' ? event.error : null;
        const data = error && error.data && typeof error.data === 'object' ? error.data : null;
        let detail = plain(event.message || (error && error.message) || (data && data.message) || '');
        if (type === 'retry' && event.attempt != null) {
          detail = `attempt ${plain(event.attempt, 10)}${detail ? ` · ${detail}` : ''}`;
        }
        return detail ? `${label}: ${detail}` : label;
      }
      if (type === 'tool_use' || partType === 'tool') {
        const state = part && part.state && typeof part.state === 'object' ? part.state : null;
        const inputObj = state && state.input && typeof state.input === 'object' ? state.input : null;
        const tool = part ? plain(part.tool || '', 60) : '';
        const target = inputObj
          ? plain(inputObj.path || inputObj.filePath || inputObj.command || inputObj.url || '', 100)
          : '';
        const status = state ? plain(state.status || '', 30) : '';
        const detail = [tool, target, status].filter(Boolean).join(' · ');
        return detail ? `${label}: ${detail}` : label;
      }
      if (type === 'step_finish' || partType === 'step-finish') {
        const detail = plain((part && part.reason) || event.reason || '', 60);
        return detail ? `${label}: ${detail}` : label;
      }
      const detail = part
        ? firstText(part.text || part.message || part.content || part.summary || '')
        : firstText(event.text || event.message || event.content || event.summary || '');
      return detail ? `${label}: ${detail}` : label;
    }

    function formatLine(line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== '{' || trimmed[trimmed.length - 1] !== '}') return line;
      let event;
      try { event = JSON.parse(trimmed); } catch { return line; }
      if (!event || typeof event !== 'object' || Array.isArray(event)) return line;
      return plain(summary(event), 400) || line;
    }

    return input.split('\n').map(formatLine).join('\n');
  }

  function makeLogLine(entry) {
    const line = document.createElement('div');
    line.className = `log-line log-${streamClass(entry.stream)}`;
    line.dataset.seq = String(entry.seq);

    const meta = document.createElement('span');
    meta.className = 'log-meta';
    const date = new Date(entry.ts);
    meta.textContent = Number.isNaN(date.getTime())
      ? '--:--:--'
      : date.toLocaleTimeString([], { hour12: false });

    const rawText = entry.text == null ? '' : String(entry.text);
    const formatted = formatLogText(rawText);
    const text = document.createElement('span');
    text.className = 'log-text';
    text.textContent = formatted;
    if (formatted !== rawText) {
      text.setAttribute('title', rawText);
      text.setAttribute('data-raw-text', rawText);
    }

    line.append(meta, text);
    return line;
  }

  function isNearBottom() {
    const remaining = dom.logList.scrollHeight - dom.logList.scrollTop - dom.logList.clientHeight;
    return remaining <= 24;
  }

  function toggleFollowButton() {
    dom.logFollow.hidden = app.logFollow;
    setLogFollow(app.drawerId, app.logFollow);
  }

  function updateLogStatus() {
    const count = app.logs.get(app.drawerId)?.entries.length || 0;
    if (!count) {
      dom.logStatus.textContent = 'No logs yet';
      return;
    }
    const project = app.drawerId ? projectById(app.drawerId) : null;
    const live = Boolean(project?.active && !project?.paused);
    dom.logStatus.textContent = `${live ? 'Live · ' : ''}${count} line${count === 1 ? '' : 's'}`;
  }

  function scrollLogs(force = false) {
    if (force || app.logFollow) dom.logList.scrollTop = dom.logList.scrollHeight;
    toggleFollowButton();
  }

  function appendLogLine(entry) {
    if (entry.projectId !== app.drawerId) return;
    if (dom.logList.querySelector(`[data-seq="${entry.seq}"]`)) return;
    dom.logList.appendChild(makeLogLine(entry));
    scrollLogs();
    updateLogStatus();
    applyAutoEmptySections(app.drawerId);
  }

  function addLogEntries(id, entries) {
    const bucket = logBucket(id);
    for (const entry of entries || []) {
      if (!entry || entry.seq == null || bucket.seen.has(entry.seq)) continue;
      bucket.seen.add(entry.seq);
      bucket.entries.push(entry);
      if (bucket.entries.length > 400) {
        const dropped = bucket.entries.shift();
        bucket.seen.delete(dropped.seq);
      }
      appendLogLine(entry);
      appendTerminalLine(entry);
    }
  }

  function renderLogs(id) {
    dom.logList.innerHTML = '';
    const bucket = app.logs.get(id);
    if (!bucket || !bucket.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = 'No logs yet. Start the project to see runner output.';
      dom.logList.appendChild(empty);
      updateLogStatus();
      toggleFollowButton();
      applyAutoEmptySections(id);
      return;
    }
    const fragment = document.createDocumentFragment();
    bucket.entries.forEach((entry) => fragment.appendChild(makeLogLine(entry)));
    dom.logList.appendChild(fragment);
    scrollLogs(true);
    updateLogStatus();
    applyAutoEmptySections(id);
  }

  /* ---------- terminal overlay ---------- */

  function isTerminalOpen() {
    return Boolean(app.terminalId) && dom.terminalOverlay && !dom.terminalOverlay.hidden;
  }

  function isTerminalNearBottom() {
    const remaining = dom.terminalLogList.scrollHeight - dom.terminalLogList.scrollTop - dom.terminalLogList.clientHeight;
    return remaining <= 24;
  }

  function toggleTerminalFollowButton() {
    dom.terminalFollow.hidden = app.terminalFollow;
  }

  function scrollTerminal(force = false) {
    if (force || app.terminalFollow) dom.terminalLogList.scrollTop = dom.terminalLogList.scrollHeight;
    toggleTerminalFollowButton();
  }

  function appendTerminalLine(entry) {
    if (!app.terminalId || !entry || entry.projectId !== app.terminalId) return;
    if (!isTerminalOpen()) return;
    if (dom.terminalLogList.querySelector(`[data-seq="${entry.seq}"]`)) return;
    const empty = dom.terminalLogList.querySelector('.terminal-empty');
    if (empty) empty.remove();
    dom.terminalLogList.appendChild(makeLogLine(entry));
    scrollTerminal();
  }

  function renderTerminalLogs(id) {
    dom.terminalLogList.textContent = '';
    const bucket = app.logs.get(id);
    if (!bucket || !bucket.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'terminal-empty';
      empty.textContent = 'No agent output yet. Start the project to see the live terminal.';
      dom.terminalLogList.appendChild(empty);
      toggleTerminalFollowButton();
      return;
    }
    const fragment = document.createDocumentFragment();
    bucket.entries.forEach((entry) => fragment.appendChild(makeLogLine(entry)));
    dom.terminalLogList.appendChild(fragment);
    scrollTerminal(true);
  }

  function openTerminal(id) {
    const project = projectById(id);
    if (!project) return;
    app.terminalId = id;
    dom.terminalTitle.textContent = `${project.name} · agent terminal`;
    app.terminalFollow = true;
    dom.terminalOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    renderTerminalLogs(id);
    dom.terminalClose.focus();
  }

  function closeTerminal() {
    if (!app.terminalId) return;
    app.terminalId = null;
    dom.terminalOverlay.hidden = true;
    if (!app.drawerId) document.body.style.overflow = '';
  }

  /* ---------- drawer ---------- */

  function markPlanDirty() {
    app.planDirty = true;
    dom.planStatus.textContent = 'unsaved changes';
    updatePlanControls();
  }

  function displayScope(value) {
    const parts = String(value || '')
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') : '—';
  }

  function updateDrawerPolicy(project) {
    const policy = project.blockPolicy || {};
    const overrides = policy.overrides || {};
    const rows = [
      ['Threshold', String(policy.blockThreshold ?? '—'), overrides.blockThreshold != null],
      ['Cooloff', String(project.effectiveCooloffSeconds ?? '—'), overrides.cooloffSeconds != null],
      ['Temporary lift', displayScope(policy.temporaryLiftScope), Boolean(overrides.temporaryLiftScope)],
      ['Permanent lift', displayScope(policy.permanentLift), Boolean(overrides.permanentLift)]
    ];
    dom.drawerBlockPolicy.innerHTML = rows.map(([label, value, overridden]) => `
      <div class="policy-line">
        <span>${esc(label)}</span>
        <span>${esc(value)}<span class="policy-override">${overridden ? 'project' : 'global'}</span></span>
      </div>`).join('');
    setIfIdle(dom.drawerBlockThreshold, overrides.blockThreshold ?? '');
    setIfIdle(dom.drawerCooloffSeconds, overrides.cooloffSeconds ?? '');
    setIfIdle(dom.drawerTemporaryLiftScope, overrides.temporaryLiftScope || '');
    setIfIdle(dom.drawerPermanentLift, overrides.permanentLift || '');
    if (dom.blockPolicyStatus) dom.blockPolicyStatus.textContent = '';
  }

  function effectiveModelListsFor(project) {
    if (project.effectiveModelLists) {
      const lists = project.effectiveModelLists;
      return {
        model: lists.model ?? project.effectiveModel ?? project.model ?? '',
        seed: lists.seed ?? project.effectiveModel ?? '',
        analyze: lists.analyze ?? project.effectiveModel ?? '',
        implement: lists.implement ?? project.effectiveModel ?? '',
        plan: lists.plan ?? project.effectiveModel ?? ''
      };
    }
    const fallback = project.effectiveModel || '';
    const models = project.effectiveModels || {};
    return {
      model: project.effectiveModel || project.model || '',
      seed: models.seed || fallback || '',
      analyze: models.analyze || fallback || '',
      implement: models.implement || fallback || '',
      plan: models.planQuestions || models.plan || fallback || ''
    };
  }

  function updateDrawerModel(project) {
    const settings = app.state?.settings || {};
    const override = project.model || '';
    const effective = effectiveModelListsFor(project);
    const defaultModel = displayModelList(effective.model || override || settings.model, 'OpenCode default');
    dom.drawerCardModel.textContent = defaultModel;
    dom.drawerCardModel.title = defaultModel;
    const rows = [
      ['Default model', defaultModel],
      ['Seed model', displayModelList(effective.seed || settings.seedModel || settings.model, 'OpenCode default')],
      ['Analyze model', displayModelList(effective.analyze || settings.analyzeModel || settings.model, 'OpenCode default')],
      ['Implement model', displayModelList(effective.implement || settings.implementModel || settings.model, 'OpenCode default')],
      ['Plan model', displayModelList(effective.plan || settings.planModel || settings.model, 'OpenCode default')],
      ['Project default override', displayModelList(override, 'global')],
      ['Rotation', rotationSummary(project)]
    ];
    dom.drawerModel.innerHTML = rows.map(([label, value]) => `
      <div class="policy-line">
        <span>${esc(label)}</span>
        <span>${esc(value)}</span>
      </div>`).join('');
    const drawerRunner = project.runner || app.state?.settings?.globalRunner || '';
    fillRunnerSelect(dom.drawerRunner, app.state?.runners || [], drawerRunner);
    const drawerModelRunner = drawerRunner;
    fillModelSelect(dom.drawerModelInput, project.model, 'Inherit global', drawerModelRunner);
    fillModelSelect(dom.drawerSeedModel, project.seedModel, 'Inherit default model', drawerModelRunner);
    fillModelSelect(dom.drawerAnalyzeModel, project.analyzeModel, 'Inherit default model', drawerModelRunner);
    fillModelSelect(dom.drawerImplementModel, project.implementModel, 'Inherit default model', drawerModelRunner);
    fillModelSelect(dom.drawerPlanModel, project.planModel, 'Inherit default model', drawerModelRunner);
    const rotationFlags = effectiveRotationFlags(project);
    applyRotationButtons(DRAWER_ROTATION_TARGETS, {
      modelRotation: rotationFlags.model,
      seedRotation: rotationFlags.seed,
      analyzeRotation: rotationFlags.analyze,
      implementRotation: rotationFlags.implement,
      planRotation: rotationFlags.plan,
      runnerRotation: typeof project.runnerRotation === 'boolean'
        ? project.runnerRotation
        : settings.runnerRotation === true
    });
    dom.projectModelStatus.textContent = '';
    const drawerRow = dom.drawerTerminalButton?.closest('.card-model-row');
    renderRepoLinks(drawerRow, project);
  }

  function updateDrawerAutoResume(project) {
    if (!app.autoResumeDirty && document.activeElement !== dom.autoResumeToggle) {
      dom.autoResumeToggle.checked = project.autoResumeOnStart === true;
    }
    if (app.autoResumeDirty) {
      dom.autoResumeStatus.textContent = 'unsaved';
    } else {
      dom.autoResumeStatus.textContent = project.autoResumePending ? 'Pending intent' : '';
    }
  }

  function updateDrawerControls(project) {
    const disabled = controlDisabled(project);
    const buttons = dom.drawerControls.querySelectorAll('button[data-action]');
    buttons[0].textContent = startActionLabel(project);
    buttons[0].disabled = disabled.start;
    buttons[1].disabled = disabled.pause;
    buttons[2].disabled = disabled.stop;
    const waitingConfirm = project.status === 'waitingConfirm';
    if (dom.confirmPlan) dom.confirmPlan.hidden = !waitingConfirm;
    if (dom.planConfirmStatus) {
      dom.planConfirmStatus.textContent = waitingConfirm
        ? 'Plan ready for review. Open the PLAN file, then confirm.'
        : '';
    }
    const waitingAnswer = project.status === 'waitingAnswer';
    if (waitingAnswer && dom.answerStatus && dom.answerStatus.textContent === 'No handoff loaded') {
      dom.answerStatus.textContent = 'questions ready — add your answers, then Save answer';
    }
  }

  function updateDrawerHeader(project) {
    const info = statusInfo(project);
    setDrawerVisual(project);
    dom.drawerTitle.textContent = project.name;
    dom.drawerPath.textContent = project.path;
    dom.drawerStatus.className = `badge ${info.cls}${project.active && !project.paused ? ' active' : ''}`;
    dom.drawerStatus.textContent = info.label;
    dom.drawerTask.textContent = project.currentTask || taskFallback(project);
    linkPlanReferences(dom.drawerTask, project.id);
    dom.drawerTask.classList.toggle('empty', !project.currentTask);
    dom.drawerNext.textContent = project.nextTask || '—';
    linkPlanReferences(dom.drawerNext, project.id);
    const currentWrapper = dom.drawerTask.closest('.task-detail-wrap');
    currentWrapper.dataset.projectId = String(project.id);
    currentWrapper.dataset.fallback = project.currentTask ? 'false' : 'true';
    const nextWrapper = dom.drawerNext.closest('[data-project-id][data-task-field]');
    nextWrapper.dataset.projectId = String(project.id);
    nextWrapper.dataset.fallback = project.nextTask ? 'false' : 'true';
    syncTaskExpansion(project.id, 'current');
    syncTaskExpansion(project.id, 'next');
    updateDrawerControls(project);
    updateDrawerPolicy(project);
    updateDrawerModel(project);
    updateDrawerAutoResume(project);
    updateAllCountdowns();
    updateLogStatus();
    updateDependencyWarning(project);
  }

  function updateDependencyWarning(project) {
    if (!dom.dependencyStatus) return;
    const warning = project?.dependencyWarning || project?.dependencyError || '';
    dom.dependencyStatus.textContent = warning ? `⚠ ${warning}` : '';
    dom.dependencyStatus.classList.toggle('warn', Boolean(warning));
  }

  function openDrawer(id) {
    const project = projectById(id);
    if (!project) return;
    setSidebarOpen(false);
    app.drawerId = id;
    app.planDirty = false;
    editingTaskIndex = -1;
    restoreShowCompletedForProject(id);
    restoreUiStateForProject(id);
    app.currentPlan = null;
    app.planTaskCount = 0;
    clearDragIndicators();
    updateToggleCompletedButton();
    app.autoResumeDirty = false;
    dom.autoResumeStatus.textContent = '';
    app.lastPlanKey = '';
    dom.planEditor.value = '';
    dom.answerEditor.value = '';
    dom.answerStatus.textContent = 'No handoff loaded';
    dom.confirmPlan.hidden = true;
    dom.planConfirmStatus.textContent = '';
    dom.drawerControlStatus.hidden = true;
    dom.drawerControlStatus.textContent = '';
    dom.blockPolicyStatus.textContent = '';
    updatePlanControls();
    dom.drawer.hidden = false;
    dom.drawerBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    updateDrawerHeader(project);
    requestAnimationFrame(() => {
      if (app.drawerId !== id) return;
      syncTaskExpansion(id, 'current');
      syncTaskExpansion(id, 'next');
    });
    syncSectionStates(id);
    applyAutoEmptySections(id);
    renderLogs(id);
    loadPlan(id);
    loadAnswer(id);
    dom.drawerClose.focus();
  }

  function closeDrawer() {
    dom.drawer.hidden = true;
    dom.drawerBackdrop.hidden = true;
    document.body.style.overflow = '';
    app.drawerId = null;
    setDrawerVisual(null);
    app.planDirty = false;
    editingTaskIndex = -1;
    app.currentPlan = null;
    app.planTaskCount = 0;
    clearDragIndicators();
    updateToggleCompletedButton();
    app.autoResumeDirty = false;
    dom.drawerControlStatus.hidden = true;
    dom.drawerControlStatus.textContent = '';
    dom.logFollow.hidden = true;
    updatePlanControls();
  }

  function cleanTaskText(value) {
    return String(value || '')
      .trim()
      .replace(/^[-*+]\s+\[[ xX]\]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function planTaskLineIndexes(content) {
    return String(content || '').split('\n').reduce((indexes, line, index) => {
      if (TASK_LINE_RE.test(line.replace(/\r$/, ''))) indexes.push(index);
      return indexes;
    }, []);
  }

  function visibleTaskIndexes(tasks, showCompleted) {
    return (tasks || [])
      .filter((task) => showCompleted || !task.checked)
      .map((task) => task.index);
  }

  function visibleTaskNeighbor(visibleIndexes, fromTaskIndex, direction) {
    const position = visibleIndexes.indexOf(fromTaskIndex);
    if (position < 0) return null;
    const target = visibleIndexes[position + direction];
    return target === undefined ? null : target;
  }

  function reorderPlanTask(content, fromTaskIndex, toTaskIndex) {
    const lines = String(content || '').split('\n');
    const taskLines = planTaskLineIndexes(lines.join('\n'));
    if (!Number.isInteger(fromTaskIndex) || !Number.isInteger(toTaskIndex)) return null;
    if (fromTaskIndex < 0 || toTaskIndex < 0) return null;
    if (fromTaskIndex >= taskLines.length || toTaskIndex >= taskLines.length) return null;
    if (fromTaskIndex === toTaskIndex) return lines.join('\n');
    const next = lines.slice();
    const taskValues = taskLines.map((lineIndex) => next[lineIndex]);
    const [moved] = taskValues.splice(fromTaskIndex, 1);
    taskValues.splice(toTaskIndex, 0, moved);
    taskLines.forEach((lineIndex, index) => { next[lineIndex] = taskValues[index]; });
    return next.join('\n');
  }

  function taskEditTarget(content, taskIndex) {
    const index = Number(taskIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    const lines = String(content || '').split('\n');
    const line = planTaskLineIndexes(lines.join('\n'))[index];
    if (line === undefined) return null;
    const raw = lines[line];
    const lineEnding = raw.endsWith('\r') ? '\r' : '';
    const match = raw.slice(0, raw.length - lineEnding.length).match(TASK_EDIT_RE);
    if (!match) return null;
    return { lines, line, match, lineEnding };
  }

  function normalizeTaskEditText(text) {
    if (text === undefined || text === null) return '';
    return String(text).trim().replace(/\s+/g, ' ').trim();
  }

  function editPlanTaskContent(content, taskIndex, newText) {
    const target = taskEditTarget(content, taskIndex);
    if (!target) return { ok: false, error: `No checklist item at index ${taskIndex}` };
    const text = normalizeTaskEditText(newText);
    if (!text) return { ok: false, error: 'Task text is required' };
    target.lines[target.line] = `${target.match[1]}${target.match[2]}${target.match[3]}${text}${target.lineEnding}`;
    return { ok: true, content: target.lines.join('\n') };
  }

  function removePlanTaskContent(content, taskIndex) {
    const target = taskEditTarget(content, taskIndex);
    if (!target) return { ok: false, error: `No checklist item at index ${taskIndex}` };
    target.lines.splice(target.line, 1);
    return { ok: true, content: target.lines.join('\n') };
  }

  function appendTask(content, text) {
    const clean = cleanTaskText(text);
    if (!clean) return null;
    const source = String(content || '');
    if (!source) return `- [ ] ${clean}\n`;
    const lines = source.split('\n');
    const taskLines = planTaskLineIndexes(source);
    const insertAt = taskLines.length ? taskLines[taskLines.length - 1] + 1 : lines.length;
    lines.splice(insertAt, 0, `- [ ] ${clean}`);
    return lines.join('\n');
  }

  function insertTaskFirst(content, text) {
    const clean = cleanTaskText(text);
    if (!clean) return null;
    const source = String(content || '');
    if (!source) return `- [ ] ${clean}\n`;
    const lines = source.split('\n');
    const taskLines = planTaskLineIndexes(source);
    const insertAt = taskLines.length ? taskLines[0] : lines.length;
    lines.splice(insertAt, 0, `- [ ] ${clean}`);
    return lines.join('\n');
  }

  function insertTaskAfter(content, text, targetTaskIndex) {
    const clean = cleanTaskText(text);
    if (!clean) return null;
    const index = Number(targetTaskIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    const source = String(content || '');
    const taskLines = planTaskLineIndexes(source);
    const targetLine = taskLines[index];
    if (targetLine === undefined) return null;
    const lines = source.split('\n');
    lines.splice(targetLine + 1, 0, `- [ ] ${clean}`);
    return lines.join('\n');
  }

  function taskSnippet(text) {
    const clean = cleanTaskText(text);
    if (!clean) return '';
    return clean.split(/\s+/).slice(0, 5).join(' ');
  }

  function refreshTaskInsertAfterOptions() {
    const select = dom.taskInsertAfter;
    if (!select) return;
    const position = dom.taskInsertPosition ? dom.taskInsertPosition.value : 'last';
    const tasks = app.currentPlan?.tasks || [];
    const previous = select.value;
    const options = ['<option value="">After which task</option>'];
    tasks.forEach((task) => {
      const label = taskSnippet(task.text) || `Task ${task.index + 1}`;
      options.push(`<option value="${task.index}">${esc(label)}</option>`);
    });
    select.innerHTML = options.join('');
    const stillExists = previous === '' || tasks.some((task) => String(task.index) === previous);
    select.value = stillExists ? previous : '';
    select.hidden = position !== 'after';
  }

  async function ensurePlanContent() {
    if (dom.planEditor.value) return dom.planEditor.value;
    const id = app.drawerId;
    if (!id) return '';
    const plan = await api(`/api/projects/${encodeURIComponent(id)}/plan`);
    return plan.content || '';
  }

  function restoreChecklistFocus(action, taskIndex) {
    if (!action || taskIndex === null || taskIndex === undefined) return;
    const control = dom.checklist.querySelector(
      `button[data-action="${action}"][data-task-index="${taskIndex}"], input[data-action="${action}"][data-task-index="${taskIndex}"]`
    );
    if (control && !control.disabled && typeof control.focus === 'function') control.focus();
  }

  function renderChecklist(plan) {
    const activeControl = dom.checklist.contains(document.activeElement)
      ? document.activeElement.closest('[data-task-index]')
      : null;
    const focusAction = activeControl ? activeControl.dataset.action : null;
    const focusTaskIndex = activeControl ? activeControl.dataset.taskIndex : null;
    app.currentPlan = plan;
    app.planTaskCount = plan.tasks?.length || 0;
    updateToggleCompletedButton();
    refreshTaskInsertAfterOptions();
    const visible = (plan.tasks || [])
      .map((task) => ({ task, taskIndex: task.index }))
      .filter(({ task }) => app.showCompleted || !task.checked);
    if (!visible.length) {
      const message = !app.showCompleted && app.planTaskCount
        ? 'No incomplete tasks. Show completed to edit.'
        : 'No checklist items found.';
      dom.checklist.innerHTML = `<div class="muted small-text">${message}</div>`;
      updatePlanControls();
      restoreChecklistFocus(focusAction, focusTaskIndex);
      return;
    }
    const visibleIndexes = visible.map(({ taskIndex }) => taskIndex);
    dom.checklist.innerHTML = visible.map(({ task, taskIndex }, visiblePosition) => {
      const editing = editingTaskIndex === taskIndex;
      const previousVisibleIndex = visibleIndexes[visiblePosition - 1];
      const nextVisibleIndex = visibleIndexes[visiblePosition + 1];
      const taskText = editing
        ? `<input class="task-edit-input" data-action="edit-input" data-task-index="${taskIndex}" value="${esc(task.text || '')}">`
        : `<span class="task-text">${esc(task.text || '(empty task)')}</span>`;
      const dependencyView = plan.dependencyStatus?.tasks?.[task.index];
      const dependencies = dependencyView?.dependencies || [];
      const depLabel = dependencies.length
        ? `Depends on: ${dependencies.map((dep) => `#${dep}`).join(', ')}`
        : '';
      const depWarning = dependencyView?.blocked
        ? `<span class="task-deps warn">⚠ ${esc(dependencyView.reason || 'Dependency not ready')}</span>`
        : '';
      const depsMarkup = depLabel || depWarning
        ? `<span class="task-deps${dependencyView?.blocked ? ' warn' : ''}">${esc(depLabel)}</span>${depWarning}`
        : '';
      // Sprint chip plus merge-previous/deploy-main toggles; locked once the
      // task started (plan.started from disk truth).
      const started = plan.started?.[task.index] === true;
      const cardOptions = [
        task.sprint ? `<span class="sprint-chip${started ? ' started' : ''}" title="Sprint: ${esc(task.sprint)}">Sprint: ${esc(task.sprint)}</span>` : '',
        `<button class="task-flag-toggle${task.mergePrevious ? ' active' : ''}" type="button" data-action="toggle-flag" data-flag="merge-previous" data-task-index="${taskIndex}" ${started ? 'disabled' : ''} title="Merge completed earlier sprint branches into this task before it starts">Merge previous</button>`,
        `<button class="task-flag-toggle${task.deployMain ? ' active' : ''}" type="button" data-action="toggle-flag" data-flag="deploy-main" data-task-index="${taskIndex}" ${started ? 'disabled' : ''} title="Merge this task branch into main locally after completion">Deploy main</button>`
      ].filter(Boolean).join('');
      const optionsMarkup = cardOptions ? `<div class="task-card-options${started ? ' locked' : ''}">${cardOptions}</div>` : '';
      return `
      <div class="check-item${task.checked ? ' checked' : ''}${started ? ' task-started' : ''}" data-task-index="${taskIndex}">
        <div class="task-controls">
          <button class="move-button drag-handle" type="button" data-action="drag" data-task-index="${taskIndex}" title="Drag to reorder task" aria-label="Drag to reorder task">☰</button>
          <div class="task-move">
            <button class="move-button" type="button" data-action="move-top" data-task-index="${taskIndex}" ${previousVisibleIndex === undefined ? 'disabled' : ''} aria-label="Move task to top">⇈</button>
            <button class="move-button" type="button" data-action="move-up" data-task-index="${taskIndex}" ${previousVisibleIndex === undefined ? 'disabled' : ''} aria-label="Move task up">↑</button>
            <button class="move-button" type="button" data-action="move-down" data-task-index="${taskIndex}" ${nextVisibleIndex === undefined ? 'disabled' : ''} aria-label="Move task down">↓</button>
            <button class="move-button" type="button" data-action="move-bottom" data-task-index="${taskIndex}" ${nextVisibleIndex === undefined ? 'disabled' : ''} aria-label="Move task to bottom">⇊</button>
          </div>
          <div class="task-actions">
            ${editing
              ? `<button class="icon-button save-task-button" type="button" data-action="save-task" data-task-index="${taskIndex}" aria-label="Save task" title="Save task">💾</button>`
              : `<button class="icon-button edit-task-button" type="button" data-action="edit-task" data-task-index="${taskIndex}" aria-label="Edit task" title="Edit task">✎</button>`}
            <button class="icon-button remove-task-button" type="button" data-action="remove-task" data-task-index="${taskIndex}" aria-label="Delete task" title="Delete task">✕</button>
          </div>
        </div>
        <div class="check-label">
          <input type="checkbox" data-index="${task.index}" ${task.checked ? 'checked' : ''}>
          <span class="check-index">${task.index + 1}</span>
          ${taskText}
          ${depsMarkup}
        </div>
        ${optionsMarkup}
      </div>`;
    }).join('');
    dom.checklist.querySelectorAll('.task-text').forEach((span) => linkPlanReferences(span, app.drawerId));
    updatePlanControls();
    restoreChecklistFocus(focusAction, focusTaskIndex);
    if (editingTaskIndex >= 0) {
      const input = dom.checklist.querySelector(`.task-edit-input[data-task-index="${editingTaskIndex}"]`);
      if (input && !input.disabled) {
        input.focus();
        input.select();
      }
    }
  }

  function toggleCompleted() {
    if (!app.drawerId || app.savingPlan) return;
    if (editingTaskIndex !== -1) cancelTaskEdit();
    const show = !app.showCompleted;
    setShowCompleted(app.drawerId, show);
    app.showCompleted = isShowCompleted(app.drawerId);
    updateToggleCompletedButton();
    if (app.currentPlan) renderChecklist(app.currentPlan);
  }

  function clearDragIndicators() {
    document.body.classList.remove('plan-dragging');
    dom.checklist.querySelectorAll('.dragging, .drag-before, .drag-after').forEach((node) => {
      node.classList.remove('dragging', 'drag-before', 'drag-after');
    });
  }

  function startPlanDrag(handle, event) {
    if (app.savingPlan || app.planDirty || !app.drawerId || handle.disabled) return;
    planDrag = {
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fromTaskIndex: Number(handle.dataset.taskIndex),
      toTaskIndex: null,
      active: false
    };
    try { handle.setPointerCapture(event.pointerId); } catch { /* pointer capture unavailable */ }
  }

  function updatePlanDrag(event) {
    if (!planDrag || event.pointerId !== planDrag.pointerId) return;
    const distance = Math.hypot(event.clientX - planDrag.startX, event.clientY - planDrag.startY);
    if (!planDrag.active && distance < 5) return;
    event.preventDefault();
    if (!planDrag.active) {
      planDrag.active = true;
      document.body.classList.add('plan-dragging');
      const source = planDrag.handle.closest('.check-item');
      if (source) source.classList.add('dragging');
    }
    dom.checklist.querySelectorAll('.drag-before, .drag-after').forEach((node) => {
      node.classList.remove('drag-before', 'drag-after');
    });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.check-item');
    planDrag.toTaskIndex = null;
    if (!target || !dom.checklist.contains(target)) return;
    const targetIndex = Number(target.dataset.taskIndex);
    if (!Number.isInteger(targetIndex)) return;
    const rect = target.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    let to = targetIndex + (insertAfter ? 1 : 0);
    if (planDrag.fromTaskIndex < to) to -= 1;
    planDrag.toTaskIndex = to;
    target.classList.add(insertAfter ? 'drag-after' : 'drag-before');
  }

  function finishPlanDrag(event, shouldCommit) {
    if (!planDrag || event.pointerId !== planDrag.pointerId) return;
    const drag = planDrag;
    const commit = shouldCommit && drag.active && drag.toTaskIndex != null
      && drag.fromTaskIndex !== drag.toTaskIndex;
    planDrag = null;
    try { drag.handle.releasePointerCapture(event.pointerId); } catch { /* pointer capture unavailable */ }
    clearDragIndicators();
    if (drag.active) {
      suppressPlanClick = true;
      setTimeout(() => { suppressPlanClick = false; }, 0);
    }
    if (commit) void reorderChecklistTask(drag.fromTaskIndex, drag.toTaskIndex);
  }

  function focusTaskControl(taskIndex) {
    const handle = dom.checklist.querySelector(`.drag-handle[data-task-index="${taskIndex}"]`);
    if (handle) handle.focus();
  }

  async function loadPlan(id) {
    try {
      const plan = await api(`/api/projects/${encodeURIComponent(id)}/plan`);
      if (app.drawerId !== id || app.planDirty) return;
      editingTaskIndex = -1;
      renderChecklist(plan);
      updatePlanGuide(plan);
      dom.planEditor.value = plan.content || '';
      updatePlanControls();
      let statusText;
      if (plan.ok) {
        statusText = `${plan.stats.completed}/${plan.stats.total} tasks`;
      } else {
        const project = projectById(id);
        statusText = project && isPlanSetup(project)
          ? 'Create plan.md here, then save.'
          : plan.error || 'Could not read plan.md';
      }
      const dependencyError = plan.dependencyStatus?.error || '';
      if (dependencyError) statusText += ` · ⚠ ${dependencyError}`;
      dom.planStatus.textContent = statusText;
      applyAutoEmptySections(id);
    } catch (error) {
      if (app.drawerId === id) {
        dom.planStatus.textContent = error.message;
        updatePlanControls();
      }
    }
  }

  async function savePlanContent(content, message, change) {
    const id = app.drawerId;
    if (!id || app.savingPlan) return false;
    app.savingPlan = true;
    planSavePending += 1;
    updatePlanControls();
    planSaveChain = planSaveChain.catch(() => {}).then(async () => {
      try {
        await api(`/api/projects/${encodeURIComponent(id)}/plan`, {
          method: 'PUT',
          body: JSON.stringify(change === undefined ? { content } : { content, change })
        });
        if (app.drawerId === id) {
          const editorChanged = dom.planEditor.value !== content;
          if (editorChanged) {
            markPlanDirty();
            refreshTaskInsertAfterOptions();
          } else {
            app.planDirty = false;
            app.lastPlanKey = '';
            await loadPlan(id);
          }
          await refreshState();
          if (!editorChanged) dom.planStatus.textContent = message || 'saved';
        }
        return true;
      } catch (error) {
        if (app.drawerId === id) dom.planStatus.textContent = error.message;
        return false;
      } finally {
        planSavePending = Math.max(0, planSavePending - 1);
        if (planSavePending === 0) {
          app.savingPlan = false;
          updatePlanControls();
        }
      }
    });
    return planSaveChain;
  }

  function buildTaskSlug(title) {
    const stripped = String(title || '').replace(/^\s*\(plan\)\s*/i, '');
    const normalized = stripped.normalize('NFKD').toLowerCase();
    const runs = normalized.match(/[a-z0-9]+/g);
    let slug = runs ? runs.join('-') : '';
    slug = slug.replace(/^-+|-+$/g, '');
    if (!slug) slug = 'task';
    return slug.slice(0, 60).replace(/-+$/, '');
  }

  function formatLinkedTask(title, file) {
    return `(plan) ${title} \u2014 see [${file}](.project_documents/${file})`;
  }

  async function planFileExists(projectId, basename) {
    try {
      await api(planFileUrl(projectId, `.project_documents/${basename}`));
      return true;
    } catch {
      return false;
    }
  }

  async function resolveLinkedDocName(title, override, fileExists) {
    const prefixRe = new RegExp(`^(?:${PLAN_FILE_PREFIXES})$`);
    if (override) {
      const name = String(override).trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name)) throw new Error('Invalid doc filename.');
      const prefix = name.split('-', 1)[0];
      if (!prefixRe.test(prefix)) throw new Error('Invalid doc prefix.');
      return name;
    }
    const slug = buildTaskSlug(title);
    let candidate = `PLAN-${slug}.md`;
    let counter = 2;
    while (await fileExists(candidate)) {
      candidate = `PLAN-${slug}-${counter}.md`;
      counter += 1;
    }
    return candidate;
  }

  async function addChecklistTask() {
    const id = app.drawerId;
    if (!id || app.savingPlan) return;
    const text = cleanTaskText(dom.taskInput.value);
    if (!text) {
      dom.taskStatus.textContent = 'Enter a task.';
      return;
    }
    dom.taskStatus.textContent = 'adding…';
    try {
      let taskText = text;
      if (dom.taskLinkDoc && dom.taskLinkDoc.checked) {
        const title = String(text).replace(/^\s*\(plan\)\s*/i, '');
        const override = dom.taskDocFile && dom.taskDocFile.value ? String(dom.taskDocFile.value).trim() : '';
        let file;
        try {
          file = await resolveLinkedDocName(title, override, (name) => planFileExists(id, name));
        } catch (error) {
          dom.taskStatus.textContent = error.message || 'Invalid doc filename.';
          return;
        }
        const exists = await planFileExists(id, file);
        if (!exists) {
          try {
            await api(`/api/projects/${encodeURIComponent(id)}/plan-file`, {
              method: 'PUT',
              body: JSON.stringify({ path: `.project_documents/${file}`, content: `# ${title}` })
            });
          } catch (error) {
            dom.taskStatus.textContent = `Doc stub could not be created: ${error.message || 'request failed'}`;
            return;
          }
        }
        taskText = formatLinkedTask(title, file);
      }
      // Validation-type dropdown and sprint assignment compose the tokens.
      const validationType = dom.taskValidationType && dom.taskValidationType.value ? dom.taskValidationType.value : '';
      const sprintName = dom.taskSprintSelect && dom.taskSprintSelect.value ? dom.taskSprintSelect.value : '';
      if (validationType) {
        taskText = `(validation: ${validationType}) ${validationType} Validation` + (sprintName ? ` [sprint:${sprintName}]` : '');
      } else if (sprintName && !/\[sprint:[^\]]*\]/i.test(taskText)) {
        taskText = `${taskText} [sprint:${sprintName}]`;
      }
      const content = await ensurePlanContent();
      const insertPosition = dom.taskInsertPosition?.value || 'last';
      let next;
      if (insertPosition === 'first') {
        next = insertTaskFirst(content, taskText);
      } else if (insertPosition === 'after') {
        const target = Number(dom.taskInsertAfter?.value);
        next = insertTaskAfter(content, taskText, target);
        if (!next) next = appendTask(content, taskText);
      } else {
        next = appendTask(content, taskText);
      }
      if (!next) {
        dom.taskStatus.textContent = 'Could not add task.';
        return;
      }
      dom.planEditor.value = next;
      markPlanDirty();
      const saved = await savePlanContent(next, 'task added');
      if (app.drawerId !== id) return;
      dom.taskStatus.textContent = saved ? '' : 'Could not add task.';
      if (saved) dom.taskInput.value = '';
    } catch (error) {
      if (app.drawerId === id) dom.taskStatus.textContent = error.message;
    }
  }

  async function reorderChecklistTask(fromTaskIndex, toTaskIndex) {
    const id = app.drawerId;
    if (!id || app.savingPlan || app.planDirty || editingTaskIndex !== -1) return;
    if (!Number.isInteger(fromTaskIndex) || !Number.isInteger(toTaskIndex)) return;
    if (fromTaskIndex < 0 || toTaskIndex < 0) return;
    if (fromTaskIndex >= app.planTaskCount || toTaskIndex >= app.planTaskCount) return;
    if (fromTaskIndex === toTaskIndex) return;
    const previousEditor = dom.planEditor.value;
    const previousStatus = dom.planStatus.textContent;
    try {
      const content = await ensurePlanContent();
      const next = reorderPlanTask(content, fromTaskIndex, toTaskIndex);
      if (!next) {
        if (app.drawerId === id) dom.taskStatus.textContent = 'Could not move task.';
        return;
      }
      dom.planEditor.value = next;
      markPlanDirty();
      dom.taskStatus.textContent = 'Moving task…';
      const saved = await savePlanContent(next, 'Task moved');
      if (app.drawerId !== id) return;
      if (saved) {
        editingTaskIndex = -1;
        dom.taskStatus.textContent = 'Task moved';
        focusTaskControl(toTaskIndex);
        return;
      }
      dom.planEditor.value = previousEditor;
      app.planDirty = false;
      dom.planStatus.textContent = previousStatus;
      editingTaskIndex = -1;
      updatePlanControls();
      await loadPlan(id);
      dom.taskStatus.textContent = 'Could not move task.';
    } catch (error) {
      if (app.drawerId === id) {
        dom.planEditor.value = previousEditor;
        app.planDirty = false;
        dom.planStatus.textContent = previousStatus;
        editingTaskIndex = -1;
        updatePlanControls();
        await loadPlan(id);
        dom.taskStatus.textContent = error.message;
      }
    }
  }

  function taskByIndex(taskIndex) {
    return (app.currentPlan?.tasks || []).find((task) => task.index === taskIndex) || null;
  }

  function focusEditButton(taskIndex) {
    const button = dom.checklist.querySelector(`.edit-task-button[data-task-index="${taskIndex}"]`);
    if (button && !button.disabled) button.focus();
    else dom.addTask.focus();
  }

  function focusNearestEditButton(taskIndex) {
    const buttons = [...dom.checklist.querySelectorAll('.edit-task-button:not(:disabled)')];
    if (!buttons.length) {
      dom.addTask.focus();
      return;
    }
    const nearest = buttons.reduce((best, button) => {
      const distance = Math.abs(Number(button.dataset.taskIndex) - taskIndex);
      const bestDistance = Math.abs(Number(best.dataset.taskIndex) - taskIndex);
      return distance < bestDistance ? button : best;
    });
    nearest.focus();
  }

  function startTaskEdit(taskIndex) {
    if (!app.drawerId || app.savingPlan || app.planDirty || editingTaskIndex !== -1) return;
    const task = taskByIndex(taskIndex);
    if (!task) return;
    editingTaskIndex = taskIndex;
    dom.taskStatus.textContent = '';
    if (app.currentPlan) renderChecklist(app.currentPlan);
  }

  function cancelTaskEdit() {
    if (editingTaskIndex < 0) return;
    const previous = editingTaskIndex;
    editingTaskIndex = -1;
    if (app.currentPlan) renderChecklist(app.currentPlan);
    else updatePlanControls();
    focusEditButton(previous);
  }

  // Tokens live outside task.text after parsing, so a plain text edit would
  // drop them; re-attach what the stored line carried (mirrors src/plan.js).
  function appendTaskTokens(text, task) {
    const parts = [text];
    if (task.mergePrevious) parts.push('[merge-previous]');
    if (task.deployMain) parts.push('[deploy-main]');
    if (task.sprint) parts.push(`[sprint:${task.sprint}]`);
    if (task.dependencySuffix) parts.push(task.dependencySuffix);
    return parts.join(' ');
  }

  function stripTaskTokens(text) {
    let value = String(text || '');
    for (;;) {
      const next = value
        .replace(/\s*\(depends:\s*[^)]*\)\s*$/i, '')
        .replace(/\s*\[sprint:[^\]]*\]\s*$/i, '')
        .replace(/\s*\[merge-previous\]\s*$/i, '')
        .replace(/\s*\[deploy-main\]\s*$/i, '');
      if (next === value) break;
      value = next.trim();
    }
    return value;
  }

  async function toggleTaskFlag(taskIndex, flag) {
    const id = app.drawerId;
    if (!id || app.savingPlan || app.planDirty || editingTaskIndex !== -1) return;
    if (flag !== 'merge-previous' && flag !== 'deploy-main') return;
    const task = taskByIndex(taskIndex);
    if (!task) return;
    if (app.currentPlan?.started?.[taskIndex] === true) {
      dom.taskStatus.textContent = 'Task already started: options are locked.';
      return;
    }
    const token = flag === 'merge-previous' ? '[merge-previous]' : '[deploy-main]';
    const previousEditor = dom.planEditor.value;
    const previousStatus = dom.planStatus.textContent;
    try {
      const content = await ensurePlanContent();
      const target = taskEditTarget(content, taskIndex);
      if (!target) {
        dom.taskStatus.textContent = 'Could not find the task line.';
        return;
      }
      const inner = target.match[4];
      let newInner;
      if (inner.includes(token)) {
        newInner = inner.replace(new RegExp(`\\s*\\[${flag}\\]`, 'g'), '').replace(/\s+/g, ' ').trim();
      } else {
        newInner = `${inner.trim()} ${token}`;
      }
      if (!newInner.trim()) newInner = token;
      const result = editPlanTaskContent(content, taskIndex, newInner);
      if (!result.ok) {
        dom.taskStatus.textContent = result.error;
        return;
      }
      editingTaskIndex = -1;
      dom.planEditor.value = result.content;
      markPlanDirty();
      dom.taskStatus.textContent = 'Saving…';
      const saved = await savePlanContent(result.content, 'Task updated', {
        type: 'edit',
        index: taskIndex,
        oldText: task.text,
        newText: stripTaskTokens(newInner)
      });
      if (app.drawerId !== id) return;
      if (saved) dom.taskStatus.textContent = 'Task updated';
      else {
        dom.planEditor.value = previousEditor;
        app.planDirty = false;
        dom.planStatus.textContent = previousStatus;
        updatePlanControls();
        await loadPlan(id);
        dom.taskStatus.textContent = 'Could not update task.';
      }
    } catch (error) {
      if (app.drawerId === id) dom.taskStatus.textContent = error.message;
    }
  }

  async function saveTaskEdit(taskIndex) {
    const id = app.drawerId;
    if (!id || app.savingPlan || app.planDirty || editingTaskIndex !== taskIndex) return;
    if (!Number.isInteger(taskIndex) || taskIndex < 0) return;
    const task = taskByIndex(taskIndex);
    if (!task) return;
    const input = dom.checklist.querySelector(`.task-edit-input[data-task-index="${taskIndex}"]`);
    if (!input || input.disabled) return;
    const newText = cleanTaskText(input.value);
    if (!newText) {
      dom.taskStatus.textContent = 'Enter task text.';
      return;
    }
    const oldText = task.text;
    const newTextWithTokens = appendTaskTokens(newText, task);
    const previousEditor = dom.planEditor.value;
    const previousStatus = dom.planStatus.textContent;
    try {
      const content = await ensurePlanContent();
      const result = editPlanTaskContent(content, taskIndex, newTextWithTokens);
      if (!result.ok) {
        if (app.drawerId === id) dom.taskStatus.textContent = result.error;
        return;
      }
      editingTaskIndex = -1;
      dom.planEditor.value = result.content;
      markPlanDirty();
      dom.taskStatus.textContent = 'Saving task…';
      const saved = await savePlanContent(result.content, 'Task updated', {
        type: 'edit',
        index: taskIndex,
        oldText,
        newText,
      });
      if (app.drawerId !== id) return;
      if (saved) {
        editingTaskIndex = -1;
        dom.taskStatus.textContent = 'Task updated';
        focusEditButton(taskIndex);
        return;
      }
      dom.planEditor.value = previousEditor;
      app.planDirty = false;
      dom.planStatus.textContent = previousStatus;
      editingTaskIndex = -1;
      updatePlanControls();
      await loadPlan(id);
      dom.taskStatus.textContent = 'Could not update task.';
    } catch (error) {
      if (app.drawerId === id) {
        dom.planEditor.value = previousEditor;
        app.planDirty = false;
        dom.planStatus.textContent = previousStatus;
        editingTaskIndex = -1;
        updatePlanControls();
        await loadPlan(id);
        dom.taskStatus.textContent = error.message;
      }
    }
  }

  async function deleteTask(taskIndex) {
    const id = app.drawerId;
    if (!id || app.savingPlan || app.planDirty) return;
    if (!Number.isInteger(taskIndex) || taskIndex < 0) return;
    const task = taskByIndex(taskIndex);
    if (!task) return;
    const oldText = task.text;
    const confirmed = window.confirm('Delete task '+(taskIndex+1)+': "'+oldText+'"? This removes the checklist line from plan.md and cannot be undone.');
    if (!confirmed) return;
    const previousEditor = dom.planEditor.value;
    const previousStatus = dom.planStatus.textContent;
    try {
      const content = await ensurePlanContent();
      const result = removePlanTaskContent(content, taskIndex);
      if (!result.ok) {
        if (app.drawerId === id) dom.taskStatus.textContent = result.error;
        return;
      }
      editingTaskIndex = -1;
      dom.planEditor.value = result.content;
      markPlanDirty();
      dom.taskStatus.textContent = 'Deleting task…';
      const saved = await savePlanContent(result.content, 'Task deleted', {
        type: 'remove',
        index: taskIndex,
        oldText
      });
      if (app.drawerId !== id) return;
      if (saved) {
        editingTaskIndex = -1;
        dom.taskStatus.textContent = 'Task deleted';
        focusNearestEditButton(taskIndex);
        return;
      }
      dom.planEditor.value = previousEditor;
      app.planDirty = false;
      dom.planStatus.textContent = previousStatus;
      editingTaskIndex = -1;
      updatePlanControls();
      await loadPlan(id);
      dom.taskStatus.textContent = 'Could not delete task.';
    } catch (error) {
      if (app.drawerId === id) {
        dom.planEditor.value = previousEditor;
        app.planDirty = false;
        dom.planStatus.textContent = previousStatus;
        editingTaskIndex = -1;
        updatePlanControls();
        await loadPlan(id);
        dom.taskStatus.textContent = error.message;
      }
    }
  }

  async function loadAnswer(id = app.drawerId) {
    if (!id) return;
    dom.answerStatus.textContent = 'loading…';
    try {
      const answer = await api(`/api/projects/${encodeURIComponent(id)}/answer`);
      if (app.drawerId !== id) return;
      dom.answerEditor.value = answer.content || '';
      dom.answerStatus.textContent = answer.exists
        ? (answer.content ? 'handoff ready' : 'handoff empty')
        : 'no handoff yet';
      applyAutoEmptySections(id);
    } catch (error) {
      if (app.drawerId === id) dom.answerStatus.textContent = error.message;
    }
  }

  async function saveProjectModel() {
    const id = app.drawerId;
    if (!id) return;
    dom.projectModelStatus.textContent = 'saving…';
    dom.saveProjectModel.disabled = true;
    try {
      await api(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          runner: readRunnerSelect(dom.drawerRunner),
          model: readModelSelect(dom.drawerModelInput),
          seedModel: readModelSelect(dom.drawerSeedModel),
          analyzeModel: readModelSelect(dom.drawerAnalyzeModel),
          implementModel: readModelSelect(dom.drawerImplementModel),
          planModel: readModelSelect(dom.drawerPlanModel),
          ...readRotationButtons(DRAWER_ROTATION_TARGETS)
        })
      });
      await refreshState();
      dom.projectModelStatus.textContent = 'saved';
    } catch (error) {
      dom.projectModelStatus.textContent = error.message;
    } finally {
      dom.saveProjectModel.disabled = false;
    }
  }

  async function saveAutoResume() {
    const id = app.drawerId;
    if (!id) return;
    dom.autoResumeStatus.textContent = 'saving…';
    dom.saveAutoResume.disabled = true;
    try {
      await api(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ autoResumeOnStart: Boolean(dom.autoResumeToggle.checked) })
      });
      await refreshState();
      app.autoResumeDirty = false;
      dom.autoResumeStatus.textContent = 'saved';
    } catch (error) {
      dom.autoResumeStatus.textContent = error.message;
    } finally {
      dom.saveAutoResume.disabled = false;
    }
  }

  async function saveBlockPolicy() {
    const id = app.drawerId;
    if (!id) return;
    dom.blockPolicyStatus.textContent = 'saving…';
    dom.saveBlockPolicy.disabled = true;
    try {
      await api(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          blockThreshold: dom.drawerBlockThreshold.value.trim() === '' ? '' : Number(dom.drawerBlockThreshold.value),
          cooloffSeconds: dom.drawerCooloffSeconds.value.trim() === '' ? '' : Number(dom.drawerCooloffSeconds.value),
          temporaryLiftScope: dom.drawerTemporaryLiftScope.value,
          permanentLift: dom.drawerPermanentLift.value
        })
      });
      await refreshState();
      dom.blockPolicyStatus.textContent = 'saved';
    } catch (error) {
      dom.blockPolicyStatus.textContent = error.message;
    } finally {
      dom.saveBlockPolicy.disabled = false;
    }
  }

  async function saveAnswer() {
    const id = app.drawerId;
    if (!id) return;
    dom.answerStatus.textContent = 'saving…';
    dom.saveAnswer.disabled = true;
    try {
      await api(`/api/projects/${encodeURIComponent(id)}/answer`, {
        method: 'PUT',
        body: JSON.stringify({ content: dom.answerEditor.value })
      });
      dom.answerStatus.textContent = 'saved';
      applyAutoEmptySections(id);
    } catch (error) {
      dom.answerStatus.textContent = error.message;
    } finally {
      dom.saveAnswer.disabled = false;
    }
  }

  /* ---------- sprints ---------- */

  // Mirror of the [sprint:<name>]/[merge-previous]/[deploy-main] token layer.
  function sprintListFromEditor() {
    return [...dom.drawerSprintList.querySelectorAll('.sprint-row-name')].map((input) => {
      const row = input.closest('.sprint-row');
      return { id: row?.dataset.sprintId || '', name: input.value };
    }).filter((sprint) => sprint.name.trim());
  }

  function sprintAddText(text, sprintName, validationType) {
    let taskText = String(text || '').trim();
    if (!taskText) return taskText;
    const hasValidation = Boolean(validationType);
    if (hasValidation) taskText = `(validation: ${validationType}) ${validationType} Validation`;
    if (sprintName) taskText += ` [sprint:${sprintName}]`;
    return taskText;
  }

  function updateDrawerSprints(project) {
    if (!dom.drawerSprintMode) return;
    const ids = ['drawerSprintMode', 'drawerSprintTestCommand', 'drawerSprintsParallel', 'drawerSprintDeployMain'];
    if (ids.some((key) => document.activeElement === dom[key])) {
      // Do not clobber fields the user is editing.
    } else {
      dom.drawerSprintMode.value = project.sprintMode || 'off';
      dom.drawerSprintTestCommand.value = project.sprintTestCommand || 'npm test';
      dom.drawerSprintsParallel.checked = project.sprintsParallel === true;
      dom.drawerSprintDeployMain.checked = project.sprintDeployMain === true;
    }
    const sprints = project.sprints || [];
    const markup = sprints.map((sprint) => `
      <div class="sprint-row" data-sprint-id="${esc(sprint.id)}">
        <input class="sprint-row-name" type="text" value="${esc(sprint.name)}" aria-label="Sprint name">
        <button class="icon-button sprint-row-remove" type="button" data-action="remove-sprint" data-sprint-id="${esc(sprint.id)}" aria-label="Remove sprint ${esc(sprint.name)}" title="Remove sprint">✕</button>
      </div>`).join('');
    if (dom.drawerSprintList.innerHTML !== markup) dom.drawerSprintList.innerHTML = markup;
    const summary = !(sprints.length) && (project.sprintMode || 'off') === 'off'
      ? 'off'
      : `${sprints.map((sprint) => sprint.name).join(', ') || 'no sprints'} · ${project.sprintMode || 'off'}`;
    if (document.activeElement !== dom.sprintSummary && dom.sprintSummary.textContent !== summary) {
      dom.sprintSummary.textContent = summary;
    }
    if (dom.taskSprintSelect) {
      const options = `<option value="">No sprint</option>${sprints.map((sprint) =>
        `<option value="${esc(sprint.name)}">${esc(sprint.name)}</option>`).join('')}`;
      if (dom.taskSprintSelect.innerHTML !== options) dom.taskSprintSelect.innerHTML = options;
    }
  }

  async function saveSprintSettings() {
    const id = app.drawerId;
    if (!id) return;
    dom.sprintStatus.textContent = 'saving…';
    dom.saveSprintSettings.disabled = true;
    try {
      const project = projectById(id);
      const storedSprints = project?.sprints || [];
      const sprints = sprintListFromEditor().map((sprint) => ({
        // A renamed sprint keeps its id so existing [sprint:tokens] keep working.
        id: storedSprints.find((stored) => stored.id === sprint.id)?.id || sprint.id,
        name: sprint.name
      }));
      await api(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sprintMode: dom.drawerSprintMode.value,
          sprints,
          sprintsParallel: dom.drawerSprintsParallel.checked,
          sprintTestCommand: dom.drawerSprintTestCommand.value.trim() || 'npm test',
          sprintDeployMain: dom.drawerSprintDeployMain.checked
        })
      });
      await refreshState();
      dom.sprintStatus.textContent = 'saved';
    } catch (error) {
      dom.sprintStatus.textContent = error.message;
    } finally {
      dom.saveSprintSettings.disabled = false;
    }
  }

  async function mergeSprintBranches() {
    const id = app.drawerId;
    if (!id) return;
    dom.sprintStatus.textContent = 'merging…';
    dom.sprintMerge.disabled = true;
    try {
      const result = await api(`/api/projects/${encodeURIComponent(id)}/sprint/merge`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      dom.sprintStatus.textContent = `merged: ${(result.sprints || []).join(', ') || 'nothing to merge'}`;
    } catch (error) {
      dom.sprintStatus.textContent = error.message;
    } finally {
      dom.sprintMerge.disabled = false;
    }
  }

  function addSprintRow() {
    const name = dom.drawerNewSprint.value.trim();
    if (!name) {
      dom.sprintStatus.textContent = 'Enter a sprint name.';
      return;
    }
    const existing = sprintListFromEditor();
    existing.push({ id: '', name });
    dom.drawerNewSprint.value = '';
    const stored = projectById(app.drawerId || '')?.sprints || [];
    dom.drawerSprintList.innerHTML = existing.map((sprint, index) => {
      const id = sprint.id || stored.find((entry) => entry.name === sprint.name)?.id || derivedSprintId(sprint.name, index);
      return `
      <div class="sprint-row" data-sprint-id="${esc(id)}">
        <input class="sprint-row-name" type="text" value="${esc(sprint.name)}" aria-label="Sprint name">
        <button class="icon-button sprint-row-remove" type="button" data-action="remove-sprint" data-sprint-id="${esc(id)}" aria-label="Remove sprint ${esc(sprint.name)}" title="Remove sprint">✕</button>
      </div>`;
    }).join('');
    dom.sprintStatus.textContent = 'unsaved';
  }

  function derivedSprintId(name, index) {
    return `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${index + 1}`;
  }

  /* ---------- state ---------- */

  function applyState(state) {
    if (!state) return;
    app.state = state;
    fillPathSuggestions(state.projects || []);
    updateHostSummary(state);

    const settings = state.settings || {};
    setIfIdle(dom.maxConcurrent, settings.maxConcurrent);
    setIfIdle(dom.mode, settings.mode);
    fillModelSelect(dom.model, settings.model, 'Runner default', settings.globalRunner);
    fillModelSelect(dom.seedModel, settings.seedModel, 'Inherit default model', settings.globalRunner);
    fillModelSelect(dom.analyzeModel, settings.analyzeModel, 'Inherit default model', settings.globalRunner);
    fillModelSelect(dom.implementModel, settings.implementModel, 'Inherit default model', settings.globalRunner);
    fillModelSelect(dom.planModel, settings.planModel, 'Inherit default model', settings.globalRunner);
    const setupRunner = readRunnerSelect(dom.projectRunner) || settings.globalRunner || '';
    fillModelSelect(dom.projectModel, '', 'Inherit global', setupRunner);
    fillModelSelect(dom.projectSeedModel, '', 'Inherit default model', setupRunner);
    fillModelSelect(dom.projectAnalyzeModel, '', 'Inherit default model', setupRunner);
    fillModelSelect(dom.projectImplementModel, '', 'Inherit default model', setupRunner);
    fillModelSelect(dom.projectPlanModel, '', 'Inherit default model', setupRunner);
    applyRotationButtons(GLOBAL_ROTATION_TARGETS, settings);
    applyRotationButtons(PROJECT_SETUP_ROTATION_TARGETS, settings);
    setIfIdle(dom.rateLimitSeconds, settings.rateLimitPauseSeconds);
    setIfIdle(dom.cooloffSeconds, settings.cooloffSeconds);
    setIfIdle(dom.blockThreshold, settings.blockThreshold);
    setIfIdle(dom.temporaryLiftScope, settings.temporaryLiftScope);
    setIfIdle(dom.permanentLift, settings.permanentLift);
    setIfIdle(dom.seedPromptTemplate, settings.seedPromptTemplate);
    setIfIdle(dom.analyzePromptTemplate, settings.analyzePromptTemplate);
    setIfIdle(dom.implementPromptTemplate, settings.implementPromptTemplate);
    setIfIdle(dom.planQuestionsPromptTemplate, settings.planQuestionsPromptTemplate);
    setIfIdle(dom.planWritePromptTemplate, settings.planWritePromptTemplate);
    if (document.activeElement !== dom.promptCliToolsNote) {
      dom.promptCliToolsNote.checked = settings.promptCliToolsNote === true;
    }
    if (dom.stickyAddTaskRow && document.activeElement !== dom.stickyAddTaskRow) {
      dom.stickyAddTaskRow.checked = settings.stickyAddTaskRow === true;
    }
    if (dom.paseoTransport && document.activeElement !== dom.paseoTransport) {
      dom.paseoTransport.checked = settings.paseoTransport === true;
    }
    if (dom.handoffRecovery && document.activeElement !== dom.handoffRecovery) {
      dom.handoffRecovery.checked = settings.handoffRecovery === true;
    }
    if (dom.selfHealing && document.activeElement !== dom.selfHealing) {
      dom.selfHealing.checked = settings.selfHealing === true;
    }
    if (dom.showCardAccessRoute && document.activeElement !== dom.showCardAccessRoute) {
      dom.showCardAccessRoute.checked = settings.showCardAccessRoute === true;
    }
    renderSelfHealing(state);
    if (dom.taskAddRow && dom.stickyAddTaskRow) {
      dom.taskAddRow.classList.toggle('is-sticky', settings.stickyAddTaskRow === true);
    }
    fillRunnerSelect(dom.globalRunner, state.runners, settings.globalRunner);
    fillRunnerSelect(
      dom.projectRunner,
      state.runners,
      app.runnerTouched ? readRunnerSelect(dom.projectRunner) : settings.globalRunner
    );
    refillModelSelectsForRunner(
      [dom.projectModel, dom.projectSeedModel, dom.projectAnalyzeModel, dom.projectImplementModel, dom.projectPlanModel],
      readRunnerSelect(dom.projectRunner) || settings.globalRunner || ''
    );
    renderCards(state.projects || []);

    for (const project of state.projects || []) addLogEntries(project.id, project.logs);

    if (app.drawerId) {
      const project = projectById(app.drawerId);
      if (!project) {
        closeDrawer();
      } else {
        updateDrawerHeader(project);
        updateDrawerSprints(project);
        const key = `${project.path}|${project.progress?.completed || 0}/${project.progress?.total || 0}`;
        if (!app.planDirty && key !== app.lastPlanKey) {
          app.lastPlanKey = key;
          loadPlan(project.id);
        }
      }
    }
    if (app.drawerId) applyAutoEmptySections(app.drawerId);
  }

  /* ---------- forms ---------- */

  async function saveSettings(event) {
    event.preventDefault();
    dom.settingsStatus.textContent = 'saving…';
    try {
      const response = await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          maxConcurrent: Number(dom.maxConcurrent.value),
          mode: dom.mode.value,
          globalRunner: readRunnerSelect(dom.globalRunner),
          model: readModelSelect(dom.model),
          seedModel: readModelSelect(dom.seedModel),
          analyzeModel: readModelSelect(dom.analyzeModel),
          implementModel: readModelSelect(dom.implementModel),
          planModel: readModelSelect(dom.planModel),
          ...readRotationButtons(GLOBAL_ROTATION_TARGETS),
          rateLimitPauseSeconds: Number(dom.rateLimitSeconds.value),
          cooloffSeconds: Number(dom.cooloffSeconds.value),
          blockThreshold: dom.blockThreshold.value.trim() === '' ? '' : Number(dom.blockThreshold.value),
          temporaryLiftScope: dom.temporaryLiftScope.value,
          permanentLift: dom.permanentLift.value,
          seedPromptTemplate: dom.seedPromptTemplate.value,
          analyzePromptTemplate: dom.analyzePromptTemplate.value,
          implementPromptTemplate: dom.implementPromptTemplate.value,
          planQuestionsPromptTemplate: dom.planQuestionsPromptTemplate.value,
          planWritePromptTemplate: dom.planWritePromptTemplate.value,
          promptCliToolsNote: dom.promptCliToolsNote.checked,
          stickyAddTaskRow: dom.stickyAddTaskRow.checked,
          paseoTransport: dom.paseoTransport.checked,
          handoffRecovery: dom.handoffRecovery.checked,
          selfHealing: dom.selfHealing.checked,
          showCardAccessRoute: dom.showCardAccessRoute.checked
        })
      });
      if (response?.settings) applyState({ ...(app.state || {}), settings: response.settings });
      dom.settingsStatus.textContent = 'saved';
    } catch (error) {
      dom.settingsStatus.textContent = error.message;
    }
  }

  function renderEnvSettings(entries) {
    app.envSettings = entries || [];
    app.envDirty.clear();
    app.envInputs.clear();
    dom.envSettingsFields.replaceChildren();
    dom.envSettingsStatus.textContent = '';

    for (const entry of app.envSettings) {
      const row = document.createElement('div');
      row.className = 'env-field';

      const head = document.createElement('div');
      head.className = 'env-field-head';
      const label = document.createElement('label');
      label.className = 'env-key';
      label.htmlFor = `env-${entry.key}`;
      label.textContent = entry.label || entry.key;
      const description = document.createElement('span');
      description.className = 'env-description';
      description.textContent = entry.description || '';
      head.append(label, description);

      const inputRow = document.createElement('div');
      inputRow.className = 'env-input-row';
      const input = document.createElement('input');
      input.className = 'env-input';
      input.id = `env-${entry.key}`;
      input.type = entry.configured ? 'password' : 'text';
      input.value = entry.value || '';
      input.placeholder = entry.configured ? 'Enter a replacement value' : 'Value';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.dataset.key = entry.key;
      const reveal = document.createElement('button');
      reveal.className = 'icon-button env-reveal';
      reveal.type = 'button';
      reveal.dataset.key = entry.key;
      reveal.textContent = '👁';
      reveal.title = `Show ${entry.key}`;
      reveal.setAttribute('aria-label', `Show ${entry.key}`);
      inputRow.append(input, reveal);

      row.append(head, inputRow);
      dom.envSettingsFields.append(row);
      app.envInputs.set(entry.key, { input, reveal, entry, dirty: false, revealed: false });
    }
  }

  async function loadEnvSettings() {
    dom.envSettingsStatus.textContent = 'loading…';
    try {
      const response = await api('/api/env-settings', { cache: 'no-store' });
      renderEnvSettings(response.entries);
    } catch (error) {
      dom.envSettingsStatus.textContent = error.message;
    }
  }

  function markEnvDirty(key) {
    const record = app.envInputs.get(key);
    if (!record) return;
    const changed = record.input.value !== (record.entry.value || '');
    if (changed) {
      record.dirty = true;
      app.envDirty.add(key);
      if (record.input.type === 'text') {
        record.input.type = 'password';
        record.revealed = false;
      }
    } else {
      record.dirty = false;
      record.revealed = false;
      app.envDirty.delete(key);
    }
    dom.envSettingsStatus.textContent = app.envDirty.size ? 'unsaved changes' : '';
  }

  async function toggleEnvReveal(button) {
    const key = button.dataset.key;
    const record = app.envInputs.get(key);
    if (!record) return;
    if (!record.entry.configured) {
      dom.envSettingsStatus.textContent = 'No saved value to reveal.';
      return;
    }
    if (record.revealed) {
      record.input.value = record.entry.value;
      record.input.type = 'password';
      record.revealed = false;
      button.textContent = '👁';
      button.title = `Show ${key}`;
      button.setAttribute('aria-label', `Show ${key}`);
      return;
    }
    if (record.dirty) {
      record.input.type = 'text';
      record.revealed = true;
      button.textContent = '🙈';
      button.title = `Hide ${key}`;
      button.setAttribute('aria-label', `Hide ${key}`);
      return;
    }
    try {
      const response = await api('/api/env-settings/reveal', {
        method: 'POST',
        body: JSON.stringify({ key }),
        cache: 'no-store'
      });
      record.input.value = response.value;
      record.input.type = 'text';
      record.revealed = true;
      button.textContent = '🙈';
      button.title = `Hide ${key}`;
      button.setAttribute('aria-label', `Hide ${key}`);
    } catch (error) {
      dom.envSettingsStatus.textContent = error.message;
    }
  }

  async function saveEnvSettings(event) {
    event.preventDefault();
    if (!app.envDirty.size) {
      dom.envSettingsStatus.textContent = 'no changes';
      return;
    }
    const updates = {};
    for (const key of app.envDirty) {
      updates[key] = app.envInputs.get(key).input.value;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    dom.envSettingsStatus.textContent = 'saving…';
    if (submit) submit.disabled = true;
    try {
      const response = await api('/api/env-settings', {
        method: 'PATCH',
        body: JSON.stringify({ updates })
      });
      renderEnvSettings(response.entries);
      const count = (response.updated || []).length;
      dom.envSettingsStatus.textContent = count ? `saved ${count} ${count === 1 ? 'key' : 'keys'}` : 'no changes';
    } catch (error) {
      dom.envSettingsStatus.textContent = error.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function addProject(event) {
    event.preventDefault();
    const path = dom.projectPath.value.trim();
    if (!path) {
      dom.addStatus.textContent = 'Enter an absolute server path.';
      return;
    }
    dom.addStatus.textContent = 'adding…';
    try {
      await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          path,
          name: dom.projectName.value.trim(),
          runner: readRunnerSelect(dom.projectRunner),
          model: readModelSelect(dom.projectModel),
          seedModel: readModelSelect(dom.projectSeedModel),
          analyzeModel: readModelSelect(dom.projectAnalyzeModel),
          implementModel: readModelSelect(dom.projectImplementModel),
          planModel: readModelSelect(dom.projectPlanModel),
          ...readRotationButtons(PROJECT_SETUP_ROTATION_TARGETS),
          blockThreshold: dom.projectBlockThreshold.value.trim() === ''
            ? ''
            : Number(dom.projectBlockThreshold.value),
          cooloffSeconds: dom.projectCooloffSeconds.value.trim() === ''
            ? ''
            : Number(dom.projectCooloffSeconds.value),
          temporaryLiftScope: dom.projectTemporaryLiftScope.value,
          permanentLift: dom.projectPermanentLift.value
        })
      });
      dom.projectPath.value = '';
      dom.projectName.value = '';
      [dom.projectModel, dom.projectSeedModel, dom.projectAnalyzeModel, dom.projectImplementModel, dom.projectPlanModel].forEach((select) => {
        Array.from(select.options).forEach((option) => { option.selected = option.value === ''; });
      });
      applyRotationButtons(PROJECT_SETUP_ROTATION_TARGETS, app.state?.settings || {});
      dom.projectBlockThreshold.value = '';
      dom.projectCooloffSeconds.value = '';
      dom.projectTemporaryLiftScope.value = '';
      dom.projectPermanentLift.value = '';
      app.nameTouched = false;
      app.runnerTouched = false;
      dom.addStatus.textContent = 'added';
    } catch (error) {
      dom.addStatus.textContent = error.message;
    }
  }

  function populateFolderSelect(select, folders) {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = folders.length ? 'Select a folder…' : 'No folders under the projects root';
    select.appendChild(none);
    folders.forEach((folder) => {
      const option = document.createElement('option');
      option.value = folder.path;
      option.textContent = folder.name;
      select.appendChild(option);
    });
  }

  function setFolderStatus(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', Boolean(isError));
  }

  function setBusy(buttons, busy) {
    buttons.filter(Boolean).forEach((button) => { button.disabled = busy; });
  }

  function validateLocalFolderName(value) {
    const name = String(value ?? '').trim();
    if (!name) return { ok: false, error: 'Enter a folder name.' };
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
      return { ok: false, error: 'Invalid folder name. Use one name without slashes or control characters.' };
    }
    return { ok: true, value: name };
  }

  async function loadFolderList() {
    try {
      const data = await api('/api/folders', { cache: 'no-store' });
      populateFolderSelect(dom.projectFolders, data.folders || []);
      return true;
    } catch (error) {
      populateFolderSelect(dom.projectFolders, []);
      dom.addStatus.textContent = `Folders unavailable: ${error.message}`;
      return false;
    }
  }

  function selectExistingFolderOption(path) {
    const options = Array.from(dom.projectFolders.options);
    if (options.some((option) => option.value === path)) dom.projectFolders.value = path;
  }

  function renderFolderBrowserRows() {
    const list = dom.folderBrowserList;
    list.innerHTML = '';
    if (!app.browser.folders.length) {
      const empty = document.createElement('div');
      empty.className = 'folder-empty muted small-text';
      empty.textContent = 'No subfolders here.';
      list.appendChild(empty);
      return;
    }
    app.browser.folders.forEach((folder) => {
      const row = document.createElement('div');
      row.className = 'folder-browser-row';
      row.setAttribute('role', 'listitem');

      const name = document.createElement('span');
      name.className = 'folder-name mono';
      name.textContent = folder.name;
      name.title = folder.path;

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'button small';
      open.textContent = 'Open';
      open.dataset.openRelative = folder.relative;
      open.setAttribute('aria-label', `Open ${folder.name}`);

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'button small';
      select.textContent = 'Select';
      select.dataset.selectPath = folder.path;
      select.dataset.selectRelative = folder.relative;
      select.setAttribute('aria-label', `Select ${folder.name}`);

      row.append(name, open, select);
      list.appendChild(row);
    });
  }

  function selectBrowserFolder(folder) {
    app.browser.selected = { path: folder.path, relative: folder.relative };
    dom.folderSelected.textContent = folder.path;
    dom.folderSelect.disabled = false;
  }

  async function loadFolderBrowser(relative) {
    setBusy([dom.folderUp, dom.folderRoot, dom.folderSelect, dom.confirmBrowserFolder], true);
    setFolderStatus(dom.folderBrowserStatus, 'loading…');
    try {
      const data = await api(`/api/folders?dir=${encodeURIComponent(relative || '')}`, { cache: 'no-store' });
      app.browser.relative = data.relative || '';
      app.browser.parent = data.parent;
      app.browser.current = data.current || '';
      app.browser.root = data.root || '';
      app.browser.folders = data.folders || [];
      app.browser.selected = null;
      dom.folderCurrent.textContent = data.current || data.root || '—';
      dom.folderSelected.textContent = 'None';
      dom.folderSelect.disabled = true;
      dom.folderUp.disabled = data.parent === null;
      renderFolderBrowserRows();
      setFolderStatus(dom.folderBrowserStatus, '');
    } catch (error) {
      app.browser.parent = null;
      app.browser.selected = null;
      app.browser.folders = [];
      dom.folderCurrent.textContent = '—';
      dom.folderSelected.textContent = 'None';
      renderFolderBrowserRows();
      setFolderStatus(dom.folderBrowserStatus, error.message, true);
    } finally {
      dom.folderUp.disabled = app.browser.parent === null;
      dom.folderRoot.disabled = false;
      dom.folderSelect.disabled = !app.browser.selected;
      dom.confirmBrowserFolder.disabled = false;
    }
  }

  function closeFolderBrowser() {
    if (typeof dom.folderBrowser.close === 'function') dom.folderBrowser.close();
    else dom.folderBrowser.removeAttribute('open');
  }

  function openFolderBrowser() {
    if (!dom.folderBrowser.open) {
      if (typeof dom.folderBrowser.showModal === 'function') dom.folderBrowser.showModal();
      else dom.folderBrowser.setAttribute('open', '');
    }
    (dom.folderBrowserList || dom.folderBrowserClose).focus();
    loadFolderBrowser('');
  }

  function showRootFolderCreate() {
    dom.rootFolderCreate.hidden = false;
    dom.newRootFolderName.value = '';
    setFolderStatus(dom.rootFolderStatus, '');
    dom.newRootFolderName.focus();
  }

  function hideRootFolderCreate() {
    dom.rootFolderCreate.hidden = true;
    dom.newRootFolderName.value = '';
    setFolderStatus(dom.rootFolderStatus, '');
  }

  async function submitRootFolder() {
    const validation = validateLocalFolderName(dom.newRootFolderName.value);
    if (!validation.ok) {
      setFolderStatus(dom.rootFolderStatus, validation.error, true);
      return;
    }
    setBusy([dom.createFolder, dom.confirmRootFolder], true);
    setFolderStatus(dom.rootFolderStatus, 'creating…');
    try {
      const data = await api('/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name: validation.value })
      });
      const refreshed = await loadFolderList();
      dom.projectPath.value = data.folder.path;
      selectExistingFolderOption(data.folder.path);
      hideRootFolderCreate();
      dom.addStatus.textContent = refreshed
        ? `Created folder: ${data.folder.name}`
        : `Created folder: ${data.folder.name}; folder list refresh failed`;
    } catch (error) {
      setFolderStatus(dom.rootFolderStatus, error.message, true);
    } finally {
      setBusy([dom.createFolder, dom.confirmRootFolder], false);
    }
  }

  async function submitBrowserFolder(event) {
    event.preventDefault();
    const validation = validateLocalFolderName(dom.newBrowserFolderName.value);
    if (!validation.ok) {
      setFolderStatus(dom.folderBrowserStatus, validation.error, true);
      return;
    }
    setBusy([dom.folderUp, dom.folderRoot, dom.folderSelect, dom.confirmBrowserFolder], true);
    setFolderStatus(dom.folderBrowserStatus, 'creating…');
    try {
      const data = await api('/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name: validation.value, dir: app.browser.relative })
      });
      dom.newBrowserFolderName.value = '';
      await loadFolderBrowser(app.browser.relative);
      selectBrowserFolder(data.folder);
      setFolderStatus(dom.folderBrowserStatus, `Created folder: ${data.folder.name}`);
      await loadFolderList();
    } catch (error) {
      setFolderStatus(dom.folderBrowserStatus, error.message, true);
    } finally {
      dom.folderUp.disabled = app.browser.parent === null;
      dom.folderRoot.disabled = false;
      dom.folderSelect.disabled = !app.browser.selected;
      dom.confirmBrowserFolder.disabled = false;
    }
  }

  async function useSelectedFolder() {
    if (!app.browser.selected) {
      setFolderStatus(dom.folderBrowserStatus, 'Select a folder first.', true);
      return;
    }
    const selected = app.browser.selected;
    dom.projectPath.value = selected.path;
    dom.addStatus.textContent = 'Folder selected.';
    closeFolderBrowser();
    await loadFolderList();
    selectExistingFolderOption(selected.path);
  }

  /* ---------- boot ---------- */

  dom.settingsForm.addEventListener('submit', saveSettings);
  dom.selfHealBranch?.addEventListener('click', mergeSelfHealBranch);
  dom.envSettingsForm.addEventListener('submit', saveEnvSettings);
  dom.envSettingsFields.addEventListener('input', (event) => {
    const input = event.target.closest('.env-input');
    if (input) markEnvDirty(input.dataset.key);
  });
  dom.envSettingsFields.addEventListener('focusin', (event) => {
    const input = event.target.closest('.env-input');
    if (input && input.type === 'password' && input.value === '********') input.select();
  });
  dom.envSettingsFields.addEventListener('click', (event) => {
    const button = event.target.closest('.env-reveal');
    if (button) toggleEnvReveal(button);
  });
  dom.addForm.addEventListener('submit', addProject);
  dom.projectFolders.addEventListener('change', () => {
    if (dom.projectFolders.value) dom.projectPath.value = dom.projectFolders.value;
  });
  dom.browseFolders.addEventListener('click', openFolderBrowser);
  dom.folderBrowserClose.addEventListener('click', closeFolderBrowser);
  dom.planFileSave?.addEventListener('click', () => { void savePlanFile(); });
  dom.planFileCancel?.addEventListener('click', closePlanFileModal);
  dom.planFileClose?.addEventListener('click', closePlanFileModal);
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('.plan-file-ref');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    void openPlanFileModal(button.dataset.projectId, button.dataset.planFile);
  }, true);
  dom.folderUp.addEventListener('click', () => loadFolderBrowser(app.browser.parent ?? ''));
  dom.folderRoot.addEventListener('click', () => loadFolderBrowser(''));
  dom.folderBrowserList.addEventListener('click', async (event) => {
    const openButton = event.target.closest('button[data-open-relative]');
    if (openButton) {
      await loadFolderBrowser(openButton.dataset.openRelative);
      return;
    }
    const selectButton = event.target.closest('button[data-select-path]');
    if (selectButton) {
      selectBrowserFolder({ path: selectButton.dataset.selectPath, relative: selectButton.dataset.selectRelative });
    }
  });
  dom.folderSelect.addEventListener('click', useSelectedFolder);
  dom.createFolder.addEventListener('click', showRootFolderCreate);
  dom.cancelRootFolder.addEventListener('click', hideRootFolderCreate);
  dom.confirmRootFolder.addEventListener('click', submitRootFolder);
  dom.newRootFolderName.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitRootFolder();
  });
  dom.browserFolderCreate.addEventListener('submit', submitBrowserFolder);
  loadFolderList();
  dom.navToggle.addEventListener('click', () => {
    setSidebarOpen(!document.body.classList.contains('sidebar-open'));
  });
  dom.sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));
  dom.sidebarNav.addEventListener('click', (event) => {
    const link = event.target.closest('.side-link[data-view]');
    if (!link) return;
    showView(link.dataset.view);
    setSidebarOpen(false);
  });
  dom.projectName.addEventListener('input', () => { app.nameTouched = Boolean(dom.projectName.value); });
  dom.projectRunner.addEventListener('change', () => {
    app.runnerTouched = true;
    refillModelSelectsForRunner(
      [dom.projectModel, dom.projectSeedModel, dom.projectAnalyzeModel, dom.projectImplementModel, dom.projectPlanModel],
      readRunnerSelect(dom.projectRunner)
    );
  });
  dom.globalRunner.addEventListener('change', () => {
    refillModelSelectsForRunner(
      [dom.model, dom.seedModel, dom.analyzeModel, dom.implementModel, dom.planModel],
      readRunnerSelect(dom.globalRunner)
    );
  });
  dom.drawerClose.addEventListener('click', closeDrawer);
  dom.drawerBackdrop.addEventListener('click', closeDrawer);
  dom.drawerTerminalButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = app.drawerId;
    if (!id) return;
    openTerminal(id);
  });
  dom.terminalClose?.addEventListener('click', closeTerminal);
  dom.terminalOverlay?.addEventListener('click', (event) => {
    if (event.target === dom.terminalOverlay) closeTerminal();
  });
  dom.saveProjectModel.addEventListener('click', saveProjectModel);
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.model-rotate-button') : null;
    if (!button) return;
    const pressed = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', pressed ? 'false' : 'true');
  });
  dom.saveAutoResume.addEventListener('click', saveAutoResume);
  dom.saveBlockPolicy.addEventListener('click', saveBlockPolicy);
  dom.saveSprintSettings?.addEventListener('click', saveSprintSettings);
  dom.sprintMerge?.addEventListener('click', mergeSprintBranches);
  dom.addSprint?.addEventListener('click', addSprintRow);
  dom.drawerNewSprint?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addSprintRow();
  });
  dom.drawerSprintList?.addEventListener('click', (event) => {
    const remove = event.target.closest('button[data-action="remove-sprint"]');
    if (!remove) return;
    const row = remove.closest('.sprint-row');
    if (row) row.remove();
    dom.sprintStatus.textContent = 'unsaved';
  });
  dom.drawerSprintList?.addEventListener('input', () => {
    dom.sprintStatus.textContent = 'unsaved';
  });
  dom.autoResumeToggle.addEventListener('change', () => {
    app.autoResumeDirty = true;
    dom.autoResumeStatus.textContent = 'unsaved';
  });
  dom.drawerControls.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !app.drawerId) return;
    const project = projectById(app.drawerId);
    if (!project) return;
    const action = button.dataset.action;
    if (!['start', 'pause', 'stop'].includes(action)) return;
    dom.drawerControlStatus.hidden = true;
    dom.drawerControlStatus.textContent = '';
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}/${action}`, { method: 'POST' });
    } catch (error) {
      dom.drawerControlStatus.textContent = error.message;
      dom.drawerControlStatus.hidden = false;
    }
  });
  function handleSectionToggle(event) {
    const button = event.target?.closest('[data-action="toggle-section"]');
    if (!button) return;
    const section = button.closest('[data-section]');
    const sectionKey = section?.dataset.section;
    if (!sectionKey || !UI_SECTION_KEYS.includes(sectionKey)) return;
    const bodyId = button.getAttribute('aria-controls');
    const body = bodyId ? document.getElementById(bodyId) : null;
    if (!body) return;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    setSectionOpen(app.drawerId, sectionKey, open);
  }
  document.addEventListener('click', handleSectionToggle);

  for (const details of document.querySelectorAll('[data-settings-section]')) {
    const settingsKey = details.dataset.settingsSection;
    if (!SETTINGS_UI_KEYS.includes(settingsKey)) continue;
    details.addEventListener('toggle', () => {
      setSettingsUiState(settingsKey, details.open);
    });
  }
  syncSettingsUiState();

  dom.logList.addEventListener('scroll', () => {
    app.logFollow = isNearBottom();
    toggleFollowButton();
  });
  dom.logFollow.addEventListener('click', () => {
    app.logFollow = true;
    scrollLogs(true);
  });
  dom.terminalLogList?.addEventListener('scroll', () => {
    app.terminalFollow = isTerminalNearBottom();
    toggleTerminalFollowButton();
  });
  dom.terminalFollow?.addEventListener('click', () => {
    app.terminalFollow = true;
    scrollTerminal(true);
  });
  dom.planGuideSummary.addEventListener('click', () => {
    app.planGuideTouched = true;
    setPlanGuideState(app.drawerId, dom.planGuide.open, true);
    requestAnimationFrame(() => {
      if (app.planGuideTouched) {
        setPlanGuideState(app.drawerId, dom.planGuide.open, true);
      }
    });
  });
  dom.planGuide.addEventListener('toggle', () => {
    if (app.planGuideTouched) {
      setPlanGuideState(app.drawerId, dom.planGuide.open, true);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (isPlanFileModalOpen()) {
      event.preventDefault();
      event.stopPropagation();
      closePlanFileModal();
      return;
    }
    if (app.terminalId) {
      event.preventDefault();
      event.stopPropagation();
      closeTerminal();
      return;
    }
    if (dom.folderBrowser.open && typeof dom.folderBrowser.close !== 'function') closeFolderBrowser();
    if (document.body.classList.contains('sidebar-open')) setSidebarOpen(false);
    if (app.drawerId) closeDrawer();
  });

  dom.checklist.addEventListener('change', async (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== 'checkbox' || checkbox.disabled) return;
    const id = app.drawerId;
    if (!id) return;
    checkbox.disabled = true;
    try {
      await api(`/api/projects/${encodeURIComponent(id)}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ index: Number(checkbox.dataset.index), checked: checkbox.checked })
      });
      await loadPlan(id);
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      dom.planStatus.textContent = error.message;
    } finally {
      checkbox.disabled = false;
    }
  });

  dom.checklist.addEventListener('input', (event) => {
    const input = event.target instanceof Element ? event.target.closest('.task-edit-input') : null;
    if (input) updatePlanControls();
  });

  if (dom.taskLinkDoc && dom.taskDocFile) {
    dom.taskLinkDoc.checked = loadTaskLinkDocState();
    dom.taskDocFile.hidden = !dom.taskLinkDoc.checked;
    dom.taskLinkDoc.addEventListener('change', () => {
      saveTaskLinkDocState(dom.taskLinkDoc.checked);
      dom.taskDocFile.hidden = !dom.taskLinkDoc.checked;
    });
  }

  dom.addTask.addEventListener('click', addChecklistTask);
  dom.taskInsertPosition?.addEventListener('change', () => {
    const position = dom.taskInsertPosition.value;
    if (dom.taskInsertAfter) dom.taskInsertAfter.hidden = position !== 'after';
    if (position === 'after') refreshTaskInsertAfterOptions();
  });
  dom.taskInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addChecklistTask();
  });
  dom.checklist.addEventListener('click', async (event) => {
    if (suppressPlanClick) return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button[data-action]');
    if (!button || button.disabled || !dom.checklist.contains(button)) return;
    const action = button.dataset.action;
    if (action === 'drag') return;
    if (action === 'toggle-completed') {
      toggleCompleted();
      return;
    }
      const taskIndex = Number(button.dataset.taskIndex);
      if (!Number.isInteger(taskIndex)) return;
      if (action === 'toggle-flag') {
        void toggleTaskFlag(taskIndex, button.dataset.flag);
        return;
      }
      if (action === 'edit-task') {
      startTaskEdit(taskIndex);
      return;
    }
    if (action === 'save-task') {
      void saveTaskEdit(taskIndex);
      return;
    }
    if (action === 'remove-task') {
      void deleteTask(taskIndex);
      return;
    }
    const visibleIndexes = visibleTaskIndexes(app.currentPlan?.tasks, app.showCompleted);
    let toTaskIndex;
    if (action === 'move-top') toTaskIndex = visibleIndexes[0];
    else if (action === 'move-bottom') toTaskIndex = visibleIndexes[visibleIndexes.length - 1];
    else if (action === 'move-up') toTaskIndex = visibleTaskNeighbor(visibleIndexes, taskIndex, -1);
    else if (action === 'move-down') toTaskIndex = visibleTaskNeighbor(visibleIndexes, taskIndex, 1);
    else return;
    if (toTaskIndex == null || toTaskIndex < 0 || toTaskIndex >= app.planTaskCount || toTaskIndex === taskIndex) return;
    await reorderChecklistTask(taskIndex, toTaskIndex);
  });
  dom.toggleCompletedTasks?.addEventListener('click', toggleCompleted);
  dom.checklist.addEventListener('pointerdown', (event) => {
    if (suppressPlanClick) return;
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest('.drag-handle[data-action="drag"]');
    if (!handle || !dom.checklist.contains(handle)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    startPlanDrag(handle, event);
  });
  dom.checklist.addEventListener('pointermove', (event) => { updatePlanDrag(event); });
  dom.checklist.addEventListener('pointerup', (event) => { finishPlanDrag(event, true); });
  dom.checklist.addEventListener('pointercancel', (event) => { finishPlanDrag(event, false); });
  dom.checklist.addEventListener('lostpointercapture', (event) => { finishPlanDrag(event, false); });
  dom.checklist.addEventListener('keydown', (event) => {
    const input = event.target instanceof Element ? event.target.closest('.task-edit-input') : null;
    if (input) {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        void saveTaskEdit(Number(input.dataset.taskIndex));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelTaskEdit();
      }
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest('.drag-handle[data-action="drag"]');
    if (!handle || handle.disabled || !dom.checklist.contains(handle)) return;
    const fromTaskIndex = Number(handle.dataset.taskIndex);
    const visibleIndexes = visibleTaskIndexes(app.currentPlan?.tasks, app.showCompleted);
    const toTaskIndex = visibleTaskNeighbor(visibleIndexes, fromTaskIndex, event.key === 'ArrowUp' ? -1 : 1);
    if (!Number.isInteger(fromTaskIndex) || toTaskIndex == null || toTaskIndex < 0 || toTaskIndex >= app.planTaskCount) return;
    event.preventDefault();
    void reorderChecklistTask(fromTaskIndex, toTaskIndex);
  });
  dom.refreshAnswer.addEventListener('click', () => loadAnswer());
  dom.saveAnswer.addEventListener('click', saveAnswer);
  dom.confirmPlan?.addEventListener('click', async () => {
    const id = app.drawerId;
    if (!id) return;
    dom.confirmPlan.disabled = true;
    dom.planConfirmStatus.textContent = 'confirming…';
    try {
      await api(`/api/projects/${encodeURIComponent(id)}/plan-confirm`, { method: 'POST' });
      await refreshState();
      dom.planConfirmStatus.textContent = 'plan confirmed';
    } catch (error) {
      dom.planConfirmStatus.textContent = error.message;
    } finally {
      dom.confirmPlan.disabled = false;
    }
  });
  dom.answerEditor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      saveAnswer();
    }
  });

  dom.insertPlan.addEventListener('click', () => {
    if (!app.drawerId || dom.planEditor.value.trim()) return;
    dom.planEditor.value = STARTER_PLAN;
    markPlanDirty();
    dom.planEditor.focus();
    const marker = '- [ ] ';
    const cursor = dom.planEditor.value.indexOf(marker);
    if (cursor >= 0) dom.planEditor.setSelectionRange(cursor + marker.length, cursor + marker.length);
  });

  dom.planEditor.addEventListener('input', markPlanDirty);

  dom.savePlan.addEventListener('click', async () => {
    await savePlanContent(dom.planEditor.value, 'saved');
  });

  function connect() {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnection('online', 'connected');
    source.onerror = () => setConnection('offline', 'reconnecting');
    source.addEventListener('state', (event) => {
      try { applyState(JSON.parse(event.data)); } catch (error) { console.error('[looparr] bad state event', error); }
    });
    source.addEventListener('log', (event) => {
      try {
        const entry = JSON.parse(event.data);
        addLogEntries(entry.projectId, [entry]);
      } catch (error) { console.error('[looparr] bad log event', error); }
    });
  }

  [dom.drawerTaskToggle, dom.drawerNextToggle].forEach(bindTaskToggle);
  window.addEventListener('resize', syncAllTaskExpansion);
  showView('projects');
  loadEnvSettings();
  fetch('/api/state').then((res) => res.json()).then(applyState).catch((error) => {
    console.error('[looparr] could not load state', error);
  });
  connect();
  setInterval(updateAllCountdowns, 1000);
})();
