document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('questions-container');
  const timerElement = document.getElementById('timer');
  
  // Timer Logic (15 minutes = 900 seconds)
  let timeLeft = 900;
  const timerInterval = setInterval(() => {
    timeLeft--;
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerElement.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    if (timeLeft <= 300) {
       timerElement.style.color = "#ef4444"; // red warning at 5 mins
    }
    
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerElement.innerText = "Time's Up!";
      // Disable all unanswered options
      document.querySelectorAll('.option-btn:not(.answered)').forEach(btn => {
        btn.classList.add('answered');
        btn.disabled = true;
      });
    }
  }, 1000);

  // Fetch questions on load
  fetch('/api/questions')
    .then(res => res.json())
    .then(questions => {
      container.innerHTML = ''; // Clear loading
      
      questions.forEach((q, index) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="question-text"><span style="color:var(--accent)">Q${index + 1}.</span> ${q.text}</div>
          <div class="options-grid" id="options-${q.id}">
            ${q.options.map((opt, optIndex) => `
              <button class="option-btn ${q.answer === optIndex ? 'selected answered' : (q.answer !== null ? 'answered' : '')}" 
                      data-qid="${q.id}" data-optindex="${optIndex}"
                      ${q.answer !== null ? 'disabled' : ''}>
                ${opt}
              </button>
            `).join('')}
          </div>
        `;
        container.appendChild(card);
      });

      // Add event listeners to buttons
      document.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          if (btn.classList.contains('answered')) return; // Already answered
          
          const qId = parseInt(btn.getAttribute('data-qid'));
          const optIndex = parseInt(btn.getAttribute('data-optindex'));
          
          // Optimistic UI update
          const siblings = document.querySelectorAll(`#options-${qId} .option-btn`);
          siblings.forEach(s => {
            s.classList.add('answered');
            s.disabled = true;
          });
          btn.classList.add('selected');

          // Send to server
          try {
            await fetch('/api/answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ questionId: qId, answerIndex: optIndex })
            });
          } catch (err) {
            console.error('Failed to submit answer', err);
            // Revert on error
            siblings.forEach(s => {
              s.classList.remove('answered');
              s.disabled = false;
            });
            btn.classList.remove('selected');
            alert('Failed to submit answer. Please try again.');
          }
        });
      });
    });
});
