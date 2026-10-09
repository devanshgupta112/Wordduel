# WORDDUEL — Complete Technical Documentation & Deployment Guide

> **WORDDUEL: The Real-Time 2-Player Word Race**  
> An ultra-fast, competitive Wordle duel playable instantly on the web and packaged for Android. Two players race against each other in real-time to solve the same secret 5-letter word. Every submitted guess broadcasts color hints live without revealing secret letters.

---

## Table of Contents
1. [Project Overview & Key Features](#1-project-overview--key-features)
2. [Complete Technology Stack](#2-complete-technology-stack)
3. [Project Directory & File Structure](#3-project-directory--file-structure)
4. [Detailed Breakdown of Every File](#4-detailed-breakdown-of-every-file)
5. [Real-Time Game Protocols & Architecture](#5-real-time-game-protocols--architecture)
6. [How to Make This App Playable on Websites (Deployment Guide)](#6-how-to-make-this-app-playable-on-websites-deployment-guide)
   - [Method 1: Cloud Deployment (Render.com - Recommended Free/Instant)](#method-1-cloud-deployment-rendercom---recommended-freeinstant)
   - [Method 2: Cloud Deployment (Railway.app / Fly.io)](#method-2-cloud-deployment-railwayapp--flyio)
   - [Method 3: Production VPS (Ubuntu + Nginx + Let's Encrypt SSL + PM2)](#method-3-production-vps-ubuntu--nginx--lets-encrypt-ssl--pm2)
   - [Method 4: Embedding into Any Website via Iframe (Game Portals & Blogs)](#method-4-embedding-into-any-website-via-iframe-game-portals--blogs)
7. [Google AdWords / AdSense Monetization Setup](#7-google-adwords--adsense-monetization-setup)
8. [Android App Packaging via Capacitor](#8-android-app-packaging-via-capacitor)
9. [High-Concurrency Scaling (5,000+ Players)](#9-high-concurrency-scaling-5000-players)
10. [Local Development & Verification](#10-local-development--verification)

---

## 1. Project Overview & Key Features

- **Real-Time 1v1 Race**: Both rivals solve the exact same 5-letter word simultaneously. First to solve it wins the round.
- **Live Color-Only Opponent Feed**: Every guess your rival makes reveals their green/yellow/gray pattern on your screen in real time, creating intense psychological tension without spoiling the letters.
- **Copy Code & Share Code**: 5-character room code system with one-click clipboard copying and native OS share sheet triggering.
- **Multi-Round Tournament System**: Play fixed series (Best of 1, 3, 5, 7, 10) or unlimited endless mode with round tracking and running scores.
- **Play vs AI Bot**: Intelligent offline simulation solver that guesses valid words at adjustable human pacing.
- **Disconnection Grace Timer**: 30-second reconnection window prevents unfair match drops when switching mobile network connections.
- **Google Material Symbols Design**: Zero generic emojis; professional, rounded, tactile game UI with 12px–28px smooth organic corners.
- **Non-Intrusive Ad Slots**: Built-in Google AdSense / AdWords responsive sections placed exclusively in unutilized space that never hinder letter tiles, the keyboard, or game controls.

---

## 2. Complete Technology Stack

### Frontend Client
- **HTML5**: Semantic, accessible markup structured for responsive mobile and desktop play.
- **CSS3**: Custom design system using CSS Variables (`--radius-*`, `--color-*`), 3D perspective flip animations, and safe-area insets (`env(safe-area-inset-*)`).
- **Vanilla JavaScript (ES6+)**: Zero framework overhead. Instant load times, high frame rate, and tiny bundle footprint.
- **WebSockets / Socket.io Client (v4.7.5)**: Low-latency bidirectional event-driven communication with automatic transport fallback (`websocket` -> `polling`).
- **Google Fonts & Material Symbols Rounded**: Crisp vector iconography tailored for gaming controls.
- **Web Audio & Vibration API**: Haptic feedback patterns on mobile keypresses and victory moments.

### Backend Server
- **Node.js (>= 18.0.0)**: High-performance asynchronous runtime.
- **Express.js (v4.19.2)**: Lightweight HTTP server for static assets and room routing.
- **Compression (v1.7.4)**: Gzip/Brotli compression for fast text delivery.
- **Socket.io (v4.7.5)**: WebSocket server managing rooms, player presence, guess validation, and state synchronization.
- **Node Cluster & Sticky Sessions (`@socket.io/sticky`, `@socket.io/cluster-adapter`)**: Multi-core master/worker process balancing.
- **Redis Scaling Adapter (`@socket.io/redis-adapter`, `ioredis`)**: Optional Redis pub/sub backplane for horizontal multi-server clusters.

### Mobile & Progressive Web App (PWA)
- **Service Worker (`sw.js`)**: Cache-first asset caching for fast loading and offline bot play.
- **Web App Manifest (`manifest.json`)**: Standalone PWA installation with custom dark theme colors.
- **Capacitor 6.x (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`)**: Cross-platform runtime compiling the web code into native Android Studio APKs.

---

## 3. Project Directory & File Structure

```
Games/
├── data/
│   └── common_five_letter_words.txt     # High-frequency dictionary (2,469 curated secret words)
├── public/
│   ├── common_five_letter_words.txt     # Frontend client dictionary for Bot mode
│   ├── game.js                          # Client-side game logic, Socket.io client, UI handlers
│   ├── icon.svg                         # Vector icon for PWA & Android app launcher
│   ├── index.html                       # Single-page application markup & ad sections
│   ├── manifest.json                    # Web App Manifest for mobile installation
│   ├── style.css                        # Full game stylesheet with dark theme & rounded corners
│   └── sw.js                            # PWA Service Worker (Cache v4)
├── capacitor.config.json                # Capacitor configuration for Android builds
├── package.json                         # Node dependencies, scripts, engines
├── package-lock.json                    # Locked dependency tree
├── server.js                            # High-concurrency Node.js server with clustering
├── words.json                           # Full Scrabble dictionary (10,603 valid 5-letter words)
└── completion.md                        # Complete project manual & deployment guide
```

---

## 4. Detailed Breakdown of Every File

### `server.js` (Backend Core)
- **Clustering**: Detects CPU cores via `os.cpus()` and forks worker threads when `NODE_CLUSTER=true`.
- **Word Dictionary Loading**: Loads `common_five_letter_words.txt` (primary secret answer list) and `words.json` (comprehensive 10,603 allowed guess list) directly into memory at startup.
- **Room State Management**: Maintains memory structures for active rooms:
  - Players (Player 1 host, Player 2 rival)
  - Current round secret word
  - Submitted guesses per round
  - Match scores & history of words played
  - Reconnection timers (`reconnectTimeout`)
- **Socket Events Handled**:
  - `create_room`: Generates unique 5-char code, configures rounds mode (fixed vs unlimited).
  - `join_room`: Joins existing room, verifies occupancy (rejects if full).
  - `submit_guess`: Validates 5-letter word against Scrabble dictionary, computes exact letter evaluation (`green`, `yellow`, `grey`), checks for win/tie condition, broadcasts colored tiles to the rival.
  - `next_round`: Coordinates synchronized start between both players for tournament rounds.
  - `rematch`: Resets scores and words history for a new tournament.
  - `disconnect`: Triggers 30-second grace countdown for opponent reconnection.

### `public/index.html` (Application Interface)
- **Header**: Logo with Material icon `sports_esports`, active room pill, synchronized timer badge (`timer`), "How to play" trigger, and "Leave room" button.
- **View 1: Home Screen (`#view-home`)**:
  - Hero banner with 3D stacked letter tiles.
  - Action buttons: "Create Game" (`add_circle`), "Join with Code" (`key`).
  - Mode buttons: "Play vs Bot" (`smart_toy`), "Same Device" (`devices`).
  - Legend guide card.
  - **Ad Section 1 (`.ad-slot-home`)**: Unobtrusive compact horizontal banner at page bottom.
- **View 2: Waiting Lobby (`#view-waiting`)**:
  - Big room code display (`#lobby-code-text`).
  - Primary actions: **Copy Code** (`content_copy`) and **Share Code** (`share`).
  - Player readiness indicators with green status dot and check icons.
  - Match chip info (5 letters, 6 guesses, Total Rounds).
  - **Ad Section 2 (`.ad-slot-lobby`)**: Positioned in idle waiting space.
- **View 3: Game Arena (`#view-game`)**:
  - Scoreboard bar with player scores, round counter, and running points.
  - Opponent live status strip with pulsating green indicator.
  - Dual board grid: Main 6x5 board for the player; mini 6x5 color-only board for the rival.
  - Responsive QWERTY touch keyboard with color feedback and Material `backspace` icon.
  - Status footer bar.
  - **Ad Section 3 (`.ad-slot-arena`)**: Placed below the keyboard/footer; automatically collapses on short mobile screens to preserve typing space.
- **Modals & Overlays**:
  - `#round-over-modal`: Round result, revealed secret word, round stats, and **Ad Section 4 (`.ad-slot-modal`)**.
  - `#duel-results-modal`: Final tournament victory screen with full words history and **Ad Section 5 (`.ad-slot-modal`)**.
  - `#create-duel-modal`: Custom round configurator (Best of 1, 3, 5, 7, 10 or Unlimited).
  - `#join-code-modal`: Clean 5-char input modal.
  - `#rules-modal`: Step-by-step game guide with color legend.

### `public/style.css` (Visual Design & Animations)
- **Design Tokens**:
  - `--radius-sm: 12px`, `--radius-md: 18px`, `--radius-lg: 22px`, `--radius-xl: 28px`, `--radius-full: 9999px`.
  - Brand purple: `#7c3aed`, Emerald green: `#10b981`, Warm amber: `#f59e0b`, Muted slate: `#2d314d`.
- **Game Animations**:
  - Pop-in animation on letter typing.
  - Row shake on invalid word input.
  - 3D flip card animation (`rotateX(90deg)`) on guess submission.
  - Pulsing status dots and victory trophy glow effects.
- **Ad Styling**:
  - Dedicated `.ad-slot-wrapper` with subtle borders and clear `ADVERTISEMENT` pill.
  - Zero layout shift (CLS) placeholder dimensions.
  - Media query safety rule (`@media (max-height: 720px) { .ad-slot-arena { display: none !important; } }`) protecting mobile gameplay.

### `public/game.js` (Frontend Game Logic)
- **Socket Connectivity**: Auto-reconnecting Socket.io client.
- **Board Grid Builder**: Generates 6 rows x 5 columns dynamically for both player and opponent.
- **Keyboard Handling**: Dual input support (physical PC keyboard + on-screen mobile touch keyboard) with haptic feedback.
- **Copy Code & Share Code**:
  - `copyCodeToClipboard(code)`: Copies the 5-character room code with custom toast notification.
  - `shareRoomCode(code)`: Invokes `navigator.share()` API with text fallback.
- **Bot Engine (`startBotGame`)**: Simulates a live human opponent with randomized guess delays (3.5s to 8s) using real 5-letter vocabulary.
- **Google Ad Refresher (`refreshGoogleAds`)**: Safe loader function triggering `adsbygoogle.push({})` across view changes without console errors.

### `public/sw.js` (Service Worker)
- Manages PWA offline asset caching with version tag `wordduel-v4`.

---

## 5. Real-Time Game Protocols & Architecture

```
[ Player 1 ]                                [ Node.js Server ]                                [ Player 2 ]
     │                                              │                                              │
     ├── create_room { roundsMode, totalRounds } ──>│                                              │
     │<── room_created { roomId: "WDX7K" } ─────────┤                                              │
     │                                              │                                              │
     │                                              │<── join_room { roomId: "WDX7K" } ────────────┤
     │<── match_start { round: 1, totalRounds } ────┼─── match_start { round: 1, totalRounds } ────>│
     │                                              │                                              │
     ├── submit_guess { word: "CRANE" } ───────────>│                                              │
     │<── guess_result { evaluation: [G,Y,X,X,X] } ─┤                                              │
     │                                              ├── opponent_guess { colors: [G,Y,X,X,X] } ───>│
     │                                              │    (Letters hidden! Colors only!)            │
     │                                              │                                              │
     ├── submit_guess { word: "PLANT" } (SOLVED!) ─>│                                              │
     │<── round_over { winner: Player1, word } ─────┼─── round_over { winner: Player1, word } ─────>│
```

---

## 6. How to Make This App Playable on Websites (Deployment Guide)

To make WORDDUEL playable by players anywhere in the world on a website, the server requires **persistent WebSocket support**. Because WORDDUEL uses Socket.io, it needs a continuous connection rather than traditional serverless endpoints.

Here are the best hosting options:

---

### Method 1: Cloud Deployment (Render.com - Recommended Free/Instant)

Render provides free hosting with full native WebSockets and automatic HTTPS.

1. **Push your code to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for WORDDUEL"
   # Create a repo on GitHub, then:
   git remote add origin https://github.com/YOUR_USERNAME/wordduel.git
   git branch -M main
   git push -u origin main
   ```

2. **Deploy on Render**:
   - Go to [render.com](https://render.com) and sign in.
   - Click **New +** -> **Web Service**.
   - Select your GitHub repository.
   - Configure the following settings:
     - **Name**: `wordduel` (or your preferred name)
     - **Region**: Choose the closest region (e.g. Frankfurt, Oregon, Singapore)
     - **Branch**: `main`
     - **Runtime**: `Node`
     - **Build Command**: `npm install`
     - **Start Command**: `node server.js`
     - **Plan**: `Free`
   - Click **Create Web Service**.

3. **Play Instantly**:
   - Within 1–2 minutes, Render gives you a live URL:  
     `https://wordduel.onrender.com`
   - Open this URL on your phone or PC: anyone who visits can now create a game and send room codes to their friends!

---

### Method 2: Cloud Deployment (Railway.app / Fly.io)

#### Using Railway:
1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Select your `wordduel` repository.
4. Railway will automatically detect Node.js, run `npm install`, and launch `node server.js`.
5. Under service **Settings**, click **Generate Domain** to get a public URL like `wordduel.up.railway.app`.

---

### Method 3: Production VPS (Ubuntu + Nginx + Let's Encrypt SSL + PM2)

For maximum speed, custom domains (e.g., `https://wordduel.com`), and unlimited players:

1. **Connect to your Ubuntu VPS**:
   ```bash
   ssh root@YOUR_SERVER_IP
   ```

2. **Install Node.js 20 & PM2**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx git
   sudo npm install -g pm2
   ```

3. **Clone and Run WORDDUEL**:
   ```bash
   cd /var/www
   git clone https://github.com/YOUR_USERNAME/wordduel.git
   cd wordduel
   npm install
   # Start with PM2 in cluster mode utilizing all CPU cores
   NODE_CLUSTER=true pm2 start server.js --name wordduel
   pm2 startup
   pm2 save
   ```

4. **Configure Nginx with WebSocket Reverse Proxy**:
   Edit `/etc/nginx/sites-available/wordduel`:
   ```nginx
   server {
       server_name wordduel.com www.wordduel.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
   Enable site & reload:
   ```bash
   sudo ln -s /etc/nginx/sites-available/wordduel /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. **Enable Free SSL Certificate (HTTPS)**:
   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d wordduel.com -d www.wordduel.com
   ```
   Your app is now live at `https://wordduel.com` with enterprise-grade SSL.

---

### Method 4: Embedding into Any Website via Iframe (Game Portals & Blogs)

If you have an existing WordPress site, Webflow site, portfolio, or game portal (such as itch.io, CrazyGames, or GameJolt), you can embed WORDDUEL into any web page:

```html
<!-- Responsive 16:9 or Mobile Aspect Ratio Embed -->
<div style="position: relative; width: 100%; max-width: 900px; height: 750px; margin: 0 auto; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
  <iframe
    src="https://your-deployed-domain.com"
    title="WORDDUEL — Real-Time Word Race"
    style="width: 100%; height: 100%; border: none;"
    allow="clipboard-write; clipboard-read"
    loading="lazy">
  </iframe>
</div>
```

---

## 7. Google AdWords / AdSense Monetization Setup

All ad slots are already implemented in `public/index.html` and styled in `public/style.css`. To start earning revenue:

### Step 1: Add your Publisher ID
Open `public/index.html`, locate lines 20–28, uncomment the script, and replace `ca-pub-XXXXXXXXXXXXXXXX` with your Google AdSense Publisher ID:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"
     crossorigin="anonymous"></script>
```

### Step 2: Replace Ad Unit Slot IDs
In `public/index.html`, find each `<ins class="adsbygoogle">` tag and set your Google Ad Unit slot numbers:
- **Home Banner**: line ~140 (`data-ad-slot="1111111111"`)
- **Lobby Banner**: line ~215 (`data-ad-slot="2222222222"`)
- **Arena Bottom**: line ~365 (`data-ad-slot="3333333333"`)
- **Results Modal**: line ~445 (`data-ad-slot="4444444444"`)

---

## 8. Android App Packaging via Capacitor

WORDDUEL includes a complete Capacitor configuration ready to build for Android:

1. **Sync web files to Android**:
   ```bash
   npx cap sync android
   ```

2. **Open in Android Studio**:
   ```bash
   npx cap open android
   ```

3. **Generate Signed APK / Bundle**:
   - In Android Studio: **Build** -> **Generate Signed Bundle / APK**.
   - Select **Android App Bundle** (for Google Play Store) or **APK** (for direct download).
   - Your Android app will feature native haptics, full-screen immersive view, and offline Bot mode.

---

## 9. High-Concurrency Scaling (5,000+ Players)

For large tournaments or high-traffic launches, WORDDUEL is built to scale:

1. **Multi-Core Clustering**:
   Run with:
   ```bash
   NODE_CLUSTER=true npm start
   ```
   This automatically spawns workers on all available CPU cores, sharing port 3000 via `@socket.io/sticky`.

2. **Horizontal Redis Scaling**:
   When scaling across multiple server instances or containers, connect Redis by setting:
   ```bash
   export REDIS_URL="redis://localhost:6379"
   node server.js
   ```
   All rooms and player messages will sync across all servers seamlessly.

---

## 10. Local Development & Verification

To run and test the application locally right now:

```bash
# Start local server
npm start
```

1. Open your browser to `http://localhost:3000`.
2. Click **Create Game** to get a 5-letter Room Code (e.g. `WDX7K`).
3. Click **Copy Code** or **Share Code**.
4. Open an incognito browser window (or a second device on the same Wi-Fi), go to `http://localhost:3000`, click **Join with Code**, and enter the code.
5. Both screens will enter the duel together with synchronized real-time guesses!

---

*Documentation compiled for WORDDUEL v2.0.*
