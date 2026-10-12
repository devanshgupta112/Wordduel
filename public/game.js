// public/game.js - WORDDUEL Client Engine (Web + Android PWA/Capacitor)

(function () {
  'use strict';

  // --- Session & State ---
  function getOrCreatePlayerId() {
    let id = sessionStorage.getItem('wordduel_player_id');
    if (!id) {
      id = 'u_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      sessionStorage.setItem('wordduel_player_id', id);
    }
    return id;
  }

  const playerId = getOrCreatePlayerId();
  let currentRoomId = null;
  let playerNum = 1;
  let gameMode = 'online'; // 'online' | 'bot' | 'same_device'
  let gameStatus = 'lobby'; // 'lobby' | 'waiting' | 'countdown' | 'playing' | 'round_ended' | 'duel_ended'

  // Rounds configuration
  let roundsMode = 'fixed'; // 'fixed' | 'unlimited'
  let totalRounds = 3;      // number | null
  let currentRound = 1;
  let scores = { player1: 0, player2: 0 };
  let wordsHistory = [];

  let currentRow = 0;
  let currentCol = 0;
  let currentGuess = '';
  let isLocked = false;
  let opponentRowCount = 0;

  // Stopwatch Timer
  let timerInterval = null;
  let elapsedSeconds = 0;
  let matchStartTime = null;

  // Disconnect Timer
  let disconnectInterval = null;

  // Keyboard letter colors: { A: 'green', B: 'grey', ... }
  const letterStatuses = {};

  // Offline / Bot word dictionary cache
  let localWords = { answers: [], allowed: [] };
  let botSecretWord = '';
  let botInterval = null;
  let botUsedWords = [];

  // --- DOM Elements ---
  const toastContainer = document.getElementById('toast-container');
  const viewHome = document.getElementById('view-home');
  const viewWaiting = document.getElementById('view-waiting');
  const viewRoomFull = document.getElementById('view-room-full');
  const viewGame = document.getElementById('view-game');

  const headerRoomPill = document.getElementById('header-room-pill');
  const headerRoomCode = document.getElementById('header-room-code');
  const headerTimerPill = document.getElementById('header-timer-pill');
  const matchTimerEl = document.getElementById('match-timer');
  const howToPlayBtn = document.getElementById('how-to-play-btn');
  const leaveRoomHeaderBtn = document.getElementById('leave-room-header-btn');
  const disconnectBanner = document.getElementById('disconnect-banner');
  const disconnectCountdown = document.getElementById('disconnect-countdown');

  // Home Screen Elements
  const createGameBtn = document.getElementById('create-game-btn');
  const openJoinModalBtn = document.getElementById('open-join-modal-btn');
  const playBotBtn = document.getElementById('play-bot-btn');
  const sameDeviceBtn = document.getElementById('same-device-btn');

  // Lobby Elements
  const lobbyCodeText = document.getElementById('lobby-code-text');
  const copyInviteBtn = document.getElementById('copy-code-btn') || document.getElementById('copy-invite-btn');
  const nativeShareBtn = document.getElementById('share-code-btn') || document.getElementById('native-share-btn');
  const lobbyLeaveBtn = document.getElementById('lobby-leave-btn');
  const lobbyRoundsChip = document.getElementById('lobby-rounds-chip');

  // Game Arena Elements
  const roundCountdownOverlay = document.getElementById('round-countdown-overlay');
  const countdownRoundLabel = document.getElementById('countdown-round-label');
  const countdownNumber = document.getElementById('countdown-number');
  const arenaRoundPill = document.getElementById('arena-round-pill');
  const runningScoreBadge = document.getElementById('running-score-badge');

  const myScoreLabel = document.getElementById('my-score-label');
  const myGuessesCount = document.getElementById('my-guesses-count');
  const oppScoreLabel = document.getElementById('opp-score-label');
  const oppGuessesCount = document.getElementById('opp-guesses-count');
  const oppLiveText = document.getElementById('opp-live-text');
  const oppActionMsg = document.getElementById('opp-action-msg');
  const currentGuessPhase = document.getElementById('current-guess-phase');
  const oppTagCount = document.getElementById('opp-tag-count');
  const oppBoardHeading = document.getElementById('opp-board-heading');
  const inputGuidance = document.getElementById('input-guidance');
  const myBoard = document.getElementById('my-board');
  const opponentBoard = document.getElementById('opponent-board');
  const keyboard = document.getElementById('keyboard');

  // Mobile Board Switcher Tab Elements
  const duelArenaLayout = document.getElementById('duel-arena-layout');
  const tabMyBoard = document.getElementById('tab-my-board');
  const tabOppBoard = document.getElementById('tab-opp-board');
  const mobileTabMyLabel = document.getElementById('mobile-tab-my-label');
  const mobileTabMyChip = document.getElementById('mobile-tab-my-chip');
  const mobileTabOppLabel = document.getElementById('mobile-tab-opp-label');
  const mobileTabOppChip = document.getElementById('mobile-tab-opp-chip');
  const mobileBackToMyBoardBtn = document.getElementById('mobile-back-to-my-board-btn');

  let activeMobileTab = 'my';

  function setMobileBoardTab(tab) {
    activeMobileTab = tab;
    if (tab === 'opp') {
      if (duelArenaLayout) duelArenaLayout.classList.add('show-opp-tab');
      if (tabMyBoard) tabMyBoard.classList.remove('active');
      if (tabOppBoard) tabOppBoard.classList.add('active');
    } else {
      if (duelArenaLayout) duelArenaLayout.classList.remove('show-opp-tab');
      if (tabMyBoard) tabMyBoard.classList.add('active');
      if (tabOppBoard) tabOppBoard.classList.remove('active');
    }
  }

  function updateMobileTabCounters() {
    if (mobileTabMyChip) mobileTabMyChip.textContent = `${currentRow}/6`;
    if (mobileTabOppChip) mobileTabOppChip.textContent = `${opponentRowCount}/6`;
    if (mobileTabMyLabel) mobileTabMyLabel.textContent = 'Your Board';
    if (mobileTabOppLabel) mobileTabOppLabel.textContent = oppPlayerName || 'Opponent';
  }

  if (tabMyBoard) tabMyBoard.addEventListener('click', () => setMobileBoardTab('my'));
  if (tabOppBoard) tabOppBoard.addEventListener('click', () => setMobileBoardTab('opp'));
  if (mobileBackToMyBoardBtn) mobileBackToMyBoardBtn.addEventListener('click', () => setMobileBoardTab('my'));

  // Player Display Name Elements
  const playerNameInput = document.getElementById('player-name-input');
  const randomNameBtn = document.getElementById('random-name-btn');
  const lobbyP1Name = document.getElementById('lobby-p1-name');
  const lobbyP1Sub = document.getElementById('lobby-p1-sub');
  const lobbyP2Slot = document.getElementById('lobby-p2-slot');
  const lobbyP2Name = document.getElementById('lobby-p2-name');
  const lobbyP2Sub = document.getElementById('lobby-p2-sub');
  const lobbyP2Badge = document.getElementById('lobby-p2-badge');
  const roundMyNameLabel = document.getElementById('round-my-name-label');
  const roundOppNameLabel = document.getElementById('round-opp-name-label');
  const duelFinalMyLabel = document.getElementById('duel-final-my-label');
  const duelFinalOppLabel = document.getElementById('duel-final-opp-label');

  // Nickname State & Generator
  const FUN_NAMES = ['SpeedyWord', 'WordWizard', 'LetterNinja', 'LexiconKing', 'CipherPro', 'WordDuelist', 'DailySolver', 'BrainyFox', 'FlashTyper', 'PuzzleAce', 'VowelHunter', 'SyntaxGladiator'];
  function getRandomFunName() {
    return FUN_NAMES[Math.floor(Math.random() * FUN_NAMES.length)];
  }

  function getSavedPlayerName() {
    let saved = localStorage.getItem('wordduel_player_name');
    if (!saved || !saved.trim()) {
      saved = getRandomFunName();
      localStorage.setItem('wordduel_player_name', saved);
    }
    return saved.trim().slice(0, 15);
  }

  let myPlayerName = getSavedPlayerName();
  let oppPlayerName = 'Opponent';

  function setPlayerName(name) {
    const clean = (name || '').trim().slice(0, 15) || 'Player 1';
    myPlayerName = clean;
    localStorage.setItem('wordduel_player_name', clean);
    sessionStorage.setItem('wordduel_player_name', clean);
    if (playerNameInput && playerNameInput.value !== clean) {
      playerNameInput.value = clean;
    }
    updateAllNameElements();
    return clean;
  }

  function updateAllNameElements() {
    if (playerNameInput && document.activeElement !== playerNameInput) {
      playerNameInput.value = myPlayerName;
    }
    if (myScoreLabel) myScoreLabel.textContent = `${myPlayerName} (You)`;
    if (oppScoreLabel) oppScoreLabel.textContent = oppPlayerName;
    if (oppBoardHeading) oppBoardHeading.textContent = `${oppPlayerName}'s Board`;
    if (oppLiveText) oppLiveText.textContent = `${oppPlayerName} LIVE`;
    if (lobbyP1Name) lobbyP1Name.textContent = `${myPlayerName} (You)`;
    if (lobbyP2Name) lobbyP2Name.textContent = (oppPlayerName && oppPlayerName !== 'Opponent') ? oppPlayerName : 'Opponent';
    if (roundMyNameLabel) roundMyNameLabel.textContent = myPlayerName;
    if (roundOppNameLabel) roundOppNameLabel.textContent = oppPlayerName;
    if (duelFinalMyLabel) duelFinalMyLabel.textContent = myPlayerName;
    if (duelFinalOppLabel) duelFinalOppLabel.textContent = oppPlayerName;
    updateMobileTabCounters();
  }

  function updatePlayersFromData(data) {
    if (data && data.players) {
      const myObj = data.players[playerNum];
      const oppObj = data.players[playerNum === 1 ? 2 : 1];
      if (myObj && myObj.name) myPlayerName = myObj.name;
      if (oppObj && oppObj.name) {
        oppPlayerName = oppObj.name;
        if (lobbyP2Slot) {
          lobbyP2Slot.classList.remove('opponent-empty');
          lobbyP2Slot.classList.add('active');
        }
        if (lobbyP2Sub) lobbyP2Sub.textContent = 'Challenger';
        if (lobbyP2Badge) lobbyP2Badge.style.display = 'inline-flex';
      }
    }
    updateAllNameElements();
  }

  // Modals
  const createDuelModal = document.getElementById('create-duel-modal');
  const createDuelForm = document.getElementById('create-duel-form');
  const closeCreateModalBtn = document.getElementById('close-create-modal-btn');
  const modeLabelFixed = document.getElementById('mode-label-fixed');
  const modeLabelUnlimited = document.getElementById('mode-label-unlimited');
  const fixedRoundsConfig = document.getElementById('fixed-rounds-config');
  const presetPills = document.querySelectorAll('.preset-pill');
  const customRoundsInput = document.getElementById('custom-rounds-input');

  const roundOverModal = document.getElementById('round-over-modal');
  const roundResultPill = document.getElementById('round-result-pill');
  const outcomeCrown = document.getElementById('outcome-crown');
  const outcomeTitle = document.getElementById('outcome-title');
  const outcomeSubtitle = document.getElementById('outcome-subtitle');
  const secretWordTiles = document.getElementById('secret-word-tiles');
  const statGuesses = document.getElementById('stat-guesses');
  const statTime = document.getElementById('stat-time');
  const roundMyScore = document.getElementById('round-my-score');
  const roundOppScore = document.getElementById('round-opp-score');
  const oppRecapText = document.getElementById('opp-recap-text');
  const nextRoundBtn = document.getElementById('next-round-btn');
  const nextRoundBtnText = document.getElementById('next-round-btn-text');
  const endDuelBtn = document.getElementById('end-duel-btn');
  const roundModalFootnote = document.getElementById('round-modal-footnote');

  const duelResultsModal = document.getElementById('duel-results-modal');
  const duelFinalCrown = document.getElementById('duel-final-crown');
  const duelFinalTitle = document.getElementById('duel-final-title');
  const duelFinalSubtitle = document.getElementById('duel-final-subtitle');
  const duelFinalMyScore = document.getElementById('duel-final-my-score');
  const duelFinalOppScore = document.getElementById('duel-final-opp-score');
  const duelWordsHistoryList = document.getElementById('duel-words-history-list');
  const rematchBtn = document.getElementById('rematch-btn');
  const rematchBtnText = document.getElementById('rematch-btn-text');
  const backToHomeBtn = document.getElementById('back-to-home-btn');

  const joinCodeModal = document.getElementById('join-code-modal');
  const joinCodeForm = document.getElementById('join-code-form');
  const modalCodeInput = document.getElementById('modal-code-input');
  const closeJoinModalBtn = document.getElementById('close-join-modal-btn');

  const rulesModal = document.getElementById('rules-modal');
  const closeRulesBtn = document.getElementById('close-rules-btn');
  const roomFullBackBtn = document.getElementById('room-full-back-btn');

  // --- Socket.io Client ---
  const socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  // Fetch word list for Bot mode
  fetch('/common_five_letter_words.txt')
    .then(r => {
      if (r.ok) return r.text();
      return fetch('/words.json').then(res => res.json());
    })
    .then(data => {
      if (typeof data === 'string') {
        const words = data.split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(w => w.length === 5);
        localWords.answers = words;
        localWords.allowed = words;
      } else if (data && data.answers) {
        localWords = data;
      }
    })
    .catch(() => {});

  // --- Haptic Feedback for Android ---
  function triggerHaptic(type = 'light') {
    if (!navigator.vibrate) return;
    if (type === 'light') navigator.vibrate(12);
    else if (type === 'error') navigator.vibrate([30, 40, 30]);
    else if (type === 'win') navigator.vibrate([60, 80, 140]);
  }

  // --- Toast Notification ---
  function showToast(message, duration = 2000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration);
  }

  // --- Screen View Switcher ---
  function switchView(viewName) {
    [viewHome, viewWaiting, viewRoomFull, viewGame].forEach(v => v.classList.remove('active'));

    if (viewName === 'home') {
      viewHome.classList.add('active');
      headerRoomPill.style.display = 'none';
      headerTimerPill.style.display = 'none';
      leaveRoomHeaderBtn.style.display = 'none';
    } else if (viewName === 'waiting') {
      viewWaiting.classList.add('active');
      headerRoomPill.style.display = 'flex';
      headerTimerPill.style.display = 'none';
      leaveRoomHeaderBtn.style.display = 'none';
    } else if (viewName === 'game') {
      viewGame.classList.add('active');
      headerRoomPill.style.display = 'flex';
      headerTimerPill.style.display = 'flex';
      leaveRoomHeaderBtn.style.display = 'block';
    } else if (viewName === 'room-full') {
      viewRoomFull.classList.add('active');
      headerRoomPill.style.display = 'none';
      headerTimerPill.style.display = 'none';
      leaveRoomHeaderBtn.style.display = 'none';
    }

    refreshGoogleAds();
  }

  // --- Safe Google AdSense Refresh Helper ---
  function refreshGoogleAds() {
    try {
      if (window.adsbygoogle && typeof window.adsbygoogle.push === 'function') {
        const adSlots = document.querySelectorAll('.ad-slot-content ins.adsbygoogle');
        adSlots.forEach((slot) => {
          // Push ad unit only if not already loaded
          if (!slot.getAttribute('data-adsbygoogle-status')) {
            window.adsbygoogle.push({});
          }
        });
      }
    } catch {
      // Continue uninterrupted if ad blocker is active or offline
    }
  }

  // --- Stopwatch Timer ---
  function startStopwatch(serverStartTime) {
    stopStopwatch();
    matchStartTime = serverStartTime || Date.now();
    elapsedSeconds = Math.max(0, Math.floor((Date.now() - matchStartTime) / 1000));
    updateTimerDisplay();

    timerInterval = setInterval(() => {
      elapsedSeconds++;
      updateTimerDisplay();
    }, 1000);
  }

  function stopStopwatch() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimerDisplay() {
    const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const secs = String(elapsedSeconds % 60).padStart(2, '0');
    matchTimerEl.textContent = `${mins}:${secs}`;
  }

  // --- Generate 5-character Room Code ---
  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // --- Board Grid Construction ---
  function initBoards() {
    myBoard.innerHTML = '';
    opponentBoard.innerHTML = '';

    // Player Board (6 rows x 5 tiles)
    for (let r = 0; r < 6; r++) {
      const row = document.createElement('div');
      row.className = 'board-row';
      row.setAttribute('data-row', r);

      for (let c = 0; c < 5; c++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.id = `my-tile-${r}-${c}`;
        row.appendChild(tile);
      }
      myBoard.appendChild(row);
    }

    // Opponent Mini Board (6 rows x 5 color tiles)
    for (let r = 0; r < 6; r++) {
      const row = document.createElement('div');
      row.className = 'board-row';
      row.setAttribute('data-row', r);

      for (let c = 0; c < 5; c++) {
        const miniTile = document.createElement('div');
        miniTile.className = 'mini-tile';
        miniTile.id = `opp-tile-${r}-${c}`;
        row.appendChild(miniTile);
      }
      opponentBoard.appendChild(row);
    }
  }

  // --- Update Score and Round Pill Headers ---
  function updateRoundAndScoreDisplay() {
    if (roundsMode === 'unlimited') {
      arenaRoundPill.textContent = `Round ${currentRound}`;
      if (lobbyRoundsChip) lobbyRoundsChip.textContent = 'Unlimited';
    } else {
      arenaRoundPill.textContent = `Round ${currentRound} / ${totalRounds || 3}`;
      if (lobbyRoundsChip) lobbyRoundsChip.textContent = `${totalRounds || 3} Rounds`;
    }

    const myPts = playerNum === 1 ? (scores.player1 || 0) : (scores.player2 || 0);
    const oppPts = playerNum === 1 ? (scores.player2 || 0) : (scores.player1 || 0);
    runningScoreBadge.textContent = `${myPts} - ${oppPts}`;
  }

  // --- Reset Round State (Clean boards, colors, guess counters) ---
  function resetRoundState() {
    currentRow = 0;
    currentCol = 0;
    currentGuess = '';
    isLocked = false;
    opponentRowCount = 0;

    myGuessesCount.textContent = '0 / 6 guesses';
    oppGuessesCount.textContent = '0 / 6 guesses';
    oppTagCount.textContent = '0 / 6 guesses';
    currentGuessPhase.textContent = 'Guess 1 of 6';
    inputGuidance.textContent = 'Five letters. Hit Enter when you\'re ready.';
    oppActionMsg.textContent = 'Ready. Set. Guess.';
    nextRoundBtnText.textContent = 'Next Round';
    nextRoundBtn.disabled = false;
    roundOverModal.style.display = 'none';
    duelResultsModal.style.display = 'none';
    disconnectBanner.style.display = 'none';

    updateRoundAndScoreDisplay();
    initBoards();
    setMobileBoardTab('my');
    updateMobileTabCounters();

    // Reset keyboard key states
    for (const k in letterStatuses) delete letterStatuses[k];
    const allKeys = keyboard.querySelectorAll('.key');
    allKeys.forEach(k => k.classList.remove('green', 'yellow', 'grey'));
  }

  // --- 3, 2, 1 Countdown Animation ---
  function playRoundCountdown(roundNum, onDone) {
    roundCountdownOverlay.style.display = 'flex';
    countdownRoundLabel.textContent = `ROUND ${roundNum}`;
    let remaining = 3;
    countdownNumber.textContent = remaining;

    const interval = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        countdownNumber.textContent = remaining;
      } else {
        clearInterval(interval);
        countdownNumber.textContent = 'GO!';
        setTimeout(() => {
          roundCountdownOverlay.style.display = 'none';
          if (onDone) onDone();
        }, 600);
      }
    }, 800);
  }

  // --- Input & Keyboard Controls ---
  function handleInput(key) {
    if (activeMobileTab === 'opp') {
      setMobileBoardTab('my');
    }
    if (isLocked || gameStatus !== 'playing') return;

    if (key === 'ENTER') {
      submitCurrentGuess();
    } else if (key === 'BACKSPACE') {
      removeLetter();
    } else if (/^[A-Z]$/.test(key)) {
      addLetter(key);
    }
  }

  function addLetter(letter) {
    if (currentCol < 5) {
      triggerHaptic('light');
      const tile = document.getElementById(`my-tile-${currentRow}-${currentCol}`);
      if (tile) {
        tile.textContent = letter;
        tile.classList.add('filled');
        currentGuess += letter;
        currentCol++;
      }
    }
  }

  function removeLetter() {
    if (currentCol > 0) {
      triggerHaptic('light');
      currentCol--;
      const tile = document.getElementById(`my-tile-${currentRow}-${currentCol}`);
      if (tile) {
        tile.textContent = '';
        tile.classList.remove('filled');
        currentGuess = currentGuess.slice(0, -1);
      }
    }
  }

  function submitCurrentGuess() {
    if (currentGuess.length < 5) {
      triggerHaptic('error');
      shakeCurrentRow();
      showToast('Not enough letters');
      return;
    }

    isLocked = true;
    inputGuidance.textContent = 'Checking your guess…';

    if (gameMode === 'online') {
      socket.emit('submit_guess', {
        roomId: currentRoomId,
        playerId: playerId,
        guess: currentGuess
      });
    } else if (gameMode === 'bot') {
      evaluateBotGameGuess(currentGuess);
    }
  }

  function shakeCurrentRow() {
    const rowEl = myBoard.querySelector(`.board-row[data-row="${currentRow}"]`);
    if (rowEl) {
      rowEl.classList.remove('shake');
      void rowEl.offsetWidth;
      rowEl.classList.add('shake');
      setTimeout(() => rowEl.classList.remove('shake'), 500);
    }
  }

  // Sequential 3D Tile Flip Animation
  function animateRowFlip(rowIdx, guess, evaluation, onFinished) {
    const letters = guess.toUpperCase().split('');
    const stepDelay = 220;

    for (let c = 0; c < 5; c++) {
      const tile = document.getElementById(`my-tile-${rowIdx}-${c}`);
      const color = evaluation[c];
      const letter = letters[c];

      setTimeout(() => {
        if (!tile) return;
        tile.classList.add('flip');

        setTimeout(() => {
          tile.classList.add(color);
          updateKeyboardColor(letter, color);
        }, 250);

        if (c === 4 && onFinished) {
          setTimeout(onFinished, 280);
        }
      }, c * stepDelay);
    }
  }

  // Keyboard Color Updates (Green > Yellow > Grey)
  function updateKeyboardColor(letter, color) {
    const current = letterStatuses[letter];
    if (current === 'green') return;
    if (current === 'yellow' && color === 'grey') return;

    letterStatuses[letter] = color;
    const keyBtn = keyboard.querySelector(`.key[data-key="${letter}"]`);
    if (keyBtn) {
      keyBtn.classList.remove('green', 'yellow', 'grey');
      keyBtn.classList.add(color);
    }
  }

  // Native Share / Clipboard Fallback for Room Code
  function shareRoomCode(code) {
    const textToShare = (code || currentRoomId || '').trim();
    if (!textToShare) return;

    if (navigator.share) {
      navigator.share({
        title: 'WORDDUEL — Room Code',
        text: `Duel me in WORDDUEL! Room Code: ${textToShare}`
      }).catch((err) => {
        if (err && err.name !== 'AbortError') {
          copyCodeToClipboard(textToShare);
        }
      });
    } else {
      copyCodeToClipboard(textToShare);
    }
  }

  function copyCodeToClipboard(code) {
    const textToCopy = (code || currentRoomId || '').trim();
    if (!textToCopy) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        showToast(`Room code copied: ${textToCopy}`);
      }).catch(() => fallbackCopy(textToCopy));
    } else {
      fallbackCopy(textToCopy);
    }
  }

  function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.focus();
    input.select();
    try {
      document.execCommand('copy');
      showToast(`Room code copied: ${text}`);
    } catch {
      showToast('Room Code: ' + text);
    }
    document.body.removeChild(input);
  }

  // --- Online Room Joining ---
  function enterOnlineRoom(roomId, roomConfig) {
    gameMode = 'online';
    currentRoomId = roomId.toUpperCase();
    headerRoomCode.textContent = currentRoomId;
    lobbyCodeText.textContent = currentRoomId;

    if (roomConfig) {
      roundsMode = roomConfig.roundsMode;
      totalRounds = roomConfig.totalRounds;
    }

    const targetUrl = `/room/${currentRoomId}`;
    if (window.location.pathname !== targetUrl) {
      window.history.pushState(null, '', targetUrl);
    }

    socket.emit('join_room', {
      roomId: currentRoomId,
      playerId: playerId,
      playerName: myPlayerName,
      roundsMode: roomConfig ? roomConfig.roundsMode : undefined,
      totalRounds: roomConfig ? roomConfig.totalRounds : undefined
    });
  }

  // --- Mode 2: Play vs Bot (Solo Practice) ---
  function startBotGame() {
    gameMode = 'bot';
    currentRoomId = 'BOT-ARENA';
    headerRoomCode.textContent = 'VS BOT';
    playerNum = 1;
    roundsMode = 'unlimited';
    totalRounds = null;
    currentRound = 1;
    scores = { player1: 0, player2: 0 };
    wordsHistory = [];
    botUsedWords = [];
    oppPlayerName = 'Bot AI 🤖';

    pickBotWord();
    resetRoundState();
    switchView('game');
    updateAllNameElements();

    playRoundCountdown(currentRound, () => {
      gameStatus = 'playing';
      startStopwatch();
      oppActionMsg.textContent = 'Thinking of their first word…';
      showToast('Match started against Bot! Good luck!', 2000);
      scheduleBotGuess();
    });
  }

  function pickBotWord() {
    const answers = localWords.answers && localWords.answers.length > 0 ? localWords.answers : ['crane', 'slate', 'roast', 'react', 'audio'];
    const usedSet = new Set(botUsedWords);
    let available = answers.filter(w => !usedSet.has(w));
    if (available.length === 0) {
      botUsedWords = [];
      available = answers.slice();
    }
    const chosen = available[Math.floor(Math.random() * available.length)];
    botUsedWords.push(chosen);
    botSecretWord = chosen;
    return chosen;
  }

  function scheduleBotGuess() {
    if (gameStatus !== 'playing') return;
    const thinkingDelay = Math.floor(Math.random() * 4000) + 4000;

    botInterval = setTimeout(() => {
      if (gameStatus !== 'playing') return;
      makeBotGuess();
    }, thinkingDelay);
  }

  function makeBotGuess() {
    if (opponentRowCount >= 6 || gameStatus !== 'playing') return;

    oppActionMsg.textContent = 'Submitting guess…';
    const row = opponentRowCount;
    opponentRowCount++;

    oppGuessesCount.textContent = `${opponentRowCount} / 6 guesses`;
    oppTagCount.textContent = `${opponentRowCount} / 6 guesses`;
    updateMobileTabCounters();

    let botGuessWord = localWords.answers[Math.floor(Math.random() * localWords.answers.length)] || 'slate';
    if (row >= 4 && Math.random() > 0.45) {
      botGuessWord = botSecretWord;
    }

    const evaluation = evaluateOffline(botGuessWord, botSecretWord);
    for (let c = 0; c < 5; c++) {
      const miniTile = document.getElementById(`opp-tile-${row}-${c}`);
      if (miniTile) {
        setTimeout(() => miniTile.classList.add(evaluation[c]), c * 80);
      }
    }

    const botWon = evaluation.every(c => c === 'green');
    if (botWon) {
      gameStatus = 'round_ended';
      stopStopwatch();
      scores.player2 = (scores.player2 || 0) + 1;
      wordsHistory.push({ round: currentRound, word: botSecretWord, winnerPlayerNum: 2, isDraw: false });
      setTimeout(() => {
        showRoundOverModal({
          currentRound,
          totalRounds: null,
          roundsMode: 'unlimited',
          winnerPlayerNum: 2,
          isDraw: false,
          secretWord: botSecretWord,
          reason: 'Bot solved the word first!',
          scores,
          isDuelOver: false
        });
      }, 800);
    } else if (opponentRowCount >= 6 && currentRow >= 6) {
      gameStatus = 'round_ended';
      stopStopwatch();
      wordsHistory.push({ round: currentRound, word: botSecretWord, winnerPlayerNum: null, isDraw: true });
      showRoundOverModal({
        currentRound,
        totalRounds: null,
        roundsMode: 'unlimited',
        winnerPlayerNum: null,
        isDraw: true,
        secretWord: botSecretWord,
        reason: 'Both players used all 6 attempts.',
        scores,
        isDuelOver: false
      });
    } else {
      oppActionMsg.textContent = 'Finding their next word…';
      scheduleBotGuess();
    }
  }

  function evaluateOffline(guess, target) {
    const result = Array(5).fill('grey');
    const tChars = target.split('');
    const gChars = guess.split('');
    const counts = {};

    for (const c of tChars) counts[c] = (counts[c] || 0) + 1;

    for (let i = 0; i < 5; i++) {
      if (gChars[i] === tChars[i]) {
        result[i] = 'green';
        counts[gChars[i]]--;
      }
    }

    for (let i = 0; i < 5; i++) {
      if (result[i] !== 'green') {
        const c = gChars[i];
        if (counts[c] && counts[c] > 0) {
          result[i] = 'yellow';
          counts[c]--;
        }
      }
    }
    return result;
  }

  function evaluateBotGameGuess(guess) {
    const clean = guess.toLowerCase();
    const evaluation = evaluateOffline(clean, botSecretWord);
    const row = currentRow;

    animateRowFlip(row, clean, evaluation, () => {
      currentRow++;
      currentCol = 0;
      currentGuess = '';
      myGuessesCount.textContent = `${currentRow} / 6 guesses`;
      currentGuessPhase.textContent = `Guess ${Math.min(6, currentRow + 1)} of 6`;

      const won = evaluation.every(c => c === 'green');
      if (won) {
        gameStatus = 'round_ended';
        stopStopwatch();
        triggerHaptic('win');
        scores.player1 = (scores.player1 || 0) + 1;
        wordsHistory.push({ round: currentRound, word: botSecretWord, winnerPlayerNum: 1, isDraw: false });
        setTimeout(() => {
          showRoundOverModal({
            currentRound,
            totalRounds: null,
            roundsMode: 'unlimited',
            winnerPlayerNum: 1,
            isDraw: false,
            secretWord: botSecretWord,
            reason: 'You solved the word first!',
            scores,
            isDuelOver: false
          });
        }, 600);
      } else if (currentRow >= 6) {
        if (opponentRowCount >= 6) {
          gameStatus = 'round_ended';
          stopStopwatch();
          wordsHistory.push({ round: currentRound, word: botSecretWord, winnerPlayerNum: null, isDraw: true });
          showRoundOverModal({
            currentRound,
            totalRounds: null,
            roundsMode: 'unlimited',
            winnerPlayerNum: null,
            isDraw: true,
            secretWord: botSecretWord,
            reason: 'Both players used all 6 attempts.',
            scores,
            isDuelOver: false
          });
        } else {
          isLocked = true;
          inputGuidance.textContent = 'You used all 6 guesses. Waiting for bot…';
        }
      } else {
        isLocked = false;
        inputGuidance.textContent = 'Five letters. Hit Enter when you\'re ready.';
      }
    });
  }

  // --- UI Event Handlers ---
  createGameBtn.addEventListener('click', () => {
    createDuelModal.style.display = 'flex';
  });

  closeCreateModalBtn.addEventListener('click', () => {
    createDuelModal.style.display = 'none';
  });

  // Toggle rounds mode in Create Modal
  modeLabelFixed.addEventListener('click', () => {
    modeLabelFixed.classList.add('active');
    modeLabelUnlimited.classList.remove('active');
    modeLabelFixed.querySelector('input').checked = true;
    fixedRoundsConfig.style.display = 'block';
  });

  modeLabelUnlimited.addEventListener('click', () => {
    modeLabelUnlimited.classList.add('active');
    modeLabelFixed.classList.remove('active');
    modeLabelUnlimited.querySelector('input').checked = true;
    fixedRoundsConfig.style.display = 'none';
  });

  // Preset round pills
  presetPills.forEach(pill => {
    pill.addEventListener('click', () => {
      presetPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      customRoundsInput.value = pill.getAttribute('data-rounds');
    });
  });

  customRoundsInput.addEventListener('input', () => {
    const val = customRoundsInput.value;
    presetPills.forEach(p => {
      if (p.getAttribute('data-rounds') === val) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });
  });

  createDuelForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = createDuelForm.querySelector('input[name="roundsMode"]:checked').value;
    let selectedTotal = 3;
    if (mode === 'fixed') {
      const parsed = parseInt(customRoundsInput.value, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 20) {
        selectedTotal = parsed;
      } else {
        selectedTotal = 3;
      }
    } else {
      selectedTotal = null;
    }

    createDuelModal.style.display = 'none';
    const code = generateRoomCode();
    enterOnlineRoom(code, { roundsMode: mode, totalRounds: selectedTotal });
  });

  openJoinModalBtn.addEventListener('click', () => {
    joinCodeModal.style.display = 'flex';
    modalCodeInput.value = '';
    modalCodeInput.focus();
  });

  closeJoinModalBtn.addEventListener('click', () => {
    joinCodeModal.style.display = 'none';
  });

  joinCodeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = modalCodeInput.value.trim().toUpperCase();
    if (code.length >= 4) {
      joinCodeModal.style.display = 'none';
      enterOnlineRoom(code);
    } else {
      showToast('Enter a valid code');
    }
  });

  playBotBtn.addEventListener('click', () => {
    oppPlayerName = 'Bot AI 🤖';
    startBotGame();
  });

  sameDeviceBtn.addEventListener('click', () => {
    oppPlayerName = 'Player 2';
    startBotGame();
  });

  if (playerNameInput) {
    playerNameInput.value = myPlayerName;
    playerNameInput.addEventListener('input', (e) => {
      setPlayerName(e.target.value);
    });
    playerNameInput.addEventListener('blur', (e) => {
      if (!e.target.value.trim()) {
        setPlayerName(getRandomFunName());
      }
    });
  }

  if (randomNameBtn) {
    randomNameBtn.addEventListener('click', () => {
      setPlayerName(getRandomFunName());
      triggerHaptic('light');
    });
  }

  if (copyInviteBtn) {
    copyInviteBtn.addEventListener('click', () => {
      copyCodeToClipboard(currentRoomId);
    });
  }

  if (nativeShareBtn) {
    nativeShareBtn.addEventListener('click', () => {
      shareRoomCode(currentRoomId);
    });
  }

  lobbyLeaveBtn.addEventListener('click', () => {
    window.location.href = '/';
  });

  leaveRoomHeaderBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this duel?')) {
      if (gameMode === 'online') {
        socket.emit('end_duel', { roomId: currentRoomId, playerId });
      }
      window.location.href = '/';
    }
  });

  roomFullBackBtn.addEventListener('click', () => {
    window.location.href = '/';
  });

  backToHomeBtn.addEventListener('click', () => {
    window.location.href = '/';
  });

  howToPlayBtn.addEventListener('click', () => {
    rulesModal.style.display = 'flex';
  });

  closeRulesBtn.addEventListener('click', () => {
    rulesModal.style.display = 'none';
  });

  // Next round click
  nextRoundBtn.addEventListener('click', () => {
    if (gameMode === 'bot') {
      roundOverModal.style.display = 'none';
      currentRound++;
      pickBotWord();
      resetRoundState();
      playRoundCountdown(currentRound, () => {
        gameStatus = 'playing';
        startStopwatch();
        scheduleBotGuess();
      });
    } else {
      nextRoundBtn.disabled = true;
      nextRoundBtnText.textContent = 'Waiting for opponent…';
      socket.emit('request_next_round', { roomId: currentRoomId, playerId });
    }
  });

  // End duel click
  endDuelBtn.addEventListener('click', () => {
    if (gameMode === 'bot') {
      roundOverModal.style.display = 'none';
      showFinalDuelResults({
        duelWinnerPlayerNum: scores.player1 > scores.player2 ? 1 : (scores.player2 > scores.player1 ? 2 : null),
        isDraw: scores.player1 === scores.player2,
        reason: 'Duel ended.',
        scores: { player1: scores.player1, player2: scores.player2 },
        roundsPlayed: currentRound,
        roundsMode: 'unlimited',
        totalRounds: null,
        wordsHistory: wordsHistory
      });
    } else {
      socket.emit('end_duel', { roomId: currentRoomId, playerId });
    }
  });

  // Rematch / Play again from duel end
  rematchBtn.addEventListener('click', () => {
    if (gameMode === 'bot') {
      startBotGame();
    } else {
      rematchBtn.disabled = true;
      rematchBtnText.textContent = 'Waiting for opponent…';
      socket.emit('request_rematch', { roomId: currentRoomId, playerId });
    }
  });

  // Tactile Key Pop Animation
  function triggerKeyPop(keyVal) {
    if (!keyVal) return;
    const keyEl = keyboard.querySelector(`.key[data-key="${keyVal}"]`);
    if (keyEl) {
      keyEl.classList.remove('key-pop');
      void keyEl.offsetWidth; // Force CSS reflow to replay animation
      keyEl.classList.add('key-pop');
      setTimeout(() => {
        keyEl.classList.remove('key-pop');
      }, 160);
    }
  }

  // Physical Keyboard Listener
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement === modalCodeInput || document.activeElement === customRoundsInput || document.activeElement === playerNameInput) return;

    let keyVal = null;
    if (e.key === 'Enter') keyVal = 'ENTER';
    else if (e.key === 'Backspace') keyVal = 'BACKSPACE';
    else if (/^[a-zA-Z]$/.test(e.key)) keyVal = e.key.toUpperCase();

    if (keyVal) {
      triggerKeyPop(keyVal);
      handleInput(keyVal);
    }
  });

  // Virtual Keyboard (optimized with pointerdown for 0ms delay on touch/iOS)
  let lastVirtualPointerTime = 0;
  keyboard.addEventListener('pointerdown', (e) => {
    const keyEl = e.target.closest('.key');
    if (!keyEl) return;
    e.preventDefault(); // Prevents simulated 300ms click delay & text selection
    lastVirtualPointerTime = Date.now();
    const keyVal = keyEl.getAttribute('data-key');
    if (keyVal) {
      triggerKeyPop(keyVal);
      handleInput(keyVal);
    }
  });

  // Fallback click listener for browsers without pointerdown support
  keyboard.addEventListener('click', (e) => {
    if (Date.now() - lastVirtualPointerTime < 350) return; // Prevent double trigger
    const keyEl = e.target.closest('.key');
    if (!keyEl) return;
    const keyVal = keyEl.getAttribute('data-key');
    if (keyVal) {
      triggerKeyPop(keyVal);
      handleInput(keyVal);
    }
  });

  // --- Socket.io Gameplay Handlers ---

  socket.on('room_joined', (data) => {
    playerNum = data.playerNum;
    gameStatus = 'waiting';
    roundsMode = data.roundsMode || 'fixed';
    totalRounds = data.totalRounds || 3;
    if (lobbyRoundsChip) {
      lobbyRoundsChip.textContent = roundsMode === 'unlimited' ? 'Unlimited' : `${totalRounds} Rounds`;
    }
    updatePlayersFromData(data);
    switchView('waiting');
  });

  socket.on('opponent_joined', (data) => {
    roundsMode = data.roundsMode;
    totalRounds = data.totalRounds;
    if (lobbyRoundsChip) {
      lobbyRoundsChip.textContent = roundsMode === 'unlimited' ? 'Unlimited' : `${totalRounds} Rounds`;
    }
    updatePlayersFromData(data);
    showToast(`${oppPlayerName} joined! Duel starting…`);
  });

  socket.on('room_full', () => {
    switchView('room-full');
  });

  socket.on('round_countdown', (data) => {
    currentRound = data.currentRound;
    totalRounds = data.totalRounds;
    roundsMode = data.roundsMode;
    scores = data.score || scores;
    gameStatus = 'countdown';

    updatePlayersFromData(data);

    resetRoundState();
    switchView('game');
    playRoundCountdown(currentRound);
  });

  socket.on('round_start', (data) => {
    gameStatus = 'playing';
    currentRound = data.currentRound;
    totalRounds = data.totalRounds;
    roundsMode = data.roundsMode;
    scores = data.score || scores;

    updatePlayersFromData(data);
    roundCountdownOverlay.style.display = 'none';
    updateRoundAndScoreDisplay();
    startStopwatch(data.startTime);
    showToast(`Round ${currentRound} started!`, 1800);
  });

  socket.on('game_state_sync', (state) => {
    playerNum = state.playerNum;
    gameStatus = state.status;
    headerRoomCode.textContent = state.roomId;
    roundsMode = state.roundsMode || 'fixed';
    totalRounds = state.totalRounds || 3;
    currentRound = state.currentRound || 1;
    scores = { player1: state.scores[1] || 0, player2: state.scores[2] || 0 };
    wordsHistory = state.wordsHistory || [];
    updatePlayersFromData(state);

    if (state.status === 'waiting') {
      if (lobbyRoundsChip) {
        lobbyRoundsChip.textContent = roundsMode === 'unlimited' ? 'Unlimited' : `${totalRounds} Rounds`;
      }
      switchView('waiting');
      return;
    }

    resetRoundState();
    switchView('game');
    startStopwatch(state.startTime);

    // Restore self guesses
    state.myGuesses.forEach((g, rIdx) => {
      const letters = g.word.toUpperCase().split('');
      for (let c = 0; c < 5; c++) {
        const t = document.getElementById(`my-tile-${rIdx}-${c}`);
        if (t) {
          t.textContent = letters[c];
          t.classList.add('filled', g.evaluation[c]);
          updateKeyboardColor(letters[c], g.evaluation[c]);
        }
      }
    });

    currentRow = state.myGuesses.length;
    myGuessesCount.textContent = `${currentRow} / 6 guesses`;
    currentGuessPhase.textContent = `Guess ${Math.min(6, currentRow + 1)} of 6`;

    // Restore opponent guesses
    state.opponentGuesses.forEach((oppG, rIdx) => {
      for (let c = 0; c < 5; c++) {
        const mt = document.getElementById(`opp-tile-${rIdx}-${c}`);
        if (mt) mt.classList.add(oppG.evaluation[c]);
      }
    });

    opponentRowCount = state.opponentGuesses.length;
    oppGuessesCount.textContent = `${opponentRowCount} / 6 guesses`;
    oppTagCount.textContent = `${opponentRowCount} / 6 guesses`;

    if (state.status === 'round_ended') {
      stopStopwatch();
      showRoundOverModal({
        currentRound,
        totalRounds,
        roundsMode,
        winnerPlayerNum: state.roundWinnerPlayerNum,
        isDraw: !state.roundWinnerPlayerNum,
        secretWord: state.secretWord,
        scores,
        isDuelOver: false
      });
      if (state.nextRoundRequested) {
        nextRoundBtn.disabled = true;
        nextRoundBtnText.textContent = 'Waiting for opponent…';
      }
    }
  });

  socket.on('guess_error', (data) => {
    triggerHaptic('error');
    shakeCurrentRow();
    showToast(data.message || 'Invalid guess');
    isLocked = false;
    inputGuidance.textContent = 'Five letters. Hit Enter when you\'re ready.';
  });

  socket.on('guess_result', (data) => {
    const { guess, evaluation, row } = data;
    animateRowFlip(row, guess, evaluation, () => {
      currentRow++;
      currentCol = 0;
      currentGuess = '';
      myGuessesCount.textContent = `${currentRow} / 6 guesses`;
      currentGuessPhase.textContent = `Guess ${Math.min(6, currentRow + 1)} of 6`;
      updateMobileTabCounters();

      if (currentRow < 6 && gameStatus === 'playing') {
        isLocked = false;
        inputGuidance.textContent = 'Five letters. Hit Enter when you\'re ready.';
      }
    });
  });

  socket.on('opponent_guess_result', (data) => {
    const { evaluation, row } = data;
    opponentRowCount = row + 1;
    oppGuessesCount.textContent = `${opponentRowCount} / 6 guesses`;
    oppTagCount.textContent = `${opponentRowCount} / 6 guesses`;
    oppActionMsg.textContent = `${oppPlayerName} submitted guess ${opponentRowCount}/6!`;
    updateMobileTabCounters();

    for (let c = 0; c < 5; c++) {
      const mt = document.getElementById(`opp-tile-${row}-${c}`);
      if (mt) {
        setTimeout(() => mt.classList.add(evaluation[c]), c * 90);
      }
    }

    setTimeout(() => {
      if (gameStatus === 'playing') oppActionMsg.textContent = `${oppPlayerName} is thinking of their next word…`;
    }, 2800);
  });

  socket.on('player_finished_round', (data) => {
    inputGuidance.textContent = data.message;
    isLocked = true;
  });

  // Round Over Handler
  socket.on('round_over', (data) => {
    gameStatus = 'round_ended';
    isLocked = true;
    stopStopwatch();
    scores = data.scores || scores;
    wordsHistory = data.wordsHistory || wordsHistory;
    updatePlayersFromData(data);

    setTimeout(() => {
      showRoundOverModal(data);
    }, 1100);
  });

  function showRoundOverModal(data) {
    const { currentRound: rNum, winnerPlayerNum, isDraw, secretWord, reason, scores: rScores, isDuelOver } = data;
    secretWordTiles.innerHTML = '';

    if (secretWord) {
      secretWord.toUpperCase().split('').forEach(char => {
        const t = document.createElement('div');
        t.className = 'secret-tile';
        t.textContent = char;
        secretWordTiles.appendChild(t);
      });
    }

    statGuesses.textContent = `${currentRow} / 6`;
    const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const secs = String(elapsedSeconds % 60).padStart(2, '0');
    statTime.textContent = `${mins}:${secs}`;

    const myPts = playerNum === 1 ? (rScores.player1 || 0) : (rScores.player2 || 0);
    const oppPts = playerNum === 1 ? (rScores.player2 || 0) : (rScores.player1 || 0);
    roundMyScore.textContent = myPts;
    roundOppScore.textContent = oppPts;

    roundResultPill.textContent = `ROUND ${rNum} RESULT`;
    const isWinner = winnerPlayerNum === playerNum;

    if (isDraw) {
      outcomeCrown.innerHTML = '<span class="material-symbols-rounded crown-icon">handshake</span>';
      outcomeTitle.textContent = "Round Draw!";
      outcomeSubtitle.textContent = reason || 'Both players used all 6 guesses.';
      oppRecapText.textContent = `Both players matched at ${currentRow} attempts.`;
    } else if (isWinner) {
      triggerHaptic('win');
      outcomeCrown.innerHTML = '<span class="material-symbols-rounded crown-icon">emoji_events</span>';
      outcomeTitle.textContent = 'Round Won!';
      outcomeSubtitle.textContent = 'Quick mind. Faster finish.';
      oppRecapText.textContent = `${oppPlayerName} · ${opponentRowCount} guesses · Still searching`;
    } else {
      outcomeCrown.innerHTML = '<span class="material-symbols-rounded crown-icon">sentiment_dissatisfied</span>';
      outcomeTitle.textContent = 'Round Lost';
      outcomeSubtitle.textContent = reason || `${oppPlayerName} solved the secret word first!`;
      oppRecapText.textContent = `${oppPlayerName} reached the finish line first!`;
    }

    if (isDuelOver) {
      nextRoundBtn.style.display = 'none';
      endDuelBtn.style.display = 'none';
      roundModalFootnote.textContent = 'Fixed rounds complete. Preparing final results…';
    } else {
      nextRoundBtn.style.display = 'block';
      endDuelBtn.style.display = 'block';
      nextRoundBtn.disabled = false;
      nextRoundBtnText.textContent = 'Next Round';
      roundModalFootnote.textContent = 'Both players must click Next Round to start together.';
    }

    roundOverModal.style.display = 'flex';
    refreshGoogleAds();
  }

  socket.on('next_round_status', () => {
    nextRoundBtn.disabled = true;
    nextRoundBtnText.textContent = 'Waiting for opponent…';
  });

  socket.on('opponent_ready_next_round', () => {
    showToast(`${oppPlayerName} is ready for Next Round! Click Next Round to start.`);
  });

  // Final Duel Over Handler
  socket.on('duel_finished', (data) => {
    gameStatus = 'duel_ended';
    isLocked = true;
    stopStopwatch();
    updatePlayersFromData(data);
    roundOverModal.style.display = 'none';
    showFinalDuelResults(data);
  });

  function showFinalDuelResults(data) {
    const { duelWinnerPlayerNum, isDraw, reason, scores: fScores, wordsHistory: fHistory } = data;

    const myPts = playerNum === 1 ? (fScores.player1 || 0) : (fScores.player2 || 0);
    const oppPts = playerNum === 1 ? (fScores.player2 || 0) : (fScores.player1 || 0);
    duelFinalMyScore.textContent = myPts;
    duelFinalOppScore.textContent = oppPts;

    const isWinner = duelWinnerPlayerNum === playerNum;

    if (isDraw) {
      duelFinalCrown.innerHTML = '<span class="material-symbols-rounded crown-icon">handshake</span>';
      duelFinalTitle.textContent = "Duel Drawn!";
      duelFinalSubtitle.textContent = reason || 'Both gladiators tied in round wins.';
    } else if (isWinner) {
      triggerHaptic('win');
      duelFinalCrown.innerHTML = '<span class="material-symbols-rounded crown-icon">emoji_events</span>';
      duelFinalTitle.textContent = 'Duel Champion!';
      duelFinalSubtitle.textContent = reason || 'You won the overall duel!';
    } else {
      duelFinalCrown.innerHTML = '<span class="material-symbols-rounded crown-icon">military_tech</span>';
      duelFinalTitle.textContent = 'Duel Defeat';
      duelFinalSubtitle.textContent = reason || `${oppPlayerName} won the overall duel.`;
    }

    // Populate words history
    duelWordsHistoryList.innerHTML = '';
    const historyToRender = fHistory || wordsHistory;
    if (historyToRender && historyToRender.length > 0) {
      historyToRender.forEach(h => {
        const item = document.createElement('div');
        item.className = 'history-item';

        let winLabel = 'Draw';
        if (h.winnerPlayerNum) {
          winLabel = h.winnerPlayerNum === playerNum ? `${myPlayerName} won` : `${oppPlayerName} won`;
        }

        item.innerHTML = `
          <span class="history-item-round">R${h.round}</span>
          <span class="history-item-word">${h.word.toUpperCase()}</span>
          <span class="history-item-winner">${winLabel}</span>
        `;
        duelWordsHistoryList.appendChild(item);
      });
    }

    rematchBtn.disabled = false;
    rematchBtnText.textContent = 'Play Again';
    duelResultsModal.style.display = 'flex';
    refreshGoogleAds();
  }

  socket.on('opponent_wants_rematch', () => {
    showToast(`${oppPlayerName} requested Play Again! Click to accept.`);
  });

  socket.on('rematch_status', () => {
    showToast('Waiting for opponent to accept…');
  });

  // Reconnection & 30s Grace Timer
  socket.on('opponent_disconnected', (data) => {
    let timeLeft = data.secondsRemaining || 30;
    disconnectCountdown.textContent = timeLeft;
    disconnectBanner.style.display = 'block';

    if (disconnectInterval) clearInterval(disconnectInterval);
    disconnectInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        clearInterval(disconnectInterval);
      } else {
        disconnectCountdown.textContent = timeLeft;
      }
    }, 1000);
  });

  socket.on('opponent_reconnected', () => {
    if (disconnectInterval) clearInterval(disconnectInterval);
    disconnectBanner.style.display = 'none';
    showToast(`${oppPlayerName} reconnected! Game resumed.`);
  });

  // --- Initial Boot ---
  initBoards();
  updateAllNameElements();
  const path = window.location.pathname;
  const match = path.match(/\/room\/([a-zA-Z0-9]+)/);
  if (match && match[1]) {
    enterOnlineRoom(match[1]);
  } else {
    switchView('home');
  }

})();
