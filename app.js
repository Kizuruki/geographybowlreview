const CATEGORIES = [
  {name:'Eastern/Central U.S. + Canada',file:'eastern-central-us-canada.json'},
  {name:'Western U.S. + Latin America/Caribbean',file:'western-us-latin-america-caribbean.json'},
  {name:'Europe + Russia',file:'europe-russia.json'},
  {name:'Africa + Mediterranean',file:'africa-mediterranean.json'},
  {name:'Asia + Middle East + Oceania/Pacific',file:'asia-middle-east-oceania-pacific.json'}
];

const SUBCATEGORIES = [
  'Cities, Capitals & Landmarks',
  'Countries, Borders & Cultures',
  'Rivers, Lakes & Oceans',
  'Mountains, Landforms & Geology',
  'Climate, Biomes & Resources'
];
const WORKER_URL = 'https://patient-base-c952.javalutionization.workers.dev';
const DATA_VERSION = 2;
const CURRENT_USER_KEY = 'geoBowlCurrentUserV2';
const ACCOUNTS_KEY = 'geoBowlAccountsV2';
const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const shuffle = (array) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

let QUESTIONS = [];
let currentUser = localStorage.getItem(CURRENT_USER_KEY) || 'guest';
let state = null;
let lastConfig = null;
let setupMode = 'practice';
let selectedAILevel = 5;
let leaderboardTab = 'full';
let filteredCompendium = [];
let sessionToken = 0;

function blankUserData() {
  return {version:DATA_VERSION,stats:[],missed:[],mastered:[],spaced:{},leaderboard:[],pdfQueue:[],settings:{tts:false}};
}

function userKey(username=currentUser) { return `geoBowlDataV2:${username}`; }

function loadUserData() {
  try {
    const value = JSON.parse(localStorage.getItem(userKey()) || 'null');
    return value && value.version === DATA_VERSION ? {...blankUserData(),...value} : blankUserData();
  } catch { return blankUserData(); }
}

function saveUserData(data) { localStorage.setItem(userKey(), JSON.stringify(data)); }

function mutateUserData(callback) {
  const data = loadUserData();
  callback(data);
  saveUserData(data);
  updateHomeCounts();
  return data;
}

function accounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}'); }
  catch { return {}; }
}

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,'0')).join('');
}

function displayUsername() {
  if (currentUser === 'guest') return 'Guest';
  return accounts()[currentUser]?.display || currentUser;
}

function updateAuthUI() {
  const guest = currentUser === 'guest';
  $('usernameDisplay').textContent = displayUsername();
  $('loginBtn').classList.toggle('hidden', !guest);
  $('logoutBtn').classList.toggle('hidden', guest);
  if (!$('playerNameInput').value || $('playerNameInput').dataset.auto === 'true') {
    $('playerNameInput').value = guest ? '' : displayUsername();
    $('playerNameInput').dataset.auto = 'true';
  }
  const data = loadUserData();
  $('ttsToggle').checked = Boolean(data.settings.tts);
  $('ttsInGame').checked = Boolean(data.settings.tts);
  updateHomeCounts();
}

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function showFeedback(message, type='info') {
  $('feedback').textContent = message;
  $('feedback').className = `feedback show ${type}`;
}

function clearFeedback() {
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(the|a|an)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function matchesAnswer(input, question) {
  const guess = normalize(input);
  if (!guess) return false;
  const choices = [question.answer,...(question.aliases || [])].map(normalize);
  return choices.some((answer) => guess === answer || (guess.length >= 5 && answer.length >= 5 && (guess.includes(answer) || answer.includes(guess))));
}

function aiAccuracy(level) {
  const t = (Number(level) - 1) / 9;
  return 0.20 + 0.75 * Math.pow(t, 0.92);
}

function accuracyPercent(level) { return Math.round(aiAccuracy(level) * 100); }

function categoryOptions(selected='all') {
  return `<option value="all">All regions</option>${CATEGORIES.map((category) => `<option value="${escapeHTML(category.name)}" ${selected === category.name ? 'selected' : ''}>${escapeHTML(category.name)}</option>`).join('')}`;
}

function subcategoryOptions(_categoryName, selected='all') {
  return `<option value="all">All subcategories</option>${SUBCATEGORIES.map((value) => `<option value="${escapeHTML(value)}" ${selected === value ? 'selected' : ''}>${escapeHTML(value)}</option>`).join('')}`;
}

function questionPool(category='all', subcategory='all') {
  return QUESTIONS.filter((q) => (category === 'all' || q.category === category) && (subcategory === 'all' || q.subcategory === subcategory));
}

function updateHomeCounts() {
  const data = loadUserData();
  $('missedCount').textContent = data.missed.length;
  const due = Object.values(data.spaced || {}).filter((item) => Number(item.dueAt) <= Date.now()).length;
  $('spacedCount').textContent = due;
  $('pdfCount').textContent = data.pdfQueue.length;
}

function openSetup(mode, presetCategory='all') {
  if (!QUESTIONS.length) { alert('Questions have not loaded yet.'); return; }
  setupMode = mode;
  const body = $('setupBody');
  if (mode === 'practice') {
    $('setupTitle').textContent = 'Select Practice Category';
    body.innerHTML = `<div class="setup-grid">
      <label class="field">Main category<select id="setupCategory">${categoryOptions(presetCategory)}</select></label>
      <label class="field">Subcategory<select id="setupSubcategory">${subcategoryOptions(presetCategory)}</select></label>
      <div class="setup-note" id="practicePoolCount"></div>
    </div>`;
    const refresh = () => {
      const category = $('setupCategory').value;
      const oldSub = $('setupSubcategory').value;
      $('setupSubcategory').innerHTML = subcategoryOptions(category, oldSub);
      const sub = $('setupSubcategory').value;
      const count = questionPool(category,sub).length;
      $('practicePoolCount').textContent = `${count} question${count === 1 ? '' : 's'} in this pool.`;
    };
    $('setupCategory').addEventListener('change', refresh);
    $('setupSubcategory').addEventListener('change', refresh);
    refresh();
    $('setupConfirmBtn').textContent = 'Start Practice';
  } else if (mode === 'full') {
    $('setupTitle').textContent = 'Full Game Setup';
    body.innerHTML = `<div class="setup-grid">
      <label class="field">Team A<input id="setupTeamA" maxlength="24" value="${escapeHTML($('playerNameInput').value.trim() || 'Team A')}"></label>
      <label class="field">Team B<input id="setupTeamB" maxlength="24" value="Team B"></label>
      <div class="setup-note">The game draws from the full compendium, alternates first attempts, and ends after 20 minutes. Each team has two throwouts.</div>
    </div>`;
    $('setupConfirmBtn').textContent = 'Start Full Game';
  } else {
    selectedAILevel = 5;
    $('setupTitle').textContent = 'AI Challenge Setup';
    body.innerHTML = `<div class="setup-grid">
      <label class="field">Your team<input id="setupPlayerTeam" maxlength="24" value="${escapeHTML($('playerNameInput').value.trim() || 'Your Team')}"></label>
      <div><strong>AI difficulty</strong><div class="level-grid">${Array.from({length:10},(_,index) => {
        const level = index + 1;
        return `<button class="level-btn ${level === selectedAILevel ? 'selected' : ''}" data-level="${level}" type="button">${level}<small>${accuracyPercent(level)}%</small></button>`;
      }).join('')}</div></div>
      <div class="setup-note" id="aiLevelNote">Level 5 answers approximately ${accuracyPercent(5)}% correctly. The curve is mildly concave down: early levels rise slightly faster than a linear scale, then increases taper.</div>
    </div>`;
    body.querySelectorAll('.level-btn').forEach((button) => button.addEventListener('click', () => {
      selectedAILevel = Number(button.dataset.level);
      body.querySelectorAll('.level-btn').forEach((item) => item.classList.toggle('selected', item === button));
      $('aiLevelNote').textContent = `Level ${selectedAILevel} answers approximately ${accuracyPercent(selectedAILevel)}% correctly. The AI automatically throws out the first two questions it answers incorrectly on its own turns.`;
    }));
    $('setupConfirmBtn').textContent = 'Start AI Game';
  }
  openModal('setupModal');
}

function confirmSetup() {
  let config;
  if (setupMode === 'practice') {
    const category = $('setupCategory').value;
    const subcategory = $('setupSubcategory').value;
    const pool = questionPool(category,subcategory);
    if (!pool.length) return;
    config = {mode:'practice',pool,label:subcategory !== 'all' ? subcategory : category !== 'all' ? category : 'All Questions',teamNames:['Score','']};
  } else if (setupMode === 'full') {
    config = {mode:'full',pool:QUESTIONS,label:'Full Game',teamNames:[$('setupTeamA').value.trim() || 'Team A',$('setupTeamB').value.trim() || 'Team B']};
  } else {
    config = {mode:'ai',pool:QUESTIONS,label:'AI Challenge',aiLevel:selectedAILevel,teamNames:[$('setupPlayerTeam').value.trim() || 'Your Team',`Atlas AI · L${selectedAILevel}`]};
  }
  closeModal('setupModal');
  startGame(config);
}

function clearGameTimers() {
  if (!state) return;
  clearInterval(state.timerId);
  clearTimeout(state.actionTimerId);
  clearInterval(state.stealIntervalId);
}

function startGame(config) {
  clearGameTimers();
  sessionToken += 1;
  const competitive = ['full','ai'].includes(config.mode);
  state = {
    ...config,competitive,queue:shuffle(config.pool),scores:[0,0],throwouts:competitive?[2,2]:[0,0],turnOwner:0,answeringTeam:0,isSteal:false,
    phase:'ready',current:null,questionCount:0,secondsLeft:competitive?1200:null,timerId:null,actionTimerId:null,stealIntervalId:null,
    attempts:0,correct:0,responseTimes:[],answerStartedAt:0,paused:false,ended:false
  };
  lastConfig = {...config,pool:[...config.pool]};
  $('homeScreen').classList.add('hidden');
  $('leaderboardPanel').classList.add('hidden');
  $('gameArea').classList.remove('hidden');
  configureGameDisplay();
  loadQuestion(false);
  if (competitive) {
    state.timerId = setInterval(() => {
      if (!state || state.ended || state.paused) return;
      state.secondsLeft -= 1;
      updateTimerDisplay();
      if (state.secondsLeft <= 0) endGame(true);
    },1000);
  }
  window.scrollTo({top:0,behavior:'smooth'});
}

function configureGameDisplay() {
  const practice = !state.competitive;
  const labels = {practice:'Practice Mode',missed:'Missed Questions',spaced:'Spaced Repetition',full:'Full Game Simulation',ai:`AI Challenge · Level ${state.aiLevel || ''}`,compendium:'Compendium Practice'};
  $('gameModeLabel').textContent = labels[state.mode] || 'Practice';
  $('gameTitle').textContent = state.label;
  $('team0Name').textContent = state.teamNames[0];
  $('team1Name').textContent = state.teamNames[1] || 'Opponent';
  $('team1Panel').classList.toggle('hidden',practice);
  $('team0Throwouts').classList.toggle('hidden',practice);
  $('showAnswerBtn').classList.toggle('hidden',state.competitive);
  $('pauseBtn').classList.toggle('hidden',state.competitive);
  updateScoreboard();
  updateTimerDisplay();
}

function updateTimerDisplay() {
  if (!state || state.secondsLeft === null) { $('timerDisplay').textContent = state?.paused ? 'Paused' : 'Untimed'; return; }
  const minutes = Math.max(0,Math.floor(state.secondsLeft/60));
  const seconds = Math.max(0,state.secondsLeft%60);
  $('timerDisplay').textContent = `${minutes}:${String(seconds).padStart(2,'0')}`;
}

function updateScoreboard() {
  if (!state) return;
  $('team0Score').textContent = state.scores[0];
  $('team1Score').textContent = state.scores[1];
  $('team0Throwouts').textContent = `${state.throwouts[0]} throwout${state.throwouts[0] === 1 ? '' : 's'} left`;
  $('team1Throwouts').textContent = `${state.throwouts[1]} throwout${state.throwouts[1] === 1 ? '' : 's'} left`;
  $('team0Panel').classList.toggle('active',state.answeringTeam === 0);
  $('team1Panel').classList.toggle('active',state.competitive && state.answeringTeam === 1);
  const avg = state.responseTimes.length ? state.responseTimes.reduce((a,b)=>a+b,0)/state.responseTimes.length/1000 : null;
  $('avgResponseTime').textContent = avg === null ? '--' : avg.toFixed(1);
  $('accuracyDisplay').textContent = state.attempts ? `${Math.round(state.correct/state.attempts*100)}%` : '--%';
  $('attemptDisplay').textContent = `${state.attempts} attempt${state.attempts === 1 ? '' : 's'}`;
}

function nextQuestionFromQueue() {
  if (!state.queue.length) state.queue = shuffle(state.pool);
  return state.queue.pop();
}

function loadQuestion(changeOwner=true) {
  if (!state || state.ended) return;
  clearTimeout(state.actionTimerId);
  clearInterval(state.stealIntervalId);
  if (changeOwner && state.competitive) state.turnOwner = 1 - state.turnOwner;
  state.answeringTeam = state.turnOwner;
  state.isSteal = false;
  state.phase = 'answering';
  state.current = nextQuestionFromQueue();
  state.questionCount += 1;
  state.answerStartedAt = Date.now();
  $('questionCounter').textContent = `Question ${state.questionCount}`;
  $('categoryTag').textContent = state.current.category;
  $('subcategoryTag').textContent = state.current.subcategory;
  $('topicTag').textContent = state.current.topic;
  $('questionText').textContent = state.current.question;
  $('answerInput').value = '';
  $('addToPdfCheckbox').checked = false;
  clearFeedback();
  $('nextBtn').classList.add('hidden');
  setQuestionControls();
  updateScoreboard();
  speakQuestion();
  if (state.mode === 'ai' && state.answeringTeam === 1) runAIAnswer();
}

function isBotTurn() { return state?.mode === 'ai' && state.answeringTeam === 1; }

function setQuestionControls() {
  if (!state) return;
  const humanCanAnswer = state.phase === 'answering' && !isBotTurn() && !state.paused;
  $('answerArea').classList.toggle('hidden',!humanCanAnswer);
  $('answerInput').disabled = !humanCanAnswer;
  $('submitBtn').disabled = !humanCanAnswer;
  const practiceReveal = !state.competitive && state.phase === 'answering' && !state.paused;
  $('showAnswerBtn').classList.toggle('hidden',!practiceReveal);
  const canThrow = state.competitive && !state.isSteal && !isBotTurn() && state.answeringTeam === state.turnOwner && state.throwouts[state.turnOwner] > 0 && ['answering','steal_window'].includes(state.phase);
  $('throwoutBtn').classList.toggle('hidden',!canThrow);
  $('throwoutBtn').textContent = `Throw Out (${state.throwouts[state.turnOwner] || 0})`;
  $('nextBtn').classList.toggle('hidden',state.phase !== 'resolved');
  $('turnDisplay').textContent = isBotTurn() ? `${state.teamNames[1]} is answering` : state.isSteal ? `${state.teamNames[state.answeringTeam]} can steal` : state.competitive ? `${state.teamNames[state.answeringTeam]}'s question` : state.paused ? 'Practice paused' : 'Practice question';
  if (humanCanAnswer) setTimeout(()=>$('answerInput').focus(),30);
}

function submitAnswer() {
  if (!state || state.phase !== 'answering' || isBotTurn() || state.paused) return;
  const value = $('answerInput').value.trim();
  if (!value) { showFeedback('Enter an answer first.','info'); return; }
  const responseMs = Math.max(0,Date.now()-state.answerStartedAt);
  const correct = matchesAnswer(value,state.current);
  recordHumanAttempt(correct,responseMs);
  if (correct) {
    state.scores[state.answeringTeam] += 1;
    resolveQuestion(`Correct — ${state.current.answer}`,true);
  } else if (!state.competitive) {
    resolveQuestion(`Incorrect. The answer is ${state.current.answer}.`,false);
  } else if (state.isSteal) {
    resolveQuestion(`No steal. The answer is ${state.current.answer}.`,false);
  } else {
    startAutomaticStealWindow();
  }
}

function recordHumanAttempt(correct,responseMs) {
  state.attempts += 1;
  if (correct) state.correct += 1;
  state.responseTimes.push(responseMs);
  const question = state.current;
  mutateUserData((data) => {
    const wasMissed = data.missed.includes(question.id);
    data.stats.push({ts:Date.now(),mode:state.mode,category:question.category,subcategory:question.subcategory,questionId:question.id,correct,responseMs,team:state.answeringTeam});
    if (correct) {
      data.missed = data.missed.filter((id)=>id!==question.id);
      if (!data.mastered.includes(question.id)) data.mastered.push(question.id);
      if (state.mode === 'spaced') {
        const prior = data.spaced[question.id] || {interval:1};
        const interval = Math.min(30,Math.max(2,Number(prior.interval || 1)*2));
        data.spaced[question.id] = {interval,dueAt:Date.now()+interval*86400000};
      } else if (wasMissed || state.mode === 'missed') {
        data.spaced[question.id] = {interval:1,dueAt:Date.now()+86400000};
      }
    } else {
      if (!data.missed.includes(question.id)) data.missed.push(question.id);
      if (state.mode === 'spaced') data.spaced[question.id] = {interval:1,dueAt:Date.now()+86400000};
    }
  });
  if (currentUser !== 'guest') {
    fetch(`${WORKER_URL}/geo-stats/${encodeURIComponent(currentUser)}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({category:question.category, subcategory:question.subcategory, mode:state.mode, correct})
    }).catch(() => {});
  }
  updateScoreboard();
}

function startAutomaticStealWindow() {
  state.phase = 'steal_window';
  $('answerArea').classList.add('hidden');
  const hasThrowout = state.throwouts[state.turnOwner] > 0;
  let remaining = hasThrowout ? 3 : 1;
  const target = state.teamNames[1-state.turnOwner];
  const updateMessage = () => showFeedback(`Incorrect. ${hasThrowout ? `Press Throw Out now or the question passes to ${target} in ${remaining}…` : `The question passes to ${target}…`}`,'incorrect');
  updateMessage();
  setQuestionControls();
  state.stealIntervalId = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) updateMessage();
  },1000);
  state.actionTimerId = setTimeout(beginSteal,hasThrowout?3000:650);
}

function beginSteal() {
  if (!state || state.ended || !['steal_window','answering'].includes(state.phase)) return;
  clearTimeout(state.actionTimerId);
  clearInterval(state.stealIntervalId);
  state.answeringTeam = 1-state.turnOwner;
  state.isSteal = true;
  state.phase = 'answering';
  state.answerStartedAt = Date.now();
  showFeedback(`${state.teamNames[state.answeringTeam]} may answer for one point.`,'info');
  setQuestionControls();
  updateScoreboard();
  if (isBotTurn()) runAIAnswer();
}

function useThrowout() {
  if (!state || state.ended || state.isSteal || isBotTurn() || !['answering','steal_window'].includes(state.phase)) return;
  const team = state.turnOwner;
  if (state.throwouts[team] <= 0) return;
  clearTimeout(state.actionTimerId);
  clearInterval(state.stealIntervalId);
  state.throwouts[team] -= 1;
  state.phase = 'transition';
  $('answerArea').classList.add('hidden');
  $('throwoutBtn').classList.add('hidden');
  showFeedback(`${state.teamNames[team]} throws out the question. It cannot be stolen; a replacement is coming.`,'info');
  updateScoreboard();
  const token = sessionToken;
  state.actionTimerId = setTimeout(()=>{ if(token===sessionToken && state && !state.ended) loadQuestion(false); },650);
}

function runAIAnswer() {
  const token = sessionToken;
  const questionId = state.current.id;
  state.phase = 'thinking';
  setQuestionControls();
  showFeedback(`${state.teamNames[1]} is thinking…`,'info');
  state.actionTimerId = setTimeout(() => {
    if (token !== sessionToken || !state || state.ended || state.current.id !== questionId) return;
    const correct = Math.random() < aiAccuracy(state.aiLevel);
    if (correct) {
      state.scores[1] += 1;
      resolveQuestion(`${state.teamNames[1]} answers correctly: ${state.current.answer}`,true);
    } else if (!state.isSteal && state.throwouts[1] > 0) {
      state.throwouts[1] -= 1;
      state.phase = 'transition';
      showFeedback(`${state.teamNames[1]} answers incorrectly and automatically uses throwout ${2-state.throwouts[1]} of 2. You cannot steal.`,'incorrect');
      updateScoreboard();
      state.actionTimerId = setTimeout(()=>{ if(token===sessionToken && state && !state.ended) loadQuestion(false); },900);
    } else if (!state.isSteal) {
      showFeedback(`${state.teamNames[1]} answers incorrectly. Your team receives the steal.`,'incorrect');
      state.phase = 'steal_window';
      state.actionTimerId = setTimeout(beginSteal,700);
    } else {
      resolveQuestion(`${state.teamNames[1]} misses the steal. The answer is ${state.current.answer}.`,false);
    }
  },850);
}

function queueCurrentForPDF() {
  if (!$('addToPdfCheckbox').checked || !state?.current) return;
  mutateUserData((data) => { if (!data.pdfQueue.includes(state.current.id)) data.pdfQueue.push(state.current.id); });
}

function resolveQuestion(message,correct) {
  clearTimeout(state.actionTimerId);
  clearInterval(state.stealIntervalId);
  state.phase = 'resolved';
  queueCurrentForPDF();
  showFeedback(message,correct?'correct':'incorrect');
  $('answerArea').classList.add('hidden');
  $('throwoutBtn').classList.add('hidden');
  $('showAnswerBtn').classList.add('hidden');
  $('nextBtn').classList.remove('hidden');
  updateScoreboard();
}

function revealAnswer() {
  if (!state || state.competitive || state.phase !== 'answering') return;
  recordHumanAttempt(false,Math.max(0,Date.now()-state.answerStartedAt));
  resolveQuestion(`Answer: ${state.current.answer}`,false);
}

function togglePause() {
  if (!state || state.competitive || state.phase === 'resolved') return;
  state.paused = !state.paused;
  $('pauseBtn').textContent = state.paused ? 'Resume' : 'Pause';
  if (state.paused) window.speechSynthesis?.cancel();
  setQuestionControls();
  updateTimerDisplay();
}

function nextQuestion() { if (state?.phase === 'resolved') loadQuestion(state.competitive); }

function calculateGameAccuracy() { return state.attempts ? Math.round(state.correct/state.attempts*100) : 0; }

function endGame(timeExpired=false) {
  if (!state || state.ended) return;
  state.ended = true;
  sessionToken += 1;
  clearGameTimers();
  window.speechSynthesis?.cancel();
  let title = 'Practice Complete';
  let score = `${state.correct} / ${state.attempts}`;
  let detail = state.attempts ? `${calculateGameAccuracy()}% accuracy` : 'No answers recorded';
  if (state.competitive) {
    const winner = state.scores[0] === state.scores[1] ? null : state.scores[0] > state.scores[1] ? 0 : 1;
    title = winner === null ? 'Game Tied' : `${state.teamNames[winner]} Wins`;
    score = `${state.scores[0]} – ${state.scores[1]}`;
    detail = `${timeExpired ? 'Time expired' : 'Game ended'} after ${state.questionCount} questions`;
    const entry = {ts:Date.now(),mode:state.mode,aiLevel:state.aiLevel || null,name:state.teamNames[0],opponent:state.teamNames[1],score:state.scores[0],opponentScore:state.scores[1],accuracy:calculateGameAccuracy(),avgResponse:state.responseTimes.length?Math.round(state.responseTimes.reduce((a,b)=>a+b,0)/state.responseTimes.length):null,questions:state.questionCount};
    mutateUserData((data)=>{ data.leaderboard.push(entry); data.leaderboard = data.leaderboard.slice(-250); });
  }
  $('endBody').innerHTML = `<div style="font-size:2rem;margin-bottom:8px">${state.competitive?'🏆':'🎯'}</div><h2 id="endTitle" style="color:#4ba287">${escapeHTML(title)}</h2><div style="font-size:2.5rem;font-weight:800;color:#32482d;margin:10px 0">${escapeHTML(score)}</div><p class="muted">${escapeHTML(detail)}</p>`;
  openModal('endModal');
}

function returnHome(force=false) {
  if (state && !state.ended && !force) {
    if (!confirm('End the current session and return home?')) return;
  }
  clearGameTimers();
  sessionToken += 1;
  if (state) state.ended = true;
  window.speechSynthesis?.cancel();
  $('gameArea').classList.add('hidden');
  $('homeScreen').classList.remove('hidden');
  $('pauseBtn').textContent = 'Pause';
  window.scrollTo({top:0,behavior:'smooth'});
}

function startQuestionIdsMode(mode,ids,label) {
  const wanted = new Set(ids);
  const pool = QUESTIONS.filter((q)=>wanted.has(q.id));
  if (!pool.length) { alert(mode === 'missed' ? 'You have no missed questions to review.' : 'No spaced-repetition questions are due yet.'); return; }
  startGame({mode,pool,label,teamNames:['Score','']});
}

function showLeaderboard(tab='full') {
  leaderboardTab = tab;
  $('leaderboardPanel').classList.remove('hidden');
  const tabs = [{id:'full',label:'Full Game'},...Array.from({length:10},(_,index)=>({id:`ai-${index+1}`,label:`AI ${index+1}`}))];
  $('leaderboardTabs').innerHTML = tabs.map((item)=>`<button class="tab-btn ${item.id===tab?'active':''}" data-tab="${item.id}" type="button">${item.label}</button>`).join('');
  $('leaderboardTabs').querySelectorAll('.tab-btn').forEach((button)=>button.addEventListener('click',()=>showLeaderboard(button.dataset.tab)));
  const rows = loadUserData().leaderboard.filter((entry)=>tab==='full'?entry.mode==='full':entry.mode==='ai'&&entry.aiLevel===Number(tab.split('-')[1])).sort((a,b)=>b.score-a.score || a.opponentScore-b.opponentScore || b.accuracy-a.accuracy || b.ts-a.ts);
  $('leaderboardList').innerHTML = rows.length ? rows.slice(0,50).map((entry,index)=>`<div class="leader-row"><div class="leader-rank">#${index+1}</div><div><strong>${escapeHTML(entry.name)}</strong><div class="small">${new Date(entry.ts).toLocaleDateString()}</div></div><div class="leader-score">${entry.score}–${entry.opponentScore}</div><div class="leader-meta">${entry.accuracy}% accuracy<br>${entry.questions} questions</div></div>`).join('') : '<div class="empty-state">No saved results in this tab yet.</div>';
  $('leaderboardPanel').scrollIntoView({behavior:'smooth',block:'start'});
}

function statsOptions() {
  $('statsModeFilter').innerHTML = ['all','practice','full','ai','missed','spaced','compendium'].map((value)=>`<option value="${value}">${value==='all'?'All modes':value[0].toUpperCase()+value.slice(1)}</option>`).join('');
  $('statsCategoryFilter').innerHTML = categoryOptions();
}

function showStats() { statsOptions(); renderStats(); openModal('statsModal'); }

function renderStats() {
  const mode = $('statsModeFilter').value || 'all';
  const category = $('statsCategoryFilter').value || 'all';
  const entries = loadUserData().stats.filter((item)=>(mode==='all'||item.mode===mode)&&(category==='all'||item.category===category));
  const correct = entries.filter((item)=>item.correct).length;
  const accuracy = entries.length?Math.round(correct/entries.length*100):0;
  const avg = entries.length?entries.reduce((sum,item)=>sum+Number(item.responseMs||0),0)/entries.length/1000:0;
  const cutoff = new Date(); cutoff.setHours(0,0,0,0);
  const days = Array.from({length:14},(_,index)=>{
    const date = new Date(cutoff); date.setDate(date.getDate()-(13-index));
    const next = new Date(date); next.setDate(next.getDate()+1);
    const items = entries.filter((item)=>item.ts>=date.getTime()&&item.ts<next.getTime());
    return {date,attempts:items.length,accuracy:items.length?Math.round(items.filter((item)=>item.correct).length/items.length*100):0};
  });
  const maxAttempts = Math.max(1,...days.map((day)=>day.attempts));
  $('statsBody').innerHTML = `<div class="stats-summary">
    <div class="stats-tile"><div class="val">${entries.length}</div><div class="lbl">Attempted</div></div>
    <div class="stats-tile"><div class="val">${correct}</div><div class="lbl">Correct</div></div>
    <div class="stats-tile"><div class="val">${entries.length?accuracy+'%':'--'}</div><div class="lbl">Accuracy</div></div>
    <div class="stats-tile"><div class="val">${entries.length?avg.toFixed(1)+'s':'--'}</div><div class="lbl">Avg Response</div></div>
  </div><div class="chart-wrap"><div class="chart-title">Attempts — Last 14 Days</div>${entries.length?`<div class="bar-chart">${days.map((day)=>`<div class="day-column" title="${day.date.toLocaleDateString()}: ${day.attempts} attempts, ${day.accuracy}% correct"><div class="day-bar" style="height:${Math.max(2,day.attempts/maxAttempts*170)}px"></div><span class="day-label">${day.date.toLocaleDateString(undefined,{month:'numeric',day:'numeric'})}</span></div>`).join('')}</div>`:'<div class="empty-state">No data for this filter yet.</div>'}</div>`;
}

function showMastered() {
  const data = loadUserData();
  const mastered = new Set(data.mastered);
  $('masteredBody').innerHTML = `<div class="stats-summary"><div class="stats-tile"><div class="val">${mastered.size}</div><div class="lbl">Mastered</div></div><div class="stats-tile"><div class="val">${QUESTIONS.length}</div><div class="lbl">Total Questions</div></div><div class="stats-tile"><div class="val">${QUESTIONS.length?Math.round(mastered.size/QUESTIONS.length*100):0}%</div><div class="lbl">Complete</div></div></div>
  <div class="mastery-group"><div class="chart-title">Progress by Regional Specialty</div>${CATEGORIES.map((category)=>{const total=QUESTIONS.filter((q)=>q.category===category.name).length;const done=QUESTIONS.filter((q)=>q.category===category.name&&mastered.has(q.id)).length;const pct=total?Math.round(done/total*100):0;return `<div class="mastery-row"><strong>${escapeHTML(category.name)}</strong><div class="mastery-track"><div class="mastery-fill" style="width:${pct}%"></div></div><span>${done}/${total}</span></div>`}).join('')}</div>`;
  openModal('masteredModal');
}

function openCompendium() {
  $('compendiumCategory').innerHTML = categoryOptions();
  $('compendiumSubcategory').innerHTML = subcategoryOptions('all');
  const topics = [...new Set(QUESTIONS.map((q)=>q.topic))].sort();
  $('compendiumTopic').innerHTML = `<option value="all">All topics</option>${topics.map((topic)=>`<option value="${escapeHTML(topic)}">${escapeHTML(topic)}</option>`).join('')}`;
  $('compendiumSearch').value = '';
  renderCompendium();
  openModal('compendiumModal');
}

function renderCompendium() {
  const search = normalize($('compendiumSearch').value);
  const category = $('compendiumCategory').value || 'all';
  const subcategory = $('compendiumSubcategory').value || 'all';
  const topic = $('compendiumTopic').value || 'all';
  filteredCompendium = QUESTIONS.filter((q)=>{
    const haystack = normalize(`${q.question} ${q.answer} ${q.category} ${q.subcategory} ${q.topic}`);
    return (category==='all'||q.category===category)&&(subcategory==='all'||q.subcategory===subcategory)&&(topic==='all'||q.topic===topic)&&(!search||haystack.includes(search));
  });
  $('compendiumCount').textContent = `${filteredCompendium.length} question${filteredCompendium.length===1?'':'s'}`;
  $('compendiumList').innerHTML = filteredCompendium.length?filteredCompendium.map((q)=>`<details class="compendium-item"><summary><span class="compendium-tags"><span>${escapeHTML(q.category)}</span><span>${escapeHTML(q.subcategory)}</span><span>${escapeHTML(q.topic)}</span></span>${escapeHTML(q.question)}</summary><p>${escapeHTML(q.answer)}</p></details>`).join(''):'<div class="empty-state">No questions match these filters.</div>';
}

function exportPDF() {
  const ids = new Set(loadUserData().pdfQueue);
  const questions = QUESTIONS.filter((q) => ids.has(q.id));
  if (!questions.length) { alert('Your PDF queue is empty. Add questions while practicing or generate a 20-question packet first.'); return; }
  if (typeof window.jspdf === 'undefined') { alert('PDF library is still loading. Please try again in a moment.'); return; }
  const sanitize = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const margin = 20, maxWidth = 170, pageHeight = pdf.internal.pageSize.getHeight(), underscoreLen = 75;
  const lhFromFont = (doc) => Math.round(doc.getFontSize() * 0.5);
  let yPos = 20;
  const needsNewPage = (requiredSpace) => yPos + requiredSpace > (pageHeight - 10);
  const addNewPage = () => { pdf.addPage(); yPos = 20; };
  const addWrappedText = (text, x, maxW) => {
    const clean = sanitize(text);
    const lh = lhFromFont(pdf);
    const lines = pdf.splitTextToSize(clean, maxW);
    const requiredSpace = lines.length * lh;
    if (yPos + requiredSpace > pageHeight - 10) addNewPage();
    lines.forEach((line) => { pdf.text(line, x, yPos); yPos += lh; });
  };

  pdf.setFontSize(16); pdf.setFont(undefined,'bold'); pdf.text('Geography Bowl Practice Packet', margin, yPos); yPos += 10;
  const today = new Date().toLocaleDateString();
  pdf.setFontSize(10); pdf.setFont(undefined,'normal'); pdf.text(`${questions.length} questions • Generated ${today}`, margin, yPos); yPos += 16;
  pdf.setFontSize(13); pdf.setFont(undefined,'normal');
  questions.forEach((q,i) => {
    const text = `${i + 1}. ${sanitize(q.question)}`;
    const lh = lhFromFont(pdf); const req = pdf.splitTextToSize(text, maxWidth).length * lh + 14;
    if (needsNewPage(req)) addNewPage();
    addWrappedText(text, margin, maxWidth); yPos += 2; pdf.text('_'.repeat(underscoreLen), margin, yPos); yPos += 12;
  });

  addNewPage();
  pdf.setFontSize(16); pdf.setFont(undefined,'bold'); pdf.text('Answer Key', margin, yPos); yPos += 12;
  pdf.setFontSize(13); pdf.setFont(undefined,'normal');
  questions.forEach((q,i) => {
    const text = `${i + 1}. ${sanitize(q.answer)}  (${sanitize(q.category)} — ${sanitize(q.subcategory)})`;
    const lh = lhFromFont(pdf); const req = pdf.splitTextToSize(text, maxWidth).length * lh + 4;
    if (needsNewPage(req)) addNewPage();
    addWrappedText(text, margin, maxWidth); yPos += 4;
  });

  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) alert('Your browser blocked the new tab. Allow pop-ups for this site, then click Export again.');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function generatePDFQueue() {
  mutateUserData((data)=>{ data.pdfQueue = shuffle(QUESTIONS).slice(0,Math.min(20,QUESTIONS.length)).map((q)=>q.id); });
  alert('A 20-question practice packet is ready. Click Export to open the print dialog, then choose Save as PDF.');
}

function clearPDFQueue() {
  if (!confirm('Clear all questions from the PDF queue?')) return;
  mutateUserData((data)=>{data.pdfQueue=[];});
}

function speakQuestion() {
  if (!state?.current || !loadUserData().settings.tts || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(state.current.question);
  utterance.rate = .95;
  window.speechSynthesis.speak(utterance);
}

function setTTS(enabled) {
  mutateUserData((data)=>{data.settings.tts=enabled;});
  $('ttsToggle').checked = enabled;
  $('ttsInGame').checked = enabled;
  if (!enabled) window.speechSynthesis?.cancel(); else speakQuestion();
}

async function authRequest(action, username, password) {
  const res = await fetch(`${WORKER_URL}/auth/${action}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username, password})
  });
  return res.json();
}

function finishLogin(username) {
  currentUser = username;
  localStorage.setItem(CURRENT_USER_KEY, currentUser);
  closeModal('loginModal');
  updateAuthUI();
}

async function registerAccount() {
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  if (username.length < 2 || password.length < 4) { $('loginError').textContent = 'Use at least 2 characters for the username and 4 for the password.'; return; }
  try {
    const data = await authRequest('register', username, password);
    if (!data.success) { $('loginError').textContent = data.message || 'Registration failed.'; return; }
    finishLogin(username);
  } catch { $('loginError').textContent = 'Could not reach the server.'; }
}

async function loginAccount() {
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  if (!username || !password) { $('loginError').textContent = 'Enter a username and password.'; return; }
  try {
    const data = await authRequest('login', username, password);
    if (!data.success) { $('loginError').textContent = data.message || 'Invalid credentials.'; return; }
    finishLogin(username);
  } catch { $('loginError').textContent = 'Could not reach the server.'; }
}

function logout() {
  currentUser = 'guest';
  localStorage.setItem(CURRENT_USER_KEY,currentUser);
  $('playerNameInput').dataset.auto = 'true';
  updateAuthUI();
}

function bindEvents() {
  document.querySelectorAll('[data-close]').forEach((button)=>button.addEventListener('click',()=>closeModal(button.dataset.close)));
  document.querySelectorAll('.modal').forEach((modal)=>modal.addEventListener('click',(event)=>{if(event.target===modal)closeModal(modal.id)}));
  $('playerNameInput').addEventListener('input',()=>{$('playerNameInput').dataset.auto='false'});
  $('practiceBtn').addEventListener('click',()=>openSetup('practice'));
  $('fullGameBtn').addEventListener('click',()=>openSetup('full'));
  $('aiBtn').addEventListener('click',()=>openSetup('ai'));
  $('setupConfirmBtn').addEventListener('click',confirmSetup);
  $('leaderboardBtn').addEventListener('click',()=>showLeaderboard('full'));
  $('closeLeaderboardBtn').addEventListener('click',()=>$('leaderboardPanel').classList.add('hidden'));
  $('missedBtn').addEventListener('click',()=>startQuestionIdsMode('missed',loadUserData().missed,'Missed Questions'));
  $('spacedBtn').addEventListener('click',()=>{const data=loadUserData();const ids=Object.entries(data.spaced).filter(([,item])=>Number(item.dueAt)<=Date.now()).map(([id])=>id);startQuestionIdsMode('spaced',ids,'Spaced Repetition')});
  $('masteredBtn').addEventListener('click',showMastered);
  $('statsBtn').addEventListener('click',showStats);
  $('statsModeFilter').addEventListener('change',renderStats);
  $('statsCategoryFilter').addEventListener('change',renderStats);
  $('compendiumBtn').addEventListener('click',openCompendium);
  $('compendiumSearch').addEventListener('input',renderCompendium);
  $('compendiumCategory').addEventListener('change',()=>{$('compendiumSubcategory').innerHTML=subcategoryOptions($('compendiumCategory').value);renderCompendium()});
  $('compendiumSubcategory').addEventListener('change',renderCompendium);
  $('compendiumTopic').addEventListener('change',renderCompendium);
  $('practiceCompendiumBtn').addEventListener('click',()=>{if(!filteredCompendium.length)return;closeModal('compendiumModal');startGame({mode:'compendium',pool:[...filteredCompendium],label:'Compendium Practice',teamNames:['Score','']})});
  $('tipsBtn').addEventListener('click',()=>openModal('tipsModal'));
  $('exportPdfBtn').addEventListener('click',exportPDF);
  $('generatePdfBtn').addEventListener('click',generatePDFQueue);
  $('clearPdfBtn').addEventListener('click',clearPDFQueue);
  $('ttsToggle').addEventListener('change',(event)=>setTTS(event.target.checked));
  $('ttsInGame').addEventListener('change',(event)=>setTTS(event.target.checked));
  $('submitBtn').addEventListener('click',submitAnswer);
  $('answerInput').addEventListener('keydown',(event)=>{if(event.key==='Enter')submitAnswer()});
  $('throwoutBtn').addEventListener('click',useThrowout);
  $('showAnswerBtn').addEventListener('click',revealAnswer);
  $('nextBtn').addEventListener('click',nextQuestion);
  $('pauseBtn').addEventListener('click',togglePause);
  $('returnHomeBtn').addEventListener('click',()=>returnHome(false));
  $('loginBtn').addEventListener('click',()=>{$('loginError').textContent='';$('loginUsername').value='';$('loginPassword').value='';openModal('loginModal')});
  $('logoutBtn').addEventListener('click',logout);
  $('registerBtn').addEventListener('click',registerAccount);
  $('loginSubmitBtn').addEventListener('click',loginAccount);
  $('loginPassword').addEventListener('keydown',(event)=>{if(event.key==='Enter')loginAccount()});
  $('endHomeBtn').addEventListener('click',()=>{closeModal('endModal');returnHome(true)});
  $('playAgainBtn').addEventListener('click',()=>{if(!lastConfig)return;closeModal('endModal');startGame({...lastConfig,pool:[...lastConfig.pool]})});
}

function renderSpecialties() {
  $('specialtyList').innerHTML = CATEGORIES.map((category,index)=>`<li><strong>Player ${String.fromCharCode(65+index)} — ${escapeHTML(category.name)}:</strong> ${SUBCATEGORIES.map(escapeHTML).join(' • ')}</li>`).join('');
}

function validQuestion(question) {
  return question && typeof question.id === 'string' && typeof question.question === 'string' && typeof question.answer === 'string' && CATEGORIES.some((category)=>category.name===question.category) && SUBCATEGORIES.includes(question.subcategory);
}

async function fetchJSON(url) {
  const response = await fetch(url, {cache: 'no-cache'});
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) throw new Error(`${url} is EMPTY (0 bytes) on the server`);
  if (text.trimStart().startsWith('<')) throw new Error(`${url} returned HTML instead of JSON`);
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`${url} is not valid JSON (${text.length} characters received, ends with "${text.slice(-30)}")`); }
}

async function loadQuestionBank() {
  const base = 'question_data/categories/';   // must match your real folder name exactly
  try {
    const banks = await Promise.all(CATEGORIES.map(async (category) => {
      const items = await fetchJSON(base + category.file);
      if (!Array.isArray(items)) throw new Error(`${category.file} is not a question array`);
      return items;
    }));
    const unique = new Map(banks.flat().filter(validQuestion).map((q) => [q.id, q]));
    if (!unique.size) throw new Error('The classified files contained no valid questions.');
    return {questions:[...unique.values()],source:'classified regional files'};
  } catch (classifiedError) {
    console.error('Classified files failed:', classifiedError);
    try {
      const fallback = await fetchJSON('questions.json');
      const questions = Array.isArray(fallback) ? fallback.filter(validQuestion) : [];
      if (questions.length) return {questions,source:'fallback question bank'};
    } catch {}
    throw classifiedError;
  }
}
  
async function init() {
  const jspdfScript = document.createElement('script');
  jspdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  document.head.appendChild(jspdfScript);
  bindEvents();
  renderSpecialties();
  updateAuthUI();
  try {
    const bank = await loadQuestionBank();
    QUESTIONS = bank.questions;
    $('questionsStatus').textContent = `${QUESTIONS.length} geography questions loaded from ${bank.source} • ${CATEGORIES.length} regions × ${SUBCATEGORIES.length} shared subcategories`;
  } catch (error) {
    $('questionsStatus').textContent = `Could not load questions: ${error.message}`;
    $('questionsStatus').style.color = '#b91c1c';
  }
}

window.__geoBowl = {aiAccuracy,accuracyPercent};
init();
