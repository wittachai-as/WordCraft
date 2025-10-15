(() => {
  const STORAGE_KEY = 'wordcraft.v1';
  let zCounter = 10; // สำหรับยกชิ้นไอเท็มขึ้นด้านบนสุด
  const TODAY = new Date().toISOString().slice(0,10); // YYYY-MM-DD
  const URL_DATE = new URLSearchParams(location.search).get('date');
  const ACTIVE_DATE = URL_DATE || TODAY;

  /**
   * คลังคำเบื้องต้น: รวม start/goal และผลลัพธ์บางส่วนเพื่อ demo
   */
  const allWords = [
    { id: 'water', name: 'Water', type: 'start' },
    { id: 'fire', name: 'Fire', type: 'start' },
    { id: 'earth', name: 'Earth', type: 'start' },
    { id: 'air', name: 'Air', type: 'start' },
    { id: 'electricity', name: 'Electricity', type: 'goal' },
    { id: 'energy', name: 'Energy', type: 'result' },
    { id: 'steam', name: 'Steam', type: 'result' },
    { id: 'mud', name: 'Mud', type: 'result' },
    { id: 'plant', name: 'Plant', type: 'result' },
    { id: 'wire', name: 'Wire', type: 'result' },
    { id: 'metal', name: 'Metal', type: 'result' },
  ];

  /**
   * กำหนดสูตรผสมพื้นฐานบางส่วน (ไม่ใช้สูตรของต้นฉบับเพื่อหลีกเลี่ยงลิขสิทธิ์)
   * key ใช้รูปแบบ a+b ที่เรียงตามอักษรเพื่อความเป็นเอกภาพ
   */
  const recipes = {
    'air+earth': { id: 'dust', name: 'Dust', type: 'result' },
    'air+fire': { id: 'energy', name: 'Energy', type: 'result' },
    'air+water': { id: 'rain', name: 'Rain', type: 'result' },
    'earth+fire': { id: 'lava', name: 'Lava', type: 'result' },
    'earth+water': { id: 'mud', name: 'Mud', type: 'result' },
    'fire+water': { id: 'steam', name: 'Steam', type: 'result' },
    'earth+rain': { id: 'plant', name: 'Plant', type: 'result' },
    'fire+plant': { id: 'ash', name: 'Ash', type: 'result' },
    'plant+water': { id: 'algae', name: 'Algae', type: 'result' },
    'lava+water': { id: 'stone', name: 'Stone', type: 'result' },
    'stone+water': { id: 'sand', name: 'Sand', type: 'result' },
    'sand+fire': { id: 'glass', name: 'Glass', type: 'result' },
    // เส้นทางตัวอย่างสู่ goal
    'metal+wire': { id: 'electricity', name: 'Electricity', type: 'goal' },
    'energy+wire': { id: 'electricity', name: 'Electricity', type: 'goal' },
  };

  // RNG แบบ seed ตามวันที่ เพื่อสร้าง daily puzzle
  function seededRandom(seedStr) {
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    return () => (seed = (1103515245 * seed + 12345) % 2**31) / 2**31;
  }

  function getDailyPuzzle(dateStr) {
    const rnd = seededRandom(dateStr);
    const startPool = allWords.filter(w => w.type === 'start');
    const goalPool = allWords.filter(w => w.type === 'goal');
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const s1 = pick(startPool), s2 = pick(startPool);
    const goal = pick(goalPool);
    return { goalWord: goal, startWords: [s1, s2] };
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function loadState() {
    try {
      const json = localStorage.getItem(STORAGE_KEY);
      if (!json) return null;
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function stableKey(a, b) {
    const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
    return `${x}+${y}`;
  }

  function createItemElement(item, opts = { draggable: false }) {
    const tpl = document.getElementById('tpl-item');
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.textContent = item.name;
    el.dataset.id = item.id;
    el.dataset.type = item.type || 'result';
    el.draggable = Boolean(opts.draggable);
    if (opts.draggable) {
      el.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/plain', item.id);
        el.classList.add('ghost');
      });
      el.addEventListener('dragend', () => el.classList.remove('ghost'));
    }
    return el;
  }

  function renderCatalog(state) {
    const container = $('#catalog');
    container.innerHTML = '';
    const query = $('#search').value.trim().toLowerCase();
    let list = state.discovered
      .map((id) => state.idToItem[id])
      .filter(Boolean)
      .filter((it) => it.name.toLowerCase().includes(query));
    if (state.sort === 'az') list.sort((a,b) => a.name.localeCompare(b.name));
    if (state.sort === 'za') list.sort((a,b) => b.name.localeCompare(a.name));
    if (state.sort === 'recent') list = list.sort((a,b) => state.recentOrder.indexOf(b.id) - state.recentOrder.indexOf(a.id));
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'ยังไม่มีผลลัพธ์ตามคำค้น';
      container.appendChild(empty);
      return;
    }
    for (const item of list) {
      const el = createItemElement(item, { draggable: true });
      if (item.type === 'start') el.classList.add('start');
      if (item.id === state.goalId) el.classList.add('goal');
      if (state.newIds && state.newIds.includes(item.id)) {
        el.classList.add('new');
        setTimeout(() => { el.classList.remove('new'); }, 1500);
      }
      el.addEventListener('dblclick', () => spawnOnBoard(item));
      container.appendChild(el);
    }
    if (state.newIds && state.newIds.length) {
      state.newIds = [];
      saveState(state);
    }
  }

  function spawnOnBoard(item, x = 80 + Math.random() * 400, y = 80 + Math.random() * 300) {
    const canvas = $('#board');
    const el = createItemElement(item, { draggable: false });
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.zIndex = String(++zCounter);
    enableBoardDrag(el);
    canvas.appendChild(el);
    return el;
  }

  function enableBoardDrag(el) {
    let offsetX = 0, offsetY = 0, dragging = false;
    function onPointerDown(e) {
      dragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      el.setPointerCapture(e.pointerId);
      // ยกขึ้นบนสุดเมื่อเริ่มลาก
      el.style.zIndex = String(++zCounter);
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const parentRect = el.parentElement.getBoundingClientRect();
      const x = e.clientX - parentRect.left - offsetX;
      const y = e.clientY - parentRect.top - offsetY;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
    function onPointerUp(e) {
      dragging = false;
      el.releasePointerCapture(e.pointerId);
      // ตรวจจับชนกับไอเท็มอื่น ๆ บนบอร์ดเพื่อผสม
      tryCombine(el);
    }
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
  }

  function rectsOverlap(a, b) {
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }

  function tryCombine(el) {
    const idA = el.dataset.id;
    const rectA = el.getBoundingClientRect();
    const others = $$('#board .item').filter((n) => n !== el);
    for (const other of others) {
      const idB = other.dataset.id;
      const rectB = other.getBoundingClientRect();
      if (!rectsOverlap(rectA, rectB)) continue;
      const result = lookupRecipe(idA, idB);
      if (!result) {
        const newItem = synthesizeResult(idA, idB);
        if (newItem) {
          const out = spawnOnBoard(newItem);
          out.style.zIndex = String(++zCounter);
          state.combineCount++;
          // เอฟเฟกต์แสงวาบ
          const flash = document.getElementById('flash');
          if (flash) {
            flash.classList.remove('show');
            // force reflow
            void flash.offsetWidth;
            flash.classList.add('show');
          }
          // เพิ่มเข้าคลังถ้ายังไม่เคยค้นพบ (ต้อง map id -> item ด้วย)
          if (!state.discovered.includes(newItem.id)) {
            state.idToItem[newItem.id] = { id: newItem.id, name: newItem.name, type: newItem.type || 'result' };
            state.discovered.push(newItem.id);
            state.recentOrder.push(newItem.id);
            state.newIds = state.newIds || [];
            state.newIds.push(newItem.id);
            renderCatalog(state);
            saveState(state);
          }
          // ตรวจชนะเมื่อได้คำเท่ากับ goal
          if (newItem.id === state.goalId) {
            showWinModal();
          }
          // ทำ chain ต่อได้ถ้าชนอีกชิ้น
          requestAnimationFrame(() => tryCombine(out));
        }
      } else {
        // แสดงผลบนบอร์ด ณ ตำแหน่งเฉลี่ย
        const parentRect = el.parentElement.getBoundingClientRect();
        const cx = (rectA.left + rectB.left) / 2 - parentRect.left;
        const cy = (rectA.top + rectB.top) / 2 - parentRect.top;
        // ลบของเดิม
        el.remove();
        other.remove();
        const out = spawnOnBoard(result, cx, cy);
        out.style.zIndex = String(++zCounter);
        state.combineCount++;
        // เอฟเฟกต์แสงวาบ
        const flash = document.getElementById('flash');
        if (flash) {
          flash.classList.remove('show');
          // force reflow
          void flash.offsetWidth;
          flash.classList.add('show');
        }
        // เพิ่มเข้าคลังถ้ายังไม่เคยค้นพบ (ต้อง map id -> item ด้วย)
        if (!state.discovered.includes(result.id)) {
          state.idToItem[result.id] = { id: result.id, name: result.name, type: result.type || 'result' };
          state.discovered.push(result.id);
          state.recentOrder.push(result.id);
          state.newIds = state.newIds || [];
          state.newIds.push(result.id);
          renderCatalog(state);
          saveState(state);
        }
        // ตรวจชนะเมื่อได้คำเท่ากับ goal
        if (result.id === state.goalId) {
          showWinModal();
        }
        // ทำ chain ต่อได้ถ้าชนอีกชิ้น
        requestAnimationFrame(() => tryCombine(out));
      }
      break;
    }
  }

  function lookupRecipe(aId, bId) {
    const key = stableKey(aId, bId);
    const out = recipes[key] || (state.dynamicRecipes && state.dynamicRecipes[key]);
    if (!out) return null;
    return state.idToItem[out.id] || out; // ใช้ object เดิมถ้ามี
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function ensureUniqueId(baseId) {
    let id = baseId;
    let n = 2;
    while (state.idToItem[id]) {
      id = `${baseId}-${n++}`;
    }
    return id;
  }

  function synthesizeResult(aId, bId) {
    const a = state.idToItem[aId];
    const b = state.idToItem[bId];
    if (!a || !b) return null;
    const name = `${a.name} ${b.name}`;
    const baseId = slugify(name) || `${aId}-${bId}`;
    const id = ensureUniqueId(baseId);
    const item = { id, name, type: 'result' };
    const key = stableKey(aId, bId);
    state.dynamicRecipes = state.dynamicRecipes || {};
    state.dynamicRecipes[key] = { id: item.id, name: item.name, type: 'result' };
    return item;
  }

  function resetProgress() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  // สถานะหลักของเกม + โจทย์รายวัน
  const persisted = loadState();
  const daily = getDailyPuzzle(ACTIVE_DATE);
  const goalWordEl = document.getElementById('goal-word');
  if (goalWordEl) goalWordEl.textContent = daily.goalWord.name;
  const baseItems = daily.startWords;
  const state = persisted || {
    idToItem: Object.fromEntries(baseItems.map((i) => [i.id, i])),
    discovered: baseItems.map((i) => i.id),
    goalId: daily.goalWord.id,
    sort: 'recent',
    recentOrder: [...baseItems.map(i => i.id)],
    newIds: [],
    dynamicRecipes: {},
    startedAt: Date.now(),
    combineCount: 0,
  };
  if (!state.dynamicRecipes) state.dynamicRecipes = {};

  // bind UI
  $('#search').addEventListener('input', () => renderCatalog(state));
  $('#reset').addEventListener('click', resetProgress);
  const sortSel = document.getElementById('sort');
  if (sortSel) sortSel.addEventListener('change', (e) => { state.sort = e.target.value; renderCatalog(state); saveState(state); });

  // Nav & Modals
  const open = (id) => { const m = document.getElementById(id); if (m) m.classList.remove('hidden'); };
  const close = (id) => { const m = document.getElementById(id); if (m) m.classList.add('hidden'); };
  const btn = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  btn('nav-howto', () => open('modal-howto'));
  btn('close-howto', () => close('modal-howto'));
  btn('nav-settings', () => open('modal-settings'));
  btn('close-settings', () => close('modal-settings'));
  btn('nav-previous', () => {
    const input = document.getElementById('pick-date');
    if (input) input.value = ACTIVE_DATE;
    open('modal-previous');
  });
  btn('close-previous', () => close('modal-previous'));
  btn('nav-today', () => location.reload());
  const loadDateBtn = document.getElementById('load-date');
  if (loadDateBtn) loadDateBtn.addEventListener('click', () => {
    const val = document.getElementById('pick-date').value;
    if (val) {
      const url = new URL(location.href);
      url.searchParams.set('date', val);
      location.href = url.toString();
    }
  });

  // Settings: Dark mode + Sound (mock)
  const DARK_KEY = 'wordcraft.dark';
  const SOUND_KEY = 'wordcraft.sound';
  const setDark = (on) => { document.documentElement.dataset.theme = on ? 'dark' : 'light'; };
  const darkPref = localStorage.getItem(DARK_KEY);
  setDark(darkPref === '1');
  const darkToggle = document.getElementById('toggle-dark');
  if (darkToggle) {
    darkToggle.checked = darkPref === '1';
    darkToggle.addEventListener('change', (e) => {
      const on = e.target.checked; setDark(on); localStorage.setItem(DARK_KEY, on ? '1' : '0');
    });
  }
  const soundPref = localStorage.getItem(SOUND_KEY) ?? '1';
  const soundToggle = document.getElementById('toggle-sound');
  if (soundToggle) {
    soundToggle.checked = soundPref === '1';
    soundToggle.addEventListener('change', (e) => localStorage.setItem(SOUND_KEY, e.target.checked ? '1' : '0'));
  }

  function playSfx() {
    const enabled = (localStorage.getItem(SOUND_KEY) ?? '1') === '1';
    if (!enabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 660; // ฟุ้บ
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      o.start(); o.stop(ctx.currentTime + 0.2);
    } catch {}
  }


  // รองรับลากจากแคตตาล็อกมาวางบนกระดาน (HTML5 DnD)
  const boardEl = $('#board');
  boardEl.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  boardEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const item = state.idToItem[id];
    if (!item) return;
    const rect = boardEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    spawnOnBoard(item, x, y);
  });

  // bootstrap
  renderCatalog(state);
  // วาง base items บนบอร์ดให้เห็นตัวอย่าง
  baseItems.forEach((it, idx) => spawnOnBoard(it, 120 + idx * 120, 160));

  // บันทึกสถานะครั้งแรกถ้ายังไม่มี
  if (!persisted) saveState(state);

  // ปุ่มล้างกระดาน
  const clearBtn = document.getElementById('board-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    $$('#board .item').forEach(n => n.remove());
  });

  // Modal ชนะ + แชร์ (จำลอง interstitial)
  function showWinModal() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    const elapsedMs = Date.now() - (state.startedAt || Date.now());
    const sec = Math.round(elapsedMs / 1000);
    const stats = document.getElementById('win-stats');
    if (stats) stats.textContent = `เวลาที่ใช้: ${sec}s | จำนวนการผสม: ${state.combineCount}`;
    modal.classList.remove('hidden');
    const shareBtn = document.getElementById('share');
    const closeBtn = document.getElementById('close-modal');
    const adC = document.getElementById('ad-countdown');
    let t = 3;
    if (shareBtn) shareBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;
    if (adC) adC.textContent = `Ad ends in ${t}…`;
    const itv = setInterval(() => {
      t--;
      if (adC) adC.textContent = `Ad ends in ${t}…`;
      if (t <= 0) {
        clearInterval(itv);
        if (shareBtn) shareBtn.disabled = false;
        if (closeBtn) closeBtn.disabled = false;
        if (adC) adC.textContent = '';
      }
    }, 1000);
  }
  const closeModalBtn = document.getElementById('close-modal');
  if (closeModalBtn) closeModalBtn.addEventListener('click', () => {
    const modal = document.getElementById('modal');
    if (modal) modal.classList.add('hidden');
  });
  const shareBtn = document.getElementById('share');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const text = `WordCraft ${TODAY}\nGoal: ${state.idToItem[state.goalId]?.name || ''}\nFound: ${state.discovered.length} words`;
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      alert('คัดลอก/แชร์ผลลัพธ์แล้ว');
    } catch (_) {}
  });
})();


