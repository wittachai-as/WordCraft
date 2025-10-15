import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, PanResponder, LayoutRectangle, Animated, Platform, useWindowDimensions, ScrollView, TextInput } from 'react-native';
import { AdMobBanner } from 'expo-ads-admob';

type WordItem = { id: string; name: string; type?: 'start' | 'goal' | 'result' };

function getTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const SHEET_HEIGHT = 480;
  const sheetTranslateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
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
  type TabKey = 'all' | 'favorites' | 'recent';
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const tabItems = useMemo(() => {
    if (activeTab === 'favorites') return favoriteItems;
    if (activeTab === 'recent') return filteredAll.filter(d => recent.includes(d.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    return filteredAll;
  }, [activeTab, favoriteItems, filteredAll, recent]);

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

  const spawnOnCanvas = (item: WordItem, x?: number, y?: number) => {
    const nx = x ?? 40 + Math.random() * 140;
    const ny = y ?? 40 + Math.random() * 140;
    const uid = nextUidRef.current++;
    // ให้ไอเท็มใหม่อยู่หน้ากว่าไอเท็มปกติเล็กน้อย
    setPlaced(prev => [...prev, { uid, id: item.id, name: item.name, type: item.type, x: nx, y: ny, z: 2 }]);
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}> 
        <Text style={styles.title} selectable={false}>WordCraft</Text>
        <Text style={styles.goal} selectable={false}>Goal: <Text style={styles.goalStrong} selectable={false}>{daily.goal.name}</Text></Text>
      </View>
      <View style={[styles.content, isStacked && styles.contentColumn]}>
        <View style={styles.leftPane}>
          <View
            style={styles.canvas}
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
          <TouchableOpacity style={styles.button} onPress={() => setPlaced([])}> 
            <Text style={styles.buttonText} selectable={false}>Clear</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.rightPane, isStacked && styles.rightPaneFull]}>
          <View style={styles.controlsRow} />
          <View>
            <TouchableOpacity style={styles.openSheetButton} onPress={openSheet}>
              <Text style={styles.buttonText} selectable={false}>Open Inventory</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {/* Bottom Sheet Overlay */}
      {sheetOpen && (
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={styles.backdropTouchable} activeOpacity={1} onPress={closeSheet} />
          <Animated.View style={[styles.bottomSheet, { transform: [{ translateY: sheetTranslateY }] }]}>
            <View style={styles.sheetHandle} {...sheetDrag.panHandlers}>
              <View style={styles.sheetGrabber} />
            </View>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} selectable={false}>Inventory</Text>
              <TouchableOpacity onPress={closeSheet}><Text style={styles.sheetClose} selectable={false}>Close</Text></TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Search..."
              placeholderTextColor="#a8b0d4"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <View style={styles.tabRow}>
              {(['all','favorites','recent'] as TabKey[]).map(t => (
                <TouchableOpacity key={t} style={[styles.tabChip, activeTab === t && styles.tabChipActive]} onPress={() => setActiveTab(t)}>
                  <Text selectable={false}>{t === 'all' ? 'All' : t === 'favorites' ? 'Favorites' : 'Recent'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <View style={styles.inventoryWrap}>
                {tabItems.map(item => {
                  const isFav = favorites.includes(item.id);
                  return (
                    <TouchableOpacity key={item.id} style={styles.inventoryItemWrapper} onPress={() => { spawnAtCanvasCenter(item); }}>
                      <View style={[styles.item, item.type === 'start' && styles.itemStart, item.id === daily.goal.id && styles.itemGoal]}>
                        <Text selectable={false} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                      </View>
                      <TouchableOpacity style={styles.favBtn} onPress={() => toggleFavorite(item.id)}>
                        <Text selectable={false}>{isFav ? '★' : '☆'}</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      )}
      {!sheetOpen && (
        <View style={styles.sheetSwipeZone} {...peekDrag.panHandlers} />
      )}
      {dragging && dragItemRef.current && (
        <Animated.View
          style={[styles.dragGhostOverlay, { transform: [{ translateX: dragPos.x }, { translateY: dragPos.y }] }] }
          pointerEvents="none"
        >
          <Text style={styles.itemText} selectable={false} numberOfLines={1} ellipsizeMode="tail">{dragItemRef.current.name}</Text>
        </Animated.View>
      )}
      <View style={styles.banner}>
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
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.15)' },
  title: { color: '#eef1ff', fontSize: 20, fontWeight: '800' },
  goal: { color: '#a8b0d4', marginTop: 6 },
  goalStrong: { color: '#7affb2', fontWeight: '700' },
  content: { flex: 1, flexDirection: 'row' },
  contentColumn: { flexDirection: 'column' },
  leftPane: { flex: 1, padding: 12, position: 'relative', zIndex: 2 },
  rightPane: { width: 280, padding: 12, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.12)', position: 'relative', zIndex: 1 },
  rightPaneFull: { width: '100%', borderLeftWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  controlsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  inventoryScroll: { },
  inventoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inventoryItemWrapper: {},
  item: { backgroundColor: '#fff', padding: 10, borderRadius: 10, alignSelf: 'flex-start', userSelect: 'none' as any, cursor: 'default' as any },
  itemStart: { borderWidth: 2, borderColor: 'gold' },
  itemGoal: { borderWidth: 2, borderColor: '#7affb2' },
  button: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.08)', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#eef1ff' },
  canvas: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, position: 'relative', overflow: 'hidden', zIndex: 99, userSelect: 'none' as any, cursor: 'default' as any },
  itemBubble: { position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1, userSelect: 'none' as any, cursor: 'default' as any, maxWidth: '90%' },
  itemText: { color: '#101226', flexShrink: 1 },
  dragGhost: { position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1, opacity: 0.95, zIndex: 9999, elevation: 10, userSelect: 'none' as any, cursor: 'default' as any },
  dragGhostOverlay: { position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1, opacity: 0.95, zIndex: 99999, elevation: 20, userSelect: 'none' as any, cursor: 'default' as any, left: 0, top: 0 },
  banner: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  // Bottom Sheet styles
  sheetBackdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 9998, justifyContent: 'flex-end' },
  backdropTouchable: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  bottomSheet: { backgroundColor: '#0f1222', paddingTop: 6, paddingHorizontal: 12, paddingBottom: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetHandle: { alignItems: 'center', paddingVertical: 6 },
  sheetGrabber: { width: 44, height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 6 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { color: '#eef1ff', fontWeight: '800', fontSize: 16 },
  sheetClose: { color: '#a8b0d4' },
  searchInput: { backgroundColor: 'rgba(255,255,255,0.08)', color: '#eef1ff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10 },
  sectionHeader: { color: '#a8b0d4', marginBottom: 6, marginTop: 4 },
  openSheetButton: { backgroundColor: 'rgba(255,255,255,0.08)', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  favBtn: { marginTop: 4, alignSelf: 'flex-end' },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tabChip: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  tabChipActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  sheetPeek: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingVertical: 6, zIndex: 9997 },
  sheetSwipeZone: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 28, zIndex: 9996 }
});
