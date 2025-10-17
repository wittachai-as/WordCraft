#!/usr/bin/env node

// Seed global recipes to Firestore collection 'global_recipes'
// Usage: node scripts/seed-global-recipes.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

function loadJSON(jsonPath) {
  const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
  const txt = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(txt);
}

async function main() {
  // Load global recipes
  const recipesPath = path.join(process.cwd(), '..', 'wordcraft_game', 'global_recipes.json');
  if (!fs.existsSync(recipesPath)) {
    console.error('global_recipes.json not found at:', recipesPath);
    process.exit(1);
  }
  const recipes = loadJSON(recipesPath);

  // Load firebase config
  const configPath = path.join(process.cwd(), 'firebase.config.json');
  if (!fs.existsSync(configPath)) {
    console.error('firebase.config.json not found at:', configPath);
    process.exit(1);
  }
  const fbConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Init Firebase
  const appModule = require('firebase/app');
  const { initializeApp, getApps } = appModule;
  const app = getApps().length ? appModule.getApp() : initializeApp(fbConfig);

  const { getFirestore, doc, setDoc } = require('firebase/firestore');
  const db = getFirestore(app);
  
  // Create global_recipes collection with a single document
  const ref = doc(db, 'global_recipes', 'all');
  await setDoc(ref, {
    recipes: recipes,
    version: '1.0',
    count: Object.keys(recipes).length,
    updated: new Date().toISOString()
  });
  
  console.log(`Seeded ${Object.keys(recipes).length} global recipes to Firestore`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
