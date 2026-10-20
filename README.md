# ECT ERP — Fleet Dispatch Management System

Dispatch, live vehicle tracking, work-hour records and alarms for **Excellent Construction Ltd** (Auckland, New Zealand).
One backend, one shared database, and three front ends:

| Component | Stack | Delivered as |
|---|---|---|
| Backend service | NestJS 10 · TypeORM · Socket.IO · JT/T 808 TCP gateway | Docker image on Railway |
| Web Admin Console | React 18 · Vite · Ant Design 5 · Leaflet · i18next (EN / 中文) | Windows desktop installer (Electron) |
| ECT Technician mobile app | Expo / React Native · Redux Toolkit · background location | Android APK / iOS via EAS |
| Database & files | Supabase (PostgreSQL + Storage, signed URLs) | Cloud |

## What it does

- **Tasks** — create, assign, accept (with the vehicle plate), run, complete with photos and notes; task names are generated as `client-YYYYMMDD-NNN`.
- **Live tracking** — positions from the driver's phone (foreground + background) and from **hardware GPS trackers** wired to the trucks (JT/T 808-2013, SLC V1.54), matched to the running task by plate. Two months of track history, thinned after 7 days.
- **Alarms** — stationary too long, shock, power cut, geofence enter/leave (server-side circular zones), tracker offline (a mains-powered tracker that goes silent). Alarms are de-duplicated, notified with sound, and listed on the Anomalies page.
- **Work hours** — GPS duration per task, system and manual adjustments with an audit trail, completion photos served through signed URLs.
- **Vehicles & RUC** — per-vehicle odometer estimate from the trackers and escalating road-user-charge reminders.
- **Roles** — Admin, Dispatcher, Driver, Client, Monitor (kiosk screen). Every API message is single-language, chosen by the client's `X-Lang` header.

## How it runs in production

```
Electron desktop console (file://)        ECT Technician app (Expo)
            │                                        │
            └──────────────── HTTPS ─────────────────┘
                               │
             backend-production-ff66.up.railway.app
                               │
               ┌───────────────┴───────────────┐
               │   one Railway service          │
               │   HTTP  : container port 8080  │
               │   JT808 : container port 5023  │
               └───────────────┬───────────────┘
                               │
              Supabase PostgreSQL + Supabase Storage

GPS trackers ──TCP──▶ iriguchi.proxy.rlwy.net:18239 ──▶ container port 5023
```

The HTTP port and the tracker port must differ; the gateway refuses to start on the API port. Details, environment variables and the launch checklist are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Repository layout

```
backend/        NestJS service: auth, users, tasks, work records, GPS, alarms,
                geofences, vehicles/RUC, notifications, announcements, JT808 gateway
frontend/       Web Admin Console (React + Vite) and the Electron packaging
driver-app/     ECT Technician mobile app (Expo Router)
database/       database.sql (fresh install) and migrations/ (re-runnable scripts)
docs/           API.md, DEPLOY.md, gps-device-jt808.md (tracker integration), vendor/ (tracker protocol)
.github/        CI: backend typecheck + tests, web typecheck + locale check + build, app typecheck, Docker build
```

## Running locally

Prerequisites: Node.js 22, a Supabase project (or any PostgreSQL 15+), and for the app the Expo tooling.

```bash
# backend — copy the example and fill in the database / Supabase values
cp backend/.env.example backend/.env
cd backend && npm install && npm run start:dev          # http://localhost:3000, Swagger at /api/docs

# web admin console — the dev server proxies /api to the backend
cd frontend && npm install && npm run dev               # http://localhost:5173
#   point the dev console at the live backend instead:
#   VITE_PROXY_TARGET=https://backend-production-ff66.up.railway.app npm run dev

# mobile app
cd driver-app && npm install && npx expo start
```

`start-dev.bat` does the first two steps on Windows.

On first start the backend creates or verifies the tables it needs (idempotent DDL with lock timeouts) and refuses to start if a required column is missing. **Change the administrator password on the first login** — the server logs a `SECURITY` warning at every boot while the documented default is still in use.

## Tests and checks

```bash
cd backend  && npx tsc --noEmit && npx jest        # 410 tests across 29 suites (19 Oct 2026)
cd frontend && npx tsc --noEmit && npm run check:locales && npm run build
cd driver-app && npx tsc --noEmit
```

The same steps run on every push through GitHub Actions. Bugs that slipped past a test are fixed together with the test, and the test is checked by breaking the code on purpose.

## Building the deliverables

```bash
cd frontend  && npm run dist:win                       # Windows installer in frontend/release/
cd driver-app && npx eas-cli build -p android --profile preview   # APK via EAS
```

Pushing to `main` deploys the backend to Railway from the repository-root `Dockerfile`.

## Hardware GPS trackers

The backend speaks JT/T 808-2013 directly on a TCP port (no third-party tracking platform). Trackers are registered by device number on the GPS Devices page and bound to a vehicle plate; the plate the driver enters when accepting a job is what links the tracker's positions to that job. The integration notes, the alarm bit layout taken from the vendor's document, the decisions behind the gateway's security limits and the field-test findings are in [docs/gps-device-jt808.md](docs/gps-device-jt808.md); the vendor's protocol document is in `docs/vendor/`.

## Documentation

- [docs/API.md](docs/API.md) — REST and WebSocket API
- [docs/DEPLOY.md](docs/DEPLOY.md) — deployment, environment variables, launch checklist
- [docs/gps-device-jt808.md](docs/gps-device-jt808.md) — tracker integration
- [ECT ERP Project Proposal.docx](ECT%20ERP%20Project%20Proposal.docx) — original project proposal (July 2026)

---

© 2026 Excellent Construction Ltd. Proprietary software — all rights reserved.
