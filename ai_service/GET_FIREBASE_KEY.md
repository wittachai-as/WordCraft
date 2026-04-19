# How to Get Firebase Admin SDK Key

1. Go to Firebase Console: https://console.firebase.google.com/
2. Select project: **wordcraft-36438**
3. Click ⚙️ (Settings) → **Project settings**
4. Go to **Service accounts** tab
5. Click **Generate new private key**
6. Download the JSON file
7. Rename it to: `firebase-adminsdk.json`
8. Move it to: `ai_service/firebase-adminsdk.json`

## Security Note
- ⚠️ **NEVER commit this file to git**
- Already added to .gitignore

## After setup:
Restart AI Service to load Firebase cache
