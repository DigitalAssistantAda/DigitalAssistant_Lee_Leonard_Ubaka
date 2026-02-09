# Setup

You can run this with Docker or without it.

Docker (easiest)
- Make sure Docker is installed and running.
- Copy backend/.env.example to backend/.env and fill in the required values.
- In the project root, run docker compose up --build.
- Open the app at http://localhost:3000.

No Docker (still supported)
- Install Python and Node on your machine.
- Copy backend/.env.example to backend/.env and fill in the required values.
- Start the backend from the backend folder.
- Start the frontend from the frontend folder.
- Open the app at http://localhost:3000.

Notes
- If storage is not configured, file upload will fail.
