'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  const dom = {
    connection: $('connection'),
    connectionText: $('connection-text'),
    settingsForm: $('settings-form'),
    maxConcurrent: $('max-concurrent'),
    mode: $('mode'),
    globalRunner: $('global-runner'),
    rateLimitSeconds: $('rate-limit-seconds'),
    settingsStatus: $('settings-status'),
    addForm: $('add-form'),
    projectPath: $('project-path'),
    browseButton: $('browse-button'),
    folderPicker: $('folder-picker'),
    projectName: $('project-name'),
    projectRunner: $('project-runner'),
    addStatus: $('add-status'),
    projectGrid: $('project-grid'),
    emptyState: $('empty-state'),
    projectCount: $('project-count'),
    drawerBackdrop: $('drawer-backdrop'),
    drawer: $('drawer'),
    drawerClose: $('drawer-close'),
    drawerTitle: $('drawer-title'),
    drawerPath: $('drawer-path'),
    drawerStatus: $('drawer-status'),
    drawerTask: $('drawer-task'),
    planStatus: $('plan-status'),
    checklist: $('checklist'),
    planEditor: $('plan-editor'),
    savePlan: $('save-plan'),
    logList: $('log-list')
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
    error: ['Error', 'error']
  };

  const app = {
    state: null,
    logs: new Map(),
    drawerId: null,
    planDirty: false,
    lastPlanKey: '',
    nameTouched: false,
    runnerTouched: false
  };

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

  function setIfIdle(element, value) {
    if (document.activeElement === element) return;
    const next = String(value ?? '');
    if (element.value !== next) element.value = next;
  }

  function statusInfo(project) {
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

  /* ---------- cards ---------- */

  function createCard(project) {
    const card = document.createElement('article');
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
      <p class="card-task"></p>
      <div class="card-up"></div>
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

  function setCardVisual(card, project) {
    const holder = card.querySelector('.project-visual');
    const iconKey = project.icon || '';
    if (card.dataset.iconKey === iconKey && holder.firstChild) return;
    card.dataset.iconKey = iconKey;
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

  function taskFallback(project) {
    if (project.error) return project.error;
    if (project.status === 'paused') return 'Paused. Press Start to continue.';
    if (project.status === 'rateLimited') return 'Waiting for rate limit window.';
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

    const taskElement = card.querySelector('.card-task');
    const taskText = project.currentTask || taskFallback(project);
    taskElement.textContent = taskText;
    taskElement.classList.toggle('empty', !project.currentTask);

    const upNext = project.nextTask
      ? `<strong>Up next:</strong> ${esc(project.nextTask)}`
      : '<strong>Up next:</strong> —';
    card.querySelector('.card-up').innerHTML = upNext;

    const total = Number(project.progress?.total) || 0;
    const completed = Number(project.progress?.completed) || 0;
    card.querySelector('.progress-count').textContent = `${completed} / ${total}`;
    card.querySelector('.progress-fill').style.width = total ? `${(completed / total) * 100}%` : '0%';

    const hasPending = Boolean(project.nextTask) || completed < total;
    const buttons = card.querySelectorAll('.card-controls button');
    buttons[0].disabled = (project.active && !project.paused) || (project.status === 'done' && !hasPending);
    buttons[1].disabled = !project.active || project.paused || project.pauseRequested;
    buttons[2].disabled = !project.active;
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

  function scrollLogs() {
    dom.logList.scrollTop = dom.logList.scrollHeight;
  }

  function appendLogLine(entry) {
    if (entry.projectId !== app.drawerId) return;
    if (dom.logList.querySelector(`[data-seq="${entry.seq}"]`)) return;
    dom.logList.appendChild(makeLogLine(entry));
    scrollLogs();
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
    if (!bucket) return;
    const fragment = document.createDocumentFragment();
    bucket.entries.forEach((entry) => fragment.appendChild(makeLogLine(entry)));
    dom.logList.appendChild(fragment);
    scrollLogs();
  }

  /* ---------- drawer ---------- */

  function updateDrawerHeader(project) {
    const info = statusInfo(project);
    dom.drawerTitle.textContent = project.name;
    dom.drawerPath.textContent = project.path;
    dom.drawerStatus.className = `badge ${info.cls}${project.active && !project.paused ? ' active' : ''}`;
    dom.drawerStatus.textContent = info.label;
    dom.drawerTask.textContent = project.currentTask || project.error || project.nextTask || '';
    updateAllCountdowns();
  }

  function openDrawer(id) {
    const project = projectById(id);
    if (!project) return;
    app.drawerId = id;
    app.planDirty = false;
    app.lastPlanKey = '';
    dom.drawer.hidden = false;
    dom.drawerBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    updateDrawerHeader(project);
    renderLogs(id);
    loadPlan(id);
    dom.drawerClose.focus();
  }

  function closeDrawer() {
    dom.drawer.hidden = true;
    dom.drawerBackdrop.hidden = true;
    document.body.style.overflow = '';
    app.drawerId = null;
    app.planDirty = false;
  }

  function renderChecklist(plan) {
    if (!plan.tasks?.length) {
      dom.checklist.innerHTML = '<div class="muted small-text">No checklist items found.</div>';
      return;
    }
    dom.checklist.innerHTML = plan.tasks.map((task) => `
      <label class="check-item${task.checked ? ' checked' : ''}">
        <input type="checkbox" data-index="${task.index}" ${task.checked ? 'checked' : ''}>
        <span class="check-index">${task.index + 1}</span>
        <span>${esc(task.text || '(empty task)')}</span>
      </label>`).join('');
  }

  async function loadPlan(id) {
    try {
      const plan = await api(`/api/projects/${encodeURIComponent(id)}/plan`);
      if (app.drawerId !== id || app.planDirty) return;
      renderChecklist(plan);
      dom.planEditor.value = plan.content || '';
      if (plan.ok) {
        dom.planStatus.textContent = `${plan.stats.completed}/${plan.stats.total} tasks`;
      } else {
        dom.planStatus.textContent = plan.error || 'Could not read plan.md';
      }
    } catch (error) {
      if (app.drawerId === id) dom.planStatus.textContent = error.message;
    }
  }

  /* ---------- state ---------- */

  function applyState(state) {
    if (!state) return;
    app.state = state;

    const settings = state.settings || {};
    setIfIdle(dom.maxConcurrent, settings.maxConcurrent);
    setIfIdle(dom.mode, settings.mode);
    setIfIdle(dom.rateLimitSeconds, settings.rateLimitPauseSeconds);
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
          rateLimitPauseSeconds: Number(dom.rateLimitSeconds.value)
        })
      });
      if (response?.settings) applyState({ ...(app.state || {}), settings: response.settings });
      dom.settingsStatus.textContent = 'saved';
    } catch (error) {
      dom.settingsStatus.textContent = error.message;
    }
  }

  function handleFolderPick() {
    const file = dom.folderPicker.files?.[0];
    if (!file) return;
    const relative = file.webkitRelativePath || '';
    const root = relative.split('/')[0] || file.name;
    if (app.nameTouched === false) {
      dom.projectName.value = root;
    }
    if (file.path) {
      const normalized = String(file.path).replace(/\\/g, '/');
      const directory = normalized.endsWith(relative)
        ? normalized.slice(0, -relative.length)
        : normalized.slice(0, normalized.lastIndexOf('/'));
      if (directory) dom.projectPath.value = directory;
      dom.addStatus.textContent = `Picked ${root}.`;
    } else {
      dom.addStatus.textContent = `Picked ${root}. Paste its absolute path to add.`;
    }
    dom.folderPicker.value = '';
  }

  async function addProject(event) {
    event.preventDefault();
    dom.addStatus.textContent = 'adding…';
    try {
      await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          path: dom.projectPath.value.trim(),
          name: dom.projectName.value.trim(),
          runner: dom.projectRunner.value
        })
      });
      dom.projectPath.value = '';
      dom.projectName.value = '';
      app.nameTouched = false;
      app.runnerTouched = false;
      dom.addStatus.textContent = 'added';
    } catch (error) {
      dom.addStatus.textContent = error.message;
    }
  }

  /* ---------- boot ---------- */

  dom.settingsForm.addEventListener('submit', saveSettings);
  dom.addForm.addEventListener('submit', addProject);
  dom.browseButton.addEventListener('click', () => dom.folderPicker.click());
  dom.folderPicker.addEventListener('change', handleFolderPick);
  dom.projectName.addEventListener('input', () => { app.nameTouched = Boolean(dom.projectName.value); });
  dom.projectRunner.addEventListener('change', () => { app.runnerTouched = true; });
  dom.drawerClose.addEventListener('click', closeDrawer);
  dom.drawerBackdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && app.drawerId) closeDrawer();
  });

  dom.checklist.addEventListener('change', async (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== 'checkbox') return;
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

  dom.planEditor.addEventListener('input', () => {
    app.planDirty = true;
    dom.planStatus.textContent = 'unsaved changes';
  });

  dom.savePlan.addEventListener('click', async () => {
    const id = app.drawerId;
    if (!id) return;
    dom.savePlan.disabled = true;
    try {
      await api(`/api/projects/${encodeURIComponent(id)}/plan`, {
        method: 'PUT',
        body: JSON.stringify({ content: dom.planEditor.value })
      });
      app.planDirty = false;
      app.lastPlanKey = '';
      await loadPlan(id);
      dom.planStatus.textContent = 'saved';
    } catch (error) {
      dom.planStatus.textContent = error.message;
    } finally {
      dom.savePlan.disabled = false;
    }
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

  fetch('/api/state').then((res) => res.json()).then(applyState).catch((error) => {
    console.error('[looparr] could not load state', error);
  });
  connect();
  setInterval(updateAllCountdowns, 1000);
})();
