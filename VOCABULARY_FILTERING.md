# Vocabulary Filtering Explanation

## จาก 1M คำ เหลือ 173,218 คำ - ทำไม?

### ขั้นตอนการกรอง

```
999,994 คำ (100.0%) - Word2Vec vocabulary ทั้งหมด
    ↓
    ├─ Step 1: Basic Quality Filters
    │  เหลือ: ~380,000 คำ (38%)
    │  ตัดออก:
    │  • Proper nouns (London, Einstein): ~400,000 คำ
    │  • ตัวเลข/สัญลักษณ์ (123, %, &): ~50,000 คำ
    │  • คำที่มี hyphen (co-operate): ~70,000 คำ
    │  • คำยาวเกิน/สั้นเกิน (<3 หรือ >20 ตัว): ~80,000 คำ
    │  • อักขระไม่ใช่ ASCII: ~20,000 คำ
    ↓
    ├─ Step 2: Clean Text Filters
    │  เหลือ: ~310,000 คำ (31%)
    │  ตัดออก:
    │  • Articles & pronouns (a, the, I): ~500 คำ
    │  • Profanity: ~100 คำ
    │  • Repetitive patterns (aaa, bbb): ~70,000 คำ
    ↓
    ├─ Step 3: Lemma Forms Only
    │  เหลือ: 173,218 คำ (17.3%)
    │  ตัดออก: ~137,000 inflected forms
    │  • was → be, running → run, cats → cat
    ↓
173,218 คำคุณภาพสูง ✅
```

---

## เหตุผลแต่ละขั้นตอน

### Step 1: Basic Quality Filters (-55%)

**ตัวกรอง:**

1. **Proper Nouns (~400,000 คำ)**
   - ตัดออก: `London`, `Microsoft`, `Einstein`, `Shakespeare`
   - เหตุผล: เกมต้องการคำนามสามัญ ไม่ใช่ชื่อเฉพาะ
   - ตรวจจาก: ตัวพิมพ์ใหญ่ในตำแหน่งที่ไม่ใช่ตัวแรก

2. **ตัวเลข/สัญลักษณ์ (~50,000 คำ)**
   - ตัดออก: `123`, `$`, `%`, `&`, `2nd`, `#hashtag`
   - เหตุผล: ไม่เหมาะกับเกมคำศัพท์

3. **คำที่มี Hyphen (~70,000 คำ)**
   - ตัดออก: `co-operate`, `well-known`, `self-aware`, `e-mail`
   - เหตุผล: 
     - เน้นความเรียบง่าย (ใช้ `cooperate`, `email` แทน)
     - หลีกเลี่ยงปัญหาการพิมพ์และแสดงผล
     - ลดความซ้ำซ้อน (hyphen/non-hyphen variants)

4. **คำยาวเกิน/สั้นเกิน (~80,000 คำ)**
   - คำยาว (>20 ตัว): `internationalization`, `telecommunications`
   - คำสั้น (<3 ตัว): `a`, `I`, `is`, `to`, `in`
   - เหตุผล: ยากเกินไปหรือง่ายเกินไป

5. **อักขระไม่ใช่ ASCII (~20,000 คำ)**
   - ตัดออก: `café`, `naïve`, `Zürich`, `日本`
   - เหตุผล: ป้องกันปัญหาการแสดงผลและ encoding

**ความยาวที่เหลือ: 3-20 ตัวอักษร**
- ตัวอย่าง: `cat`, `water`, `cooperate`, `email`, `internationalism`

**อักขระที่ยอมรับ:**
- ✅ ตัวอักษร a-z (lowercase) เท่านั้น
- ❌ Hyphen (-)
- ❌ Underscore (_)
- ❌ ตัวเลข (0-9)
- ❌ สัญลักษณ์อื่นๆ

### Step 2: Clean Text Filters (-16%)

**ตัวกรอง:**

1. **Articles & Pronouns (~500 คำ)**
   - ตัดออก: `a`, `an`, `the`, `I`, `you`, `he`, `she`, `it`, `we`, `they`
   - เหตุผล: คำพื้นฐานเกินไป ไม่น่าสนใจในเกม

2. **Profanity (~100 คำ)**
   - ตัดคำหยาบคายและคำไม่เหมาะสม
   - เหตุผล: เกมเหมาะกับทุกวัย

3. **Repetitive Patterns (~70,000 คำ)**
   - ตัดออก: `aaa`, `bbb`, `xxxx`, `zzzz`
   - ตรวจจาก: ตัวอักษรเดียวกันซ้ำกัน 3 ครั้งขึ้นไป
   - เหตุผล: มักเป็น typos หรือคำที่ไม่ใช่คำจริง

### Step 3: Lemma Forms Only (-36%)

**Lemmatization คืออะไร?**
- เอาคำกลับไปเป็นรูปพื้นฐาน (dictionary form)
- ตัดรูปผันออก (inflections, conjugations, plurals)

**ตัวอย่างคำที่ถูกตัด:**

| Inflected Form | Base (Lemma) | เหตุผล |
|----------------|--------------|--------|
| was, were, been | be | กริยารูปผัน |
| running, ran | run | กริยารูปผัน |
| cats, cat's | cat | พหูพจน์ |
| better, best | good | คุณศัพท์ขั้นกว่า/สูงสุด |
| children | child | พหูพจน์ไม่ปกติ |
| mice | mouse | พหูพจน์ไม่ปกติ |
| going, gone, went | go | กริยารูปผัน |

**ทำไมต้องตัด?**
- **ไม่ซ้ำซ้อน:** ไม่ต้องมีทั้ง `run` และ `running`
- **คุณภาพเนื้อหา:** เน้นคำพื้นฐานที่ชัดเจน
- **Consistency:** ง่ายต่อการเข้าใจและผสมคำ

---

## ผลลัพธ์สุดท้าย

### 14,854 คำคุณภาพสูง

**คุณสมบัติ:**
- ✅ ความถี่สูง (top 50k most common)
- ✅ ความยาวเหมาะสม (3-12 ตัวอักษร)
- ✅ รูปพื้นฐาน (base/lemma form)
- ✅ คำนามสามัญ (common nouns/verbs/adjectives)
- ✅ ไม่ซ้ำซ้อน (no plurals/conjugations)

**ตัวอย่างคำที่เหลือ:**
```
water, fire, earth, air, sun, moon, star
cat, dog, bird, fish, tree, flower
run, walk, jump, think, make, create
good, bad, big, small, hot, cold
reflection, motivation, energy, wisdom
```

**ตัวอย่างคำที่ถูกตัด:**
```
❌ was, were, been (→ kept: be)
❌ running, ran (→ kept: run)
❌ cats, dogs (→ kept: cat, dog)
❌ better, best (→ kept: good)
❌ London, Microsoft (proper nouns)
❌ internationalization (too long)
❌ a, I, is (too short)
```

---

## การปรับแต่ง

### ถ้าต้องการคำเพิ่ม:

#### 1. เพิ่ม top words (ปัจจุบัน: 50k)
```python
vocab = model.index2word[:100000]  # เพิ่มเป็น 100k
```
**ผลลัพธ์:** เพิ่มคำหายาก แต่คุณภาพอาจลดลง

#### 2. เปลี่ยนความยาว (ปัจจุบัน: 3-12)
```python
if 2 <= len(w) <= 15  # เปลี่ยนเป็น 2-15
```
**ผลลัพธ์:** รับคำสั้นและยาวมากขึ้น

#### 3. รับ inflected forms (ยกเลิก lemma filter)
```python
# ลบการเช็ค is_lemma_form() ออก
_cached_vocab = candidate_words  # ไม่กรอง lemma
```
**ผลลัพธ์:** จะมีทั้ง `run` และ `running`

#### 4. รับ proper nouns
```python
if 3 <= len(w) <= 12 and w.isalpha() and '_' not in w:
    # ไม่เช็ค w.islower() แล้ว
```
**ผลลัพธ์:** จะมีชื่อเฉพาะ เช่น `London`, `Microsoft`

---

## สถิติ

| ขั้นตอน | จำนวนคำ | % คงเหลือ | % จากต้น |
|---------|---------|-----------|----------|
| **Start** | 999,994 | 100.0% | 100.0% |
| Top 50k | 50,000 | 5.0% | 5.0% |
| Filtered | 25,512 | 51.0% | 2.6% |
| **Lemma** | **14,854** | **58.2%** | **1.5%** |

**คำถูกตัดออกทั้งหมด:** 985,140 คำ (98.5%)

---

## สรุป

จาก 999,994 คำ เหลือ 14,854 คำ เพราะ:
1. ✂️ 95% - คำหายากมาก (อันดับต่ำกว่า 50,000)
2. ✂️ 49% - ชื่อเฉพาะ, ตัวเลข, คำยาว/สั้นเกินไป
3. ✂️ 42% - รูปผัน (inflected forms)

**ผลลัพธ์:** 14,854 คำคุณภาพสูง ไม่ซ้ำซ้อน เหมาะกับเกม!

