import { getFirestore, collection, writeBatch, doc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { getApp } from 'firebase/app';
// import { getAuth } from 'firebase/auth'; // Temporarily disabled due to API key issues
import { listPending, markSynced, PlayItem } from './history';

/**
 * Sync play history to Firebase
 * 
 * New structure (v2): users/{uid}/plays/{playId}
 * - Each user has their own subcollection of plays
 * - Better for querying and security rules
 * - No need to filter by uid in queries
 */
export async function syncHistory(puzzleId: string, guestUserId?: string): Promise<void> {
  try {
    console.log(`[SYNC] Starting sync for puzzle ${puzzleId}, user: ${guestUserId || 'anonymous'}`);
    const app = getApp();
    const db = getFirestore(app);
    // const auth = getAuth(app); // Temporarily disabled
    const uid = guestUserId ?? 'anonymous'; // Use guest user ID directly

    const pending = await listPending(puzzleId);
    console.log(`[SYNC] Found ${pending.length} pending plays to sync`);
    if (pending.length === 0) {
      console.log('[SYNC] No pending plays, skipping sync');
      return;
    }

    // Reference to user's plays subcollection
    const userPlaysRef = collection(db, 'users', uid, 'plays');

    // Check for existing plays to prevent duplicates
    const existingQuery = query(
      userPlaysRef,
      where('puzzleId', '==', puzzleId)
    );
    const existingDocs = await getDocs(existingQuery);
    const existingPlays = new Set(
      existingDocs.docs.map(doc => {
        const data = doc.data();
        return `${data.a}|${data.b}|${data.resultId || 'null'}`;
      })
    );

    const batch = writeBatch(db);
    const tsSynced: number[] = [];

    for (const p of pending) {
      // Check if this exact play already exists
      const playKey = `${p.a}|${p.b}|${p.resultId || 'null'}`;
      if (existingPlays.has(playKey)) {
        console.log('Skipping duplicate play:', playKey);
        tsSynced.push(p.ts); // Mark as synced even though we skipped
        continue;
      }

      // Use unique ID: {puzzleId}_{timestamp}_{random}
      const playId = `${puzzleId}_${p.ts}_${Math.random().toString(36).substr(2, 9)}`;
      const playDocRef = doc(userPlaysRef, playId);
      
      batch.set(playDocRef, {
        puzzleId,
        a: p.a,
        b: p.b,
        resultId: p.resultId ?? null,
        resultName: p.resultName ?? null,
        playedAt: new Date(p.ts),
        syncedAt: serverTimestamp(),
      }, { merge: true });
      tsSynced.push(p.ts);
    }

    if (tsSynced.length > 0) {
      console.log(`[SYNC] Committing batch with ${tsSynced.length} plays...`);
      await batch.commit();
      await markSynced(puzzleId, tsSynced);
      console.log(`✅ [SYNC] Successfully synced ${tsSynced.length} plays for user ${uid}, puzzle ${puzzleId}`);
      console.log(`📍 [SYNC] Plays saved to: users/${uid}/plays/`);
    } else {
      console.log('[SYNC] All plays were duplicates, nothing to sync');
    }
  } catch (error) {
    console.error('❌ [SYNC] Error syncing history:', error);
    // Silently fail - don't break the app if sync fails
    throw error; // Re-throw to be caught by caller's catch block
  }
}


