import * as functions from 'firebase-functions';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';
if (getApps().length === 0) {
    initializeApp();
}
const db = getFirestore();
function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
async function computeAndCache(dateISO, a, b) {
    if (!dateISO || !a || !b)
        return null;
    const key = [a, b].map(s => s.toLowerCase()).sort().join('+');
    const globalRecipesRef = db.collection('global_recipes').doc('all');
    const globalSnap = await globalRecipesRef.get();
    if (globalSnap.exists) {
        const globalData = globalSnap.data();
        const recipes = globalData?.recipes || {};
        const hit = recipes[key] || recipes[key.toLowerCase()];
        if (hit) {
            return { id: hit.id || slugify(hit.name), name: hit.name, type: hit.type || 'result' };
        }
    }
    const AI_URL = functions.config().ai?.service_url || 'http://127.0.0.1:8099';
    console.log('Using AI service URL:', AI_URL);
    const resp = await fetch(`${AI_URL}/combine`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a, b })
    });
    if (!resp.ok)
        return null;
    const dataResp = await resp.json();
    const id = dataResp.id || slugify(dataResp.name);
    await globalRecipesRef.set({
        recipes: { [key]: { id, name: dataResp.name, type: dataResp.type || 'result' } },
        updated: new Date().toISOString()
    }, { merge: true });
    return { id, name: dataResp.name, type: dataResp.type || 'result' };
}
export const computeRecipe = functions.region('asia-southeast1').https.onCall(async (data, context) => {
    const { dateISO, a, b } = data;
    if (!dateISO || !a || !b) {
        throw new functions.https.HttpsError('invalid-argument', 'dateISO, a, b are required');
    }
    const res = await computeAndCache(dateISO, a, b);
    return res;
});
export const computeRecipeHttp = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
    // CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { dateISO, a, b } = body || {};
        if (!dateISO || !a || !b) {
            res.status(400).json({ error: 'dateISO, a, b are required' });
            return;
        }
        const out = await computeAndCache(dateISO, a, b);
        if (!out) {
            res.status(404).json({ error: 'no-combination' });
            return;
        }
        res.status(200).json(out);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'internal', message: String(e?.message || e) });
    }
});
