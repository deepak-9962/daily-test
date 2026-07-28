// ─────────────────────────────────────────────────────────────────
// TestFlow Analytics Dashboard — analytics.js
// ─────────────────────────────────────────────────────────────────

let scoreChart = null;
let topicChart = null;

// ─── Auth ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', checkAutoAuth);

function checkAutoAuth() {
  const savedAuth = sessionStorage.getItem('admin_authenticated');
  if (savedAuth === 'true') {
    document.getElementById('password-modal').style.display = 'none';
    document.getElementById('analytics-app').classList.remove('hidden');
    document.getElementById('analytics-app').classList.add('flex');
    loadAnalytics();
  }
}

document.getElementById('login-btn').addEventListener('click', tryLogin);
document.getElementById('admin-pwd').addEventListener('keypress', e => { if (e.key === 'Enter') tryLogin(); });

function tryLogin() {
  const pwd = document.getElementById('admin-pwd').value;
  if (!pwd) return;
  sessionStorage.setItem('admin_password', pwd);
  sessionStorage.setItem('admin_authenticated', 'true');
  document.getElementById('password-modal').style.display = 'none';
  document.getElementById('analytics-app').classList.remove('hidden');
  document.getElementById('analytics-app').classList.add('flex');
  loadAnalytics();
}

// ─── Load & Render Analytics ──────────────────────────────────────
async function loadAnalytics() {
  document.getElementById('analytics-loading').classList.remove('hidden');
  document.getElementById('analytics-content').classList.add('hidden');

  try {
    const res = await fetch('/api/analytics/history');
    const data = await res.json();

    document.getElementById('analytics-loading').classList.add('hidden');
    document.getElementById('analytics-content').classList.remove('hidden');

    renderCurrentTest(data.currentStatus);
    renderSummaryStats(data);
    renderScoreChart(data.scoreTrend);
    renderTopicChart(data.topicBreakdown);
    renderTimeAnalysis(data.timeStats);
    renderHistoryTable(data.history);
  } catch (e) {
    document.getElementById('analytics-loading').innerHTML = `<p class="text-error text-body-md">Failed to load analytics: ${e.message}</p>`;
  }
}

// ─── Current Test Panel ───────────────────────────────────────────
function renderCurrentTest(currentStatus) {
  const container = document.getElementById('current-content');

  if (!currentStatus || !currentStatus.test) {
    container.innerHTML = `
      <div class="stat-card flex items-center gap-md text-on-surface-variant">
        <span class="material-symbols-outlined text-[32px]">event_busy</span>
        <p class="text-body-md">No test is currently active or published.</p>
      </div>`;
    return;
  }

  const { test, submission } = currentStatus;
  const answers = submission?.answers || [];
  const score = answers.filter(a => a.correct).length;
  const answeredCount = answers.length;
  const LETTERS = ['A','B','C','D'];

  const answerMap = {};
  answers.forEach(a => { answerMap[a.questionId] = a; });

  container.innerHTML = `
    <div class="stat-card mb-md">
      <div class="flex items-center justify-between flex-wrap gap-md mb-md">
        <div>
          <p class="text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-xs">Active Test</p>
          <h3 class="text-headline-md font-headline-md text-on-surface">${escHtml(test.title)}</h3>
        </div>
        <div class="text-right">
          <p class="text-[11px] text-on-surface-variant mb-xs">Score</p>
          <p class="text-headline-md font-headline-md text-primary">${score} / ${answeredCount}</p>
          <p class="text-[12px] text-on-surface-variant">${answeredCount} of ${test.questions.length} answered</p>
        </div>
      </div>
      <div class="space-y-xs mt-md">
        ${test.questions.map((q, i) => {
          const ans = answerMap[q.id];
          const isRight = ans && ans.correct;
          const isWrong = ans && !ans.correct;
          return `
            <div class="flex items-center justify-between gap-md p-sm rounded-lg ${isRight ? 'bg-green-50 border border-green-200' : isWrong ? 'bg-error-container/20 border border-error/30' : 'bg-surface-container border border-outline-variant'}">
              <div class="flex items-center gap-sm flex-1 min-w-0">
                <span class="text-[12px] font-timer-mono text-on-surface-variant w-5 flex-shrink-0">${i+1}</span>
                <span class="text-[13px] text-on-surface truncate">${escHtml(q.text)}</span>
              </div>
              <span class="text-[12px] font-label-md flex-shrink-0 ${isRight ? 'text-green-700' : isWrong ? 'text-error' : 'text-on-surface-variant'}">
                ${!ans ? 'Not answered' : isRight ? `✓ Correct (${LETTERS[ans.selectedIndex]})` : `✗ Wrong (${LETTERS[ans.selectedIndex]})`}
              </span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ─── Summary Stats ────────────────────────────────────────────────
function renderSummaryStats(data) {
  const { history, timeStats } = data;
  const withScore = history.filter(h => h.scorePct !== null);

  document.getElementById('stat-tests').textContent = withScore.length || '0';

  if (withScore.length) {
    const avg = Math.round(withScore.reduce((s, h) => s + h.scorePct, 0) / withScore.length);
    const best = Math.max(...withScore.map(h => h.scorePct));
    document.getElementById('stat-avg-score').textContent = `${avg}%`;
    document.getElementById('stat-best').textContent = `${best}%`;
  } else {
    document.getElementById('stat-avg-score').textContent = '—';
    document.getElementById('stat-best').textContent = '—';
  }

  document.getElementById('stat-time').textContent = timeStats.avgSecondsPerQuestion
    ? `${timeStats.avgSecondsPerQuestion}s` : '—';
}

// ─── Score Trend Line Chart ────────────────────────────────────────
function renderScoreChart(scoreTrend) {
  const ctx = document.getElementById('score-chart').getContext('2d');
  if (scoreChart) scoreChart.destroy();

  if (!scoreTrend.length) {
    ctx.canvas.parentElement.innerHTML = `<p class="text-on-surface-variant text-body-md py-lg text-center">No completed tests yet. Attempt a test to see your score trend.</p>`;
    return;
  }

  const labels = scoreTrend.map(t => {
    const d = new Date(t.date);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  });

  scoreChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Score %',
        data: scoreTrend.map(t => t.scorePct),
        borderColor: '#3525cd',
        backgroundColor: 'rgba(53,37,205,0.06)',
        pointBackgroundColor: '#4f46e5',
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.3,
        fill: true,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y}% — ${scoreTrend[ctx.dataIndex]?.title || ''}`
          }
        }
      },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { callback: v => `${v}%`, font: { family: 'Inter', size: 12 }, color: '#464555' },
          grid: { color: '#e9edff' }
        },
        x: {
          ticks: { font: { family: 'Inter', size: 12 }, color: '#464555' },
          grid: { display: false }
        }
      }
    }
  });
}

// ─── Topic Accuracy Horizontal Bar Chart ──────────────────────────
function renderTopicChart(topicBreakdown) {
  const wrapper = document.getElementById('topic-chart').closest('.stat-card');
  const emptyEl = document.getElementById('topic-empty');

  if (!topicBreakdown.length) {
    wrapper.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  const ctx = document.getElementById('topic-chart').getContext('2d');
  if (topicChart) topicChart.destroy();

  const labels = topicBreakdown.map(t => t.topic);
  const values = topicBreakdown.map(t => t.accuracy);
  const bgColors = values.map(v => v < 50 ? 'rgba(186,26,26,0.7)' : v < 75 ? 'rgba(79,70,229,0.55)' : 'rgba(53,37,205,0.75)');

  topicChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Accuracy %',
        data: values,
        backgroundColor: bgColors,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const t = topicBreakdown[ctx.dataIndex];
              return `${ctx.parsed.x}% (${t.correct}/${t.total} correct)`;
            }
          }
        }
      },
      scales: {
        x: {
          min: 0, max: 100,
          ticks: { callback: v => `${v}%`, font: { family: 'Inter', size: 12 }, color: '#464555' },
          grid: { color: '#e9edff' }
        },
        y: {
          ticks: { font: { family: 'Inter', size: 12 }, color: '#464555' },
          grid: { display: false }
        }
      }
    }
  });
}

// ─── Time Analysis ────────────────────────────────────────────────
function renderTimeAnalysis(timeStats) {
  const container = document.getElementById('time-content');
  if (!timeStats.avgSecondsPerQuestion) {
    container.textContent = 'No time data yet. Attempt a test to see time analysis.';
    return;
  }

  const perQ = Object.entries(timeStats.perQuestion || {});
  const slowQuestions = perQ
    .map(([qid, d]) => ({ qid, avgTime: Math.round(d.times.reduce((a,b)=>a+b,0)/d.times.length), topic: d.topic }))
    .filter(q => q.avgTime > timeStats.avgSecondsPerQuestion * 1.5)
    .sort((a,b) => b.avgTime - a.avgTime)
    .slice(0, 5);

  container.innerHTML = `
    <div class="flex items-center gap-xl flex-wrap mb-md">
      <div>
        <p class="text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-xs">Avg Time / Question</p>
        <p class="text-headline-md font-headline-md text-primary font-timer-mono">${timeStats.avgSecondsPerQuestion}s</p>
      </div>
      <div>
        <p class="text-[11px] font-label-md text-on-surface-variant uppercase tracking-widest mb-xs">Total Answered</p>
        <p class="text-headline-md font-headline-md text-primary font-timer-mono">${timeStats.totalAnswers}</p>
      </div>
    </div>
    ${slowQuestions.length ? `
      <div>
        <p class="text-label-md font-label-md text-on-surface-variant mb-sm flex items-center gap-xs">
          <span class="material-symbols-outlined text-[16px] text-amber-600">timer</span>
          Slow questions (took significantly longer than average):
        </p>
        <div class="space-y-xs">
          ${slowQuestions.map(q => `
            <div class="flex items-center justify-between gap-md p-sm rounded-lg bg-amber-50 border border-amber-200">
              <span class="text-[13px] text-on-surface font-timer-mono">${q.qid}</span>
              <span class="text-[12px] text-amber-700 font-label-md">${q.avgTime}s avg · ${q.topic}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}`;
}

// ─── Test History Table ───────────────────────────────────────────
function renderHistoryTable(history) {
  const emptyEl = document.getElementById('history-empty');
  const tableWrapper = document.getElementById('history-table-wrapper');
  const tbody = document.getElementById('history-tbody');

  if (!history.length) {
    emptyEl.classList.remove('hidden');
    tableWrapper.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  tableWrapper.classList.remove('hidden');
  tbody.innerHTML = '';

  history.forEach(h => {
    const date = h.date ? new Date(h.date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—';
    const timeStr = h.timeTakenSeconds ? fmtTime(h.timeTakenSeconds) : '—';
    const pctColor = h.scorePct !== null ? (h.scorePct >= 75 ? 'text-green-700' : h.scorePct >= 50 ? 'text-primary' : 'text-error') : 'text-on-surface-variant';

    const tr = document.createElement('tr');
    tr.className = 'border-b border-outline-variant hover:bg-surface-container-low transition-colors';
    tr.innerHTML = `
      <td class="py-sm pr-md text-on-surface font-medium">${escHtml(h.title)}</td>
      <td class="py-sm pr-md text-on-surface-variant text-[13px]">${date}</td>
      <td class="py-sm pr-md font-timer-mono text-[14px] text-on-surface">${h.score !== null ? `${h.score}/${h.totalQuestions}` : '—'}</td>
      <td class="py-sm pr-md font-timer-mono text-[14px] ${pctColor}">${h.scorePct !== null ? `${h.scorePct}%` : '—'}</td>
      <td class="py-sm pr-md text-[13px] text-on-surface-variant">${timeStr}</td>
      <td class="py-sm">
        <a href="test-detail.html?id=${encodeURIComponent(h.id)}" class="text-primary text-[12px] font-label-md hover:underline flex items-center gap-xs">
          <span class="material-symbols-outlined text-[14px]">open_in_new</span>Details
        </a>
      </td>`;
    tbody.appendChild(tr);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────
function fmtTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}m ${s}s`;
}
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
