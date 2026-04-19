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
    
    await appendHistory(testPlay.puzzleId, testPlay);
    await syncHistory(testPlay.puzzleId, guestUserId);
  } catch (error) {
    // Silent fail for test sync
  }
}

