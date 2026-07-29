require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── File Paths (Local Backup Fallback) ─────────────────────────────────────
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

function readTestsFromFile() {
  ensureDbFiles();
  return JSON.parse(fs.readFileSync(TESTS_FILE, 'utf8'));
}
function writeTestsToFile(data) {
  ensureDbFiles();
  try { fs.writeFileSync(TESTS_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}
function readSubsFromFile() {
  ensureDbFiles();
  return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
}
function writeSubsToFile(data) {
  ensureDbFiles();
  try { fs.writeFileSync(SUBS_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

// ─── Supabase Integration ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
let supabase = null;
let isSeeded = false;

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('your-project-id')) {
    return null;
  }
  if (!supabase) {
    try {
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false },
        realtime: { transport: ws }
      });
      console.log('⚡ Initialized Supabase Client!');
    } catch (e) {
      console.error('Failed to create Supabase client:', e.message);
      return null;
    }
  }
  return supabase;
}

async function seedCloudDb(client) {
  // Seeding from local files disabled; all data managed in Cloud (Supabase)
  isSeeded = true;
}

async function readTests() {
  const client = getSupabaseClient();
  if (client) {
    try {
      await seedCloudDb(client);
      const { data, error } = await client.from('tests').select('*');
      if (!error && data) {
        const tests = data.map(t => ({
          id: t.id,
          title: t.title,
          createdAt: t.created_at,
          timerMinutes: t.timer_minutes,
          status: t.status,
          questions: t.questions || []
        }));
        return { tests };
      }
    } catch (e) {
      console.error('⚠️ Supabase readTests error, falling back to local files:', e.message);
    }
  }
  return readTestsFromFile();
}

async function writeTests(data) {
  writeTestsToFile(data);
  const client = getSupabaseClient();
  if (client && data.tests) {
    try {
      const formatted = data.tests.map(t => ({
        id: t.id,
        title: t.title,
        created_at: t.createdAt || new Date().toISOString(),
        timer_minutes: t.timerMinutes || 15,
        status: t.status || 'draft',
        questions: t.questions || []
      }));
      const { error } = await client.from('tests').upsert(formatted);
      if (error) console.error('Supabase writeTests error:', error.message);
    } catch (e) {
      console.error('Failed to write tests to Supabase:', e.message);
    }
  }
}

async function readSubs() {
  const client = getSupabaseClient();
  if (client) {
    try {
      await seedCloudDb(client);
      const { data, error } = await client.from('submissions').select('*');
      if (!error && data) {
        const submissions = data.map(s => ({
          id: s.id,
          testId: s.test_id,
          startedAt: s.started_at,
          submittedAt: s.submitted_at,
          timeTakenSeconds: s.time_taken_seconds,
          score: s.score,
          totalQuestions: s.total_questions,
          answers: s.answers || []
        }));
        return { submissions };
      }
    } catch (e) {
      console.error('⚠️ Supabase readSubs error, falling back to local files:', e.message);
    }
  }
  return readSubsFromFile();
}

async function writeSubs(data) {
  writeSubsToFile(data);
  const client = getSupabaseClient();
  if (client && data.submissions) {
    try {
      const formatted = data.submissions.map(s => ({
        id: s.id || `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        test_id: s.testId,
        started_at: s.startedAt,
        submitted_at: s.submittedAt,
        time_taken_seconds: s.timeTakenSeconds,
        score: s.score,
        total_questions: s.totalQuestions,
        answers: s.answers || []
      }));
      const { error } = await client.from('submissions').upsert(formatted);
      if (error) console.error('Supabase writeSubs error:', error.message);
    } catch (e) {
      console.error('Failed to write submissions to Supabase:', e.message);
    }
  }
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
app.get('/api/tests/current', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const { tests } = await readTests();
    const current = tests.find(t => t.status === 'published' || t.status === 'active');
    res.json(current || null);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read tests' });
  }
});

// GET /api/tests — List all tests (admin)
app.get('/api/tests', async (req, res) => {
  try {
    const { tests } = await readTests();
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
app.get('/api/tests/:id', async (req, res) => {
  try {
    const { tests } = await readTests();
    const test = tests.find(t => t.id === req.params.id);
    if (!test) return res.status(404).json({ error: 'Test not found' });
    res.json(test);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read test' });
  }
});

// POST /api/tests — Create new draft test
app.post('/api/tests', requireAdmin, async (req, res) => {
  try {
    const { title, timerMinutes, questions } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const db = await readTests();
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
    await writeTests(db);
    res.json({ success: true, test: newTest });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create test' });
  }
});

// PUT /api/tests/:id — Edit a draft test
app.put('/api/tests/:id', requireAdmin, async (req, res) => {
  try {
    const db = await readTests();
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

    await writeTests(db);
    res.json({ success: true, test: db.tests[idx] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update test' });
  }
});

// POST /api/tests/:id/publish — Publish test; archive others
app.post('/api/tests/:id/publish', requireAdmin, async (req, res) => {
  try {
    const db = await readTests();
    const idx = db.tests.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Test not found' });

    db.tests.forEach((t, i) => {
      if (i !== idx && (t.status === 'published' || t.status === 'active')) {
        db.tests[i].status = 'archived';
      }
    });

    db.tests[idx].status = 'published';
    await writeTests(db);
    res.json({ success: true, test: db.tests[idx] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to publish test' });
  }
});

// POST /api/tests/:id/archive — Archive a test
app.post('/api/tests/:id/archive', requireAdmin, async (req, res) => {
  try {
    const db = await readTests();
    const idx = db.tests.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Test not found' });
    db.tests[idx].status = 'archived';
    await writeTests(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to archive test' });
  }
});

// POST /api/tests/upload-csv — Parse + validate CSV
app.post('/api/tests/upload-csv', requireAdmin, async (req, res) => {
  try {
    const { csvText } = req.body;
    if (!csvText) return res.status(400).json({ error: 'No CSV text provided' });

    const { tests } = await readTests();
    const existingTopics = new Set();
    tests.forEach(t => t.questions.forEach(q => {
      if (q.topic) existingTopics.add(q.topic.toLowerCase().trim());
    }));

    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

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

// POST /api/submissions — Start a submission
app.post('/api/submissions', async (req, res) => {
  try {
    const db = await readTests();
    const current = db.tests.find(t => t.status === 'published' || t.status === 'active');
    if (!current) return res.status(404).json({ error: 'No active test found' });

    current.status = 'active';
    await writeTests(db);

    const submission = {
      id: newId('sub'),
      testId: current.id,
      startedAt: new Date().toISOString(),
      submittedAt: null,
      timeTakenSeconds: null,
      answers: [],
      score: null,
      totalQuestions: current.questions.length
    };

    // Write directly to Supabase as a new row (no read-modify-write)
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client.from('submissions').insert({
        id: submission.id,
        test_id: submission.testId,
        started_at: submission.startedAt,
        submitted_at: null,
        time_taken_seconds: null,
        score: null,
        total_questions: submission.totalQuestions,
        answers: []
      });
      if (error) console.error('Supabase insert submission error:', error.message);
    } else {
      // Fallback to file
      const subsDb = await readSubs();
      subsDb.submissions = subsDb.submissions.filter(s => !(s.testId === current.id && !s.submittedAt));
      subsDb.submissions.push(submission);
      writeSubsToFile(subsDb);
    }

    res.json({ success: true, testId: current.id, submission });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to start submission' });
  }
});

// POST /api/submissions/:testId/answer — Record one answer
app.post('/api/submissions/:testId/answer', async (req, res) => {
  try {
    const { testId } = req.params;
    const { questionId, selectedIndex, submissionId } = req.body;

    const db = await readTests();
    const test = db.tests.find(t => t.id === testId);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const question = test.questions.find(q => q.id === questionId);
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const correct = question.correctIndex === selectedIndex;
    const newAnswer = { questionId, selectedIndex, correct, answeredAt: new Date().toISOString() };

    const client = getSupabaseClient();
    if (client) {
      // Find the active (unsubmitted) submission for this test directly in Supabase
      const query = submissionId
        ? client.from('submissions').select('*').eq('id', submissionId).is('submitted_at', null)
        : client.from('submissions').select('*').eq('test_id', testId).is('submitted_at', null).order('started_at', { ascending: false }).limit(1);

      const { data: rows, error: fetchErr } = await query;
      if (fetchErr || !rows || rows.length === 0) return res.status(404).json({ error: 'No active submission found' });

      const row = rows[0];
      const updatedAnswers = (row.answers || []).filter(a => a.questionId !== questionId);
      updatedAnswers.push(newAnswer);

      const { error: updateErr } = await client.from('submissions').update({ answers: updatedAnswers }).eq('id', row.id);
      if (updateErr) console.error('Supabase answer update error:', updateErr.message);
    } else {
      // Fallback to file
      const subsDb = readSubsFromFile();
      const sub = subsDb.submissions.find(s => s.testId === testId && !s.submittedAt);
      if (!sub) return res.status(404).json({ error: 'No active submission found' });
      sub.answers = (sub.answers || []).filter(a => a.questionId !== questionId);
      sub.answers.push(newAnswer);
      writeSubsToFile(subsDb);
    }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to record answer' });
  }
});

// POST /api/submissions/:testId/submit — Finalize submission
app.post('/api/submissions/:testId/submit', async (req, res) => {
  try {
    const { testId } = req.params;
    const { submissionId } = req.body;

    const db = await readTests();
    const test = db.tests.find(t => t.id === testId);
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const client = getSupabaseClient();
    let sub = null;

    if (client) {
      // Find the specific in-progress submission directly from Supabase
      const query = submissionId
        ? client.from('submissions').select('*').eq('id', submissionId).is('submitted_at', null)
        : client.from('submissions').select('*').eq('test_id', testId).is('submitted_at', null).order('started_at', { ascending: false }).limit(1);

      const { data: rows, error: fetchErr } = await query;
      if (fetchErr || !rows || rows.length === 0) return res.status(404).json({ error: 'No active submission found' });

      const row = rows[0];
      const now = new Date();
      const timeTakenSeconds = Math.round((now - new Date(row.started_at)) / 1000);
      const score = (row.answers || []).filter(a => a.correct).length;
      const totalQuestions = test.questions.length;

      const { error: updateErr } = await client.from('submissions').update({
        submitted_at: now.toISOString(),
        time_taken_seconds: timeTakenSeconds,
        score,
        total_questions: totalQuestions
      }).eq('id', row.id);

      if (updateErr) {
        console.error('Supabase submit error:', updateErr.message);
        return res.status(500).json({ error: 'Failed to submit' });
      }

      sub = { answers: row.answers || [], timeTakenSeconds, totalQuestions };
    } else {
      // Fallback to file
      const subsDb = readSubsFromFile();
      const fileSub = subsDb.submissions.find(s => s.testId === testId && !s.submittedAt);
      if (!fileSub) return res.status(404).json({ error: 'No active submission found' });
      const now = new Date();
      fileSub.submittedAt = now.toISOString();
      fileSub.timeTakenSeconds = Math.round((now - new Date(fileSub.startedAt)) / 1000);
      fileSub.score = (fileSub.answers || []).filter(a => a.correct).length;
      fileSub.totalQuestions = test.questions.length;
      writeSubsToFile(subsDb);
      sub = fileSub;
    }

    // Mark test as completed so it is no longer available to attempt until re-published by admin
    test.status = 'completed';
    await writeTests(db);

    res.json({
      success: true,
      totalQuestions: sub.totalQuestions,
      answeredCount: sub.answers.length,
      timeTakenSeconds: sub.timeTakenSeconds,
      message: 'Test submitted successfully. Marks are visible only to the admin/teacher.'
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
app.get('/api/analytics/history', async (req, res) => {
  try {
    const { tests } = await readTests();
    const { submissions } = await readSubs();

    const completedSubs = (submissions || []).filter(s => s && s.submittedAt);
    const completedSubsAsc = [...completedSubs].sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));

    const testAttemptCounts = {};
    const subAttemptMap = {};

    completedSubsAsc.forEach(sub => {
      const key = sub.id || sub.startedAt;
      testAttemptCounts[sub.testId] = (testAttemptCounts[sub.testId] || 0) + 1;
      subAttemptMap[key] = testAttemptCounts[sub.testId];
    });

    // Score trend (every attempt in chronological order)
    const scoreTrend = completedSubsAsc.map((sub, i) => {
      const t = tests.find(test => test.id === sub.testId);
      const totalQ = sub.totalQuestions || (t ? t.questions.length : 0);
      const score = sub.score !== null ? sub.score : 0;
      const attemptNum = subAttemptMap[sub.id || sub.startedAt] || 1;
      return {
        submissionId: sub.id || `${sub.testId}_${i}`,
        testId: sub.testId,
        title: t ? t.title : 'Quiz',
        attemptNumber: attemptNum,
        date: sub.submittedAt,
        score: score,
        totalQuestions: totalQ,
        scorePct: totalQ > 0 ? Math.round((score / totalQ) * 100) : 0
      };
    });

    // Topic accuracy across all completed attempts
    const topicStats = {};
    completedSubs.forEach(sub => {
      const t = tests.find(test => test.id === sub.testId);
      if (!t) return;
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
      accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0
    })).sort((a, b) => a.accuracy - b.accuracy);

    // Time analysis across all attempts
    const timeStats = { totalAnswers: 0, totalTime: 0, perQuestion: {} };
    completedSubs.forEach(sub => {
      const t = tests.find(test => test.id === sub.testId);
      if (!t) return;
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

    // Test history table (every attempt listed, newest first)
    const history = completedSubs.map((sub, i) => {
      const t = tests.find(test => test.id === sub.testId);
      const totalQ = sub.totalQuestions || (t ? t.questions.length : 0);
      const score = sub.score !== null ? sub.score : 0;
      const rowId = sub.id || `${sub.testId}__${(sub.startedAt || '').replace(/[^0-9]/g, '')}`;
      const attemptNum = subAttemptMap[sub.id || sub.startedAt] || 1;
      return {
        id: rowId,
        testId: sub.testId,
        title: t ? t.title : 'Quiz',
        attemptNumber: attemptNum,
        date: sub.submittedAt,
        score: score,
        totalQuestions: totalQ,
        scorePct: totalQ > 0 ? Math.round((score / totalQ) * 100) : 0,
        timeTakenSeconds: sub.timeTakenSeconds
      };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    // Active test status
    const activeTest = tests.find(t => t.status === 'active' || t.status === 'published');
    let currentStatus = null;
    if (activeTest) {
      const activeSub = submissions.find(s => s.testId === activeTest.id && !s.submittedAt);
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

// GET /api/analytics/test/:id — Detailed breakdown for one submission or test
app.get('/api/analytics/test/:id', async (req, res) => {
  try {
    const { tests } = await readTests();
    const { submissions } = await readSubs();

    const paramId = req.params.id;
    let sub = null;

    // 1. Try exact match on submission's own unique id
    sub = submissions.find(s => s.id === paramId && s.submittedAt);

    // 2. If not found by submission id, try the legacy startedAt-derived key
    if (!sub) {
      sub = submissions.find(s => {
        const derivedKey = `${s.testId}__${(s.startedAt || '').replace(/[^0-9]/g, '')}`;
        return derivedKey === paramId && s.submittedAt;
      });
    }

    // 3. Last resort: if paramId looks like a testId, get the MOST RECENT completed submission for that test
    if (!sub) {
      const candidates = submissions
        .filter(s => s.testId === paramId && s.submittedAt)
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
      sub = candidates[0] || null;
    }

    const test = tests.find(t => t.id === (sub ? sub.testId : paramId));
    if (!test) return res.status(404).json({ error: 'Test not found' });

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
app.get('/api/topics', async (req, res) => {
  try {
    const { tests } = await readTests();
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
// LEGACY SHIMS
// ══════════════════════════════════════════════════════════════════════════

app.get('/api/questions', async (req, res) => {
  try {
    const { tests } = await readTests();
    const current = tests.find(t => t.status === 'published' || t.status === 'active');
    if (!current) return res.json([]);
    const { submissions } = await readSubs();
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

app.post('/api/questions', async (req, res) => {
  const { questions, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  const db = await readTests();
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
  await writeTests(db);
  res.json({ success: true });
});

app.post('/api/answer', async (req, res) => {
  const { questionId, answerIndex } = req.body;
  const { tests } = await readTests();
  const current = tests.find(t => t.status === 'active');
  if (!current) return res.status(404).json({ error: 'No active test' });
  const question = current.questions.find(q => String(q.id) === String(questionId));
  if (!question) return res.status(404).json({ error: 'Question not found' });
  const correct = question.correctIndex === answerIndex;
  const subsDb = await readSubs();
  let sub = subsDb.submissions.find(s => s.testId === current.id && !s.submittedAt);
  if (!sub) {
    sub = { testId: current.id, startedAt: new Date().toISOString(), submittedAt: null, timeTakenSeconds: null, answers: [], score: null, totalQuestions: current.questions.length };
    subsDb.submissions.push(sub);
  }
  sub.answers = sub.answers.filter(a => a.questionId !== String(questionId));
  sub.answers.push({ questionId: String(questionId), selectedIndex: answerIndex, correct, answeredAt: new Date().toISOString() });
  await writeSubs(subsDb);
  res.json({ success: true, answer: answerIndex });
});

// ─── Start Server / Export for Vercel ─────────────────────────────────────
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`✅ TestFlow server running at http://localhost:${PORT}`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`📈 Analytics: http://localhost:${PORT}/analytics.html`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const fallbackPort = Number(PORT) + 1;
      console.log(`⚠️ Port ${PORT} is busy, switching to http://localhost:${fallbackPort}...`);
      app.listen(fallbackPort, () => {
        console.log(`✅ TestFlow server running at http://localhost:${fallbackPort}`);
        console.log(`📊 Admin panel: http://localhost:${fallbackPort}/admin.html`);
        console.log(`📈 Analytics: http://localhost:${fallbackPort}/analytics.html`);
      });
    } else {
      console.error(err);
    }
  });
}

module.exports = app;
