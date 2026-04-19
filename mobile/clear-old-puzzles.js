// Script to clear old puzzle cache from Firebase
const admin = require('firebase-admin');

// Initialize Firebase Admin
try {
  const serviceAccount = require('./firebase-adminsdk.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (e) {
  console.log('No service account, using default credentials');
  admin.initializeApp();
}

const db = admin.firestore();

async function clearOldPuzzles() {
  console.log('🗑️  Clearing old puzzle cache from Firebase...');
  
  try {
    // Get all puzzles
    const puzzlesRef = db.collection('puzzles');
    const snapshot = await puzzlesRef.get();
    
    console.log(`Found ${snapshot.size} puzzles to delete`);
    
    // Delete in batches
    const batchSize = 500;
    let batch = db.batch();
    let count = 0;
    
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
      count++;
      
      if (count % batchSize === 0) {
        await batch.commit();
        console.log(`Deleted ${count} puzzles...`);
        batch = db.batch();
      }
    }
    
    // Commit remaining
    if (count % batchSize !== 0) {
      await batch.commit();
    }
    
    console.log(`✅ Deleted ${count} old puzzles`);
    console.log('New puzzles will be generated with validation when requested');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

clearOldPuzzles();
