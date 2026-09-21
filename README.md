# Studion

> A personal focus operating system and study analytics instrument. Track where your hours actually go and see the patterns in how you work.

---

## 🌐 Deployments

- **Backend API**: [https://studion-api.onrender.com](https://studion-api.onrender.com) ([Health Endpoint](https://studion-api.onrender.com/api/health))
- **Frontend App**: Deployed on Vercel

## ⚡ Overview

Studion is designed for deep work tracking and study analytics across subjects like Data Structures & Algorithms, Backend Engineering, Databases, System Design, and more.

- **Focus Timer**: Cross-device focus session tracking with configurable session intervals and goals.
- **Analytics & Insights**: Heatmaps, breakdown charts, and deep-dive work distribution.
- **Full-Stack Monorepo**: Vite + React frontend, Node.js + Express backend with MongoDB persistence and in-memory fallback.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express, MongoDB (with optional in-memory database)
- **Shared**: Shared TypeScript types and validation utilities

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20.6.0
- npm >= 9.0.0

### Installation

```bash
git clone https://github.com/rubanofficial/Studion.git
cd Studion
npm install
```

### Environment Configuration

Configure the backend environment:

```bash
cp server/.env.example server/.env
```

Edit `server/.env` with your settings (or leave default for local in-memory operation):
```env
PORT=4000
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB_NAME=studion
USE_MEMORY_DB=false
CORS_ORIGIN=http://localhost:5173,http://localhost:4173
```

### Running Locally

Run both frontend and backend concurrently:
```bash
npm run dev
```

Or run services individually:
```bash
# Start backend server
npm run dev:server

# Start frontend web app
npm run dev:web
```

- Web app runs at: `http://localhost:5173`
- API server runs at: `http://localhost:4000`

---

## 🧪 Testing & Validation

```bash
# Run all tests across workspaces
npm test

# Type checking
npm run typecheck

# Production build
npm run build
```

---

## 📄 License

MIT License.
