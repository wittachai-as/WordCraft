/**
 * Simple test script to verify Firebase sync is working
 * 
 * Usage:
 * 1. Import this in App.tsx temporarily
 * 2. Call testSync() after guest user is initialized
 * 3. Check logs and Firebase Console
 */

import { syncHistory } from './syncHistory';
import { appendHistory } from './history';

export async function testSync(guestUserId: string): Promise<void> {
  console.log('🧪 [TEST] Starting sync test...');
  console.log('🧪 [TEST] Guest User ID:', guestUserId);
  
  try {
    // Create a test play
    const testPlay = {
      a: 'test',
      b: 'sync',
      resultId: 'testsync',
      resultName: 'TestSync',
      ts: Date.now(),
      puzzleId: '2025-10-19',
      synced: false,
    };
    
    console.log('🧪 [TEST] Creating test play:', testPlay);
    await appendHistory(testPlay.puzzleId, testPlay);
    
    // Try to sync
    console.log('🧪 [TEST] Attempting to sync to Firebase...');
    await syncHistory(testPlay.puzzleId, guestUserId);
    
    console.log('✅ [TEST] Sync test completed! Check Firebase Console.');
    console.log('📍 [TEST] Look for: users/' + guestUserId + '/plays/');
  } catch (error) {
    console.error('❌ [TEST] Sync test failed:', error);
    console.error('❌ [TEST] Error details:', JSON.stringify(error, null, 2));
  }
}

