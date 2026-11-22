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
    rateLimitSeconds: $('rate-limit-seconds'),
    blockThreshold: $('block-threshold'),
    temporaryLiftScope: $('temporary-lift-scope'),
    permanentLift: $('permanent-lift'),
    seedPromptTemplate: $('seed-prompt-template'),
    analyzePromptTemplate: $('analyze-prompt-template'),
    implementPromptTemplate: $('implement-prompt-template'),
    promptCliToolsNote: $('prompt-cli-tools-note'),
    stickyAddTaskRow: $('sticky-add-task-row'),
    settingsStatus: $('settings-status'),
    envSettingsForm: $('env-settings-form'),
    envSettingsFields: $('env-settings-fields'),
    envSettingsStatus: $('env-settings-status'),
    hostRunner: $('host-runner'),
    hostRunnerDetail: $('host-runner-detail'),
    hostProjects: $('host-projects'),
    hostSetup: $('host-setup'),
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
    projectModel: $('project-model'),
    projectSeedModel: $('project-seed-model'),
    projectAnalyzeModel: $('project-analyze-model'),
    projectImplementModel: $('project-implement-model'),
    projectBlockThreshold: $('project-block-threshold'),
    projectTemporaryLiftScope: $('project-temporary-lift-scope'),
    projectPermanentLift: $('project-permanent-lift'),
    addStatus: $('add-status'),
    projectGrid: $('project-grid'),
    emptyState: $('empty-state'),
    projectCount: $('project-count'),
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
    drawerModelInput: $('drawer-model-input'),
    drawerSeedModel: $('drawer-seed-model'),
    drawerAnalyzeModel: $('drawer-analyze-model'),
    drawerImplementModel: $('drawer-implement-model'),
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
    taskInput: $('task-input'),
    addTask: $('add-task'),
    taskStatus: $('task-status'),
    taskAddRow: document.querySelector('.task-add-row'),
    toggleCompletedTasks: $('toggle-completed-tasks'),
    planStatus: $('plan-status'),
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
    drawerTemporaryLiftScope: $('drawer-temporary-lift-scope'),
    drawerPermanentLift: $('drawer-permanent-lift'),
    saveBlockPolicy: $('save-block-policy')
  };

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const STATUS = {
    idle: ['Idle', 'idle'],
    seed: ['Seed', 'seed'],
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
  // Mirrors `opencode models` output (CLI registry). Keep in sync manually:
// the server/container has no opencode binary, so this list cannot be
// populated dynamically at runtime. See plan.md model-picker items.
const MODEL_OPTIONS = [
    'omniroute/auto',
    'omniroute/auto/coding',
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
    'opencode/nemotron-3.5-lightning-free'
  ];

  const app = {
    state: null,
    view: 'projects',
    logs: new Map(),
    drawerId: null,
    logFollow: true,
    planDirty: false,
    showCompleted: true,
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
    const taskCount = app.planTaskCount || 0;
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
      if (!disabled && (action === 'move-up' || action === 'move-top')) disabled = taskIndex === 0;
      if (!disabled && (action === 'move-down' || action === 'move-bottom')) disabled = taskIndex === taskCount - 1;
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
  }

  function statusInfo(project) {
    if (isPlanSetup(project)) return { label: STATUS.setup[0], cls: STATUS.setup[1] };
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
    return (runners || []).map((runner) =>
      `<option value="${esc(runner.id)}">${esc(runner.label)}</option>`
    ).join('');
  }

  function fillRunnerSelect(select, runners, selected) {
    const markup = runnerOptions(runners, selected);
    if (select.dataset.runnerMarkup !== markup) {
      select.innerHTML = markup;
      select.dataset.runnerMarkup = markup;
    }
    const exists = [...select.options].some((option) => option.value === selected);
    if (exists && document.activeElement !== select) select.value = selected;
  }

  function modelOptions(selected, placeholder) {
    const blank = placeholder || 'OpenCode default';
    return `<option value="">${esc(blank)}</option>` + MODEL_OPTIONS.map((id) =>
      `<option value="${esc(id)}">${esc(id)}</option>`
    ).join('');
  }

  function fillModelSelect(select, selected, placeholder) {
    const markup = modelOptions(selected, placeholder);
    if (select.dataset.modelMarkup !== markup) {
      select.innerHTML = markup;
      select.dataset.modelMarkup = markup;
    }
    const exists = [...select.options].some((option) => option.value === selected);
    if (exists && document.activeElement !== select) select.value = selected;
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

  function updateHostSummary(state) {
    const settings = state.settings || {};
    const runner = (state.runners || []).find((item) => item.id === settings.globalRunner);
    dom.hostRunner.textContent = runner?.label || settings.globalRunner || 'Unknown';
    const model = settings.model || settings.seedModel || '';
    dom.hostRunnerDetail.textContent = model
      ? `${runner?.description || 'Server-side executor'} · model ${model}`
      : runner?.description || 'Server-side executor';
    const projects = state.projects || [];
    const setupCount = projects.filter(isPlanSetup).length;
    dom.hostProjects.textContent = String(projects.length);
    dom.hostSetup.textContent = setupCount ? `${setupCount} need setup` : 'all configured';
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
      <div class="card-up task-detail-wrap" data-task-field="next" data-project-id="${esc(project.id)}" data-fallback="true"><strong>Up next:</strong> <span class="task-detail-text task-detail-clamped" id="${nextTextId}"></span><button class="task-expand-toggle" type="button" aria-controls="${nextTextId}" aria-expanded="false" aria-label="Expand up next" title="Expand up next" hidden>▼</button></div>
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
    return {
      start: !rateLimited && ((project.active && !project.paused) || (project.status === 'done' && !hasPending)),
      pause: !project.active || project.paused || project.pauseRequested,
      stop: !project.active
    };
  }

  function updateCard(card, project) {
    card._project = project;
    setCardVisual(card, project);
    card.setAttribute('aria-label', `Open ${project.name} details`);

    card.querySelector('.card-title strong').textContent = project.name;
    card.querySelector('.card-title span').textContent = project.path;

    const info = statusInfo(project);
    const badge = card.querySelector('.badge');
    badge.className = `badge ${info.cls}${project.active && !project.paused ? ' active' : ''}`;
    badge.textContent = info.label;

    const currentWrapper = card.querySelector('.card-task');
    const currentText = currentWrapper.querySelector('.task-detail-text');
    currentWrapper.dataset.projectId = String(project.id);
    currentWrapper.dataset.fallback = project.currentTask ? 'false' : 'true';
    currentText.textContent = project.currentTask || taskFallback(project);
    currentWrapper.classList.toggle('empty', !project.currentTask);

    const upWrapper = card.querySelector('.card-up');
    const upText = upWrapper.querySelector('.task-detail-text');
    upWrapper.dataset.projectId = String(project.id);
    upWrapper.dataset.fallback = project.nextTask ? 'false' : 'true';
    upText.textContent = project.nextTask || '—';
    syncTaskExpansion(project.id, 'current');
    syncTaskExpansion(project.id, 'next');

    const total = Number(project.progress?.total) || 0;
    const completed = Number(project.progress?.completed) || 0;
    card.querySelector('.progress-count').textContent = `${completed} / ${total}`;
    card.querySelector('.progress-fill').style.width = total ? `${(completed / total) * 100}%` : '0%';

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
    dom.projectCount.textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;
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
      await api(`/api/projects/${encodeURIComponent(project.id)}/${action}`, { method: 'POST' });
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

    const text = document.createElement('span');
    text.className = 'log-text';
    text.textContent = entry.text;

    line.append(meta, text);
    return line;
  }

  function isNearBottom() {
    const remaining = dom.logList.scrollHeight - dom.logList.scrollTop - dom.logList.clientHeight;
    return remaining <= 24;
  }

  function toggleFollowButton() {
    dom.logFollow.hidden = app.logFollow;
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
      return;
    }
    const fragment = document.createDocumentFragment();
    bucket.entries.forEach((entry) => fragment.appendChild(makeLogLine(entry)));
    dom.logList.appendChild(fragment);
    scrollLogs(true);
    updateLogStatus();
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
      ['Temporary lift', displayScope(policy.temporaryLiftScope), Boolean(overrides.temporaryLiftScope)],
      ['Permanent lift', displayScope(policy.permanentLift), Boolean(overrides.permanentLift)]
    ];
    dom.drawerBlockPolicy.innerHTML = rows.map(([label, value, overridden]) => `
      <div class="policy-line">
        <span>${esc(label)}</span>
        <span>${esc(value)}<span class="policy-override">${overridden ? 'project' : 'global'}</span></span>
      </div>`).join('');
    setIfIdle(dom.drawerBlockThreshold, overrides.blockThreshold ?? '');
    setIfIdle(dom.drawerTemporaryLiftScope, overrides.temporaryLiftScope || '');
    setIfIdle(dom.drawerPermanentLift, overrides.permanentLift || '');
    if (dom.blockPolicyStatus) dom.blockPolicyStatus.textContent = '';
  }

  function updateDrawerModel(project) {
    const override = project.model || '';
    const effective = project.effectiveModel || override || app.state?.settings?.model || '';
    const models = project.effectiveModels || {};
    const rows = [
      ['Seed model', models.seed || effective || 'OpenCode default'],
      ['Analyze model', models.analyze || effective || 'OpenCode default'],
      ['Implement model', models.implement || effective || 'OpenCode default'],
      ['Project default override', override || 'global']
    ];
    dom.drawerModel.innerHTML = rows.map(([label, value]) => `
      <div class="policy-line">
        <span>${esc(label)}</span>
        <span>${esc(value)}</span>
      </div>`).join('');
    setIfIdle(dom.drawerModelInput, override);
    setIfIdle(dom.drawerSeedModel, project.seedModel);
    setIfIdle(dom.drawerAnalyzeModel, project.analyzeModel);
    setIfIdle(dom.drawerImplementModel, project.implementModel);
    dom.projectModelStatus.textContent = '';
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
  }

  function updateDrawerHeader(project) {
    const info = statusInfo(project);
    setDrawerVisual(project);
    dom.drawerTitle.textContent = project.name;
    dom.drawerPath.textContent = project.path;
    dom.drawerStatus.className = `badge ${info.cls}${project.active && !project.paused ? ' active' : ''}`;
    dom.drawerStatus.textContent = info.label;
    dom.drawerTask.textContent = project.currentTask || taskFallback(project);
    dom.drawerTask.classList.toggle('empty', !project.currentTask);
    dom.drawerNext.textContent = project.nextTask || '—';
    const currentWrapper = dom.drawerTask.closest('.task-detail-wrap');
    currentWrapper.dataset.projectId = String(project.id);
    currentWrapper.dataset.fallback = project.currentTask ? 'false' : 'true';
    const nextWrapper = dom.drawerNext.closest('.task-detail-wrap');
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
  }

  function openDrawer(id) {
    const project = projectById(id);
    if (!project) return;
    setSidebarOpen(false);
    app.drawerId = id;
    app.planDirty = false;
    editingTaskIndex = -1;
    app.showCompleted = true;
    app.currentPlan = null;
    app.planTaskCount = 0;
    clearDragIndicators();
    updateToggleCompletedButton();
    app.autoResumeDirty = false;
    dom.autoResumeStatus.textContent = '';
    app.lastPlanKey = '';
    app.planGuideTouched = false;
    app.logFollow = true;
    dom.planEditor.value = '';
    dom.answerEditor.value = '';
    dom.answerStatus.textContent = 'No handoff loaded';
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
    app.showCompleted = true;
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
    const lastIndex = app.planTaskCount - 1;
    dom.checklist.innerHTML = visible.map(({ task, taskIndex }) => {
      const editing = editingTaskIndex === taskIndex;
      const taskText = editing
        ? `<input class="task-edit-input" data-action="edit-input" data-task-index="${taskIndex}" value="${esc(task.text || '')}">`
        : `<span class="task-text">${esc(task.text || '(empty task)')}</span>`;
      return `
      <div class="check-item${task.checked ? ' checked' : ''}" data-task-index="${taskIndex}">
        <button class="move-button drag-handle" type="button" data-action="drag" data-task-index="${taskIndex}" title="Drag to reorder task" aria-label="Drag to reorder task">☰</button>
        <div class="check-label">
          <input type="checkbox" data-index="${task.index}" ${task.checked ? 'checked' : ''}>
          <span class="check-index">${task.index + 1}</span>
          ${taskText}
        </div>
        <div class="task-move">
          <button class="move-button" type="button" data-action="move-top" data-task-index="${taskIndex}" ${taskIndex === 0 ? 'disabled' : ''} aria-label="Move task to top">⇈</button>
          <button class="move-button" type="button" data-action="move-up" data-task-index="${taskIndex}" ${taskIndex === 0 ? 'disabled' : ''} aria-label="Move task up">↑</button>
          <button class="move-button" type="button" data-action="move-down" data-task-index="${taskIndex}" ${taskIndex === lastIndex ? 'disabled' : ''} aria-label="Move task down">↓</button>
          <button class="move-button" type="button" data-action="move-bottom" data-task-index="${taskIndex}" ${taskIndex === lastIndex ? 'disabled' : ''} aria-label="Move task to bottom">⇊</button>
        </div>
        <div class="task-actions">
          ${editing
            ? `<button class="icon-button save-task-button" type="button" data-action="save-task" data-task-index="${taskIndex}" aria-label="Save task" title="Save task">💾</button>`
            : `<button class="icon-button edit-task-button" type="button" data-action="edit-task" data-task-index="${taskIndex}" aria-label="Edit task" title="Edit task">✎</button>`}
          <button class="icon-button remove-task-button" type="button" data-action="remove-task" data-task-index="${taskIndex}" aria-label="Delete task" title="Delete task">✕</button>
        </div>
      </div>`;
    }).join('');
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
    app.showCompleted = !app.showCompleted;
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
      if (plan.ok) {
        dom.planStatus.textContent = `${plan.stats.completed}/${plan.stats.total} tasks`;
      } else {
        const project = projectById(id);
        dom.planStatus.textContent = project && isPlanSetup(project)
          ? 'Create plan.md here, then save.'
          : plan.error || 'Could not read plan.md';
      }
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
      const content = await ensurePlanContent();
      const next = appendTask(content, text);
      if (!next) {
        dom.taskStatus.textContent = 'Could not add task.';
        return;
      }
      dom.planEditor.value = next;
      markPlanDirty();
      dom.taskStatus.textContent = 'adding…';
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
    const previousEditor = dom.planEditor.value;
    const previousStatus = dom.planStatus.textContent;
    try {
      const content = await ensurePlanContent();
      const result = editPlanTaskContent(content, taskIndex, newText);
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
          model: dom.drawerModelInput.value,
          seedModel: dom.drawerSeedModel.value,
          analyzeModel: dom.drawerAnalyzeModel.value,
          implementModel: dom.drawerImplementModel.value
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
    } catch (error) {
      dom.answerStatus.textContent = error.message;
    } finally {
      dom.saveAnswer.disabled = false;
    }
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
    fillModelSelect(dom.model, settings.model, 'OpenCode default');
    fillModelSelect(dom.seedModel, settings.seedModel, 'Inherit default model');
    fillModelSelect(dom.analyzeModel, settings.analyzeModel, 'Inherit default model');
    fillModelSelect(dom.implementModel, settings.implementModel, 'Inherit default model');
    fillModelSelect(dom.projectModel, '', 'Inherit global');
    fillModelSelect(dom.projectSeedModel, '', 'Inherit default model');
    fillModelSelect(dom.projectAnalyzeModel, '', 'Inherit default model');
    fillModelSelect(dom.projectImplementModel, '', 'Inherit default model');
    setIfIdle(dom.rateLimitSeconds, settings.rateLimitPauseSeconds);
    setIfIdle(dom.blockThreshold, settings.blockThreshold);
    setIfIdle(dom.temporaryLiftScope, settings.temporaryLiftScope);
    setIfIdle(dom.permanentLift, settings.permanentLift);
    setIfIdle(dom.seedPromptTemplate, settings.seedPromptTemplate);
    setIfIdle(dom.analyzePromptTemplate, settings.analyzePromptTemplate);
    setIfIdle(dom.implementPromptTemplate, settings.implementPromptTemplate);
    if (document.activeElement !== dom.promptCliToolsNote) {
      dom.promptCliToolsNote.checked = settings.promptCliToolsNote === true;
    }
    if (dom.stickyAddTaskRow && document.activeElement !== dom.stickyAddTaskRow) {
      dom.stickyAddTaskRow.checked = settings.stickyAddTaskRow === true;
    }
    if (dom.taskAddRow && dom.stickyAddTaskRow) {
      dom.taskAddRow.classList.toggle('is-sticky', settings.stickyAddTaskRow === true);
    }
    fillRunnerSelect(dom.globalRunner, state.runners, settings.globalRunner);
    fillRunnerSelect(
      dom.projectRunner,
      state.runners,
      app.runnerTouched ? dom.projectRunner.value : settings.globalRunner
    );
    renderCards(state.projects || []);

    for (const project of state.projects || []) addLogEntries(project.id, project.logs);

    if (app.drawerId) {
      const project = projectById(app.drawerId);
      if (!project) {
        closeDrawer();
      } else {
        updateDrawerHeader(project);
        const key = `${project.path}|${project.progress?.completed || 0}/${project.progress?.total || 0}`;
        if (!app.planDirty && key !== app.lastPlanKey) {
          app.lastPlanKey = key;
          loadPlan(project.id);
        }
      }
    }
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
          globalRunner: dom.globalRunner.value,
      model: dom.model.value,
          seedModel: dom.seedModel.value,
          analyzeModel: dom.analyzeModel.value,
          implementModel: dom.implementModel.value,
          rateLimitPauseSeconds: Number(dom.rateLimitSeconds.value),
          blockThreshold: dom.blockThreshold.value.trim() === '' ? '' : Number(dom.blockThreshold.value),
          temporaryLiftScope: dom.temporaryLiftScope.value,
          permanentLift: dom.permanentLift.value,
          seedPromptTemplate: dom.seedPromptTemplate.value,
          analyzePromptTemplate: dom.analyzePromptTemplate.value,
          implementPromptTemplate: dom.implementPromptTemplate.value,
          promptCliToolsNote: dom.promptCliToolsNote.checked,
          stickyAddTaskRow: dom.stickyAddTaskRow.checked
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
          runner: dom.projectRunner.value,
      model: dom.projectModel.value.trim(),
          seedModel: dom.projectSeedModel.value.trim(),
          analyzeModel: dom.projectAnalyzeModel.value.trim(),
          implementModel: dom.projectImplementModel.value.trim(),
          blockThreshold: dom.projectBlockThreshold.value.trim() === ''
            ? ''
            : Number(dom.projectBlockThreshold.value),
          temporaryLiftScope: dom.projectTemporaryLiftScope.value,
          permanentLift: dom.projectPermanentLift.value
        })
      });
      dom.projectPath.value = '';
      dom.projectName.value = '';
    dom.projectModel.value = '';
      dom.projectSeedModel.value = '';
      dom.projectAnalyzeModel.value = '';
      dom.projectImplementModel.value = '';
      dom.projectBlockThreshold.value = '';
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
  dom.projectRunner.addEventListener('change', () => { app.runnerTouched = true; });
  dom.drawerClose.addEventListener('click', closeDrawer);
  dom.drawerBackdrop.addEventListener('click', closeDrawer);
  dom.saveProjectModel.addEventListener('click', saveProjectModel);
  dom.saveAutoResume.addEventListener('click', saveAutoResume);
  dom.saveBlockPolicy.addEventListener('click', saveBlockPolicy);
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
  dom.logList.addEventListener('scroll', () => {
    app.logFollow = isNearBottom();
    toggleFollowButton();
  });
  dom.logFollow.addEventListener('click', () => {
    app.logFollow = true;
    scrollLogs(true);
  });
  dom.planGuideSummary.addEventListener('click', () => { app.planGuideTouched = true; });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
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

  dom.addTask.addEventListener('click', addChecklistTask);
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
    const lastIndex = app.planTaskCount - 1;
    let toTaskIndex;
    if (action === 'move-top') toTaskIndex = 0;
    else if (action === 'move-bottom') toTaskIndex = lastIndex;
    else if (action === 'move-up') toTaskIndex = taskIndex - 1;
    else if (action === 'move-down') toTaskIndex = taskIndex + 1;
    else return;
    if (toTaskIndex < 0 || toTaskIndex >= app.planTaskCount || toTaskIndex === taskIndex) return;
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
    const toTaskIndex = fromTaskIndex + (event.key === 'ArrowUp' ? -1 : 1);
    if (!Number.isInteger(fromTaskIndex) || toTaskIndex < 0 || toTaskIndex >= app.planTaskCount) return;
    event.preventDefault();
    void reorderChecklistTask(fromTaskIndex, toTaskIndex);
  });
  dom.refreshAnswer.addEventListener('click', () => loadAnswer());
  dom.saveAnswer.addEventListener('click', saveAnswer);
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
