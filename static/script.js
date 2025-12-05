const CLUE_KEYS = [
  "1_date",
  "2_geo_domain",
  "3_vague_headline",
  "4_redacted_headline",
  "5_almost_full_headline",
];

let mode = "classic";
let theme = "Global";
let eventQueue = [];

let currentEvent = null;
let currentClue = 1;
let points = 0;
let streak = 0;
let bestStreak = 0;
let hearts = 3;
let roundResolved = false;
let gameOver = false;

// timer
let timeLeft = 30;
let timerId = null;

const STORAGE_KEYS = ["hist_points", "hist_streak", "hist_best_streak"];

document.addEventListener("DOMContentLoaded", () => {
  modeSelect = document.getElementById("mode-select");
  themeSelect = document.getElementById("theme-select");
  startButton = document.getElementById("start-button");
  nextButton = document.getElementById("next-button");
  guessForm = document.getElementById("guess-form");
  guessInput = document.getElementById("guess-input");
  cluePanel = document.getElementById("clue-panel");
  pointsSpan = document.getElementById("points-value");
  streakSpan = document.getElementById("streak-value");
  bestStreakSpan = document.getElementById("best-streak-value");
  messageBox = document.getElementById("message");
  heartsContainer = document.getElementById("hearts-container");
  gameOverBox = document.getElementById("game-over");
  finalScoreSpan = document.getElementById("final-score");
  finalBestSpan = document.getElementById("final-best-streak");
  homeButton = document.getElementById("home-button");
  timerWrapper = document.getElementById("timer-wrapper");
  timerValueSpan = document.getElementById("timer-value");
  timerFill = document.getElementById("timer-fill");

  clearPersistentStats();
  resetState();

  modeSelect.addEventListener("change", () => (mode = modeSelect.value));
  themeSelect.addEventListener("change", () => (theme = themeSelect.value));

  startButton.addEventListener("click", () => loadNewEvent());
  nextButton.addEventListener("click", () => loadNewEvent());
  homeButton.addEventListener("click", goHome);

  guessForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!guessInput.value.trim() || !currentEvent || roundResolved) return;
    submitGuess(guessInput.value.trim());
    guessInput.value = "";
  });

  document.getElementById("restart-button").addEventListener("click", restart);

  mode = modeSelect.value;
  theme = themeSelect.value;
});

// ---------- UI ----------
function updateStats() {
  pointsSpan.textContent = points;
  streakSpan.textContent = streak;
  bestStreakSpan.textContent = bestStreak;
}

function updateHearts() {
  if (mode === "zen") {
    heartsContainer.textContent = "∞";
    return;
  }
  heartsContainer.innerHTML = [...Array(3)]
    .map((_, i) => (i < hearts ? "♥" : "♡"))
    .join(" ");
}

function clueUI() {
  const boxes = cluePanel.querySelectorAll(".clue-box");
  boxes.forEach((b) => {
    const idx = parseInt(b.getAttribute("data-clue"), 10);
    const t = b.querySelector(".clue-text");
    b.classList.remove("current", "hidden");

    if (idx < currentClue) t.textContent = currentEvent.clues[CLUE_KEYS[idx - 1]];
    else if (idx === currentClue) {
      t.textContent = currentEvent.clues[CLUE_KEYS[idx - 1]];
      b.classList.add("current");
    } else {
      t.textContent = "Locked";
      b.classList.add("hidden");
    }
  });
}

function showMessage(msg) {
  messageBox.textContent = msg;
}

// ---------- Timer ----------
function startTimer() {
  stopTimer();
  timerWrapper.style.display = "flex";
  timeLeft = 30;
  updateTimerUI();
  timerId = setInterval(() => {
    timeLeft--;
    updateTimerUI();
    if (timeLeft <= 0) timeoutFail();
  }, 1000);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  timerWrapper.style.display = "none";
}

function updateTimerUI() {
  timerValueSpan.textContent = timeLeft;
  timerFill.style.width = `${(timeLeft / 30) * 100}%`;
}

// ---------- Persistence ----------
function saveStats() {
  // Stats are no longer persisted across reloads to ensure a fresh session.
}

function clearPersistentStats() {
  STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
}

// ---------- Game ----------
function loadNewEvent() {
  if (gameOver) return;

  clearMsg();
  roundResolved = false;
  currentClue = 1;
  nextButton.style.display = "none";
  startButton.style.display = "none";
  cluePanel.style.display = "none";
  guessForm.style.display = "none";
  themeSelect.disabled = true;

  if (eventQueue.length === 0) {
    fetch("/api/batch_events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme, amount: 3 }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return showMessage("❌ Error loading events.");
        eventQueue = shuffleArray(d.events);
        beginEvent();
      });
  } else beginEvent();
}

function beginEvent() {
  currentEvent = eventQueue.shift();
  clueUI();
  cluePanel.style.display = "grid";
  guessForm.style.display = "flex";
  homeButton.style.display = "inline";

  if (mode === "timed") startTimer();
}

function submitGuess(g) {
  fetch("/api/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guess: g,
      event: currentEvent,
      clue_number: currentClue,
    }),
  })
    .then((r) => r.json())
    .then((d) => {
      if (!d.ok) return showMessage("❌ Error checking guess.");

      if (d.correct) correctAnswer(d.score);
      else wrongAnswer();
    });
}

function correctAnswer(score) {
  roundResolved = true;
  stopTimer();
  showMessage(`✅ Correct! +${score} points`);
  points += score;
  streak++;
  bestStreak = Math.max(bestStreak, streak);
  updateStats();
  saveStats();
  themeSelect.disabled = false;
  nextButton.style.display = "inline-block";
}

function wrongAnswer() {
  if (currentClue < 5) {
    currentClue++;
    clueUI();
    showMessage("❌ Incorrect — next clue unlocked.");
  } else {
    roundResolved = true;
    stopTimer();
    showMessage(`❌ Out of clues! The event was: ${currentEvent.event_title}`);
    streak = 0;
    if (mode !== "zen") {
      hearts--;
      updateHearts();
      if (hearts === 0) return endGame();
    }
    updateStats();
    saveStats();
    themeSelect.disabled = false;
    nextButton.style.display = "inline-block";
  }
}

function timeoutFail() {
  if (roundResolved || gameOver) return;
  wrongAnswer();
  showMessage("⏰ Time's up!");
}

function endGame() {
  gameOver = true;
  stopTimer();
  guessForm.style.display = "none";
  cluePanel.style.display = "none";
  nextButton.style.display = "none";
  startButton.style.display = "none";
  themeSelect.disabled = false;
  homeButton.style.display = "none";
  finalScoreSpan.textContent = points;
  finalBestSpan.textContent = bestStreak;
  gameOverBox.style.display = "block";
}

function restart() {
  resetState();
  gameOverBox.style.display = "none";
  startButton.style.display = "inline-block";
  themeSelect.disabled = false;
}

function goHome() {
  resetState();
  startButton.style.display = "inline-block";
  themeSelect.disabled = false;
}

function clearMsg() {
  messageBox.textContent = "";
}

function resetState() {
  stopTimer();
  clearMsg();

  eventQueue = [];
  currentEvent = null;
  currentClue = 1;
  roundResolved = false;
  gameOver = false;
  timeLeft = 30;

  points = 0;
  streak = 0;
  bestStreak = 0;
  hearts = 3;
  updateStats();
  updateHearts();

  guessForm.style.display = "none";
  cluePanel.style.display = "none";
  nextButton.style.display = "none";
  homeButton.style.display = "none";
  timerWrapper.style.display = "none";
  themeSelect.disabled = false;
}

function shuffleArray(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}
