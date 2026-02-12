# Setup (Docker Desktop only)

These instructions are Docker-only and written for macOS.

Prerequisites
- Install Docker Desktop: https://www.docker.com/products/docker-desktop/.
- Launch Docker Desktop and wait until it reports "Docker Desktop is running".

Steps
1. From the project root, create the backend env file:
	- Copy backend/.env.example to backend/.env.
	- Fill in all required values in backend/.env.
2. In the project root, build and start the stack:
	- Run: docker compose up --build
3. Open the app:
	- http://localhost:3000

Notes
- If storage is not configured in backend/.env, file upload will fail.
