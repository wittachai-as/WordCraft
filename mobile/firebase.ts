// Lightweight Firebase bootstrap. This module isolates Firebase imports to avoid
// impacting app startup if config is missing. It exports helpers that return
// null when Firebase isn't configured, allowing the app to fallback gracefully.

import type { FirebaseApp } from 'firebase/app';

let firebaseApp: FirebaseApp | null = null;

export type FirestoreDoc = {
  goalWord?: string;
  startWords?: string[];
  recipes?: Record<string, { id: string; name: string; type?: 'start' | 'goal' | 'result' }>;
};

type FirebaseInitParams = {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  appId?: string;
};

export function ensureFirebaseApp(config?: FirebaseInitParams): FirebaseApp | null {
  if (firebaseApp) return firebaseApp;
  if (!config || !config.apiKey || !config.projectId) return null;
  try {
    // Dynamic import so the bundle doesn't break if packages aren't installed yet
    // and to keep web/native parity flexible.
    const appModule = require('firebase/app');
    const { initializeApp, getApps } = appModule;
    if (getApps().length === 0) {
      firebaseApp = initializeApp({
        apiKey: config.apiKey,
        projectId: config.projectId,
        authDomain: config.authDomain,
        appId: config.appId,
      });
    } else {
      firebaseApp = appModule.getApp();
    }
    return firebaseApp;
  } catch (e) {
    // Packages may be missing in dev environment
    return null;
  }
}

export async function fetchPuzzleForDate(dateISO: string, config?: FirebaseInitParams): Promise<FirestoreDoc | null> {
  const app = ensureFirebaseApp(config);
  if (!app) return null;
  try {
    const { getFirestore, doc, getDoc } = require('firebase/firestore');
    const db = getFirestore(app);
    const ref = doc(db, 'puzzles', dateISO);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as FirestoreDoc;
  } catch (e) {
    return null;
  }
}

export async function fetchGlobalRecipes(config?: FirebaseInitParams): Promise<Record<string, any> | null> {
  const app = ensureFirebaseApp(config);
  if (!app) return null;
  try {
    const { getFirestore, doc, getDoc } = require('firebase/firestore');
    const db = getFirestore(app);
    const ref = doc(db, 'global_recipes', 'all');
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as any;
    return data.recipes || {};
  } catch (e) {
    return null;
  }
}

export async function requestAIRecipe(dateISO: string, aId: string, bId: string, config?: FirebaseInitParams) {
  const app = ensureFirebaseApp(config);
  if (!app) return null;
  try {
    const { getFunctions, httpsCallable } = require('firebase/functions');
    const fnApp = getFunctions(app, 'asia-southeast1'); // ระบุ region
    const callable = httpsCallable(fnApp, 'computeRecipe');
    const res = await callable({ dateISO, a: aId, b: bId });
    return res?.data as any;
  } catch (e) {
    return null;
  }
}


