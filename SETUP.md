# Local Setup (Simple)

This project runs locally without Docker.

## 1) Backend (FastAPI)

1. Copy the env file:
   - From: backend/.env.example
   - To:   backend/.env
2. Fill in required values in backend/.env:
   - DATABASE_URL
   - JWT_SECRET (generate a new one)
   - Storage credentials (see R2_SETUP.md if using Cloudflare R2)
3. Create and activate a Python virtual environment.
4. Install dependencies:
   - Use backend/requirements.txt
5. Run the API server:
   - `uvicorn main:app --reload --host 0.0.0.0 --port 8000`

## 2) Frontend (React)

1. Go to frontend/
2. Install dependencies:
   - `npm install`
3. Start the dev server:
   - `npm start`
4. Open http://localhost:3000

## Notes

- Docker is not required.
- The backend runs locally; the frontend talks to it at http://localhost:8000.
- If storage is not configured, file upload will fail.
