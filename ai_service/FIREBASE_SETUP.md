# 🔥 Firebase Setup Guide

## 📋 ภาพรวม

WordCraft ใช้ Firebase Firestore เพื่อเก็บ Global Recipes (cache ของคำที่ผสมแล้ว) ให้ persistent และแชร์ระหว่างผู้เล่นทุกคน

---

## 🚀 วิธี Setup Firebase

### 1. สร้าง Firebase Project

1. ไปที่ [Firebase Console](https://console.firebase.google.com/)
2. คลิก "Add project" หรือเลือก project ที่มีอยู่
3. ตั้งชื่อ project (เช่น "WordCraft")
4. เปิดใช้ Google Analytics (optional)
5. คลิก "Create project"

### 2. สร้าง Service Account Key

1. ใน Firebase Console ไปที่ **Project Settings** (⚙️)
2. ไปที่แท็บ **Service accounts**
3. คลิก **Generate new private key**
4. คลิก **Generate key** (จะได้ไฟล์ JSON)
5. เปลี่ยนชื่อไฟล์เป็น `firebase-adminsdk.json`

### 3. วางไฟล์ใน Project

```bash
# วางไฟล์ Service Account Key ที่:
/Users/godamar/Git/WordCraft/ai_service/firebase-adminsdk.json
```

**⚠️ สำคัญ:** เพิ่มไฟล์นี้ใน `.gitignore` เพื่อไม่ให้ commit ขึ้น Git!

### 4. เปิดใช้ Firestore

1. ใน Firebase Console ไปที่ **Firestore Database**
2. คลิก **Create database**
3. เลือก **Start in production mode** หรือ **test mode**
4. เลือก location (เช่น `asia-southeast1`)
5. คลิก **Enable**

### 5. ตั้งค่า Security Rules (Optional)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // อนุญาตให้ server อ่าน/เขียนได้ทั้งหมด
    match /{document=**} {
      allow read, write: if true;  // เปลี่ยนเป็น authentication ในอนาคต
    }
  }
}
```

---

## 🔧 แก้ไข Code

### อัปเดต `main.py` ให้ใช้ Service Account Key

```python
def init_firebase():
  global _firebase_app, _firestore_db
  if not _firestore_db:
    try:
      # ใช้ Service Account Key
      import os
      key_path = os.path.join(os.path.dirname(__file__), 'firebase-adminsdk.json')
      
      if os.path.exists(key_path):
        cred = credentials.Certificate(key_path)
        _firebase_app = firebase_admin.initialize_app(cred)
        _firestore_db = firestore.client()
        print("[FIREBASE] ✅ Initialized with Service Account")
      else:
        # Fallback: ใช้ default credentials (Google Cloud)
        _firebase_app = firebase_admin.initialize_app()
        _firestore_db = firestore.client()
        print("[FIREBASE] ✅ Initialized with default credentials")
        
    except Exception as e:
      print(f"[FIREBASE] ❌ Error initializing: {e}")
      _firebase_app = None
      _firestore_db = None
  return _firestore_db
```

---

## 📁 โครงสร้างไฟล์

```
WordCraft/
├── ai_service/
│   ├── firebase-adminsdk.json       ← Service Account Key (ห้าม commit!)
│   ├── main.py
│   └── requirements.txt
├── .gitignore                        ← เพิ่ม firebase-adminsdk.json
└── ...
```

---

## 🔐 อัปเดต .gitignore

เพิ่มบรรทัดนี้ใน `.gitignore`:

```gitignore
# Firebase credentials
**/firebase-adminsdk.json
**/*-firebase-adminsdk-*.json
firebase-adminsdk*.json
```

---

## ✅ ทดสอบการเชื่อมต่อ

### 1. Restart AI Service

```bash
cd /Users/godamar/Git/WordCraft
source wordcraft_venv/bin/activate
cd ai_service
uvicorn main:app --host 0.0.0.0 --port 8099 --reload
```

### 2. ดู Logs

หา message:
```
[FIREBASE] ✅ Initialized with Service Account
[FIREBASE] Loading recipes in background...
[FIREBASE] ✅ Loaded X recipes from Firestore
```

### 3. ทดสอบ API

```bash
# ผสมคำ
curl -X POST http://127.0.0.1:8099/combine \
  -H "Content-Type: application/json" \
  -d '{"a":"sun","b":"moon"}'

# ผลลัพธ์ควรบันทึกลง Firebase
# ดู log: [FIREBASE] ✅ Saved X recipes to Firestore
```

### 4. ตรวจสอบใน Firebase Console

1. ไปที่ Firebase Console
2. เข้า Firestore Database
3. ควรเห็น collection `global_recipes`
4. ควรเห็น document `all` พร้อม field `recipes`

---

## 🔍 Troubleshooting

### ❌ ไม่มี firebase-adminsdk.json

**อาการ:**
```
[FIREBASE] ❌ Error initializing: Could not find firebase-adminsdk.json
```

**แก้ไข:**
- ดาวน์โหลด Service Account Key จาก Firebase Console
- วางไฟล์ใน `ai_service/firebase-adminsdk.json`

### ❌ Permission denied

**อาการ:**
```
[FIREBASE] ⚠️ Could not save recipes: PERMISSION_DENIED
```

**แก้ไข:**
- ตรวจสอบ Firestore Security Rules
- เปลี่ยนเป็น test mode หรือเพิ่ม rules ให้อนุญาต

### ❌ Connection timeout

**อาการ:**
```
[FIREBASE] ⚠️ Could not load recipes: Timeout
```

**แก้ไข:**
- ตรวจสอบ internet connection
- ตรวจสอบว่า Firestore เปิดใช้งานแล้ว
- ระบบจะใช้ local cache ต่อได้

---

## 🎯 ทางเลือกอื่น

### Option 1: ใช้ Environment Variables

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/firebase-adminsdk.json"
```

### Option 2: ใช้ Google Cloud Default Credentials

ถ้า deploy บน Google Cloud (Cloud Run, App Engine, etc.):
```python
# ไม่ต้องใส่ credentials
firebase_admin.initialize_app()  # ใช้ default credentials
```

### Option 3: ไม่ใช้ Firebase (Local Cache Only)

ถ้าไม่ต้องการ persistent storage:
- ลบไฟล์ `firebase-adminsdk.json`
- ระบบจะใช้ memory cache อย่างเดียว
- ข้อมูลจะหายหลัง restart

---

## 📊 ข้อมูลที่เก็บใน Firestore

### Collection: `global_recipes`

```javascript
{
  "all": {
    "recipes": {
      "fire+water": "Steam",
      "earth+rain": "Mud",
      "sun+moon": "Eclipse",
      ...
    },
    "updated_at": Timestamp
  }
}
```

**ขนาดข้อมูล (ประมาณการ):**
- 1,000 recipes ≈ 50 KB
- 10,000 recipes ≈ 500 KB
- 100,000 recipes ≈ 5 MB

**ราคา Firestore (Free tier):**
- Read: 50,000/day
- Write: 20,000/day
- Storage: 1 GB

→ เพียงพอสำหรับ development และ small-medium scale production

---

## ✨ สรุป

**ต้องทำ:**
1. ✅ สร้าง Firebase Project
2. ✅ ดาวน์โหลด Service Account Key
3. ✅ วางที่ `ai_service/firebase-adminsdk.json`
4. ✅ อัปเดต `.gitignore`
5. ✅ แก้ไข `init_firebase()` ใน `main.py`
6. ✅ Restart AI Service
7. ✅ ทดสอบการบันทึก

**ผลลัพธ์:**
- 💾 Recipes บันทึกลง Firestore
- 🌐 แชร์ระหว่างผู้เล่นทุกคน
- 🔄 Persistent (ไม่หายหลัง restart)
- ⚡ เร็ว (cache + Firebase)

🎯 ระบบพร้อมใช้งาน production!

