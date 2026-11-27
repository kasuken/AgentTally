const $ = (id) => document.getElementById(id);
const tauri = window.__TAURI__;
const state = { items: [], liveProjects: new Map(), projects: new Map(), editing: null, filter: '' };
const form = $('followup-form');

function showStatus(message, error = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(error);
}

function buildProjectOptions(select, includeAll = false) {
  const previous = select.value;
  const fragment = document.createDocumentFragment();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = includeAll ? 'All projects' : 'Choose a project';
  fragment.append(placeholder);
  const entries = [...state.projects].sort((a, b) =>
    a[1].name.localeCompare(b[1].name) || a[0].localeCompare(b[0]));
  for (const [key, project] of entries) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = entries.filter(([, item]) => item.name === project.name).length > 1
      ? `${project.name} · ${key}` : project.name;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function refreshProjects() {
  state.projects = new Map(state.liveProjects);
  for (const item of state.items) {
    if (!state.projects.has(item.projectKey)) {
      state.projects.set(item.projectKey, { name: item.projectName });
    }
  }
  buildProjectOptions($('project-filter'), true);
  buildProjectOptions($('project'));
  if (state.filter && !state.projects.has(state.filter)) state.filter = '';
  $('project-filter').value = state.filter;
  $('save-followup').disabled = !state.projects.size;
}

function makeButton(label, action, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.action = action;
  if (className) button.className = className;
  return button;
}

function render() {
  const visible = state.items.filter(item => !state.filter || item.projectKey === state.filter);
  const fragment = document.createDocumentFragment();
  for (const item of visible) {
    const card = document.createElement('article');
    card.className = `followup-card${item.done ? ' is-done' : ''}`;
    const head = document.createElement('div');
    head.className = 'followup-card-head';
    const title = document.createElement('h3');
    title.textContent = item.title;
    const badge = document.createElement('span');
    badge.className = 'followup-state';
    badge.textContent = item.done ? 'Done' : 'Open';
    head.append(title, badge);
    card.append(head);

    const project = document.createElement('p');
    project.className = 'followup-project';
    project.textContent = item.projectName;
    card.append(project);

    if (item.note) {
      const note = document.createElement('p');
      note.className = 'followup-update';
      note.textContent = item.note;
      card.append(note);
    }
    if (item.link) {
      const link = document.createElement('a');
      link.className = 'followup-link';
      link.href = item.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open linked item';
      card.append(link);
    }

    const actions = document.createElement('div');
    actions.className = 'followup-actions';
    const toggle = makeButton(item.done ? 'Reopen' : 'Mark done', 'toggle');
    toggle.dataset.id = item.id;
    const edit = makeButton('Edit', 'edit');
    edit.dataset.id = item.id;
    const remove = makeButton('Delete', 'delete', 'delete-action');
    remove.dataset.id = item.id;
    actions.append(toggle, edit, remove);
    card.append(actions);
    fragment.append(card);
  }
  $('followup-items').replaceChildren(fragment);
  $('empty-list').hidden = visible.length > 0;
  $('empty-list').textContent = state.filter
    ? 'No follow-ups for this project.'
    : 'No follow-ups yet. Add one above to capture the next step.';
  $('item-count').textContent = `${visible.length} item${visible.length === 1 ? '' : 's'}`;
}

async function loadItems() {
  state.items = await tauri.core.invoke('follow_ups_list');
  refreshProjects();
  render();
}

function acceptSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.sessions)) return;
  state.liveProjects = new Map(snapshot.sessions.map(session => {
    const key = session.cwd || session.project;
    return [key, { name: session.project || key }];
  }).filter(([key]) => !!key));
  refreshProjects();
}

function resetForm() {
  form.reset();
  state.editing = null;
  $('editor-title').textContent = 'Add a follow-up';
  $('save-followup').textContent = 'Add follow-up';
  $('cancel-edit').hidden = true;
}

function editItem(item) {
  state.editing = item.id;
  $('project').value = item.projectKey;
  $('title').value = item.title;
  $('note').value = item.note;
  $('link').value = item.link;
  $('editor-title').textContent = 'Edit follow-up';
  $('save-followup').textContent = 'Save changes';
  $('cancel-edit').hidden = false;
  $('title').focus();
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const projectKey = $('project').value;
  const project = state.projects.get(projectKey);
  if (!project) {
    showStatus('Choose a project before saving.', true);
    return;
  }
  const button = $('save-followup');
  button.disabled = true;
  try {
    await tauri.core.invoke('follow_ups_save', {
      id: state.editing,
      projectKey,
      projectName: project.name,
      title: $('title').value,
      note: $('note').value,
      link: $('link').value,
      done: state.items.find(item => item.id === state.editing)?.done ?? false,
    });
    resetForm();
    await loadItems();
    showStatus('Follow-up saved.');
  } catch (error) {
    showStatus(`Could not save follow-up: ${error}`, true);
  } finally {
    button.disabled = !state.projects.size;
  }
});

$('cancel-edit').addEventListener('click', resetForm);
$('project-filter').addEventListener('change', (event) => {
  state.filter = event.target.value;
  render();
});

$('followup-items').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = state.items.find(row => String(row.id) === button.dataset.id);
  if (!item) return;
  try {
    if (button.dataset.action === 'edit') {
      editItem(item);
      return;
    }
    if (button.dataset.action === 'delete') {
      if (!window.confirm(`Delete “${item.title}”?`)) return;
      await tauri.core.invoke('follow_ups_delete', { id: item.id });
      if (state.editing === item.id) resetForm();
      await loadItems();
      showStatus('Follow-up deleted.');
      return;
    }
    await tauri.core.invoke('follow_ups_save', {
      id: item.id,
      projectKey: item.projectKey,
      projectName: item.projectName,
      title: item.title,
      note: item.note,
      link: item.link,
      done: !item.done,
    });
    await loadItems();
    showStatus(item.done ? 'Follow-up reopened.' : 'Follow-up marked done.');
  } catch (error) {
    showStatus(`Could not update follow-up: ${error}`, true);
  }
});

if (!tauri?.core?.invoke) {
  form.hidden = true;
  $('source-badge').dataset.mode = 'error';
  showStatus('Follow-ups are available in the installed desktop app.', true);
} else {
  try {
    await loadItems();
    acceptSnapshot(await tauri.core.invoke('snapshot'));
    await tauri.event.listen('tally', ({ payload }) => acceptSnapshot(payload));
  } catch (error) {
    showStatus(`Could not load local follow-ups: ${error}`, true);
  }
}
