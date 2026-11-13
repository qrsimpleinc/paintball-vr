# Paintball VR

An original 4v4 team paintball game that runs in the browser: in VR on Meta Quest (Quest Browser, WebXR) and on a computer with mouse and keyboard. Bots fill any empty places, so you can play alone or with friends.

- **Two game modes:** Team Battle and Capture the Flag
- **Six maps**, plus a map editor for making your own
- **Weapons:** pistol, shotgun, burst rifle, scope rifle, paint launcher, sprayer, grenade, mine, shield and foam mallet
- **Bots** with three difficulty levels. They only know where you are if they see or hear you
- **Multiplayer** on your home network, or online with a matchmaker and as many game servers as you need

Everything is made in code: the 3D models, maps and sounds (synthesized with Web Audio). There are no asset files.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/qrsimpleinc/paintball-vr.git
cd paintball-vr
npm install
npm start
```

Open http://localhost:8080 and press **Play on desktop**.

## Playing on Meta Quest

The Quest Browser only allows VR on HTTPS pages, or on `localhost`. Pick one of these:

**Option A: Wi-Fi (easiest).** Create a self-signed certificate once, then start the server:

```bash
npm run cert
npm start
```

The server prints the address, for example `https://192.168.0.25:8443`. Open it in the Quest Browser, choose *Advanced → Proceed* on the certificate warning, and press **Enter VR**. Every Quest on the same Wi-Fi can join the same way. If you open the plain `http://` address by mistake, the page sends you to the HTTPS one.

**Option B: USB cable.** Turn on developer mode on the Quest, connect it to the computer, then run:

```bash
adb reverse tcp:8080 tcp:8080
```

Open `http://localhost:8080` in the Quest Browser.

**Option C: tunnel**, to play with friends outside your network without a server. For example `cloudflared tunnel --url http://localhost:8080` gives you a public HTTPS address.

If the Quest says the address isn't reachable, check that it's on the same Wi-Fi as the computer, and that the computer's firewall allows Node.js.

## How to play

The lobby's **How to play** menu has two choices:

- **Find players:** you join an open room and warm up in the arena (no score) while others arrive. The match starts after 45 seconds, or 5 seconds after all 8 places fill, and bots take the empty places.
- **Private room:** a room code you share with friends. You choose the bots, map and difficulty, and it starts at once.

### Game modes

- **Team Battle:** every hit scores a point for your team. First to 15, or most after 5 minutes, wins.
- **Capture the Flag:** take the enemy flag (you need a free hand) and carry it to your own pad. It only scores while your own flag is at home. If you're hit while carrying it, the flag drops. Touch your own dropped flag to send it home, or it goes home by itself after 25 seconds. First to 3 captures, or most after 8 minutes, wins.

Between matches everyone votes for the next map.

### Grenades

- **Light it before throwing:** in VR, let go of it and grab it again within 1.2 seconds. On desktop, click or press G once. It goes off 3 seconds later. An unlit grenade just lands.
- **Catch enemy grenades:** grab a live enemy grenade before it goes off and it becomes yours.
- **Shoot them:** a paintball sets off a grenade in the air or lying on the map.
- The blast reaches about 3.5 m, goes through walls and never hits your own team. The paint launcher's blast is smaller (1.8 m).

### Controls

| Quest Touch | Action |
|---|---|
| Grip near a weapon | Pick it up. You keep it after letting go of Grip |
| Grip again | Drop it (swing while dropping a lit grenade to throw it) |
| Trigger | Fire |
| B / Y | Reload the weapon in that hand |
| Left stick | Move (click it to run) |
| Right stick | Snap turn (click it to crouch, or just crouch for real) |
| A / X | Jump |
| Left wrist | Score, time, ammo and kill feed |

The lobby's **VR grip** setting switches to "hold Grip to hold a weapon" if you prefer it.

| Desktop | Action |
|---|---|
| WASD + mouse | Move and aim (click the game to lock the mouse) |
| Left / right click | Use the weapon in the right / left hand |
| E | Pick up, or catch an enemy grenade you're looking at |
| Q / V | Drop right / left |
| X | Swap hands |
| G | Light grenade, press again to throw |
| R | Reload |
| Z | Zoom with the scope rifle |
| Space / Shift / C | Jump / run / crouch (hold) |
| Tab | Scoreboard |
| M | Mute |

## Map editor

Open http://localhost:8080/editor.html, or the **Map editor** link in the lobby, on a computer.

- Set the name, size and look on the left, then pick elements (weapons, towers, ramps, cover, buildings, walls, lights) and click the map to place them.
- Drag to move, drag the yellow corners to resize, `R` rotates, `Del` deletes, `Ctrl+D` duplicates, `Ctrl+Z` undoes.
- "Mirror for the other team" copies your side to the other team's side.
- The Check list shows problems such as blocked spawns.
- **Save** stores the map on the server in `maps/`, so it appears in the lobby for everyone. **Play** saves it and starts a game on it.

## Putting it online

The server has three roles, set with the `ROLE` environment variable. `npm start` with nothing set is the single local server described above.

| Role | What it does |
|---|---|
| `standalone` (default) | Everything in one process: your home network, or one online machine |
| `matchmaker` | Website, custom maps, and deciding who plays where. Runs no matches |
| `node` | A game server. Runs matches and only admits players the matchmaker sent |

### Deploying

You need Ubuntu machines with ports 80 and 443 open, and a domain name pointing at each one. On each machine:

```bash
sudo git clone https://github.com/qrsimpleinc/paintball-vr.git /opt/paintball
cd /opt/paintball
```

Then run one of these. The script installs Node.js and Caddy (which gets the HTTPS certificate automatically) and sets the game up as a service that restarts by itself.

```bash
# Everything on one machine
sudo ADMIN_PASSWORD=your-password deploy/setup-ubuntu.sh standalone play.example.com
```

```bash
# Or a network: one matchmaker (the website)...
sudo NODE_SECRET=long-random-text ADMIN_PASSWORD=your-password deploy/setup-ubuntu.sh matchmaker play.example.com
```

```bash
# ...and one or more game servers. Use the same NODE_SECRET everywhere.
sudo NODE_SECRET=long-random-text MATCHMAKER_URL=https://play.example.com REGION=eu deploy/setup-ubuntu.sh node eu1.example.com
```

Players open `https://play.example.com`. To add capacity or a region, set up another game server; it joins within seconds. Logs: `journalctl -u paintball -f`.

| Variable | Used by | Meaning |
|---|---|---|
| `NODE_SECRET` | matchmaker, node | Signs match tickets and authenticates game servers. Same value everywhere, 16+ characters |
| `ADMIN_PASSWORD` | matchmaker, standalone | Needed to save or delete maps. Online, map changes are refused without it |
| `MATCHMAKER_URL`, `PUBLIC_URL` | node | Where the matchmaker is; this server's `wss://` address (the script sets it) |
| `REGION`, `NODE_ID` | node | Region shown to players; a unique name |
| `MAX_ROOMS` | node, standalone | Matches at once (default 20) |
| `WAIT_TIME` | node, standalone | Warm-up length in seconds (default 45) |

Custom maps live on the matchmaker and are copied to the game servers automatically. If the matchmaker goes down, running matches continue, but nobody new can join until it's back.

**Sizing:** a full match of 8 players sends about 4.6 Mbit/s, or about 2 GB per hour. In a test with simulated players, one computer ran 60 matches on 40% of one CPU core. A small cloud machine such as an AWS `t3.small` should handle about 10 matches at once steadily. Test on your own machine before relying on that.

## For developers

- **Debug panel:** press `` ` `` or add `?debug=1`. It shows fps and ping and lets you change bots, difficulty, map and game, freeze bots or show their paths.
- **URL options:** `?room=abc&bots=3&difficulty=easy&mode=ctf&name=Rob&autostart=1`
- **Bots-only match:** the "Watch a bots-only match" button. Fly with WASD and Q/E.
- **Load test:** `npm run fake -- 6 public` connects 6 headless players to room `public`.

```
server/server.js      web server, WebSocket, rooms, roles
server/matchmaker.js  matchmaking and match tickets
server/room.js        match rules: teams, paintballs, grenades, flags, score
server/bots.js        bot AI: navigation, senses, aiming, Capture the Flag roles
server/items.js       weapons and flags lying on the map or held
shared/               constants, maps, map-editor format, collision math
client/js/            Three.js + WebXR client
deploy/               Ubuntu setup script
```

Built-in maps are data in `shared/maps.js`. Everything else is drawn in `client/js/props.js` and `client/js/models.js`.
