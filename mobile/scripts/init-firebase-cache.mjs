#!/usr/bin/env node

// Initialize Firebase global_recipes with empty cache
// Usage: node scripts/init-firebase-cache.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

async function main() {
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

  const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore');
  const db = getFirestore(app);
  
  // Check if global_recipes already exists
  const ref = doc(db, 'global_recipes', 'all');
  const snapshot = await getDoc(ref);
  
  if (snapshot.exists()) {
    const data = snapshot.data();
    const count = Object.keys(data.recipes || {}).length;
    console.log(`✓ Firebase cache already exists with ${count} recipes`);
    console.log('  Use clear-global-recipes.mjs to reset if needed');
    return;
  }
  
  // Create global_recipes collection with empty cache
  await setDoc(ref, {
    recipes: {},
    version: '1.0',
    count: 0,
    updated: new Date().toISOString(),
    note: 'AI will populate this cache automatically'
  });
  
  console.log('✓ Initialized empty Firebase cache');
  console.log('  AI Service will populate recipes automatically when users play');
}

main().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});

