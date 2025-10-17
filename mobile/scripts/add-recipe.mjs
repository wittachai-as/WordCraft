#!/usr/bin/env node

// Add or update a single recipe key under global_recipes/all.recipes
// Usage:
//   node scripts/add-recipe.mjs steam+steam Boiler

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

function findFirebaseConfig() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.join(process.cwd(), 'firebase.config.json'),
    path.join(process.cwd(), 'mobile', 'firebase.config.json'),
    path.join(scriptDir, '..', 'firebase.config.json')
  ];
  const foundPath = candidatePaths.find(p => fs.existsSync(p));
  if (!foundPath) {
    console.error('firebase.config.json not found. Tried:\n' + candidatePaths.join('\n'));
    process.exit(1);
  }
  return foundPath;
}

function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function main() {
  const key = (process.argv[2] || '').toLowerCase();
  const name = process.argv[3] || '';
  if (!key || !name || !/^[a-z0-9+]+$/.test(key) || !/^[A-Za-z][A-Za-z0-9\s-]*$/.test(name)) {
    console.error('Usage: node scripts/add-recipe.mjs <a+b> <Name>');
    console.error('Example: node scripts/add-recipe.mjs steam+steam Boiler');
    process.exit(1);
  }

  const configPath = findFirebaseConfig();
  const fbConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const appModule = require('firebase/app');
  const { initializeApp, getApps } = appModule;
  const app = getApps().length ? appModule.getApp() : initializeApp(fbConfig);

  const { getFirestore, doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
  const db = getFirestore(app);

  const ref = doc(db, 'global_recipes', 'all');
  const snap = await getDoc(ref);
  let count = 0;
  let existed = false;
  if (snap.exists()) {
    const data = snap.data();
    const recipes = data?.recipes || {};
    count = Number(data?.count || Object.keys(recipes).length || 0);
    existed = !!recipes[key];
  }

  const recipeDoc = { id: slugify(name), name, type: 'result' };
  // Merge recipes map atomically
  await setDoc(ref, {
    recipes: { [key]: recipeDoc },
    updated: new Date().toISOString(),
    count: existed ? count : count + 1,
    version: '1.0'
  }, { merge: true });

  console.log(`${existed ? 'Updated' : 'Added'} recipe ${key} -> ${name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


