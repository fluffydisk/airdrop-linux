require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:example@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('ERROR: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables are required.');
  console.error('Define them in the .env file (see .env.example).');
  console.error('Generate a new key pair with: npx web-push generate-vapid-keys');
  process.exit(1);
}

webpush.setVapidDetails(
  VAPID_CONTACT_EMAIL,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const WATCH_DIR = process.env.WATCH_DIR || path.join(process.env.HOME, 'AirdropShare');
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
const SEEN_FILE = path.join(__dirname, 'seen-files.json');
const PORT = process.env.PORT || 6001;

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let subscriptions = loadJSON(SUBS_FILE, []);
let seenFiles = loadJSON(SEEN_FILE, []);

const app = express();
app.use(express.json());

// CORS for requests coming from the dufs-served page
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/vapid-public-key', (req, res) => {
  res.send(VAPID_PUBLIC_KEY);
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
  if (!exists) {
    subscriptions.push(sub);
    saveJSON(SUBS_FILE, subscriptions);
    console.log('New subscription registered. Total:', subscriptions.length);
  }
  res.status(201).json({ ok: true });
});

async function notifyAll(payload) {
  const data = JSON.stringify(payload);
  const stillValid = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, data);
      stillValid.push(sub);
    } catch (err) {
      console.log('Subscription is invalid and will be removed:', err.statusCode);
      // drop invalid/expired subscriptions (410 Gone, 404, etc.)
    }
  }
  subscriptions = stillValid;
  saveJSON(SUBS_FILE, subscriptions);
}

function scanForNewFiles() {
  if (!fs.existsSync(WATCH_DIR)) return;
  const entries = fs.readdirSync(WATCH_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue; // skip .clipboard.txt etc
    if (entry.name === 'ui') continue;
    if (!seenFiles.includes(entry.name)) {
      seenFiles.push(entry.name);
      const stat = fs.statSync(path.join(WATCH_DIR, entry.name));
      console.log('New file detected:', entry.name);
      notifyAll({
        title: 'New file received',
        body: entry.name,
        fileName: entry.name,
        size: stat.size
      });
    }
  }
  saveJSON(SEEN_FILE, seenFiles);
}

// Watch the folder for changes (debounced)
let debounceTimer = null;
if (fs.existsSync(WATCH_DIR)) {
  fs.watch(WATCH_DIR, { persistent: true }, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanForNewFiles, 800);
  });
}

// Initial scan on startup marks existing files as already seen (no notification spam on restart)
if (seenFiles.length === 0 && fs.existsSync(WATCH_DIR)) {
  const entries = fs.readdirSync(WATCH_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && !entry.name.startsWith('.')) {
      seenFiles.push(entry.name);
    }
  }
  saveJSON(SEEN_FILE, seenFiles);
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Push server is running on port ${PORT}; watching: ${WATCH_DIR}`);
});
