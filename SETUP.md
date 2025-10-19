# WordCraft Setup Guide

## Environment Variables

This project uses environment variables for configuration. Follow these steps to set up your environment:

### 1. AI Service (`ai_service/`)

Copy the example environment file:
```bash
cd ai_service
cp .env.example .env
```

Edit `.env` and configure:
- `MODEL_PATH`: Path to your Word2Vec model file
- `MODEL_LIMIT`: Number of words to load (0 = load all)
- `ALLOWED_ORIGINS`: CORS allowed origins (use specific domains in production)

### 2. Mobile App (`mobile/`)

Copy the example environment file:
```bash
cd mobile
cp .env.example .env
```

Edit `.env` and configure:
- `EXPO_PUBLIC_AI_SERVICE_URL`: URL of your AI service
  - Development: `http://127.0.0.1:8099`
  - Production: `https://your-ai-service.example.com`

### 3. Firebase Functions

Configure the AI service URL using Firebase CLI:
```bash
firebase functions:config:set ai.service_url="https://your-ai-service.example.com"
```

View current configuration:
```bash
firebase functions:config:get
```

## Running the Services

### AI Service
```bash
cd ai_service
# Install dependencies
pip install -r requirements.txt

# Run the service
uvicorn main:app --host 0.0.0.0 --port 8099 --reload
```

### Mobile App (Expo)
```bash
cd mobile
# Install dependencies
npm install

# Run on web (recommended for development)
npm run web
# Opens at http://localhost:8081 or http://localhost:19006

# Run on iOS simulator (requires Xcode)
npm run ios

# Run on Android emulator (requires Android Studio)
npm run android
```

### Firebase Functions
```bash
cd functions
# Install dependencies
npm install

# Deploy functions
firebase deploy --only functions
```

## Security Notes

⚠️ **Important for Production:**

1. **Never commit `.env` files** - they contain sensitive configuration
2. **Restrict CORS origins** - set `ALLOWED_ORIGINS` to specific domains
3. **Use HTTPS** - ensure AI service uses HTTPS in production
4. **Secure Firebase** - configure Firestore security rules properly

## Troubleshooting

### AI Service not connecting
- Verify `EXPO_PUBLIC_AI_SERVICE_URL` is set correctly
- Check if AI service is running: `curl http://127.0.0.1:8099/health`
- Check firewall/network settings

### Model loading errors
- Verify `MODEL_PATH` points to a valid Word2Vec model file
- Check file permissions
- Ensure sufficient memory for loading the model

### CORS errors
- Add your domain to `ALLOWED_ORIGINS` in AI service `.env`
- Restart the AI service after changing CORS settings

