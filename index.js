/**
 * WhatsApp Voice Bot  --  Gemini TTS, sirf apni "You" (Message yourself) chat se control.
 *  - Login: pairing code (QR nahi)
 *  - Sirf '$' se shuru hone wale messages (aapki apni chat me) pe kaam hota hai, baaki sab ignore
 *  - Session + settings: MongoDB (free) ya file/disk
 * Node 20+ chahiye.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import pino from 'pino';
import ffmpegPath from 'ffmpeg-static';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidDecode,
  jidNormalizedUser,
  initAuthCreds,
  BufferJSON,
  proto,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';

/* ===================== VOICES & COMMAND PARSER ===================== */
// Gemini TTS ki 30 prebuilt voices: [naam, andaaz]
const VOICES = [
  ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'],
  ['Fenrir', 'Excitable'], ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Aoede', 'Breezy'],
  ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'],
  ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'],
  ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'],
  ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'],
  ['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'],
  ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm'],
];

const DEFAULT_VOICE = 'Kore';

// Sab commands (aliases alag se)
const COMMANDS = [
  'say', 'to', 'voice', 'sample', 'speed', 'style', 'mode', 'model',
  'reset', 'on', 'off', 'status', 'history', 'ping', 'restart', 'command',
];
const ALIASES = {
  speak: 'say', tts: 'say', send: 'to',
  voices: 'voice', v: 'voice',
  commands: 'command', help: 'command', menu: 'command', cmd: 'command',
};

/** Voice naam ya number (1-30) se voice naam nikalo. Na mile to null. */
function findVoice(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= VOICES.length ? VOICES[n - 1][0] : null;
  }
  const exact = VOICES.find(([n]) => n.toLowerCase() === s);
  if (exact) return exact[0];
  const starts = VOICES.filter(([n]) => n.toLowerCase().startsWith(s));
  return s.length >= 3 && starts.length === 1 ? starts[0][0] : null;
}

/**
 * Message '$' se shuru ho tabhi command maana jaata hai.
 *  - "$ namaste"      -> { cmd: 'say', args: 'namaste' }
 *  - "$voice 5"       -> { cmd: 'voice', args: '5' }
 *  - "$100 diye"      -> null (paison ka note, ignore)
 *  - "$hello"         -> { cmd: 'unknown', args: 'hello' }
 */
function parseCommand(text) {
  const t = String(text || '').trimStart();
  if (t[0] !== '$') return null;
  const rest = t.slice(1);
  if (rest === '' || /^\s/.test(rest)) return { cmd: 'say', args: rest.trim() };
  const m = rest.match(/^([A-Za-z]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  let cmd = m[1].toLowerCase();
  cmd = ALIASES[cmd] || cmd;
  if (!COMMANDS.includes(cmd)) return { cmd: 'unknown', args: m[1] };
  return { cmd, args: (m[2] || '').trim() };
}

/** "puck: namaste" ya "5: namaste" -> { voice: 'Puck', text: 'namaste' }. Prefix na ho to voice null. */
function splitVoicePrefix(args) {
  const m = String(args || '').match(/^([A-Za-z]+|\d{1,2})\s*:\s*([\s\S]*)$/);
  if (m) {
    const v = findVoice(m[1]);
    if (v) return { voice: v, text: m[2].trim() };
  }
  return { voice: null, text: String(args || '').trim() };
}

/** Lamba text sentence ke hisaab se chhote tukdon me todo */
function splitText(text, max = 1200) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const parts = clean.split(/(?<=[.!?।\n])\s+/);
  const out = [];
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (let p of parts) {
    while (p.length > max) {
      push();
      out.push(p.slice(0, max));
      p = p.slice(max);
    }
    if ((cur + ' ' + p).trim().length > max) push();
    cur = (cur + ' ' + p).trim();
  }
  push();
  return out;
}

/* ===================== CONFIG ===================== */
const env = process.env;
const digits = (s) => String(s || '').replace(/\D/g, '');
const PAIR_NUMBER = digits(env.PAIRING_NUMBER);
const KEYS = (env.GEMINI_API_KEY || '').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(env.PORT || 3000);
const DATA_DIR = env.DATA_DIR || './data';
const ADMIN_KEY = env.ADMIN_KEY || '';
const TZ = env.TZ_NAME || 'Asia/Kolkata';
const MAX_CHARS = Number(env.MAX_CHARS || 4000);
const MAX_AGE_SEC = Number(env.MAX_AGE_SEC || 180);
const DEFAULT_MODEL = env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const FALLBACK_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];

const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  warn: (...a) => console.warn(new Date().toISOString(), 'WARN', ...a),
  error: (...a) => console.error(new Date().toISOString(), 'ERROR', ...a),
};
const baileysLogger = pino({ level: env.BAILEYS_LOG || 'silent' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===================== STATE ===================== */
const rt = {
  connected: false,
  code: null,
  codeAt: 0,
  pairing: false,
  pairedNow: false,
  sock: null,
  error: '',
  startedAt: Date.now(),
  keyIdx: 0,
  badModels: new Set(),
  storage: 'files',
};

const defaults = () => ({
  voice: DEFAULT_VOICE,
  speed: 1,
  style: '',
  model: DEFAULT_MODEL,
  mode: 'ptt', // ptt = voice note, file = audio file
  enabled: true,
  history: [],
  stats: { day: '', count: 0 },
});
let S = defaults();

/* ===================== STORAGE (MongoDB ya files) ===================== */
let mongo = null;
let kv = null;
let authColl = null;
const settingsFile = () => path.join(DATA_DIR, 'settings.json');
const authDir = () => path.join(DATA_DIR, 'auth');

async function initStorage() {
  if (env.MONGODB_URI) {
    const { MongoClient } = await import('mongodb');
    mongo = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
    await mongo.connect();
    const db = mongo.db(env.MONGODB_DB || 'wa_voice_bot');
    kv = db.collection('kv');
    authColl = db.collection('auth');
    rt.storage = 'MongoDB';
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    rt.storage = `files (${DATA_DIR})`;
  }
  log.info(`Storage: ${rt.storage}`);
}

async function loadSettings() {
  let saved = {};
  try {
    if (kv) saved = (await kv.findOne({ _id: 'settings' }))?.v || {};
    else saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch { /* pehli baar */ }
  S = { ...defaults(), ...saved };
  if (!findVoice(S.voice)) S.voice = DEFAULT_VOICE;
}

async function saveSettings() {
  try {
    if (kv) await kv.replaceOne({ _id: 'settings' }, { _id: 'settings', v: S }, { upsert: true });
    else fs.writeFileSync(settingsFile(), JSON.stringify(S, null, 2));
  } catch (e) { log.error('settings save fail:', e.message); }
}

async function mongoAuthState() {
  const write = (data, id) => authColl.replaceOne({ _id: id }, { _id: id, v: JSON.stringify(data, BufferJSON.replacer) }, { upsert: true });
  const read = async (id) => {
    const d = await authColl.findOne({ _id: id });
    return d ? JSON.parse(d.v, BufferJSON.reviver) : null;
  };
  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          await Promise.all(ids.map(async (id) => {
            let v = await read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }));
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const cat of Object.keys(data)) {
            for (const id of Object.keys(data[cat])) {
              const v = data[cat][id];
              const key = `${cat}-${id}`;
              tasks.push(v ? write(v, key) : authColl.deleteOne({ _id: key }));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write(creds, 'creds'),
  };
}

const getAuth = () => (authColl ? mongoAuthState() : useMultiFileAuthState(authDir()));
async function clearAuth() {
  try {
    if (authColl) await authColl.deleteMany({});
    else fs.rmSync(authDir(), { recursive: true, force: true });
  } catch (e) { log.error('auth clear fail:', e.message); }
}

/* ===================== GEMINI TTS ===================== */
async function synthChunk(prompt, voice) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const models = [...new Set([S.model, ...FALLBACK_MODELS])];
  let lastErr = null;
  for (const model of models) {
    if (rt.badModels.has(model)) continue;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[(rt.keyIdx + i) % KEYS.length];
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body,
          signal: AbortSignal.timeout(90000),
        });
      } catch (e) { lastErr = new Error(`Network/timeout: ${e.message}`); continue; }

      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        const inline = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
        if (inline) {
          rt.keyIdx = (rt.keyIdx + i) % KEYS.length;
          const rate = Number(/rate=(\d+)/.exec(inline.mimeType || '')?.[1]) || 24000;
          return { pcm: Buffer.from(inline.data, 'base64'), rate };
        }
        lastErr = new Error('Gemini ne audio nahi diya, dobara try karo');
        break;
      }
      const t = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status === 429) { lastErr = new Error('Gemini free limit/rate limit (429). Thodi der baad try karo'); continue; }
      if (res.status === 401 || res.status === 403) { lastErr = new Error(`Gemini API key galat ya blocked hai (${res.status})`); continue; }
      if (res.status === 404 || (res.status === 400 && /model|not found|not supported/i.test(t))) {
        rt.badModels.add(model);
        lastErr = new Error(`Model "${model}" nahi chal raha: ${t.slice(0, 120)}`);
        break;
      }
      if (res.status === 400) { lastErr = new Error(`Gemini ne request reject ki: ${t.slice(0, 160)}`); break; }
      lastErr = new Error(`Gemini error ${res.status}: ${t.slice(0, 160)}`);
    }
  }
  throw lastErr || new Error('TTS fail');
}

async function synthesize(text, voice) {
  const chunks = splitText(text, 1200);
  const bufs = [];
  let rate = 24000;
  for (const c of chunks) {
    const prompt = S.style ? `${S.style}: ${c}` : c;
    let r;
    try { r = await synthChunk(prompt, voice); }
    catch (e) {
      if (!/audio nahi diya/.test(e.message)) throw e;
      r = await synthChunk(prompt, voice); // ek baar aur
    }
    bufs.push(r.pcm);
    rate = r.rate;
  }
  return { pcm: Buffer.concat(bufs), rate };
}

function toOpus(pcm, rate, speed) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0'];
    if (speed && Math.abs(speed - 1) > 0.01) args.push('-filter:a', `atempo=${speed}`);
    args.push('-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', 'pipe:1');
    const ff = spawn(ffmpegPath || 'ffmpeg', args);
    const out = [];
    let err = '';
    ff.stdout.on('data', (d) => out.push(d));
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('error', (e) => reject(new Error(`ffmpeg nahi chala: ${e.message}`)));
    ff.on('close', (code) => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg fail: ${err.slice(0, 150)}`))));
    ff.stdin.on('error', () => {});
    ff.stdin.end(pcm);
  });
}

/* ===================== WHATSAPP HELPERS ===================== */
const dayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const fmtTime = (t) => new Date(t).toLocaleString('en-IN', { timeZone: TZ, hour12: true, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
function fmtUptime(ms) {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return `${d ? d + 'd ' : ''}${h ? h + 'h ' : ''}${mm}m`;
}

function ownUsers(sock) {
  const s = new Set();
  for (const j of [sock.user?.id, sock.user?.lid]) {
    const u = j && jidDecode(j)?.user;
    if (u) s.add(u);
  }
  return s;
}
function isSelfChat(sock, msg) {
  const own = ownUsers(sock);
  return [msg.key.remoteJid, msg.key.remoteJidAlt].some((j) => {
    const d = j && jidDecode(j);
    return d && own.has(d.user);
  });
}
function getText(msg) {
  const m = normalizeMessageContent(msg.message);
  return m?.conversation || m?.extendedTextMessage?.text || '';
}
function getQuotedText(msg) {
  const m = normalizeMessageContent(msg.message);
  const q = m?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return '';
  const qm = normalizeMessageContent(q);
  return qm?.conversation || qm?.extendedTextMessage?.text || qm?.imageMessage?.caption || qm?.videoMessage?.caption || qm?.documentMessage?.caption || '';
}
const tsOf = (msg) => {
  const t = msg.messageTimestamp;
  return typeof t === 'object' && t ? (t.toNumber?.() ?? Number(t)) : Number(t || 0);
};

// Bot ke apne text reply KABHI '$' se shuru nahi hone chahiye (warna khud command ban jayenge)
const say = (sock, jid, text) => sock.sendMessage(jid, { text });
const react = (sock, msg, emoji) => sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});

async function speak(sock, jid, text, voice, { sample = false } = {}) {
  let t = String(text || '').trim();
  let cut = false;
  if (t.length > MAX_CHARS) { t = t.slice(0, MAX_CHARS); cut = true; }
  await sock.sendPresenceUpdate('recording', jid).catch(() => {});
  try {
    const { pcm, rate } = await synthesize(t, voice);
    const ogg = await toOpus(pcm, rate, S.speed);
    const seconds = Math.max(1, Math.round(pcm.length / (rate * 2) / (S.speed || 1)));
    await sock.sendMessage(jid, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: S.mode === 'ptt', seconds });
  } finally {
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  }
  if (!sample) {
    S.history.unshift({ t: Date.now(), voice, text: t.slice(0, 80) });
    S.history = S.history.slice(0, 10);
  }
  const d = dayKey();
  if (S.stats.day !== d) S.stats = { day: d, count: 0 };
  S.stats.count += 1;
  await saveSettings();
  return cut;
}

/* ===================== COMMANDS ===================== */
function helpText() {
  return [
    `📋 *${COMMANDS.length} commands* (sirf apni "You" chat me, shuruaat $ se)`,
    '',
    '🎙️ *Awaaz banana*',
    '$ <text> → text ko voice note me badlo (default voice)',
    '$ puck: <text> → sirf is baar Puck ki awaaz (naam ya number 1-30)',
    'Kisi message ko reply karke sirf $ bhejo → wo message bol dega',
    '$say <text> → upar wala hi',
    '$to <number> <text> → kisi aur ko voice note (country code ke saath)',
    '',
    '🗣️ *Voice*',
    '$voice → 30 voices ki list',
    '$voice <naam/number> → default voice badlo',
    '$sample [naam/number] → voice ka demo',
    '',
    '⚙️ *Settings*',
    '$speed <0.5-2> → bolne ki speed',
    '$style <instruction> | $style off → andaaz (jaise: Say warmly and slowly)',
    '$mode ptt | file → voice note ya audio file',
    '$model [naam] → TTS model dekho/badlo',
    '$reset → saari settings default',
    '',
    '🔧 *Bot*',
    '$on | $off → bot chalu/band',
    '$status → haal-chaal',
    '$history → last 10 conversions',
    '$ping → bot zinda hai?',
    '$restart → bot restart',
    '$command → ye list (aliases: $help, $menu)',
  ].join('\n');
}

function voiceListText() {
  const lines = VOICES.map(([n, style], i) => `${i + 1}. ${n} — ${style}${n === S.voice ? ' ✅' : ''}`);
  return `🎙️ *30 Voices* (abhi: *${S.voice}*)\n\n${lines.join('\n')}\n\nBadalne ke liye: $voice 5  ya  $voice puck\nEk baar ke liye: $ puck: namaste`;
}

function statusText(sock) {
  const me = sock.user?.id ? jidDecode(sock.user.id)?.user : '-';
  const today = S.stats.day === dayKey() ? S.stats.count : 0;
  return [
    '📊 *Status*',
    `Bot: ${S.enabled ? 'ON ✅' : 'OFF ⛔'}`,
    `Number: ${me}`,
    `Voice: ${S.voice} (${VOICES.find(([n]) => n === S.voice)?.[1] || '-'})`,
    `Speed: ${S.speed}x`,
    `Style: ${S.style || 'koi nahi'}`,
    `Mode: ${S.mode === 'ptt' ? 'voice note' : 'audio file'}`,
    `Model: ${S.model}`,
    `Aaj ke conversions: ${today}`,
    `Gemini keys: ${KEYS.length}`,
    `Storage: ${rt.storage}`,
    `Uptime: ${fmtUptime(Date.now() - rt.startedAt)}`,
  ].join('\n');
}

async function runCommand(sock, msg, { cmd, args }) {
  const jid = msg.key.remoteJid;
  const R = (t) => say(sock, jid, t);

  if (!S.enabled && !['on', 'status', 'command', 'ping'].includes(cmd)) {
    return R('⛔ Bot abhi OFF hai. Chalu karne ke liye $on likho.');
  }

  switch (cmd) {
    case 'say': {
      const { voice, text } = splitVoicePrefix(args);
      const finalText = text || getQuotedText(msg);
      if (!finalText) return R('Text likho, jaise:\n$ namaste dost\nya kisi message ko reply karke sirf $ bhejo.');
      await react(sock, msg, '⏳');
      const cut = await speak(sock, jid, finalText, voice || S.voice);
      await react(sock, msg, '✅');
      if (cut) await R(`ℹ️ Text bahut lamba tha, sirf pehle ${MAX_CHARS} characters bole gaye.`);
      return;
    }
    case 'to': {
      const m = args.match(/^\+?(\d[\d\s-]{6,17}\d)\s+([\s\S]+)$/);
      if (!m) return R('Aise likho:\n$to 919876543210 namaste\n(country code ke saath, + ke bina)\nVoice ke saath: $to 919876543210 puck: namaste');
      const num = digits(m[1]);
      const found = await sock.onWhatsApp(num).catch(() => null);
      if (!found?.[0]?.exists) return R(`❌ ${num} WhatsApp pe nahi mila.`);
      const { voice, text } = splitVoicePrefix(m[2]);
      if (!text) return R('Bolne ke liye text bhi likho.');
      await react(sock, msg, '⏳');
      await speak(sock, found[0].jid, text, voice || S.voice);
      await react(sock, msg, '✅');
      return R(`✅ ${num} ko voice note bhej diya.`);
    }
    case 'voice': {
      if (!args) return R(voiceListText());
      const v = findVoice(args);
      if (!v) return R(`❌ "${args}" naam ya number nahi mila. $voice se list dekho (1-30).`);
      S.voice = v;
      await saveSettings();
      return R(`✅ Default voice ab *${v}* (${VOICES.find(([n]) => n === v)[1]}). Demo ke liye: $sample`);
    }
    case 'sample': {
      const v = args ? findVoice(args) : S.voice;
      if (!v) return R(`❌ "${args}" voice nahi mila. $voice se list dekho.`);
      await react(sock, msg, '⏳');
      await speak(sock, jid, `Hello! Namaste, main ${v} hoon. Ye meri awaaz ka demo hai.`, v, { sample: true });
      await react(sock, msg, '✅');
      return;
    }
    case 'speed': {
      if (!args) return R(`Abhi speed: ${S.speed}x\nBadalne ke liye: $speed 1.2  (0.5 se 2 tak)`);
      const n = Number(args.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0.5 || n > 2) return R('❌ Speed 0.5 se 2 ke beech likho, jaise: $speed 1.2');
      S.speed = Math.round(n * 100) / 100;
      await saveSettings();
      return R(`✅ Speed ab ${S.speed}x`);
    }
    case 'style': {
      if (!args) return R(`Abhi style: ${S.style || 'koi nahi'}\nExample: $style Say warmly and slowly\nHatane ke liye: $style off`);
      if (/^(off|none|reset|clear)$/i.test(args)) { S.style = ''; await saveSettings(); return R('✅ Style hata diya.'); }
      S.style = args.slice(0, 200);
      await saveSettings();
      return R(`✅ Style set: ${S.style}`);
    }
    case 'mode': {
      const a = args.toLowerCase();
      if (a !== 'ptt' && a !== 'file') return R(`Abhi mode: ${S.mode}\n$mode ptt → voice note\n$mode file → audio file`);
      S.mode = a;
      await saveSettings();
      return R(`✅ Mode ab ${a === 'ptt' ? 'voice note' : 'audio file'}`);
    }
    case 'model': {
      if (!args) return R(`Abhi model: ${S.model}\nBackup models: ${FALLBACK_MODELS.join(', ')}\nBadalne ke liye: $model <naam>`);
      if (!/^[A-Za-z0-9._-]{3,80}$/.test(args)) return R('❌ Model ka naam galat lag raha hai.');
      S.model = args;
      rt.badModels.clear();
      await saveSettings();
      return R(`✅ Model ab ${args}`);
    }
    case 'reset': {
      const keep = { history: S.history, stats: S.stats };
      S = { ...defaults(), ...keep };
      rt.badModels.clear();
      await saveSettings();
      return R(`✅ Settings default ho gayi (voice ${DEFAULT_VOICE}, speed 1x).`);
    }
    case 'on': { S.enabled = true; await saveSettings(); return R('✅ Bot ON.'); }
    case 'off': { S.enabled = false; await saveSettings(); return R('⛔ Bot OFF. Wapas chalu: $on'); }
    case 'status': return R(statusText(sock));
    case 'history': {
      if (!S.history.length) return R('Abhi koi history nahi.');
      return R('🕘 *Last conversions*\n\n' + S.history.map((h, i) => `${i + 1}. [${h.voice}] ${h.text}${h.text.length >= 80 ? '…' : ''}\n   ${fmtTime(h.t)}`).join('\n'));
    }
    case 'ping': {
      const lag = Math.max(0, Math.round(Date.now() - tsOf(msg) * 1000));
      return R(`pong 🏓 (delay ~${Math.round(lag / 1000)}s, uptime ${fmtUptime(Date.now() - rt.startedAt)})`);
    }
    case 'restart': {
      await R('🔄 Restart ho raha hai, 30-60 sec me wapas aa jayega.');
      setTimeout(() => process.exit(0), 1000);
      return;
    }
    case 'command': return R(helpText());
    case 'unknown':
    default:
      return R(`❓ "$${args}" naam ka command nahi hai. Poori list ke liye $command likho.`);
  }
}

/* ===================== MESSAGE HANDLING ===================== */
const seen = new Set();
let chain = Promise.resolve();
const enqueue = (fn) => { chain = chain.then(fn).catch((e) => log.error('queue:', e)); };

async function handleMessage(sock, msg) {
  if (!msg.message || !msg.key?.fromMe) return;
  if (!isSelfChat(sock, msg)) return;
  const text = getText(msg);
  if (!text || text.trimStart()[0] !== '$') return;
  const id = msg.key.id;
  if (seen.has(id)) return;
  const ts = tsOf(msg);
  if (ts && Date.now() / 1000 - ts > MAX_AGE_SEC) return; // purane (offline ke) messages chhodo
  const parsed = parseCommand(text);
  if (!parsed) return;
  seen.add(id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  try {
    await runCommand(sock, msg, parsed);
  } catch (e) {
    log.error(`cmd ${parsed.cmd}:`, e.message);
    await react(sock, msg, '❌');
    await say(sock, msg.key.remoteJid, `❌ Error: ${String(e.message).slice(0, 300)}`).catch(() => {});
  }
}

/* ===================== WHATSAPP CONNECTION ===================== */
let restartTimer = null;
let codeTimer = null;
let retry = 0;
let starting = false;

function cleanupSocket() {
  clearInterval(codeTimer);
  const s = rt.sock;
  rt.sock = null;
  if (!s) return;
  try { s.ev.removeAllListeners(); } catch { /* ignore */ }
  try { s.end(undefined); } catch { /* ignore */ }
}

function scheduleRestart(ms) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => startSocket(), ms);
}

async function requestCode(sock) {
  try {
    const raw = await sock.requestPairingCode(PAIR_NUMBER);
    rt.code = String(raw).match(/.{1,4}/g).join('-');
    rt.codeAt = Date.now();
    rt.pairedNow = true;
    log.info('==================================================');
    log.info(`PAIRING CODE: ${rt.code}`);
    log.info('WhatsApp > Linked devices > Link a device > "Link with phone number instead" me ye code daalo');
    log.info('==================================================');
  } catch (e) {
    log.error('pairing code nahi mila:', e.message);
  }
}

async function onConnection(sock, u) {
  const { connection, lastDisconnect, qr } = u;

  if (qr && !sock.authState.creds.registered && !rt.pairing) {
    rt.pairing = true;
    await requestCode(sock);
    clearInterval(codeTimer);
    codeTimer = setInterval(() => {
      if (!rt.connected && !sock.authState.creds.registered) requestCode(sock);
    }, 55000);
  }

  if (connection === 'open') {
    clearInterval(codeTimer);
    rt.connected = true;
    rt.code = null;
    rt.pairing = false;
    retry = 0;
    log.info('WhatsApp connected ✅');
    if (rt.pairedNow) {
      rt.pairedNow = false;
      await say(sock, jidNormalizedUser(sock.user.id), '✅ Voice bot connected! Apni is "You" chat me $command likho aur saari commands dekho. Default voice: Kore.').catch(() => {});
    }
  }

  if (connection === 'close') {
    clearInterval(codeTimer);
    rt.connected = false;
    rt.pairing = false;
    const status = lastDisconnect?.error?.output?.statusCode;
    log.warn(`WhatsApp closed (code ${status ?? '?'})`);
    if (status === DisconnectReason.loggedOut) {
      log.warn('Logged out: session saaf karke naya pairing code banega');
      rt.code = null;
      await clearAuth();
      scheduleRestart(2000);
    } else if (status === DisconnectReason.connectionReplaced) {
      log.warn('Connection replaced (doosri jagah wahi session chal raha hai). 30s baad retry.');
      scheduleRestart(30000);
    } else {
      retry += 1;
      scheduleRestart(Math.min(3000 * retry, 30000));
    }
  }
}

async function startSocket() {
  if (starting) return;
  starting = true;
  try {
    cleanupSocket();
    const { state, saveCreds } = await getAuth();
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { /* default version */ }
    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });
    rt.sock = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => { onConnection(sock, u).catch((e) => log.error('conn:', e)); });
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages) enqueue(() => handleMessage(sock, m));
    });
  } catch (e) {
    log.error('startSocket:', e);
    scheduleRestart(8000);
  } finally {
    starting = false;
  }
}

/* ===================== WEB (health + pairing page) ===================== */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page(allowed) {
  let body;
  if (rt.error) {
    body = `<h2>⚠️ Setup adhura hai</h2><p>${esc(rt.error)}</p>`;
  } else if (rt.connected) {
    body = '<h2>✅ WhatsApp connected</h2><p>Apni "You" chat me <b>$command</b> likho.</p>';
  } else if (rt.code && allowed) {
    const left = Math.max(0, 55 - Math.round((Date.now() - rt.codeAt) / 1000));
    body = `<h2>🔑 Pairing code</h2><div class="code">${rt.code}</div>
<ol><li>WhatsApp kholo → Settings → <b>Linked devices</b></li>
<li><b>Link a device</b> → neeche <b>Link with phone number instead</b></li>
<li>Upar wala code daalo</li></ol>
<p class="m">Ye code ~${left}s me khud badal jayega, page auto-refresh hota hai.</p>`;
  } else if (rt.code) {
    body = '<h2>🔑 Pairing code ready</h2><p>URL ke end me <b>?key=ADMIN_KEY</b> lagao (jo Render me set kiya).</p>';
  } else {
    body = '<h2>⏳ Connecting…</h2><p>Kuch second me page khud refresh hoga.</p>';
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><meta name="robots" content="noindex"><title>WhatsApp Voice Bot</title>
<style>body{font:16px system-ui,sans-serif;max-width:480px;margin:0 auto;padding:20px;line-height:1.5}.code{font:700 34px ui-monospace,monospace;letter-spacing:3px;text-align:center;padding:18px;border-radius:12px;background:#8882;margin:14px 0}.m{opacity:.7;font-size:14px}</style></head><body>${body}</body></html>`;
}

function startServer() {
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    const allowed = !ADMIN_KEY || u.searchParams.get('key') === ADMIN_KEY;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page(allowed));
  }).listen(PORT, '0.0.0.0', () => log.info(`web server :${PORT}`));
}

/* ===================== START ===================== */
process.on('unhandledRejection', (e) => log.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => log.error('uncaughtException:', e));
process.on('SIGTERM', () => { cleanupSocket(); setTimeout(() => process.exit(0), 500); });

async function main() {
  startServer();
  const missing = [];
  if (PAIR_NUMBER.length < 8 || PAIR_NUMBER.length > 15) missing.push('PAIRING_NUMBER (country code ke saath, jaise 919876543210)');
  if (!KEYS.length) missing.push('GEMINI_API_KEY');
  if (missing.length) {
    rt.error = `Ye environment variables set karo: ${missing.join(', ')}`;
    log.error(rt.error);
    return;
  }
  try {
    await initStorage();
    await loadSettings();
  } catch (e) {
    rt.error = `Storage start nahi hua: ${e.message}. MONGODB_URI aur Atlas ka Network Access (0.0.0.0/0) check karo.`;
    log.error(rt.error);
    return;
  }
  await startSocket();

  // Render free plan ko jagaye rakhne ke liye (UptimeRobot bhi lagao, zyada pakka hai)
  if (env.RENDER_EXTERNAL_URL && env.SELF_PING !== 'false') {
    setInterval(() => { fetch(`${env.RENDER_EXTERNAL_URL}/health`).catch(() => {}); }, 10 * 60 * 1000);
  }
}
main();
