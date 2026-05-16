/**
 * Multiplayer Signaling + Lobby Server
 * Uses the 'ws' library: npm install ws
 * Run with: node server.js
 *
 * Message protocol: all messages are JSON with a { type, ...payload } shape.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    const safePath = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(__dirname, safePath);
    const ext = path.extname(filePath);
    const types = { '.html':'text/html', '.js':'application/javascript' };
  
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
      res.end(data);
    });
  });
  
  const wss = new WebSocketServer({ server });
  server.listen(PORT);
// ─── State ───────────────────────────────────────────────────────────────────

/**
 * sessions: Map<sessionId, { id, socket, name, roomCode }>
 * rooms:    Map<roomCode, Room>
 *
 * Room shape:
 * {
 *   code:       string,
 *   host:       sessionId,
 *   players:    Map<sessionId, { id, name, ready }>,
 *   chat:       [{ from, name, text, ts }],
 *   phase:      'lobby' | 'starting' | 'ingame',
 *   maxPlayers: number,
 * }
 */
const sessions = new Map();
const rooms    = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

function generateRoomCode() {
  let code;
  do { code = generateId(6); } while (rooms.has(code));
  return code;
}

function send(socket, msg) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function err(socket, message, code = 'ERR') {
  send(socket, { type: 'error', code, message });
}

/** Send a message to every player in a room. */
function broadcast(roomCode, msg, excludeId = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const [id] of room.players) {
    if (id === excludeId) continue;
    const session = sessions.get(id);
    if (session) send(session.socket, msg);
  }
}

/** Serialise a room's lobby state for the wire. */
function lobbySnapshot(room) {
  return {
    type:       'lobby_state',
    code:       room.code,
    host:       room.host,
    phase:      room.phase,
    maxPlayers: room.maxPlayers,
    players: [...room.players.values()],
    chat:       room.chat.slice(-50),   // last 50 messages
  };
}

/** Push the current lobby snapshot to every player in the room. */
function syncLobby(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const snap = lobbySnapshot(room);
  for (const [id] of room.players) {
    const session = sessions.get(id);
    if (session) send(session.socket, snap);
  }
}

/** Remove a player from their room; clean up empty rooms; transfer host if needed. */
function removeFromRoom(sessionId) {
  const session = sessions.get(sessionId);
  if (!session?.roomCode) return;

  const room = rooms.get(session.roomCode);
  if (!room) return;

  room.players.delete(sessionId);
  const code = session.roomCode;
  session.roomCode = null;

  if (room.players.size === 0) {
    // Room is empty — delete it.
    rooms.delete(code);
    return;
  }

  // Transfer host if needed.
  if (room.host === sessionId) {
    room.host = room.players.keys().next().value;
    const newHost = sessions.get(room.host);
    if (newHost) send(newHost.socket, { type: 'host_transferred', you: true });
  }

  syncLobby(code);
}

// ─── Message handlers ─────────────────────────────────────────────────────────

const handlers = {

  /**
   * set_name { name }
   * Client sets (or updates) their display name before joining a room.
   */
  set_name(session, { name }) {
    if (!name || typeof name !== 'string') return err(session.socket, 'Invalid name');
    session.name = name.trim().slice(0, 24);
    send(session.socket, { type: 'name_set', name: session.name });

    // Update name in any room the player is already in.
    if (session.roomCode) {
      const room = rooms.get(session.roomCode);
      if (room?.players.has(session.id)) {
        room.players.get(session.id).name = session.name;
        syncLobby(session.roomCode);
      }
    }
  },

  /**
   * create_room { maxPlayers? }
   * Creates a new room; caller becomes host.
   */
  create_room(session, { maxPlayers = 4 } = {}) {
    if (session.roomCode) return err(session.socket, 'Already in a room', 'ALREADY_IN_ROOM');
    if (!session.name)    return err(session.socket, 'Set your name first', 'NO_NAME');

    const code = generateRoomCode();
    const room = {
      code,
      host:       session.id,
      players:    new Map([[session.id, { id: session.id, name: session.name, ready: false }]]),
      chat:       [],
      phase:      'lobby',
      maxPlayers: Math.min(Math.max(maxPlayers, 2), 16),
    };
    rooms.set(code, room);
    session.roomCode = code;

    send(session.socket, { type: 'room_created', code });
    syncLobby(code);
  },

  /**
   * join_room { code }
   * Joins an existing room by code.
   */
  join_room(session, { code }) {
    if (session.roomCode) return err(session.socket, 'Already in a room', 'ALREADY_IN_ROOM');
    if (!session.name)    return err(session.socket, 'Set your name first', 'NO_NAME');
    if (!code)            return err(session.socket, 'No room code provided');

    const room = rooms.get(code.toUpperCase());
    if (!room)                                    return err(session.socket, 'Room not found',  'ROOM_NOT_FOUND');
    if (room.phase !== 'lobby')                   return err(session.socket, 'Game already started', 'GAME_STARTED');
    if (room.players.size >= room.maxPlayers)     return err(session.socket, 'Room is full', 'ROOM_FULL');

    room.players.set(session.id, { id: session.id, name: session.name, ready: false });
    session.roomCode = code.toUpperCase();

    // Notify existing players that someone joined.
    broadcast(session.roomCode, { type: 'player_joined', id: session.id, name: session.name }, session.id);

    // Send the new player the current lobby snapshot and the IDs of existing
    // peers so the client can initiate WebRTC offers to each of them.
    const existingPeers = [...room.players.keys()].filter(id => id !== session.id);
    send(session.socket, { type: 'joined_room', code: session.roomCode, existingPeers });
    syncLobby(session.roomCode);
  },

  /**
   * leave_room {}
   * Voluntarily leave the current room.
   */
  leave_room(session) {
    if (!session.roomCode) return err(session.socket, 'Not in a room');
    removeFromRoom(session.id);
    send(session.socket, { type: 'left_room' });
  },

  /**
   * set_ready { ready }
   * Toggle ready state. The host doesn't need to ready up.
   */
  set_ready(session, { ready }) {
    const room = rooms.get(session.roomCode);
    if (!room) return err(session.socket, 'Not in a room');

    const player = room.players.get(session.id);
    if (!player) return;
    player.ready = !!ready;
    syncLobby(session.roomCode);
  },

  /**
   * chat { text }
   * Send a chat message to the lobby.
   */
  chat(session, { text }) {
    const room = rooms.get(session.roomCode);
    if (!room) return err(session.socket, 'Not in a room');
    if (!text || typeof text !== 'string') return;

    const msg = { from: session.id, name: session.name, text: text.trim().slice(0, 300), ts: Date.now() };
    room.chat.push(msg);

    broadcast(session.roomCode, { type: 'chat', ...msg }, session.id);
    // Also echo back to sender so they see their own message confirmed.
    send(session.socket, { type: 'chat', ...msg });
  },

  /**
   * kick { targetId }
   * Host-only: remove a player from the room.
   */
  kick(session, { targetId }) {
    const room = rooms.get(session.roomCode);
    if (!room)                      return err(session.socket, 'Not in a room');
    if (room.host !== session.id)   return err(session.socket, 'Not the host', 'NOT_HOST');
    if (targetId === session.id)    return err(session.socket, 'Cannot kick yourself');
    if (!room.players.has(targetId)) return err(session.socket, 'Player not in room');

    const target = sessions.get(targetId);
    if (target) {
      send(target.socket, { type: 'kicked' });
      target.roomCode = null;
    }
    room.players.delete(targetId);
    syncLobby(session.roomCode);
  },

  /**
   * start_game {}
   * Host-only: begin the WebRTC handshake phase.
   * Server marks the room as 'starting' then instructs the host to send
   * WebRTC offers to each peer. The actual offer/answer/ICE flow goes through
   * the signal handler below.
   */
  start_game(session) {
    const room = rooms.get(session.roomCode);
    if (!room)                    return err(session.socket, 'Not in a room');
    if (room.host !== session.id) return err(session.socket, 'Not the host', 'NOT_HOST');
    if (room.players.size < 2)    return err(session.socket, 'Need at least 2 players');

    // Check all non-host players are ready.
    for (const [id, player] of room.players) {
      if (id !== room.host && !player.ready) {
        return err(session.socket, 'Not all players are ready', 'NOT_ALL_READY');
      }
    }

    room.phase = 'starting';
    syncLobby(session.roomCode);

    // Tell every peer who they need to connect to.
    // Convention: the player with the lower session ID sends the offer.
    // This avoids both sides sending offers simultaneously (glare).
    const peerIds = [...room.players.keys()];
    for (const id of peerIds) {
      const s = sessions.get(id);
      if (!s) continue;
      const peersToOfferTo = peerIds.filter(p => p < id);  // only offer to lower IDs
      send(s.socket, { type: 'start_handshake', peers: peerIds.filter(p => p !== id), offerTo: peersToOfferTo });
    }
  },

  /**
   * signal { targetId, signal }
   * Relay a WebRTC signaling payload (offer, answer, or ICE candidate) to
   * a specific peer. The server never inspects `signal` — it's opaque.
   */
  signal(session, { targetId, signal }) {
    if (!session.roomCode) return err(session.socket, 'Not in a room');

    const room = rooms.get(session.roomCode);
    if (!room?.players.has(targetId)) return err(session.socket, 'Target not in room');

    const target = sessions.get(targetId);
    if (!target) return err(session.socket, 'Target not connected');

    send(target.socket, { type: 'signal', fromId: session.id, signal });
  },

  /**
   * peer_connected { peerId }
   * A peer reports that its DataChannel to another peer is open.
   * When all expected connections are up the server transitions to 'ingame'.
   */
  peer_connected(session, { peerId }) {
    const room = rooms.get(session.roomCode);
    if (!room || room.phase !== 'starting') return;
  
    if (!room._connected) room._connected = new Set();
    const key = [session.id, peerId].sort().join(':');
    room._connected.add(key);
  
    const n = room.players.size;
    const expected = (n * (n - 1)) / 2;
    if (room._connected.size >= expected) {
      room.phase = 'ingame';
      delete room._connected;
      broadcast(session.roomCode, { type: 'game_start' });
    }
  },

  /**
   * find_match {}
   * Simple public matchmaking: join a waiting queue.
   * When enough players are queued, auto-create a room and notify all of them.
   */
  find_match(session) {
    if (session.roomCode) return err(session.socket, 'Already in a room', 'ALREADY_IN_ROOM');
    if (!session.name)    return err(session.socket, 'Set your name first', 'NO_NAME');

    matchmakingQueue.add(session.id);
    send(session.socket, { type: 'queued', position: matchmakingQueue.size });
    tryMatchmake();
  },

  /**
   * cancel_match {}
   * Leave the matchmaking queue.
   */
  cancel_match(session) {
    matchmakingQueue.delete(session.id);
    send(session.socket, { type: 'queue_cancelled' });
  },
};

// ─── Matchmaking ──────────────────────────────────────────────────────────────

const MATCH_SIZE = 2;   // change to desired default lobby size
const matchmakingQueue = new Set();

function tryMatchmake() {
  if (matchmakingQueue.size < MATCH_SIZE) return;

  const chosen = [...matchmakingQueue].slice(0, MATCH_SIZE);
  chosen.forEach(id => matchmakingQueue.delete(id));

  // Use the first player as a synthetic "host" to create the room.
  const hostSession = sessions.get(chosen[0]);
  if (!hostSession) return tryMatchmake();   // session disappeared, try again

  handlers.create_room(hostSession, { maxPlayers: MATCH_SIZE });

  const code = hostSession.roomCode;
  for (let i = 1; i < chosen.length; i++) {
    const s = sessions.get(chosen[i]);
    if (s) handlers.join_room(s, { code });
  }

  broadcast(code, { type: 'match_found', code });
}

// ─── Connection lifecycle ─────────────────────────────────────────────────────

wss.on('connection', (socket) => {
  const id = generateId();
  const session = { id, socket, name: null, roomCode: null };
  sessions.set(id, session);

  send(socket, { type: 'connected', id });
  console.log(`[+] ${id} connected  (${sessions.size} total)`);

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch { return err(socket, 'Invalid JSON'); }

    const { type, ...payload } = msg;
    const handler = handlers[type];
    if (!handler) return err(socket, `Unknown message type: ${type}`, 'UNKNOWN_TYPE');

    try { handler(session, payload); }
    catch (e) {
      console.error(`Error handling '${type}' from ${id}:`, e);
      err(socket, 'Internal server error', 'SERVER_ERROR');
    }
  });

  socket.on('close', () => {
    matchmakingQueue.delete(id);
    removeFromRoom(id);
    sessions.delete(id);
    console.log(`[-] ${id} disconnected  (${sessions.size} total)`);
  });

  socket.on('error', (e) => console.error(`Socket error for ${id}:`, e));
});

console.log(`Server listening on ws://localhost:${PORT}`);