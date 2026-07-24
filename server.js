const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

const dataFile = path.join(__dirname, 'data.json');

// Initialize data.json if it doesn't exist
if (!fs.existsSync(dataFile)) {
  const initialData = { questions: [] };
  for (let i = 1; i <= 10; i++) {
    initialData.questions.push({
      id: i,
      text: `Question ${i}`,
      options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
      correctAnswer: 0,
      answer: null
    });
  }
  fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2));
}

// Get current questions
app.get('/api/questions', (req, res) => {
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  res.json(data.questions);
});

// Admin: Update questions
app.post('/api/questions', (req, res) => {
  const { questions, password } = req.body;
  if (password !== 'admin123') { // Simple hardcoded password
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const data = { questions: questions.map(q => ({
    id: q.id,
    text: q.text,
    options: q.options,
    correctAnswer: q.correctAnswer,
    answer: null // Reset answers when new questions are published
  }))};
  
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  res.json({ success: true });
});

// Participant: Submit answer
app.post('/api/answer', (req, res) => {
  const { questionId, answerIndex } = req.body;
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const question = data.questions.find(q => q.id === questionId);
  
  if (question) {
    question.answer = answerIndex;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    res.json({ success: true, answer: answerIndex });
  } else {
    res.status(404).json({ error: 'Question not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Admin panel at http://localhost:${PORT}/admin.html`);
});
