// server.js - WORDDUEL High-Concurrency Real-Time Game Server
// Architected to handle 5,000+ concurrent players with Multi-Core Clustering and Redis scaling

const cluster = require('node:cluster');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '0.0.0.0';
const ENABLE_CLUSTER = process.env.NODE_CLUSTER === 'true';
const NUM_CORES = Math.min(os.cpus().length, 8);

// If Cluster Mode is enabled and we are on Master
if (ENABLE_CLUSTER && cluster.isPrimary) {
  const { setupMaster } = require('@socket.io/sticky');
  const { setupPrimary } = require('@socket.io/cluster-adapter');

  console.log(`[WORDDUEL Master] Primary process ${process.pid} is starting ${NUM_CORES} workers...`);

  const server = http.createServer();
  setupMaster(server, { loadBalancingMethod: 'least-connection' });
  setupPrimary();

  for (let i = 0; i < NUM_CORES; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[WORDDUEL Master] Worker ${worker.process.pid} died (${signal || code}). Spawning replacement...`);
    cluster.fork();
  });

  server.listen(PORT, HOST, () => {
    console.log(`[WORDDUEL Cluster] Master load balancer active on http://${HOST}:${PORT}`);
  });

} else {
  // Worker Process or Standalone Mode
  startWorker();
}

const crypto = require('node:crypto');

// Load word lists once at startup into memory
function loadWordListFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0);
}

// 1. Answer list from common_five_letter_words.txt (fallback to words.json answers if missing)
let answersList = [];
const commonWordsPathData = path.join(__dirname, 'data', 'common_five_letter_words.txt');
const commonWordsPathPublic = path.join(__dirname, 'public', 'common_five_letter_words.txt');
const loadedCommon = loadWordListFile(commonWordsPathData) || loadWordListFile(commonWordsPathPublic);

if (loadedCommon && loadedCommon.length > 0) {
  answersList = loadedCommon;
} else {
  const wordsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8'));
  answersList = wordsData.answers.map(w => w.toLowerCase());
}

// 2. Valid guess list: five_letter_words.txt + words.json + common_five_letter_words.txt
const allowedSet = new Set();
const fiveWordsPathData = path.join(__dirname, 'data', 'five_letter_words.txt');
const fiveWordsPathPublic = path.join(__dirname, 'public', 'five_letter_words.txt');
const loadedGuesses = loadWordListFile(fiveWordsPathData) || loadWordListFile(fiveWordsPathPublic);

if (loadedGuesses && loadedGuesses.length > 0) {
  loadedGuesses.forEach(w => allowedSet.add(w));
}

// Load full official Wordle dictionary (10,000+ words) from words.json
const wordsJsonPath = fs.existsSync(path.join(__dirname, 'public', 'words.json'))
  ? path.join(__dirname, 'public', 'words.json')
  : path.join(__dirname, 'words.json');

if (fs.existsSync(wordsJsonPath)) {
  try {
    const wordsData = JSON.parse(fs.readFileSync(wordsJsonPath, 'utf8'));
    if (Array.isArray(wordsData.allowed)) {
      wordsData.allowed.forEach(w => allowedSet.add(w.toLowerCase().trim()));
    }
    if (Array.isArray(wordsData.answers)) {
      wordsData.answers.forEach(w => allowedSet.add(w.toLowerCase().trim()));
    }
  } catch (e) {}
}

// Answers list words are always allowed guesses
answersList.forEach(w => allowedSet.add(w.toLowerCase().trim()));

function startWorker() {
  const app = express();
  const server = http.createServer(app);

  // 1. HTTP Optimization: Compression for static assets
  app.use(compression());

  // 2. High-Concurrency Socket.io Configuration (Optimized for 5,000+ concurrent connections)
  const io = new Server(server, {
    transports: ['websocket', 'polling'], // Prefer WebSockets to eliminate HTTP polling overhead
    pingTimeout: 20000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e5, // Limit payload to 100KB to protect against flood attacks
    perMessageDeflate: false, // Critical optimization: disables CPU-heavy deflate on small WebSocket messages
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Enable Cluster adapter if running clustered
  if (ENABLE_CLUSTER) {
    const { setupWorker } = require('@socket.io/sticky');
    const { createAdapter } = require('@socket.io/cluster-adapter');
    io.adapter(createAdapter());
    setupWorker(server);
  }

  // Optional: Redis Pub/Sub adapter for distributed horizontal scaling across multi-container cloud deployments
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const Redis = require('ioredis');
      const redisUrl = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
      const pubClient = new Redis(redisUrl);
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      console.log(`[Worker ${process.pid}] Attached Redis Adapter for distributed scaling.`);
    } catch (err) {
      console.warn(`[Worker ${process.pid}] Redis setup skipped:`, err.message);
    }
  }

  // Health check endpoint for Google Cloud Run container liveness probe
  app.get('/healthz', (req, res) => {
    res.status(200).send('ok');
  });

  // Serve static assets with cache headers
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',
    etag: true
  }));

  // Explicit route for words.json dictionary
  app.get('/words.json', (req, res) => {
    const p = fs.existsSync(path.join(__dirname, 'public', 'words.json'))
      ? path.join(__dirname, 'public', 'words.json')
      : path.join(__dirname, 'words.json');
    res.sendFile(p);
  });

  // Route support
  app.get(['/', '/room/:roomId'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // In-memory room store with TTL Garbage Collector for scale
  // Structure: rooms.get(roomId) -> RoomObject
  const rooms = new Map();

  // Pick random secret word from answersList using crypto.randomInt, excluding usedWords
  function pickSecretWordForRoom(room) {
    if (!room.usedWords) {
      room.usedWords = [];
    }
    const usedSet = new Set(room.usedWords);
    let available = answersList.filter(w => !usedSet.has(w));
    // If the answer list runs out in a very long unlimited duel, reshuffle and reuse
    if (available.length === 0) {
      room.usedWords = [];
      available = answersList.slice();
    }
    const randomIndex = crypto.randomInt(0, available.length);
    const chosen = available[randomIndex];
    room.usedWords.push(chosen);
    return chosen;
  }

  // Two-pass Wordle duplicate letter evaluation
  function evaluateWordleGuess(guess, target) {
    const result = Array(5).fill('grey');
    const targetChars = target.split('');
    const guessChars = guess.split('');
    const targetCounts = {};

    for (const char of targetChars) {
      targetCounts[char] = (targetCounts[char] || 0) + 1;
    }

    // Pass 1: Exact matches (Greens)
    for (let i = 0; i < 5; i++) {
      if (guessChars[i] === targetChars[i]) {
        result[i] = 'green';
        targetCounts[guessChars[i]]--;
      }
    }

    // Pass 2: Present matches (Yellows)
    for (let i = 0; i < 5; i++) {
      if (result[i] !== 'green') {
        const char = guessChars[i];
        if (targetCounts[char] && targetCounts[char] > 0) {
          result[i] = 'yellow';
          targetCounts[char]--;
        }
      }
    }

    return result;
  }

  // Helper to extract player public profile summary
  function getRoomPlayers(room) {
    const list = {};
    for (const p of Object.values(room.players)) {
      list[p.playerNum] = {
        id: p.id,
        playerNum: p.playerNum,
        name: p.name || `Player ${p.playerNum}`
      };
    }
    return list;
  }

  // Helper to start or advance a round
  function startNextRound(room) {
    room.currentRound++;
    room.secretWord = pickSecretWordForRoom(room);
    room.status = 'countdown';
    room.roundWinnerPlayerNum = null;
    room.roundIsDraw = false;
    room.roundStartedAt = null;
    room.startTime = null;

    // Reset player round-level state
    for (const p of Object.values(room.players)) {
      p.guesses = [];
      p.won = false;
      p.finished = false;
      p.nextRoundRequested = false;
    }

    // Notify clients of round countdown
    io.to(room.id).emit('round_countdown', {
      currentRound: room.currentRound,
      totalRounds: room.totalRounds,
      roundsMode: room.roundsMode,
      seconds: 3,
      score: {
        player1: room.scores[1] || 0,
        player2: room.scores[2] || 0
      },
      players: getRoomPlayers(room)
    });

    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    room.countdownTimer = setTimeout(() => {
      room.status = 'playing';
      room.startTime = Date.now();
      room.roundStartedAt = room.startTime;

      io.to(room.id).emit('round_start', {
        currentRound: room.currentRound,
        totalRounds: room.totalRounds,
        roundsMode: room.roundsMode,
        startTime: room.startTime,
        score: {
          player1: room.scores[1] || 0,
          player2: room.scores[2] || 0
        },
        players: getRoomPlayers(room)
      });
    }, 3000);
  }

  function endDuel(room, reason) {
    room.status = 'duel_ended';
    if (room.countdownTimer) {
      clearTimeout(room.countdownTimer);
      room.countdownTimer = null;
    }

    const p1Score = room.scores[1] || 0;
    const p2Score = room.scores[2] || 0;
    let duelWinnerPlayerNum = null;
    let isDraw = false;

    if (p1Score > p2Score) {
      duelWinnerPlayerNum = 1;
    } else if (p2Score > p1Score) {
      duelWinnerPlayerNum = 2;
    } else {
      isDraw = true;
    }

    const winnerObj = duelWinnerPlayerNum ? Object.values(room.players).find(p => p.playerNum === duelWinnerPlayerNum) : null;

    io.to(room.id).emit('duel_finished', {
      duelWinnerPlayerNum,
      duelWinnerName: winnerObj ? winnerObj.name : null,
      isDraw,
      reason: reason || 'Duel completed!',
      scores: {
        player1: p1Score,
        player2: p2Score
      },
      roundsPlayed: room.currentRound,
      roundsMode: room.roundsMode,
      totalRounds: room.totalRounds,
      wordsHistory: room.wordsHistory,
      players: getRoomPlayers(room)
    });
  }

  // Periodic Memory GC: Clean up finished/stale rooms every 5 minutes to prevent RAM accumulation
  setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
      if (now - room.lastActive > 300000 && (room.status === 'duel_ended' || room.status === 'ended' || Object.keys(room.players).length === 0)) {
        if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
        if (room.countdownTimer) clearTimeout(room.countdownTimer);
        rooms.delete(roomId);
      }
    }
  }, 300000);

  // Socket.io Real-Time Gameplay Handlers
  io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentPlayerId = null;
    let roomsCreatedCount = 0;

    // Join / Create Room
    socket.on('join_room', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        let { roomId, playerId, playerName, roundsMode, totalRounds } = data;
        if (!roomId || !playerId || typeof roomId !== 'string' || typeof playerId !== 'string') return;

        roomId = roomId.trim().toUpperCase();
        if (roomId.length !== 5 || !/^[A-Z0-9]{5}$/.test(roomId)) return;

        const cleanPlayerName = (typeof playerName === 'string' && playerName.trim())
          ? playerName.trim().slice(0, 15)
          : null;

        currentRoomId = roomId;
        currentPlayerId = playerId;

        let room = rooms.get(roomId);

        if (!room) {
          // Prevent a single socket from spamming hundreds of ghost rooms
          if (roomsCreatedCount >= 10) {
            socket.emit('room_creation_limit', { message: 'Room creation limit reached for this connection' });
            return;
          }
          roomsCreatedCount++;

          // Validate rounds settings
          let validMode = 'fixed';
          let validTotal = 3;

          if (roundsMode === 'unlimited') {
            validMode = 'unlimited';
            validTotal = null;
          } else {
            validMode = 'fixed';
            const parsed = parseInt(totalRounds, 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 20) {
              validTotal = parsed;
            } else {
              validTotal = 3;
            }
          }

          room = {
            id: roomId,
            roundsMode: validMode,
            totalRounds: validTotal,
            currentRound: 0,
            secretWord: '',
            usedWords: [],
            wordsHistory: [], // { round: number, word: string, winnerPlayerNum: number | null, isDraw: boolean }
            scores: { 1: 0, 2: 0 },
            status: 'waiting', // 'waiting' | 'countdown' | 'playing' | 'round_ended' | 'duel_ended'
            players: {},
            roundWinnerPlayerNum: null,
            roundIsDraw: false,
            startTime: null,
            lastActive: Date.now(),
            disconnectTimer: null,
            disconnectedPlayerId: null,
            countdownTimer: null
          };
          rooms.set(roomId, room);
        } else {
          room.lastActive = Date.now();
        }

        const playerIds = Object.keys(room.players);
        const existingPlayer = room.players[playerId];

        // Case 1: Reconnecting existing player
        if (existingPlayer) {
          existingPlayer.socketId = socket.id;
          if (cleanPlayerName) {
            existingPlayer.name = cleanPlayerName;
          }
          socket.join(roomId);

          if (room.disconnectedPlayerId === playerId) {
            if (room.disconnectTimer) {
              clearTimeout(room.disconnectTimer);
              room.disconnectTimer = null;
            }
            room.disconnectedPlayerId = null;
            socket.to(roomId).emit('opponent_reconnected');
          }

          const opponentId = playerIds.find(id => id !== playerId);
          const opponent = opponentId ? room.players[opponentId] : null;

          socket.emit('game_state_sync', {
            playerNum: existingPlayer.playerNum,
            playerName: existingPlayer.name,
            roomId: room.id,
            roundsMode: room.roundsMode,
            totalRounds: room.totalRounds,
            currentRound: room.currentRound,
            status: room.status,
            scores: room.scores,
            myGuesses: existingPlayer.guesses,
            opponentGuesses: opponent ? opponent.guesses.map(g => ({ evaluation: g.evaluation })) : [],
            opponentConnected: !!opponent,
            roundWinnerPlayerNum: room.roundWinnerPlayerNum,
            secretWord: (room.status === 'round_ended' || room.status === 'duel_ended') ? room.secretWord : null,
            startTime: room.startTime,
            wordsHistory: room.wordsHistory,
            nextRoundRequested: existingPlayer.nextRoundRequested,
            players: getRoomPlayers(room)
          });
          return;
        }

        // Case 2: Room is already full (2 players already registered)
        if (playerIds.length >= 2) {
          socket.emit('room_full', { roomId });
          return;
        }

        // Case 3: New player joining slot
        const playerNum = playerIds.length === 0 ? 1 : 2;
        room.players[playerId] = {
          id: playerId,
          socketId: socket.id,
          playerNum,
          name: cleanPlayerName || `Player ${playerNum}`,
          guesses: [],
          won: false,
          finished: false,
          nextRoundRequested: false
        };

        socket.join(roomId);

        if (playerNum === 1) {
          socket.emit('room_joined', {
            playerNum: 1,
            roomId: room.id,
            status: 'waiting',
            roundsMode: room.roundsMode,
            totalRounds: room.totalRounds,
            playerName: room.players[playerId].name,
            players: getRoomPlayers(room)
          });
        } else {
          // Player 2 joined: Start round 1!
          const p1 = Object.values(room.players).find(p => p.playerNum === 1);
          if (p1) {
            io.to(p1.socketId).emit('opponent_joined', {
              roundsMode: room.roundsMode,
              totalRounds: room.totalRounds,
              players: getRoomPlayers(room)
            });
          }

          socket.emit('room_joined', {
            playerNum: 2,
            roomId: room.id,
            status: 'starting',
            roundsMode: room.roundsMode,
            totalRounds: room.totalRounds,
            playerName: room.players[playerId].name,
            players: getRoomPlayers(room)
          });

          startNextRound(room);
        }
      } catch (err) {
        console.error('Error handling join_room:', err);
      }
    });

    // Submit Guess
    socket.on('submit_guess', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        let { roomId, playerId, guess } = data;
        if (!roomId || !playerId || !guess || typeof roomId !== 'string' || typeof playerId !== 'string' || typeof guess !== 'string') return;

        roomId = roomId.trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room || room.status !== 'playing') return;

        const player = room.players[playerId];
        // Enforce that player exists, isn't finished, and this socket is the registered owner of this player slot
        if (!player || player.finished || player.socketId !== socket.id) return;

        room.lastActive = Date.now();
        const cleanGuess = guess.trim().toLowerCase();

        // Validate 5 letters
        if (cleanGuess.length !== 5 || !/^[a-z]{5}$/.test(cleanGuess)) {
          socket.emit('guess_error', { message: 'Must be 5 letters' });
          return;
        }

        // Validate against local dictionary
        if (!allowedSet.has(cleanGuess)) {
          socket.emit('guess_error', { message: 'Not in word list' });
          return;
        }

        // Server-authoritative evaluation
        const evaluation = evaluateWordleGuess(cleanGuess, room.secretWord);
        player.guesses.push({
          word: cleanGuess,
          evaluation
        });

        const isWinner = evaluation.every(c => c === 'green');
        if (isWinner) {
          player.won = true;
          player.finished = true;
        } else if (player.guesses.length >= 6) {
          player.finished = true;
        }

        const rowIndex = player.guesses.length - 1;

        // Send letters and colors to the player
        socket.emit('guess_result', {
          guess: cleanGuess,
          evaluation,
          row: rowIndex
        });

        // Send ONLY colors (no letters) to the opponent
        socket.to(roomId).emit('opponent_guess_result', {
          evaluation,
          row: rowIndex
        });

        // Round Win / Draw Checks
        const opponent = Object.values(room.players).find(p => p.id !== playerId);

        function handleRoundFinish(roundWinnerNum, isDraw, reason) {
          room.status = 'round_ended';
          room.roundWinnerPlayerNum = roundWinnerNum;
          room.roundIsDraw = isDraw;

          if (roundWinnerNum) {
            room.scores[roundWinnerNum] = (room.scores[roundWinnerNum] || 0) + 1;
          }

          room.wordsHistory.push({
            round: room.currentRound,
            word: room.secretWord,
            winnerPlayerNum: roundWinnerNum,
            isDraw
          });

          const isLastRound = (room.roundsMode === 'fixed' && room.currentRound >= room.totalRounds);

          const winnerObj = roundWinnerNum ? Object.values(room.players).find(p => p.playerNum === roundWinnerNum) : null;
          const winnerName = winnerObj ? winnerObj.name : null;
          const displayReason = isWinner
            ? `${player.name || ('Player ' + player.playerNum)} found the secret word!`
            : reason;

          io.to(roomId).emit('round_over', {
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            roundsMode: room.roundsMode,
            winnerPlayerNum: roundWinnerNum,
            winnerName,
            isDraw,
            secretWord: room.secretWord,
            reason: displayReason,
            scores: {
              player1: room.scores[1] || 0,
              player2: room.scores[2] || 0
            },
            isDuelOver: isLastRound,
            wordsHistory: room.wordsHistory,
            players: getRoomPlayers(room)
          });

          if (isLastRound) {
            setTimeout(() => {
              endDuel(room, 'All rounds completed!');
            }, 1500);
          }
        }

        if (isWinner) {
          handleRoundFinish(player.playerNum, false, `${player.name || ('Player ' + player.playerNum)} found the secret word!`);
        } else if (player.finished) {
          if (opponent && opponent.finished && !opponent.won) {
            // Both used 6 guesses without winning: Round Draw
            handleRoundFinish(null, true, 'Both players used all 6 guesses.');
          } else {
            socket.emit('player_finished_round', {
              message: "You've used all 6 guesses. Waiting for opponent..."
            });
          }
        }
      } catch (err) {
        console.error('Error handling submit_guess:', err);
      }
    });

    // Next Round Request (Unlimited or rematch)
    socket.on('request_next_round', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        let { roomId, playerId } = data;
        if (!roomId || !playerId || typeof roomId !== 'string' || typeof playerId !== 'string') return;

        roomId = roomId.trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room || room.status !== 'round_ended') return;

        const player = room.players[playerId];
        if (!player || player.socketId !== socket.id) return;

        room.lastActive = Date.now();
        player.nextRoundRequested = true;
        const allPlayers = Object.values(room.players);
        const bothReady = allPlayers.length === 2 && allPlayers.every(p => p.nextRoundRequested);

        if (bothReady) {
          startNextRound(room);
        } else {
          socket.emit('next_round_status', { selfRequested: true });
          socket.to(roomId).emit('opponent_ready_next_round');
        }
      } catch (err) {
        console.error('Error handling request_next_round:', err);
      }
    });

    // End Duel manually (Unlimited mode or either player ending)
    socket.on('end_duel', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        let { roomId, playerId } = data;
        if (!roomId || !playerId || typeof roomId !== 'string' || typeof playerId !== 'string') return;

        roomId = roomId.trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.players[playerId];
        if (!player || player.socketId !== socket.id) return;

        room.lastActive = Date.now();
        endDuel(room, `Player ended the duel.`);
      } catch (err) {
        console.error('Error handling end_duel:', err);
      }
    });

    // Rematch Request for when a duel has ended completely
    socket.on('request_rematch', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        let { roomId, playerId } = data;
        if (!roomId || !playerId || typeof roomId !== 'string' || typeof playerId !== 'string') return;

        roomId = roomId.trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room || (room.status !== 'duel_ended' && room.status !== 'ended')) return;

        const player = room.players[playerId];
        if (!player || player.socketId !== socket.id) return;

        room.lastActive = Date.now();
        player.nextRoundRequested = true;
        const allPlayers = Object.values(room.players);
        const bothWant = allPlayers.length === 2 && allPlayers.every(p => p.nextRoundRequested);

        if (bothWant) {
          // Reset duel entirely
          room.currentRound = 0;
          room.scores = { 1: 0, 2: 0 };
          room.wordsHistory = [];
          room.usedWords = [];
          for (const p of allPlayers) {
            p.nextRoundRequested = false;
          }
          startNextRound(room);
        } else {
          socket.emit('rematch_status', { selfRequested: true });
          socket.to(roomId).emit('opponent_wants_rematch');
        }
      } catch (err) {
        console.error('Error handling request_rematch:', err);
      }
    });

    // Disconnection Handling with 30-Second Reconnection Grace Period
    socket.on('disconnect', () => {
      try {
        if (!currentRoomId || !currentPlayerId) return;

        const room = rooms.get(currentRoomId);
        if (!room) return;

        const player = room.players[currentPlayerId];
        if (!player) return;

        if (room.status === 'waiting') {
          delete room.players[currentPlayerId];
          if (Object.keys(room.players).length === 0) {
            rooms.delete(currentRoomId);
          }
          return;
        }

        if (room.status === 'playing' || room.status === 'countdown' || room.status === 'round_ended') {
          room.disconnectedPlayerId = currentPlayerId;
          socket.to(currentRoomId).emit('opponent_disconnected', {
            secondsRemaining: 30
          });

          if (room.disconnectTimer) clearTimeout(room.disconnectTimer);

          room.disconnectTimer = setTimeout(() => {
            if (room.disconnectedPlayerId === currentPlayerId) {
              // End duel and show results for rounds played
              endDuel(room, 'Opponent disconnected and did not return. Duel ended.');
            }
          }, 30000);
        }
      } catch (err) {
        console.error('Error handling disconnect:', err);
      }
    });
  });

  if (!ENABLE_CLUSTER) {
    server.listen(PORT, HOST, () => {
      console.log(`[WORDDUEL Standalone] Server active on http://${HOST}:${PORT}`);
      console.log(`Loaded ${answersList.length} secret words and ${allowedSet.size} allowed dictionary guesses.`);
    });
  }

  // Graceful shutdown handling for Cloud Run SIGTERM / SIGINT
  let isShuttingDown = false;
  function handleGracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[WORDDUEL] Received ${signal}. Starting graceful shutdown...`);

    // 1. Close Socket.io server to disconnect clients cleanly
    io.close(() => {
      console.log('[WORDDUEL] Socket.io server closed.');
      // 2. Stop accepting new HTTP requests and finish active connections
      server.close(() => {
        console.log('[WORDDUEL] HTTP server closed cleanly. Process exiting.');
        process.exit(0);
      });
    });

    // 3. Fallback force exit after 10s to satisfy Cloud Run shutdown window
    setTimeout(() => {
      console.error('[WORDDUEL] Forcefully exiting after shutdown timeout.');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
}

