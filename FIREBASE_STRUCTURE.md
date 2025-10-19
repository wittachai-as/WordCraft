# Firebase Firestore Structure

## 📊 Collections Overview

### 1. `puzzles` Collection
เก็บข้อมูลโจทย์แต่ละวัน

**Path:** `puzzles/{date}`

**Document ID:** `YYYY-MM-DD` (เช่น `2025-10-19`)

**Fields:**
```typescript
{
  goalWord: string;           // คำเป้าหมาย เช่น "Electricity"
  startWords: string[];       // คำเริ่มต้น เช่น ["Water", "Earth"]
  recipes?: {                 // สูตรผสมคำที่คำนวณไว้ล่วงหน้า
    [key: string]: {
      id: string;
      name: string;
      type?: 'start' | 'goal' | 'result';
    }
  };
  createdAt?: Timestamp;
}
```

---

### 2. `global_recipes` Collection
เก็บสูตรผสมคำทั้งหมด (ใช้ร่วมกันระหว่างผู้เล่นทั้งหมด)

**Path:** `global_recipes/all`

**Fields:**
```typescript
{
  recipes: {
    [combination: string]: string;  // "word1+word2" → "Result"
  };
  updated_at: Timestamp;
}
```

**Example:**
```json
{
  "recipes": {
    "water+earth": "Mud",
    "fire+water": "Steam",
    "regulate+citizenship": "Authority"
  }
}
```

---

### 3. `users` Collection (NEW - v2 Structure)
เก็บข้อมูลผู้เล่นและประวัติการเล่น **แบบแยก user**

**Path:** `users/{uid}`

**Document ID:** Guest User ID (เช่น `guest_1729389207123_abc123xyz`)

**Fields:**
```typescript
{
  createdAt?: Timestamp;
  lastActiveAt?: Timestamp;
}
```

#### Subcollection: `plays`
เก็บประวัติการผสมคำของแต่ละ user

**Path:** `users/{uid}/plays/{playId}`

**Document ID:** `{puzzleId}_{timestamp}_{random}` (เช่น `2025-10-19_1729389207123_abc123xyz`)

**Fields:**
```typescript
{
  puzzleId: string;          // วันที่โจทย์ (YYYY-MM-DD)
  a: string;                 // คำแรกที่ใช้ผสม
  b: string;                 // คำที่สองที่ใช้ผสม
  resultId: string | null;   // ID ของผลลัพธ์ (slug format)
  resultName: string | null; // ชื่อของผลลัพธ์ที่แสดง
  playedAt: Timestamp;       // เวลาที่ผสม (จาก client)
  syncedAt: Timestamp;       // เวลาที่ sync ขึ้น Firebase (server timestamp)
}
```

**Example Document:**
```json
{
  "puzzleId": "2025-10-19",
  "a": "water",
  "b": "earth",
  "resultId": "mud",
  "resultName": "Mud",
  "playedAt": "2025-10-19T12:34:56.789Z",
  "syncedAt": "2025-10-19T12:34:57.123Z"
}
```

---

## 🔄 Migration: Old vs New Structure

### Old Structure (v1 - Deprecated)
```
plays/ (collection)
  ├─ user1_puzzle1_ts1_abc (document)
  │   └─ { uid, puzzleId, a, b, resultId, ... }
  ├─ user2_puzzle1_ts2_def (document)
  │   └─ { uid, puzzleId, a, b, resultId, ... }
  └─ user1_puzzle2_ts3_ghi (document)
      └─ { uid, puzzleId, a, b, resultId, ... }
```

**ปัญหา:**
- ❌ ทุก user รวมอยู่ใน collection เดียวกัน
- ❌ ต้อง filter by `uid` ในทุก query
- ❌ ยากต่อการตั้ง Security Rules
- ❌ ยากต่อการวิเคราะห์ข้อมูลแยก user

---

### New Structure (v2 - Current)
```
users/ (collection)
  ├─ guest_123_abc (document)
  │   └─ plays/ (subcollection)
  │       ├─ 2025-10-19_1729389207123_xyz (document)
  │       │   └─ { puzzleId, a, b, resultId, ... }
  │       └─ 2025-10-19_1729389307456_abc (document)
  │           └─ { puzzleId, a, b, resultId, ... }
  └─ guest_456_def (document)
      └─ plays/ (subcollection)
          ├─ 2025-10-19_1729389407789_mno (document)
          │   └─ { puzzleId, a, b, resultId, ... }
          └─ 2025-10-20_1729475807012_pqr (document)
              └─ { puzzleId, a, b, resultId, ... }
```

**ข้อดี:**
- ✅ แยกข้อมูลแต่ละ user อย่างชัดเจน
- ✅ Query เร็วขึ้น (ไม่ต้อง filter by uid)
- ✅ Security Rules ตั้งง่าย (user เข้าถึงได้แค่ของตัวเอง)
- ✅ Scalable สำหรับผู้เล่นจำนวนมาก
- ✅ วิเคราะห์ข้อมูลต่อ user ได้ง่าย

---

## 🔐 Security Rules (Recommended)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Public read for puzzles
    match /puzzles/{puzzleId} {
      allow read: if true;
      allow write: if false; // Only backend can write
    }
    
    // Public read/write for global recipes
    match /global_recipes/{document=**} {
      allow read: if true;
      allow write: if true; // AI service writes here
    }
    
    // User-specific plays (NEW)
    match /users/{userId}/plays/{playId} {
      // Users can only read/write their own plays
      allow read, write: if request.auth != null && request.auth.uid == userId
                        || userId.matches('guest_.*'); // Allow guest users
    }
    
    // Legacy plays collection (deprecated, keep for migration)
    match /plays/{playId} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

---

## 📝 Query Examples

### Get all plays for a specific user and puzzle
```typescript
const userPlaysRef = collection(db, 'users', uid, 'plays');
const q = query(userPlaysRef, where('puzzleId', '==', '2025-10-19'));
const snapshot = await getDocs(q);
```

### Get recent plays for a user (any puzzle)
```typescript
const userPlaysRef = collection(db, 'users', uid, 'plays');
const q = query(
  userPlaysRef, 
  orderBy('playedAt', 'desc'),
  limit(50)
);
const snapshot = await getDocs(q);
```

### Count total plays for a user
```typescript
const userPlaysRef = collection(db, 'users', uid, 'plays');
const snapshot = await getDocs(userPlaysRef);
const totalPlays = snapshot.size;
```

---

## 🚀 Implementation Status

- ✅ **Guest User System**: สร้าง guest ID และเก็บใน AsyncStorage
- ✅ **New Structure**: `users/{uid}/plays/{playId}`
- ✅ **Sync Function**: `syncHistory()` ใน `mobile/storage/syncHistory.ts`
- ✅ **Debug Logs**: เพิ่ม comprehensive logging
- ⏳ **Migration**: ยังไม่ได้ migrate ข้อมูลเก่า (ถ้ามี)

---

## 🐛 Debugging

ตรวจสอบ logs เหล่านี้เพื่อดูว่า sync ทำงานหรือไม่:

1. **Guest User Initialization:**
   ```
   🚀 [AUTH] Initializing guest user...
   👤 [AUTH] Created new guest user: guest_...
   ✅ [AUTH] Guest user initialized in state: guest_...
   ```

2. **Play Sync:**
   ```
   🔄 Attempting to sync history, guestUserId: guest_...
   [SYNC] Starting sync for puzzle 2025-10-19, user: guest_...
   [SYNC] Found 1 pending plays to sync
   [SYNC] Committing batch with 1 plays...
   ✅ [SYNC] Successfully synced 1 plays for user guest_..., puzzle 2025-10-19
   📍 [SYNC] Plays saved to: users/guest_.../plays/
   ```

3. **Errors:**
   ```
   ❌ [AUTH] Error managing guest user: ...
   ❌ Failed to sync history: ...
   ❌ [SYNC] Error syncing history: ...
   ```

---

## 📚 Related Files

- `mobile/storage/syncHistory.ts` - Sync logic
- `mobile/storage/history.ts` - Local history (AsyncStorage)
- `mobile/App.tsx` - Guest user initialization & sync trigger
- `mobile/firebase.ts` - Firebase configuration

---

**Last Updated:** 2025-10-19
**Version:** 2.0 (User-separated structure)

