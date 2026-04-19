# Settings Management

## การจำการตั้งค่าใน App

App จะบันทึกการตั้งค่าทั้งหมดลง `AsyncStorage` เพื่อให้จำการตั้งค่าแม้ปิดแอปแล้วเปิดใหม่

## การตั้งค่าที่บันทึก

### 1. Color Mode (โหมดสี)
- **ค่าเริ่มต้น**: `'system'`
- **ตัวเลือก**: 
  - `'system'` - ใช้ตามระบบ (auto light/dark)
  - `'light'` - โหมดสว่างเสมอ
  - `'dark'` - โหมดมืดเสมอ
- **Storage Key**: `app_settings`

## Implementation

### Storage Functions

```typescript
// Settings management
const SETTINGS_KEY = 'app_settings';

interface AppSettings {
  colorMode: 'system' | 'light' | 'dark';
}

const DEFAULT_SETTINGS: AppSettings = {
  colorMode: 'system',
};

// โหลดการตั้งค่าจาก AsyncStorage
async function loadSettings(): Promise<AppSettings> {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return DEFAULT_SETTINGS;
}

// บันทึกการตั้งค่าลง AsyncStorage
async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}
```

### Usage in App Component

```typescript
// Flag to prevent saving before initial load
const settingsLoadedRef = useRef(false);

// 1. โหลดการตั้งค่าเมื่อ app เริ่มทำงาน
useEffect(() => {
  (async () => {
    const guestId = await getOrCreateGuestUser();
    setGuestUserId(guestId);
    
    // โหลดการตั้งค่าที่บันทึกไว้
    const settings = await loadSettings();
    setColorMode(settings.colorMode);
    
    // Mark settings as loaded after state is updated
    setTimeout(() => {
      settingsLoadedRef.current = true;
    }, 100);
  })();
}, []);

// 2. บันทึกการตั้งค่าทุกครั้งที่มีการเปลี่ยนแปลง (ยกเว้นครั้งแรก)
useEffect(() => {
  if (settingsLoadedRef.current) {
    saveSettings({ colorMode });
  }
}, [colorMode]);
```

**สำคัญ**: ใช้ `settingsLoadedRef` เพื่อป้องกันการ save ทับค่าเดิมตอน mount ครั้งแรก

## การเพิ่มการตั้งค่าใหม่

หากต้องการเพิ่มการตั้งค่าใหม่:

1. เพิ่มฟิลด์ใน `AppSettings` interface:
```typescript
interface AppSettings {
  colorMode: 'system' | 'light' | 'dark';
  soundEnabled: boolean;  // ← เพิ่มตัวอย่างนี้
  language: 'en' | 'th';  // ← หรือตัวอย่างนี้
}
```

2. เพิ่มค่าเริ่มต้นใน `DEFAULT_SETTINGS`:
```typescript
const DEFAULT_SETTINGS: AppSettings = {
  colorMode: 'system',
  soundEnabled: true,
  language: 'th',
};
```

3. เพิ่ม state และ useEffect สำหรับบันทึก:
```typescript
const [soundEnabled, setSoundEnabled] = useState(true);

useEffect(() => {
  saveSettings({ colorMode, soundEnabled, language });
}, [colorMode, soundEnabled, language]);
```

4. เพิ่ม UI ในหน้า Settings (`screen === 'settings'`)

## Storage Key

- **Key**: `app_settings`
- **Format**: JSON string
- **Example**: 
```json
{
  "colorMode": "dark"
}
```

## Testing

ทดสอบการจำการตั้งค่า:

1. เปิดแอป → ไปที่ Settings
2. เปลี่ยน Color Mode จาก System เป็น Dark
3. ปิดแอป (force quit)
4. เปิดแอปใหม่
5. ตรวจสอบว่า Color Mode ยังเป็น Dark อยู่ ✅

## Benefits

✅ **จำการตั้งค่าถาวร** - ไม่หายเมื่อปิดแอป  
✅ **Auto-save** - บันทึกอัตโนมัติทุกครั้งที่เปลี่ยน  
✅ **Fast loading** - โหลดจาก local storage ทันที  
✅ **Extensible** - เพิ่มการตั้งค่าใหม่ได้ง่าย  
✅ **Type-safe** - ใช้ TypeScript interface

