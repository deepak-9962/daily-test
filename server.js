const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── File Paths (Vercel-safe fallback to /tmp if read-only) ────────────────
const DB_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, 'db');
const TESTS_FILE = path.join(DB_DIR, 'tests.json');
const SUBS_FILE  = path.join(DB_DIR, 'submissions.json');

function ensureDbFiles() {
  if (!fs.existsSync(DB_DIR)) {
    try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch (e) {}
  }
  const seedTests = path.join(__dirname, 'db', 'tests.json');
  const seedSubs  = path.join(__dirname, 'db', 'submissions.json');

  if (!fs.existsSync(TESTS_FILE)) {
    try {
      if (fs.existsSync(seedTests)) {
        fs.copyFileSync(seedTests, TESTS_FILE);
      } else {
        fs.writeFileSync(TESTS_FILE, JSON.stringify({ tests: [] }));
      }
    } catch (e) {}
  }
  if (!fs.existsSync(SUBS_FILE)) {
    try {
      if (fs.existsSync(seedSubs)) {
        fs.copyFileSync(seedSubs, SUBS_FILE);
      } else {
        fs.writeFileSync(SUBS_FILE, JSON.stringify({ submissions: [] }));
      }
    } catch (e) {}
  }
}

// ─── DB Helpers ────────────────────────────────────────────────────────────
function readTests() {
  ensureDbFiles();
  return JSON.parse(fs.readFileSync(TESTS_FILE, 'utf8'));
}
function writeTests(data) {
  ensureDbFiles();
  fs.writeFileSync(TESTS_FILE, JSON.stringify(data, null, 2));
}
function readSubs() {
  ensureDbFiles();
  return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
}
function writeSubs(data) {
  ensureDbFiles();
  fs.writeFileSync(SUBS_FILE, JSON.stringify(data, null, 2));
}

// ─── Admin Auth Middleware ─────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
function requireAdmin(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.body?.password;
  if (pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── ID Generator ─────────────────────────────────────────────────────────
function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ══════════════════════════════════════════════════════════════════════════
// TESTS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// GET /api/tests/current — Returns published/active test or null
app.get('/api/tests/current', (req, res) => {
  try {
    const { tests } = readTests();
    const current = tests.find(t => t.status === 'published' || t.status === 'active');
    res.json(current || null);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read tests' });
  }
});

// GET /api/tests — List all tests (admin)
app.get('/api/tests', (req, res) => {
  try {
    const { tests } = readTests();
    // Return tests without full questions for list view
    const list = tests.map(t => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      timerMinutes: t.timerMinutes,
      status: t.status,
      questionCount: t.questions.length
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read tests' });
  }
});

// GET /api/tests/:id — Get single test by id
app.get('/api/tests/:id', (req, res) => {
  try {
    const { tests } = readTests();
    const test = tests.find(t => t.id === req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });
    res.json(test);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read test' });
  }
});

// POST /api/tests — Create new draft test
app.post('/api/tests', requireAdmin, (req, res) => {
  try {
    const { title, timerMinutes, questions } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const db = readTests();
    const newTest = {
      id: newId('test'),
      title: title.trim(),
      createdAt: new Date().toISOString(),
      timerMinutes: parseInt(timerMinutes) || 15,
      status: 'draft',
      questions: (questions || []).map((q, i) => ({
        id: q.id || `q${i + 1}`,
        text: q.text,
        options: q.options,
        correctIndex: q.correctIndex ?? 0,
        topic: q.topic || 'General'
      }))
    };

    db.tests.push(newTest);
    writeTests(db);
    res.json({ success: true, test: newTest });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create test' });
  }
});

// PUT /api/tests/:id — Edit a draft test
app.put('/api/tests/:id', requireAdmin, (req, res) => {
  try {
    const db = readTests();
    const idx = db.tests.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Test not found' });
    if (db.tests[idx].status !== 'draft') {
      return res.status(400).json({ error: 'Only draft tests can be edited' });
    }

    const { title, timerMinutes, questions } = req.body;
    if (title) db.tests[idx].title = title.trim();
    if (timerMinutes) db.tests[idx].timerMinutes = parseInt(timerMinutes);
    if (questions) {
      db.tests[idx].questions = questions.map((q, i) => ({
        id: q.id || `q${i + 1}`,
        text: q.text,
        options: q.options,
        correctIndex: q.correctIndex ?? 0,
        topic: q.topic || 'General'
      }));
    }

    writeTests(db);
    res.json({ success: true, test: db.tests[idx] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update test' });
  }
});

// POST /api/tests/:id/publish — Publish test; archive others
app.post('/api/tests/:id/publish', requireAdmin, (req, res) => {
  try {
    const db = readTests();
    const idx = db.tests.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Test not found' });

    // Archive any currently published/active test
    db.tests.forEach((t, i) => {
      if (i !== idx && (t.status === 'published' || t.status === 'active')) {
        db.tests[i].status = 'archived';
      }
    });

    db.tests[idx].status = 'published';
    writeTests(db);
    res.json({ success: true, test: db.tests[idx] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to publish test' });
  }
});

// POST /api/tests/:id/archive — Archive a test
app.post('/api/tests/:id/archive', requireAdmin, (req, res) => {
  try {
    const db = readTests();
    const idx = db.tests.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Test not found' });
    db.tests[idx].status = 'archived';
    writeTests(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to archive test' });
  }
});

// POST /api/tests/upload-csv — Parse + validate CSV, return preview (no save)
app.post('/api/tests/upload-csv', requireAdmin, (req, res) => {
  try {
    const { csvText } = req.body;
    if (!csvText) return res.status(400).json({ error: 'No CSV text provided' });

    // Get existing topics for new-topic detection
    const { tests } = readTests();
    const existingTopics = new Set();
    tests.forEach(t => t.questions.forEach(q => {
      if (q.topic) existingTopics.add(q.topic.toLowerCase().trim());
    }));

    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

    // Parse headers — case-insensitive, order-insensitive
    const rawHeaders = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const headerMap = {};
    const required = ['question', 'optiona', 'optionb', 'optionc', 'optiond', 'correctanswer'];
    rawHeaders.forEach((h, i) => { headerMap[h] = i; });

    const missingHeaders = required.filter(r => headerMap[r] === undefined);
    if (missingHeaders.length > 0) {
      return res.status(400).json({ error: `Missing required columns: ${missingHeaders.join(', ')}` });
    }

    const rows = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      // Simple CSV split respecting quoted fields
      const cols = parseCSVLine(line);
      const row = { rowNumber: i + 1, errors: [], warnings: [] };

      const qText   = (cols[headerMap['question']] || '').trim().replace(/^["']|["']$/g, '');
      const optA    = (cols[headerMap['optiona']] || '').trim().replace(/^["']|["']$/g, '');
      const optB    = (cols[headerMap['optionb']] || '').trim().replace(/^["']|["']$/g, '');
      const optC    = (cols[headerMap['optionc']] || '').trim().replace(/^["']|["']$/g, '');
      const optD    = (cols[headerMap['optiond']] || '').trim().replace(/^["']|["']$/g, '');
      const correct = (cols[headerMap['correctanswer']] || '').trim().toUpperCase().replace(/^["']|["']$/g, '');
      const topic   = headerMap['topic'] !== undefined
        ? (cols[headerMap['topic']] || '').trim().replace(/^["']|["']$/g, '') || 'General'
        : 'General';

      if (!qText) row.errors.push('Question text is missing');
      if (!optA) row.errors.push('Option A is missing');
      if (!optB) row.errors.push('Option B is missing');
      if (!optC) row.errors.push('Option C is missing');
      if (!optD) row.errors.push('Option D is missing');
      if (!['A','B','C','D'].includes(correct)) row.errors.push(`Invalid correctAnswer "${correct}" — must be A, B, C, or D`);

      const correctIndex = { A: 0, B: 1, C: 2, D: 3 }[correct] ?? 0;

      // New topic detection
      const topicNormalized = topic.toLowerCase().trim();
      if (topic !== 'General' && !existingTopics.has(topicNormalized)) {
        row.warnings.push(`New topic: "${topic}"`);
      }

      row.question = qText;
      row.options = [optA, optB, optC, optD];
      row.correctIndex = correctIndex;
      row.topic = topic;

      rows.push(row);
      if (row.errors.length > 0) errors.push({ row: i + 1, errors: row.errors });
    }

    res.json({
      rows,
      totalRows: rows.length,
      errorCount: errors.length,
      hasErrors: errors.length > 0
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'CSV parsing failed: ' + e.message });
  }
});

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
// SUBMISSIONS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// POST /api/submissions — Start a submission (participant starts test)
app.post('/api/submissions', (req, res) => {
  try {
    const db = readTests();
    const current = db.tests.find(t => t.status === 'published' || t.status === 'active');
    if (!current) return res.status(404).json({ error: 'No active test found' });

    // Mark test as active
    current.status = 'active';
    writeTests(db);

    const subsDb = readSubs();
    // Remove any incomplete submission for this test (re-start case)
    subsDb.submissions = subsDb.submissions.filter(
      s => !(s.testId === current.id && !s.submittedAt)
    );

    const submission = {
      testId: current.id,
      startedAt: new Date().toISOString(),
      submittedAt: null,
      timeTakenSeconds: null,
      answers: [],
      score: null,
      totalQuestions: current.questions.length
    };
    subsDb.submissions.push(submission);
    writeSubs(subsDb);

    res.json({ success: true, testId: current.id, submission });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to start submission' });
  }
});

// POST /api/submissions/:testId/answer — Record one answer
app.post('/api/submissions/:testId/answer', (req, res) => {
  try {
    const { testId } = req.params;
    const { questionId, selectedIndex } = req.body;

    const db = readTests();
    const test = db.tests.find(t => t.id === testId);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const question = test.questions.find(q => q.id === questionId);
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const correct = question.correctIndex === selectedIndex;

    const subsDb = readSubs();
    const sub = subsDb.submissions.find(s => s.testId === testId && !s.submittedAt);
    if (!sub) return res.status(404).json({ error: 'No active submission found' });

    // Remove existing answer for this question (allow re-answer before submit)
    sub.answers = sub.answers.filter(a => a.questionId !== questionId);
    sub.answers.push({
      questionId,
      selectedIndex,
      correct,
      answeredAt: new Date().toISOString()
    });
    writeSubs(subsDb);

    res.json({ success: true, correct });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to record answer' });
  }
});

// POST /api/submissions/:testId/submit — Finalize submission
app.post('/api/submissions/:testId/submit', (req, res) => {
  try {
    const { testId } = req.params;

    const db = readTests();
    const test = db.tests.find(t => t.id === testId);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const subsDb = readSubs();
    const sub = subsDb.submissions.find(s => s.testId === testId && !s.submittedAt);
    if (!sub) return res.status(404).json({ error: 'No active submission found' });

    const now = new Date();
    const startedAt = new Date(sub.startedAt);
    sub.submittedAt = now.toISOString();
    sub.timeTakenSeconds = Math.round((now - startedAt) / 1000);
    sub.score = sub.answers.filter(a => a.correct).length;
    sub.totalQuestions = test.questions.length;

    // Enrich answers with question data for results screen
    const enrichedAnswers = test.questions.map(q => {
      const ans = sub.answers.find(a => a.questionId === q.id);
      return {
        questionId: q.id,
        questionText: q.text,
        options: q.options,
        correctIndex: q.correctIndex,
        topic: q.topic,
        selectedIndex: ans ? ans.selectedIndex : null,
        correct: ans ? ans.correct : false,
        answeredAt: ans ? ans.answeredAt : null
      };
    });

    writeSubs(subsDb);

    // Mark test as completed
    test.status = 'completed';
    writeTests(db);

    res.json({
      success: true,
      score: sub.score,
      totalQuestions: sub.totalQuestions,
      timeTakenSeconds: sub.timeTakenSeconds,
      answers: enrichedAnswers
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to submit' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ANALYTICS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// GET /api/analytics/history — Aggregated analytics data
app.get('/api/analytics/history', (req, res) => {
  try {
    const { tests } = readTests();
    const { submissions } = readSubs();

    const completedTests = tests.filter(t => t.status === 'completed' || t.status === 'archived');

    // Score trend
    const scoreTrend = completedTests.map(t => {
      const sub = submissions.find(s => s.testId === t.id && s.submittedAt);
      return {
        testId: t.id,
        title: t.title,
        date: sub ? sub.submittedAt : t.createdAt,
        score: sub ? sub.score : 0,
        totalQuestions: t.questions.length,
        scorePct: sub ? Math.round((sub.score / t.questions.length) * 100) : 0
      };
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    // Topic accuracy
    const topicStats = {};
    completedTests.forEach(t => {
      const sub = submissions.find(s => s.testId === t.id && s.submittedAt);
      if (!sub) return;
      t.questions.forEach(q => {
        const topic = q.topic || 'General';
        if (!topicStats[topic]) topicStats[topic] = { correct: 0, total: 0 };
        topicStats[topic].total++;
        const ans = sub.answers.find(a => a.questionId === q.id);
        if (ans && ans.correct) topicStats[topic].correct++;
      });
    });

    const topicBreakdown = Object.entries(topicStats).map(([topic, s]) => ({
      topic,
      correct: s.correct,
      total: s.total,
      accuracy: Math.round((s.correct / s.total) * 100)
    })).sort((a, b) => a.accuracy - b.accuracy); // worst first

    // Time analysis
    const timeStats = { totalAnswers: 0, totalTime: 0, perQuestion: {} };
    completedTests.forEach(t => {
      const sub = submissions.find(s => s.testId === t.id && s.submittedAt);
      if (!sub) return;
      sub.answers.forEach((ans, i) => {
        const prevAns = sub.answers[i - 1];
        const startRef = prevAns ? new Date(prevAns.answeredAt) : new Date(sub.startedAt);
        const thisTime = ans.answeredAt ? Math.round((new Date(ans.answeredAt) - startRef) / 1000) : 0;
        if (thisTime > 0 && thisTime < 600) {
          timeStats.totalAnswers++;
          timeStats.totalTime += thisTime;
          const qTopic = t.questions.find(q => q.id === ans.questionId)?.topic || 'General';
          if (!timeStats.perQuestion[ans.questionId]) {
            timeStats.perQuestion[ans.questionId] = { times: [], topic: qTopic };
          }
          timeStats.perQuestion[ans.questionId].times.push(thisTime);
        }
      });
    });
    timeStats.avgSecondsPerQuestion = timeStats.totalAnswers > 0
      ? Math.round(timeStats.totalTime / timeStats.totalAnswers) : 0;

    // Test history table
    const history = completedTests.map(t => {
      const sub = submissions.find(s => s.testId === t.id && s.submittedAt);
      return {
        id: t.id,
        title: t.title,
        date: sub ? sub.submittedAt : t.createdAt,
        score: sub ? sub.score : null,
        totalQuestions: t.questions.length,
        scorePct: sub ? Math.round((sub.score / t.questions.length) * 100) : null,
        timeTakenSeconds: sub ? sub.timeTakenSeconds : null
      };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    // Current active test
    const { tests: allTests } = readTests();
    const activeTest = allTests.find(t => t.status === 'active' || t.status === 'published');
    let currentStatus = null;
    if (activeTest) {
      const activeSub = readSubs().submissions.find(s => s.testId === activeTest.id && !s.submittedAt);
      currentStatus = {
        test: activeTest,
        submission: activeSub || null
      };
    }

    res.json({ scoreTrend, topicBreakdown, timeStats, history, currentStatus });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to compute analytics' });
  }
});

// GET /api/analytics/test/:id — Detailed breakdown for one test
app.get('/api/analytics/test/:id', (req, res) => {
  try {
    const { tests } = readTests();
    const { submissions } = readSubs();
    const test = tests.find(t => t.id === req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });
    const sub = submissions.find(s => s.testId === test.id && s.submittedAt);
    const detail = test.questions.map(q => {
      const ans = sub ? sub.answers.find(a => a.questionId === q.id) : null;
      return {
        id: q.id,
        text: q.text,
        options: q.options,
        correctIndex: q.correctIndex,
        topic: q.topic,
        selectedIndex: ans ? ans.selectedIndex : null,
        correct: ans ? ans.correct : false,
        answeredAt: ans ? ans.answeredAt : null
      };
    });
    res.json({ test: { id: test.id, title: test.title, timerMinutes: test.timerMinutes }, submission: sub, detail });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load test detail' });
  }
});

// GET /api/topics — Distinct list of all topics used
app.get('/api/topics', (req, res) => {
  try {
    const { tests } = readTests();
    const topicSet = new Set();
    tests.forEach(t => t.questions.forEach(q => {
      if (q.topic) topicSet.add(q.topic);
    }));
    res.json([...topicSet].sort());
  } catch (e) {
    res.status(500).json({ error: 'Failed to read topics' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// LEGACY SHIMS (backward compat)
// ══════════════════════════════════════════════════════════════════════════

// Old GET /api/questions — returns questions of current test
app.get('/api/questions', (req, res) => {
  try {
    const { tests } = readTests();
    const current = tests.find(t => t.status === 'published' || t.status === 'active');
    if (!current) return res.json([]);
    const { submissions } = readSubs();
    const sub = submissions.find(s => s.testId === current.id && !s.submittedAt);
    res.json(current.questions.map(q => ({
      id: q.id,
      text: q.text,
      options: q.options,
      correctAnswer: q.correctIndex,
      answer: sub ? (sub.answers.find(a => a.questionId === q.id)?.selectedIndex ?? null) : null
    })));
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

// Old POST /api/questions (admin publish) — kept for old admin.js
app.post('/api/questions', (req, res) => {
  const { questions, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  const db = readTests();
  // Archive current
  db.tests.forEach(t => { if (t.status === 'published' || t.status === 'active') t.status = 'archived'; });
  const newTest = {
    id: newId('test'),
    title: 'Daily Quiz',
    createdAt: new Date().toISOString(),
    timerMinutes: 15,
    status: 'published',
    questions: questions.map((q, i) => ({
      id: `q${i + 1}`,
      text: q.text,
      options: q.options,
      correctIndex: q.correctAnswer,
      topic: 'General'
    }))
  };
  db.tests.push(newTest);
  writeTests(db);
  res.json({ success: true });
});

// Old POST /api/answer — delegates to new system
app.post('/api/answer', (req, res) => {
  const { questionId, answerIndex } = req.body;
  const { tests } = readTests();
  const current = tests.find(t => t.status === 'active');
  if (!current) return res.status(404).json({ error: 'No active test' });
  const question = current.questions.find(q => String(q.id) === String(questionId));
  if (!question) return res.status(404).json({ error: 'Question not found' });
  const correct = question.correctIndex === answerIndex;
  const subsDb = readSubs();
  let sub = subsDb.submissions.find(s => s.testId === current.id && !s.submittedAt);
  if (!sub) {
    sub = { testId: current.id, startedAt: new Date().toISOString(), submittedAt: null, timeTakenSeconds: null, answers: [], score: null, totalQuestions: current.questions.length };
    subsDb.submissions.push(sub);
  }
  sub.answers = sub.answers.filter(a => a.questionId !== String(questionId));
  sub.answers.push({ questionId: String(questionId), selectedIndex: answerIndex, correct, answeredAt: new Date().toISOString() });
  writeSubs(subsDb);
  res.json({ success: true, answer: answerIndex });
});

// ─── Start Server / Export for Vercel ─────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ TestFlow server running at http://localhost:${PORT}`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`📈 Analytics: http://localhost:${PORT}/analytics.html`);
  });
}

module.exports = app;
