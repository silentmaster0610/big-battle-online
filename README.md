# Big Battle Online

A browser-based, turn-based 2D artillery deathmatch inspired by the classic Big Battle: Tanks. Includes internet-ready private rooms for **2–5 human players**. It is an independent fan-style remake, not the proprietary original Flash game.

## Version 2 — controls fixed and visual overhaul

Use the explicit MOVE LEFT / MOVE RIGHT buttons or Left/Right arrow keys during **your turn**. Use Up/Down to rotate the turret, Page Up/Page Down to change power, Space to fire, and Q/E for weapons. Fuel is shown below the canvas.

The supplied designs, code and visual assets are independently created, not copied from 2DPlay.

## Features

- 6-character private room codes; 5-player hard cap; host starts / rematches
- Game server is authoritative for turn order, trajectories, wind, damage, inventory and tank movement
- Destructible procedural terrain synced across clients
- 10 weapon types: standard shell, heavy shell, triple, cluster, spider, air strike, tactical nuke, laser, repair, and forcefield
- Realtime projectile animations and event effects; HP, shield and kill tracking
- Turn timer, fuel, in-game credits and supply shop
- Lobby, roster, chat, aiming keyboard controls, and sharable invitation URLs
- Runs on Node.js 22+ **with zero npm dependencies**

## Run locally

1. Install Node.js 22+.
2. Extract this folder and open Terminal / PowerShell inside it.
3. Run: `npm start`
4. Open `http://localhost:3000` in your browser.

To test on two laptops on the **same Wi-Fi**, find the host laptop's LAN IP (e.g. `192.168.1.5`), then access `http://192.168.1.5:3000` from both machines. Allow port 3000 through firewall if prompted.

## Play over the internet (different houses / networks)

Deploy this entire folder as one **Node.js Web Service**, e.g. on Render or Railway. Set Start Command to `npm start` (no build command required). The host uses the port supplied in the `PORT` environment variable. Share the public `https://your-app.example/?room=ABC123` link. The browser automatically connects over secure `wss://` on HTTPS.

**Important:** do not deploy the frontend alone on a static hosting service, since it requires a persistent WebSocket server. For consistent matches, choose a service that does not sleep or shut down during games and supports WebSockets. This in-memory prototype has no database or durable room storage: restarting the server ends active matches.


## Free deployment with GitHub + Render

1. Create a new GitHub repository and upload the files in this folder to the **root** of the repo, including `server.js`, `package.json`, `public/`, and `render.yaml`. (If you upload the ZIP itself, GitHub does not extract it for Render.)
2. In Render, choose **New > Blueprint** and select that repository, or **New > Web Service** and connect the repository.
3. The included `render.yaml` specifies a **free** Node.js service. If using Web Service instead of Blueprint, choose **Free**, set Start Command to `npm start`, and leave Build Command blank (there are no dependencies).
4. Once the deployment is Live, open the Render-provided `https://…onrender.com` URL, create a private room, and share that URL or the invite code with friends.

The free server goes idle after 15 minutes without inbound HTTP or WebSocket messages and may require a cold start on the next visit. Matches are currently stored in RAM; a server restart ends active games. Keep a single service instance for this in-memory multiplayer design.

## Controls

- `← / →`: Move on your turn (uses fuel)
- `↑ / ↓`: Change turret angle
- `Page Up / Page Down`: Adjust firing power
- `Q / E`: Cycle weapons
- `Space`: Fire
- Click on the battlefield to aim (or choose an airstrike target)
- Supply depot purchases use credits earned by damaging opponents

## Notes / limitations

- This is a playable prototype with the classic core gameplay, **not** a pixel-perfect/feature-complete port. Campaign mode, every weapon from the original, bots, account persistence, and exact original upgrade economy are not implemented.
- Designed for desktop Chrome/Firefox/Edge. The battlefield scales on mobile but desktop keyboard controls are recommended.
- Players who disconnect mid-match are knocked out; rejoining an active match is not currently supported.
- Multiplayer capacity is per room (max 5), not a limit on how many rooms can exist simultaneously.
- Render/Railway service configuration changes over time; follow the provider's current Node/WebSocket documentation.

## Original game inspiration

Big Battle: Tanks by 2DPlay (2009). This project contains original code, generated vector graphics, and no copied Flash assets.

### Windows shortcut

On Windows, after installing Node.js 22+, double-click `start-windows.bat` to start the local game server and open your browser.
