# WordCraft

เกมปริศนาผสมคำศัพท์ประจำวัน - ผู้เล่นจะได้คำเริ่มต้น 2 คำ แล้วต้องผสมคำไปเรื่อยๆ เพื่อหาคำเป้าหมาย

## 🚀 Quick Start

### Prerequisites
- Python 3.9+ (สำหรับ AI service)
- Node.js 16+ (สำหรับ mobile app และ Firebase functions)
- Firebase CLI (สำหรับ deployment)

### Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd WordCraft
```

2. **Set up AI Service**
```bash
cd ai_service
pip install -r requirements.txt

# Copy and configure environment variables
cp env.example .env
# Edit .env with your configuration

# Run the service
uvicorn main:app --host 0.0.0.0 --port 8099 --reload
```

3. **Set up Mobile App**
```bash
cd mobile
npm install

# Copy and configure environment variables
cp env.example .env
# Edit .env with your AI service URL

# Run on web
npm run web
```

4. **Set up Firebase Functions** (optional)
```bash
cd functions
npm install

# Configure AI service URL
firebase functions:config:set ai.service_url="https://your-ai-service.example.com"

# Deploy
firebase deploy --only functions
```

## 📖 Documentation

- [SETUP.md](SETUP.md) - ขั้นตอนการติดตั้งและตั้งค่า
- [PUZZLE_GENERATION.md](PUZZLE_GENERATION.md) - อธิบายระบบสร้างโจทย์แบบ deterministic
- [VOCABULARY_FILTERING.md](VOCABULARY_FILTERING.md) - อธิบายการกรองคำศัพท์จาก 1M → 14K คำ

## 🏗️ Project Structure

```
WordCraft/
├── ai_service/          # FastAPI AI service (Word2Vec)
├── mobile/              # React Native mobile app (Expo)
├── functions/           # Firebase Cloud Functions
├── wordcraft_game/      # Game generation scripts
└── SETUP.md            # Detailed setup guide
```

## 🔧 Configuration

This project uses environment variables for configuration. See `env.example` files in each directory:
- `ai_service/env.example` - AI service configuration
- `mobile/env.example` - Mobile app configuration

**Important**: Never commit `.env` files to version control.

## 🛡️ Security Notes

- **CORS**: Restrict `ALLOWED_ORIGINS` to specific domains in production
- **HTTPS**: Always use HTTPS for AI service in production
- **Firebase**: Configure Firestore security rules properly
- **Environment Variables**: Keep `.env` files secure and never commit them

## 📝 License

[Your License Here]