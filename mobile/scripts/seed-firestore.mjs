#!/usr/bin/env node

// Seed Firestore collection `puzzles/{YYYY-MM-DD}` using config in mobile/firebase.config.json
// Usage examples:
//   node scripts/seed-firestore.mjs --date=2025-10-15 --goal=Electricity --starts=Water,Earth
//   node scripts/seed-firestore.mjs --date=2025-10-15 --file=./seed.json

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

function loadJSON(jsonPath) {
  const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
  const txt = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(txt);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (const a of args) {
    const [k, v] = a.startsWith('--') ? a.slice(2).split('=') : [a, 'true'];
    out[k] = v ?? 'true';
  }
  return out;
}

function toISODate(input) {
  if (!input) return new Date().toISOString().slice(0, 10);
  return input;
}

// Deterministic PRNG (Mulberry32)
function mulberry32(seed) {
  return function() {
    let t = (seed += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromDateStr(dateStr) {
  let seed = 0 >>> 0;
  for (let i = 0; i < dateStr.length; i++) {
    seed = Math.imul(seed, 31) + dateStr.charCodeAt(i);
    seed >>>= 0;
  }
  return seed >>> 0;
}

function deterministicDailyPayload(dateISO) {
  const START_WORDS = [
    'Water','Fire','Earth','Air','Light','Dark','Heat','Cold',
    'Stone','Wood','Metal','Sand','Ice','Steam','Smoke','Dust'
  ];
  const GOAL_WORDS = [
    'Electricity','Life','Time','Space','Energy','Matter','Light',
    'Sound','Color','Music','Art','Love','Hope','Dream','Magic',
    'Power','Wisdom','Peace','Freedom','Justice','Beauty','Truth'
  ];

  const rng = mulberry32(seedFromDateStr(dateISO));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const goal = pick(GOAL_WORDS);
  const k = rng() < 0.5 ? 2 : 3;
  const pool = [...START_WORDS];
  const starts = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(rng() * pool.length);
    starts.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return { goalWord: goal, startWords: starts };
}

function ensureRecipeIds(recipes) {
  const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const out = {};
  for (const k of Object.keys(recipes || {})) {
    const r = recipes[k];
    out[k.toLowerCase()] = {
      id: r.id || slugify(r.name),
      name: r.name,
      type: r.type || 'result',
    };
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const dateISO = toISODate(args.date);

  // Load firebase config
  // Resolve firebase.config.json from multiple possible locations
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.join(process.cwd(), 'firebase.config.json'),
    path.join(process.cwd(), 'mobile', 'firebase.config.json'),
    path.join(scriptDir, '..', 'firebase.config.json')
  ];
  const foundPath = candidatePaths.find(p => fs.existsSync(p));
  if (!foundPath) {
    console.error('Config not found. Tried:\n' + candidatePaths.join('\n'));
    process.exit(1);
  }
  const fbConfig = JSON.parse(fs.readFileSync(foundPath, 'utf-8'));

  // Prepare payload (deterministic by default unless a file is provided)
  let payload;
  if (args.file) {
    payload = loadJSON(args.file);
  } else {
    payload = deterministicDailyPayload(dateISO);
  }

  // Init Firebase (dynamic import via require for Node env)
  const appModule = require('firebase/app');
  const { initializeApp, getApps } = appModule;
  const app = getApps().length ? appModule.getApp() : initializeApp(fbConfig);

  const { getFirestore, doc, setDoc } = require('firebase/firestore');
  const db = getFirestore(app);
  const ref = doc(db, 'puzzles', dateISO);
  await setDoc(ref, payload, { merge: true });
  console.log(`Seeded puzzles/${dateISO}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


