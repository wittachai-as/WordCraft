import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, PanResponder, LayoutRectangle, Animated, Platform, useWindowDimensions, ScrollView, TextInput, useColorScheme } from 'react-native';
import { AdMobBanner } from 'expo-ads-admob';

type WordItem = { id: string; name: string; type?: 'start' | 'goal' | 'result' };

function getTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailyNumber(): number {
  const start = new Date('2022-01-01T00:00:00Z').getTime();
  const today = new Date();
  const utcMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const diffDays = Math.floor((utcMidnight - start) / (1000 * 60 * 60 * 24));
  return diffDays + 1; // start at #1
}

function seededRandom(seedStr: string) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  return () => (seed = (1103515245 * seed + 12345) % 2 ** 31) / 2 ** 31;
}

const WORDS: WordItem[] = [
  { id: 'water', name: 'Water', type: 'start' },
  { id: 'fire', name: 'Fire', type: 'start' },
  { id: 'earth', name: 'Earth', type: 'start' },
  { id: 'air', name: 'Air', type: 'start' },
  { id: 'electricity', name: 'Electricity', type: 'goal' },
  { id: 'energy', name: 'Energy', type: 'result' },
  { id: 'steam', name: 'Steam', type: 'result' },
  { id: 'mud', name: 'Mud', type: 'result' },
  { id: 'plant', name: 'Plant', type: 'result' },
];

const RECIPES: Record<string, WordItem> = {
  'air+earth': { id: 'dust', name: 'Dust', type: 'result' },
  'air+fire': { id: 'energy', name: 'Energy', type: 'result' },
  'air+water': { id: 'rain', name: 'Rain', type: 'result' },
  'earth+fire': { id: 'lava', name: 'Lava', type: 'result' },
  'earth+water': { id: 'mud', name: 'Mud', type: 'result' },
  'fire+water': { id: 'steam', name: 'Steam', type: 'result' },
  'earth+rain': { id: 'plant', name: 'Plant', type: 'result' },
};

function stableKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}+${y}`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function pickDaily(dateISO: string) {
  const rnd = seededRandom(dateISO);
  const starts = WORDS.filter(w => w.type === 'start');
  const goals = WORDS.filter(w => w.type === 'goal');
  const pick = (arr: WordItem[]) => arr[Math.floor(rnd() * arr.length)];
  const s1 = pick(starts), s2 = pick(starts);
  const goal = pick(goals);
  return { goal, startWords: [s1, s2] };
}

type Placed = { uid: number; id: string; name: string; type?: WordItem['type']; x: number; y: number; z: number };

export default function App() {
  const [screen, setScreen] = useState<'home' | 'game' | 'history' | 'howto' | 'settings'>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const scheme = useColorScheme();
  const [colorMode, setColorMode] = useState<'system' | 'light' | 'dark'>('system');
  const effectiveScheme = colorMode === 'system' ? scheme : colorMode;
  const isDark = effectiveScheme !== 'light';

  const [dateISO, setDateISO] = useState(getTodayISO());
  const daily = useMemo(() => pickDaily(dateISO), [dateISO]);
  const [discovered, setDiscovered] = useState<WordItem[]>(daily.startWords);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const nextUidRef = useRef(1);
  const [zCounter, setZCounter] = useState(1);
  const canvasRef = useRef<View>(null);
  const canvasRect = useRef<LayoutRectangle | null>(null);

  // drag ghost state
  const dragItemRef = useRef<WordItem | null>(null);
  const dragPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [dragging, setDragging] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragActiveRef = useRef(false);
  const { width } = useWindowDimensions();
  const isStacked = Platform.OS !== 'web' || width < 800; // มือถือ/จอแคบ: ใช้เลย์เอาต์บน-ล่าง

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
    if (!bySearch) return byLetter;
    return byLetter.filter(d => (d.name || d.id).toLowerCase().includes(bySearch));
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
    if (activeTab === 'recent') {
      return filteredAll.filter(d => recent.includes(d.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    }
    // When letter filter or search is active, show only filteredAll
    const hasLetterFilter = !!invFilter;
    const hasSearch = !!searchQuery.trim();
    if (hasLetterFilter || hasSearch) return filteredAll;
    // No filters: show filtered items first (which equals discovered) then the rest (none)
    const filteredIds = new Set(filteredAll.map(x => x.id));
    const rest = discovered.filter(d => !filteredIds.has(d.id));
    return [...filteredAll, ...rest];
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
    const fromRecipe = RECIPES[stableKey(aId, bId)];
    if (fromRecipe) return fromRecipe;
    const a = discovered.find(d => d.id === aId) || WORDS.find(w => w.id === aId);
    const b = discovered.find(d => d.id === bId) || WORDS.find(w => w.id === bId);
    if (!a || !b) return null;
    const name = `${a.name} ${b.name}`;
    const idBase = slugify(name) || `${aId}-${bId}`;
    let id = idBase; let n = 2;
    while (discovered.find(d => d.id === id)) { id = `${idBase}-${n++}`; }
    return { id, name, type: 'result' };
  };

  const combineIfOverlapByUid = (uidA: number) => {
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
        const result = findRecipe(a.id, b.id); if (!result) continue;
        const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
        const next: Placed[] = prev.filter((_, j) => j !== idxA && j !== i);
        const uid = nextUidRef.current++;
        // ให้ผลลัพธ์ลอยขึ้นมาด้านหน้าเพื่อมองเห็นชัด
        next.push({ uid, id: result.id, name: result.name, type: result.type, x: cx, y: cy, z: 99 });
        ensureInDiscovered(result);
        if (result.id === daily.goal.id) {
          Alert.alert('สำเร็จ!', `คุณสร้าง ${daily.goal.name} ได้แล้ว!`);
        }
        return next;
      }
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
        const result = findRecipe(dragItem.id, b.id); if (!result) continue;
        const cx = (x + b.x) / 2; const cy = (y + b.y) / 2;
        const next: Placed[] = prev.filter((_, j) => j !== i);
        const uid = nextUidRef.current++;
        next.push({ uid, id: result.id, name: result.name, type: result.type, x: cx, y: cy, z: 1 });
        ensureInDiscovered(result);
        if (result.id === daily.goal.id) {
          Alert.alert('สำเร็จ!', `คุณสร้าง ${daily.goal.name} ได้แล้ว!`);
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
    return (
      <SafeAreaView style={[homeStyles.container, isDark ? homeStylesDark.container : homeStylesLight.container]}>
        <View style={homeStyles.headerSpace} />
        <View style={homeStyles.centerWrap}>
          <Text style={[homeStyles.brand, isDark ? homeStylesDark.brand : homeStylesLight.brand]} selectable={false}>WORDCRAFT</Text>

          <View style={[homeStyles.card, isDark ? homeStylesDark.card : homeStylesLight.card]}>
            <Text style={[homeStyles.cardLabel, isDark ? homeStylesDark.cardLabel : homeStylesLight.cardLabel]} selectable={false}>Today's game:</Text>
            <Text style={[homeStyles.cardNumber, isDark ? homeStylesDark.cardNumber : homeStylesLight.cardNumber]} selectable={false}>#{gameNo}</Text>
            <TouchableOpacity style={[homeStyles.primaryBtn, isDark ? homeStylesDark.primaryBtn : homeStylesLight.primaryBtn]} onPress={() => setScreen('game')}>
              <Text style={[homeStyles.primaryBtnText, isDark ? homeStylesDark.primaryBtnText : homeStylesLight.primaryBtnText]} selectable={false}>Continue</Text>
            </TouchableOpacity>
          </View>

          <View style={homeStyles.menu}>
            <TouchableOpacity style={[homeStyles.menuItem, isDark ? homeStylesDark.menuItem : homeStylesLight.menuItem]} onPress={() => setScreen('history')}>
              <Text style={[homeStyles.menuText, isDark ? homeStylesDark.menuText : homeStylesLight.menuText]} selectable={false}>Previous games</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[homeStyles.menuItem, isDark ? homeStylesDark.menuItem : homeStylesLight.menuItem]} onPress={() => setScreen('howto')}>
              <Text style={[homeStyles.menuText, isDark ? homeStylesDark.menuText : homeStylesLight.menuText]} selectable={false}>How to play</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[homeStyles.menuItem, isDark ? homeStylesDark.menuItem : homeStylesLight.menuItem]} onPress={() => setScreen('settings')}>
              <Text style={[homeStyles.menuText, isDark ? homeStylesDark.menuText : homeStylesLight.menuText]} selectable={false}>Settings</Text>
            </TouchableOpacity>
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
          </View>
        )}
      </View>
      <View style={[styles.content, isStacked && styles.contentColumn]}>
        <View style={styles.leftPane}>
          <View
            style={[styles.canvas, isDark ? stylesDark.canvas : stylesLight.canvas]}
            ref={canvasRef}
            onLayout={onCanvasLayout}
          >
            {placed.map((p) => {
              const pan = makeDraggable(p.uid);
              return (
                <View
                  key={p.uid}
                  style={[styles.itemBubble, { left: p.x, top: p.y, zIndex: p.z }]}
                  {...pan.panHandlers}
                >
                  <Text style={styles.itemText} selectable={false} numberOfLines={1} ellipsizeMode="tail">{p.name}</Text>
                </View>
              );
            })}
          </View>
          <TouchableOpacity style={[styles.button, isDark ? stylesDark.button : stylesLight.button]} onPress={() => setPlaced([])}> 
            <Text style={[styles.buttonText, isDark ? stylesDark.buttonText : stylesLight.buttonText]} selectable={false}>Clear</Text>
          </TouchableOpacity>
        </View>
        {/* right pane removed */}
      </View>
      {/* Persistent Inventory Dock (always open) */}
      <View style={styles.inventoryDock}>
        <View style={styles.inventoryHeaderRow}>
          <Text style={[styles.sheetTitle, isDark ? stylesDark.sheetTitle : stylesLight.sheetTitle]} selectable={false}>Word</Text>
          <Text style={[styles.sheetClose, isDark ? stylesDark.sheetClose : stylesLight.sheetClose]} selectable={false}>{filteredAll.length} items</Text>
        </View>
        <View style={[styles.searchContainer, isDark ? stylesDark.searchContainer : stylesLight.searchContainer]}>
          <Text style={[styles.searchIcon, isDark ? stylesDark.searchIcon : stylesLight.searchIcon]} selectable={false}>🔍</Text>
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
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={[styles.searchClear, isDark ? stylesDark.searchClear : stylesLight.searchClear]} selectable={false}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.inventoryWrapHorizontal}>
          {tabItems.map(item => {
            const isFav = favorites.includes(item.id);
            return (
              <View key={item.id} style={styles.inventoryItemWrapper}> 
                <TouchableOpacity onPress={() => { spawnOnCanvas(item); ensureInDiscovered(item); pushRecent(item.id); }}>
                  <View style={[styles.item, item.type === 'start' && styles.itemStart, item.id === daily.goal.id && styles.itemGoal]}>
                    <Text selectable={false} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabRow]}>
          {(['all','recent'] as TabKey[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tabChip, isDark ? stylesDark.tabChip : stylesLight.tabChip]}
              onPress={() => {
                setActiveTab(t);
                if (t === 'all') setInvFilter(null);
              }}
            >
              <Text style={isDark ? stylesDark.alphaText : stylesLight.alphaText} selectable={false}>{t === 'all' ? 'All' : 'Recent'}</Text>
            </TouchableOpacity>
          ))}
          {letterKeys.length > 0 && (
            <>
              {letterKeys.map(ch => (
                <TouchableOpacity key={ch} style={[styles.alphaChip, isDark ? stylesDark.alphaChip : stylesLight.alphaChip]} onPress={() => setInvFilter(ch)}>
                  <Text style={isDark ? stylesDark.alphaText : stylesLight.alphaText} selectable={false}>{ch}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      </View>
      <View style={[styles.banner, isDark ? stylesDark.banner : stylesLight.banner]}>
        <AdMobBanner
          bannerSize="smartBannerPortrait"
          adUnitID="ca-app-pub-3940256099942544/6300978111"
          servePersonalizedAds
          onDidFailToReceiveAdWithError={(e) => console.log('Ad error', e)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1222', userSelect: 'none' as any, cursor: 'default' as any },
  header: { paddingHorizontal: 16, paddingVertical: 16, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.15)' },
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
  menuPanel: { position: 'absolute', right: 12, top: 44, backgroundColor: '#1a1e33', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  menuItemRow: { paddingHorizontal: 12, paddingVertical: 10 },
  menuItemText: { color: '#eef1ff' },
  content: { flex: 1, flexDirection: 'row' },
  contentColumn: { flexDirection: 'column' },
  leftPane: { flex: 1, padding: 12, position: 'relative', zIndex: 2 },
  rightPane: { width: 0, padding: 0, borderLeftWidth: 0, borderLeftColor: 'transparent', position: 'relative', zIndex: 1 },
  rightPaneFull: { width: 0, borderLeftWidth: 0, borderTopWidth: 0, borderTopColor: 'transparent' },
  controlsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  inventoryScroll: { },
  inventoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inventoryItemWrapper: { height: 48, marginRight: 8, justifyContent: 'center' },
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
  banner: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  // Persistent Inventory Dock styles
  inventoryDock: { paddingTop: 6, paddingHorizontal: 12, paddingBottom: 10, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTopWidth: 0, borderTopColor: 'transparent' },
  inventoryHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { color: '#eef1ff', fontWeight: '800', fontSize: 16 },
  sheetClose: { color: '#a8b0d4' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 12, marginBottom: 10, gap: 10, height: 44, width: '100%' },
  searchIcon: { color: '#a8b0d4', fontSize: 16 },
  searchInput: { flex: 1, color: '#eef1ff', height: 44, paddingVertical: 10, fontSize: 16, lineHeight: 24 },
  searchClear: { color: '#a8b0d4', fontSize: 14, paddingHorizontal: 6, paddingVertical: 2 },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tabChip: { backgroundColor: '#22283f', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, height: 28, justifyContent: 'center' },
  tabChipActive: { },
  alphaRow: { gap: 6, paddingBottom: 8 },
  alphaChip: { backgroundColor: '#22283f', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, height: 28, justifyContent: 'center' },
  alphaChipActive: { },
  alphaText: { color: '#eef1ff' },
  radioRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  radioChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  inventoryWrapHorizontal: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', paddingBottom: 4, height: 48 },
  sheetPeek: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingVertical: 6, zIndex: 9997 },
  sheetSwipeZone: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, zIndex: 9996 }
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
  banner: { borderTopColor: 'rgba(255,255,255,0.12)' },
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
  banner: { borderTopColor: 'rgba(0,0,0,0.12)' },
});

const homeStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fbf8ef' },
  headerSpace: { height: 0 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  brand: { fontSize: 36, fontWeight: '800', color: '#2a2a2a', letterSpacing: 2, marginBottom: 18, textTransform: 'uppercase' as any },
  card: { backgroundColor: '#ffffff', padding: 24, borderRadius: 16, width: '86%', maxWidth: 360, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.07, shadowOffset: { width: 0, height: 6 }, shadowRadius: 14, elevation: 2 },
  cardLabel: { color: '#585858', marginBottom: 8, fontSize: 16 },
  cardNumber: { color: '#1b1f2a', fontSize: 28, fontWeight: '800', marginBottom: 14 },
  primaryBtn: { backgroundColor: '#2b6cb0', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, alignSelf: 'stretch', alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
  menu: { width: '86%', maxWidth: 420, marginTop: 28 },
  menuItem: { backgroundColor: '#ffffff', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 1 },
  menuText: { color: '#3a3a3a', fontSize: 16 }
});

const homeStylesDark = StyleSheet.create({
  container: { backgroundColor: '#0f1222' },
  brand: { color: '#eef1ff' },
  card: { backgroundColor: '#151a33', shadowOpacity: 0.2 },
  cardLabel: { color: '#a8b0d4' },
  cardNumber: { color: '#eef1ff' },
  primaryBtn: { backgroundColor: '#2b6cb0' },
  primaryBtnText: { color: '#ffffff' },
  menuItem: { backgroundColor: '#151a33', shadowOpacity: 0.12 },
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
  menuItem: { backgroundColor: '#ffffff' },
  menuText: { color: '#3a3a3a' },
});
