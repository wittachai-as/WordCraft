import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, PanResponder, LayoutRectangle, Animated, Platform, useWindowDimensions, ScrollView, TextInput, useColorScheme } from 'react-native';
// import { AdMobBanner } from 'expo-ads-admob'; // Disabled for web compatibility
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { fetchPuzzleForDate, fetchGlobalRecipes, requestAIRecipe } from './firebase';
import { getUsedCombos, addUsedCombo, comboKey, appendHistory, clearAllForPuzzle, getDiscoveredWords, setDiscoveredWords, DiscoveredWord, getHistory, PlayItem } from './storage/history';
import { syncHistory } from './storage/syncHistory';
import { testSync } from './storage/test-sync';
import AsyncStorage from '@react-native-async-storage/async-storage';

type WordItem = { id: string; name: string; type?: 'start' | 'goal' | 'result' };

// Guest user management
const GUEST_USER_KEY = 'guest_user_id';
const generateGuestId = () => `guest_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

async function getOrCreateGuestUser(): Promise<string> {
  try {
    let guestId = await AsyncStorage.getItem(GUEST_USER_KEY);
    if (!guestId) {
      guestId = generateGuestId();
      await AsyncStorage.setItem(GUEST_USER_KEY, guestId);
      console.log('👤 [AUTH] Created new guest user:', guestId);
    } else {
      console.log('👤 [AUTH] Loaded existing guest user:', guestId);
    }
    return guestId;
  } catch (error) {
    console.error('❌ [AUTH] Error managing guest user:', error);
    const fallbackId = generateGuestId();
    console.log('👤 [AUTH] Using fallback guest ID:', fallbackId);
    return fallbackId;
  }
}

function getTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // Local date (device time)
}

function getEpochISO(): string {
  // Fixed global epoch: start from 2025-01-01 so that #1 = 2025-01-01
  return '2025-01-01';
}

function getDailyNumber(): number {
  // Count calendar days between epoch and today using UTC to avoid DST skew
  const epochISO = getEpochISO();
  const [ey, em, ed] = epochISO.split('-').map(n => parseInt(n, 10));
  const epochUTC = Date.UTC(ey, em - 1, ed, 0, 0, 0, 0);
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const diffDays = Math.floor((todayUTC - epochUTC) / 86400000);
  return diffDays + 1;
}

// Use mulberry32 to match server-side scripts
function mulberry32(seed: number) {
  return function() {
    let t = (seed = (seed + 0x6D2B79F5) >>> 0) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromDateStr(dateStr: string) {
  let seed = 0 >>> 0;
  for (let i = 0; i < dateStr.length; i++) {
    seed = Math.imul(seed, 31) + dateStr.charCodeAt(i);
    seed >>>= 0;
  }
  return seed >>> 0;
}

// Deterministic daily pools (no Firebase puzzles)
const START_WORD_NAMES = [
  'Water','Fire','Earth','Air','Light','Dark','Heat','Cold',
  'Stone','Wood','Metal','Sand','Ice','Steam','Smoke','Dust'
];
const GOAL_WORD_NAMES = [
  'Electricity','Life','Time','Space','Energy','Matter','Light',
  'Sound','Color','Music','Art','Love','Hope','Dream','Magic',
  'Power','Wisdom','Peace','Freedom','Justice','Beauty','Truth'
];

// Local RECIPES removed - now using global recipes from Firestore

function stableKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}+${y}`;
}

function slugify(text: string | null | undefined): string {
  if (!text) return '';
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function toItem(name: string, type: WordItem['type']): WordItem {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { id, name, type };
}

function pickDaily(dateISO: string) {
  const rnd = mulberry32(seedFromDateStr(dateISO));
  const pickName = (arr: string[]) => arr[Math.floor(rnd() * arr.length)];
  const goalName = pickName(GOAL_WORD_NAMES);
  const k = rnd() < 0.5 ? 2 : 3;
  const pool = [...START_WORD_NAMES];
  const starts: string[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(rnd() * pool.length);
    starts.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return { goal: toItem(goalName, 'goal'), startWords: starts.map(n => toItem(n, 'start')) };
}

type Placed = { uid: number; id: string; name: string; type?: WordItem['type']; x: number; y: number; z: number };

export default function App() {
  const [screen, setScreen] = useState<'home' | 'game' | 'history' | 'howto' | 'settings' | 'victory'>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const scheme = useColorScheme();
  const [colorMode, setColorMode] = useState<'system' | 'light' | 'dark'>('system');
  const effectiveScheme = colorMode === 'system' ? scheme : colorMode;
  const isDark = effectiveScheme !== 'light';
  const [hasWon, setHasWon] = useState(false);
  const [shakeAnimation] = useState(new Animated.Value(0));

  const [dateISO, setDateISO] = useState(getTodayISO());
  const [dailyOverride, setDailyOverride] = useState<{ goal: WordItem; startWords: WordItem[] } | null>(null);
  const [recipesOverride, setRecipesOverride] = useState<Record<string, WordItem> | null>(null);
  const [forceReload, setForceReload] = useState(0); // Force reload counter
  const [isLoading, setIsLoading] = useState(true); // Loading state
  const [isCombining, setIsCombining] = useState(false); // Combining state
  const [guestUserId, setGuestUserId] = useState<string | null>(null); // Guest user ID
  // Always use seed-based generation from AI Service (no fallback to prevent flickering)
  const daily = useMemo(() => {
    // Use dailyOverride from AI Service, fallback to pickDaily only as last resort
    return dailyOverride ?? pickDaily(dateISO);
  }, [dailyOverride, dateISO]);
  const [discovered, setDiscovered] = useState<WordItem[]>([]);
  const [placed, setPlaced] = useState<Placed[]>([]);
  // Selection-based mixing (A/B)
  const [currentA, setCurrentA] = useState<string | null>(null);
  const [currentB, setCurrentB] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [usedCombos, setUsedCombos] = useState<Set<string>>(new Set());
  const [historyItems, setHistoryItems] = useState<PlayItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date()); // For calendar navigation
  // Calendar played/won dates tracking (for history screen)
  const [playedDates, setPlayedDates] = useState<Set<string>>(new Set());
  const [wonDates, setWonDates] = useState<Set<string>>(new Set());
  const usedWords = useMemo(() => {
    const out = new Set<string>();
    usedCombos.forEach(k => {
      const parts = k.split('|');
      if (parts[0]) out.add(parts[0]);
      if (parts[1]) out.add(parts[1]);
    });
    return out;
  }, [usedCombos]);
  const nextUidRef = useRef(1);
  const [zCounter, setZCounter] = useState(1);
  const canvasRef = useRef<View>(null);
  const canvasRect = useRef<LayoutRectangle | null>(null);

  // Update discovered when daily changes
  // Initialize guest user
  useEffect(() => {
    (async () => {
      console.log('🚀 [AUTH] Initializing guest user...');
      const guestId = await getOrCreateGuestUser();
      setGuestUserId(guestId);
      console.log('✅ [AUTH] Guest user initialized in state:', guestId);
    })();
  }, []);

  // 🧪 Test Firebase sync (TEMPORARY - for debugging)
  useEffect(() => {
    if (guestUserId) {
      console.log('🧪 [TEST] Guest user ready, running sync test...');
      testSync(guestUserId).catch(err => {
        console.error('🧪 [TEST] Test sync failed:', err);
      });
    }
  }, [guestUserId]);

  // Load history when screen changes to history or victory
  useEffect(() => {
    if (screen === 'history' || screen === 'victory') {
      (async () => {
        try {
          setIsLoadingHistory(true);
          console.log('Loading history for dateISO:', dateISO);
          const history = await getHistory(dateISO);
          console.log('History loaded:', history);
          setHistoryItems(history);
        } catch (error) {
          console.error('Error loading history:', error);
          setHistoryItems([]);
        } finally {
          setIsLoadingHistory(false);
        }
      })();
    }
  }, [screen, dateISO]);

  useEffect(() => {
    (async () => {
      // base discovered = daily starts
      const uniqueWords = daily.startWords.filter((word, index, self) => index === self.findIndex(w => w.id === word.id));
      // merge with persisted discovered list for today
      let persisted: DiscoveredWord[] = [];
      try { persisted = await getDiscoveredWords(dateISO); } catch {}
      const persistedItems = persisted.map(w => ({ id: w.id.toLowerCase(), name: w.name, type: 'result' as const }));
      const merged = [...uniqueWords];
      for (const p of persistedItems) {
        if (!merged.find(u => u.id === p.id)) merged.push(p);
      }
      setDiscovered(merged);
      setPlaced([]);
      setCurrentA(null);
      setCurrentB(null);
      try {
        const used = await getUsedCombos(dateISO);
        setUsedCombos(used);
      } catch {}
    })();
  }, [daily]);

  // Load played and won dates for calendar (only when on history screen)
  useEffect(() => {
    if (screen !== 'history') return;
    
    (async () => {
      const played = new Set<string>();
      const won = new Set<string>();
      const keys = await AsyncStorage.getAllKeys();
      const historyKeys = keys.filter(k => k.startsWith('wc_history_'));
      
      for (const key of historyKeys) {
        const dateISO = key.replace('wc_history_', '');
        const history = await getHistory(dateISO);
        if (history && history.length > 0) {
          played.add(dateISO);
          
          // Check if player won (discovered the goal word)
          const discovered = await getDiscoveredWords(dateISO);
          // Load the goal for that date to check if it's in discovered
          try {
            const AI_SERVICE_URL = process.env.EXPO_PUBLIC_AI_SERVICE_URL || 'http://localhost:8099';
            const response = await fetch(`${AI_SERVICE_URL}/daily_puzzle`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date_iso: dateISO }),
            });
            
            if (response.ok) {
              const data = await response.json();
              const goalId = data.goal.toLowerCase();
              const hasGoal = discovered.some(d => d.id.toLowerCase() === goalId);
              if (hasGoal) {
                won.add(dateISO);
              }
            }
          } catch (error) {
            // If can't load puzzle, skip won check
            console.warn('Could not check won status for', dateISO);
          }
        }
      }
      
      setPlayedDates(played);
      setWonDates(won);
    })();
  }, [screen]); // Reload when screen changes

  // drag ghost state
  const dragItemRef = useRef<WordItem | null>(null);
  const dragPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [dragging, setDragging] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragActiveRef = useRef(false);
  const { width, height } = useWindowDimensions();
  const isStacked = Platform.OS !== 'web' || width < 800; // มือถือ/จอแคบ: ใช้เลย์เอาต์บน-ล่าง
  
  // Responsive inventory height based on screen size
  // คำนวณจากความสูงหน้าจอ ลบด้วย header, mixing section, banner และ spacing
  const HEADER_HEIGHT = 64;
  const MIXING_SECTION_HEIGHT = 200; // ~Box A+B, =, Result, Mix button (reduced)
  const BANNER_HEIGHT = 40;
  
  // Dynamic RESERVED_SPACE based on screen height for better responsiveness
  // iPhone SE (568-667px) needs less reserved space
  const RESERVED_SPACE = height < 700 ? 480 : 620;

  // anchor สำหรับลากจาก Inventory (ยังใช้ใน makeInventoryDrag)
  const invAnchor = useRef({ x: 50, y: 22 });

  // กรอง Inventory โดยตัวอักษรขึ้นต้น
  const [invFilter, setInvFilter] = useState<string | null>(null); // null = All
  const filteredDiscovered = useMemo(() => {
    if (!invFilter) return discovered;
    return discovered.filter(d => (d.name || d.id).toLowerCase().startsWith(invFilter.toLowerCase()));
  }, [discovered, invFilter]);
  const letterKeys = useMemo(() => {
    const set = new Set<string>();
    for (const d of discovered) {
      const ch = (d.name || d.id).charAt(0).toUpperCase();
      if (ch) set.add(ch);
    }
    return Array.from(set).sort();
  }, [discovered]);

  // Bottom Sheet state (mobile)
  const [sheetOpen, setSheetOpen] = useState(true);
  const SHEET_HEIGHT = 480;
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const openSheet = () => {
    setSheetOpen(true);
    Animated.timing(sheetTranslateY, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  };
  const closeSheet = () => {
    Animated.timing(sheetTranslateY, { toValue: SHEET_HEIGHT, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setSheetOpen(false);
    });
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const filteredAll = useMemo(() => {
    const byLetter = invFilter ? discovered.filter(d => (d.name || d.id).toLowerCase().startsWith(invFilter.toLowerCase())) : discovered;
    const bySearch = searchQuery.trim().toLowerCase();
    let result = byLetter;
    if (bySearch) {
      result = byLetter.filter(d => (d.name || d.id).toLowerCase().includes(bySearch));
    }
    
    // Remove duplicates by id
    const unique = result.filter((item, index, self) => 
      index === self.findIndex(i => i.id === item.id)
    );
    
    // Separate start words from other words
    const startWords = unique.filter(item => item.type === 'start');
    const otherWords = unique.filter(item => item.type !== 'start');
    
    // Sort other words by name A-Z, keep start words at the beginning
    const sortedOtherWords = otherWords.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    
    return [...startWords, ...sortedOtherWords];
  }, [discovered, invFilter, searchQuery]);
  const favoriteItems = useMemo(() => filteredAll.filter(d => favorites.includes(d.id)), [filteredAll, favorites]);
  const nonFavoriteItems = useMemo(() => filteredAll.filter(d => !favorites.includes(d.id)), [filteredAll, favorites]);
  const toggleFavorite = (id: string) => setFavorites(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // Recent
  const [recent, setRecent] = useState<string[]>([]);
  const pushRecent = (id: string) => setRecent(prev => [id, ...prev.filter(x => x !== id)].slice(0, 15));

  // Tabs in sheet
  type TabKey = 'all' | 'recent';
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const tabItems = useMemo(() => {
    let items: WordItem[] = [];
    
    if (activeTab === 'recent') {
      items = filteredAll.filter(d => recent.includes(d.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    } else {
      // When letter filter or search is active, show only filteredAll
      const hasLetterFilter = !!invFilter;
      const hasSearch = !!searchQuery.trim();
      if (hasLetterFilter || hasSearch) {
        items = filteredAll;
      } else {
        // No filters: show filtered items first (which equals discovered) then the rest (none)
        const filteredIds = new Set(filteredAll.map(x => x.id));
        const rest = discovered.filter(d => !filteredIds.has(d.id));
        items = [...filteredAll, ...rest];
      }
    }
    
    // Remove duplicates by id
    const uniqueItems = items.filter((item, index, self) => 
      index === self.findIndex(i => i.id === item.id)
    );
    
    return uniqueItems;
  }, [activeTab, filteredAll, discovered, recent, invFilter, searchQuery]);

  const spawnAtCanvasCenter = (item: WordItem) => {
    const rect: any = canvasRect.current;
    if (!rect) { spawnOnCanvas(item); return; }
    const cx = Math.max(0, rect.width / 2 - 50);
    const cy = Math.max(0, rect.height / 2 - 22);
    spawnOnCanvas(item, cx, cy);
    ensureInDiscovered(item);
    pushRecent(item.id);
  };

  // Pan for sheet drag down to close
  const sheetDrag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        if (!sheetOpen) return;
        const ty = Math.min(SHEET_HEIGHT, Math.max(0, g.dy));
        sheetTranslateY.setValue(ty);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.6) {
          closeSheet();
        } else {
          Animated.timing(sheetTranslateY, { toValue: 0, duration: 120, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  // Pan for peek to open
  const peekDrag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, g) => {
        if (g.dy < -20 || g.vy < -0.2) openSheet();
      }
    })
  ).current;

  // overlay pan ถูกนำออก เพื่อย้อนกลับกลไกเดิม

  useEffect(() => {
    setDiscovered(daily.startWords);
    setPlaced([]);
  }, [daily]);

  // โหลดโจทย์จาก AI Service (Word2Vec vocab) และ global recipes
  useEffect(() => {
    let cancelled = false;
    async function loadRemote() {
      try {
        // Show loading screen
        setIsLoading(true);
        
        // Load puzzle from AI Service (Word2Vec vocabulary)
        console.log('🎲 Loading puzzle from AI Service for date:', dateISO);
        const AI_SERVICE_URL = process.env.EXPO_PUBLIC_AI_SERVICE_URL || 'http://127.0.0.1:8099';
        
        try {
          const puzzleResponse = await fetch(`${AI_SERVICE_URL}/daily_puzzle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dateISO })
          });
          
          if (puzzleResponse.ok) {
            const puzzleData = await puzzleResponse.json();
            const goal = toItem(puzzleData.goalWord, 'goal');
            const startWords = puzzleData.startWords.map((n: string) => toItem(n, 'start'));
            console.log('✅ Generated puzzle from Word2Vec:', { 
              goal: puzzleData.goalWord, 
              starts: puzzleData.startWords,
              vocab_size: puzzleData.vocab_size 
            });
            setDailyOverride({ goal, startWords });
          } else {
            console.log('⚠️ AI Service unavailable, using local fallback');
            const localPuzzle = pickDaily(dateISO);
            setDailyOverride(localPuzzle);
          }
        } catch (aiError) {
          console.log('⚠️ Cannot connect to AI Service, using local fallback');
          const localPuzzle = pickDaily(dateISO);
          setDailyOverride(localPuzzle);
        }
        
        // Loading screen will auto-hide via useEffect when dailyOverride is set
        // Don't manually setIsLoading(false) here to prevent flickering
        
        // Load global recipes from Firestore in background (optional - for pre-computed combinations)
        // This won't block the app from loading
        (async () => {
          let fbConfig: any = undefined;
          try { fbConfig = require('./firebase.config.json'); } catch (e) { fbConfig = undefined; }
          
          if (!fbConfig) {
            console.log('⚠️ No Firebase config, AI will generate on-the-fly');
            setRecipesOverride(null);
            return;
          }
          
          try {
            const globalRecipes = await fetchGlobalRecipes(fbConfig);
            
            if (cancelled) return;
            
            // Set global recipes
            if (globalRecipes) {
              const mapped: Record<string, WordItem> = {};
              for (const k of Object.keys(globalRecipes)) {
                const r = globalRecipes[k];
                mapped[k.toLowerCase()] = { id: r.id || slugify(r.name), name: r.name || '', type: r.type ?? 'result' } as WordItem;
              }
              console.log('✅ Loaded', Object.keys(mapped).length, 'global recipes from Firestore');
              setRecipesOverride(mapped);
            } else {
              console.log('⚠️ No global recipes found in Firestore, AI will generate on-the-fly');
              setRecipesOverride(null);
            }
          } catch (err) {
            console.log('⚠️ Failed to load Firestore recipes, using AI generation');
            setRecipesOverride(null);
          }
        })();
      } catch (e) {
        console.error('❌ Error loading data:', e);
        // Still use local fallback if everything fails
        const localPuzzle = pickDaily(dateISO);
        setDailyOverride(localPuzzle);
        setRecipesOverride(null);
        // Loading screen will auto-hide via useEffect when dailyOverride is set
      }
    }
    loadRemote();
    return () => { cancelled = true; };
  }, [dateISO, forceReload]); // Add forceReload dependency

  // Force reload on app start to ensure fresh data
  useEffect(() => {
    console.log('🚀 App started, forcing fresh data load...');
    setForceReload(prev => prev + 1);
  }, []);

  // Force reload when screen becomes active (for web refresh)
  useEffect(() => {
    const handleFocus = () => {
      console.log('🔄 Screen focused, forcing data reload...');
      setForceReload(prev => prev + 1);
    };
    
    // For web, listen to visibility change
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleFocus);
      return () => document.removeEventListener('visibilitychange', handleFocus);
    }
  }, []);

  // Auto-hide loading screen when dailyOverride is set (prevent flickering)
  useEffect(() => {
    if (dailyOverride && isLoading) {
      console.log('✅ Daily puzzle loaded, hiding loading screen');
      setIsLoading(false);
    }
  }, [dailyOverride, isLoading]);

  const ensureInDiscovered = (item: WordItem) => {
    setDiscovered(prev => {
      if (prev.find(w => w.id === item.id)) return prev;
      return [...prev, item];
    });
  };

  const onHint = () => {
    const letter = daily.goal.name?.charAt(0) ?? '?';
    Alert.alert('Hint', `ตัวอักษรแรกของเป้าหมายคือ "${letter}"`);
    setMenuOpen(false);
  };

  const onGiveUp = () => {
    ensureInDiscovered(daily.goal);
    Alert.alert('เฉลย', `คำเป้าหมายคือ ${daily.goal.name}`);
    setMenuOpen(false);
  };

  const spawnOnCanvas = (item: WordItem, x?: number, y?: number) => {
    const rect: any = canvasRect.current;
    const bubbleW = 100, bubbleH = 44;
    let nx = x;
    let ny = y;
    if (nx === undefined || ny === undefined) {
      if (rect && rect.width && rect.height) {
        const maxX = Math.max(0, rect.width - bubbleW);
        const maxY = Math.max(0, rect.height - bubbleH);
        nx = nx ?? Math.random() * maxX;
        ny = ny ?? Math.random() * maxY;
      } else {
        nx = nx ?? 40 + Math.random() * 140;
        ny = ny ?? 40 + Math.random() * 140;
      }
    }
    const uid = nextUidRef.current++;
    // ให้ไอเท็มใหม่อยู่หน้ากว่าไอเท็มปกติเล็กน้อย
    setPlaced(prev => [...prev, { uid, id: item.id, name: item.name, type: item.type, x: nx!, y: ny!, z: 2 }]);
  };

  const findRecipe = (aId: string, bId: string): WordItem | null => {
    const key = stableKey(aId, bId);
    
    // Use global recipes from Firestore
    if (recipesOverride && recipesOverride[key]) {
      return recipesOverride[key];
    }
    
    // Fallback: try AI recipe generation via Cloud Function
    return null; // Will trigger AI recipe request in combineIfOverlapByUid
  };

  // --- Selection-based mixing handlers ---
  const selectionDisabled = (id: string): boolean => {
    const lid = id.toLowerCase();
    // If both A and B are selected, disable all words
    if (currentA && currentB) return true;
    // Disable if the item is already selected
    if ((currentA && currentA === lid) || (currentB && currentB === lid)) return true;
    // When A is set, disable any word that has already been combined with A today
    if (currentA && usedCombos.has(comboKey(currentA, lid))) return true;
    // Optionally, if B is set, also disable words already combined with B
    if (currentB && usedCombos.has(comboKey(currentB, lid))) return true;
    return false;
  };

  const onPickFromInventory = (item: WordItem) => {
    const lid = item.id.toLowerCase();
    if (!currentA) { 
      setCurrentA(lid); 
      setLastResult(null); // Clear result when selecting A
      return; 
    }
    if (!currentB && lid !== currentA) { 
      setCurrentB(lid); 
      setLastResult(null); // Clear result when selecting B
      return; 
    }
  };

  const canMix = !!currentA && !!currentB && currentA !== currentB && !usedCombos.has(comboKey(currentA!, currentB!));

  const onMix = async () => {
    if (!canMix || !currentA || !currentB) return;
    setIsCombining(true);
    try {
      // try global recipe first
      const local = findRecipe(currentA, currentB);
      let result: WordItem | null = local;
      if (!result) {
        // try AI
        let fbConfig: any = undefined;
        try { fbConfig = require('./firebase.config.json'); } catch (e) { fbConfig = undefined; }
        // Call AI service - use environment variable or fallback
        const AI_SERVICE_URL = process.env.EXPO_PUBLIC_AI_SERVICE_URL || 'http://127.0.0.1:8099';
        const ai = await fetch(`${AI_SERVICE_URL}/combine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ a: currentA, b: currentB })
        }).then(res => res.ok ? res.json() : null);
        if (ai) result = { id: ai.id, name: ai.name, type: ai.type } as WordItem;
      }
      const ts = Date.now();
      if (result) {
        ensureInDiscovered(result);
        Alert.alert('Result', `${result.name}`);
        setLastResult(result.name);
        console.log('Saving history:', { a: currentA, b: currentB, resultId: result.id, resultName: result.name, ts, puzzleId: dateISO });
        await appendHistory(dateISO, { a: currentA, b: currentB, resultId: result.id, resultName: result.name, ts, puzzleId: dateISO, synced: false });
        // persist discovered list
        try {
          await setDiscoveredWords(dateISO, [{ id: result.id, name: result.name }, ...discovered.map(d => ({ id: d.id, name: d.name }))]);
        } catch {}
      } else {
        // Shake animation for failed combination
        Animated.sequence([
          Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnimation, { toValue: 10, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnimation, { toValue: -10, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true })
        ]).start();
        
        setLastResult('❌ No Connection');
        console.log('Saving history (no result):', { a: currentA, b: currentB, ts, puzzleId: dateISO });
        await appendHistory(dateISO, { a: currentA, b: currentB, ts, puzzleId: dateISO, synced: false });
      }
      await addUsedCombo(dateISO, currentA, currentB);
      setUsedCombos(prev => new Set(prev).add(comboKey(currentA, currentB)));
      // clear both selections after mix
      setCurrentA(null);
      setCurrentB(null);
      // background sync
      console.log('🔄 Attempting to sync history, guestUserId:', guestUserId);
      if (guestUserId) {
        syncHistory(dateISO, guestUserId).catch((error) => {
          console.error('❌ Failed to sync history:', error);
        });
      } else {
        console.warn('⚠️  Guest user ID not available, skipping sync');
      }
    } catch (e) {
      Alert.alert('Error', 'เกิดข้อผิดพลาดขณะผสม');
    } finally {
      setIsCombining(false);
    }
  };

  const combineIfOverlapByUid = async (uidA: number) => {
    setIsCombining(true);
    setPlaced(prev => {
      const idxA = prev.findIndex(p => p.uid === uidA); if (idxA === -1) return prev;
      const a = prev[idxA];
      const rectA = { left: a.x, top: a.y, right: a.x + 100, bottom: a.y + 44 };
      for (let i = 0; i < prev.length; i++) {
        if (i === idxA) continue;
        const b = prev[i];
        const rectB = { left: b.x, top: b.y, right: b.x + 100, bottom: b.y + 44 };
        const overlap = !(rectA.right < rectB.left || rectA.left > rectB.right || rectA.bottom < rectB.top || rectA.top > rectB.bottom);
        if (!overlap) continue;
        const result = findRecipe(a.id, b.id);
        if (!result) {
          // เรียก AI แบบ async ถ้าไม่มีสูตร
          (async () => {
            try {
              let fbConfig: any = undefined;
              try { fbConfig = require('./firebase.config.json'); } catch (e) { fbConfig = undefined; }
              const AI_SERVICE_URL = process.env.EXPO_PUBLIC_AI_SERVICE_URL || 'http://127.0.0.1:8099';
              const ai = await fetch(`${AI_SERVICE_URL}/combine`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ a: a.id, b: b.id })
              }).then(res => res.ok ? res.json() : null);
              if (!ai) return;
              const cxAI = (a.x + b.x) / 2; const cyAI = (a.y + b.y) / 2;
              ensureInDiscovered({ id: ai.id, name: ai.name, type: ai.type });
              setPlaced(cur => {
                const rem = cur.filter(x => x.uid !== a.uid && x.uid !== b.uid);
                const uid = nextUidRef.current++;
                rem.push({ uid, id: ai.id, name: ai.name, type: ai.type, x: cxAI, y: cyAI, z: 99 });
                return rem;
              });
            } catch {}
            finally {
              setIsCombining(false);
            }
          })();
          return prev;
        }
        const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
        const next: Placed[] = prev.filter((_, j) => j !== idxA && j !== i);
        const uid = nextUidRef.current++;
        // ให้ผลลัพธ์ลอยขึ้นมาด้านหน้าเพื่อมองเห็นชัด
        next.push({ uid, id: result.id, name: result.name, type: result.type, x: cx, y: cy, z: 99 });
        ensureInDiscovered(result);
        if (result.id === daily.goal.id) {
          console.log('🎉 Victory! Goal achieved:', daily.goal.name);
          setHasWon(true);
          // Save victory history to Firebase
          setTimeout(async () => {
            try {
              const victoryHistory = await getHistory(dateISO);
              console.log('💾 Saving victory history to Firebase:', victoryHistory.length, 'plays');
              if (guestUserId && victoryHistory.length > 0) {
                await syncHistory(dateISO, guestUserId);
                console.log('✅ Victory history saved!');
              }
              setScreen('victory');
            } catch (error) {
              console.error('❌ Failed to save victory history:', error);
              setScreen('victory'); // Go to victory screen anyway
            }
          }, 500);
        }
        setIsCombining(false);
        return next;
      }
      setIsCombining(false);
      return prev;
    });
  };

  // ผสมเมื่อปล่อยจาก Inventory ลงบน canvas ณ ตำแหน่ง (x,y) ถ้าทับกับไอเท็มที่มีอยู่แล้ว
  const combineFromInventoryAtPoint = (dragItem: WordItem, x: number, y: number): boolean => {
    let didCombine = false;
    setPlaced(prev => {
      const rectGhost = { left: x, top: y, right: x + 100, bottom: y + 44 };
      for (let i = 0; i < prev.length; i++) {
        const b = prev[i];
        const rectB = { left: b.x, top: b.y, right: b.x + 100, bottom: b.y + 44 };
        const overlap = !(rectGhost.right < rectB.left || rectGhost.left > rectB.right || rectGhost.bottom < rectB.top || rectGhost.top > rectB.bottom);
        if (!overlap) continue;
        const result = findRecipe(dragItem.id, b.id);
        if (!result) {
          // เรียก AI แบบ async ถ้าไม่มีสูตร
          (async () => {
            try {
              let fbConfig: any = undefined;
              try { fbConfig = require('./firebase.config.json'); } catch (e) { fbConfig = undefined; }
              const AI_SERVICE_URL = process.env.EXPO_PUBLIC_AI_SERVICE_URL || 'http://127.0.0.1:8099';
              const ai = await fetch(`${AI_SERVICE_URL}/combine`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ a: dragItem.id, b: b.id })
              }).then(res => res.ok ? res.json() : null);
              if (!ai) return;
              const cxAI = (x + b.x) / 2; const cyAI = (y + b.y) / 2;
              ensureInDiscovered({ id: ai.id, name: ai.name, type: ai.type });
              setPlaced(cur => {
                const rem = cur.filter((_, j) => j !== i);
                const uid = nextUidRef.current++;
                rem.push({ uid, id: ai.id, name: ai.name, type: ai.type, x: cxAI, y: cyAI, z: 1 });
                return rem;
              });
            } catch {}
          })();
          return prev;
        }
        const cx = (x + b.x) / 2; const cy = (y + b.y) / 2;
        const next: Placed[] = prev.filter((_, j) => j !== i);
        const uid = nextUidRef.current++;
        next.push({ uid, id: result.id, name: result.name, type: result.type, x: cx, y: cy, z: 1 });
        ensureInDiscovered(result);
        if (result.id === daily.goal.id) {
          console.log('🎉 Victory! Goal achieved:', daily.goal.name);
          setHasWon(true);
          // Save victory history to Firebase
          setTimeout(async () => {
            try {
              const victoryHistory = await getHistory(dateISO);
              console.log('💾 Saving victory history to Firebase:', victoryHistory.length, 'plays');
              if (guestUserId && victoryHistory.length > 0) {
                await syncHistory(dateISO, guestUserId);
                console.log('✅ Victory history saved!');
              }
              setScreen('victory');
            } catch (error) {
              console.error('❌ Failed to save victory history:', error);
              setScreen('victory'); // Go to victory screen anyway
            }
          }, 500);
        }
        didCombine = true;
        return next;
      }
      return prev;
    });
    return didCombine;
  };

  const makeDraggable = (uid: number) => {
    let anchorX = 50, anchorY = 22; // จัดให้ศูนย์กลางบับเบิลอยู่ใต้เคอร์เซอร์ (บับเบิล ~100x44)
    let draggingId: string | null = null;
    const MOVE_THRESHOLD = 2;
    let dragStarted = false;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const cur = placed.find(p => p.uid === uid); if (!cur) return;
        const rect: any = canvasRect.current;
        const px = (evt as any).nativeEvent?.pageX ?? 0;
        const py = (evt as any).nativeEvent?.pageY ?? 0;
        const canvasX = rect ? rect.x : 0;
        const canvasY = rect ? rect.y : 0;
        // ยึด anchor กลางบับเบิลเสมอเพื่อให้เคอร์เซอร์อยู่กึ่งกลาง
        anchorX = 50; // ครึ่งกว้างบับเบิลโดยประมาณ
        anchorY = 22; // ครึ่งสูงบับเบิลโดยประมาณ
        draggingId = cur.id;
        dragStarted = false;
      },
      onPanResponderMove: (evt, g) => {
        // เริ่มนับการลากเมื่อขยับเกิน threshold
        if (!dragStarted) {
          if (Math.abs(g.dx) + Math.abs(g.dy) < MOVE_THRESHOLD) return;
          dragStarted = true;
          // ยก z-index เมื่อเริ่มลากจริง
          setPlaced(prev => {
            const clone = [...prev];
            const idx = clone.findIndex(p => p.uid === uid);
            if (idx !== -1) clone[idx] = { ...clone[idx], z: 99 };
            return clone;
          });
        }
        const rect: any = canvasRect.current;
        const px = (evt as any).nativeEvent?.pageX ?? 0;
        const py = (evt as any).nativeEvent?.pageY ?? 0;
        const canvasX = rect ? rect.x : 0;
        const canvasY = rect ? rect.y : 0;
        const nextX = px - canvasX - anchorX;
        const nextY = py - canvasY - anchorY;
        setPlaced(prev => {
          const clone = [...prev];
          const idx = clone.findIndex(p => p.uid === uid); if (idx === -1) return prev;
          const cur = clone[idx];
          clone[idx] = { ...cur, x: nextX, y: nextY };
          return clone;
        });
      },
      onPanResponderRelease: () => {
        combineIfOverlapByUid(uid);
        if (draggingId) {
          setPlaced(prev => prev.map(p => p.id === draggingId ? { ...p, z: 1 } : p));
        }
      },
    });
  };

  const onCanvasLayout = (e: any) => {
    // ใช้พิกัดแบบ window เสมอ เพื่อลดการสลับระบบพิกัด (ป้องกัน jump)
    // @ts-ignore
    canvasRef.current?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
      canvasRect.current = { x, y, width: w, height: h } as any;
    });
  };

  const makeInventoryDrag = (item: WordItem) => {
    let startPageX = 0, startPageY = 0, moved = false;
    let anchorX = 50, anchorY = 22; // จัดให้ศูนย์กลางบับเบิลอยู่ใต้เคอร์เซอร์ (บับเบิล ~100x44)
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt, g) => {
        // เริ่มจับเวลาสำหรับ long-press เพื่อคัดลอกและลาก
        moved = false;
        dragActiveRef.current = false;
        startPageX = evt.nativeEvent.pageX; startPageY = evt.nativeEvent.pageY;
        // ยึด anchor กลางบับเบิลเสมอเพื่อให้เคอร์เซอร์อยู่กึ่งกลาง
        anchorX = 50; anchorY = 22;
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = setTimeout(() => {
          dragItemRef.current = item;
          setDragging(true);
          dragActiveRef.current = true;
          // วาด ghost เป็น overlay อ้างอิงพิกัดหน้าจอ (page) ลบด้วย anchor เท่านั้น
          const px = evt.nativeEvent.pageX; const py = evt.nativeEvent.pageY;
          dragPos.setValue({ x: px - anchorX, y: py - anchorY });
        }, 250);
      },
      onPanResponderMove: (evt, g) => {
        const px = evt.nativeEvent.pageX; const py = evt.nativeEvent.pageY;
        if (Math.abs(px - startPageX) + Math.abs(py - startPageY) > 2) moved = true;
        // ถ้าเริ่มลากแล้ว คอยอัปเดตตำแหน่ง ghost ให้ตรงกับ cursor
        if (dragActiveRef.current) {
          // overlay: ใช้ page โดยตรง - anchor เพื่อให้ตรงกับเคอร์เซอร์
          dragPos.setValue({ x: px - anchorX, y: py - anchorY });
        }
      },
      onPanResponderRelease: (evt, g) => {
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        const rect: any = canvasRect.current;
        const px = evt.nativeEvent.pageX; const py = evt.nativeEvent.pageY;
        const within = rect && typeof rect.x === 'number' && px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
        if (dragActiveRef.current && dragItemRef.current) {
          // วางจากการลาก (คัดลอก) ใช้ตำแหน่งตรง cursor ใน canvas
          if (within) {
            const localX = px - rect.x - anchorX;
            const localY = py - rect.y - anchorY;
            // ลองผสมทันทีถ้าทับกับไอเท็มบน canvas
            const combined = combineFromInventoryAtPoint(dragItemRef.current, Math.max(0, localX), Math.max(0, localY));
            if (!combined) {
              // ถ้าไม่ผสมก็วางเป็นไอเท็มใหม่ตามปกติ
              spawnOnCanvas(dragItemRef.current, Math.max(0, localX), Math.max(0, localY));
            }
          }
        }
        dragItemRef.current = null;
        dragActiveRef.current = false;
        setDragging(false);
      },
      onPanResponderTerminate: () => {
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        dragItemRef.current = null;
        dragActiveRef.current = false;
        setDragging(false);
      }
    });
  };

  // Disable context menu on web
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handler = (e: any) => e.preventDefault();
      window.addEventListener('contextmenu', handler);
      return () => window.removeEventListener('contextmenu', handler);
    }
    return;
  }, []);

  // Home Screen rendering
  if (screen !== 'game') {
    const gameNo = getDailyNumber();
    if (screen === 'history') {
      // Calendar grid view for selecting previous games
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const epochDate = new Date('2025-01-01'); // Start date: January 1, 2025
      epochDate.setHours(0, 0, 0, 0);
      const todayISO = getTodayISO();
      
      // Generate calendar grid for current month
      const generateCalendarGrid = () => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        
        // First day of the month
        const firstDay = new Date(year, month, 1);
        const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday
        
        // Last day of the month
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        
        // Generate grid (6 rows x 7 columns = 42 cells)
        const grid: (Date | null)[] = [];
        
        // Add empty cells before first day
        for (let i = 0; i < startingDayOfWeek; i++) {
          const prevDate = new Date(year, month, 1 - (startingDayOfWeek - i));
          grid.push(prevDate);
        }
        
        // Add days of current month
        for (let day = 1; day <= daysInMonth; day++) {
          grid.push(new Date(year, month, day));
        }
        
        // Add empty cells after last day to complete the grid (max 42 cells for 6 rows)
        while (grid.length < 42) {
          const nextDate = new Date(year, month + 1, grid.length - startingDayOfWeek - daysInMonth + 1);
          grid.push(nextDate);
        }
        
        // Trim to exactly 42 cells (6 rows)
        return grid.slice(0, 42);
      };
      
      const calendarGrid = generateCalendarGrid();
      const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      
      const getDayNumber = (date: Date) => {
        const days = Math.floor((date.getTime() - epochDate.getTime()) / 86400000);
        return days + 1;
      };
      
      const isInCurrentMonth = (date: Date) => {
        return date.getMonth() === currentMonth.getMonth() && date.getFullYear() === currentMonth.getFullYear();
      };
      
      const isPlayable = (date: Date) => {
        return date >= epochDate && date <= today;
      };
      
      const isToday = (date: Date) => {
        return date.toISOString().slice(0, 10) === todayISO;
      };
      
      const hasPlayed = (date: Date) => {
        const iso = date.toISOString().slice(0, 10);
        return playedDates.has(iso);
      };
      
      const hasWon = (date: Date) => {
        const iso = date.toISOString().slice(0, 10);
        return wonDates.has(iso);
      };
      
      const onSelectDate = async (date: Date) => {
        if (!isPlayable(date)) return;
        
        const iso = date.toISOString().slice(0, 10);
        setDateISO(iso);
        setIsLoading(true);
        
        try {
          const AI_SERVICE_URL = process.env.EXPO_PUBLIC_AI_SERVICE_URL || 'http://localhost:8099';
          const response = await fetch(`${AI_SERVICE_URL}/daily_puzzle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date_iso: iso }),
          });
          
          if (response.ok) {
            const data = await response.json();
            setDailyOverride({
              goal: { id: data.goal.toLowerCase(), name: data.goal, type: 'goal' },
              startWords: data.start_words.map((w: string) => ({ 
                id: w.toLowerCase(), 
                name: w, 
                type: 'start' as const 
              })),
            });
          }
        } catch (error) {
          console.error('[History] Failed to load puzzle for date:', iso, error);
        }
        
        setIsLoading(false);
        setScreen('game');
      };
      
      const goToPreviousMonth = () => {
        const prev = new Date(currentMonth);
        prev.setMonth(prev.getMonth() - 1);
        // Don't go before epoch month
        const epochMonth = new Date(epochDate.getFullYear(), epochDate.getMonth(), 1);
        if (prev >= epochMonth) {
          setCurrentMonth(prev);
        }
      };
      
      const goToNextMonth = () => {
        const next = new Date(currentMonth);
        next.setMonth(next.getMonth() + 1);
        // Don't go beyond current month
        const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        if (next <= todayMonth) {
          setCurrentMonth(next);
        }
      };
      
      const canGoPrev = () => {
        const prev = new Date(currentMonth);
        prev.setMonth(prev.getMonth() - 1);
        const epochMonth = new Date(epochDate.getFullYear(), epochDate.getMonth(), 1);
        return prev >= epochMonth;
      };
      
      const canGoNext = () => {
        const next = new Date(currentMonth);
        next.setMonth(next.getMonth() + 1);
        const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        return next <= todayMonth;
      };
      
      const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      return (
        <SafeAreaView style={[styles.container, isDark ? stylesDark.container : stylesLight.container]}>
          <View style={[styles.header, isDark ? stylesDark.header : stylesLight.header]}>
            <View style={styles.headerRow}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('home')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.backIcon, isDark ? stylesDark.backIcon : stylesLight.backIcon]} selectable={false}>‹</Text>
              </TouchableOpacity>
              <Text style={[styles.calendarTitle, isDark ? stylesDark.calendarTitle : stylesLight.calendarTitle]} selectable={false}>Previous games</Text>
              <View style={styles.menuBtn} />
            </View>
          </View>
          
          <ScrollView style={[styles.calendarScroll, isDark ? stylesDark.calendarScroll : stylesLight.calendarScroll]}>
            {/* Month navigation */}
            <View style={styles.monthNav}>
              <TouchableOpacity 
                onPress={goToPreviousMonth} 
                style={styles.monthNavBtn}
                disabled={!canGoPrev()}
              >
                <Ionicons 
                  name="chevron-back" 
                  size={28} 
                  color={canGoPrev() 
                    ? (isDark ? '#a8b0d4' : '#6b7280') 
                    : (isDark ? '#3a4056' : '#d1d5db')} 
                />
              </TouchableOpacity>
              <Text style={[styles.monthNavText, isDark ? stylesDark.monthNavText : stylesLight.monthNavText]}>
                {monthName}
              </Text>
              <TouchableOpacity 
                onPress={goToNextMonth} 
                style={styles.monthNavBtn}
                disabled={!canGoNext()}
              >
                <Ionicons 
                  name="chevron-forward" 
                  size={28} 
                  color={canGoNext() 
                    ? (isDark ? '#a8b0d4' : '#6b7280') 
                    : (isDark ? '#3a4056' : '#d1d5db')} 
                />
              </TouchableOpacity>
            </View>
            
            {/* Week day headers */}
            <View style={styles.weekDaysRow}>
              {weekDays.map((day) => (
                <View key={day} style={styles.weekDayCell}>
                  <Text style={[styles.weekDayText, isDark ? stylesDark.weekDayText : stylesLight.weekDayText]}>
                    {day}
                  </Text>
                </View>
              ))}
            </View>
            
            {/* Calendar grid */}
            <View style={styles.calendarGrid}>
              {calendarGrid.map((date, index) => {
                if (!date) return <View key={index} style={styles.calendarCell} />;
                
                const inMonth = isInCurrentMonth(date);
                const playable = isPlayable(date);
                const isTodayDate = isToday(date);
                const hasPlayedDate = hasPlayed(date);
                const hasWonDate = hasWon(date);
                const dayNum = getDayNumber(date);
                
                // แสดงวันที่ทั้งหมด แต่วันนอกเดือนและวันที่ยังไม่ถึงจะจาง
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.calendarCell,
                      (!inMonth || !playable) && styles.calendarCellOutside,
                      isTodayDate && playable && (isDark ? stylesDark.calendarCellToday : stylesLight.calendarCellToday)
                    ]}
                    onPress={() => playable ? onSelectDate(date) : null}
                    disabled={!playable}
                  >
                    <Text style={[
                      styles.calendarCellDay,
                      (!inMonth || !playable) && styles.calendarCellDayOutside,
                      isDark ? stylesDark.calendarCellDay : stylesLight.calendarCellDay
                    ]}>
                      {date.getDate()}
                    </Text>
                    {playable && (
                      <>
                        <Text style={[
                          styles.calendarCellGame,
                          !inMonth && styles.calendarCellGameOutside,
                          isDark ? stylesDark.calendarCellGame : stylesLight.calendarCellGame
                        ]}>
                          #{dayNum}
                        </Text>
                        {hasWonDate && (
                          <Ionicons 
                            name="checkmark" 
                            size={20} 
                            color="#10b981" 
                            style={styles.calendarCellIcon}
                          />
                        )}
                        {hasPlayedDate && !hasWonDate && (
                          <Ionicons 
                            name="pause" 
                            size={20} 
                            color="#f59e0b" 
                            style={styles.calendarCellIcon}
                          />
                        )}
                      </>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </SafeAreaView>
      );
    }
    if (screen === 'victory') {
      return (
        <SafeAreaView style={[styles.container, isDark ? stylesDark.container : stylesLight.container]}>
          <View style={[styles.header, isDark ? stylesDark.header : stylesLight.header]}>
            <View style={styles.headerRow}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('home')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.backIcon, isDark ? stylesDark.backIcon : stylesLight.backIcon]} selectable={false}>‹</Text>
              </TouchableOpacity>
              <Text style={[styles.title, isDark ? stylesDark.title : stylesLight.title]} selectable={false}>VICTORY!</Text>
              <View style={styles.menuBtn} />
            </View>
          </View>
          <ScrollView style={[styles.historyContent, isDark ? stylesDark.historyContent : stylesLight.historyContent]}>
            <View style={styles.victoryContainer}>
              <Text style={[styles.victoryTitle, isDark ? stylesDark.victoryTitle : stylesLight.victoryTitle]}>
                🎉 Congratulations! 🎉
              </Text>
              <Text style={[styles.victorySubtitle, isDark ? stylesDark.victorySubtitle : stylesLight.victorySubtitle]}>
                You found: <Text style={styles.victoryGoalName}>{daily.goal.name}</Text>
              </Text>
              
              <View style={[styles.statsBox, isDark ? stylesDark.statsBox : stylesLight.statsBox]}>
                <Text style={[styles.statsTitle, isDark ? stylesDark.statsTitle : stylesLight.statsTitle]}>
                  📊 Your Journey
                </Text>
                <Text style={[styles.statsText, isDark ? stylesDark.statsText : stylesLight.statsText]}>
                  Total Combinations: {historyItems.length}
                </Text>
                <Text style={[styles.statsText, isDark ? stylesDark.statsText : stylesLight.statsText]}>
                  Words Discovered: {discovered.length}
                </Text>
              </View>

              <View style={[styles.historyBox, isDark ? stylesDark.historyBox : stylesLight.historyBox]}>
                <Text style={[styles.historyBoxTitle, isDark ? stylesDark.historyBoxTitle : stylesLight.historyBoxTitle]}>
                  🧩 Your Combinations
                </Text>
                {isLoadingHistory ? (
                  <Text style={[styles.historyText, isDark ? stylesDark.historyText : stylesLight.historyText]}>
                    Loading...
                  </Text>
                ) : historyItems.length === 0 ? (
                  <Text style={[styles.historyText, isDark ? stylesDark.historyText : stylesLight.historyText]}>
                    No combinations recorded.
                  </Text>
                ) : (
                  <View style={styles.historyList}>
                    {historyItems.map((item, index) => (
                      <View key={item.ts} style={[styles.historyItem, isDark ? stylesDark.historyItem : stylesLight.historyItem]}>
                        <Text style={[styles.historyItemText, isDark ? stylesDark.historyItemText : stylesLight.historyItemText]}>
                          {item.a} + {item.b} = {item.resultName || '?'}
                        </Text>
                        <Text style={[styles.historyItemTime, isDark ? stylesDark.historyItemTime : stylesLight.historyItemTime]}>
                          {new Date(item.ts).toLocaleTimeString()}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <TouchableOpacity 
                style={[styles.victoryButton, isDark ? stylesDark.victoryButton : stylesLight.victoryButton]}
                onPress={() => setScreen('home')}
              >
                <Text style={[styles.victoryButtonText, isDark ? stylesDark.victoryButtonText : stylesLight.victoryButtonText]}>
                  Back to Home
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      );
    }
    if (screen === 'settings') {
      return (
        <SafeAreaView style={[homeStyles.container, isDark ? homeStylesDark.container : homeStylesLight.container]}>
          <View style={[styles.header, isDark ? stylesDark.header : stylesLight.header]}> 
            <View style={styles.headerRow}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('home')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.backIcon, isDark ? stylesDark.backIcon : stylesLight.backIcon]} selectable={false}>‹</Text>
              </TouchableOpacity>
              <Text style={[styles.title, isDark ? stylesDark.title : stylesLight.title]} selectable={false}>SETTINGS</Text>
              <View style={styles.menuBtn} />
            </View>
          </View>
          <View style={homeStyles.centerWrap}>
            <View style={[homeStyles.card, isDark ? homeStylesDark.card : homeStylesLight.card]}> 
              <Text style={[homeStyles.cardLabel, isDark ? homeStylesDark.cardLabel : homeStylesLight.cardLabel]} selectable={false}>Color mode</Text>
              <View style={styles.radioRow}>
                <TouchableOpacity style={[styles.radioChip, isDark ? stylesDark.radioChip : stylesLight.radioChip, colorMode === 'system' && (isDark ? stylesDark.radioChipActive : stylesLight.radioChipActive)]} onPress={() => setColorMode('system')}>
                  <Text style={isDark ? stylesDark.alphaText : stylesLight.alphaText} selectable={false}>System</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.radioChip, isDark ? stylesDark.radioChip : stylesLight.radioChip, colorMode === 'light' && (isDark ? stylesDark.radioChipActive : stylesLight.radioChipActive)]} onPress={() => setColorMode('light')}>
                  <Text style={isDark ? stylesDark.alphaText : stylesLight.alphaText} selectable={false}>Light</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.radioChip, isDark ? stylesDark.radioChip : stylesLight.radioChip, colorMode === 'dark' && (isDark ? stylesDark.radioChipActive : stylesLight.radioChipActive)]} onPress={() => setColorMode('dark')}>
                  <Text style={isDark ? stylesDark.alphaText : stylesLight.alphaText} selectable={false}>Dark</Text>
                </TouchableOpacity>
              </View>
              <Text style={[homeStyles.cardLabel, isDark ? homeStylesDark.cardLabel : homeStylesLight.cardLabel]} selectable={false}>Current: {colorMode === 'system' ? `System (${scheme})` : colorMode}</Text>
            </View>
          </View>
        </SafeAreaView>
      );
    }
    
    // Check if player has started playing today (discovered more than just start words)
    const hasStartedPlaying = discovered.length > daily.startWords.length;
    const buttonText = hasStartedPlaying ? 'Continue' : 'Play';

    return (
      <SafeAreaView style={[homeStyles.container, isDark ? homeStylesDark.container : homeStylesLight.container]}>
        <View style={homeStyles.headerSpace} />
        <View style={homeStyles.centerWrap}>
          <Text style={[homeStyles.brand, isDark ? homeStylesDark.brand : homeStylesLight.brand]} selectable={false}>WORDCRAFT</Text>

          <View style={[homeStyles.card, isDark ? homeStylesDark.card : homeStylesLight.card]}>
            <Text style={[homeStyles.cardLabel, isDark ? homeStylesDark.cardLabel : homeStylesLight.cardLabel]} selectable={false}>Today's game:</Text>
            <Text style={[homeStyles.cardNumber, isDark ? homeStylesDark.cardNumber : homeStylesLight.cardNumber]} selectable={false}>#{gameNo}</Text>
            <TouchableOpacity style={[homeStyles.primaryBtn, isDark ? homeStylesDark.primaryBtn : homeStylesLight.primaryBtn]} onPress={() => setScreen('game')}>
              <Text style={[homeStyles.primaryBtnText, isDark ? homeStylesDark.primaryBtnText : homeStylesLight.primaryBtnText]} selectable={false}>{buttonText}</Text>
            </TouchableOpacity>
          </View>

          <View style={homeStyles.menu}>
            <TouchableOpacity style={[homeStyles.menuItem, isDark ? homeStylesDark.menuItem : homeStylesLight.menuItem]} onPress={() => {
              console.log('Home History button pressed, current dateISO:', dateISO);
              console.log('Setting screen to history...');
              setScreen('history');
              console.log('Screen set to history');
            }}>
              <Ionicons name="calendar-outline" size={20} color={isDark ? '#a8b0d4' : '#6b7280'} />
              <Text style={[homeStyles.menuText, isDark ? homeStylesDark.menuText : homeStylesLight.menuText]} selectable={false}>Previous games</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[homeStyles.menuItem, isDark ? homeStylesDark.menuItem : homeStylesLight.menuItem]} onPress={() => setScreen('howto')}>
              <Ionicons name="help-circle-outline" size={20} color={isDark ? '#a8b0d4' : '#6b7280'} />
              <Text style={[homeStyles.menuText, isDark ? homeStylesDark.menuText : homeStylesLight.menuText]} selectable={false}>How to play</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[homeStyles.menuItem, isDark ? homeStylesDark.menuItem : homeStylesLight.menuItem]} onPress={() => setScreen('settings')}>
              <Ionicons name="settings-outline" size={20} color={isDark ? '#a8b0d4' : '#6b7280'} />
              <Text style={[homeStyles.menuText, isDark ? homeStylesDark.menuText : homeStylesLight.menuText]} selectable={false}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }


  // Show loading screen until data is loaded
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, isDark ? stylesDark.container : stylesLight.container]}>
        <View style={[styles.loadingOverlay, isDark ? stylesDark.loadingOverlay : stylesLight.loadingOverlay]}>
          <View style={[styles.loadingContent, isDark ? stylesDark.loadingContent : stylesLight.loadingContent]}>
            <Text style={[styles.loadingText, isDark ? stylesDark.loadingText : stylesLight.loadingText]}>
              🔄 Loading...
            </Text>
            <Text style={[styles.loadingSubtext, isDark ? stylesDark.loadingSubtext : stylesLight.loadingSubtext]}>
              Fetching puzzle and recipes from Firestore
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isDark ? stylesDark.container : stylesLight.container]}>
      <View style={[styles.header, isDark ? stylesDark.header : stylesLight.header]}> 
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('home')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.backIcon, isDark ? stylesDark.backIcon : stylesLight.backIcon]} selectable={false}>‹</Text>
          </TouchableOpacity>
          <Text style={[styles.title, isDark ? stylesDark.title : stylesLight.title]} selectable={false}>WORDCRAFT</Text>
          <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOpen(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.menuIcon, isDark ? stylesDark.menuIcon : stylesLight.menuIcon]} selectable={false}>⋮</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.goalCenterBox, isDark ? stylesDark.goalCenterBox : stylesLight.goalCenterBox]}>
          <Text style={[styles.goalLabel, isDark ? stylesDark.goalLabel : stylesLight.goalLabel]} selectable={false}>Goal</Text>
          <Text style={[styles.goalBigName, isDark ? stylesDark.goalBigName : stylesLight.goalBigName]} selectable={false}>{daily.goal.name}</Text>
        </View>
        {menuOpen && (
          <View style={[styles.menuPanel, isDark ? stylesDark.menuPanel : stylesLight.menuPanel]}>
            <TouchableOpacity style={styles.menuItemRow} onPress={onHint}>
              <Text style={[styles.menuItemText, isDark ? stylesDark.menuItemText : stylesLight.menuItemText]} selectable={false}>Hint</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItemRow} onPress={onGiveUp}>
              <Text style={[styles.menuItemText, isDark ? stylesDark.menuItemText : stylesLight.menuItemText]} selectable={false}>Give up</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => {
              console.log('Game menu History button pressed, current dateISO:', dateISO);
              setMenuOpen(false);
              setScreen('history');
            }}>
              <Text style={[styles.menuItemText, isDark ? stylesDark.menuItemText : stylesLight.menuItemText]} selectable={false}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItemRow} onPress={async () => {
              try {
                await clearAllForPuzzle(dateISO);
                const used = await getUsedCombos(dateISO);
                setUsedCombos(used);
                setCurrentA(null);
                setCurrentB(null);
                // reset discovered (remove results of today) to only today's start words
                const uniqueStarts = daily.startWords.filter((w, i, self) => i === self.findIndex(x => x.id === w.id));
                setDiscovered(uniqueStarts);
                setLastResult(null);
                Alert.alert('Cleared', 'ลบประวัติและคอมโบที่ใช้แล้วของวันนี้เรียบร้อย');
                setMenuOpen(false);
              } catch (e) {
                Alert.alert('Error', 'ลบข้อมูลไม่สำเร็จ');
              }
            }}>
              <Text style={[styles.menuItemText, isDark ? stylesDark.menuItemText : stylesLight.menuItemText]} selectable={false}>Clear today data</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {/* Persistent Inventory Dock (moved to top) */}
      <View style={styles.inventoryDock} accessibilityLabel="inventory-dock" testID="inventory-dock">
        <View style={styles.inventoryHeaderRow} accessibilityLabel="inventory-header" testID="inventory-header">
          <Text style={[styles.sheetTitle, isDark ? stylesDark.sheetTitle : stylesLight.sheetTitle]} selectable={false} accessibilityLabel="inventory-title" testID="inventory-title">Word</Text>
          <Text style={[styles.sheetClose, isDark ? stylesDark.sheetClose : stylesLight.sheetClose]} selectable={false} accessibilityLabel="inventory-count" testID="inventory-count">{filteredAll.length} items</Text>
        </View>
        <View style={[styles.searchContainer, isDark ? stylesDark.searchContainer : stylesLight.searchContainer]} accessibilityLabel="search-container" testID="search-container">
          <Text style={[styles.searchIcon, isDark ? stylesDark.searchIcon : stylesLight.searchIcon]} selectable={false} accessibilityLabel="search-icon" testID="search-icon">🔍</Text>
          <TextInput
            style={[styles.searchInput, isDark ? stylesDark.searchInput : stylesLight.searchInput]}
            placeholder="Search words..."
            placeholderTextColor={isDark ? '#a8b0d4' : '#6b7280'}
            nativeID="inventory-search"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect={false}
            value={searchQuery}
            onChangeText={(t) => setSearchQuery(t.replace(/[^a-z]/gi, ''))}
            accessibilityLabel="search-input"
            testID="search-input"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityLabel="search-clear" testID="search-clear">
              <Text style={[styles.searchClear, isDark ? stylesDark.searchClear : stylesLight.searchClear]} selectable={false}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabRow]} accessibilityLabel="tab-scroll" testID="tab-scroll">
          {(['all','recent'] as TabKey[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tabChip, isDark ? stylesDark.tabChip : stylesLight.tabChip]}
              onPress={() => {
                setActiveTab(t);
                if (t === 'all') setInvFilter(null);
              }}
              accessibilityLabel={`tab-${t}`}
              testID={`tab-${t}`}
            >
              <Text style={isDark ? stylesDark.alphaText : stylesLight.alphaText} selectable={false}>{t === 'all' ? 'All' : 'Recent'}</Text>
            </TouchableOpacity>
          ))}
          {letterKeys.length > 0 && (
            <>
              {letterKeys.map(ch => (
                <TouchableOpacity key={ch} style={[styles.alphaChip, isDark ? stylesDark.alphaChip : stylesLight.alphaChip]} onPress={() => setInvFilter(ch)} accessibilityLabel={`alpha-${ch}`} testID={`alpha-${ch}`}>
                  <Text style={isDark ? stylesDark.alphaText : stylesLight.alphaText} selectable={false}>{ch}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
        <ScrollView showsVerticalScrollIndicator contentContainerStyle={[styles.inventoryWrapVertical, { height: 'calc(100vh - 575px)' as any }]} accessibilityLabel="inventory-scroll" testID="inventory-scroll">
          {tabItems.map((item, index) => {
            const isFav = favorites.includes(item.id);
            const disabled = selectionDisabled(item.id);
            return (
              <View key={`${item.id}-${index}`} style={styles.inventoryItemWrapper} accessibilityLabel={`inventory-item-${item.id}`} testID={`inventory-item-${item.id}`}> 
                <TouchableOpacity disabled={disabled} onPress={() => { onPickFromInventory(item); ensureInDiscovered(item); pushRecent(item.id); }} accessibilityLabel={`word-${item.id}`} testID={`word-${item.id}`}>
                  <View style={[styles.item, item.type === 'start' && styles.itemStart, item.id === daily.goal.id && styles.itemGoal, disabled && { opacity: 0.4 }]}> 
                    <Text selectable={false} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </View>
      {/* End Inventory Dock */}
      <View style={[styles.content, isStacked && styles.contentColumn, { height: 'auto', bottom: BANNER_HEIGHT }]} accessibilityLabel="mixing-section" testID="mixing-section">
        <View style={styles.leftPane}>
          <View style={{ justifyContent: 'center', paddingHorizontal: 0, gap: 8 }}>
            {/* Line 1: A + B */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* Box A */}
              <View style={{ flex: 1 }} accessibilityLabel="selection-a-container" testID="selection-a-container">
                <TouchableOpacity onPress={() => { if (currentA) { setCurrentA(null); setLastResult(null); } }} activeOpacity={0.8} accessibilityLabel="selection-a-button" testID="selection-a-button">
                  <View style={[styles.selectionBox, !currentA && styles.selectionBoxPlaceholder]} accessibilityLabel="selection-a-box" testID="selection-a-box">
                    <Text
                      selectable={false}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      adjustsFontSizeToFit
                      minimumFontScale={0.1}
                      style={[styles.selectionText, !currentA && styles.placeholderText]}
                    >
                      {currentA ? (filteredAll.find(w => w.id.toLowerCase() === currentA)?.name || currentA) : 'A'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* + */}
              <Text selectable={false} style={{ fontSize: 14, fontWeight: '800' }}>+</Text>

              {/* Box B */}
              <View style={{ flex: 1 }} accessibilityLabel="selection-b-container" testID="selection-b-container">
                <TouchableOpacity onPress={() => { if (currentB) { setCurrentB(null); setLastResult(null); } }} activeOpacity={0.8} accessibilityLabel="selection-b-button" testID="selection-b-button">
                  <View style={[styles.selectionBox, !currentB && styles.selectionBoxPlaceholder]} accessibilityLabel="selection-b-box" testID="selection-b-box">
                    <Text
                      selectable={false}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      adjustsFontSizeToFit
                      minimumFontScale={0.1}
                      style={[styles.selectionText, !currentB && styles.placeholderText]}
                    >
                      {currentB ? (filteredAll.find(w => w.id.toLowerCase() === currentB)?.name || currentB) : 'B'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Line 2: = */}
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <Text selectable={false} style={{ fontSize: 14, fontWeight: '800' }}>=</Text>
            </View>
            {/* Line 3: Result */}
            <Animated.View 
              accessibilityLabel="result-container" 
              testID="result-container"
              style={{ transform: [{ translateX: shakeAnimation }] }}
            >
              <View style={[styles.resultBox, !lastResult && styles.resultBoxPlaceholder]} accessibilityLabel="result-box" testID="result-box">
                <Text
                  selectable={false}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  adjustsFontSizeToFit
                  minimumFontScale={0.2}
                  style={[styles.resultText, !lastResult && styles.resultPlaceholderText]}
                >
                  {lastResult ? lastResult : 'Result'}
                </Text>
              </View>
            </Animated.View>
            {/* Line 4: Mix button */}
            <TouchableOpacity disabled={!canMix || isCombining} onPress={onMix} accessibilityLabel="mix-button" testID="mix-button">
              <View style={[styles.fullButton, { backgroundColor: (canMix && !isCombining) ? '#111827' : '#9ca3af' }]} accessibilityLabel="mix-button-container" testID="mix-button-container"> 
                <Text selectable={false} style={{ color: '#ffffff', fontWeight: '700', fontSize: 14 }}>{isCombining ? 'Mixing...' : 'Mix'}</Text>
              </View>
            </TouchableOpacity>
            {/* per-button loading removed; use full-screen overlay below */}
          </View>
        </View>
        {/* right pane removed */}
      </View>
      <View style={[styles.banner, isDark ? stylesDark.banner : stylesLight.banner]}>
        {/* AdMobBanner disabled for web compatibility */}
        <Text style={[styles.bannerText, isDark ? stylesDark.bannerText : stylesLight.bannerText]}>
          AdMobBanner component not supported on the web
        </Text>
      </View>
      {isCombining && (
        <View style={[styles.loadingOverlay, isDark ? stylesDark.loadingOverlay : stylesLight.loadingOverlay]}>
          <View style={[styles.loadingContent, isDark ? stylesDark.loadingContent : stylesLight.loadingContent]}>
            <Text style={[styles.loadingText, isDark ? stylesDark.loadingText : stylesLight.loadingText]}>🔄 Mixing...</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1222', userSelect: 'none' as any, cursor: 'default' as any },
  header: { paddingHorizontal: 16, paddingVertical: 16, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.15)', zIndex: 9 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#eef1ff', fontSize: 20, fontWeight: '800', textTransform: 'uppercase' as any },
  goal: { color: '#a8b0d4', marginTop: 6 },
  goalStrong: { color: '#7affb2', fontWeight: '700' },
  goalCenterBox: { alignItems: 'center', marginTop: 8, marginBottom: 4, backgroundColor: 'rgba(122,255,178,0.08)', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(122,255,178,0.35)' },
  goalLabel: { color: '#a8b0d4', marginBottom: 2 },
  goalBigName: { color: '#7affb2', fontWeight: '800', fontSize: 28 },
  backLink: { color: '#a8b0d4', marginBottom: 6 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backIcon: { color: '#a8b0d4', fontSize: 26, lineHeight: 26 },
  menuBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { color: '#a8b0d4', fontSize: 26, lineHeight: 26 },
  menuPanel: { position: 'absolute', right: 12, top: 44, backgroundColor: '#1a1e33', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)', overflow: 'hidden', zIndex: 100000 },
  menuItemRow: { paddingHorizontal: 12, paddingVertical: 10 },
  menuItemText: { color: '#eef1ff' },
  content: { position: 'absolute', bottom: 0, left: 0, right: 0, width: '100%', flexDirection: 'row', zIndex: 10 },
  contentColumn: { flexDirection: 'column' },
  leftPane: { flex: 1, padding: 16, position: 'relative', zIndex: 2 },
  rightPane: { width: 0, padding: 0, borderLeftWidth: 0, borderLeftColor: 'transparent', position: 'relative', zIndex: 1 },
  rightPaneFull: { width: 0, borderLeftWidth: 0, borderTopWidth: 0, borderTopColor: 'transparent' },
  controlsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  inventoryScroll: { },
  inventoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inventoryItemWrapper: { justifyContent: 'center' },
  item: { backgroundColor: '#fff', height: 36, paddingHorizontal: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', userSelect: 'none' as any, cursor: 'default' as any },
  itemStart: { borderWidth: 2, borderColor: 'gold' },
  itemGoal: { borderWidth: 2, borderColor: '#7affb2' },
  button: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.08)', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#eef1ff' },
  canvas: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, position: 'relative', overflow: 'hidden', zIndex: 99, userSelect: 'none' as any, cursor: 'default' as any },
  itemBubble: { position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1, userSelect: 'none' as any, cursor: 'default' as any },
  itemText: { color: '#101226', flexShrink: 1 },
  dragGhost: { position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1, opacity: 0.95, zIndex: 9999, elevation: 10, userSelect: 'none' as any, cursor: 'default' as any },
  dragGhostOverlay: { position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1, opacity: 0.95, zIndex: 99999, elevation: 20, userSelect: 'none' as any, cursor: 'default' as any, left: 0, top: 0 },
  banner: { position: 'absolute', bottom: 0, left: 0, right: 0, width: '100%', height: 40, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)', backgroundColor: '#0f1222', justifyContent: 'center', zIndex: 5 },
  bannerText: { color: '#a8b0d4', textAlign: 'center', paddingVertical: 8, fontSize: 12 },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000, justifyContent: 'center', alignItems: 'center' },
  loadingContent: { backgroundColor: 'rgba(255,255,255,0.95)', padding: 24, borderRadius: 16, alignItems: 'center', minWidth: 200 },
  loadingText: { fontSize: 18, fontWeight: '600', marginBottom: 8, color: '#1f2937' },
  loadingSubtext: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  selectionBox: { width: '100%', borderWidth: 2, borderStyle: 'dashed' as any, borderColor: '#111827', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  selectionText: { fontSize: 14, color: 'rgba(0,0,0,0.7)' },
  selectionBoxPlaceholder: { borderColor: 'rgba(0,0,0,0.25)' },
  placeholderText: { color: 'rgba(0,0,0,0.35)' },
  fullButton: { width: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 8, height: 44, marginTop: 8 },
  resultBox: { width: '100%', borderWidth: 1, borderColor: 'rgba(0,0,0,0.2)', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  resultBoxPlaceholder: { borderColor: 'rgba(0,0,0,0.15)' },
  resultText: { fontSize: 14, color: '#1f2937' },
  resultPlaceholderText: { color: 'rgba(0,0,0,0.45)' },
  historyText: { color: '#a8b0d4', fontSize: 16, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  historyContent: { flex: 1, flexDirection: 'column' },
  historyList: { padding: 16 },
  historyLoadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40 },
  historyItem: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, marginBottom: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  historyItemText: { color: '#eef1ff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  historyItemTime: { color: '#a8b0d4', fontSize: 12 },
  // Calendar grid styles
  calendarTitle: { color: '#2a2a2a', fontSize: 20, fontWeight: '800' },
  calendarScroll: { flex: 1 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  monthNavBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  monthNavText: { fontSize: 20, fontWeight: '700', color: '#2a2a2a' },
  weekDaysRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8, marginTop: 8 },
  weekDayCell: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  weekDayText: { fontSize: 15, fontWeight: '700', color: '#6b7280' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 20, height: 'calc(-220px + 100vh)' as any },
  calendarCell: { width: '14.285%', aspectRatio: 0.55, padding: 6, alignItems: 'center', justifyContent: 'flex-start', backgroundColor: 'rgba(0,0,0,0.02)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  calendarCellOutside: { opacity: 0.4, backgroundColor: 'rgba(0,0,0,0.01)' },
  calendarCellDay: { fontSize: 18, fontWeight: '600', color: '#1f2937', marginBottom: 4 },
  calendarCellDayOutside: { color: '#d1d5db', fontWeight: '400' },
  calendarCellGame: { fontSize: 12, fontWeight: '700', color: '#1f2937', marginBottom: 6 },
  calendarCellGameOutside: { color: '#d1d5db', fontWeight: '500' },
  calendarCellIcon: { marginTop: 4 },
  // Persistent Inventory Dock styles
  inventoryDock: { padding: 16, paddingHorizontal: 12, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTopWidth: 0, borderTopColor: 'transparent', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)' },
  inventoryHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { color: '#eef1ff', fontWeight: '800', fontSize: 16 },
  sheetClose: { color: '#a8b0d4' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 12, marginBottom: 10, gap: 10, height: 44, width: '100%' },
  searchIcon: { color: '#a8b0d4', fontSize: 16 },
  searchInput: { flex: 1, color: '#eef1ff', height: 44, paddingVertical: 10, fontSize: 16, lineHeight: 24 },
  searchClear: { color: '#a8b0d4', fontSize: 14, paddingHorizontal: 6, paddingVertical: 2 },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tabChip: { backgroundColor: '#22283f', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, height: 40, justifyContent: 'center' },
  tabChipActive: { },
  alphaRow: { gap: 6, paddingBottom: 8 },
  alphaChip: { backgroundColor: '#22283f', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, height: 40, justifyContent: 'center' },
  alphaChipActive: { },
  alphaText: { color: '#eef1ff', fontSize: 16 },
  radioRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  radioChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  inventoryWrapHorizontal: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', paddingBottom: 4, height: 48 },
  inventoryWrapVertical: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingBottom: 4, gap: 8 },
  sheetPeek: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingVertical: 6, zIndex: 9997 },
  sheetSwipeZone: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, zIndex: 9996 },
  // Victory screen styles
  victoryContainer: { flex: 1, padding: 24, alignItems: 'center' },
  victoryTitle: { fontSize: 32, fontWeight: '800', color: '#7affb2', textAlign: 'center', marginTop: 20, marginBottom: 12 },
  victorySubtitle: { fontSize: 18, color: '#a8b0d4', textAlign: 'center', marginBottom: 24 },
  victoryGoalName: { color: '#7affb2', fontWeight: '800', fontSize: 20 },
  statsBox: { width: '100%', backgroundColor: 'rgba(122,255,178,0.08)', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(122,255,178,0.25)', marginBottom: 20 },
  statsTitle: { fontSize: 18, fontWeight: '700', color: '#7affb2', marginBottom: 12, textAlign: 'center' },
  statsText: { fontSize: 16, color: '#eef1ff', marginBottom: 6, textAlign: 'center' },
  historyBox: { width: '100%', backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 20, maxHeight: 400 },
  historyBoxTitle: { fontSize: 18, fontWeight: '700', color: '#eef1ff', marginBottom: 12, textAlign: 'center' },
  victoryButton: { width: '100%', backgroundColor: '#7affb2', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  victoryButtonText: { color: '#0f1222', fontSize: 18, fontWeight: '800', textTransform: 'uppercase' as any }
});

// Light/Dark overrides
const stylesDark = StyleSheet.create({
  container: { backgroundColor: '#0f1222' },
  header: { borderBottomColor: 'rgba(255,255,255,0.15)' },
  title: { color: '#eef1ff' },
  backIcon: { color: '#a8b0d4' },
  menuIcon: { color: '#a8b0d4' },
  button: { backgroundColor: 'rgba(255,255,255,0.08)' },
  buttonText: { color: '#eef1ff' },
  goalCenterBox: { backgroundColor: 'rgba(122,255,178,0.08)', borderColor: 'rgba(122,255,178,0.35)' },
  goalLabel: { color: '#a8b0d4' },
  goalBigName: { color: '#7affb2' },
  menuPanel: { backgroundColor: '#1a1e33', borderColor: 'rgba(255,255,255,0.15)' },
  menuItemText: { color: '#eef1ff' },
  canvas: { borderColor: 'rgba(255,255,255,0.12)' },
  historyText: { color: '#a8b0d4' },
  historyContent: { flexDirection: 'column' },
  historyItem: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' },
  historyItemText: { color: '#eef1ff' },
  historyItemTime: { color: '#a8b0d4' },
  // Calendar grid overrides
  calendarTitle: { color: '#eef1ff' },
  calendarScroll: { backgroundColor: '#0f1222' },
  monthNavText: { color: '#eef1ff' },
  weekDayText: { color: '#a8b0d4' },
  calendarCell: { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' },
  calendarCellOutside: { opacity: 0.4, backgroundColor: 'rgba(255,255,255,0.01)' },
  calendarCellToday: { backgroundColor: 'rgba(122,255,178,0.08)', borderColor: 'rgba(122,255,178,0.25)' },
  calendarCellDay: { color: '#eef1ff' },
  calendarCellDayOutside: { color: '#4b5563', fontWeight: '400' },
  calendarCellGame: { color: '#a8b0d4' },
  calendarCellGameOutside: { color: '#4b5563', fontWeight: '500' },
  sheetTitle: { color: '#eef1ff' },
  sheetClose: { color: '#a8b0d4' },
  searchContainer: { backgroundColor: 'rgba(255,255,255,0.08)' },
  searchIcon: { color: '#a8b0d4' },
  searchInput: { color: '#eef1ff' },
  searchClear: { color: '#a8b0d4' },
  tabChip: { backgroundColor: '#22283f' },
  alphaChip: { backgroundColor: '#22283f' },
  alphaText: { color: '#eef1ff' },
  radioChip: { backgroundColor: '#22283f', borderColor: 'transparent' },
  radioChipActive: { borderColor: '#7affb2' },
  banner: { borderTopColor: 'rgba(255,255,255,0.12)', backgroundColor: '#0f1222' },
  bannerText: { color: '#a8b0d4' },
  loadingOverlay: { backgroundColor: 'rgba(0,0,0,0.9)' },
  loadingContent: { backgroundColor: 'rgba(30,30,30,0.95)' },
  loadingText: { color: '#eef1ff' },
  loadingSubtext: { color: '#a8b0d4' },
  // Victory screen overrides
  victoryTitle: { color: '#7affb2' },
  victorySubtitle: { color: '#a8b0d4' },
  victoryGoalName: { color: '#7affb2' },
  statsBox: { backgroundColor: 'rgba(122,255,178,0.08)', borderColor: 'rgba(122,255,178,0.25)' },
  statsTitle: { color: '#7affb2' },
  statsText: { color: '#eef1ff' },
  historyBox: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' },
  historyBoxTitle: { color: '#eef1ff' },
  victoryButton: { backgroundColor: '#7affb2' },
  victoryButtonText: { color: '#0f1222' },
});

const stylesLight = StyleSheet.create({
  container: { backgroundColor: '#fbf8ef' },
  header: { borderBottomColor: 'rgba(0,0,0,0.1)' },
  title: { color: '#2a2a2a' },
  backIcon: { color: '#4b5563' },
  menuIcon: { color: '#4b5563' },
  button: { backgroundColor: '#e9ecf5' },
  buttonText: { color: '#1f2937' },
  goalCenterBox: { backgroundColor: 'rgba(43,108,176,0.08)', borderColor: 'rgba(43,108,176,0.35)' },
  goalLabel: { color: '#6b7280' },
  goalBigName: { color: '#2b6cb0' },
  menuPanel: { backgroundColor: '#ffffff', borderColor: 'rgba(0,0,0,0.12)' },
  menuItemText: { color: '#1f2937' },
  canvas: { borderColor: 'rgba(0,0,0,0.12)' },
  historyText: { color: '#6b7280' },
  historyContent: { flexDirection: 'column' },
  historyItem: { backgroundColor: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.1)' },
  historyItemText: { color: '#1f2937' },
  historyItemTime: { color: '#6b7280' },
  // Calendar grid overrides
  calendarTitle: { color: '#2a2a2a' },
  calendarScroll: { backgroundColor: '#fbf8ef' },
  monthNavText: { color: '#2a2a2a' },
  weekDayText: { color: '#6b7280' },
  calendarCell: { backgroundColor: 'rgba(0,0,0,0.02)', borderColor: 'rgba(0,0,0,0.05)' },
  calendarCellOutside: { opacity: 0.4, backgroundColor: 'rgba(0,0,0,0.01)' },
  calendarCellToday: { backgroundColor: 'rgba(43,108,176,0.08)', borderColor: 'rgba(43,108,176,0.25)' },
  calendarCellDay: { color: '#1f2937' },
  calendarCellDayOutside: { color: '#d1d5db', fontWeight: '400' },
  calendarCellGame: { color: '#1f2937' },
  calendarCellGameOutside: { color: '#d1d5db', fontWeight: '500' },
  sheetTitle: { color: '#1f2937' },
  sheetClose: { color: '#6b7280' },
  searchContainer: { backgroundColor: 'rgba(0,0,0,0.06)' },
  searchIcon: { color: '#6b7280' },
  searchInput: { color: '#1f2937' },
  searchClear: { color: '#6b7280' },
  tabChip: { backgroundColor: '#e9ecf5' },
  alphaChip: { backgroundColor: '#e9ecf5' },
  alphaText: { color: '#1f2937' },
  radioChip: { backgroundColor: '#e9ecf5', borderColor: 'transparent' },
  radioChipActive: { borderColor: '#2b6cb0' },
  banner: { borderTopColor: 'rgba(0,0,0,0.12)', backgroundColor: '#fbf8ef' },
  bannerText: { color: '#6b7280' },
  loadingOverlay: { backgroundColor: 'rgba(0,0,0,0.8)' },
  loadingContent: { backgroundColor: 'rgba(255,255,255,0.95)' },
  loadingText: { color: '#1f2937' },
  loadingSubtext: { color: '#6b7280' },
  // Victory screen overrides
  victoryTitle: { color: '#2b6cb0' },
  victorySubtitle: { color: '#6b7280' },
  victoryGoalName: { color: '#2b6cb0' },
  statsBox: { backgroundColor: 'rgba(43,108,176,0.08)', borderColor: 'rgba(43,108,176,0.25)' },
  statsTitle: { color: '#2b6cb0' },
  statsText: { color: '#1f2937' },
  historyBox: { backgroundColor: 'rgba(0,0,0,0.05)', borderColor: 'rgba(0,0,0,0.1)' },
  historyBoxTitle: { color: '#1f2937' },
  victoryButton: { backgroundColor: '#2b6cb0' },
  victoryButtonText: { color: '#ffffff' },
});

const homeStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fbf8ef', zIndex: 9 },
  headerSpace: { height: 0 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  brand: { fontSize: 36, fontWeight: '800', color: '#2a2a2a', letterSpacing: 2, marginBottom: 18, textTransform: 'uppercase' as any },
  card: { backgroundColor: '#ffffff', padding: 24, borderRadius: 16, width: '86%', maxWidth: 360, alignItems: 'center', boxShadow: '0 6px 14px rgba(0, 0, 0, 0.07)', elevation: 2 },
  cardLabel: { color: '#585858', marginBottom: 8, fontSize: 16 },
  cardNumber: { color: '#1b1f2a', fontSize: 28, fontWeight: '800', marginBottom: 14 },
  primaryBtn: { backgroundColor: '#2b6cb0', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, alignSelf: 'stretch', alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
  menu: { width: '86%', maxWidth: 420, marginTop: 28 },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  menuText: { color: '#3a3a3a', fontSize: 16, fontWeight: '600' }
});

const homeStylesDark = StyleSheet.create({
  container: { backgroundColor: '#0f1222' },
  brand: { color: '#eef1ff' },
  card: { backgroundColor: '#151a33', boxShadow: '0 6px 14px rgba(0, 0, 0, 0.2)' },
  cardLabel: { color: '#a8b0d4' },
  cardNumber: { color: '#eef1ff' },
  primaryBtn: { backgroundColor: '#2b6cb0' },
  primaryBtnText: { color: '#ffffff' },
  menuItem: { },
  menuText: { color: '#eef1ff' },
});

const homeStylesLight = StyleSheet.create({
  container: { backgroundColor: '#fbf8ef' },
  brand: { color: '#2a2a2a' },
  card: { backgroundColor: '#ffffff' },
  cardLabel: { color: '#585858' },
  cardNumber: { color: '#1b1f2a' },
  primaryBtn: { backgroundColor: '#2b6cb0' },
  primaryBtnText: { color: '#ffffff' },
  menuItem: { },
  menuText: { color: '#3a3a3a' },
});
