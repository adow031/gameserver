/**
 * gameState.js  —  Host-side game state manager
 *
 * The host peer owns the authoritative game state and runs the round clock.
 * Other peers send inputs; the host applies them, then broadcasts results.
 *
 * Usage (host only):
 *   const game = new GameState(playerIds, broadcastFn, sendToFn);
 *   game.start();
 *
 * Requires upgrades.js to be loaded first (UPGRADES, canPickUpgrade, etc.)
 */
const _freshDerivedStats = typeof freshDerivedStats !== 'undefined'
  ? freshDerivedStats
  : require('./upgrades').freshDerivedStats;

const ROUND_DURATION_S   = 90;
const UPGRADE_TIMEOUT_S  = 30;   // max time to spend picks before auto-skip
const SURGE_ROUNDS       = [3, 6, 9];
const TOTAL_ROUNDS       = 10;
const BASE_PICKS_PER_ROUND = 1;
const MATCH_SIZE_DEFAULT = 4;

// Points awarded
const PTS = {
  kill:           10,
  nodeTickPerSec:  1,   // per node held, per second
  comebackKill:    5,   // extra for killing a player with more score
  nodeMajority:    3,   // bonus if you hold more nodes than anyone
};

const SURGE_EVENTS = [
  { id:'signal_storm',  name:'Signal Storm',  desc:'Controls temporarily inverted for all players',       duration:8  },
  { id:'bounty',        name:'Bounty',        desc:'One player has a price on their head — worth 3× points', duration:20 },
  { id:'power_spike',   name:'Power Spike',   desc:'Nodes award 3× score for 20 seconds',                duration:20 },
  { id:'overclock_all', name:'System Surge',  desc:'All fire rates doubled for 12 seconds',               duration:12 },
  { id:'blackout',      name:'Blackout',      desc:'Minimap disabled for all players',                    duration:15 },
];

// ─────────────────────────────────────────────────────────────────────────────

class GameState {
  /**
   * @param {string[]} playerIds   - All player session IDs
   * @param {Function} broadcast   - broadcast(msg) → send to all peers
   * @param {Function} sendTo      - sendTo(peerId, msg) → send to one peer
   * @param {object}   nodes       - Initial node definitions [{ id, x, y }]
   */
  constructor(playerIds, broadcast, sendTo, nodes = []) {
    this.broadcast = broadcast;
    this.sendTo    = sendTo;

    this.round     = 0;
    this.phase     = 'pregame';   // pregame | active | surge | upgrade | gameover
    this.timer     = null;
    this.timeLeft  = 0;

    // Per-player state
    this.players = {};
    for (const id of playerIds) {
      this.players[id] = {
        id,
        score:        0,
        kills:        0,
        deaths:       0,
        roundKills:   0,     // reset each round
        bonusPicks:   0,     // picks earned via kills/objectives this round
        basePicks:    0,     // the round's standard 1 pick (set during upgrade phase)
        upgrades:     new Map(),   // upgradeId → rank
        derivedStats: _freshDerivedStats(),
        alive:        true,
        hp:           100,
        position:     { x: 0, y: 0 },
        capturingNode: null,
        pendingPicks:  0,    // picks still to spend in upgrade phase
      };
    }

    // Node state
    this.nodes = {};
    for (const n of nodes) {
      this.nodes[n.id] = { ...n, owner: null, captureProgress: 0, contestedBy: [] };
    }

    this.surgeActive = null;
    this.bountyTarget = null;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  start() {
    // INITIAL CLASS SELECT ON GAME LAUNCH
    // 3 free picks so players can choose their starting class/path
    this.phase = 'upgrade';
    for (const p of Object.values(this.players)) {
      p.pendingPicks = 3;     // initial class choice picks
      p.basePicks    = 0;
      p.bonusPicks   = 0;
    }

    // Tell every client to show the upgrade screen immediately
    for (const [id, p] of Object.entries(this.players)) {
      const available = getAvailableUpgrades(p);   // assumes this function exists in upgrades.js
      this.sendTo(id, {
        type:       'upgrade_phase',
        picks:      p.pendingPicks,
        available,
        upgrades:   Object.fromEntries(p.upgrades),
        stats:      p.derivedStats,
        isInitialClassSelect: true   // ← new flag so upgradeScreen can change the title
      });
    }
  }

  /** Called by the game loop (every ~100ms) with player input snapshot. */
  tick(dtMs, inputSnapshot) {
    if (this.phase !== 'active' && this.phase !== 'surge') return;

    this.timeLeft -= dtMs / 1000;
    this._applyInputs(inputSnapshot);
    this._tickNodes(dtMs / 1000);
    this._tickSurge(dtMs / 1000);

    if (this.timeLeft <= 0) {
      this._endRound();
    } else {
      // Broadcast state update ~10× per second (caller throttles this)
      this.broadcast({ type: 'game_tick', state: this._snapshot() });
    }
  }

  /** Host received a pick_upgrade message from a peer. */
  handleUpgradePick(playerId, upgradeId) {
    if (this.phase !== 'upgrade') return this._err(playerId, 'Not in upgrade phase');

    const player = this.players[playerId];
    if (!player) return;
    if (player.pendingPicks < 1) return this._err(playerId, 'No picks remaining');

    const result = canPickUpgrade(upgradeId, player);
    if (!result.ok) return this._err(playerId, result.reason);

    applyUpgrade(upgradeId, player);
    player.pendingPicks--;

    this.sendTo(playerId, {
      type:      'upgrade_applied',
      upgradeId,
      rank:      player.upgrades.get(upgradeId),
      picksLeft: player.pendingPicks,
      stats:     player.derivedStats,
    });

    this.broadcast({
      type:      'player_upgraded',
      playerId,
      upgradeId,
      rank:      player.upgrades.get(upgradeId),
    });

    this._checkUpgradePhaseComplete();
  }

  /** Host received a skip_picks message — player is done spending. */
  handleSkipPicks(playerId) {
    const player = this.players[playerId];
    if (!player) return;
    player.pendingPicks = 0;
    this._checkUpgradePhaseComplete();
  }

  /** Register a kill event (called by the game simulation layer). */
  registerKill(killerId, victimId) {
    const killer = this.players[killerId];
    const victim = this.players[victimId];
    if (!killer || !victim) return;

    victim.alive  = false;
    victim.hp     = 0;
    victim.deaths++;

    killer.kills++;
    killer.roundKills++;

    const isComeback = victim.score > killer.score;
    const points = PTS.kill + (isComeback ? PTS.comebackKill : 0);
    killer.score += points;
    killer.bonusPicks++;   // earn a bonus upgrade pick

    this.broadcast({
      type:      'kill',
      killerId,
      victimId,
      points,
      comeback:  isComeback,
      bounty:    this.bountyTarget === victimId,
    });

    if (this.bountyTarget === victimId) {
      killer.score += PTS.kill * 2;   // triple total (base + 2 extra)
      this.bountyTarget = null;
    }

    // Respawn victim after 5 seconds
    setTimeout(() => this._respawn(victimId), 5000);
  }

  /** Register an objective capture (called by the game simulation layer). */
  registerObjectiveCaptured(playerId, nodeId) {
    const player = this.players[playerId];
    if (!player) return;
    player.bonusPicks++;
    this.broadcast({ type: 'objective_captured', playerId, nodeId });
  }

  // ─── Round lifecycle ─────────────────────────────────────────────────────────

  nextRound() {
    this.round++;
    if (this.round > TOTAL_ROUNDS) return this._endGame();

    // Reset per-round state
    for (const p of Object.values(this.players)) {
      p.roundKills  = 0;
      p.bonusPicks  = 0;
      p.alive       = true;
      p.hp          = p.derivedStats.maxHp;
    }
    this._resetNodes();

    this.phase    = 'active';
    this.timeLeft = ROUND_DURATION_S;

    const isSurgeRound = SURGE_ROUNDS.includes(this.round);

    this.broadcast({
      type:       'round_start',
      round:      this.round,
      totalRounds:TOTAL_ROUNDS,
      duration:   ROUND_DURATION_S,
      surgeRound: isSurgeRound,
      playerStats: this._playerSnapshot(),
    });
  }

  _endRound() {
    clearTimeout(this.timer);
    this.phase = 'roundend';

    // Tally node majority bonus
    this._awardNodeMajority();

    const isSurgeRound = SURGE_ROUNDS.includes(this.round);

    this.broadcast({
      type:       'round_end',
      round:      this.round,
      scores:     this._scoreSnapshot(),
      surgeNext:  isSurgeRound,
    });

    if (isSurgeRound) {
      setTimeout(() => this._startSurge(), 1500);
    } else {
      setTimeout(() => this._startUpgradePhase(), 1500);
    }
  }

  // ─── Surge events ────────────────────────────────────────────────────────────

  _startSurge() {
    const event = SURGE_EVENTS[Math.floor(Math.random() * SURGE_EVENTS.length)];
    this.surgeActive = { ...event, timeLeft: event.duration };
    this.phase = 'surge';

    if (event.id === 'bounty') {
      const ids = Object.keys(this.players);
      this.bountyTarget = ids[Math.floor(Math.random() * ids.length)];
    }

    this.broadcast({
      type:        'surge_start',
      surge:       event,
      bountyTarget: this.bountyTarget,
    });

    this.timer = setTimeout(() => {
      this.surgeActive  = null;
      this.bountyTarget = null;
      this.broadcast({ type: 'surge_end' });
      this._startUpgradePhase();
    }, event.duration * 1000);
  }

  _tickSurge(dtS) {
    if (!this.surgeActive) return;
    this.surgeActive.timeLeft -= dtS;
  }

  // ─── Upgrade phase ───────────────────────────────────────────────────────────

  _startUpgradePhase() {
    this.phase = 'upgrade';

    for (const p of Object.values(this.players)) {
      p.basePicks    = BASE_PICKS_PER_ROUND;
      p.pendingPicks = BASE_PICKS_PER_ROUND + p.bonusPicks;
    }

    // Tell each player what they can afford and what's available to them
    for (const [id, p] of Object.entries(this.players)) {
      const available = getAvailableUpgrades(p);
      this.sendTo(id, {
        type:       'upgrade_phase',
        picks:      p.pendingPicks,
        available,
        upgrades:   Object.fromEntries(p.upgrades),
        stats:      p.derivedStats,
      });
    }

    // Auto-end upgrade phase after timeout
    this.timer = setTimeout(() => {
      for (const p of Object.values(this.players)) {
        p.pendingPicks = 0;
      }
      this._finishUpgradePhase();
    }, UPGRADE_TIMEOUT_S * 1000);
  }

  _checkUpgradePhaseComplete() {
    const allDone = Object.values(this.players).every(p => p.pendingPicks === 0);
    if (allDone) {
      clearTimeout(this.timer);
      this._finishUpgradePhase();
    }
  }

  _finishUpgradePhase() {
    this.broadcast({
      type:       'upgrade_phase_end',
      playerStats: this._playerSnapshot(),
    });
    setTimeout(() => this.nextRound(), 2000);
  }

  // ─── Node helpers ────────────────────────────────────────────────────────────

  _tickNodes(dtS) {
    const surgeMultiplier = this.surgeActive?.id === 'power_spike' ? 3 : 1;

    for (const node of Object.values(this.nodes)) {
      if (node.owner) {
        const owner = this.players[node.owner];
        if (owner) {
          // Score tick
          const ptsPerTick = PTS.nodeTickPerSec * dtS * surgeMultiplier;
          owner.score += ptsPerTick;
        }
      }
    }
  }

  _resetNodes() {
    for (const n of Object.values(this.nodes)) {
      n.owner           = null;
      n.captureProgress = 0;
      n.contestedBy     = [];
    }
  }

  _awardNodeMajority() {
    const counts = {};
    for (const n of Object.values(this.nodes)) {
      if (n.owner) counts[n.owner] = (counts[n.owner] || 0) + 1;
    }
    if (!Object.keys(counts).length) return;
    const max = Math.max(...Object.values(counts));
    for (const [id, cnt] of Object.entries(counts)) {
      if (cnt === max) {
        this.players[id].score += PTS.nodeMajority;
      }
    }
  }

  // ─── Respawn ─────────────────────────────────────────────────────────────────

  _respawn(playerId) {
    const player = this.players[playerId];
    if (!player || this.phase === 'upgrade' || this.phase === 'gameover') return;
    player.alive = true;
    player.hp    = player.derivedStats.maxHp;
    // Spawn position is set by the game simulation layer
    this.sendTo(playerId, { type: 'respawn', hp: player.hp });
    this.broadcast({ type: 'player_respawned', playerId });
  }

  // ─── Game over ───────────────────────────────────────────────────────────────

  _endGame() {
    this.phase = 'gameover';
    clearTimeout(this.timer);

    const sorted = Object.values(this.players)
      .sort((a, b) => b.score - a.score);

    const mvp = sorted.reduce((best, p) =>
      p.kills > best.kills ? p : best, sorted[0]);

    this.broadcast({
      type:    'game_over',
      results: sorted.map(p => ({
        id:     p.id,
        score:  Math.floor(p.score),
        kills:  p.kills,
        deaths: p.deaths,
        upgrades: Object.fromEntries(p.upgrades),
      })),
      winner: sorted[0].id,
      mvp:    mvp.id,
    });
  }

  // ─── Snapshot helpers ────────────────────────────────────────────────────────

  _snapshot() {
    return {
      round:    this.round,
      phase:    this.phase,
      timeLeft: Math.ceil(this.timeLeft),
      surge:    this.surgeActive,
      players:  this._playerSnapshot(),
      nodes:    this.nodes,
    };
  }

  _playerSnapshot() {
    const out = {};
    for (const [id, p] of Object.entries(this.players)) {
      out[id] = {
        id,
        score:       Math.floor(p.score),
        kills:       p.kills,
        deaths:      p.deaths,
        alive:       p.alive,
        hp:          Math.max(0, p.hp),
        maxHp:       p.derivedStats.maxHp,
        position:    p.position,
        upgrades:    Object.fromEntries(p.upgrades),
        derivedStats: p.derivedStats,
      };
    }
    return out;
  }

  _scoreSnapshot() {
    return Object.values(this.players).map(p => ({
      id:    p.id,
      score: Math.floor(p.score),
      kills: p.kills,
    })).sort((a, b) => b.score - a.score);
  }

  _applyInputs(inputSnapshot) {
    if (!inputSnapshot) return;
    for (const [id, input] of Object.entries(inputSnapshot)) {
      const player = this.players[id];
      if (!player?.alive) continue;
      if (input.position) player.position = input.position;
      if (input.capturingNode !== undefined) player.capturingNode = input.capturingNode;
    }
  }

  _err(playerId, reason) {
    this.sendTo(playerId, { type: 'error', code: 'GAME_ERROR', message: reason });
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = { GameState, SURGE_EVENTS, PTS };
} else {
  window.GameState = GameState;
}
