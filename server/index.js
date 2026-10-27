import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me-before-deploying-ghosthint';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const STORE_FILE = path.join(__dirname, 'data', 'store.json');
const ROUNDS_PER_HOST = 5;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: [CLIENT_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'], methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 20000,
});
app.use(cors({ origin: [CLIENT_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'], credentials: true }));
app.use(express.json({ limit: '40kb' }));

function initialStore() { return { users: [] }; }
function loadStore() {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, JSON.stringify(initialStore(), null, 2));
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch (error) {
    console.error('Unable to read user store:', error.message);
    return initialStore();
  }
}
let store = loadStore();
function saveStore() {
  const temp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, STORE_FILE);
}
function publicUser(user) {
  return { id: user.id, username: user.username, guest: Boolean(user.guest), createdAt: user.createdAt };
}
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, guest: Boolean(user.guest) }, JWT_SECRET, { expiresIn: user.guest ? '12h' : '14d' });
}
function authMiddleware(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please log in to continue.' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}
function normalise(value) {
  return String(value ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function sameAnswer(value, prompt) {
  const candidate = normalise(value);
  if (!candidate) return false;
  return [prompt.answer, ...(prompt.aliases || [])].some((answer) => normalise(answer) === candidate);
}
function hintContainsAnswer(value, prompt) {
  const hint = ` ${normalise(value)} `;
  return [prompt.answer, ...(prompt.aliases || [])]
    .map(normalise)
    .filter((item) => item.length >= 3)
    .some((item) => hint.includes(` ${item} `));
}
function makeId(prefix = '') { return `${prefix}${crypto.randomBytes(9).toString('hex')}`; }

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'GhostHint', time: new Date().toISOString() }));
app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[a-zA-Z0-9_]{3,18}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–18 characters using letters, numbers, or underscores.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (store.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username is already taken.' });
  if (store.users.some((user) => user.email === email)) return res.status(409).json({ error: 'An account already uses that email.' });
  const user = {
    id: makeId('u_'), username, email,
    passwordHash: await bcrypt.hash(password, 12), guest: false,
    friendIds: [], createdAt: new Date().toISOString(),
  };
  store.users.push(user); saveStore();
  return res.status(201).json({ token: signToken(user), user: publicUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = store.users.find((item) => !item.guest && (item.username.toLowerCase() === identifier || item.email === identifier));
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Incorrect username/email or password.' });
  return res.json({ token: signToken(user), user: publicUser(user) });
});
app.post('/api/auth/guest', (req, res) => {
  const requested = String(req.body?.username || '').trim();
  const suffix = crypto.randomInt(100, 9999);
  const safeName = /^[a-zA-Z0-9_]{3,18}$/.test(requested) ? requested : `Guest_${suffix}`;
  const user = { id: makeId('guest_'), username: safeName, guest: true, friendIds: [], createdAt: new Date().toISOString() };
  return res.status(201).json({ token: signToken(user), user: publicUser(user) });
});
app.get('/api/me', authMiddleware, (req, res) => {
  if (req.auth.guest) return res.json({ user: { id: req.auth.id, username: req.auth.username, guest: true } });
  const user = store.users.find((item) => item.id === req.auth.id);
  if (!user) return res.status(401).json({ error: 'Account not found.' });
  return res.json({ user: publicUser(user) });
});
app.get('/api/friends', authMiddleware, (req, res) => {
  const user = store.users.find((item) => item.id === req.auth.id);
  if (!user || user.guest) return res.json({ friends: [] });
  const friends = (user.friendIds || []).map((id) => store.users.find((item) => item.id === id)).filter(Boolean).map(publicUser);
  return res.json({ friends });
});
app.post('/api/friends/add', authMiddleware, (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (req.auth.guest) return res.status(403).json({ error: 'Create an account to add friends.' });
  const user = store.users.find((item) => item.id === req.auth.id);
  const target = store.users.find((item) => item.username.toLowerCase() === username.toLowerCase() && !item.guest);
  if (!user || !target) return res.status(404).json({ error: 'No registered user found with that username.' });
  if (target.id === user.id) return res.status(400).json({ error: 'You cannot add yourself.' });
  user.friendIds ||= []; target.friendIds ||= [];
  if (!user.friendIds.includes(target.id)) user.friendIds.push(target.id);
  if (!target.friendIds.includes(user.id)) target.friendIds.push(user.id);
  saveStore();
  return res.json({ friend: publicUser(target), message: `${target.username} added to your friends.` });
});
app.delete('/api/friends/:id', authMiddleware, (req, res) => {
  if (req.auth.guest) return res.status(403).json({ error: 'Guest accounts do not have a saved friend list.' });
  const user = store.users.find((item) => item.id === req.auth.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  user.friendIds = (user.friendIds || []).filter((id) => id !== req.params.id);
  saveStore();
  return res.json({ ok: true });
});

const rooms = new Map();
const WORD_PROMPTS = [
  { answer: 'Volcano', aliases: ['volcano'], category: 'Nature' },
  { answer: 'Telescope', aliases: ['telescope'], category: 'Science' },
  { answer: 'Pineapple', aliases: ['pine apple'], category: 'Food' },
  { answer: 'Airplane', aliases: ['plane', 'aeroplane'], category: 'Travel' },
  { answer: 'Keyboard', aliases: ['computer keyboard'], category: 'Technology' },
  { answer: 'Penguin', aliases: ['penguin'], category: 'Animals' },
  { answer: 'Bicycle', aliases: ['bike', 'cycle'], category: 'Transport' },
  { answer: 'Popcorn', aliases: ['pop corn'], category: 'Food' },
  { answer: 'Rainbow', aliases: ['rain bow'], category: 'Nature' },
  { answer: 'Compass', aliases: ['compass'], category: 'Objects' },
  { answer: 'Toothbrush', aliases: ['tooth brush'], category: 'Objects' },
  { answer: 'Lighthouse', aliases: ['light house'], category: 'Places' },
  { answer: 'Waterfall', aliases: ['water fall'], category: 'Nature' },
  { answer: 'Microscope', aliases: ['microscope'], category: 'Science' },
  { answer: 'Umbrella', aliases: ['umbrella'], category: 'Objects' },
  { answer: 'Jellyfish', aliases: ['jelly fish'], category: 'Animals' },
  { answer: 'Submarine', aliases: ['sub marine'], category: 'Transport' },
  { answer: 'Snowman', aliases: ['snow man'], category: 'Winter' },
];
const PICTURE_PROMPTS = [
  { answer: 'Banana', aliases: ['banana'], category: 'Food', imageKey: 'banana' },
  { answer: 'Cat', aliases: ['kitten', 'cat'], category: 'Animals', imageKey: 'cat' },
  { answer: 'Pizza', aliases: ['pizza'], category: 'Food', imageKey: 'pizza' },
  { answer: 'Rocket', aliases: ['rocket', 'spaceship'], category: 'Space', imageKey: 'rocket' },
  { answer: 'Cactus', aliases: ['cactus'], category: 'Nature', imageKey: 'cactus' },
  { answer: 'Guitar', aliases: ['guitar'], category: 'Music', imageKey: 'guitar' },
  { answer: 'Turtle', aliases: ['turtle', 'tortoise'], category: 'Animals', imageKey: 'turtle' },
  { answer: 'Ice cream', aliases: ['icecream', 'ice cream'], category: 'Food', imageKey: 'icecream' },
  { answer: 'Camera', aliases: ['camera'], category: 'Objects', imageKey: 'camera' },
  { answer: 'Lantern', aliases: ['lantern'], category: 'Objects', imageKey: 'lantern' },
  { answer: 'Backpack', aliases: ['back pack', 'rucksack'], category: 'Objects', imageKey: 'backpack' },
  { answer: 'Thermometer', aliases: ['thermometer'], category: 'Science', imageKey: 'thermometer' },
  { answer: 'Magnifying glass', aliases: ['magnifier', 'magnifying glass'], category: 'Science', imageKey: 'magnifyingglass' },
  { answer: 'Windmill', aliases: ['wind mill'], category: 'Structures', imageKey: 'windmill' },
  { answer: 'Dinosaur', aliases: ['dinosaur', 'dino'], category: 'Animals', imageKey: 'dinosaur' },
  { answer: 'Hourglass', aliases: ['sand timer', 'hour glass'], category: 'Objects', imageKey: 'hourglass' },
  { answer: 'Chameleon', aliases: ['chameleon'], category: 'Animals', imageKey: 'chameleon' },
  { answer: 'Abacus', aliases: ['abacus'], category: 'Objects', imageKey: 'abacus' },
  { answer: 'Kaleidoscope', aliases: ['kaleidoscope'], category: 'Optics', imageKey: 'kaleidoscope' },
  { answer: 'Sundial', aliases: ['sun dial'], category: 'Timekeeping', imageKey: 'sundial' },
  { answer: 'Periscope', aliases: ['periscope'], category: 'Optics', imageKey: 'periscope' },
];
WORD_PROMPTS.push(
  { answer: 'Kaleidoscope', aliases: ['kaleidoscope'], category: 'Optics' },
  { answer: 'Astrolabe', aliases: ['astrolabe'], category: 'History' },
  { answer: 'Labyrinth', aliases: ['maze'], category: 'Places' },
  { answer: 'Periscope', aliases: ['periscope'], category: 'Optics' },
  { answer: 'Pendulum', aliases: ['pendulum'], category: 'Physics' },
  { answer: 'Metronome', aliases: ['metronome'], category: 'Music' },
  { answer: 'Sundial', aliases: ['sun dial'], category: 'Timekeeping' },
  { answer: 'Hologram', aliases: ['hologram'], category: 'Technology' },
);
const EASY_ANSWERS = new Set(['umbrella', 'snowman', 'penguin', 'popcorn', 'rainbow', 'bicycle', 'banana', 'cat', 'pizza', 'rocket', 'turtle', 'camera']);
const HARD_ANSWERS = new Set(['telescope', 'microscope', 'lighthouse', 'submarine', 'cactus', 'guitar', 'dinosaur', 'waterfall', 'jellyfish', 'periscope']);
const HARDEST_ANSWERS = new Set(['kaleidoscope', 'astrolabe', 'labyrinth', 'pendulum', 'metronome', 'sundial', 'hologram', 'hourglass', 'chameleon', 'abacus']);
function promptDifficulty(prompt) {
  const answer = normalise(prompt.answer);
  if (HARDEST_ANSWERS.has(answer)) return 'hardest';
  if (HARD_ANSWERS.has(answer)) return 'hard';
  if (EASY_ANSWERS.has(answer)) return 'easy';
  return 'medium';
}
function randomPrompt(mode, difficulty = 'medium') {
  const actualMode = mode === 'mixed' ? (Math.random() > 0.5 ? 'word' : 'picture') : mode;
  const allPrompts = actualMode === 'picture' ? PICTURE_PROMPTS : WORD_PROMPTS;
  let pool = allPrompts.filter((candidate) => promptDifficulty(candidate) === difficulty);
  if (pool.length === 0) pool = allPrompts;
  const prompt = pool[crypto.randomInt(0, pool.length)];
  return { ...prompt, type: actualMode, difficulty: promptDifficulty(prompt) };
}
function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}
function playerProfile(user, socket) {
  return { id: user.id, username: user.username, guest: Boolean(user.guest), socketId: socket.id, connected: true, score: 0, avatar: user.username.slice(0, 1).toUpperCase() };
}
function sanitizeRoom(room, viewerId) {
  const host = room.players.find((player) => player.id === room.currentHostId);
  const currentPrompt = room.currentPrompt;
  const shouldReveal = room.status === 'roundOver' || room.status === 'finished';
  const viewerIsHost = viewerId === room.currentHostId && room.status === 'playing';
  return {
    code: room.code,
    name: room.name,
    ownerId: room.ownerId,
    status: room.status,
    settings: room.settings,
    players: room.players.map((player) => ({ id: player.id, username: player.username, guest: player.guest, connected: player.connected, score: player.score, avatar: player.avatar, isHost: player.id === room.currentHostId, socketId: player.socketId })),
    hostId: room.currentHostId,
    hostName: host?.username || 'Host',
    viewerIsHost,
    roundNumber: room.roundNumber || 0,
    totalRounds: room.totalRounds || 0,
    roundsPerHost: Number(room.settings.roundsPerHost) || ROUNDS_PER_HOST,
    roundEndsAt: room.roundEndsAt,
    hintsCount: room.hintsCount || 0,
    prompt: viewerIsHost && currentPrompt ? { answer: currentPrompt.answer, category: currentPrompt.category, type: currentPrompt.type, imageKey: currentPrompt.imageKey || null, difficulty: currentPrompt.difficulty || room.settings.difficulty } : null,
    revealedAnswer: shouldReveal && currentPrompt ? currentPrompt.answer : null,
    currentPromptType: currentPrompt?.type || null,
    currentImageKey: viewerIsHost && currentPrompt ? (currentPrompt.imageKey || null) : null,
    lastResult: room.lastResult || null,
    history: room.history.slice(-20),
    messages: room.messages.slice(-45),
    winner: room.winner || null,
  };
}
function emitRoomState(room) {
  for (const player of room.players) {
    if (!player.connected) continue;
    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) socket.emit('room:state', sanitizeRoom(room, player.id));
  }
}
function appendMessage(room, type, username, text, extra = {}) {
  const message = { id: makeId('m_'), type, username, text: String(text).slice(0, 300), at: Date.now(), ...extra };
  room.messages.push(message);
  if (room.messages.length > 120) room.messages.splice(0, room.messages.length - 120);
  return message;
}
function roomForSocket(socket) {
  return socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;
}
function reply(ack, result) { if (typeof ack === 'function') ack(result); }
function stopRoundTimer(room) {
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = null;
}
function startRound(room, roundNumber) {
  stopRoundTimer(room);
  const roundsPerHost = Number(room.settings.roundsPerHost) || ROUNDS_PER_HOST;
  let nextRound = roundNumber;
  // If a host has disconnected, skip that player's remaining host block instead of
  // leaving a live match stuck waiting for someone who is no longer in the room.
  while (nextRound <= room.totalRounds) {
    const hostIndex = Math.floor((nextRound - 1) / roundsPerHost);
    const hostId = room.hostOrder[hostIndex];
    const nextHost = room.players.find((player) => player.id === hostId && player.connected);
    if (nextHost) break;
    const nextHostBlock = (hostIndex + 1) * roundsPerHost + 1;
    appendMessage(room, 'system', 'GhostHint', `${room.players.find((player) => player.id === hostId)?.username || 'A disconnected host'} is offline; skipping their remaining host rounds.`);
    nextRound = Math.max(nextRound + 1, nextHostBlock);
  }
  if (nextRound > room.totalRounds) {
    room.status = 'finished';
    room.roundNumber = room.totalRounds;
    room.roundEndsAt = null;
    room.winner = [...room.players].sort((a, b) => b.score - a.score || a.username.localeCompare(b.username)).map((player, index) => ({ id: player.id, username: player.username, score: player.score, rank: index + 1 }));
    appendMessage(room, 'system', 'GhostHint', 'Match complete — final scores are in.');
    emitRoomState(room);
    return;
  }
  room.roundNumber = nextRound;
  const hostIndex = Math.floor((nextRound - 1) / roundsPerHost);
  room.currentHostId = room.hostOrder[hostIndex];
  room.currentPrompt = randomPrompt(room.settings.mode, room.settings.difficulty || 'medium');
  room.status = 'playing';
  room.roundEndsAt = Date.now() + room.settings.roundSeconds * 1000;
  room.hintsCount = 0;
  room.lastResult = null;
  appendMessage(room, 'system', 'GhostHint', `Round ${nextRound} of ${room.totalRounds} started. ${room.players.find((player) => player.id === room.currentHostId)?.username || 'The host'} is giving clues.`);
  emitRoomState(room);
  const thisRound = nextRound;
  room.roundTimer = setTimeout(() => {
    if (room.status !== 'playing' || room.roundNumber !== thisRound) return;
    finishRound(room, 'time', null);
  }, room.settings.roundSeconds * 1000 + 50);
}
function finishRound(room, reason, winnerPlayer) {
  if (!room || room.status !== 'playing') return;
  stopRoundTimer(room);
  const host = room.players.find((player) => player.id === room.currentHostId);
  if (winnerPlayer) {
    winnerPlayer.score += Number(room.settings.correctPoints) || 10;
    if (host && host.id !== winnerPlayer.id && room.hintsCount > 0) host.score += Number(room.settings.hostBonusPoints) || 0;
  }
  room.status = 'roundOver';
  room.roundEndsAt = null;
  const answer = room.currentPrompt?.answer || '—';
  const result = {
    roundNumber: room.roundNumber,
    answer,
    category: room.currentPrompt?.category || '',
    winnerId: winnerPlayer?.id || null,
    winnerName: winnerPlayer?.username || null,
    reason,
    hostId: host?.id || null,
    hostName: host?.username || 'Host',
    guesserPoints: winnerPlayer ? (Number(room.settings.correctPoints) || 10) : 0,
    hostPoints: winnerPlayer && host && host.id !== winnerPlayer.id && room.hintsCount > 0 ? (Number(room.settings.hostBonusPoints) || 0) : 0,
  };
  room.lastResult = result;
  room.history.push(result);
  const roundEndMessage = winnerPlayer ? `${winnerPlayer.username} locked the correct answer! ${answer} was it.` : reason === 'host-disconnected' ? `${host?.username || 'The host'} disconnected. The answer was ${answer}.` : reason === 'skipped' ? `The host skipped the round. The answer was ${answer}.` : `Time is up. The answer was ${answer}.`;
  appendMessage(room, 'system', 'GhostHint', roundEndMessage);
  emitRoomState(room);
  const thisRound = room.roundNumber;
  room.roundTimer = setTimeout(() => {
    if (room.status !== 'roundOver' || room.roundNumber !== thisRound) return;
    startRound(room, thisRound + 1);
  }, 1100);
}
function joinRoom(room, socket) {
  const existing = room.players.find((player) => player.id === socket.data.user.id);
  if (existing?.connected) return { ok: false, error: 'This account is already in the room.' };
  let player;
  if (existing) {
    existing.socketId = socket.id;
    existing.connected = true;
    existing.username = socket.data.user.username;
    existing.guest = Boolean(socket.data.user.guest);
    player = existing;
    appendMessage(room, 'system', 'GhostHint', `${player.username} reconnected.`);
  } else {
    player = playerProfile(socket.data.user, socket);
    room.players.push(player);
    appendMessage(room, 'system', 'GhostHint', `${player.username} joined the room.`);
  }
  socket.join(room.code);
  socket.data.roomCode = room.code;
  if (room.status === 'waiting' && !room.players.some((item) => item.id === room.ownerId && item.connected)) {
    room.ownerId = room.players.find((item) => item.connected)?.id || room.ownerId;
  }
  emitRoomState(room);
  io.to(room.code).emit('room:player-joined', { socketId: socket.id, playerId: player.id, username: player.username });
  return { ok: true, room: sanitizeRoom(room, player.id) };
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Please log in or continue as a guest first.'));
  try {
    socket.data.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return next(new Error('Your session has expired. Please sign in again.'));
  }
});

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.lastChatAt = 0;

  socket.on('room:create', (payload = {}, ack) => {
    if (socket.data.roomCode) return reply(ack, { ok: false, error: 'Leave your current room first.' });
    const name = String(payload.name || `${socket.data.user.username}'s room`).trim().slice(0, 32) || 'New room';
    const mode = ['word', 'picture', 'mixed'].includes(payload.mode) ? payload.mode : 'mixed';
    const difficulty = ['easy', 'medium', 'hard', 'hardest'].includes(payload.difficulty) ? payload.difficulty : 'medium';
    const requestedSeconds = Number(payload.roundSeconds);
    const roundSeconds = Math.max(30, Math.min(600, Math.round((Number.isFinite(requestedSeconds) ? requestedSeconds : 60) / 30) * 30));
    const requestedRounds = Number(payload.roundsPerHost);
    const roundsPerHost = Math.max(1, Math.min(10, Math.round(Number.isFinite(requestedRounds) ? requestedRounds : 5)));
    const requestedCorrectPoints = Number(payload.correctPoints);
    const correctPoints = Math.max(5, Math.min(50, Math.round(Number.isFinite(requestedCorrectPoints) ? requestedCorrectPoints : 10)));
    const requestedHostBonus = Number(payload.hostBonusPoints);
    const hostBonusPoints = Math.max(0, Math.min(25, Math.round(Number.isFinite(requestedHostBonus) ? requestedHostBonus : 5)));
    const code = makeRoomCode();
    const room = {
      code, name, ownerId: socket.data.user.id, status: 'waiting',
      settings: { mode, difficulty, roundSeconds, roundsPerHost, correctPoints, hostBonusPoints },
      players: [], hostOrder: [], currentHostId: null, currentPrompt: null,
      roundNumber: 0, totalRounds: 0, roundEndsAt: null, hintsCount: 0,
      messages: [], history: [], lastResult: null, winner: null, roundTimer: null,
    };
    rooms.set(code, room);
    const joined = joinRoom(room, socket);
    reply(ack, joined.ok ? { ok: true, code, room: joined.room } : joined);
  });

  socket.on('room:join', (payload = {}, ack) => {
    if (socket.data.roomCode) return reply(ack, { ok: false, error: 'Leave your current room first.' });
    const code = String(payload.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply(ack, { ok: false, error: 'Room not found. Check the code and try again.' });
    if (room.status !== 'waiting') {
      const returningPlayer = room.players.find((player) => player.id === socket.data.user.id && !player.connected);
      if (!returningPlayer) return reply(ack, { ok: false, error: 'This match has already started. Only returning players can rejoin it.' });
    }
    const existingPlayer = room.players.find((player) => player.id === socket.data.user.id);
    if (!existingPlayer && room.players.length >= 8) return reply(ack, { ok: false, error: 'This room is full (maximum 8 players).' });
    const joined = joinRoom(room, socket);
    reply(ack, joined);
  });

  socket.on('room:leave', (ack) => {
    const room = roomForSocket(socket);
    if (!room) return reply(ack, { ok: true });
    const player = room.players.find((item) => item.socketId === socket.id);
    if (player) {
      const wasActiveHost = room.status === 'playing' && room.currentHostId === player.id;
      if (room.status === 'waiting') {
        room.players = room.players.filter((item) => item.id !== player.id);
        if (room.ownerId === player.id && room.players.length) {
          room.ownerId = room.players[0].id;
          appendMessage(room, 'system', 'GhostHint', `${room.players[0].username} is now the room host.`);
        }
      } else player.connected = false;
      appendMessage(room, 'system', 'GhostHint', `${player.username} left the room.`);
      socket.leave(room.code);
      socket.data.roomCode = null;
      if (wasActiveHost) finishRound(room, 'host-disconnected', null); else emitRoomState(room);
      io.to(room.code).emit('room:player-left', { socketId: socket.id, playerId: player.id, username: player.username });
      if (room.status === 'waiting' && room.players.length === 0) {
        stopRoundTimer(room); rooms.delete(room.code);
      }
    }
    reply(ack, { ok: true });
  });

  socket.on('game:start', (ack) => {
    const room = roomForSocket(socket);
    if (!room) return reply(ack, { ok: false, error: 'Join a room first.' });
    if (room.ownerId !== socket.data.user.id) return reply(ack, { ok: false, error: 'Only the room creator can start the match.' });
    if (room.status !== 'waiting') return reply(ack, { ok: false, error: 'This match has already started.' });
    if (room.players.filter((player) => player.connected).length < 2) return reply(ack, { ok: false, error: 'At least two players are needed to start.' });
    room.hostOrder = room.players.filter((player) => player.connected).map((player) => player.id);
    room.totalRounds = room.hostOrder.length * (Number(room.settings.roundsPerHost) || ROUNDS_PER_HOST);
    for (const player of room.players) player.score = 0;
    room.history = [];
    appendMessage(room, 'system', 'GhostHint', `Match started! Each player hosts ${room.settings.roundsPerHost} questions.`);
    startRound(room, 1);
    reply(ack, { ok: true });
  });

  socket.on('hint:send', (payload = {}, ack) => {
    const room = roomForSocket(socket);
    if (!room || room.status !== 'playing') return reply(ack, { ok: false, error: 'There is no active round.' });
    if (socket.data.user.id !== room.currentHostId) return reply(ack, { ok: false, error: 'Only the current host can give hints.' });
    const text = String(payload.text || '').trim().slice(0, 240);
    if (text.length < 2) return reply(ack, { ok: false, error: 'Write a hint first.' });
    if (hintContainsAnswer(text, room.currentPrompt)) return reply(ack, { ok: false, error: 'That hint appears to reveal the answer. Try describing it indirectly.' });
    room.hintsCount += 1;
    appendMessage(room, 'hint', socket.data.user.username, text, { roundNumber: room.roundNumber });
    emitRoomState(room);
    return reply(ack, { ok: true });
  });

  socket.on('guess:submit', (payload = {}, ack) => {
    const room = roomForSocket(socket);
    if (!room || room.status !== 'playing') return reply(ack, { ok: false, correct: false, error: 'This round is locked.' });
    if (socket.data.user.id === room.currentHostId) return reply(ack, { ok: false, correct: false, error: 'The host cannot guess in their own round.' });
    const text = String(payload.text || '').trim().slice(0, 120);
    if (!text) return reply(ack, { ok: false, correct: false, error: 'Type or say a guess first.' });
    const player = room.players.find((item) => item.id === socket.data.user.id && item.connected);
    if (!player) return reply(ack, { ok: false, correct: false, error: 'You are no longer an active player.' });
    if (sameAnswer(text, room.currentPrompt)) {
      finishRound(room, 'correct', player);
      return reply(ack, { ok: true, correct: true, message: 'Correct — answer locked!', points: Number(room.settings.correctPoints) || 10 });
    }
    return reply(ack, { ok: true, correct: false, message: 'Not quite. Try another guess.' });
  });

  socket.on('chat:send', (payload = {}, ack) => {
    const room = roomForSocket(socket);
    if (!room) return reply(ack, { ok: false, error: 'Join a room to chat.' });
    const now = Date.now();
    if (now - socket.data.lastChatAt < 280) return reply(ack, { ok: false, error: 'Slow down a moment.' });
    socket.data.lastChatAt = now;
    const text = String(payload.text || '').trim().slice(0, 300);
    if (!text) return reply(ack, { ok: false, error: 'Message is empty.' });
    appendMessage(room, 'chat', socket.data.user.username, text);
    emitRoomState(room);
    return reply(ack, { ok: true });
  });

  socket.on('game:skip', (ack) => {
    const room = roomForSocket(socket);
    if (!room || room.status !== 'playing') return reply(ack, { ok: false, error: 'No active round.' });
    if (socket.data.user.id !== room.currentHostId) return reply(ack, { ok: false, error: 'Only the host can skip this round.' });
    finishRound(room, 'skipped', null);
    return reply(ack, { ok: true });
  });

  socket.on('media:ready', () => {
    const room = roomForSocket(socket);
    const player = room?.players.find((item) => item.socketId === socket.id && item.connected);
    if (room && player) io.to(room.code).emit('room:media-ready', { socketId: socket.id, username: player.username });
  });

  socket.on('media:off', () => {
    const room = roomForSocket(socket);
    if (room) io.to(room.code).emit('room:media-off', { socketId: socket.id });
  });

  socket.on('rtc:signal', (payload = {}) => {
    const room = roomForSocket(socket);
    const targetId = String(payload.toSocketId || '');
    if (!room || !targetId) return;
    const target = room.players.find((player) => player.socketId === targetId && player.connected);
    const sender = room.players.find((player) => player.socketId === socket.id && player.connected);
    if (!target || !sender || targetId === socket.id) return;
    io.to(targetId).emit('rtc:signal', { fromSocketId: socket.id, payload: payload.payload });
  });

  socket.on('disconnect', () => {
    const room = roomForSocket(socket);
    if (!room) return;
    const player = room.players.find((item) => item.socketId === socket.id);
    if (player) {
      const wasActiveHost = room.status === 'playing' && room.currentHostId === player.id;
      player.connected = false;
      if (room.status === 'waiting' && room.ownerId === player.id) {
        const nextOwner = room.players.find((item) => item.connected && item.id !== player.id);
        if (nextOwner) {
          room.ownerId = nextOwner.id;
          appendMessage(room, 'system', 'GhostHint', `${nextOwner.username} is now the room host.`);
        }
      }
      appendMessage(room, 'system', 'GhostHint', `${player.username} disconnected.`);
      if (wasActiveHost) finishRound(room, 'host-disconnected', null); else emitRoomState(room);
      io.to(room.code).emit('room:player-left', { socketId: socket.id, playerId: player.id, username: player.username });
    }
    socket.data.roomCode = null;
  });
});

const clientDist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    return res.sendFile(path.join(clientDist, 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GhostHint server listening on http://localhost:${PORT}`);
  if (JWT_SECRET === 'dev-only-change-me-before-deploying-ghosthint') console.warn('WARNING: Set JWT_SECRET in server/.env before public deployment.');
});
