#!/usr/bin/env node

// Clear all documents in Firestore collection `puzzles`
// Usage: node scripts/clear-puzzles.mjs

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

async function main() {
  const configPath = findFirebaseConfig();
  const fbConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Init Firebase
  const appModule = require('firebase/app');
  const { initializeApp, getApps } = appModule;
  const app = getApps().length ? appModule.getApp() : initializeApp(fbConfig);

  const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');
  const db = getFirestore(app);

  const colRef = collection(db, 'puzzles');
  const snap = await getDocs(colRef);
  let count = 0;
  for (const d of snap.docs) {
    await deleteDoc(doc(db, 'puzzles', d.id));
    count++;
  }
  console.log(`Deleted ${count} documents from puzzles`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


