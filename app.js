const CATEGORIES = [
  { name: 'Eastern/Central U.S. + Canada', short: 'Eastern/Central U.S. + Canada', subs: ['Northeast & New England','Southeast & Appalachia','Midwest & Great Lakes','Mississippi & Interior','Canada'] },
  { name: 'Western U.S. + Latin America/Caribbean', short: 'Western U.S. + Latin America', subs: ['Pacific Coast','Mountain West & Southwest','Alaska & Hawaii','Mexico, Central America & Caribbean','South America'] },
  { name: 'Europe + Russia', short: 'Europe + Russia', subs: ['British Isles','Western Europe','Southern & Mediterranean Europe','Central & Eastern Europe','Balkans','Russia & Post-Soviet Europe'] },
  { name: 'Africa + Mediterranean', short: 'Africa + Mediterranean', subs: ['North Africa','West Africa','Central Africa','East & Horn of Africa','Southern Africa','African Islands & Mediterranean'] },
  { name: 'Asia + Middle East + Oceania/Pacific', short: 'Asia + Middle East + Pacific', subs: ['East Asia','South Asia','Southeast Asia','Central Asia','Middle East','Australia & New Zealand','Pacific Islands'] }
];

const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const shuffle = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

let QUESTIONS = [];
let state = null;
let lastSetup = null;
let compendiumFiltered = [];
let sessionToken = 0;

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem('geographyBowlProgress')) || { attempts: 0, correct: 0, games: 0, wins: 0, byCategory: {}, missed: [] };
  } catch {
    return { attempts: 0, correct: 0, games: 0, wins: 0, byCategory: {}, missed: [] };
  }
}

function saveProgress(progress) {
  localStorage.setItem('geographyBowlProgress', JSON.stringify(progress));
}

function recordAttempt(question, correct, isHuman = true) {
  if (!isHuman) return;
  const progress = loadProgress();
  progress.attempts += 1;
  if (correct) progress.correct += 1;
  if (!progress.byCategory[question.category]) progress.byCategory[question.category] = { attempts: 0, correct: 0 };
  progress.byCategory[question.category].attempts += 1;
  if (correct) progress.byCategory[question.category].correct += 1;
  const missed = new Set(progress.missed || []);
  if (correct) missed.delete(question.id); else missed.add(question.id);
  progress.missed = [...missed];
  saveProgress(progress);
}

function showView(name) {
  const gameVisible = $('gameView')?.classList.contains('active');
  if (gameVisible && name !== 'game' && state && !state.ended) {
    state.ended = true;
    sessionToken += 1;
    if (state.timerId) clearInterval(state.timerId);
  }
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  const target = $(`${name}View`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  if (name === 'compendium') renderCompendium();
  if (name === 'stats') renderStats();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCategoryGrid() {
  $('categoryGrid').innerHTML = CATEGORIES.map((category, index) => {
    const count = QUESTIONS.filter((q) => q.category === category.name).length;
    return `<button type="button" class="category-card" data-category="${escapeHTML(category.name)}">
      <span class="category-number">PLAYER ${String.fromCharCode(65 + index)}</span>
      <strong>${escapeHTML(category.short)}</strong>
      <small>${category.subs.map(escapeHTML).join(' · ')}</small>
      <small class="category-count">${count} starter questions</small>
    </button>`;
  }).join('');
  document.querySelectorAll('.category-card').forEach((button) => {
    button.addEventListener('click', () => openSetup('practice', button.dataset.category));
  });
}

function categoryOptions(selected = '') {
  return `<option value="all">All main categories</option>${CATEGORIES.map((category) => `<option value="${escapeHTML(category.name)}" ${category.name === selected ? 'selected' : ''}>${escapeHTML(category.name)}</option>`).join('')}`;
}

function subcategoryOptions(categoryName, selected = '') {
  const category = CATEGORIES.find((item) => item.name === categoryName);
  const subs = category ? category.subs : [...new Set(QUESTIONS.map((q) => q.subcategory))].sort();
  return `<option value="all">All subcategories</option>${subs.map((sub) => `<option value="${escapeHTML(sub)}" ${sub === selected ? 'selected' : ''}>${escapeHTML(sub)}</option>`).join('')}`;
}

function aiAccuracy(level) {
  const t = (Number(level) - 1) / 9;
  const curve = (Math.exp(2.4 * t) - 1) / (Math.exp(2.4) - 1);
  return 0.20 + (0.75 * curve);
}

function openSetup(mode, preselectedCategory = '') {
  const dialog = $('setupDialog');
  $('setupKicker').textContent = mode === 'practice' ? 'Untimed review' : mode === 'full' ? '20-minute match' : '20-minute AI match';
  $('setupTitle').textContent = mode === 'practice' ? 'Choose what to practice' : mode === 'full' ? 'Name the two teams' : 'Choose AI difficulty';
  $('confirmSetupButton').textContent = mode === 'practice' ? 'Start practice' : 'Start game';
  $('setupForm').dataset.mode = mode;

  if (mode === 'practice') {
    $('setupFields').innerHTML = `<div class="form-grid">
      <label class="form-field">Main category<select id="setupCategory">${categoryOptions(preselectedCategory)}</select></label>
      <label class="form-field">Subcategory<select id="setupSubcategory">${subcategoryOptions(preselectedCategory || 'all')}</select></label>
      <p class="section-note" id="setupPoolCount" style="text-align:left;margin:0"></p>
    </div>`;
    const updatePracticeFields = () => {
      const category = $('setupCategory').value;
      const currentSub = $('setupSubcategory').value;
      $('setupSubcategory').innerHTML = subcategoryOptions(category, currentSub);
      const sub = $('setupSubcategory').value;
      const count = QUESTIONS.filter((q) => (category === 'all' || q.category === category) && (sub === 'all' || q.subcategory === sub)).length;
      $('setupPoolCount').textContent = `${count} question${count === 1 ? '' : 's'} in this practice pool.`;
    };
    $('setupCategory').addEventListener('change', updatePracticeFields);
    $('setupSubcategory').addEventListener('change', updatePracticeFields);
    updatePracticeFields();
  } else if (mode === 'full') {
    $('setupFields').innerHTML = `<div class="form-grid">
      <label class="form-field">Team A name<input id="teamAInput" maxlength="24" value="Team A"></label>
      <label class="form-field">Team B name<input id="teamBInput" maxlength="24" value="Team B"></label>
      <p class="section-note" style="text-align:left;margin:0">Questions draw from the full compendium. Each team receives two throwouts.</p>
    </div>`;
  } else {
    $('setupFields').innerHTML = `<div class="form-grid">
      <label class="form-field">Your team name<input id="playerTeamInput" maxlength="24" value="Your Team"></label>
      <label class="form-field">AI difficulty
        <div class="range-line"><input id="aiLevelInput" type="range" min="1" max="10" step="1" value="5"><strong class="accuracy-readout" id="aiLevelReadout">5</strong></div>
      </label>
      <p class="section-note" id="aiAccuracyText" style="text-align:left;margin:0"></p>
    </div>`;
    const updateAccuracy = () => {
      const level = Number($('aiLevelInput').value);
      $('aiLevelReadout').textContent = level;
      $('aiAccuracyText').textContent = `Level ${level} answers about ${Math.round(aiAccuracy(level) * 100)}% of questions correctly.`;
    };
    $('aiLevelInput').addEventListener('input', updateAccuracy);
    updateAccuracy();
  }
  dialog.showModal();
}

function getPool(category = 'all', subcategory = 'all') {
  return QUESTIONS.filter((q) => (category === 'all' || q.category === category) && (subcategory === 'all' || q.subcategory === subcategory));
}

function startGame(config) {
  if (!config.pool.length) return;
  if (state?.timerId) clearInterval(state.timerId);
  sessionToken += 1;
  const competitive = config.mode === 'full' || config.mode === 'ai';
  state = {
    ...config,
    competitive,
    queue: shuffle(config.pool),
    scores: [0, 0],
    throwouts: competitive ? [2, 2] : [0, 0],
    turnOwner: 0,
    answeringTeam: 0,
    isSteal: false,
    phase: 'ready',
    questionCount: 0,
    secondsLeft: competitive ? 1200 : null,
    attemptsThisSession: 0,
    correctThisSession: 0,
    timerId: null,
    ended: false
  };
  lastSetup = config;
  configureGameScreen();
  showView('game');
  loadQuestion(false);
  if (competitive) {
    state.timerId = setInterval(() => {
      if (!state || state.ended) return;
      state.secondsLeft -= 1;
      updateClock();
      if (state.secondsLeft <= 0) endGame(true);
    }, 1000);
  }
}

function configureGameScreen() {
  const practice = state.mode === 'practice' || state.mode === 'missed';
  $('gameModeKicker').textContent = practice ? 'Untimed review' : state.mode === 'ai' ? `AI difficulty ${state.aiLevel}` : 'Two-team match';
  $('gameModeTitle').textContent = state.mode === 'practice' ? state.label : state.mode === 'missed' ? 'Missed Questions' : state.mode === 'ai' ? 'AI Challenge' : 'Full Game';
  $('team0Name').textContent = state.teamNames[0];
  $('team1Name').textContent = state.teamNames[1];
  $('team1Card').classList.toggle('hidden', practice);
  $('scoreboard').classList.toggle('practice-scoreboard', practice);
  $('team0Card').querySelector('small').classList.toggle('hidden', practice);
  $('revealButton').classList.toggle('hidden', !practice);
  updateScoreboard();
  updateClock();
}

function updateClock() {
  if (!state || state.secondsLeft === null) {
    $('gameClock').textContent = 'Untimed';
    return;
  }
  const minutes = Math.floor(state.secondsLeft / 60);
  const seconds = state.secondsLeft % 60;
  $('gameClock').textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function updateScoreboard() {
  $('team0Score').textContent = state.scores[0];
  $('team1Score').textContent = state.scores[1];
  $('team0Throwouts').textContent = state.throwouts[0];
  $('team1Throwouts').textContent = state.throwouts[1];
  $('team0Card').classList.toggle('active', state.answeringTeam === 0);
  $('team1Card').classList.toggle('active', state.answeringTeam === 1 && state.competitive);
}

function nextFromQueue() {
  if (!state.queue.length) state.queue = shuffle(state.pool);
  return state.queue.pop();
}

function loadQuestion(changeOwner = true) {
  if (!state || state.ended) return;
  if (changeOwner && state.competitive) state.turnOwner = 1 - state.turnOwner;
  state.answeringTeam = state.turnOwner;
  state.isSteal = false;
  state.phase = 'answering';
  state.current = nextFromQueue();
  state.questionCount += 1;
  $('questionNumber').textContent = `Question ${state.questionCount}`;
  $('regionChip').textContent = state.current.category;
  $('subregionChip').textContent = state.current.subcategory;
  $('topicChip').textContent = state.current.topic;
  $('questionText').textContent = state.current.question;
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';
  $('decisionActions').innerHTML = '';
  $('nextQuestionButton').classList.add('hidden');
  $('answerInput').value = '';
  setAnswerControls();
  updateScoreboard();
  if (state.mode === 'ai' && state.answeringTeam === 1) runAIAnswer();
}

function setAnswerControls() {
  const practice = state.mode === 'practice' || state.mode === 'missed';
  const botTurn = state.mode === 'ai' && state.answeringTeam === 1;
  const canAnswer = state.phase === 'answering' && !botTurn;
  $('answerArea').classList.toggle('hidden', !canAnswer);
  $('answerInput').disabled = !canAnswer;
  $('submitAnswerButton').disabled = !canAnswer;
  $('revealButton').classList.toggle('hidden', !practice || state.phase !== 'answering');
  const canThrow = state.competitive && state.phase === 'answering' && !state.isSteal && !botTurn && state.throwouts[state.turnOwner] > 0;
  $('throwoutButton').classList.toggle('hidden', !canThrow);
  $('turnLabel').textContent = botTurn ? `${state.teamNames[1]} is answering` : state.isSteal ? `${state.teamNames[state.answeringTeam]} can steal` : practice ? 'Practice question' : `${state.teamNames[state.answeringTeam]}'s question`;
  if (canAnswer) setTimeout(() => $('answerInput').focus(), 40);
}

function normalizeAnswer(value) {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(the|a|an)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function answerMatches(input, question) {
  const guess = normalizeAnswer(input);
  if (!guess) return false;
  const accepted = [question.answer, ...(question.aliases || [])].map(normalizeAnswer);
  return accepted.some((answer) => guess === answer || (guess.length >= 5 && answer.length >= 5 && (guess.includes(answer) || answer.includes(guess))));
}

function submitAnswer() {
  if (!state || state.phase !== 'answering') return;
  const value = $('answerInput').value.trim();
  if (!value) {
    $('feedback').textContent = 'Enter an answer first.';
    return;
  }
  const correct = answerMatches(value, state.current);
  const isHuman = !(state.mode === 'ai' && state.answeringTeam === 1);
  if (isHuman) {
    recordAttempt(state.current, correct, true);
    state.attemptsThisSession += 1;
    if (correct) state.correctThisSession += 1;
  }
  if (correct) {
    state.scores[state.answeringTeam] += 1;
    showResolved(`Correct — ${state.current.answer}`, true);
  } else if (!state.competitive) {
    showResolved(`Not quite. The answer is ${state.current.answer}.`, false);
  } else if (state.isSteal) {
    showResolved(`No steal. The answer is ${state.current.answer}.`, false);
  } else {
    offerThrowoutOrSteal();
  }
}

function offerThrowoutOrSteal() {
  state.phase = 'decision';
  $('answerArea').classList.add('hidden');
  $('throwoutButton').classList.add('hidden');
  $('feedback').textContent = 'Incorrect. Decide before the other team receives the question.';
  $('feedback').className = 'feedback wrong';
  const targetName = state.teamNames[1 - state.turnOwner];
  const throwButton = state.throwouts[state.turnOwner] > 0 ? `<button type="button" class="secondary-button" id="decisionThrowout">Use throwout (${state.throwouts[state.turnOwner]} left)</button>` : '';
  $('decisionActions').innerHTML = `${throwButton}<button type="button" class="primary-button" id="decisionSteal">Offer steal to ${escapeHTML(targetName)}</button>`;
  if ($('decisionThrowout')) $('decisionThrowout').addEventListener('click', useThrowout);
  $('decisionSteal').addEventListener('click', beginSteal);
}

function beginSteal() {
  state.answeringTeam = 1 - state.turnOwner;
  state.isSteal = true;
  state.phase = 'answering';
  $('decisionActions').innerHTML = '';
  $('feedback').textContent = `${state.teamNames[state.answeringTeam]} may answer for one point.`;
  $('feedback').className = 'feedback';
  setAnswerControls();
  updateScoreboard();
  if (state.mode === 'ai' && state.answeringTeam === 1) runAIAnswer();
}

function useThrowout() {
  const team = state.turnOwner;
  if (!state || state.throwouts[team] <= 0 || state.isSteal) return;
  state.throwouts[team] -= 1;
  state.phase = 'transition';
  $('decisionActions').innerHTML = '';
  $('answerArea').classList.add('hidden');
  $('throwoutButton').classList.add('hidden');
  $('feedback').textContent = `${state.teamNames[team]} throws out the question. The other team cannot steal.`;
  $('feedback').className = 'feedback';
  updateScoreboard();
  const token = sessionToken;
  setTimeout(() => { if (token === sessionToken && state && !state.ended) loadQuestion(false); }, 650);
}

function runAIAnswer() {
  state.phase = 'thinking';
  setAnswerControls();
  const token = sessionToken;
  const questionId = state.current.id;
  setTimeout(() => {
    if (token !== sessionToken || !state || state.ended || state.current.id !== questionId) return;
    const correct = Math.random() < aiAccuracy(state.aiLevel);
    if (correct) {
      state.scores[1] += 1;
      showResolved(`${state.teamNames[1]} answers correctly: ${state.current.answer}`, true);
      return;
    }
    if (!state.isSteal && state.throwouts[1] > 0) {
      state.throwouts[1] -= 1;
      state.phase = 'transition';
      $('feedback').textContent = `${state.teamNames[1]} misses and uses a throwout. You do not receive a steal.`;
      $('feedback').className = 'feedback wrong';
      updateScoreboard();
      setTimeout(() => { if (token === sessionToken && state && !state.ended) loadQuestion(false); }, 750);
    } else if (!state.isSteal) {
      $('feedback').textContent = `${state.teamNames[1]} misses. Your team can steal.`;
      $('feedback').className = 'feedback wrong';
      beginSteal();
    } else {
      showResolved(`${state.teamNames[1]} misses the steal. The answer is ${state.current.answer}.`, false);
    }
  }, 800);
}

function showResolved(message, correct) {
  state.phase = 'resolved';
  $('feedback').textContent = message;
  $('feedback').className = `feedback ${correct ? 'correct' : 'wrong'}`;
  $('answerArea').classList.add('hidden');
  $('throwoutButton').classList.add('hidden');
  $('revealButton').classList.add('hidden');
  $('decisionActions').innerHTML = '';
  $('nextQuestionButton').classList.remove('hidden');
  updateScoreboard();
}

function revealAnswer() {
  if (!state || state.competitive || state.phase !== 'answering') return;
  showResolved(`Answer: ${state.current.answer}`, false);
}

function endGame(timeExpired = false) {
  if (!state || state.ended) return;
  state.ended = true;
  sessionToken += 1;
  if (state.timerId) clearInterval(state.timerId);
  const progress = loadProgress();
  let title = 'Practice complete';
  let result = `${state.correctThisSession} / ${state.attemptsThisSession}`;
  let detail = state.attemptsThisSession ? `${Math.round((state.correctThisSession / state.attemptsThisSession) * 100)}% accuracy this session` : 'No answers recorded';
  if (state.competitive) {
    progress.games += 1;
    const winner = state.scores[0] === state.scores[1] ? null : state.scores[0] > state.scores[1] ? 0 : 1;
    if (winner === 0) progress.wins += 1;
    saveProgress(progress);
    title = winner === null ? 'The game is tied' : `${state.teamNames[winner]} wins`;
    result = `${state.scores[0]} – ${state.scores[1]}`;
    detail = `${timeExpired ? 'Time expired' : 'Game ended'} after ${state.questionCount} questions`;
  }
  $('endSummary').innerHTML = `<p class="section-kicker">Session result</p><h2>${escapeHTML(title)}</h2><div class="end-score">${escapeHTML(result)}</div><p class="section-note" style="text-align:center;margin:0 auto">${escapeHTML(detail)}</p>`;
  $('endDialog').showModal();
}

function renderCompendium() {
  if (!$('compendiumCategory').options.length) {
    $('compendiumCategory').innerHTML = categoryOptions();
    $('compendiumSubcategory').innerHTML = subcategoryOptions('all');
  }
  const search = normalizeAnswer($('compendiumSearch').value);
  const category = $('compendiumCategory').value || 'all';
  const subcategory = $('compendiumSubcategory').value || 'all';
  compendiumFiltered = QUESTIONS.filter((q) => {
    const categoryMatch = category === 'all' || q.category === category;
    const subMatch = subcategory === 'all' || q.subcategory === subcategory;
    const haystack = normalizeAnswer(`${q.question} ${q.answer} ${q.topic} ${q.category} ${q.subcategory}`);
    return categoryMatch && subMatch && (!search || haystack.includes(search));
  });
  $('compendiumResultCount').textContent = `${compendiumFiltered.length} question${compendiumFiltered.length === 1 ? '' : 's'}`;
  $('compendiumList').innerHTML = compendiumFiltered.map((q) => `<details class="compendium-item">
    <summary><span class="item-meta"><span>${escapeHTML(q.category)}</span><span>${escapeHTML(q.subcategory)}</span><span>${escapeHTML(q.topic)}</span></span>${escapeHTML(q.question)}</summary>
    <p>${escapeHTML(q.answer)}</p>
  </details>`).join('') || '<p class="section-note" style="text-align:left">No questions match these filters.</p>';
}

function renderStats() {
  const progress = loadProgress();
  const accuracy = progress.attempts ? Math.round((progress.correct / progress.attempts) * 100) : 0;
  $('statsSummary').innerHTML = [
    ['Attempts', progress.attempts],
    ['Correct', progress.correct],
    ['Accuracy', `${accuracy}%`],
    ['Games won', `${progress.wins} / ${progress.games}`]
  ].map(([label, value]) => `<div class="stat-card"><strong>${escapeHTML(value)}</strong><span>${escapeHTML(label)}</span></div>`).join('');
  $('statsRegions').innerHTML = CATEGORIES.map((category) => {
    const row = progress.byCategory[category.name] || { attempts: 0, correct: 0 };
    const rate = row.attempts ? Math.round((row.correct / row.attempts) * 100) : 0;
    return `<div class="region-stat"><strong>${escapeHTML(category.short)}</strong><div class="progress-track"><div class="progress-fill" style="width:${rate}%"></div></div><span>${rate}% · ${row.attempts}</span></div>`;
  }).join('');
}

function startMissed() {
  const missedIds = new Set(loadProgress().missed || []);
  const pool = QUESTIONS.filter((q) => missedIds.has(q.id));
  if (!pool.length) {
    $('endSummary').innerHTML = '<p class="section-kicker">Missed questions</p><h2>Nothing to review yet</h2><p class="section-note" style="text-align:center;margin:12px auto 0">Questions you miss will appear here automatically.</p>';
    $('playAgainButton').classList.add('hidden');
    $('endDialog').showModal();
    return;
  }
  $('playAgainButton').classList.remove('hidden');
  startGame({ mode: 'missed', pool, label: 'Missed Questions', teamNames: ['Correct', ''] });
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-setup]').forEach((button) => button.addEventListener('click', () => openSetup(button.dataset.setup)));
  $('rulesButton').addEventListener('click', () => $('rulesDialog').showModal());
  $('closeSetupButton').addEventListener('click', () => $('setupDialog').close());
  $('cancelSetupButton').addEventListener('click', () => $('setupDialog').close());
  $('setupForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const mode = $('setupForm').dataset.mode;
    let config;
    if (mode === 'practice') {
      const category = $('setupCategory').value;
      const subcategory = $('setupSubcategory').value;
      const labelParts = [category === 'all' ? 'All Questions' : category];
      if (subcategory !== 'all') labelParts.push(subcategory);
      config = { mode, pool: getPool(category, subcategory), label: labelParts.join(' · '), teamNames: ['Correct', ''] };
    } else if (mode === 'full') {
      config = { mode, pool: QUESTIONS, label: 'Full Game', teamNames: [$('teamAInput').value.trim() || 'Team A', $('teamBInput').value.trim() || 'Team B'] };
    } else {
      const level = Number($('aiLevelInput').value);
      config = { mode, pool: QUESTIONS, label: 'AI Challenge', aiLevel: level, teamNames: [$('playerTeamInput').value.trim() || 'Your Team', `Atlas AI · L${level}`] };
    }
    $('setupDialog').close();
    startGame(config);
  });
  $('submitAnswerButton').addEventListener('click', submitAnswer);
  $('answerInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') submitAnswer(); });
  $('throwoutButton').addEventListener('click', useThrowout);
  $('revealButton').addEventListener('click', revealAnswer);
  $('nextQuestionButton').addEventListener('click', () => loadQuestion(true));
  $('endGameButton').addEventListener('click', () => endGame(false));
  $('missedButton').addEventListener('click', startMissed);
  $('compendiumSearch').addEventListener('input', renderCompendium);
  $('compendiumCategory').addEventListener('change', () => {
    $('compendiumSubcategory').innerHTML = subcategoryOptions($('compendiumCategory').value);
    renderCompendium();
  });
  $('compendiumSubcategory').addEventListener('change', renderCompendium);
  $('practiceFilteredButton').addEventListener('click', () => {
    if (!compendiumFiltered.length) return;
    startGame({ mode: 'practice', pool: compendiumFiltered, label: 'Compendium Practice', teamNames: ['Correct', ''] });
  });
  $('resetStatsButton').addEventListener('click', () => {
    if (confirm('Reset all saved Geography Bowl progress on this device?')) {
      localStorage.removeItem('geographyBowlProgress');
      renderStats();
    }
  });
  $('playAgainButton').addEventListener('click', () => {
    if (!lastSetup) return;
    $('endDialog').close();
    startGame({ ...lastSetup, pool: [...lastSetup.pool] });
  });
  $('endDialog').addEventListener('close', () => $('playAgainButton').classList.remove('hidden'));
}

async function init() {
  try {
    const response = await fetch('questions.json');
    if (!response.ok) throw new Error('Question bank could not be loaded.');
    QUESTIONS = await response.json();
    $('questionCount').textContent = QUESTIONS.length;
    renderCategoryGrid();
    bindEvents();
    renderCompendium();
  } catch (error) {
    document.querySelector('main').innerHTML = `<section class="view active"><div class="page-heading"><div><p class="section-kicker">Loading error</p><h1>Question bank unavailable</h1><p>${escapeHTML(error.message)}</p></div></div></section>`;
  }
}

init();
