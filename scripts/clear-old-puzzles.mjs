#!/usr/bin/env node
// Script to clear old puzzles (v1.0, v1.5) from Firestore
// This forces regeneration of puzzles with validation (v2.0)

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Initialize Firebase Admin
try {
  const serviceAccount = JSON.parse(readFileSync('./firebase-adminsdk.json', 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Initialized with service account');
} catch (e) {
  console.log('⚠️  No service account, using default credentials');
  admin.initializeApp();
}

const db = admin.firestore();

async function clearOldPuzzles() {
  console.log('🗑️  Clearing old puzzles (v1.0, v1.5) from Firestore...\n');
  
  try {
    const puzzlesRef = db.collection('puzzles');
    const snapshot = await puzzlesRef.get();
    
    console.log(`Found ${snapshot.size} total puzzles`);
    
    let oldCount = 0;
    let newCount = 0;
    const batch = db.batch();
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const version = data.version || '1.0';
      
      if (parseFloat(version) < 2.0) {
        batch.delete(doc.ref);
        oldCount++;
        console.log(`  ❌ ${doc.id}: v${version} (deleting)`);
      } else {
        newCount++;
        console.log(`  ✅ ${doc.id}: v${version} (keeping)`);
      }
    }
    
    if (oldCount > 0) {
      await batch.commit();
      console.log(`\n✅ Deleted ${oldCount} old puzzles`);
    } else {
      console.log('\n✅ No old puzzles to delete');
    }
    
    console.log(`📊 Kept ${newCount} v2.0 puzzles`);
    console.log('\n💡 New v2.0 puzzles will be generated when players request them');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

clearOldPuzzles();

