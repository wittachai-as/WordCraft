import AsyncStorage from '@react-native-async-storage/async-storage';

export type PlayItem = {
  a: string;
  b: string;
  resultId?: string;
  resultName?: string;
  ts: number;         // epoch ms
  puzzleId: string;
  synced: boolean;
};

const HISTORY_KEY = (puzzleId: string) => `wc_history_${puzzleId}`;
const USED_KEY = (puzzleId: string) => `wc_used_${puzzleId}`;
const DISC_KEY = (puzzleId: string) => `wc_disc_${puzzleId}`; // discovered words [{id,name}]

export async function getHistory(puzzleId: string): Promise<PlayItem[]> {
  const key = HISTORY_KEY(puzzleId);
  console.log('getHistory key:', key);
  const raw = await AsyncStorage.getItem(key);
  console.log('getHistory raw:', raw);
  const result = raw ? JSON.parse(raw) : [];
  console.log('getHistory result:', result);
  return result;
}

export async function appendHistory(puzzleId: string, item: PlayItem): Promise<void> {
  const key = HISTORY_KEY(puzzleId);
  console.log('appendHistory key:', key);
  console.log('appendHistory item:', item);
  const cur = await getHistory(puzzleId);
  cur.unshift(item);
  // limit to last 500 for storage safety
  const toSave = cur.slice(0, 500);
  console.log('appendHistory saving:', toSave);
  await AsyncStorage.setItem(key, JSON.stringify(toSave));
}

export function comboKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}|${y}`;
}

export async function getUsedCombos(puzzleId: string): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(USED_KEY(puzzleId));
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

export async function addUsedCombo(puzzleId: string, a: string, b: string): Promise<void> {
  const used = await getUsedCombos(puzzleId);
  used.add(comboKey(a, b));
  await AsyncStorage.setItem(USED_KEY(puzzleId), JSON.stringify(Array.from(used)));
}

export async function listPending(puzzleId: string): Promise<PlayItem[]> {
  return (await getHistory(puzzleId)).filter(x => !x.synced);
}

export async function markSynced(puzzleId: string, tsList: number[]): Promise<void> {
  const cur = await getHistory(puzzleId);
  const mark = new Set(tsList);
  const next = cur.map(x => (mark.has(x.ts) ? { ...x, synced: true } : x));
  await AsyncStorage.setItem(HISTORY_KEY(puzzleId), JSON.stringify(next));
}

export async function clearUsedCombos(puzzleId: string): Promise<void> {
  await AsyncStorage.removeItem(USED_KEY(puzzleId));
}

export async function clearHistory(puzzleId: string): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY(puzzleId));
}

export async function clearAllForPuzzle(puzzleId: string): Promise<void> {
  await Promise.all([
    clearUsedCombos(puzzleId),
    clearHistory(puzzleId),
    AsyncStorage.removeItem(DISC_KEY(puzzleId))
  ]);
}

export type DiscoveredWord = { id: string; name: string };

export async function getDiscoveredWords(puzzleId: string): Promise<DiscoveredWord[]> {
  const raw = await AsyncStorage.getItem(DISC_KEY(puzzleId));
  if (!raw) return [];
  const data = JSON.parse(raw);
  // backward compatibility: array of strings -> map to {id,name}
  if (Array.isArray(data) && typeof data[0] === 'string') {
    return (data as string[]).map(id => ({ id: id.toLowerCase(), name: id.charAt(0).toUpperCase() + id.slice(1) }));
  }
  return data as DiscoveredWord[];
}

export async function setDiscoveredWords(puzzleId: string, words: DiscoveredWord[]): Promise<void> {
  // keep unique by id and limit size
  const map = new Map<string, DiscoveredWord>();
  for (const w of words) {
    const id = w.id.toLowerCase();
    if (!map.has(id)) map.set(id, { id, name: w.name });
  }
  await AsyncStorage.setItem(DISC_KEY(puzzleId), JSON.stringify(Array.from(map.values()).slice(0, 2000)));
}


