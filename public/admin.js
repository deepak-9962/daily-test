document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('password-modal');
  const loginBtn = document.getElementById('login-btn');
  const pwdInput = document.getElementById('admin-pwd');
  const adminContainer = document.getElementById('admin-container');
  const questionsContainer = document.getElementById('admin-questions');
  const saveBtn = document.getElementById('save-btn');
  
  let currentPassword = '';

  loginBtn.addEventListener('click', () => {
    if (pwdInput.value) {
      currentPassword = pwdInput.value;
      modal.style.display = 'none';
      adminContainer.style.display = 'block';
      loadQuestions();
    }
  });
  
  pwdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  function loadQuestions() {
    fetch('/api/questions')
      .then(res => res.json())
      .then(questions => {
        questionsContainer.innerHTML = '';
        
        let score = 0;
        let answeredCount = 0;

        questions.forEach((q, index) => {
          if (q.answer !== null) {
            answeredCount++;
            if (q.answer === q.correctAnswer) {
              score++;
            }
          }
        });

        // Show score summary
        const scoreDiv = document.createElement('div');
        scoreDiv.style.marginBottom = '2rem';
        scoreDiv.style.padding = '1.5rem';
        scoreDiv.style.background = 'rgba(255,255,255,0.05)';
        scoreDiv.style.borderRadius = '12px';
        scoreDiv.style.border = '1px solid var(--glass-border)';
        scoreDiv.style.textAlign = 'center';
        
        if (answeredCount > 0) {
          scoreDiv.innerHTML = `<h2 style="color: var(--accent); margin-bottom: 0.5rem;">Current Score: ${score}/${answeredCount}</h2>
                                <p style="color: var(--text-muted);">(They have answered ${answeredCount} out of 10 questions)</p>`;
        } else {
          scoreDiv.innerHTML = `<h2 style="color: var(--text-muted);">No questions answered yet.</h2>`;
        }
        questionsContainer.appendChild(scoreDiv);
        
        questions.forEach((q, index) => {
          const card = document.createElement('div');
          card.className = 'card';
          card.dataset.qid = q.id;
          
          let optionsHtml = '';
          q.options.forEach((opt, optIndex) => {
            const letters = ['A', 'B', 'C', 'D'];
            const isCorrect = q.correctAnswer === optIndex;
            optionsHtml += `
              <div class="admin-option-wrapper" style="display:flex; align-items:center; gap:10px;">
                <input type="radio" name="correct-${q.id}" value="${optIndex}" ${isCorrect ? 'checked' : ''} title="Mark as correct answer" style="width:20px; height:20px; cursor:pointer; accent-color: var(--success);">
                <span style="border-radius: 8px 0 0 8px;">${letters[optIndex]}</span>
                <input type="text" class="admin-option-input" value="${opt}" data-optindex="${optIndex}">
              </div>
            `;
          });

          let statusHtml = '<span style="color:var(--text-muted); font-size:0.9rem;">Not answered yet</span>';
          if (q.answer !== null) {
            const isRight = q.answer === q.correctAnswer;
            statusHtml = `<span style="color: ${isRight ? 'var(--success)' : '#ef4444'}; font-size:0.9rem; font-weight:bold;">
              ${isRight ? '✅ Correct' : '❌ Wrong'} (They picked ${String.fromCharCode(65 + q.answer)})
            </span>`;
          }

          card.innerHTML = `
            <div style="color:var(--accent); font-weight:bold; margin-bottom:0.5rem; display:flex; justify-content:space-between; align-items:center;">
              Question ${index + 1}
              ${statusHtml}
            </div>
            <input type="text" class="admin-input q-text" value="${q.text}" placeholder="Enter question text here...">
            <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem;">Select the radio button next to the correct answer:</div>
            <div class="options-edit">
              ${optionsHtml}
            </div>
          `;
          questionsContainer.appendChild(card);
        });
      });
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.innerText = 'Publishing...';
    saveBtn.disabled = true;

    const cards = document.querySelectorAll('#admin-questions .card');
    const updatedQuestions = [];

    cards.forEach(card => {
      const qId = parseInt(card.dataset.qid);
      const text = card.querySelector('.q-text').value;
      
      const options = [];
      card.querySelectorAll('.admin-option-input').forEach(input => {
        options.push(input.value);
      });
      
      let correctAnswer = 0;
      const radio = card.querySelector(`input[name="correct-${qId}"]:checked`);
      if (radio) {
        correctAnswer = parseInt(radio.value);
      }

      updatedQuestions.push({ id: qId, text, options, correctAnswer });
    });

    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: currentPassword, questions: updatedQuestions })
      });

      if (res.ok) {
        showToast();
        // Reload to show reset answers status
        loadQuestions();
      } else {
        alert('Unauthorized! Incorrect password.');
        modal.style.display = 'flex';
        adminContainer.style.display = 'none';
        pwdInput.value = '';
      }
    } catch (err) {
      console.error(err);
      alert('Failed to save changes.');
    } finally {
      saveBtn.innerText = 'Publish New Quiz';
      saveBtn.disabled = false;
    }
  });

  function showToast() {
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
});
