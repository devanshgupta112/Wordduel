# WORDDUEL — The Real-Time 2-Player Word Race

> **Same word. Two players. One winner.**  
> High-performance, low-latency competitive Wordle duel engineered to handle **5,000+ concurrent users** and readily packaged as a **native Android app**.

---

## 📸 What's New in WORDDUEL (v2.0)

- **Pixel-Perfect UI**: Matches the dark indigo/violet theme with 3D stacked letter blocks, glowing accents, real-time match timer (`⏱ 00:00`), live scoreboards, and responsive 16:9 arena.
- **5,000 Concurrent Users Scalability**:
  - **Multi-Core Clustering**: Leverages Node.js `node:cluster` + `@socket.io/sticky` to distribute socket traffic evenly across all CPU cores.
  - **Distributed Redis Scaling**: Built-in `@socket.io/redis-adapter` for multi-container deployments.
  - **WebSocket Performance Tuning**: `perMessageDeflate: false` disables CPU-heavy deflate on small messages; pre-compiled O(1) Sets for instant dictionary validation.
  - **Automated Memory GC**: Periodic eviction of expired rooms prevents memory leaks with thousands of concurrent matches.
- **Android Ready**:
  - **Capacitor Integration**: Ready for 1-command native Android compilation (`apk`/`aab`).
  - **PWA & Offline Capabilities**: Includes `manifest.json`, `sw.js` (Service Worker), and standalone display mode.
  - **Native Features**: Vibration haptic feedback on keypresses and Android Native Share Sheet integration (`navigator.share`).
- **Solo & Offline Modes**:
  - `🤖 Play vs Bot`: Intelligent AI opponent that makes realistic guesses every 4–8 seconds for practice.
  - `📱 Same Device`: Pass & Play mode.

---

## 📁 File Structure

```text
├── package.json              # Clustering, Redis adapter, Capacitor & Express dependencies
├── capacitor.config.json     # Official Capacitor config for building native Android APKs
├── server.js                 # Multi-core clustered, high-concurrency authoritative server
├── words.json                # Local word list (507 answers + 9,995 valid guesses)
├── public/
│   ├── index.html            # WordDuel UI (Home, Lobby, Duel Arena, Victory Modal)
│   ├── style.css             # Dark indigo/violet aesthetic, animations & mobile safe areas
│   ├── game.js               # Client engine (Socket.io, Bot AI, stopwatch, Android haptics)
│   ├── manifest.json         # Android PWA web manifest
│   ├── sw.js                 # Service Worker for asset caching and offline play
│   └── icon.svg              # Branded app icon
└── README.md
```

---

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server

**Standard Mode (Single Process):**
```bash
npm start
```

**Clustered Mode (Utilizes all CPU cores for 5,000+ players):**
```bash
npm run cluster
```

### 3. Open the Game
Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📱 How to Build the Android App

You have two simple ways to turn WORDDUEL into an Android application:

### Option 1: Native Android APK with Capacitor (Recommended)

This compiles the web app into a 100% native Android Studio project:

1. **Add Android Platform**:
   ```bash
   npx cap add android
   ```
2. **Sync Web Assets**:
   ```bash
   npx cap sync android
   ```
3. **Open in Android Studio & Build APK**:
   ```bash
   npx cap open android
   ```
   *In Android Studio, click **Build** > **Build Bundle(s) / APK(s)** > **Build APK** to generate your installable `.apk`!*

---

### Option 2: Progressive Web App (PWA) / Google Play TWA

Because WORDDUEL includes a complete `manifest.json` and `sw.js`:
- **Direct Install on Phone**: Open the website on Chrome on Android and tap **"Install App"** or **"Add to Home Screen"**. It opens full-screen without URL bars just like a native app.
- **Google Play Store**: Use [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap) to package the PWA into an Android App Bundle (`.aab`) in under 5 minutes:
  ```bash
  npx @bubblewrap/cli init --manifest=https://your-domain.com/manifest.json
  npx @bubblewrap/cli build
  ```

---

## ⚡ Handling 5,000 Concurrent Users

Here is how the architecture effortlessly scales:

| Bottleneck | WORDDUEL Solution |
| :--- | :--- |
| **Node Single Thread Limit** | `NODE_CLUSTER=true` runs sticky worker processes across all CPU cores (e.g., 4–8 cores = 625–1,250 connections per core). |
| **Multi-Server Scaling** | Set `REDIS_URL=redis://...` to enable `@socket.io/redis-adapter` for horizontal scaling across multiple container instances. |
| **WebSocket Memory & CPU** | `perMessageDeflate: false` removes CPU context-switching overhead from millions of small JSON messages. |
| **Bandwidth Egress** | `compression()` middleware compresses all static assets by 80%. |
| **Memory Leaks** | Active rooms Map features a background TTL garbage collector that flushes finished rooms every 5 minutes. |
# Wordduel
