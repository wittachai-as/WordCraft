# Firebase Setup for AI Service Cache

## ขั้นตอนที่ 1: สร้าง Firestore Collection (Manual)

### Option A: ใช้ Firebase Console (แนะนำ - ง่ายที่สุด)

1. เปิด Firebase Console: https://console.firebase.google.com/
2. เลือกโปรเจค: **wordcraft-36438**
3. ไปที่ **Firestore Database** (เมนูซ้าย)
4. คลิก **Start collection**
   - Collection ID: `global_recipes`
   - Document ID: `all`
   - Fields:
     ```
     recipes (map): {} (empty map)
     count (number): 0
     version (string): "1.0"
     updated (timestamp): (current time)
     ```
5. คลิก **Save**

✅ **เสร็จแล้ว!** AI Service จะ populate recipes อัตโนมัติ

---

## ขั้นตอนที่ 2: Setup Admin SDK (Optional - สำหรับ Production)

### ถ้าต้องการให้ AI Service เขียนข้อมูลลง Firebase:

1. ไปที่ Firebase Console → **Project Settings** (⚙️)
2. ไปที่แท็บ **Service accounts**
3. คลิก **Generate new private key**
4. ดาวน์โหลดไฟล์ JSON
5. เปลี่ยนชื่อเป็น: `firebase-adminsdk.json`
6. วางในโฟลเดอร์: `ai_service/firebase-adminsdk.json`
7. รีสตาร์ท AI Service

```bash
cd ai_service
uvicorn main:app --host 127.0.0.1 --port 8099
```

### ตรวจสอบการทำงาน:

```bash
curl http://127.0.0.1:8099/health
# ดู recipe_cache_size ควรเป็นจำนวนที่มากกว่า 0
```

---

## การทำงานของ Cache System

1. **โหลด**: AI Service โหลด recipes จาก Firebase ตอนเริ่มทำงาน
2. **Cache**: เก็บใน memory สำหรับความเร็ว
3. **Auto-save**: เมื่อ AI สร้างคำใหม่ จะบันทึกลง Firebase อัตโนมัติ
4. **Persistence**: Cache จะคงอยู่แม้รีสตาร์ท (ถ้ามี Admin SDK)

---

## Firestore Rules

ตรวจสอบว่ามี rules นี้ใน Firestore:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Global recipes - read by anyone, write by server only
    match /global_recipes/{document=**} {
      allow read: if true;
      allow write: if false; // Only server with Admin SDK can write
    }
  }
}
```

---

## Troubleshooting

### ❌ Cache size = 0
- ตรวจสอบว่าสร้าง collection `global_recipes` แล้ว
- ตรวจสอบว่ามี document `all` 
- รีสตาร์ท AI Service

### ❌ Firebase permission error
- ต้องมี `firebase-adminsdk.json` สำหรับเขียนข้อมูล
- สำหรับอ่านข้อมูล ใช้ web config ได้ (firebase.config.json)

### ✅ ใช้งานได้แม้ไม่มี Admin SDK
- AI Service จะใช้ memory cache
- จะหายเมื่อรีสตาร์ท แต่สร้างใหม่อัตโนมัติ

