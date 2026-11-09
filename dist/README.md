# PULSE — Hybrid Athlete OS (v4.7 Production)

> **High-Performance Operating System for Hybrid Athletes**  
> Unifying endurance and strength with automated continuous sync across **Garmin Connect**, **Renpho Smart Scale**, and **MyNetDiary**.

---

## ⚡ Live Application
- **Live PWA App**: [https://pulse-hybrid-app-gregputt-cpu.vercel.app](https://pulse-hybrid-app-gregputt-cpu.vercel.app)
- **GitHub Repository**: [https://github.com/gregputt-cpu/pulse-hybrid-app](https://github.com/gregputt-cpu/pulse-hybrid-app)
- **Deployment Platform**: Vercel Edge Network
- **Cloud Backend**: Railway (FastAPI + Garmin / Renpho / MyNetDiary Sync Engine)

---

## 📱 How to Install the PULSE PWA on Mobile

### On Android (Google Chrome)
1. Open Chrome and navigate to: `https://pulse-hybrid-app-gregputt-cpu.vercel.app`
2. Tap the **Three Dots Menu (⋮)** in the top right corner.
3. Tap **"Install app"** or **"Add to Home screen"**.
4. PULSE will install as a standalone app with its high-res icon and full-screen experience.

### On iPhone (Apple Safari)
1. Open Safari and navigate to: `https://pulse-hybrid-app-gregputt-cpu.vercel.app`
2. Tap the **Share button** (square with arrow pointing up).
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **"Add"** in the top right corner.

---

## 🏗 Architecture & Features

### 1. Daily Athlete Operating System
- **Today Dashboard**: Quick morning readiness, sleep score, HRV status, hydration logging, and joint status.
- **Fuel Engine (MyNetDiary)**: Live macro rings (Calories, Protein, Carbs, Fat, Fiber, Sodium, Water) with live deficit/surplus pacing.
- **Train Engine (Garmin)**: Hybrid split planner (Running, Lifting, Mobility, Conditioning) with workout history and training load.
- **Body Engine (Renpho)**: Weight tracking, body fat %, muscle mass, metabolic age, visceral fat, and weekly trajectory.
- **Offline First**: Service Worker caching (`sw.js`) guarantees instant loading even during remote trail runs or workouts without cellular reception.

### 2. 24/7 Cloud Background Sync (`backend/`)
- Automated continuous sync with **Garmin Connect** (Activities, Sleep, HRV, Steps, Resting HR).
- Automated sync with **Renpho Smart Scale** (Daily morning weigh-in, body composition metrics).
- Automated sync with **MyNetDiary** (Nutritional intake, meal breakdowns, micronutrients).
- Automated benefit calculations & nutrition target adjustments based on expended training load.

---

## 🚀 Cloud Backend Deployment (Railway)

The backend service lives in `/backend`:
- `backend/Dockerfile`
- `backend/Procfile`
- `backend/railway.json`
- `backend/requirements.txt`
- `backend/main.py`
- `backend/garmin_sync_service.py`
- `backend/mnd_sync_service.py`
- `backend/benefits_engine.py`

### 1-Click Railway Deploy:
1. Log in to [Railway.app](https://railway.app).
2. Click **"New Project"** → **"Deploy from GitHub repo"**.
3. Select `gregputt-cpu/pulse-hybrid-app`.
4. Under project settings, set Root Directory to `/backend` (or leave default as `backend/Dockerfile` is detected).
5. Add your Garmin and MyNetDiary environment variables in the Railway dashboard.

---

## 🔒 Security
- All sensitive API credentials and tokens are excluded from version control via `.gitignore`.
- Production tokens and environment variables are injected exclusively via cloud secrets managers.
