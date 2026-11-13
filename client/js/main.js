// Entry point: lobby, renderer, game loop, network event wiring, debug panel.
import * as THREE from 'three';
import { MAPS, DEFAULT_MAP } from '/shared/maps.js';
import { registerCustom } from '/shared/custom.js';

// maps made in the editor live on the server
async function fetchMap(id) {
  try { const r = await fetch(`/api/maps/${id}`); if (r.ok) { registerCustom(await r.json()); return true; } } catch { /* offline */ }
  return false;
}
const ensureMap = async (id) => (MAPS[id] ? true : fetchMap(id));
try { for (const src of await (await fetch('/api/maps')).json()) registerCustom(src); } catch { /* no custom maps */ }
let serverInfo = { network: false, regions: [] };
try { const r = await fetch('/api/info'); if (r.ok) serverInfo = await r.json(); } catch { /* defaults */ }
import { TEAM_COLORS, TEAM_NAMES, W, WEAPONS, MODES } from '/shared/constants.js';
import { CtfView } from './ctf.js';
import { World } from './world.js';
import { Avatar } from './avatar.js';
import { Net } from './net.js';
import { Hud } from './hud.js';
import { LocalPlayer } from './local.js';
import { sound } from './audio.js';
import { ItemsView } from './items.js';
import { inBush } from '/shared/physics.js';
import { VoteUI } from './vote.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const WEAPON_ICON = {
  [W.PISTOL]: 'pistol', [W.SHOTGUN]: 'shotgun', [W.GRENADE]: 'grenade', [W.BURST]: 'burst', [W.SNIPER]: 'scope',
  [W.LAUNCHER]: 'launcher', [W.SPRAYER]: 'sprayer', [W.MINE]: 'mine', [W.MALLET]: 'mallet',
};

// ---- renderer & scene ----------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
let map = MAPS[DEFAULT_MAP];
let world = new World(scene, map, renderer);
const net = new Net();
const hud = new Hud();
const items = new ItemsView(scene);
const ctf = new CtfView(scene);
let matchMode = 'tdm';
const avatars = new Map();
const me = new LocalPlayer({ renderer, scene, camera, map, net, world, hud, items, avatars });
// real-time shadows: on by default except on Quest 2 (keep 72 fps there)
const shadowDefault = !/Quest 2/.test(navigator.userAgent) && params.get('shadows') !== '0';
let shadowsOn = shadowDefault;
world.setShadows(shadowsOn);
const vote = new VoteUI(net);
net.on('vote', async (m) => { await Promise.all((m.options || []).map(ensureMap)); vote.onVote(m); });

// Swap the whole world for another map (works mid-session, also in VR).
function switchMap(id) {
  if (!MAPS[id] || id === map.id) return;
  world.dispose();
  map = MAPS[id];
  world = new World(scene, map, renderer);
  world.setShadows(shadowsOn);
  wireWorld();
  me.map = map; me.world = world;
  me.visor.material.map = world.splatTexture;
  items.clear();
  for (const [, line] of debugLines) scene.remove(line);
  debugLines.clear();
  if (window.pb) window.pb.world = world;
  $('map-label').textContent = map.name;
  if (started) hud.message(map.name, 2.5);
}
net.on('map', async (m) => { if (!MAPS[m.id] || MAPS[m.id].custom) await fetchMap(m.id); switchMap(m.id); });
me.rig.position.set(0, 7, map.halfZ + 6);
me.pitch = -0.45;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- game state ------------------------------------------------------------------
let roster = new Map();
let myId = 0, started = false, debugOn = params.has('debug');
const debugLines = new Map();
if (debugOn) window.pb = { me, world, net, avatars, scene, camera, renderer };

function nameOf(id) { return roster.get(id)?.name ?? '?'; }
function colorOf(id) { const p = roster.get(id); return p ? TEAM_COLORS[p.team] : 0xffffff; }

net.on('welcome', async (m) => {
  await ensureMap(m.map);
  myId = m.id;
  me.myId = m.id;
  $('room-label').textContent = `Room: ${m.room}`;
  switchMap(m.map);
  $('map-label').textContent = map.name;
  if (m.spectator) me.initSpectator();
  else me.setTeam(m.team);
  syncDebugUI(m.settings);
});

net.on('roster', (m) => {
  roster = new Map(m.players.map((p) => [p.id, p]));
  for (const [id, av] of avatars) {
    const p = roster.get(id);
    if (!p || p.team !== av.team) { av.dispose(); avatars.delete(id); }
  }
  for (const p of m.players) {
    if (p.id === myId) { if (p.team !== me.team && !me.spectator) me.setTeam(p.team); continue; }
    if (!avatars.has(p.id)) {
      const av = new Avatar(scene, p);
      av.onStep = (pos) => {
        const p = [pos.x, av.feetY + 0.5, pos.z];
        if (inBush(map, p)) sound.rustle(p, false); else sound.footstep([pos.x, av.feetY + 0.05, pos.z], false);
      };
      av.onSpawn = (pos) => sound.spawn([pos.x, pos.y, pos.z]);
      avatars.set(p.id, av);
    }
  }
  syncDebugUI(m.settings);
  renderScoreboard();
});

net.on('spawn', (m) => me.onSpawn(m));

net.on('shot', (m) => {
  const life = WEAPONS[m.w]?.life ?? 2.0;
  for (const p of m.pellets) world.addBall(p.slice(0, 3), p.slice(3, 6), m.team, life);
  avatars.get(m.by)?.onShoot(m.w);
  if (m.pellets[0]) sound.weapon(m.w, m.pellets[0].slice(0, 3), false);
});

net.on('splat', (m) => {
  world.addSplat(m.p, m.n, m.team);
  if (m.shield) sound.shieldBlock(m.p); else sound.splat(m.p);
});
net.on('shieldBreak', (m) => {
  world.burst(m.p, m.team, 25);
  sound.shieldBreak(m.p);
  if (m.id === myId) hud.message('Your shield broke!', 1.2);
});
net.on('boom', (m) => { world.explode(m.p, m.team, m.r); sound.explosion(m.p); });
net.on('launch', (m) => { sound.launch(m.p, false); avatars.get(m.by)?.onShoot(W.LAUNCHER); });
net.on('caught', (m) => {
  sound.grab();
  hud.killfeed(`<b style="color:${hex(colorOf(m.by))}">${nameOf(m.by)}</b> caught a grenade from <b style="color:${hex(colorOf(m.from))}">${nameOf(m.from)}</b>`);
  if (m.by === myId) hud.hit('Grenade Caught!');
});
net.on('minePlaced', (m) => sound.minePlace(m.p));
net.on('bonk', (m) => { sound.bonk(m.p); });
function wireWorld() {
  world.onBounce = (p) => sound.bounce(p);
  world.onThrow = (p) => sound.whoosh(p, false);
}
wireWorld();

net.on('elim', (m) => {
  const v = roster.get(m.victim), k = roster.get(m.by);
  if (v) v.outs++;
  if (k && v && k.team !== v.team) k.kills++;
  const icon = WEAPON_ICON[m.w] || 'paint';
  hud.killfeed(`<b style="color:${hex(colorOf(m.by))}">${nameOf(m.by)}</b> [${icon}] <b style="color:${hex(colorOf(m.victim))}">${nameOf(m.victim)}</b>`);
  if (m.victim === myId) { me.onEliminated(nameOf(m.by), colorOf(m.by)); sound.youOut(); }
  if (m.by === myId && m.victim !== myId) sound.killConfirm();
  const vav = avatars.get(m.victim);
  if (vav) {
    vav.onHit();
    const c = vav.headPos, kt = k ? k.team : 0;
    world.burst([c.x, c.y - 0.4, c.z], kt, 30);
    sound.pop([c.x, c.y - 0.3, c.z]);
    world.addKO([c.x, c.y + 0.45, c.z], vav.team, m.by === myId);
  }
  if (m.by === myId && m.victim !== myId) {
    hud.hit(`You Hit ${nameOf(m.victim)}`);
    for (const h of me.hands) me.pulse(h, 0.3, 30);
  }
  renderScoreboard();
});

let lastMatchState = 'playing';
net.on('match', (m) => {
  const modeChanged = m.mode !== matchMode;
  matchMode = m.mode || 'tdm';
  ctf.setup(m.flagHomes);
  if (matchMode !== 'ctf') hud.setFlags('');
  if (m.state === 'playing' && (modeChanged || m.state !== lastMatchState) && matchMode === 'ctf' && started) {
    setTimeout(() => hud.message('Capture the Flag: bring their flag to your base', 3.5), 600);
  }
  if (m.state !== lastMatchState) {
    if (m.state === 'playing') { sound.whistle(); if (lastMatchState === 'waiting') hud.message('Match started!', 2.5); }
    else if (m.state === 'ended') sound.fanfare(m.winner === me.team);
    else if (started) hud.message('Warm-up: waiting for other players', 4);
  }
  lastMatchState = m.state;
  me.matchPlaying = m.state !== 'ended';
  hud.setScore(m.score, m.timeLeft);
  if (m.state === 'ended') {
    const text = (m.winner < 0 ? 'Draw!' : `${TEAM_NAMES[m.winner]} team wins!`) + (matchMode === 'ctf' ? ` (${m.score[0]}–${m.score[1]} captures)` : '');
    hud.message(`${text}  Next match soon…`, 8);
  } else {
    world.clearSplats();
    for (const p of roster.values()) { p.kills = 0; p.outs = 0; }
    renderScoreboard();
  }
});

// ---- Capture the Flag events ------------------------------------------------------
const teamSpan = (t, text) => `<b style="color:${hex(TEAM_COLORS[t])}">${text}</b>`;
net.on('flag', (m) => {
  const mine = !me.spectator && m.team === me.team;         // it's about our own flag
  const who = m.by ? nameOf(m.by) : '';
  const flagName = teamSpan(m.team, `${TEAM_NAMES[m.team]} flag`);
  if (m.ev === 'take') {
    hud.killfeed(`${teamSpan(roster.get(m.by)?.team ?? 1 - m.team, who)} took the ${flagName}`);
    if (m.by === myId) hud.message('You have the flag! Bring it to your base', 3);
    else if (mine) hud.message(`${who} took your flag!`, 2.5);
    else hud.message(`${who} has the ${TEAM_NAMES[m.team]} flag!`, 2);
    sound.alarm(mine);   // your flag: klaxon; theirs: rising alert
  } else if (m.ev === 'drop') {
    hud.killfeed(`The ${flagName} was dropped`);
    hud.message(mine ? 'Your flag was dropped: touch it to send it home' : 'Flag dropped!', 2.2);
    sound.drop();
  } else if (m.ev === 'return') {
    hud.killfeed(`The ${flagName} is back at base`);
    if (mine || m.by === myId) hud.message(m.by === myId ? 'You returned your flag' : 'Your flag is back at base', 2);
    sound.beep(false);
  } else if (m.ev === 'capture') {
    const t = 1 - m.team;
    hud.killfeed(`${teamSpan(t, who)} captured the ${flagName}!`);
    if (m.score) hud.setScore(m.score, hud.timeLeft);
    if (m.by === myId) hud.hit('Flag Captured!');
    hud.message(`${TEAM_NAMES[t]} team scores!`, 2.5);
    sound.trumpet(me.spectator || t === me.team);
  }
});

function flagLine(fl) {
  if (matchMode !== 'ctf' || !fl || fl.length < 2) return '';
  const desc = (t) => {
    const [st, holder] = fl[t];
    if (st === 0) return 'at base';
    if (st === 2) return 'dropped';
    return holder === myId ? 'YOU have it' : `${nameOf(holder)} has it`;
  };
  if (me.spectator) return `${teamSpan(0, 'Orange flag')}: ${desc(0)} · ${teamSpan(1, 'Cyan flag')}: ${desc(1)}`;
  return `${teamSpan(me.team, 'Your flag')}: ${desc(me.team)} · ${teamSpan(1 - me.team, 'Their flag')}: ${desc(1 - me.team)}`;
}

net.on('close', (e) => {
  hud.message(`${e.reason ? `Disconnected: ${e.reason}` : 'Disconnected from server'} — reload the page`, 0);
});

// ---- lobby --------------------------------------------------------------------------
$('name').value = params.get('name') || localStorageGet('pb-name') || `Player${(Math.random() * 900 + 100) | 0}`;
$('room').value = params.get('room') || 'public';
// "find" waits with whoever else is looking; "room" is the private room code, as on a local network
$('how').value = params.has('room') ? 'room' : (params.get('how') || localStorageGet('pb-how') || (serverInfo.network ? 'find' : 'room'));
const showHow = () => document.querySelectorAll('.private-only').forEach((el) => { el.style.display = $('how').value === 'room' ? '' : 'none'; });
$('how').onchange = showHow;
showHow();
if (serverInfo.regions.length > 1) {
  $('region-box').style.display = '';
  $('region').innerHTML = '<option value="">Closest server, join anyone waiting</option>' + serverInfo.regions.map((r) => `<option value="${r.id}">${r.id.replace(/[<>&"]/g, '')} only</option>`).join('');
}
$('bots').value = params.get('bots') ?? '7';
$('difficulty').value = params.get('difficulty') || 'normal';
$('mode').value = MODES[params.get('mode')] ? params.get('mode') : (localStorageGet('pb-mode') || 'tdm');
$('shadows').checked = shadowDefault;
const opt = (m) => `<option value="${m.id}">${m.name.replace(/[<>&]/g, '')}</option>`;
const customs = Object.values(MAPS).filter((m) => m.custom);
const mapOptions = Object.values(MAPS).filter((m) => !m.custom).map(opt).join('') + (customs.length ? `<optgroup label="Your maps">${customs.map(opt).join('')}</optgroup>` : '');
$('map').innerHTML = mapOptions;
$('dbg-map').innerHTML = mapOptions;
$('map').value = params.get('map') && MAPS[params.get('map')] ? params.get('map') : DEFAULT_MAP;
const showLobbyMap = () => { if (!started) switchMap($('map').value); };
$('map').onchange = showLobbyMap;
showLobbyMap();
$('gripmode').value = localStorageGet('pb-grip2') || 'toggle';
$('volume').value = localStorageGet('pb-volume') ?? '80';
sound.setVolume(Number($('volume').value) / 100);
$('volume').oninput = () => { sound.setVolume(Number($('volume').value) / 100); localStorageSet('pb-volume', $('volume').value); };

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

// Time one request to each region and return the quickest.
async function closestRegion() {
  const timed = await Promise.all(serverInfo.regions.map(async (r) => {
    const t = performance.now();
    try { await fetch(`${r.url.replace(/^ws/, 'http')}/api/ping`, { mode: 'no-cors', cache: 'no-store' }); return { id: r.id, ms: performance.now() - t }; } catch { return { id: r.id, ms: Infinity }; }
  }));
  return timed.sort((a, b) => a.ms - b.ms)[0]?.id || '';
}

// Ask the website which game server and room to join.
async function findGame(spectate) {
  const chosen = $('region').value;
  const r = await fetch('/api/match', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      find: !spectate && $('how').value === 'find', mode: $('mode').value, room: $('room').value,
      region: chosen || (serverInfo.regions.length > 1 ? await closestRegion() : ''), strict: !!chosen,
    }),
  });
  const game = await r.json();
  if (!r.ok) throw new Error(game.error || r.statusText);
  return game;
}

async function start(mode) {
  if (started) return;
  let session = null;
  if (mode === 'vr') {
    try {
      session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    } catch (e) {
      alert('Could not start VR: ' + e.message);
      return;
    }
  }
  started = true;
  sound.init();
  localStorageSet('pb-name', $('name').value);
  localStorageSet('pb-mode', $('mode').value);
  if (mode !== 'spectate') localStorageSet('pb-how', $('how').value);
  me.name = $('name').value;
  me.gripMode = $('gripmode').value;
  localStorageSet('pb-grip2', me.gripMode);
  if ($('shadows').checked !== shadowsOn) { shadowsOn = $('shadows').checked; world.setShadows(shadowsOn); }
  $('lobby').style.display = 'none';
  $('hud').style.display = 'block';
  try {
    const game = await findGame(mode === 'spectate');
    await net.connect({
      name: $('name').value, room: game.room, ticket: game.ticket, spectate: mode === 'spectate', map: $('map').value,
      bots: mode === 'spectate' ? 8 : Number($('bots').value), difficulty: $('difficulty').value, mode: $('mode').value,
    }, game.server);
  } catch (e) {
    hud.message(`Could not connect: ${e.message || 'server not reachable'}`, 0);
  }
  if (session) {
    session.addEventListener('end', () => { me.onSessionEnd(); $('hud').style.display = 'block'; $('vr-again').style.display = 'block'; });
    await renderer.xr.setSession(session);
    me.onSessionStart();
  } else {
    renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  }
}

$('play').onclick = () => start('desktop');
$('spectate').onclick = () => start('spectate');
$('enter-vr').onclick = () => start('vr');
$('vr-again').onclick = async () => {
  sound.init();
  const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
  session.addEventListener('end', () => { me.onSessionEnd(); $('vr-again').style.display = 'block'; });
  await renderer.xr.setSession(session);
  me.onSessionStart();
  $('vr-again').style.display = 'none';
};

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (ok) { $('enter-vr').disabled = false; $('enter-vr').textContent = 'Enter VR'; }
    else $('vr-note').textContent = 'VR not available in this browser — open this page in the Meta Quest Browser.';
  });
} else {
  $('vr-note').textContent = window.isSecureContext
    ? 'WebXR not supported in this browser.'
    : '';
  if (!window.isSecureContext) {
    const url = `https://${location.hostname}:8443${location.pathname}${location.search}`;
    $('vr-note').innerHTML = `VR needs the secure address: <a href="${url}" style="color:#ffd34d">${url}</a> (accept the certificate warning once).`;
  }
}
if (params.has('autostart')) start(params.get('spectate') ? 'spectate' : 'desktop');

// ---- scoreboard & debug panel ---------------------------------------------------------
function renderScoreboard() {
  const rows = [0, 1].map((t) => {
    const ps = [...roster.values()].filter((p) => p.team === t).sort((a, b) => b.kills - a.kills);
    return `<div class="sb-team" style="border-color:${hex(TEAM_COLORS[t])}"><h3 style="color:${hex(TEAM_COLORS[t])}">${TEAM_NAMES[t]}</h3>` +
      ps.map((p) => `<div class="sb-row${p.id === myId ? ' me' : ''}"><span>${p.bot ? '🤖 ' : ''}${escapeHtml(p.name)}</span><span>${p.kills} / ${p.outs}</span></div>`).join('') +
      '</div>';
  });
  $('scoreboard').innerHTML = rows.join('');
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').style.display = 'flex'; }
  if (e.code === 'KeyM' && started) hud.message(sound.toggleMute() ? 'Sound muted (M)' : 'Sound on', 1.2);
  if (e.code === 'Backquote') { debugOn = !debugOn; $('debug').style.display = debugOn ? 'block' : 'none'; }
});
addEventListener('keyup', (e) => { if (e.code === 'Tab') $('scoreboard').style.display = 'none'; });
$('debug').style.display = debugOn ? 'block' : 'none';

function syncDebugUI(s) {
  if (!s) return;
  $('dbg-bots').value = String(s.bots);
  $('dbg-diff').value = s.difficulty;
  $('dbg-freeze').checked = s.freeze;
  $('dbg-noshoot').checked = s.noshoot;
  $('dbg-paths').checked = s.debug;
  $('dbg-map').value = map.id;
  if (s.mode) $('dbg-mode').value = s.mode;
}
const sendCfg = () => net.send({
  type: 'cfg', bots: Number($('dbg-bots').value), difficulty: $('dbg-diff').value,
  freeze: $('dbg-freeze').checked, noshoot: $('dbg-noshoot').checked, debug: $('dbg-paths').checked,
});
for (const id of ['dbg-bots', 'dbg-diff', 'dbg-freeze', 'dbg-noshoot', 'dbg-paths']) $(id).onchange = sendCfg;
$('dbg-map').onchange = () => net.send({ type: 'cfg', map: $('dbg-map').value });
$('dbg-mode').onchange = () => net.send({ type: 'cfg', mode: $('dbg-mode').value });

function updateDebugLines(dbg) {
  const seen = new Set();
  for (const [id, path, target] of dbg || []) {
    seen.add(id);
    const av = avatars.get(id);
    if (!av) continue;
    const pts = [new THREE.Vector3(av.headPos.x, 0.1, av.headPos.z), ...path.map(([x, z]) => new THREE.Vector3(x, 0.1, z))];
    let line = debugLines.get(id);
    if (!line) {
      line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: TEAM_COLORS[av.team] }));
      scene.add(line); debugLines.set(id, line);
    }
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }
  for (const [id, line] of debugLines) if (!seen.has(id)) { scene.remove(line); debugLines.delete(id); }
}

// ---- main loop -------------------------------------------------------------------------
const clock = new THREE.Clock();
let fpsFrames = 0, fpsTime = 0, fps = 0, lastTl = 0, lastItemSnap = null;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }

  if (!started) {
    // slow orbit behind the lobby
    me.rig.rotation.y += dt * 0.05;
    me.rig.position.set(Math.sin(me.rig.rotation.y) * 26, 9, Math.cos(me.rig.rotation.y) * 26);
    camera.rotation.set(-0.35, 0, 0);
  } else {
    me.update(dt);
    const sample = net.sample();
    for (const [id, arr] of sample) {
      if (id === myId) continue;
      avatars.get(id)?.apply(arr);
    }
    for (const av of avatars.values()) av.animate(dt);
    items.update(dt);
    // bushes: shake when someone pushes through; enemies hiding inside lose their name tag
    const movers = [];
    for (const av of avatars.values()) {
      if (!av.alive) continue;
      movers.push([av.headPos.x, av.headPos.z, Math.hypot(av.vel.x, av.vel.z)]);
      const hidden = av.team !== me.team && !me.spectator && !!inBush(map, [av.headPos.x, av.headPos.y - 0.3, av.headPos.z]);
      av.label.visible = !hidden;
    }
    if (me.alive && !me.spectator) {
      const p = me.rig.position, last = me.lastBushPos || p.clone();
      movers.push([p.x, p.z, last.distanceTo(p) / Math.max(dt, 0.001)]);
      me.lastBushPos = p.clone();
    }
    world.updateBushes(dt, movers);
    vote.attach(camera);
    vote.update(renderer.xr.isPresenting, me.hands);
    const snap = net.latest();
    if (snap) {
      if (snap.st !== 'ended' && snap.tl !== lastTl && snap.tl <= 10 && snap.tl > 0) sound.beep(snap.tl <= 3);
      lastTl = snap.tl;
      hud.setScore(snap.sc, snap.tl);
      world.updateGrenades(snap.gr, 0.5);
      me.liveGrenades = snap.gr;
      if (snap.mn) world.updateMines(snap.mn);
      if (snap.it && snap !== lastItemSnap) { items.sync(snap.it); if (!me.spectator) me.syncItems(snap.it); lastItemSnap = snap; }
      ctf.update(dt, snap.it, (id) => (id === myId ? me.rig.position.clone().setY(me.rig.position.y + 1.6) : avatars.get(id)?.headPos));
      hud.setFlags(snap.st === 'waiting' ? `Waiting for players: ${snap.pl.length}/8 · starts in ${snap.tl}s, bots fill empty places` : flagLine(snap.fl));
      me.matchPlaying = snap.st !== 'ended';
      if (snap.dbg) updateDebugLines(snap.dbg);
      else if (!snap.dbg && debugLines.size && !$('dbg-paths').checked) updateDebugLines([]);
    }
    world.update(dt, (p, team) => {
      for (const av of avatars.values()) if (av.team !== team && av.contains(p)) return true;
      return false;
    });
    hud.setDebug(debugOn ? `fps ${fps} · ping ${Math.round(net.rtt)}ms · players ${roster.size}` : '');
    hud.update();
  }
  if (started && !me.spectator) me.renderScope(renderer, scene);
  sound.updateListener(camera);
  world.cameraPos = camera.getWorldPosition(world.cameraPos || new THREE.Vector3());
  renderer.render(scene, camera);
});
