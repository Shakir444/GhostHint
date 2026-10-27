import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  ArrowRight, AudioLines, Check, ChevronDown, CircleHelp, Clock3, Copy, Crown,
  DoorOpen, Eye, EyeOff, Gamepad2, Image as ImageIcon, LockKeyhole, LogOut,
  MessageCircle, Mic, MicOff, Plus, Send, Settings2, SlidersHorizontal, Sparkles, Timer, Trophy, UserPlus, Users,
  Video, VideoOff, Volume2, WandSparkles, X, Zap, Palette, Music, Upload,
} from 'lucide-react';
import styles from './App.module.css';

type User = { id: string; username: string; guest: boolean; createdAt?: string };
type Session = { token: string; user: User };
type Friend = { id: string; username: string; guest: boolean };
type ChatMessage = { id: string; type: 'chat' | 'hint' | 'system' | 'guess'; username: string; text: string; at: number; roundNumber?: number };
type Player = { id: string; username: string; guest: boolean; connected: boolean; score: number; avatar: string; isHost: boolean; socketId?: string };
type RoundResult = { roundNumber: number; answer: string; category: string; winnerId: string | null; winnerName: string | null; reason: string; hostId: string; hostName: string; guesserPoints: number; hostPoints: number };
type RoomState = {
  code: string; name: string; ownerId: string; status: 'waiting' | 'playing' | 'roundOver' | 'finished';
  settings: { mode: 'word' | 'picture' | 'mixed'; difficulty: Difficulty; roundSeconds: number; roundsPerHost: number; correctPoints: number; hostBonusPoints: number };
  players: Player[]; hostId: string | null; hostName: string; viewerIsHost: boolean; roundNumber: number; totalRounds: number;
  roundsPerHost: number; roundEndsAt: number | null; hintsCount: number;
  prompt: { answer: string; category: string; type: 'word' | 'picture'; imageKey: string | null; difficulty?: Difficulty } | null;
  revealedAnswer: string | null; currentPromptType: string | null; currentImageKey: string | null;
  lastResult: RoundResult | null; history: RoundResult[]; messages: ChatMessage[]; winner: Array<{ id: string; username: string; score: number; rank: number }> | null;
};
type ApiError = { error?: string };
type SignalPayload = { type: 'offer' | 'answer' | 'candidate'; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type RemoteMedia = { stream: MediaStream; username: string };
type ThemeName = 'violet' | 'neon' | 'ocean' | 'sunset';
type Difficulty = 'easy' | 'medium' | 'hard' | 'hardest';
type MusicTrack = 'arcade' | 'dream' | 'pulse' | 'retro' | 'chill' | 'boss' | 'custom';
type VideoEffect = 'natural' | 'bright' | 'warm' | 'cool' | 'mono' | 'vivid' | 'soft';
type VideoQuality = 'low' | 'balanced' | 'high';
type AppPreferences = { defaultRoundSeconds: number; defaultRoundsPerHost: number; defaultDifficulty: Difficulty; correctPoints: number; hostBonusPoints: number; soundEffects: boolean; backgroundMusic: boolean; musicTrack: MusicTrack; musicVolume: number; sfxVolume: number; theme: ThemeName; motionEffects: boolean; speechLanguage: 'en-IN' | 'en-US' | 'en-GB'; videoEffect: VideoEffect; videoQuality: VideoQuality };
const DEFAULT_PREFERENCES: AppPreferences = { defaultRoundSeconds: 60, defaultRoundsPerHost: 5, defaultDifficulty: 'medium', correctPoints: 10, hostBonusPoints: 5, soundEffects: true, backgroundMusic: true, musicTrack: 'arcade', musicVolume: 85, sfxVolume: 65, theme: 'violet', motionEffects: true, speechLanguage: 'en-IN', videoEffect: 'natural', videoQuality: 'balanced' };
const PREFERENCE_KEY = 'ghosthint.preferences.v1';
const THEME_COLORS: Record<ThemeName, { accent: string; bright: string; mint: string; orange: string }> = { violet: { accent: '#9b8cff', bright: '#b2a6ff', mint: '#98f3d1', orange: '#ffbd98' }, neon: { accent: '#39d9f2', bright: '#a4f7ff', mint: '#c6ff69', orange: '#ff5ac8' }, ocean: { accent: '#579eff', bright: '#9bc8ff', mint: '#60efd0', orange: '#ffc276' }, sunset: { accent: '#ff7db7', bright: '#ffafd3', mint: '#f7d17b', orange: '#ff8c72' } };
function readPreferences(): AppPreferences {
  try {
    const saved = localStorage.getItem(PREFERENCE_KEY);
    if (!saved) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(saved) as Partial<AppPreferences>;
    const merged: AppPreferences = { ...DEFAULT_PREFERENCES, ...parsed };
    const clamp = (value: unknown, minimum: number, maximum: number, fallback: number) => { const number = Number(value); return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback; };
    merged.defaultRoundSeconds = Math.round(clamp(merged.defaultRoundSeconds, 30, 600, 60) / 30) * 30;
    merged.defaultRoundsPerHost = Math.round(clamp(merged.defaultRoundsPerHost, 1, 10, 5));
    merged.correctPoints = Math.round(clamp(merged.correctPoints, 5, 50, 10) / 5) * 5;
    merged.hostBonusPoints = Math.round(clamp(merged.hostBonusPoints, 0, 25, 5) / 5) * 5;
    merged.musicVolume = clamp(merged.musicVolume, 0, 100, 85);
    merged.sfxVolume = clamp(merged.sfxVolume, 0, 100, 65);
    if (!('musicTrack' in parsed)) merged.musicVolume = Math.max(85, Number(parsed.musicVolume) || 85);
    if (!['easy', 'medium', 'hard', 'hardest'].includes(merged.defaultDifficulty)) merged.defaultDifficulty = 'medium';
    if (!['arcade', 'dream', 'pulse', 'retro', 'chill', 'boss', 'custom'].includes(merged.musicTrack)) merged.musicTrack = 'arcade';
    if (!['violet', 'neon', 'ocean', 'sunset'].includes(merged.theme)) merged.theme = 'violet';
    if (!['en-IN', 'en-US', 'en-GB'].includes(merged.speechLanguage)) merged.speechLanguage = 'en-IN';
    if (!['natural', 'bright', 'warm', 'cool', 'mono', 'vivid', 'soft'].includes(merged.videoEffect)) merged.videoEffect = 'natural';
    if (!['low', 'balanced', 'high'].includes(merged.videoQuality)) merged.videoQuality = 'balanced';
    return merged;
  } catch { return DEFAULT_PREFERENCES; }
}
function formatDuration(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }

const MUSIC_DB_NAME = 'ghosthint-custom-audio-v1';
const MUSIC_STORE_NAME = 'assets';
type SavedMusic = { name: string; blob: Blob };
function openMusicDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('This browser cannot save a custom music track.')); return; }
    const request = indexedDB.open(MUSIC_DB_NAME, 1);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(MUSIC_STORE_NAME)) db.createObjectStore(MUSIC_STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local music storage.'));
  });
}
async function saveMusicToDevice(file: File): Promise<void> {
  const db = await openMusicDatabase();
  try { await new Promise<void>((resolve, reject) => { const request = db.transaction(MUSIC_STORE_NAME, 'readwrite').objectStore(MUSIC_STORE_NAME).put({ name: file.name, blob: file } satisfies SavedMusic, 'customTrack'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error || new Error('Could not save music file.')); }); }
  finally { db.close(); }
}
async function loadMusicFromDevice(): Promise<SavedMusic | null> {
  const db = await openMusicDatabase();
  try { return await new Promise((resolve, reject) => { const request = db.transaction(MUSIC_STORE_NAME, 'readonly').objectStore(MUSIC_STORE_NAME).get('customTrack'); request.onsuccess = () => resolve((request.result as SavedMusic | undefined) || null); request.onerror = () => reject(request.error || new Error('Could not read saved music.')); }); }
  finally { db.close(); }
}
async function removeMusicFromDevice(): Promise<void> {
  const db = await openMusicDatabase();
  try { await new Promise<void>((resolve, reject) => { const request = db.transaction(MUSIC_STORE_NAME, 'readwrite').objectStore(MUSIC_STORE_NAME).delete('customTrack'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error || new Error('Could not remove saved music.')); }); }
  finally { db.close(); }
}
function filterForVideo(effect: VideoEffect): string {
  const filters: Record<VideoEffect, string> = { natural: 'none', bright: 'brightness(1.12) contrast(1.05) saturate(1.08)', warm: 'sepia(0.14) saturate(1.18) contrast(1.04)', cool: 'hue-rotate(10deg) saturate(1.08) brightness(1.03)', mono: 'grayscale(1) contrast(1.1)', vivid: 'saturate(1.42) contrast(1.08)', soft: 'brightness(1.06) saturate(1.04) blur(0.25px)' };
  return filters[effect];
}

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);
const SESSION_KEY = 'ghosthint.session.v1';

async function apiRequest<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as ApiError).error || 'Something went wrong. Please try again.');
  return data as T;
}

function initials(name: string) { return name.trim().slice(0, 1).toUpperCase() || '?'; }
function formatTime(timestamp: number) { return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function modeLabel(mode: string) { return mode === 'word' ? 'Word clues' : mode === 'picture' ? 'Picture clues' : 'Mixed clues'; }

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    try { const saved = localStorage.getItem(SESSION_KEY); return saved ? JSON.parse(saved) as Session : null; } catch { return null; }
  });
  const [prefs, setPrefs] = useState<AppPreferences>(readPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const preferencesRef = useRef(prefs);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [showGuestName, setShowGuestName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [createName, setCreateName] = useState('Friday Night Room');
  const [createMode, setCreateMode] = useState<'word' | 'picture' | 'mixed'>('mixed');
  const [createDifficulty, setCreateDifficulty] = useState<Difficulty>(() => readPreferences().defaultDifficulty);
  const [createSeconds, setCreateSeconds] = useState<number>(() => readPreferences().defaultRoundSeconds);
  const [createRoundsPerHost, setCreateRoundsPerHost] = useState<number>(() => readPreferences().defaultRoundsPerHost);
  const [joinCode, setJoinCode] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendName, setFriendName] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [guess, setGuess] = useState('');
  const [hint, setHint] = useState('');
  const [chatText, setChatText] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [mediaMode, setMediaMode] = useState<'off' | 'voice' | 'video'>('off');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [remoteMedia, setRemoteMedia] = useState<Record<string, RemoteMedia>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraMuted, setCameraMuted] = useState(false);
  const [customMusicUrl, setCustomMusicUrl] = useState<string | null>(null);
  const [customMusicName, setCustomMusicName] = useState<string | null>(null);
  const [friendsBusy, setFriendsBusy] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerRetryTimersRef = useRef<Map<string, number>>(new Map());
  const peerRetryCountsRef = useRef<Map<string, number>>(new Map());
  const pendingRenegotiationRef = useRef<Map<string, () => void>>(new Map());
  const candidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteNamesRef = useRef<Map<string, string>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const customMusicAudioRef = useRef<HTMLAudioElement | null>(null);
  const cameraSourceStreamRef = useRef<MediaStream | null>(null);
  const videoProcessorRef = useRef<{ sourceVideo: HTMLVideoElement; canvas: HTMLCanvasElement; rafId: number; processedStream: MediaStream } | null>(null);
  const guessPendingRef = useRef(false);
  const guessRequestTimeoutRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const musicTimerRef = useRef<number | null>(null);
  const musicStepRef = useRef(0);
  const previousRemainingRef = useRef<number | null>(null);
  const previousGameEventRef = useRef('');
  const activeMusicConfigRef = useRef<{ track: MusicTrack; url: string | null; shouldPlay: boolean }>({ track: prefs.musicTrack, url: customMusicUrl, shouldPlay: false });
  const customMusicActionRef = useRef(0);
  const showNoticeRef = useRef<(text: string, type?: 'error' | 'success' | 'info') => void>(() => undefined);

  preferencesRef.current = prefs;
  const isLoggedIn = Boolean(session?.token);

  const setPreferences = useCallback((next: AppPreferences) => {
    const previous = preferencesRef.current;
    preferencesRef.current = next;
    setPrefs(next);
    try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next)); } catch { /* Preferences remain usable for this session. */ }
    if (next.defaultRoundSeconds !== previous.defaultRoundSeconds) setCreateSeconds(next.defaultRoundSeconds);
    if (next.defaultRoundsPerHost !== previous.defaultRoundsPerHost) setCreateRoundsPerHost(next.defaultRoundsPerHost);
    if (next.defaultDifficulty !== previous.defaultDifficulty) setCreateDifficulty(next.defaultDifficulty);
  }, []);

  useEffect(() => {
    const colors = THEME_COLORS[prefs.theme];
    const root = document.documentElement;
    root.style.setProperty('--purple', colors.accent); root.style.setProperty('--purple-bright', colors.bright);
    root.style.setProperty('--mint', colors.mint); root.style.setProperty('--orange', colors.orange);
    root.dataset.motion = prefs.motionEffects ? 'on' : 'off';
  }, [prefs.theme, prefs.motionEffects]);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      audioContextRef.current = new AudioContextCtor();
    }
    if (audioContextRef.current.state === 'suspended') void audioContextRef.current.resume();
    return audioContextRef.current;
  }, []);

  const playSound = useCallback((kind: 'tick' | 'correct' | 'start' | 'timeout' | 'wrong') => {
    const settings = preferencesRef.current;
    if (!settings.soundEffects || settings.sfxVolume <= 0) return;
    const ctx = getAudioContext(); if (!ctx) return;
    const notes: Record<typeof kind, number[]> = { tick: [760], correct: [523.25, 659.25, 783.99], start: [392, 523], timeout: [440, 330], wrong: [230] };
    notes[kind].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
      oscillator.type = kind === 'tick' ? 'square' : 'triangle'; oscillator.frequency.value = frequency;
      const startAt = ctx.currentTime + index * (kind === 'correct' ? 0.09 : 0.12);
      const peak = (settings.sfxVolume / 100) * (kind === 'tick' ? 0.045 : 0.12);
      gain.gain.setValueAtTime(0.0001, startAt); gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), startAt + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, startAt + (kind === 'tick' ? 0.07 : 0.24));
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(startAt); oscillator.stop(startAt + 0.27);
    });
  }, [getAudioContext]);

  const stopMusic = useCallback(() => {
    if (musicTimerRef.current !== null) window.clearTimeout(musicTimerRef.current);
    musicTimerRef.current = null;
    const audio = customMusicAudioRef.current;
    if (audio && !audio.paused) audio.pause();
  }, []);

  const startMusic = useCallback(() => {
    const settings = preferencesRef.current;
    if (!settings.backgroundMusic || settings.musicVolume <= 0) return;
    if (settings.musicTrack === 'custom') {
      const audio = customMusicAudioRef.current;
      if (!audio) return;
      audio.volume = Math.min(1, Math.max(0, settings.musicVolume / 100));
      if (audio.paused) void audio.play().catch(() => { /* Browser audio may require another user gesture. */ });
      return;
    }
    if (musicTimerRef.current !== null) return;
    const ctx = getAudioContext(); if (!ctx) return;
    const tracks: Record<Exclude<MusicTrack, 'custom'>, number[]> = {
      arcade: [261.63, 329.63, 392, 493.88, 392, 329.63, 293.66, 349.23, 440, 523.25, 440, 349.23],
      dream: [392, 440, 523.25, 659.25, 587.33, 523.25, 440, 392, 349.23, 392, 440, 523.25],
      pulse: [130.81, 196, 261.63, 196, 146.83, 220, 293.66, 220, 164.81, 246.94, 329.63, 246.94],
      retro: [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 587.33, 698.46, 880, 1046.5, 880, 698.46],
      chill: [196, 246.94, 293.66, 369.99, 329.63, 293.66, 246.94, 220, 174.61, 220, 261.63, 329.63],
      boss: [110, 146.83, 164.81, 220, 164.81, 146.83, 123.47, 185, 220, 246.94, 185, 164.81],
    };
    const playNext = () => {
      const current = preferencesRef.current;
      if (!current.backgroundMusic || current.musicVolume <= 0 || current.musicTrack === 'custom') { musicTimerRef.current = null; return; }
      const activeContext = audioContextRef.current; if (!activeContext) { musicTimerRef.current = null; return; }
      if (activeContext.state === 'suspended') void activeContext.resume();
      const melody = tracks[current.musicTrack];
      const step = musicStepRef.current++; const frequency = melody[step % melody.length];
      const oscillator = activeContext.createOscillator(); const gain = activeContext.createGain();
      oscillator.type = current.musicTrack === 'retro' ? 'triangle' : current.musicTrack === 'boss' ? 'sawtooth' : 'sine'; oscillator.frequency.value = frequency;
      const now = activeContext.currentTime;
      const peak = Math.max(0.0001, Math.min(0.16, current.musicVolume / 100 * 0.17));
      const duration = current.musicTrack === 'dream' || current.musicTrack === 'chill' ? 0.55 : current.musicTrack === 'boss' ? 0.24 : 0.34;
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(peak, now + 0.035); gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain); gain.connect(activeContext.destination); oscillator.start(now); oscillator.stop(now + duration + 0.02);
      if (step % 4 === 0) {
        const bass = activeContext.createOscillator(); const bassGain = activeContext.createGain();
        bass.type = 'sine'; bass.frequency.value = frequency / 2;
        bassGain.gain.setValueAtTime(0.0001, now); bassGain.gain.exponentialRampToValueAtTime(peak * 0.28, now + 0.025); bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        bass.connect(bassGain); bassGain.connect(activeContext.destination); bass.start(now); bass.stop(now + 0.22);
      }
      musicTimerRef.current = window.setTimeout(playNext, current.musicTrack === 'dream' || current.musicTrack === 'chill' ? 530 : current.musicTrack === 'pulse' || current.musicTrack === 'boss' ? 310 : 360);
    };
    playNext();
  }, [getAudioContext, prefs.musicTrack, customMusicUrl]);

  useEffect(() => {
    let cancelled = false;
    const actionVersion = customMusicActionRef.current;
    void loadMusicFromDevice().then((saved) => {
      if (cancelled || customMusicActionRef.current !== actionVersion || !saved) return;
      setCustomMusicName(saved.name);
      setCustomMusicUrl(URL.createObjectURL(saved.blob));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const audio = customMusicUrl ? new Audio(customMusicUrl) : null;
    if (audio) { audio.loop = true; audio.preload = 'auto'; audio.volume = Math.min(1, Math.max(0, prefs.musicVolume / 100)); audio.onerror = () => showNoticeRef.current('This audio file could not be played. Try an MP3, WAV, or OGG file.', 'error'); customMusicAudioRef.current = audio; }
    return () => {
      if (audio) { audio.pause(); audio.onerror = null; audio.removeAttribute('src'); audio.load(); if (customMusicAudioRef.current === audio) customMusicAudioRef.current = null; }
    };
  }, [customMusicUrl]);

  useEffect(() => {
    if (customMusicAudioRef.current) customMusicAudioRef.current.volume = Math.min(1, Math.max(0, prefs.musicVolume / 100));
  }, [prefs.musicVolume]);

  useEffect(() => {
    const url = customMusicUrl;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [customMusicUrl]);

  const isRoomOwner = Boolean(room && session && room.ownerId === session.user.id);
  const me = useMemo(() => room?.players.find((player) => player.id === session?.user.id), [room?.players, session?.user.id]);

  const showNotice = useCallback((text: string, type: 'error' | 'success' | 'info' = 'info') => {
    setNotice({ text, type });
    window.setTimeout(() => setNotice((current) => current?.text === text ? null : current), 4200);
  }, []);
  showNoticeRef.current = showNotice;

  const acceptSession = useCallback((next: Session) => {
    setSession(next);
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setPassword(''); setNotice(null); setShowGuestName(false);
  }, []);

  const resetMedia = useCallback(() => {
    peerConnectionsRef.current.forEach((pc, targetId) => { const waiter = pendingRenegotiationRef.current.get(targetId); if (waiter) pc.removeEventListener('signalingstatechange', waiter); pc.close(); });
    peerConnectionsRef.current.clear(); pendingRenegotiationRef.current.clear(); peerRetryCountsRef.current.clear();
    peerRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer)); peerRetryTimersRef.current.clear();
    candidateQueueRef.current.clear();
    remoteNamesRef.current.clear();
    setRemoteMedia({});
    const processor = videoProcessorRef.current;
    if (processor) { cancelAnimationFrame(processor.rafId); processor.sourceVideo.pause(); processor.sourceVideo.srcObject = null; processor.processedStream.getTracks().forEach((track) => track.stop()); videoProcessorRef.current = null; }
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach((track) => track.stop());
    if (cameraSourceStreamRef.current) cameraSourceStreamRef.current.getTracks().forEach((track) => track.stop());
    cameraSourceStreamRef.current = null;
    localStreamRef.current = null;
    if (guessRequestTimeoutRef.current !== null) window.clearTimeout(guessRequestTimeoutRef.current);
    guessRequestTimeoutRef.current = null; guessPendingRef.current = false;
    if (speechRecognitionRef.current) { try { speechRecognitionRef.current.abort?.(); speechRecognitionRef.current.stop(); } catch { /* Recognition may already have ended. */ } speechRecognitionRef.current = null; }
    setLocalStream(null); setMediaMode('off'); setMicMuted(false); setCameraMuted(false);
  }, []);

  const leaveRoom = useCallback((announce = true) => {
    resetMedia();
    if (socketRef.current) socketRef.current.emit('room:leave');
    setRoom(null); roomRef.current = null;
    setGuess(''); setHint(''); setChatText(''); setFeedback(null);
    if (announce) showNotice('You left the room.', 'info');
  }, [resetMedia, showNotice]);

  const logout = useCallback(() => {
    if (socketRef.current) socketRef.current.disconnect();
    socketRef.current = null; setSocket(null);
    resetMedia(); setRoom(null); roomRef.current = null;
    localStorage.removeItem(SESSION_KEY); setSession(null); setFriends([]);
    setUsername(''); setEmail(''); setPassword(''); setNotice(null);
  }, [resetMedia]);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { roomRef.current = room; }, [room]);

  useEffect(() => {
    if (!session?.token) return;
    const currentSocket = io(SERVER_URL, { auth: { token: session.token }, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 500, reconnectionDelayMax: 5000, timeout: 10000 });
    setSocket(currentSocket); socketRef.current = currentSocket;
    let hasConnectedOnce = false;
    currentSocket.on('connect', () => {
      setNotice((current) => current?.type === 'error' ? null : current);
      if (hasConnectedOnce) {
        const roomCode = roomRef.current?.code;
        if (roomCode) currentSocket.emit('room:join', { code: roomCode }, (result: { ok: boolean; error?: string; room?: RoomState }) => {
          if (!result.ok) { setRoom(null); roomRef.current = null; showNotice(result.error || 'The room could not be restored after reconnecting.', 'error'); return; }
          if (result.room) { setRoom(result.room); roomRef.current = result.room; }
          if (localStreamRef.current) currentSocket.emit('media:ready');
          showNotice('Connection restored. You rejoined the room.', 'success');
        });
      }
      hasConnectedOnce = true;
    });
    currentSocket.on('disconnect', () => {
      peerConnectionsRef.current.forEach((pc, targetId) => { const waiter = pendingRenegotiationRef.current.get(targetId); if (waiter) pc.removeEventListener('signalingstatechange', waiter); pc.close(); }); peerConnectionsRef.current.clear(); pendingRenegotiationRef.current.clear(); peerRetryCountsRef.current.clear();
      peerRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer)); peerRetryTimersRef.current.clear();
      candidateQueueRef.current.clear(); remoteNamesRef.current.clear(); setRemoteMedia({});
    });
    currentSocket.on('connect_error', (error) => showNotice(error.message || 'Could not connect to the game server.', 'error'));
    currentSocket.on('room:state', (next: RoomState) => {
      setRoom(next); roomRef.current = next;
      if (next.status !== 'playing') { setGuess(''); setFeedback(null); guessPendingRef.current = false; if (guessRequestTimeoutRef.current !== null) window.clearTimeout(guessRequestTimeoutRef.current); guessRequestTimeoutRef.current = null; }
    });
    currentSocket.on('room:player-joined', (payload: { socketId: string; playerId: string; username: string }) => {
      remoteNamesRef.current.set(payload.socketId, payload.username);
      showNotice(`${payload.username} joined the room.`, 'info');
      if (localStreamRef.current && currentSocket.id && currentSocket.id < payload.socketId) void createPeerConnection(payload.socketId, true);
    });
    currentSocket.on('room:player-left', (payload: { socketId: string; username: string }) => {
      const peer = peerConnectionsRef.current.get(payload.socketId);
      const renegotiationWaiter = pendingRenegotiationRef.current.get(payload.socketId); if (peer && renegotiationWaiter) peer.removeEventListener('signalingstatechange', renegotiationWaiter); pendingRenegotiationRef.current.delete(payload.socketId);
      peer?.close(); peerConnectionsRef.current.delete(payload.socketId);
      const retryTimer = peerRetryTimersRef.current.get(payload.socketId); if (retryTimer !== undefined) window.clearTimeout(retryTimer); peerRetryTimersRef.current.delete(payload.socketId); peerRetryCountsRef.current.delete(payload.socketId);
      remoteNamesRef.current.delete(payload.socketId);
      candidateQueueRef.current.delete(payload.socketId);
      setRemoteMedia((current) => { const next = { ...current }; delete next[payload.socketId]; return next; });
    });
    currentSocket.on('room:media-ready', (payload: { socketId: string; username: string }) => {
      remoteNamesRef.current.set(payload.socketId, payload.username);
      if (!currentSocket.id) return;
      if (payload.socketId === currentSocket.id) {
        const players = roomRef.current?.players || [];
        for (const player of players) {
          const targetSocketId = player.socketId;
          if (!targetSocketId || targetSocketId === currentSocket.id) continue;
          const existing = peerConnectionsRef.current.get(targetSocketId);
          if (existing) { if (localStreamRef.current) void addLocalTracksAndRenegotiate(targetSocketId); }
          else if (currentSocket.id < targetSocketId) void createPeerConnection(targetSocketId, true);
        }
      } else if (currentSocket.id < payload.socketId && !peerConnectionsRef.current.has(payload.socketId)) {
        void createPeerConnection(payload.socketId, true);
      }
    });
    currentSocket.on('room:media-off', (payload: { socketId: string }) => {
      const peer = peerConnectionsRef.current.get(payload.socketId);
      const renegotiationWaiter = pendingRenegotiationRef.current.get(payload.socketId); if (peer && renegotiationWaiter) peer.removeEventListener('signalingstatechange', renegotiationWaiter); pendingRenegotiationRef.current.delete(payload.socketId);
      peer?.close();
      peerConnectionsRef.current.delete(payload.socketId);
      const retryTimer = peerRetryTimersRef.current.get(payload.socketId); if (retryTimer !== undefined) window.clearTimeout(retryTimer); peerRetryTimersRef.current.delete(payload.socketId); peerRetryCountsRef.current.delete(payload.socketId);
      setRemoteMedia((current) => { const next = { ...current }; delete next[payload.socketId]; return next; });
    });
    currentSocket.on('rtc:signal', async (data: { fromSocketId: string; payload: SignalPayload }) => {
      const { fromSocketId, payload } = data;
      try {
        let pc = peerConnectionsRef.current.get(fromSocketId);
        if (payload.type === 'offer') {
          if (!pc) pc = await createPeerConnection(fromSocketId, false);
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp!));
          const queued = candidateQueueRef.current.get(fromSocketId) || [];
          for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
          candidateQueueRef.current.delete(fromSocketId);
          const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
          currentSocket.emit('rtc:signal', { toSocketId: fromSocketId, payload: { type: 'answer', sdp: pc.localDescription ?? undefined } satisfies SignalPayload });
        } else if (payload.type === 'answer' && pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp!));
          const queued = candidateQueueRef.current.get(fromSocketId) || [];
          for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
          candidateQueueRef.current.delete(fromSocketId);
        } else if (payload.type === 'candidate' && payload.candidate) {
          if (pc?.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => undefined);
          else candidateQueueRef.current.set(fromSocketId, [...(candidateQueueRef.current.get(fromSocketId) || []), payload.candidate]);
        }
      } catch (error) { console.warn('WebRTC signaling error:', error); }
    });
    return () => { currentSocket.disconnect(); setSocket((current) => current === currentSocket ? null : current); socketRef.current = null; };
    // createPeerConnection is a stable function below; avoid reconnecting when UI state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, showNotice]);

  async function addLocalTracksAndRenegotiate(targetSocketId: string): Promise<void> {
    const pc = peerConnectionsRef.current.get(targetSocketId);
    const stream = localStreamRef.current;
    if (!pc || !stream || pc.signalingState === 'closed') return;
    if (pc.signalingState !== 'stable') {
      if (!pendingRenegotiationRef.current.has(targetSocketId)) {
        const waitForStable = () => {
          if (pc.signalingState === 'closed') { pc.removeEventListener('signalingstatechange', waitForStable); pendingRenegotiationRef.current.delete(targetSocketId); return; }
          if (pc.signalingState === 'stable') { pc.removeEventListener('signalingstatechange', waitForStable); pendingRenegotiationRef.current.delete(targetSocketId); void addLocalTracksAndRenegotiate(targetSocketId); }
        };
        pendingRenegotiationRef.current.set(targetSocketId, waitForStable);
        pc.addEventListener('signalingstatechange', waitForStable);
      }
      return;
    }
    const existingTrackIds = new Set(pc.getSenders().map((sender) => sender.track?.id).filter(Boolean));
    let addedTrack = false;
    for (const track of stream.getTracks()) {
      if (existingTrackIds.has(track.id)) continue;
      const reusable = pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === track.kind && !transceiver.sender.track && (transceiver.direction === 'recvonly' || transceiver.direction === 'inactive'));
      if (reusable) {
        try { await reusable.sender.replaceTrack(track); reusable.direction = reusable.direction === 'recvonly' ? 'sendrecv' : 'sendonly'; }
        catch { pc.addTrack(track, stream); }
      } else pc.addTrack(track, stream);
      addedTrack = true;
    }
    if (!addedTrack) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit('rtc:signal', { toSocketId: targetSocketId, payload: { type: 'offer', sdp: pc.localDescription ?? undefined } satisfies SignalPayload });
    } catch (error) { console.warn('Could not renegotiate media tracks:', error); }
  }

  async function createPeerConnection(targetSocketId: string, offer: boolean): Promise<RTCPeerConnection> {
    const old = peerConnectionsRef.current.get(targetSocketId);
    if (old && old.signalingState !== 'closed') {
      if (!offer) return old;
      if (old.localDescription) return old;
    } else {
      const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
      const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
      const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
      const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
      if (turnUrl && turnUsername && turnCredential) iceServers.push({ urls: turnUrl.split(',').map((url) => url.trim()), username: turnUsername, credential: turnCredential });
      const pc = new RTCPeerConnection({ iceServers });
      peerConnectionsRef.current.set(targetSocketId, pc);
      const stream = localStreamRef.current;
      if (stream) stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      pc.onicecandidate = (event) => {
        if (event.candidate) socketRef.current?.emit('rtc:signal', { toSocketId: targetSocketId, payload: { type: 'candidate', candidate: event.candidate.toJSON() } satisfies SignalPayload });
      };
      pc.ontrack = (event) => {
        const streamFromPeer = event.streams[0] || new MediaStream([event.track]);
        setRemoteMedia((current) => ({ ...current, [targetSocketId]: { stream: streamFromPeer, username: remoteNamesRef.current.get(targetSocketId) || 'Player' } }));
      };
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected' || state === 'connecting') {
          const pending = peerRetryTimersRef.current.get(targetSocketId);
          if (pending !== undefined) window.clearTimeout(pending);
          peerRetryTimersRef.current.delete(targetSocketId);
          if (state === 'connected') peerRetryCountsRef.current.delete(targetSocketId);
          return;
        }
        if (state === 'closed') {
          if (peerConnectionsRef.current.get(targetSocketId) === pc) peerConnectionsRef.current.delete(targetSocketId);
          const pending = peerRetryTimersRef.current.get(targetSocketId);
          if (pending !== undefined) window.clearTimeout(pending);
          peerRetryTimersRef.current.delete(targetSocketId);
          setRemoteMedia((current) => { const next = { ...current }; delete next[targetSocketId]; return next; });
          return;
        }
        if (state === 'failed' || state === 'disconnected') {
          if (peerRetryTimersRef.current.has(targetSocketId)) return;
          const attempts = peerRetryCountsRef.current.get(targetSocketId) || 0;
          if (attempts >= 3) return;
          const retryDelay = state === 'failed' ? 900 + attempts * 900 : 3500 + attempts * 1000;
          const timer = window.setTimeout(() => {
            peerRetryTimersRef.current.delete(targetSocketId);
            if (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting') peerRetryCountsRef.current.set(targetSocketId, attempts + 1);
            if (pc.connectionState === 'connected' || pc.connectionState === 'connecting') return;
            if (peerConnectionsRef.current.get(targetSocketId) === pc) peerConnectionsRef.current.delete(targetSocketId);
            pc.close();
            setRemoteMedia((current) => { const next = { ...current }; delete next[targetSocketId]; return next; });
            const localSocketId = socketRef.current?.id;
            if (socketRef.current?.connected && localSocketId && localSocketId < targetSocketId && roomRef.current) {
              void createPeerConnection(targetSocketId, true).catch((error) => console.warn('Peer retry failed:', error));
            }
          }, retryDelay);
          peerRetryTimersRef.current.set(targetSocketId, timer);
        }
      };
      if (offer) {
        // Create receive-only transceivers when this player has their own mic/camera off.
        // This lets a peer send media to a watcher who hasn't enabled their camera.
        if (!stream) { pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); }
        const description = await pc.createOffer(); await pc.setLocalDescription(description);
        socketRef.current?.emit('rtc:signal', { toSocketId: targetSocketId, payload: { type: 'offer', sdp: pc.localDescription ?? undefined } satisfies SignalPayload });
      }
      return pc;
    }
    return old;
  }

  useEffect(() => {
    if (!session?.token || session.user.guest) { setFriends([]); return; }
    void apiRequest<{ friends: Friend[] }>('/api/friends', session.token).then((result) => setFriends(result.friends)).catch(() => undefined);
  }, [session?.token, session?.user.guest]);

  useEffect(() => {
    if (!room?.roundEndsAt || room.status !== 'playing') { setRemaining(0); return; }
    const update = () => setRemaining(Math.max(0, Math.ceil((room.roundEndsAt! - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [room?.roundEndsAt, room?.status]);

  useEffect(() => {
    if (remaining > 0 && remaining <= 10 && previousRemainingRef.current !== remaining) playSound('tick');
    previousRemainingRef.current = remaining;
  }, [remaining, playSound]);

  useEffect(() => {
    if (!room) { previousGameEventRef.current = ''; return; }
    const eventKey = `${room.status}:${room.roundNumber}:${room.lastResult?.winnerId || ''}:${room.lastResult?.reason || ''}`;
    if (eventKey !== previousGameEventRef.current) {
      if (room.status === 'playing') playSound('start');
      else if (room.status === 'roundOver') playSound(room.lastResult?.winnerId ? 'correct' : 'timeout');
      previousGameEventRef.current = eventKey;
    }
  }, [room?.status, room?.roundNumber, room?.lastResult?.winnerId, room?.lastResult?.reason, playSound]);

  const musicShouldPlay = Boolean(room && (room.status === 'playing' || room.status === 'roundOver') && prefs.backgroundMusic && prefs.musicVolume > 0);
  useEffect(() => {
    const previous = activeMusicConfigRef.current;
    const trackChanged = previous.track !== prefs.musicTrack || previous.url !== customMusicUrl;
    if (!musicShouldPlay) stopMusic();
    else { if (trackChanged) stopMusic(); startMusic(); }
    activeMusicConfigRef.current = { track: prefs.musicTrack, url: customMusicUrl, shouldPlay: musicShouldPlay };
  }, [musicShouldPlay, prefs.musicTrack, customMusicUrl, startMusic, stopMusic]);

  useEffect(() => () => {
    stopMusic();
    if (audioContextRef.current) void audioContextRef.current.close();
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach((track) => track.stop());
    if (cameraSourceStreamRef.current) cameraSourceStreamRef.current.getTracks().forEach((track) => track.stop());
  }, [stopMusic]);

  useEffect(() => { messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [room?.messages.length]);

  const authSubmit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      if (authView === 'login') {
        const result = await apiRequest<Session>('/api/auth/login', undefined, { method: 'POST', body: JSON.stringify({ identifier: email || username, password }) });
        acceptSession(result);
      } else {
        const result = await apiRequest<Session>('/api/auth/register', undefined, { method: 'POST', body: JSON.stringify({ username, email, password }) });
        acceptSession(result); showNotice('Account created. Welcome to GhostHint!', 'success');
      }
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Sign-in failed.', 'error'); }
    finally { setBusy(false); }
  };

  const continueAsGuest = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      const result = await apiRequest<Session>('/api/auth/guest', undefined, { method: 'POST', body: JSON.stringify({ username: guestName }) });
      acceptSession(result); showNotice('You’re in. Invite friends with your room code.', 'success');
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Could not start guest session.', 'error'); }
    finally { setBusy(false); }
  };

  const createRoom = () => {
    if (!socket?.connected) { showNotice('Connecting to the game server. Try again in a moment.', 'error'); return; }
    getAudioContext(); socket.emit('room:create', { name: createName, mode: createMode, difficulty: createDifficulty, roundSeconds: createSeconds, roundsPerHost: createRoundsPerHost, correctPoints: prefs.correctPoints, hostBonusPoints: prefs.hostBonusPoints }, (result: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!result.ok) { showNotice(result.error || 'Could not create room.', 'error'); return; }
      setRoom(result.room || null); setFeedback(null); showNotice('Room created. Invite your friends!', 'success');
    });
  };

  const joinRoom = (event: FormEvent) => {
    event.preventDefault(); getAudioContext();
    if (!socket?.connected) { showNotice('Connecting to the game server. Try again in a moment.', 'error'); return; }
    socket.emit('room:join', { code: joinCode }, (result: { ok: boolean; error?: string; room?: RoomState }) => {
      if (!result.ok) { showNotice(result.error || 'Could not join room.', 'error'); return; }
      setRoom(result.room || null); setJoinCode(''); setFeedback(null); showNotice('Joined the room!', 'success');
    });
  };

  const startGame = () => { getAudioContext(); if (prefs.backgroundMusic) startMusic(); socket?.emit('game:start', (result: { ok: boolean; error?: string }) => { if (!result.ok) { stopMusic(); showNotice(result.error || 'Could not start match.', 'error'); } }); };
  const sendHint = (event: FormEvent) => {
    event.preventDefault(); if (!hint.trim()) return;
    socket?.emit('hint:send', { text: hint }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) showNotice(result.error || 'Could not send hint.', 'error'); else setHint('');
    });
  };
  const submitGuess = (value = guess) => {
    const text = value.trim(); if (!text || guessPendingRef.current) return;
    const activeSocket = socketRef.current;
    if (!activeSocket?.connected) { setFeedback({ ok: false, text: 'Connection interrupted. Reconnecting—try again in a moment.' }); return; }
    guessPendingRef.current = true;
    if (guessRequestTimeoutRef.current !== null) window.clearTimeout(guessRequestTimeoutRef.current);
    guessRequestTimeoutRef.current = window.setTimeout(() => { guessPendingRef.current = false; guessRequestTimeoutRef.current = null; setFeedback({ ok: false, text: 'The server took too long to respond. Please try again.' }); }, 5000);
    activeSocket.emit('guess:submit', { text }, (result: { ok: boolean; correct: boolean; error?: string; message?: string }) => {
      if (guessRequestTimeoutRef.current !== null) window.clearTimeout(guessRequestTimeoutRef.current);
      guessRequestTimeoutRef.current = null; guessPendingRef.current = false;
      if (!result.ok) setFeedback({ ok: false, text: result.error || 'Guess could not be submitted.' });
      else if (result.correct) { setFeedback({ ok: true, text: `Correct! You locked it in. +${room?.settings.correctPoints ?? prefs.correctPoints} points` }); setGuess(''); }
      else { setFeedback({ ok: false, text: result.message || 'Not quite. Try again.' }); playSound('wrong'); setGuess(''); }
    });
  };
  const sendChat = (event: FormEvent) => {
    event.preventDefault(); if (!chatText.trim()) return;
    socket?.emit('chat:send', { text: chatText }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) showNotice(result.error || 'Could not send message.', 'error'); else setChatText('');
    });
  };
  const addFriend = async (event: FormEvent) => {
    event.preventDefault(); if (!session || !friendName.trim()) return;
    setFriendsBusy(true);
    try {
      await apiRequest('/api/friends/add', session.token, { method: 'POST', body: JSON.stringify({ username: friendName.trim() }) });
      const result = await apiRequest<{ friends: Friend[] }>('/api/friends', session.token);
      setFriends(result.friends); setFriendName(''); showNotice('Friend added!', 'success');
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Could not add friend.', 'error'); }
    finally { setFriendsBusy(false); }
  };
  const handleCustomMusicUpload = async (file: File) => {
    const knownAudioExtension = /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name);
    if (!file.type.startsWith('audio/') && !knownAudioExtension) { showNotice('Choose an audio file such as MP3, WAV, OGG, or M4A.', 'error'); return; }
    if (file.size > 50 * 1024 * 1024) { showNotice('Custom music must be 50 MB or smaller.', 'error'); return; }
    try {
      const actionVersion = ++customMusicActionRef.current;
      await saveMusicToDevice(file);
      if (customMusicActionRef.current !== actionVersion) return;
      setCustomMusicName(file.name);
      setCustomMusicUrl(URL.createObjectURL(file));
      setPreferences({ ...preferencesRef.current, backgroundMusic: true, musicTrack: 'custom' });
      showNotice(`Saved “${file.name}” as your custom music track.`, 'success');
    } catch (error) { showNotice(error instanceof Error ? error.message : 'Could not save your custom music.', 'error'); }
  };
  const clearCustomMusic = async () => {
    customMusicActionRef.current += 1;
    try { await removeMusicFromDevice(); } catch { /* Continue clearing the active track if storage is unavailable. */ }
    setCustomMusicName(null); setCustomMusicUrl(null);
    setPreferences({ ...preferencesRef.current, musicTrack: 'arcade' });
    showNotice('Custom music removed. Arcade music is selected.', 'info');
  };

  const createProcessedStream = async (sourceStream: MediaStream): Promise<MediaStream> => {
    const sourceVideo = document.createElement('video');
    sourceVideo.muted = true; sourceVideo.playsInline = true; sourceVideo.autoplay = true;
    const metadataReady = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Camera startup timed out. Try turning video off and on again.')), 8000);
      sourceVideo.onloadedmetadata = () => { window.clearTimeout(timeout); resolve(); };
      sourceVideo.onerror = () => { window.clearTimeout(timeout); reject(new Error('Could not read camera frames. Try another camera or lower quality.')); };
    });
    sourceVideo.srcObject = sourceStream;
    try { await metadataReady; await sourceVideo.play(); } catch (error) { sourceVideo.pause(); sourceVideo.srcObject = null; throw error; }
    const quality = preferencesRef.current.videoQuality;
    const maxWidth = quality === 'high' ? 1280 : quality === 'balanced' ? 960 : 640;
    const sourceWidth = sourceVideo.videoWidth || 640; const sourceHeight = sourceVideo.videoHeight || 360;
    const scale = Math.min(1, maxWidth / sourceWidth);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(2, Math.round(sourceWidth * scale)); canvas.height = Math.max(2, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context || typeof canvas.captureStream !== 'function') { sourceVideo.pause(); sourceVideo.srcObject = null; return sourceStream; }
    let processedStream: MediaStream;
    try { processedStream = canvas.captureStream(quality === 'high' ? 30 : 24); }
    catch { sourceVideo.pause(); sourceVideo.srcObject = null; return sourceStream; }
    const processor = { sourceVideo, canvas, rafId: 0, processedStream };
    const draw = () => {
      if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try { context.filter = filterForVideo(preferencesRef.current.videoEffect); context.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height); } catch { /* Ignore a transient camera-frame error and keep processing the next frame. */ }
      }
      processor.rafId = window.requestAnimationFrame(draw);
    };
    videoProcessorRef.current = processor; draw();
    return new MediaStream([...processedStream.getVideoTracks(), ...sourceStream.getAudioTracks()]);
  };

  const startMedia = async (mode: 'voice' | 'video') => {
    if (!room || !socket) return;
    setMediaBusy(true);
    let announcedMediaReady = false;
    try {
      if (localStreamRef.current || cameraSourceStreamRef.current) resetMedia();
      const quality = preferencesRef.current.videoQuality;
      const dimensions = quality === 'high' ? { width: 1280, height: 720, frameRate: 30 } : quality === 'balanced' ? { width: 960, height: 540, frameRate: 24 } : { width: 640, height: 360, frameRate: 24 };
      const sourceStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: mode === 'video' ? { width: { ideal: dimensions.width }, height: { ideal: dimensions.height }, frameRate: { ideal: dimensions.frameRate, max: 30 }, facingMode: 'user' } : false,
      });
      cameraSourceStreamRef.current = sourceStream;
      const stream = mode === 'video' ? await createProcessedStream(sourceStream) : sourceStream;
      localStreamRef.current = stream; setLocalStream(stream); setMediaMode(mode); setMicMuted(false); setCameraMuted(false);
      socket.emit('media:ready'); announcedMediaReady = true;
      const peers = roomRef.current?.players || [];
      for (const player of peers) {
        if (player.socketId && player.socketId !== socket.id && socket.id && socket.id < player.socketId) {
          remoteNamesRef.current.set(player.socketId, player.username);
          await createPeerConnection(player.socketId, true);
        }
      }
      showNotice(mode === 'video' ? `Camera enabled · ${quality} quality · ${preferencesRef.current.videoEffect} effect.` : 'Microphone enabled with noise suppression.', 'success');
    } catch (error) {
      if (announcedMediaReady) socket.emit('media:off');
      resetMedia();
      showNotice(error instanceof Error ? error.message : 'Allow microphone/camera access to start calling.', 'error');
    } finally { setMediaBusy(false); }
  };
  const stopMedia = () => {
    socket?.emit('media:off'); resetMedia(); showNotice('Voice/video turned off.', 'info');
  };
  const toggleMic = () => {
    const next = !micMuted; localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; }); setMicMuted(next);
  };
  const toggleCamera = () => {
    const next = !cameraMuted; localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next; }); setCameraMuted(next);
  };
  const copyCode = async () => {
    if (!room) return;
    try { await navigator.clipboard.writeText(room.code); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    catch { showNotice(`Room code: ${room.code}`, 'info'); }
  };
  const skipRound = () => socket?.emit('game:skip', (result: { ok: boolean; error?: string }) => { if (!result.ok) showNotice(result.error || 'Could not skip round.', 'error'); });
  const speechGuess = () => {
    type SpeechResult = { transcript: string };
    type SpeechEvent = Event & { results: ArrayLike<ArrayLike<SpeechResult>> };
    type SpeechRecognitionLike = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((event: SpeechEvent) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void; abort?: () => void };
    const SpeechRecognitionCtor = (window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) { showNotice('Voice-to-text guessing is not supported by this browser. You can type your guess.', 'error'); return; }
    try { speechRecognitionRef.current?.abort?.(); } catch { /* Previous recognition may already be complete. */ }
    const recognition = new SpeechRecognitionCtor(); recognition.lang = prefs.speechLanguage; recognition.interimResults = false; recognition.maxAlternatives = 1;
    speechRecognitionRef.current = recognition;
    recognition.onresult = (event) => { const spoken = event.results[0]?.[0]?.transcript || ''; if (spoken.trim()) { setGuess(spoken); submitGuess(spoken); } };
    recognition.onerror = () => showNotice('Could not hear that clearly. Try again or type your guess.', 'error');
    recognition.onend = () => { if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null; };
    try { recognition.start(); showNotice('Listening… say your guess clearly.', 'info'); }
    catch { speechRecognitionRef.current = null; showNotice('Microphone recognition is already active. Try again in a moment.', 'error'); }
  };

  const roomMessages = room?.messages || [];
  const recentHints = roomMessages.filter((message) => message.type === 'hint').slice(-3);

  if (!isLoggedIn || !session) {
    return (
      <div className={styles.authShell}>
        <div className={styles.ambientGlow} />
        <header className={styles.authTopbar}>
          <div className={styles.brandLockup}><div className={styles.brandMark}><WandSparkles size={21} /></div><span>ghost<span className={styles.brandAccent}>hint</span></span></div>
          <div className={styles.topbarNote}><span className={styles.liveDot} /> Multiplayer party game</div>
        </header>
        <main className={styles.authGrid}>
          <section className={styles.heroCopy}>
            <div className={styles.eyebrow}><Sparkles size={14} /> YOUR NEXT GAME NIGHT</div>
            <h1>Think fast.<br /><span>Guess together.</span></h1>
            <p className={styles.heroLead}>One secret answer. One clue-giver. A room full of terrible guesses and brilliant moments.</p>
            <div className={styles.heroFeatures}>
              <div className={styles.featureRow}><div className={styles.featureIcon}><Users size={18} /></div><div><strong>Bring your people</strong><span>Make a room, share a code, play together.</span></div></div>
              <div className={styles.featureRow}><div className={styles.featureIcon}><Zap size={18} /></div><div><strong>Beat the clock</strong><span>Quick clues. Locked answers. Live scores.</span></div></div>
              <div className={styles.featureRow}><div className={styles.featureIcon}><AudioLines size={18} /></div><div><strong>Play your way</strong><span>Text, voice, or video while you guess.</span></div></div>
            </div>
            <div className={styles.previewCard}>
              <div className={styles.previewTop}><span className={styles.previewLive}><span /> LIVE ROOM</span><span className={styles.previewRound}>ROUND 03 / 15</span></div>
              <div className={styles.previewMain}><div className={styles.previewAvatar}>G</div><div className={styles.previewClue}><strong>Ghost is giving a clue…</strong><span>“You might see one after a storm.”</span></div><div className={styles.previewTimer}>00:24</div></div>
              <div className={styles.previewBottom}><span><span className={styles.tinyAvatar}>M</span> Maya guessed</span><span className={styles.previewPoints}>+10 pts ✦</span></div>
            </div>
          </section>
          <section className={styles.authPanel}>
            <div className={styles.authPanelHeader}>
              <div className={styles.panelGlyph}><Gamepad2 size={21} /></div>
              <div><h2>{authView === 'login' ? 'Welcome back' : 'Create your account'}</h2><p>{authView === 'login' ? 'Your next winning guess is waiting.' : 'Set up your player profile in seconds.'}</p></div>
            </div>
            <div className={styles.authTabs}><button className={authView === 'login' ? styles.activeTab : ''} onClick={() => { setAuthView('login'); setNotice(null); }}>Log in</button><button className={authView === 'register' ? styles.activeTab : ''} onClick={() => { setAuthView('register'); setNotice(null); }}>Create account</button></div>
            <form className={styles.authForm} onSubmit={authSubmit}>
              {authView === 'register' && <label className={styles.field}><span>Username</span><div className={styles.inputWrap}><Users size={16} /><input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your_player_name" minLength={3} maxLength={18} required /></div></label>}
              <label className={styles.field}><span>{authView === 'login' ? 'Username or email' : 'Email address'}</span><div className={styles.inputWrap}><span className={styles.inputGlyph}>@</span><input autoComplete={authView === 'login' ? 'username' : 'email'} type={authView === 'login' ? 'text' : 'email'} value={email} onChange={(e) => { setEmail(e.target.value); if (authView === 'login') setUsername(e.target.value); }} placeholder={authView === 'login' ? 'you@example.com or username' : 'you@example.com'} required /></div></label>
              <label className={styles.field}><span>Password</span><div className={styles.inputWrap}><LockKeyhole size={16} /><input autoComplete={authView === 'login' ? 'current-password' : 'new-password'} type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={authView === 'login' ? 'Enter your password' : 'At least 8 characters'} minLength={authView === 'register' ? 8 : undefined} required /><button type="button" className={styles.inputAction} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
              <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? 'Please wait…' : authView === 'login' ? 'Log in to GhostHint' : 'Create account'}<ArrowRight size={17} /></button>
            </form>
            <div className={styles.orLine}><span /> <em>OR</em> <span /></div>
            {!showGuestName ? <button className={styles.guestButton} onClick={() => setShowGuestName(true)}><DoorOpen size={17} /> Continue as guest <span>No account needed</span></button> : <form className={styles.guestForm} onSubmit={continueAsGuest}><label className={styles.field}><span>Guest name <small>(optional)</small></span><div className={styles.inputWrap}><Users size={16} /><input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Guest_123" maxLength={18} /></div></label><div className={styles.guestActions}><button type="button" className={styles.textButton} onClick={() => setShowGuestName(false)}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Joining…' : 'Join as guest'}<ArrowRight size={16} /></button></div></form>}
            <div className={styles.privacyNote}><LockKeyhole size={13} /> Your password is encrypted. Guests can play without an account.</div>
          </section>
        </main>
        <footer className={styles.authFooter}><span>© 2026 GhostHint</span><span>Made for your group chat to get louder.</span><button onClick={() => showNotice('Tip: create a room, invite at least one friend, then start the match.', 'info')}><CircleHelp size={14} /> How to play</button></footer>
        {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      </div>
    );
  }

  if (room) {
    return (
      <div className={styles.appShell}>
        <div className={styles.appGlow} />
        <header className={styles.appTopbar}>
          <div className={styles.brandLockup}><div className={styles.brandMark}><WandSparkles size={20} /></div><span>ghost<span className={styles.brandAccent}>hint</span></span></div>
          <div className={styles.roomTopCenter}><span className={styles.roomLiveDot} /> <span>{room.status === 'waiting' ? 'WAITING ROOM' : room.status === 'finished' ? 'MATCH COMPLETE' : 'LIVE MATCH'}</span><i /> <span>{room.name}</span></div>
          <div className={styles.topbarUser}><div className={styles.smallAvatar}>{initials(session.user.username)}</div><span>{session.user.username}{session.user.guest ? <small>Guest</small> : null}</span><button className={styles.iconButton} title="Game settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button><button className={styles.iconButton} title="Leave room" onClick={() => leaveRoom()}><DoorOpen size={17} /></button></div>
        </header>
        <main className={styles.roomPage}>
          <div className={styles.roomHeading}><div><div className={styles.eyebrow}><Sparkles size={13} /> PRIVATE GAME ROOM</div><h1>{room.name}</h1><p>Share the code, get your friends in, and let the guessing begin.</p></div><button className={styles.roomCodeCard} onClick={copyCode}><span>ROOM CODE</span><strong>{room.code}</strong><em>{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy invite code</>}</em></button></div>
          {room.status === 'waiting' ? (
            <div className={styles.lobbyGrid}>
              <section className={`${styles.card} ${styles.lobbyMain}`}>
                <div className={styles.cardTitle}><div><h2>Players in the room</h2><p>{room.players.length} of 8 players · at least 2 to start</p></div><span className={styles.countPill}>{room.players.length}/8</span></div>
                <div className={styles.playerGrid}>{room.players.map((player, index) => <div key={player.id} className={styles.playerCard}><div className={`${styles.avatar} ${index % 4 === 1 ? styles.avatarLilac : index % 4 === 2 ? styles.avatarPeach : index % 4 === 3 ? styles.avatarMint : ''}`}>{player.avatar}</div><div><strong>{player.username}{player.id === session.user.id ? <em>YOU</em> : null}</strong><span>{player.id === room.ownerId ? <><Crown size={12} /> Room host</> : player.guest ? 'Guest player' : 'Player'}</span></div><span className={player.connected ? styles.connectedStatus : styles.offlineStatus}>{player.connected ? 'Ready' : 'Offline'}</span></div>)}</div>
                <div className={styles.lobbyInvite}><div className={styles.inviteIcon}><UserPlus size={19} /></div><div><strong>Bring your crew</strong><span>Send them the room code. Everyone joins before the match starts.</span></div><button className={styles.secondaryButton} onClick={copyCode}><Copy size={15} /> Invite</button></div>
                {isRoomOwner ? <button className={styles.primaryButton} onClick={startGame} disabled={room.players.filter((player) => player.connected).length < 2}><Zap size={18} /> Start match <ArrowRight size={17} /></button> : <div className={styles.waitingBanner}><div className={styles.pulseDot} /> Waiting for {room.players.find((player) => player.id === room.ownerId)?.username || 'the room host'} to start the match…</div>}
              </section>
              <aside className={styles.lobbySide}>
                <section className={styles.card}><div className={styles.cardTitle}><div><h2>Match settings</h2><p>The host picked these rules</p></div><LockKeyhole size={17} className={styles.mutedIcon} /></div><div className={styles.settingRow}><span>Clue style</span><strong>{modeLabel(room.settings.mode)}</strong></div><div className={styles.settingRow}><span>Difficulty</span><strong className={styles.difficultyText}>{(room.settings.difficulty || 'medium').toUpperCase()}</strong></div><div className={styles.settingRow}><span>Time per round</span><strong><Clock3 size={14} /> {formatDuration(room.settings.roundSeconds)}</strong></div><div className={styles.settingRow}><span>Rounds per host</span><strong>{room.settings.roundsPerHost} rounds</strong></div><div className={styles.ruleNote}><Sparkles size={15} /><span>Each player hosts {room.settings.roundsPerHost} rounds. Players can lock a guess before any hint. A correct guess earns <b>{room.settings.correctPoints} points</b>; a host hint bonus is <b>{room.settings.hostBonusPoints} points</b>.</span></div></section>
                <section className={styles.card}><div className={styles.cardTitle}><div><h2>Your friends</h2><p>Saved players to invite</p></div><Users size={17} className={styles.mutedIcon} /></div>{session.user.guest ? <p className={styles.emptyFriends}>Create an account to save friends between games.</p> : friends.length ? <div className={styles.friendList}>{friends.slice(0, 4).map((friend) => <div key={friend.id} className={styles.friendRow}><div className={styles.friendAvatar}>{initials(friend.username)}</div><span>{friend.username}</span><button onClick={copyCode} title="Copy room code"><Copy size={14} /></button></div>)}</div> : <p className={styles.emptyFriends}>No saved friends yet. Add friends from the dashboard after this match.</p>}</section>
              </aside>
            </div>
          ) : room.status === 'finished' ? (
            <div className={styles.finishGrid}><section className={`${styles.card} ${styles.finishCard}`}><div className={styles.winnerBurst}><Trophy size={32} /></div><div className={styles.eyebrow}>MATCH COMPLETE</div><h2>{room.winner?.[0]?.username === session.user.username ? 'You took the crown!' : `${room.winner?.[0]?.username || 'A champion'} wins!`}</h2><p>Everyone took their turn as host. Here is how the room finished.</p><div className={styles.finalLeaderboard}>{(room.winner || []).map((player) => <div key={player.id} className={`${styles.finalPlayer} ${player.rank === 1 ? styles.firstPlace : ''}`}><span className={styles.rankNumber}>{player.rank === 1 ? <Crown size={16} /> : `#${player.rank}`}</span><div className={styles.friendAvatar}>{initials(player.username)}</div><strong>{player.username}{player.id === session.user.id ? ' (you)' : ''}</strong><b>{player.score} <small>pts</small></b></div>)}</div><button className={styles.primaryButton} onClick={() => leaveRoom(false)}><Plus size={17} /> Back to dashboard</button></section><aside className={styles.card}><h2>Round recap</h2><div className={styles.recapList}>{room.history.slice().reverse().slice(0, 8).map((result) => <div key={result.roundNumber} className={styles.recapRow}><span>R{result.roundNumber}</span><div><strong>{result.answer}</strong><small>{result.winnerName ? `${result.winnerName} guessed first` : result.reason === 'skipped' ? 'Host skipped' : result.reason === 'host-disconnected' ? 'Host disconnected' : 'Time ran out'}</small></div><b>{result.winnerName ? '+10' : '—'}</b></div>)}</div></aside></div>
          ) : (
            <div className={styles.gameGrid}>
              <section className={styles.gameMain}>
                <div className={styles.gameProgress}><div className={styles.progressText}><span>ROUND <b>{room.roundNumber}</b> <i>/</i> {room.totalRounds}</span><span>{room.roundsPerHost} rounds per host <ChevronDown size={13} /></span></div><div className={styles.progressTrack}><div style={{ width: `${Math.min(100, (room.roundNumber / Math.max(1, room.totalRounds)) * 100)}%` }} /></div></div>
                <div className={`${styles.card} ${styles.promptCard}`}>
                  <div className={styles.promptCardTop}><span className={room.viewerIsHost ? styles.hostChip : styles.guesserChip}>{room.viewerIsHost ? <><Crown size={13} /> YOU ARE THE HOST</> : <><AudioLines size={13} /> LISTEN TO THE CLUES</>}</span><span className={`${styles.difficultyPill} ${styles[`difficulty_${room.settings.difficulty || 'medium'}`]}`}>{room.settings.difficulty || 'medium'}</span><div className={`${styles.timerBadge} ${remaining <= 10 ? styles.timerUrgent : ''}`}><Clock3 size={16} /><strong>{formatDuration(remaining)}</strong></div></div>
                  {room.status === 'roundOver' ? <div className={styles.roundReveal}><div className={styles.revealSpark}><Sparkles size={22} /></div><span className={styles.eyebrow}>{room.lastResult?.winnerName ? 'ANSWER LOCKED' : 'ROUND OVER'}</span><h2>{room.revealedAnswer || room.lastResult?.answer}</h2><p>{room.lastResult?.winnerName ? `${room.lastResult.winnerName} guessed correctly first.` : room.lastResult?.reason === 'skipped' ? 'The host skipped this round.' : room.lastResult?.reason === 'host-disconnected' ? 'The host disconnected, so the round was closed and host rotation will continue.' : 'The timer ran out before anyone got it.'}</p>{room.lastResult?.winnerName && <div className={styles.scorePop}>+{room.lastResult.guesserPoints} points for {room.lastResult.winnerName}{room.lastResult.hostPoints ? ` · +${room.lastResult.hostPoints} for ${room.lastResult.hostName}` : ''}</div>}<div className={styles.nextRoundNote}><span className={styles.pulseDot} /> Next round starting shortly…</div></div> : room.viewerIsHost && room.prompt ? (
                    <div className={styles.hostPrompt}><span className={styles.promptEyebrow}>YOUR SECRET {room.prompt.type === 'picture' ? 'PICTURE' : 'WORD'}</span>{room.prompt.type === 'picture' && room.prompt.imageKey ? <img className={styles.mysteryPicture} src={`/pictures/${room.prompt.imageKey}.svg`} alt="Secret picture for the host" /> : <div className={styles.secretWord}>{room.prompt.answer}</div>}<div className={styles.categoryPill}>{room.prompt.category}</div><div className={styles.hostInstruction}><WandSparkles size={16} /><span>Describe it without saying the answer. Once someone guesses correctly, the round locks automatically.</span></div><form className={styles.hintForm} onSubmit={sendHint}><input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Type a clue for everyone…" maxLength={240} /><button type="submit" disabled={!hint.trim()}><Send size={16} /> Send clue</button></form><div className={styles.hostTools}><span>{room.hintsCount} clue{room.hintsCount === 1 ? '' : 's'} sent</span><button onClick={skipRound}>Skip round <ArrowRight size={14} /></button></div></div>
                  ) : (
                    <div className={styles.guessArea}><div className={styles.mysteryIcon}><CircleHelp size={41} /></div><span className={styles.promptEyebrow}>{room.currentPromptType === 'picture' ? 'PICTURE ROUND' : room.currentPromptType === 'word' ? 'WORD ROUND' : 'MYSTERY ROUND'}</span><h2>What could it be?</h2><p>First correct answer wins. You can guess immediately — hints are optional.</p>{recentHints.length > 0 ? <div className={styles.latestClue}><span>LATEST CLUE</span><strong>“{recentHints[recentHints.length - 1].text}”</strong><small>— {recentHints[recentHints.length - 1].username}</small></div> : <div className={styles.waitForClue}><Zap size={17} /> Guess now or wait for a clue — your choice.</div>}<form className={styles.guessForm} onSubmit={(event) => { event.preventDefault(); submitGuess(); }}><input value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="Type your answer and lock it…" disabled={room.status !== 'playing'} maxLength={120} /><button type="submit" disabled={!guess.trim() || room.status !== 'playing'}><LockKeyhole size={15} /> Lock guess</button></form><button className={styles.voiceGuessButton} onClick={speechGuess} disabled={room.status !== 'playing'}><Mic size={15} /> Guess by speaking <span>Locks automatically</span></button>{feedback && <div className={`${styles.guessFeedback} ${feedback.ok ? styles.feedbackOk : ''}`}>{feedback.ok ? <Check size={14} /> : <CircleHelp size={14} />}{feedback.text}</div>}<div className={styles.guessLockNote}><LockKeyhole size={12} /> Each guess is checked securely. First correct answer locks the round.</div></div>
                  )}
                </div>
                <div className={styles.callBar}><div className={styles.callBarText}><div className={styles.callBarGlyph}><Volume2 size={17} /></div><div><strong>Make it a party</strong><span>Turn on your mic or camera to talk while you play.</span></div></div><div className={styles.callActions}>{mediaMode === 'off' ? <><button className={styles.callButton} disabled={mediaBusy} onClick={() => void startMedia('voice')}><Mic size={15} /> {mediaBusy ? 'Starting…' : 'Voice'}</button><button className={styles.callButtonVideo} disabled={mediaBusy} onClick={() => void startMedia('video')}><Video size={15} /> Video</button></> : <><button className={`${styles.callButton} ${micMuted ? styles.callButtonOff : ''}`} onClick={toggleMic}>{micMuted ? <MicOff size={15} /> : <Mic size={15} />}{micMuted ? 'Unmute' : 'Mute'}</button>{mediaMode === 'video' && <button className={`${styles.callButton} ${cameraMuted ? styles.callButtonOff : ''}`} onClick={toggleCamera}>{cameraMuted ? <VideoOff size={15} /> : <Video size={15} />}{cameraMuted ? 'Camera off' : 'Camera'}</button>}<button className={styles.endCallButton} onClick={stopMedia}><X size={15} /> End</button></>}</div></div>
                {Object.entries(remoteMedia).map(([id, media]) => <RemoteAudio key={`audio-${id}`} stream={media.stream} />)}{((mediaMode === 'video' && localStream) || Object.values(remoteMedia).some((media) => media.stream.getVideoTracks().length > 0)) && <div className={styles.videoGrid}>{mediaMode === 'video' && localStream && <VideoTile stream={localStream} name={`${session.user.username} (you)`} muted isLocal />}{Object.entries(remoteMedia).filter(([, media]) => media.stream.getVideoTracks().length > 0).map(([id, media]) => <VideoTile key={id} stream={media.stream} name={media.username} muted />)}</div>}
              </section>
              <aside className={styles.gameSide}>
                <section className={styles.card}><div className={styles.cardTitle}><div><h2>Live scoreboard</h2><p>Points update in real time</p></div><Trophy size={17} className={styles.mutedIcon} /></div><div className={styles.scoreboard}>{room.players.slice().sort((a, b) => b.score - a.score).map((player, index) => <div key={player.id} className={styles.scorePlayer}><span className={styles.scoreRank}>{index === 0 && player.score > 0 ? <Crown size={14} /> : String(index + 1).padStart(2, '0')}</span><div className={`${styles.miniAvatar} ${index % 3 === 1 ? styles.avatarLilac : index % 3 === 2 ? styles.avatarPeach : ''}`}>{player.avatar}</div><div className={styles.scoreName}><strong>{player.username}{player.id === session.user.id ? ' (you)' : ''}</strong><span>{player.id === room.hostId ? <><Crown size={10} /> Host this round</> : player.connected ? 'Playing' : 'Offline'}</span></div><b>{player.score}</b></div>)}</div><div className={styles.scoreLegend}><span>✓ First correct guess</span><b>+{room.settings.correctPoints}</b><span>✦ Host hint bonus</span><b>+{room.settings.hostBonusPoints}</b></div></section>
                <section className={`${styles.card} ${styles.chatCard}`}><div className={styles.cardTitle}><div><h2>Room chat</h2><p>Clues, reactions, and chaos</p></div><span className={styles.chatCount}><MessageCircle size={13} /> {room.messages.length}</span></div><div className={styles.chatMessages}>{roomMessages.slice(-45).map((message) => <div key={message.id} className={`${styles.message} ${message.type === 'system' ? styles.systemMessage : message.type === 'hint' ? styles.hintMessage : ''}`}><div className={styles.messageTop}><strong>{message.type === 'system' ? 'GhostHint' : message.username}</strong><time>{formatTime(message.at)}</time></div><p>{message.type === 'hint' && <WandSparkles size={13} />}{message.text}</p></div>)}<div ref={messageEndRef} /></div><form className={styles.chatForm} onSubmit={sendChat}><input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Send a message…" maxLength={300} /><button type="submit" disabled={!chatText.trim()} aria-label="Send chat"><Send size={16} /></button></form></section>
              </aside>
            </div>
          )}
        </main>
        {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
        {settingsOpen && <SettingsModal preferences={prefs} onChange={setPreferences} onClose={() => setSettingsOpen(false)} onUploadCustomMusic={handleCustomMusicUpload} onClearCustomMusic={clearCustomMusic} customMusicName={customMusicName} />}
      </div>
    );
  }

  return (
    <div className={styles.appShell}>
      <div className={styles.appGlow} />
      <header className={styles.appTopbar}>
        <div className={styles.brandLockup}><div className={styles.brandMark}><WandSparkles size={20} /></div><span>ghost<span className={styles.brandAccent}>hint</span></span></div>
        <div className={styles.topbarTagline}><span className={styles.liveDot} /> THINK FAST. GUESS TOGETHER.</div>
        <div className={styles.topbarUser}><div className={styles.smallAvatar}>{initials(session.user.username)}</div><span>{session.user.username}{session.user.guest ? <small>Guest account</small> : <small>Player profile</small>}</span><button className={styles.iconButton} title="Game settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button><button className={styles.iconButton} title="Log out" onClick={logout}><LogOut size={17} /></button></div>
      </header>
      <main className={styles.dashboard}>
        <section className={styles.welcomeBlock}><div><div className={styles.eyebrow}><Sparkles size={13} /> YOUR GAME LOBBY</div><h1>Ready to make<br /><span>some wild guesses?</span></h1><p>Create a room, invite your crew, and find out who can think on their feet.</p></div><div className={styles.welcomeArtwork}><div className={styles.artHalo} /><div className={styles.artCardBack}><span>?</span><i>✦</i></div><div className={styles.artCardFront}><Sparkles size={25} /><strong>GUESS<br />WHAT?</strong><span>01 / 05</span></div><div className={styles.artBubbleOne}>+10</div><div className={styles.artBubbleTwo}>✧</div></div></section>
        <div className={styles.dashboardGrid}>
          <section className={`${styles.card} ${styles.createCard}`}><div className={styles.cardTitle}><div><div className={styles.sectionKicker}>HOST A GAME</div><h2>Create a room</h2><p>Set your rules and bring everyone together.</p></div><div className={styles.cardTitleIcon}><Plus size={20} /></div></div><form className={styles.createForm} onSubmit={(event) => { event.preventDefault(); createRoom(); }}><label className={styles.field}><span>Room name</span><div className={styles.inputWrap}><Gamepad2 size={16} /><input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Friday Night Room" maxLength={32} required /></div></label><div className={styles.field}><span>Guessing style</span><div className={styles.modeOptions}><button type="button" onClick={() => setCreateMode('word')} className={createMode === 'word' ? styles.modeSelected : ''}><span><MessageCircle size={17} /></span><strong>Words</strong><small>Clue cards</small></button><button type="button" onClick={() => setCreateMode('picture')} className={createMode === 'picture' ? styles.modeSelected : ''}><span><ImageIcon size={17} /></span><strong>Pictures</strong><small>Visual clues</small></button><button type="button" onClick={() => setCreateMode('mixed')} className={createMode === 'mixed' ? styles.modeSelected : ''}><span><Sparkles size={17} /></span><strong>Mixed</strong><small>Surprise me</small></button></div></div><div className={styles.field}><span>Difficulty level</span><div className={styles.difficultyOptions}>{([{ id: 'easy', label: 'Easy', note: 'Quick wins' }, { id: 'medium', label: 'Medium', note: 'Balanced' }, { id: 'hard', label: 'Hard', note: 'Think deeper' }, { id: 'hardest', label: 'Hardest', note: 'Brain burn' }] as const).map((level) => <button type="button" key={level.id} className={createDifficulty === level.id ? styles.difficultySelected : ''} onClick={() => setCreateDifficulty(level.id)}><strong>{level.label}</strong><small>{level.note}</small></button>)}</div></div><div className={styles.field}><div className={styles.settingLabelLine}><span>Time per question</span><strong>{formatDuration(createSeconds)}</strong></div><input className={styles.rangeControl} type="range" min="30" max="600" step="30" value={createSeconds} onChange={(e) => setCreateSeconds(Number(e.target.value))} aria-label="Time per question" /><div className={styles.rangeScale}><span>00:30</span><span>Up to 10 minutes</span></div><div className={styles.timePresets}>{[30,60,120,300,600].map((seconds) => <button type="button" key={seconds} className={createSeconds === seconds ? styles.timePresetSelected : ''} onClick={() => setCreateSeconds(seconds)}>{seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</button>)}</div></div><div className={styles.field}><div className={styles.settingLabelLine}><span>Questions per host</span><strong>{createRoundsPerHost}</strong></div><input className={styles.rangeControl} type="range" min="1" max="10" step="1" value={createRoundsPerHost} onChange={(e) => setCreateRoundsPerHost(Number(e.target.value))} aria-label="Questions per host" /><div className={styles.rangeScale}><span>1 question</span><span>10 questions</span></div></div><div className={styles.fixedRule}><div className={styles.fixedRuleIcon}><Crown size={16} /></div><div><strong>{createRoundsPerHost} questions for each host</strong><span>Every player gets a turn hosting before the final scores.</span></div><LockKeyhole size={15} /></div><button className={styles.primaryButton} type="submit"><Plus size={18} /> Create room <ArrowRight size={17} /></button></form></section>
          <section className={`${styles.card} ${styles.joinCard}`}><div className={styles.cardTitle}><div><div className={styles.sectionKicker}>JOIN YOUR CREW</div><h2>Jump into a room</h2><p>Got a six-character invite code? Enter it here.</p></div><div className={`${styles.cardTitleIcon} ${styles.cardTitleIconLilac}`}><DoorOpen size={20} /></div></div><form className={styles.joinForm} onSubmit={joinRoom}><label className={styles.field}><span>Room invite code</span><input className={styles.codeInput} value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="A B C 1 2 3" maxLength={6} autoCapitalize="characters" required /></label><button className={styles.secondaryPrimaryButton} type="submit" disabled={joinCode.length !== 6}>Join room <ArrowRight size={17} /></button></form><div className={styles.joinDivider}><span /> QUICK RULES <span /></div><div className={styles.quickRules}><div><div className={styles.quickRuleIcon}><Zap size={16} /></div><p><b>Guess first</b><span>Fastest correct answer scores customizable points.</span></p></div><div><div className={styles.quickRuleIcon}><Crown size={16} /></div><p><b>Give good clues</b><span>Hosts can earn 5 bonus points.</span></p></div><div><div className={styles.quickRuleIcon}><Clock3 size={16} /></div><p><b>Beat the timer</b><span>Wrong guesses don't lock your next try.</span></p></div></div></section>
        </div>
        <section className={styles.socialSection}><div className={styles.socialHeading}><div><h2>Your friends</h2><p>Build your crew for your next match.</p></div><span className={styles.countPill}>{friends.length} saved</span></div>
          {session.user.guest ? <div className={styles.guestFriendsNotice}><Users size={19} /><div><strong>Playing as a guest?</strong><span>Create an account next time to keep a saved friends list across sessions.</span></div></div> : <><form className={styles.addFriendForm} onSubmit={addFriend}><div className={styles.inputWrap}><UserPlus size={16} /><input value={friendName} onChange={(e) => setFriendName(e.target.value)} placeholder="Add a friend by exact username" maxLength={18} /></div><button className={styles.secondaryButton} type="submit" disabled={!friendName.trim() || friendsBusy}>{friendsBusy ? 'Adding…' : 'Add friend'} <Plus size={15} /></button></form>{friends.length ? <div className={styles.savedFriends}>{friends.map((friend) => <div key={friend.id} className={styles.savedFriend}><div className={styles.friendAvatar}>{initials(friend.username)}</div><span>{friend.username}</span><span className={styles.savedLabel}>SAVED</span></div>)}</div> : <div className={styles.emptyFriendsDashboard}>No friends saved yet. Ask your friends to register, then add them here by username.</div>}</>}
        </section>
        <footer className={styles.dashboardFooter}><span>GHOSTHINT <i>·</i> PARTY GAME</span><span>Made for memorable game nights</span><button onClick={() => showNotice('Create or join a room. Each player hosts customizable rounds. Guess instantly by text or voice and win points.', 'info')}><CircleHelp size={14} /> How to play</button></footer>
      </main>
      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      {settingsOpen && <SettingsModal preferences={prefs} onChange={setPreferences} onClose={() => setSettingsOpen(false)} onUploadCustomMusic={handleCustomMusicUpload} onClearCustomMusic={clearCustomMusic} customMusicName={customMusicName} />}
    </div>
  );
}

function SettingsModal({ preferences, onChange, onClose, onUploadCustomMusic, onClearCustomMusic, customMusicName }: { preferences: AppPreferences; onChange: (next: AppPreferences) => void; onClose: () => void; onUploadCustomMusic: (file: File) => void; onClearCustomMusic: () => void; customMusicName: string | null }) {
  const update = <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => onChange({ ...preferences, [key]: value });
  return <div className={styles.settingsBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.settingsModal} role="dialog" aria-modal="true" aria-labelledby="settings-title"><header className={styles.settingsHeader}><div className={styles.settingsGlyph}><SlidersHorizontal size={20} /></div><div><span className={styles.sectionKicker}>YOUR EXPERIENCE</span><h2 id="settings-title">Game settings</h2><p>Personalize game rules, colors, motion, and audio.</p></div><button className={styles.iconButton} onClick={onClose} aria-label="Close settings"><X size={18} /></button></header><div className={styles.settingsBody}><section className={styles.settingsSection}><h3><Timer size={16} /> Default match rules</h3><div className={styles.settingLabelLine}><span>Time per question</span><strong>{formatDuration(preferences.defaultRoundSeconds)}</strong></div><input className={styles.rangeControl} type="range" min="30" max="600" step="30" value={preferences.defaultRoundSeconds} onChange={(event) => update('defaultRoundSeconds', Number(event.target.value))} /><div className={styles.rangeScale}><span>30 seconds</span><span>10 minutes</span></div><div className={styles.settingLabelLine}><span>Questions hosted by each player</span><strong>{preferences.defaultRoundsPerHost}</strong></div><input className={styles.rangeControl} type="range" min="1" max="10" step="1" value={preferences.defaultRoundsPerHost} onChange={(event) => update('defaultRoundsPerHost', Number(event.target.value))} /><div className={styles.rangeScale}><span>1 question</span><span>10 questions</span></div><label className={styles.languageSetting}><span><strong>Default difficulty</strong><small>Used for new rooms unless changed on the lobby</small></span><select className={styles.selectControl} value={preferences.defaultDifficulty} onChange={(event) => update('defaultDifficulty', event.target.value as Difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="hardest">Hardest</option></select></label><div className={styles.settingLabelLine}><span>Points for the first correct answer</span><strong>{preferences.correctPoints} pts</strong></div><input className={styles.rangeControl} type="range" min="5" max="50" step="5" value={preferences.correctPoints} onChange={(event) => update('correctPoints', Number(event.target.value))} /><div className={styles.rangeScale}><span>5 points</span><span>50 points</span></div><div className={styles.settingLabelLine}><span>Host bonus after a hint</span><strong>{preferences.hostBonusPoints} pts</strong></div><input className={styles.rangeControl} type="range" min="0" max="25" step="5" value={preferences.hostBonusPoints} onChange={(event) => update('hostBonusPoints', Number(event.target.value))} /><div className={styles.rangeScale}><span>0 points</span><span>25 points</span></div><p className={styles.settingsHint}>These become the defaults for your next room. Set timer, host rounds, and guessing style in the room creation card, too.</p></section><section className={styles.settingsSection}><h3><Palette size={16} /> Game colors</h3><div className={styles.themeChoices}>{([{ id: 'violet', label: 'Arcade Violet', color: '#9b8cff' }, { id: 'neon', label: 'Neon Rush', color: '#39d9f2' }, { id: 'ocean', label: 'Deep Ocean', color: '#579eff' }, { id: 'sunset', label: 'Sunset Pop', color: '#ff7db7' }] as const).map((theme) => <button type="button" key={theme.id} className={`${styles.themeChoice} ${preferences.theme === theme.id ? styles.themeChoiceActive : ''}`} onClick={() => update('theme', theme.id)}><span style={{ background: theme.color }} />{theme.label}{preferences.theme === theme.id && <Check size={14} />}</button>)}</div><label className={styles.toggleSetting}><span><strong>3D motion effects</strong><small>Floating cards, animated glow, and transitions</small></span><input type="checkbox" checked={preferences.motionEffects} onChange={(event) => update('motionEffects', event.target.checked)} /></label></section><section className={styles.settingsSection}><h3><Volume2 size={16} /> Sound and music</h3><label className={styles.toggleSetting}><span><strong>Game sound effects</strong><small>Countdown beeps, round-start, correct-answer and time-up sounds</small></span><input type="checkbox" checked={preferences.soundEffects} onChange={(event) => update('soundEffects', event.target.checked)} /></label><label className={styles.volumeSetting}><span><strong>Effects volume</strong><b>{preferences.sfxVolume}%</b></span><input className={styles.rangeControl} type="range" min="0" max="100" step="5" value={preferences.sfxVolume} onChange={(event) => update('sfxVolume', Number(event.target.value))} /></label><label className={styles.toggleSetting}><span><strong>Background game music</strong><small>Start automatically while a match is active</small></span><input type="checkbox" checked={preferences.backgroundMusic} onChange={(event) => update('backgroundMusic', event.target.checked)} /></label><label className={styles.languageSetting}><span><strong>Music track</strong><small>Choose a built-in loop or your own audio</small></span><select className={styles.selectControl} value={preferences.musicTrack} onChange={(event) => update('musicTrack', event.target.value as MusicTrack)}><option value="arcade">Arcade glow</option><option value="dream">Dreamwave</option><option value="pulse">Pulse bass</option><option value="retro">Retro synth</option><option value="chill">Chillwave</option><option value="boss">Boss battle</option><option value="custom" disabled={!customMusicName}>Custom upload</option></select></label><label className={styles.volumeSetting}><span><strong>Music volume</strong><b>{preferences.musicVolume}%</b></span><input className={styles.rangeControl} type="range" min="0" max="100" step="5" value={preferences.musicVolume} onChange={(event) => update('musicVolume', Number(event.target.value))} /></label><div className={styles.customMusicBox}><div><strong><Music size={15} /> Custom soundtrack</strong><small>{customMusicName ? `Saved on this device: ${customMusicName}` : 'Upload your own MP3, WAV, OGG, or M4A (up to 50 MB).'}</small></div><label className={styles.uploadMusicButton}><Upload size={14} /> Choose music<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onUploadCustomMusic(file); event.currentTarget.value = ''; }} /></label>{customMusicName && <button type="button" className={styles.clearMusicButton} onClick={onClearCustomMusic}>Remove</button>}</div><label className={styles.languageSetting}><span><strong>Voice guess language</strong><small>Select the English recognition accent</small></span><select className={styles.selectControl} value={preferences.speechLanguage} onChange={(event) => update('speechLanguage', event.target.value as AppPreferences['speechLanguage'])}><option value="en-IN">English (India)</option><option value="en-US">English (United States)</option><option value="en-GB">English (United Kingdom)</option></select></label><label className={styles.languageSetting}><span><strong>Camera quality</strong><small>Choose stream size and frame rate</small></span><select className={styles.selectControl} value={preferences.videoQuality} onChange={(event) => update('videoQuality', event.target.value as VideoQuality)}><option value="low">Data saver · 360p</option><option value="balanced">Balanced · 540p</option><option value="high">High · 720p</option></select></label><label className={styles.languageSetting}><span><strong>Camera filter</strong><small>Applied to your outgoing stream and preview</small></span><select className={styles.selectControl} value={preferences.videoEffect} onChange={(event) => update('videoEffect', event.target.value as VideoEffect)}><option value="natural">Natural</option><option value="bright">Bright & clear</option><option value="warm">Warm glow</option><option value="cool">Cool tone</option><option value="mono">Monochrome</option><option value="vivid">Vivid colors</option><option value="soft">Soft focus</option></select></label><p className={styles.settingsHint}>Browsers may require a click before audio can start. Custom music is stored locally in this browser. Camera filters are processed in your browser and sent to peers; quality changes apply the next time you start video, and high quality uses more CPU and bandwidth. Voice input uses browser speech recognition and can vary by device while a call is active.</p></section></div><footer className={styles.settingsFooter}><span><Check size={14} /> Saved automatically on this device</span><button className={styles.primaryButton} onClick={onClose}>Done <ArrowRight size={16} /></button></footer></section></div>;
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => { if (audioRef.current) { audioRef.current.srcObject = stream; void audioRef.current.play().catch(() => undefined); } }, [stream]);
  return <audio ref={audioRef} className={styles.remoteAudio} autoPlay />;
}

function VideoTile({ stream, name, muted = false, isLocal = false }: { stream: MediaStream; name: string; muted?: boolean; isLocal?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => undefined); } }, [stream]);
  return <div className={`${styles.videoTile} ${isLocal ? styles.videoTileLocal : ''}`}><video ref={videoRef} autoPlay playsInline muted={muted} /><span>{name}{isLocal ? ' · SELF VIEW' : ''}</span></div>;
}

function Toast({ notice, onClose }: { notice: { type: 'error' | 'success' | 'info'; text: string }; onClose: () => void }) {
  return <div className={`${styles.toast} ${notice.type === 'error' ? styles.toastError : notice.type === 'success' ? styles.toastSuccess : ''}`} role="status"><span className={styles.toastIcon}>{notice.type === 'success' ? <Check size={16} /> : notice.type === 'error' ? <X size={16} /> : <Sparkles size={16} />}</span><p>{notice.text}</p><button onClick={onClose} aria-label="Dismiss notification"><X size={14} /></button></div>;
}
