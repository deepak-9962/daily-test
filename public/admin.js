// ────────────────────────────────────────────────────────────────
// TestFlow Admin JS — Full v2 Implementation
// ────────────────────────────────────────────────────────────────

let adminPassword = '';
let editingTestId = null;
let csvParsedRows = [];
let existingTopics = [];
let manualQuestionCount = 0;
let editQuestionCount = 0;

const LETTERS = ['A', 'B', 'C', 'D'];

// ─── Auth ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', checkAutoAuth);

function checkAutoAuth() {
  const savedPwd = sessionStorage.getItem('admin_password');
  if (savedPwd) {
    adminPassword = savedPwd;
    document.getElementById('password-modal').style.display = 'none';
    document.getElementById('admin-app').classList.remove('hidden');
    document.getElementById('admin-app').classList.add('flex');
    init();
  }
}

document.getElementById('login-btn').addEventListener('click', tryLogin);
document.getElementById('admin-pwd').addEventListener('keypress', e => { if (e.key === 'Enter') tryLogin(); });

function tryLogin() {
  const pwd = document.getElementById('admin-pwd').value;
  if (!pwd) return;
  adminPassword = pwd;
  sessionStorage.setItem('admin_password', pwd);
  sessionStorage.setItem('admin_authenticated', 'true');
  document.getElementById('password-modal').style.display = 'none';
  document.getElementById('admin-app').classList.remove('hidden');
  document.getElementById('admin-app').classList.add('flex');
  init();
}

async function init() {
  await loadTopics();
  await loadTestsList();
  addManualQuestion(); // Start create section with one blank question
}

// ─── Topics ──────────────────────────────────────────────────────
async function loadTopics() {
  try {
    const res = await fetch('/api/topics');
    existingTopics = await res.json();
  } catch (e) { existingTopics = []; }
}

// ─── Navigation ──────────────────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('section[id^="section-"]').forEach(s => s.classList.add('hidden'));
  document.getElementById(`section-${name}`)?.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav-${name}`)?.classList.add('active');

  if (name === 'tests') loadTestsList();
  if (name === 'tracker') loadTracker();
}

// ─── All Tests List ───────────────────────────────────────────────
async function loadTestsList() {
  const container = document.getElementById('tests-list');
  container.innerHTML = `<div class="flex items-center gap-sm text-on-surface-variant"><span class="material-symbols-outlined animate-spin">sync</span><span class="text-body-md">Loading...</span></div>`;

  try {
    const res = await fetch('/api/tests', {
      headers: { 'x-admin-password': adminPassword }
    });

    // Note: /api/tests needs admin password - but let's use a workaround
    // Actually the GET /api/tests endpoint doesn't have requireAdmin, so no header needed
    const tests = await res.json();

    if (!tests.length) {
      container.innerHTML = `
        <div class="text-center py-xl text-on-surface-variant">
          <span class="material-symbols-outlined text-[48px] block mb-md">inbox</span>
          <p class="text-body-md">No tests yet. <button onclick="showSection('create')" class="text-primary underline">Create your first test</button></p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    tests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(t => {
      const card = document.createElement('div');
      card.className = 'bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex flex-col sm:flex-row sm:items-center justify-between gap-md hover:border-primary transition-colors';
      const statusInfo = getStatusInfo(t.status);
      const date = new Date(t.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });

      card.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-sm mb-xs flex-wrap">
            <h3 class="font-headline-md text-on-surface truncate">${escHtml(t.title)}</h3>
            <span class="status-badge ${statusInfo.cls}">${statusInfo.label}</span>
          </div>
          <div class="flex items-center gap-md text-on-surface-variant text-[13px]">
            <span class="flex items-center gap-xs"><span class="material-symbols-outlined text-[16px]">calendar_today</span>${date}</span>
            <span class="flex items-center gap-xs"><span class="material-symbols-outlined text-[16px]">list_alt</span>${t.questionCount} questions</span>
            <span class="flex items-center gap-xs"><span class="material-symbols-outlined text-[16px]">timer</span>${t.timerMinutes} min</span>
          </div>
        </div>
        <div class="flex gap-sm flex-wrap">
          ${t.status === 'draft' ? `<button onclick="loadEditSection('${t.id}')" class="flex items-center gap-xs px-md py-xs border border-outline-variant rounded-lg font-label-md text-[13px] hover:bg-surface-container transition-colors"><span class="material-symbols-outlined text-[16px]">edit</span>Edit</button>` : ''}
          ${(t.status === 'draft' || t.status === 'archived' || t.status === 'completed') ? `<button onclick="publishTest('${t.id}')" class="flex items-center gap-xs px-md py-xs bg-primary-container text-on-primary-container rounded-lg font-label-md text-[13px] hover:bg-primary hover:text-on-primary transition-colors"><span class="material-symbols-outlined text-[16px]">publish</span>Publish</button>` : ''}
          ${(t.status === 'published' || t.status === 'active') ? `<button onclick="archiveTest('${t.id}')" class="flex items-center gap-xs px-md py-xs border border-error text-error rounded-lg font-label-md text-[13px] hover:bg-error-container transition-colors"><span class="material-symbols-outlined text-[16px]">archive</span>Archive</button>` : ''}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (e) {
    container.innerHTML = `<p class="text-error text-body-md">Failed to load tests.</p>`;
  }
}

function getStatusInfo(status) {
  const map = {
    draft:     { label: 'Draft',     cls: 'bg-surface-container text-on-surface-variant' },
    published: { label: 'Published', cls: 'bg-primary-fixed text-primary' },
    active:    { label: 'Active',    cls: 'bg-tertiary-container text-on-tertiary' },
    completed: { label: 'Completed', cls: 'bg-secondary-container text-on-surface' },
    archived:  { label: 'Archived',  cls: 'bg-surface-container-high text-on-surface-variant' }
  };
  return map[status] || { label: status, cls: 'bg-surface-container text-on-surface' };
}

// ─── Publish / Archive ────────────────────────────────────────────
async function publishTest(id) {
  try {
    const res = await fetch(`/api/tests/${id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ password: adminPassword })
    });
    if (!res.ok) { alert('Failed to publish — check password.'); return; }
    showToast('Test published successfully!');
    loadTestsList();
  } catch (e) { alert('Error publishing test.'); }
}

async function archiveTest(id) {
  if (!confirm('Archive this test? Participants will no longer see it.')) return;
  try {
    const res = await fetch(`/api/tests/${id}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ password: adminPassword })
    });
    if (!res.ok) { alert('Failed to archive.'); return; }
    showToast('Test archived.');
    loadTestsList();
  } catch (e) { alert('Error archiving.'); }
}

// ─── Tab switching (Create) ───────────────────────────────────────
function switchTab(tab) {
  document.getElementById('panel-manual').classList.toggle('hidden', tab !== 'manual');
  document.getElementById('panel-csv').classList.toggle('hidden', tab !== 'csv');
  document.getElementById('tab-manual').classList.toggle('active', tab === 'manual');
  document.getElementById('tab-csv').classList.toggle('active', tab === 'csv');
}

// ─── Manual Question Builder ──────────────────────────────────────
function addManualQuestion(qData = null) {
  manualQuestionCount++;
  const idx = manualQuestionCount;
  const container = document.getElementById('manual-questions');
  const div = document.createElement('div');
  div.className = 'bg-surface border border-outline-variant rounded-xl p-lg relative';
  div.id = `manual-q-${idx}`;

  const q = qData || { text: '', options: ['','','',''], correctIndex: 0, topic: 'General' };

  div.innerHTML = `
    <div class="flex items-center justify-between mb-md">
      <span class="text-label-md font-label-md text-primary uppercase tracking-widest text-[11px]">Question ${idx}</span>
      <button onclick="removeQuestion('manual-q-${idx}')" class="text-on-surface-variant hover:text-error transition-colors">
        <span class="material-symbols-outlined text-[18px]">delete</span>
      </button>
    </div>
    <input type="text" class="admin-input mb-md q-text" placeholder="Question text..." value="${escHtml(q.text)}"/>
    <div class="space-y-sm mb-md">
      ${q.options.map((opt, i) => `
        <div class="flex items-center gap-sm">
          <input type="radio" name="correct-m${idx}" value="${i}" ${q.correctIndex === i ? 'checked' : ''} class="w-4 h-4 accent-primary cursor-pointer" title="Mark as correct"/>
          <span class="font-timer-mono text-[11px] bg-surface-variant text-on-surface-variant px-1.5 py-0.5 rounded">${LETTERS[i]}</span>
          <input type="text" class="admin-input flex-1 opt-input" data-opt="${i}" placeholder="Option ${LETTERS[i]}" value="${escHtml(opt)}"/>
        </div>`).join('')}
    </div>
    <div class="flex items-center gap-sm">
      <label class="text-label-md font-label-md text-on-surface-variant text-[12px]">Topic:</label>
      ${buildTopicCombobox(`topic-m${idx}`, q.topic)}
    </div>`;

  container.appendChild(div);
  initCombobox(`topic-m${idx}`);
  updateQuestionsCount();
}

function addEditQuestion(qData = null) {
  editQuestionCount++;
  const idx = editQuestionCount;
  const container = document.getElementById('edit-questions');
  const div = document.createElement('div');
  div.className = 'bg-surface border border-outline-variant rounded-xl p-lg relative';
  div.id = `edit-q-${idx}`;

  const q = qData || { id: `qnew${idx}`, text: '', options: ['','','',''], correctIndex: 0, topic: 'General' };

  div.innerHTML = `
    <input type="hidden" class="q-id" value="${q.id}"/>
    <div class="flex items-center justify-between mb-md">
      <span class="text-label-md font-label-md text-primary uppercase tracking-widest text-[11px]">Question ${idx}</span>
      <button onclick="removeQuestion('edit-q-${idx}')" class="text-on-surface-variant hover:text-error transition-colors">
        <span class="material-symbols-outlined text-[18px]">delete</span>
      </button>
    </div>
    <input type="text" class="admin-input mb-md q-text" placeholder="Question text..." value="${escHtml(q.text)}"/>
    <div class="space-y-sm mb-md">
      ${q.options.map((opt, i) => `
        <div class="flex items-center gap-sm">
          <input type="radio" name="correct-e${idx}" value="${i}" ${q.correctIndex === i ? 'checked' : ''} class="w-4 h-4 accent-primary cursor-pointer"/>
          <span class="font-timer-mono text-[11px] bg-surface-variant text-on-surface-variant px-1.5 py-0.5 rounded">${LETTERS[i]}</span>
          <input type="text" class="admin-input flex-1 opt-input" data-opt="${i}" placeholder="Option ${LETTERS[i]}" value="${escHtml(opt)}"/>
        </div>`).join('')}
    </div>
    <div class="flex items-center gap-sm">
      <label class="text-label-md font-label-md text-on-surface-variant text-[12px]">Topic:</label>
      ${buildTopicCombobox(`topic-e${idx}`, q.topic)}
    </div>`;

  container.appendChild(div);
  initCombobox(`topic-e${idx}`);
}

function removeQuestion(id) {
  document.getElementById(id)?.remove();
  updateQuestionsCount();
}

function updateQuestionsCount() {
  const qs = document.querySelectorAll('#manual-questions [id^="manual-q-"]');
  const lbl = document.getElementById('questions-count-label');
  const summary = document.getElementById('questions-summary');
  if (qs.length > 0) {
    lbl.textContent = `${qs.length} question${qs.length !== 1 ? 's' : ''} in this test`;
    summary.classList.remove('hidden');
  } else {
    summary.classList.add('hidden');
  }
}

// ─── Topic Combobox ───────────────────────────────────────────────
function buildTopicCombobox(id, value = 'General') {
  return `
    <div class="combobox-wrapper flex-1">
      <input type="text" id="${id}" class="admin-input topic-input" value="${escHtml(value)}" placeholder="Type or select topic"
        autocomplete="off" oninput="filterCombobox('${id}')" onfocus="openCombobox('${id}')" onblur="closeComboboxDelayed('${id}')"/>
      <div id="${id}-dropdown" class="combobox-dropdown"></div>
    </div>`;
}

function initCombobox(id) {
  const dropdown = document.getElementById(`${id}-dropdown`);
  existingTopics.forEach(t => {
    const opt = document.createElement('div');
    opt.className = 'combobox-option';
    opt.textContent = t;
    opt.onmousedown = () => {
      document.getElementById(id).value = t;
      dropdown.style.display = 'none';
    };
    dropdown.appendChild(opt);
  });
}

function filterCombobox(id) {
  const val = document.getElementById(id).value.toLowerCase();
  const dropdown = document.getElementById(`${id}-dropdown`);
  dropdown.style.display = 'block';
  dropdown.querySelectorAll('.combobox-option').forEach(opt => {
    opt.style.display = opt.textContent.toLowerCase().includes(val) ? '' : 'none';
  });
}
function openCombobox(id) { document.getElementById(`${id}-dropdown`).style.display = 'block'; }
function closeComboboxDelayed(id) { setTimeout(() => { document.getElementById(`${id}-dropdown`).style.display = 'none'; }, 200); }

// ─── Collect Questions ─────────────────────────────────────────────
function collectManualQuestions() {
  const cards = document.querySelectorAll('#manual-questions [id^="manual-q-"]');
  return Array.from(cards).map((card, i) => {
    const options = ['','','',''];
    card.querySelectorAll('.opt-input').forEach(inp => { options[parseInt(inp.dataset.opt)] = inp.value.trim(); });
    const radio = card.querySelector(`input[type="radio"]:checked`);
    const topicInput = card.querySelector('.topic-input');
    return {
      id: `q${i+1}`,
      text: card.querySelector('.q-text').value.trim(),
      options,
      correctIndex: radio ? parseInt(radio.value) : 0,
      topic: topicInput ? topicInput.value.trim() || 'General' : 'General'
    };
  });
}

function collectEditQuestions() {
  const cards = document.querySelectorAll('#edit-questions [id^="edit-q-"]');
  return Array.from(cards).map((card, i) => {
    const options = ['','','',''];
    card.querySelectorAll('.opt-input').forEach(inp => { options[parseInt(inp.dataset.opt)] = inp.value.trim(); });
    const radio = card.querySelector(`input[type="radio"]:checked`);
    const topicInput = card.querySelector('.topic-input');
    const qid = card.querySelector('.q-id')?.value || `q${i+1}`;
    return {
      id: qid,
      text: card.querySelector('.q-text').value.trim(),
      options,
      correctIndex: radio ? parseInt(radio.value) : 0,
      topic: topicInput ? topicInput.value.trim() || 'General' : 'General'
    };
  });
}

// ─── Save Draft / Publish (Create) ────────────────────────────────
async function saveDraft() {
  const { title, timerMinutes, questions } = getCreateFormData();
  if (!validateCreateForm(title, questions)) return;
  try {
    const res = await fetch('/api/tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ password: adminPassword, title, timerMinutes, questions })
    });
    if (!res.ok) { alert('Failed to save — check password.'); return; }
    const data = await res.json();
    showToast('Draft saved!');
    showSection('tests');
  } catch (e) { alert('Error saving draft.'); }
}

async function saveAndPublish() {
  const { title, timerMinutes, questions } = getCreateFormData();
  if (!validateCreateForm(title, questions)) return;
  try {
    // Save first
    const res = await fetch('/api/tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ password: adminPassword, title, timerMinutes, questions })
    });
    if (!res.ok) { alert('Failed to save.'); return; }
    const data = await res.json();
    // Then publish
    const pubRes = await fetch(`/api/tests/${data.test.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ password: adminPassword })
    });
    if (!pubRes.ok) { alert('Saved but failed to publish.'); return; }
    showToast('Test published! Previous test archived.');
    resetCreateForm();
    showSection('tests');
    await loadTopics();
  } catch (e) { alert('Error.'); }
}

function getCreateFormData() {
  return {
    title: document.getElementById('test-title').value.trim(),
    timerMinutes: parseInt(document.getElementById('test-timer').value) || 15,
    questions: collectManualQuestions()
  };
}

function validateCreateForm(title, questions) {
  if (!title) { alert('Please enter a test title.'); return false; }
  if (!questions.length) { alert('Please add at least one question.'); return false; }
  const invalid = questions.filter(q => !q.text || q.options.some(o => !o));
  if (invalid.length) { alert(`${invalid.length} question(s) have missing text or options.`); return false; }
  return true;
}

function resetCreateForm() {
  document.getElementById('test-title').value = '';
  document.getElementById('test-timer').value = '15';
  document.getElementById('manual-questions').innerHTML = '';
  document.getElementById('csv-text').value = '';
  document.getElementById('csv-preview').classList.add('hidden');
  document.getElementById('csv-import-btn').classList.add('hidden');
  csvParsedRows = [];
  manualQuestionCount = 0;
  addManualQuestion();
}

// ─── Edit Section ─────────────────────────────────────────────────
async function loadEditSection(testId) {
  editingTestId = testId;
  editQuestionCount = 0;
  showSection('edit');

  try {
    const res = await fetch(`/api/tests/${testId}`);
    const test = await res.json();
    document.getElementById('edit-title').value = test.title;
    document.getElementById('edit-timer').value = test.timerMinutes;
    const container = document.getElementById('edit-questions');
    container.innerHTML = '';
    test.questions.forEach(q => addEditQuestion(q));
  } catch (e) { alert('Failed to load test for editing.'); }
}

async function saveEdit() {
  const title = document.getElementById('edit-title').value.trim();
  const timerMinutes = parseInt(document.getElementById('edit-timer').value) || 15;
  const questions = collectEditQuestions();
  try {
    const res = await fetch(`/api/tests/${editingTestId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ password: adminPassword, title, timerMinutes, questions })
    });
    if (!res.ok) { alert('Failed to save.'); return; }
    showToast('Test updated!');
  } catch (e) { alert('Error.'); }
}

async function publishCurrentEdit() {
  await saveEdit();
  await publishTest(editingTestId);
  showSection('tests');
}

// ─── CSV Upload & Parse ────────────────────────────────────────────
document.getElementById('csv-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => { document.getElementById('csv-text').value = ev.target.result; parseCSV(); };
  reader.readAsText(file);
});

const dropzone = document.getElementById('csv-dropzone');
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('border-primary'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-primary'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('border-primary');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { document.getElementById('csv-text').value = ev.target.result; parseCSV(); };
  reader.readAsText(file);
});

async function parseCSV() {
  const csvText = document.getElementById('csv-text').value.trim();
  if (!csvText) { alert('Please paste or upload CSV content first.'); return; }

  try {
    const res = await fetch('/api/tests/upload-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
      body: JSON.stringify({ password: adminPassword, csvText })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'CSV parse failed.'); return; }

    csvParsedRows = data.rows;
    renderCSVPreview(data);
    document.getElementById('csv-import-btn').classList.toggle('hidden', data.hasErrors);
  } catch (e) { alert('Error parsing CSV.'); }
}

function renderCSVPreview(data) {
  const preview = document.getElementById('csv-preview');
  const summary = document.getElementById('csv-summary');
  const tbody = document.getElementById('csv-table-body');

  preview.classList.remove('hidden');

  summary.innerHTML = data.hasErrors
    ? `<div class="flex items-center gap-sm text-error font-label-md"><span class="material-symbols-outlined text-[18px]">error</span>${data.errorCount} row(s) have errors — fix before importing</div>`
    : `<div class="flex items-center gap-sm text-green-700 font-label-md"><span class="material-symbols-outlined text-[18px]">check_circle</span>${data.totalRows} rows parsed successfully — click "Import to Test"</div>`;

  tbody.innerHTML = '';
  data.rows.forEach(row => {
    const hasErr = row.errors.length > 0;
    const hasWarn = row.warnings.length > 0;
    const tr = document.createElement('tr');
    tr.className = hasErr ? 'csv-error-row' : (hasWarn ? 'csv-warning' : '');
    const correctLetter = LETTERS[row.correctIndex] || '?';
    const warningBadge = row.warnings.length
      ? `<div class="text-[11px] text-amber-700 mt-xs">${row.warnings.join(', ')}</div>` : '';
    const errorBadge = hasErr
      ? `<div class="text-[11px] text-error mt-xs">${row.errors.join('; ')}</div>` : '';

    tr.innerHTML = `
      <td class="px-sm py-xs border border-outline-variant font-timer-mono text-[11px]">${row.rowNumber}</td>
      <td class="px-sm py-xs border border-outline-variant max-w-[180px]"><div class="truncate">${escHtml(row.question||'')}</div>${errorBadge}</td>
      <td class="px-sm py-xs border border-outline-variant text-[12px]">${escHtml((row.options||[])[0]||'')}</td>
      <td class="px-sm py-xs border border-outline-variant text-[12px]">${escHtml((row.options||[])[1]||'')}</td>
      <td class="px-sm py-xs border border-outline-variant text-[12px]">${escHtml((row.options||[])[2]||'')}</td>
      <td class="px-sm py-xs border border-outline-variant text-[12px]">${escHtml((row.options||[])[3]||'')}</td>
      <td class="px-sm py-xs border border-outline-variant font-timer-mono text-[12px] font-bold text-primary">${correctLetter}</td>
      <td class="px-sm py-xs border border-outline-variant text-[12px]">${escHtml(row.topic||'')}${warningBadge}</td>
      <td class="px-sm py-xs border border-outline-variant text-[11px]">
        ${hasErr ? '<span class="text-error font-bold">Error</span>' : (hasWarn ? '<span class="text-amber-600">Warning</span>' : '<span class="text-green-700">OK</span>')}
      </td>`;
    tbody.appendChild(tr);
  });
}

function importCSVToManual() {
  if (!csvParsedRows.length) return;
  const container = document.getElementById('manual-questions');
  container.innerHTML = '';
  manualQuestionCount = 0;
  csvParsedRows.filter(r => !r.errors.length).forEach(r => {
    addManualQuestion({ text: r.question, options: r.options, correctIndex: r.correctIndex, topic: r.topic });
  });
  switchTab('manual');
  showToast(`${csvParsedRows.length} questions imported!`);
}

// ─── Live Tracker ─────────────────────────────────────────────────
async function loadTracker() {
  const container = document.getElementById('tracker-content');
  container.innerHTML = `<div class="flex items-center gap-sm text-on-surface-variant"><span class="material-symbols-outlined animate-spin">sync</span><span class="text-body-md">Loading...</span></div>`;
  try {
    const res = await fetch('/api/tests/current');
    const test = await res.json();
    if (!test) {
      container.innerHTML = `
        <div class="text-center py-xl text-on-surface-variant">
          <span class="material-symbols-outlined text-[40px] block mb-md">event_busy</span>
          <p class="text-body-md">No active test right now.</p>
        </div>`;
      return;
    }

    // Also get submission data via analytics
    const analyticsRes = await fetch('/api/analytics/history');
    const analytics = await analyticsRes.json();
    const currentSub = analytics.currentStatus?.submission;

    let score = 0, answeredCount = 0;
    const answerMap = {};
    if (currentSub) {
      currentSub.answers.forEach(a => { answerMap[a.questionId] = a; });
      score = currentSub.answers.filter(a => a.correct).length;
      answeredCount = currentSub.answers.length;
    }

    container.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg mb-lg">
        <div class="flex items-center justify-between flex-wrap gap-md">
          <div>
            <p class="text-label-md font-label-md text-on-surface-variant uppercase tracking-widest mb-xs text-[11px]">Current Test</p>
            <h2 class="text-headline-md font-headline-md text-on-surface">${escHtml(test.title)}</h2>
          </div>
          <div class="text-right">
            <p class="text-label-md font-label-md text-on-surface-variant text-[11px] mb-xs">Score</p>
            <p class="text-headline-md font-headline-md text-primary">${score} / ${answeredCount}</p>
            <p class="text-[12px] text-on-surface-variant">${answeredCount} of ${test.questions.length} answered</p>
          </div>
        </div>
      </div>
      <div class="space-y-sm">
        ${test.questions.map((q, i) => {
          const ans = answerMap[q.id];
          const isRight = ans && ans.correct;
          const isWrong = ans && !ans.correct;
          return `
            <div class="bg-surface-container-lowest border ${isRight ? 'border-green-200' : isWrong ? 'border-error' : 'border-outline-variant'} rounded-lg p-md flex items-center justify-between gap-md">
              <div class="flex items-center gap-md flex-1 min-w-0">
                <span class="text-label-md font-label-md text-on-surface-variant w-6 flex-shrink-0">${String(i+1).padStart(2,'0')}</span>
                <span class="text-body-md text-on-surface truncate">${escHtml(q.text)}</span>
              </div>
              <div class="flex-shrink-0">
                ${!ans ? `<span class="text-[12px] text-on-surface-variant font-label-md">Not answered</span>` :
                  isRight ? `<span class="flex items-center gap-xs text-green-700 font-label-md text-[12px]"><span class="material-symbols-outlined text-[16px]">check_circle</span>Correct (${LETTERS[ans.selectedIndex]})</span>` :
                  `<span class="flex items-center gap-xs text-error font-label-md text-[12px]"><span class="material-symbols-outlined text-[16px]">cancel</span>Wrong (${LETTERS[ans.selectedIndex]})</span>`}
              </div>
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    container.innerHTML = `<p class="text-error">Failed to load tracker.</p>`;
  }
}

// ─── Utils ────────────────────────────────────────────────────────
function showToast(msg = 'Done!') {
  const t = document.getElementById('toast');
  t.textContent = '✓ ' + msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
