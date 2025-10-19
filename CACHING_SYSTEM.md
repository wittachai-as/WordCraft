# 🗄️ Caching System - WordCraft

## 📋 ภาพรวม

ระบบ caching ของ WordCraft ใช้ **2-tier cache**:
1. **Memory Cache** (Local, เร็วมาก)
2. **Firebase Global Recipes** (Shared, persistent)

---

## 🔄 ระบบทำงาน

### การผสมคำครั้งแรก (First Player)

```
Player 1: "fire" + "water"
    ↓
[1] ตรวจสอบ Memory Cache
    ❌ ไม่พบ
    ↓
[2] ตรวจสอบ Firebase Global Recipes
    ❌ ไม่พบ (loading in background...)
    ↓
[3] ใช้ AI สร้างคำใหม่
    ✅ Result: "Steam"
    ↓
[4] บันทึกลง Memory Cache
    ✅ Cached: fire+water = Steam
    ↓
[5] บันทึกลง Firebase (async, non-blocking)
    ✅ Synced to Firestore
```

### การผสมคำครั้งถัดไป (Other Players)

```
Player 2: "fire" + "water"
    ↓
[1] ตรวจสอบ Memory Cache
    ✅ พบ! fire+water = Steam
    ↓
[2] Return จาก Cache
    ⚡ เร็วมาก (< 1ms)
    ❌ ไม่ต้องเรียก AI
```

หรือถ้า server restart:

```
Player 3: "fire" + "water" (after restart)
    ↓
[1] ตรวจสอบ Memory Cache
    ❌ ว่างเปล่า (server เพิ่ง restart)
    ↓
[2] Load Firebase Global Recipes (background)
    ✅ พบ! fire+water = Steam
    ↓
[3] Update Memory Cache
    ✅ Cached: fire+water = Steam
    ↓
[4] Return จาก Cache
    ⚡ เร็ว (ไม่ต้องเรียก AI)
```

---

## 🏗️ สถาปัตยกรรม

### Memory Cache (In-Process)
```python
_global_recipes_cache: Dict[str, str] = {}

# Structure:
{
  "fire+water": "Steam",
  "earth+rain": "Mud",
  "air+fire": "Energy",
  ...
}
```

**คุณสมบัติ:**
- ⚡ เร็วมาก (< 1ms)
- 🔄 หายเมื่อ restart
- 📍 Local per server instance

### Firebase Global Recipes (Persistent)
```javascript
// Firestore collection: global_recipes/all
{
  recipes: {
    "fire+water": "Steam",
    "earth+rain": "Mud",
    ...
  },
  updated_at: Timestamp
}
```

**คุณสมบัติ:**
- 💾 Persistent (ไม่หาย)
- 🌐 Shared ระหว่างทุก server instances
- 🔄 Sync แบบ eventually consistent

---

## ⚡ Performance Optimizations

### 1. Lazy Loading (Non-Blocking Startup)

```python
def load_global_recipes():
    if _global_recipes_cache is None:
        _global_recipes_cache = {}  # Start empty (fast!)
        
        # Load from Firebase in background thread
        threading.Thread(
            target=load_in_background,
            daemon=True
        ).start()
    
    return _global_recipes_cache
```

**ผลลัพธ์:**
- ✅ Server startup เร็ว (< 2s)
- ✅ ไม่ block API requests
- ✅ Firebase load แบบ background

### 2. Async Save (Non-Blocking Write)

```python
def save_global_recipes():
    # Run in background thread
    threading.Thread(
        target=save_async,
        daemon=True
    ).start()  # Returns immediately
```

**ผลลัพธ์:**
- ✅ API response เร็ว
- ✅ ไม่รอ Firebase write
- ✅ Eventually consistent

### 3. Timeout Protection

```python
# Load with timeout
doc = doc_ref.get(timeout=5.0)

# Save with timeout
doc_ref.set(data, timeout=10.0)
```

**ผลลัพธ์:**
- ✅ ไม่ค้างถ้า Firebase ช้า
- ✅ Graceful degradation
- ✅ Local cache ยังใช้ได้

---

## 📊 Performance Metrics

| Operation | Without Cache | With Memory Cache | With Firebase Cache |
|-----------|---------------|-------------------|---------------------|
| First combination | ~100-200 ms (AI) | ~100-200 ms (AI) | ~100-200 ms (AI) |
| Same combination (same session) | ~100-200 ms | **< 1 ms** ✨ | **< 1 ms** ✨ |
| Same combination (new session) | ~100-200 ms | ~100-200 ms | **< 1 ms** ✨ |

**Cache Hit Rate (คาดการณ์):**
- วันแรก: ~10-20% (คำใหม่ๆ)
- สัปดาห์แรก: ~50-70% (เริ่มมีคำซ้ำ)
- เดือนแรก: ~80-90% (คำส่วนใหญ่ถูกแคชแล้ว)

---

## 🛡️ Error Handling

### Firebase ไม่พร้อมใช้งาน

```python
# System continues to work with local cache only
try:
    load_from_firebase()
except Exception as e:
    print("⚠️ Firebase unavailable, using local cache")
    # API ยังทำงานได้ปกติ
```

### Firebase Timeout

```python
# Load with timeout
doc = doc_ref.get(timeout=5.0)  # Max 5 seconds

# Save with timeout  
doc_ref.set(data, timeout=10.0)  # Max 10 seconds
```

### Memory Cache Full

```
# ไม่มีปัญหา - Python dict ไม่มี size limit
# แต่ควร monitor memory usage ในอนาคต
```

---

## 🔄 Cache Consistency

### Eventually Consistent Model

```
Time    | Server A          | Server B          | Firebase
--------|-------------------|-------------------|----------
T0      | fire+water → AI   | -                 | -
T1      | fire+water=Steam  | -                 | -
T2      | Saving...         | -                 | -
T3      | fire+water=Steam  | fire+water → AI?  | fire+water=Steam
T4      | fire+water=Steam  | Loading...        | fire+water=Steam
T5      | fire+water=Steam  | fire+water=Steam  | fire+water=Steam
```

**หมายเหตุ:**
- ผู้เล่นอาจได้คำต่างกันในช่วง T1-T5 (rare case)
- แต่หลัง T5 จะได้คำเดียวกันทุกคน
- Trade-off: Performance vs Consistency

---

## 🎯 Benefits

### สำหรับผู้เล่น:
- ⚡ **เร็วขึ้น**: คำที่ถูกแคชแล้วได้ผลทันที (< 1ms)
- 🎮 **สม่ำเสมอ**: ผู้เล่นทุกคนได้คำเดียวกัน
- 📉 **ลด Load**: ไม่ต้องเรียก AI ทุกครั้ง

### สำหรับระบบ:
- 💰 **ประหยัด**: ลด AI computation cost
- 🚀 **Scale ได้**: Cache hit rate สูง = handle ผู้เล่นได้มากขึ้น
- 💾 **Reliable**: Firebase backup ถ้า server crash

---

## 📝 Code Example

### บันทึกผลลัพธ์

```python
@app.post("/combine")
def combine(req: CombineRequest):
    # 1. เช็ค cache ก่อน
    cached = get_cached_result(req.a, req.b)
    if cached:
        return {"name": cached, "source": "cache"}  # เร็ว!
    
    # 2. ใช้ AI สร้างใหม่
    name = pick_candidate(req.a, req.b, model)
    
    # 3. บันทึกลง cache (memory + Firebase)
    cache_result(req.a, req.b, name)
    
    return {"name": name, "source": "ai"}
```

### ตรวจสอบ cache

```python
# เช็คว่ามีใน cache หรือยัง
cached_result = get_cached_result("fire", "water")

if cached_result:
    print(f"✅ Found in cache: {cached_result}")
else:
    print("❌ Not in cache, will use AI")
```

---

## 🔍 Monitoring

### ตรวจสอบสถานะ Cache

```bash
curl http://localhost:8099/health

# Response:
{
  "status": "ok",
  "vocab": 999994,
  "recipe_cache_size": 0,      # Firebase recipes
  "vocab_cache_ready": true,   # Vocabulary cache
  "vocab_cache_size": 173218   # Filtered words
}
```

### Log Messages

```
[CACHE] Started with empty cache, loading from Firebase in background...
[FIREBASE] Loading recipes in background...
[FIREBASE] ✅ Loaded 150 recipes from Firestore
[CACHE] Saved: fire + water = Steam (syncing to Firebase...)
[FIREBASE] ✅ Saved 151 recipes to Firestore
```

---

## ✨ สรุป

**ระบบ Caching ใน WordCraft:**

1. 🚀 **Fast**: Memory cache ทำให้ API เร็วมาก (< 1ms)
2. 💾 **Persistent**: Firebase เก็บ recipes ถาวร
3. 🌐 **Shared**: ผู้เล่นทุกคนแชร์ recipes เดียวกัน
4. ⚡ **Non-blocking**: ไม่ block API performance
5. 🛡️ **Resilient**: ทำงานได้แม้ Firebase ล่ม

**Trade-off:**
- Consistency: Eventually consistent (ยอมรับได้)
- Complexity: เพิ่มขึ้นนิดหน่อย (คุ้มค่า)
- Memory: ใช้ RAM เพิ่มขึ้น (ไม่เยอะ ~1-10 MB)

🎯 **Result**: เกมเร็วขึ้น, scale ได้ดีขึ้น, ผู้เล่นมีประสบการณ์ที่ดีขึ้น!

