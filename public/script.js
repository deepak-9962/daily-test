// ─────────────────────────────────────────────────────────────────
// TestFlow Participant — v2 script.js
// ─────────────────────────────────────────────────────────────────

const LETTERS = ['A', 'B', 'C', 'D'];

let currentTest = null;
let activeTestId = null;
let activeSubmissionId = null;  // tracks the specific submission row in Supabase
let totalQuestions = 0;
let answeredCount = 0;
let timerInterval = null;
let timeLeft = 0;
let testStarted = false;

// DOM refs
const timerEl          = document.getElementById('timer');
const timerWrapper     = document.getElementById('timer-wrapper');
const progressBar      = document.getElementById('progress-bar');
const loadingState     = document.getElementById('loading-state');
const emptyState       = document.getElementById('empty-state');
const landingScreen    = document.getElementById('landing-screen');
const questionsContainer = document.getElementById('questions-container');
const footerAction     = document.getElementById('footer-action');
const answeredCountEl  = document.getElementById('answered-count');
const submitBtn        = document.getElementById('submit-btn');
const startBtn         = document.getElementById('start-btn');
const resultsScreen    = document.getElementById('results-screen');
const headerTitle      = document.getElementById('header-title');

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const res = await fetch('/api/tests/current');
    const test = await res.json();
    loadingState.classList.add('hidden');

    if (!test) {
      show(emptyState);
      return;
    }

    currentTest = test;
    totalQuestions = test.questions.length;
    headerTitle.textContent = test.title;

    // Show landing screen
    document.getElementById('test-title-display').textContent = test.title;
    document.getElementById('q-count-badge').textContent = `${totalQuestions} Question${totalQuestions !== 1 ? 's' : ''}`;
    document.getElementById('timer-badge').textContent = `${test.timerMinutes} Minute${test.timerMinutes !== 1 ? 's' : ''}`;
    show(landingScreen);

    startBtn.addEventListener('click', startTest);
  } catch (e) {
    loadingState.classList.add('hidden');
    show(emptyState);
  }
}

async function startTest() {
  startBtn.disabled = true;
  startBtn.innerHTML = `<span class="material-symbols-outlined animate-spin">sync</span><span>Starting...</span>`;

  try {
    // Create submission
    const res = await fetch('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start');
    activeTestId = data.testId;
    activeSubmissionId = data.submission?.id || null;  // save the unique submission ID
  } catch (e) {
    console.error('Failed to start submission:', e);
    // Continue anyway
    activeTestId = currentTest.id;
    activeSubmissionId = null;
  }

  hide(landingScreen);
  show(questionsContainer);
  timerWrapper.classList.remove('hidden');
  timerWrapper.classList.add('flex');
  footerAction.classList.remove('hidden');
  renderQuestions(currentTest.questions);
  startTimer(currentTest.timerMinutes * 60);
  testStarted = true;
}

function renderQuestions(questions) {
  questionsContainer.innerHTML = '';
  answeredCount = 0;

  questions.forEach((q, index) => {
    const questionDiv = document.createElement('div');
    questionDiv.className = 'flex flex-col gap-sm';
    questionDiv.id = `question-${q.id}`;

    const optionsHtml = q.options.map((opt, optIndex) => `
      <button class="option-btn flex items-center gap-xs px-sm py-2 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low transition-colors flex-1 overflow-hidden text-left cursor-pointer group"
        data-qid="${q.id}" data-optindex="${optIndex}">
        <span class="letter-badge font-timer-mono text-[11px] bg-surface-variant text-on-surface-variant px-1.5 py-0.5 rounded flex-shrink-0 group-hover:bg-outline-variant transition-colors">${LETTERS[optIndex]}</span>
        <span class="font-label-md text-on-surface truncate">${escHtml(opt)}</span>
      </button>
    `).join('');

    questionDiv.innerHTML = `
      <span class="font-label-md text-secondary text-[12px] uppercase tracking-widest">Question ${index + 1}${q.topic && q.topic !== 'General' ? ` · ${escHtml(q.topic)}` : ''}</span>
      <h2 class="font-body-lg font-medium text-on-surface">${escHtml(q.text)}</h2>
      <div class="flex flex-row gap-xs w-full">${optionsHtml}</div>
    `;
    questionsContainer.appendChild(questionDiv);
  });

  updateProgress();
  bindOptionClicks();
}

function bindOptionClicks() {
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', handleOptionClick);
  });
}

async function handleOptionClick(e) {
  const btn = e.currentTarget;
  if (btn.disabled) return;

  const qId = btn.getAttribute('data-qid');
  const optIndex = parseInt(btn.getAttribute('data-optindex'));
  const siblings = document.querySelectorAll(`#question-${qId} .option-btn`);

  // If already selected, do nothing
  if (btn.classList.contains('selected')) return;

  // Check if this question was already answered before
  const prevSelected = Array.from(siblings).find(s => s.classList.contains('selected'));
  const isFirstAnswer = !prevSelected;

  // Optimistic UI update across all siblings for this question
  siblings.forEach(s => {
    s.classList.remove('selected', 'bg-primary-container', 'text-on-primary-container', 'border-primary-container');
    s.classList.add('bg-surface-container-lowest');
    const badge = s.querySelector('.letter-badge');
    if (badge) {
      badge.classList.remove('bg-on-primary-fixed-variant', 'text-on-primary-container', 'opacity-90');
      badge.classList.add('bg-surface-variant', 'text-on-surface-variant');
    }
  });

  // Highlight newly selected option
  btn.classList.add('selected', 'bg-primary-container', 'text-on-primary-container', 'border-primary-container');
  btn.classList.remove('bg-surface-container-lowest');
  const badge = btn.querySelector('.letter-badge');
  if (badge) {
    badge.classList.add('bg-on-primary-fixed-variant', 'text-on-primary-container', 'opacity-90');
    badge.classList.remove('bg-surface-variant', 'text-on-surface-variant');
  }

  if (isFirstAnswer) {
    answeredCount++;
  }
  updateProgress();

  // Send update to server
  try {
    const res = await fetch(`/api/submissions/${activeTestId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: qId, selectedIndex: optIndex, submissionId: activeSubmissionId })
    });
    if (!res.ok) throw new Error('Answer save failed');
  } catch (err) {
    console.error('Failed to record answer:', err);
    // Rollback
    btn.classList.remove('selected', 'bg-primary-container', 'text-on-primary-container', 'border-primary-container');
    btn.classList.add('bg-surface-container-lowest');
    if (badge) {
      badge.classList.remove('bg-on-primary-fixed-variant', 'text-on-primary-container', 'opacity-90');
      badge.classList.add('bg-surface-variant', 'text-on-surface-variant');
    }

    if (prevSelected) {
      prevSelected.classList.add('selected', 'bg-primary-container', 'text-on-primary-container', 'border-primary-container');
      prevSelected.classList.remove('bg-surface-container-lowest');
      const prevBadge = prevSelected.querySelector('.letter-badge');
      if (prevBadge) {
        prevBadge.classList.add('bg-on-primary-fixed-variant', 'text-on-primary-container', 'opacity-90');
        prevBadge.classList.remove('bg-surface-variant', 'text-on-surface-variant');
      }
    } else {
      answeredCount--;
    }
    updateProgress();
    alert('Failed to save your answer. Please try again.');
  }
}

function updateProgress() {
  const pct = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;
  progressBar.style.width = `${pct}%`;
  answeredCountEl.textContent = `${answeredCount} of ${totalQuestions} answered`;
}

function startTimer(seconds) {
  timeLeft = seconds;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 300) {
      timerEl.classList.add('!text-error');
      timerWrapper.classList.add('timer-warning');
    }
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerEl.textContent = "Time's Up!";
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.disabled = true;
      });
      submitTest(true);
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

submitBtn.addEventListener('click', () => submitTest(false));

async function submitTest(isAutoSubmit = false) {
  if (!testStarted) return;
  clearInterval(timerInterval);
  timerEl.textContent = 'Submitting...';
  submitBtn.disabled = true;

  try {
    const res = await fetch(`/api/submissions/${activeTestId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: activeSubmissionId })
    });
    const data = await res.json();

    if (res.ok) {
      showResults(data);
    } else {
      throw new Error(data.error || 'Submit failed');
    }
  } catch (e) {
    console.error('Submit error:', e);
    // Show basic completion screen
    showBasicCompletion();
  }
}

function showResults(data) {
  hide(questionsContainer);
  footerAction.classList.add('hidden');
  timerWrapper.classList.remove('flex');
  timerWrapper.classList.add('hidden');
  timerEl.textContent = 'Completed';

  const mins = Math.floor((data.timeTakenSeconds || 0) / 60);
  const secs = (data.timeTakenSeconds || 0) % 60;
  const total = data.totalQuestions || totalQuestions;
  const answered = data.answeredCount !== undefined ? data.answeredCount : answeredCount;

  const resultTimeEl = document.getElementById('result-time');
  if (resultTimeEl) resultTimeEl.textContent = `⏱ Time taken: ${mins}m ${secs}s`;

  const resultCountEl = document.getElementById('result-answered-count');
  if (resultCountEl) resultCountEl.textContent = `📝 Answered ${answered} of ${total} question${total !== 1 ? 's' : ''}`;

  show(resultsScreen);
}

function showBasicCompletion() {
  hide(questionsContainer);
  footerAction.classList.add('hidden');
  timerWrapper.classList.remove('flex');
  timerWrapper.classList.add('hidden');
  timerEl.textContent = 'Completed';

  const resultTimeEl = document.getElementById('result-time');
  if (resultTimeEl) resultTimeEl.textContent = `⏱ Time taken: Finished`;

  const resultCountEl = document.getElementById('result-answered-count');
  if (resultCountEl) resultCountEl.textContent = `📝 Answered ${answeredCount} of ${totalQuestions} question${totalQuestions !== 1 ? 's' : ''}`;

  show(resultsScreen);
}

// ─── Helpers ──────────────────────────────────────────────────────
function show(el) { el.classList.remove('hidden'); el.classList.add('flex'); }
function hide(el) { el.classList.add('hidden'); el.classList.remove('flex'); }
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
