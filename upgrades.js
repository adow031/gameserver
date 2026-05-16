/**
 * upgrades.js
 * Upgrade definitions and server-side validation.
 * Shared between host game logic and client UI (via a script tag or module).
 *
 * Rank stacking: if maxRanks > 1, the player may pick the same upgrade
 * multiple times up to that limit. Each rank counts as one pick spend.
 *
 * Branch locking: at Tier 2 within a path, picking from one branch locks the
 * other for that player until they own a Tier 3 upgrade in the same path.
 *
 * Hybrid unlocks: require T1 in two different paths; otherwise treated as
 * standard Tier 4 upgrades.
 */

// ─── Upgrade catalogue ────────────────────────────────────────────────────────

const UPGRADES = {

  // ══ BREACH ══════════════════════════════════════════════════════════════════

  // Tier 1
  surge_burst:    { id:'surge_burst',    path:'breach',  tier:1, branch:null,  maxRanks:1, requires:[],                         name:'Surge Burst',    stats:{ burstDmg:35, burstRadius:3, burstCooldown:4 } },
  overclock:      { id:'overclock',      path:'breach',  tier:1, branch:null,  maxRanks:3, requires:[],                         name:'Overclock',      stats:{ fireRatePct:20 } },
  shatter_round:  { id:'shatter_round',  path:'breach',  tier:1, branch:null,  maxRanks:1, requires:[],                         name:'Shatter Round',  stats:{ shatterEveryN:5, shatterAoePct:20 } },
  neural_spike:   { id:'neural_spike',   path:'breach',  tier:1, branch:null,  maxRanks:3, requires:[],                         name:'Neural Spike',   stats:{ slowChancePct:10, slowAmtPct:40, slowDuration:1.5 } },

  // Tier 2 — damage branch
  zero_point:     { id:'zero_point',     path:'breach',  tier:2, branch:'dmg', maxRanks:2, requires:['breach_t1'],               name:'Zero Point',     stats:{ armourPiercePct:30 } },
  cascade:        { id:'cascade',        path:'breach',  tier:2, branch:'dmg', maxRanks:1, requires:['breach_t1'],               name:'Cascade',        stats:{ chainDmg:25, chainRange:5 } },
  armour_pierce:  { id:'armour_pierce',  path:'breach',  tier:2, branch:'dmg', maxRanks:4, requires:['breach_t1'],               name:'Armour Pierce',  stats:{ flatDmgBonus:8 } },
  meltdown:       { id:'meltdown',       path:'breach',  tier:2, branch:'dmg', maxRanks:1, requires:['breach_t1'],               name:'Meltdown',       stats:{ burnDps:5, burnMaxStacks:3 } },

  // Tier 2 — ability branch
  phase_cannon:   { id:'phase_cannon',   path:'breach',  tier:2, branch:'abi', maxRanks:1, requires:['breach_t1'],               name:'Phase Cannon',   stats:{ beamDmg:80, beamCooldown:8, throughWalls:true } },
  disruptor:      { id:'disruptor',      path:'breach',  tier:2, branch:'abi', maxRanks:1, requires:['surge_burst'],             name:'Disruptor',      stats:{ abilityDisableDuration:2 } },
  emp_pulse:      { id:'emp_pulse',      path:'breach',  tier:2, branch:'abi', maxRanks:1, requires:['breach_t1'],               name:'EMP Pulse',      stats:{ pulseRadius:6, silenceDuration:1.5, pulseCooldown:12 } },
  killshot:       { id:'killshot',       path:'breach',  tier:2, branch:'abi', maxRanks:2, requires:['breach_t1'],               name:'Killshot',       stats:{ hpThresholdPct:25, dmgBonusPct:50, window:2 } },

  // Tier 3
  overload:       { id:'overload',       path:'breach',  tier:3, branch:null,  maxRanks:1, requires:['breach_t2'],               name:'Overload',       stats:{ waveDelayS:0.5, waveDmgPct:60 } },
  chain_reaction: { id:'chain_reaction', path:'breach',  tier:3, branch:null,  maxRanks:1, requires:['breach_t2'],               name:'Chain Reaction', stats:{ cdReductionOnKill:2 } },
  nullifier:      { id:'nullifier',      path:'breach',  tier:3, branch:null,  maxRanks:1, requires:['breach_t2'],               name:'Nullifier',      stats:{ defDebuffPct:8, maxStacks:5, stackDuration:3 } },
  detonator:      { id:'detonator',      path:'breach',  tier:3, branch:null,  maxRanks:2, requires:['breach_t2'],               name:'Detonator',      stats:{ everyNHits:4, bonusDmg:60 } },

  // Tier 4 capstone
  zero_day:       { id:'zero_day',       path:'breach',  tier:4, branch:null,  maxRanks:1, requires:['breach_t3'],               name:'Zero Day',       stats:{ zoneDuration:3, shieldPierce:true } },


  // ══ GHOST ═══════════════════════════════════════════════════════════════════

  // Tier 1
  phase_step:     { id:'phase_step',     path:'ghost',   tier:1, branch:null,  maxRanks:1, requires:[],                         name:'Phase Step',     stats:{ blinkRange:6, blinkCooldown:5 } },
  smoke_screen:   { id:'smoke_screen',   path:'ghost',   tier:1, branch:null,  maxRanks:2, requires:[],                         name:'Smoke Screen',   stats:{ smokeRadius:4, smokeDuration:4, charges:2 } },
  refraction:     { id:'refraction',     path:'ghost',   tier:1, branch:null,  maxRanks:3, requires:[],                         name:'Refraction',     stats:{ procChancePct:15, cloakDuration:1 } },
  ghost_walk:     { id:'ghost_walk',     path:'ghost',   tier:1, branch:null,  maxRanks:3, requires:[],                         name:'Ghost Walk',     stats:{ moveSpeedPct:12 } },

  // Tier 2 — evasion branch
  afterimage:     { id:'afterimage',     path:'ghost',   tier:2, branch:'eva', maxRanks:1, requires:['phase_step'],             name:'Afterimage',     stats:{ decoyTauntDuration:1.5 } },
  mirror_clone:   { id:'mirror_clone',   path:'ghost',   tier:2, branch:'eva', maxRanks:1, requires:['ghost_t1'],              name:'Mirror Clone',   stats:{ cloneDuration:3, usesPerRound:1 } },
  static_dash:    { id:'static_dash',    path:'ghost',   tier:2, branch:'eva', maxRanks:2, requires:['ghost_t1'],              name:'Static Dash',    stats:{ dashDmg:20, stunDuration:0.5 } },
  flicker:        { id:'flicker',        path:'ghost',   tier:2, branch:'eva', maxRanks:3, requires:['phase_step'],             name:'Flicker',        stats:{ blinkCdReduction:1.5 } },

  // Tier 2 — stealth branch
  cloak:          { id:'cloak',          path:'ghost',   tier:2, branch:'ste', maxRanks:1, requires:['ghost_t1'],              name:'Cloak',          stats:{ cloakDuration:2, cloakCooldown:10 } },
  dark_veil:      { id:'dark_veil',      path:'ghost',   tier:2, branch:'ste', maxRanks:1, requires:['smoke_screen'],          name:'Dark Veil',      stats:{ smokeGrantsInvis:true } },
  signal_jam:     { id:'signal_jam',     path:'ghost',   tier:2, branch:'ste', maxRanks:1, requires:['cloak'],                  name:'Signal Jam',     stats:{ radarBlindRadius:5 } },
  blind_spot:     { id:'blind_spot',     path:'ghost',   tier:2, branch:'ste', maxRanks:1, requires:['ghost_t1'],              name:'Blind Spot',     stats:{ disorientDuration:1 } },

  // Tier 3
  ghost_protocol: { id:'ghost_protocol', path:'ghost',   tier:3, branch:null,  maxRanks:1, requires:['ghost_t2'],              name:'Ghost Protocol', stats:{ blinkResetOnKill:true, autoCloakDuration:1 } },
  phantom_rush:   { id:'phantom_rush',   path:'ghost',   tier:3, branch:null,  maxRanks:1, requires:['ghost_t2'],              name:'Phantom Rush',   stats:{ dashDuration:0.8, passThroughObjects:true } },
  echo_step:      { id:'echo_step',      path:'ghost',   tier:3, branch:null,  maxRanks:2, requires:['ghost_t2'],              name:'Echo Step',      stats:{ postBlinkDmgBonusPct:40, window:2 } },
  wraithform:     { id:'wraithform',     path:'ghost',   tier:3, branch:null,  maxRanks:1, requires:['ghost_t2'],              name:'Wraithform',     stats:{ lethalBlockDuration:2, dmgReductionPct:0, usesPerRound:1 } },

  // Tier 4 capstone
  wraith_form:    { id:'wraith_form',    path:'ghost',   tier:4, branch:null,  maxRanks:1, requires:['ghost_t3'],              name:'Wraith Form',    stats:{ cloakDuration:8, moveAndAttackCloaked:true, usesPerRound:1 } },


  // ══ FORTRESS ════════════════════════════════════════════════════════════════

  // Tier 1
  hardened_shell: { id:'hardened_shell', path:'fortress',tier:1, branch:null,  maxRanks:4, requires:[],                        name:'Hardened Shell', stats:{ maxHpBonus:30 } },
  iron_skin:      { id:'iron_skin',      path:'fortress',tier:1, branch:null,  maxRanks:3, requires:[],                        name:'Iron Skin',      stats:{ dmgReductionPct:5 } },
  node_lock:      { id:'node_lock',      path:'fortress',tier:1, branch:null,  maxRanks:2, requires:[],                        name:'Node Lock',      stats:{ captureSpeedBonusPct:25, slowsDecapture:true } },
  bulwark:        { id:'bulwark',        path:'fortress',tier:1, branch:null,  maxRanks:1, requires:[],                        name:'Bulwark',        stats:{ hpThresholdPct:30, immunityDuration:3, cooldown:20 } },

  // Tier 2 — defence branch
  reactive_armour:{ id:'reactive_armour',path:'fortress',tier:2, branch:'def', maxRanks:2, requires:['fortress_t1'],           name:'Reactive Armour',stats:{ hitsRequired:3, window:2, burstDmg:15 } },
  null_shield:    { id:'null_shield',    path:'fortress',tier:2, branch:'def', maxRanks:1, requires:['fortress_t1'],           name:'Null Shield',    stats:{ blockDuration:1.5, cooldown:8, directional:true } },
  redoubt:        { id:'redoubt',        path:'fortress',tier:2, branch:'def', maxRanks:2, requires:['fortress_t1'],           name:'Redoubt',        stats:{ regenHpPerSec:5, requiresStillness:true } },
  ironclad:       { id:'ironclad',       path:'fortress',tier:2, branch:'def', maxRanks:3, requires:['fortress_t1'],           name:'Ironclad',       stats:{ ccReductionPct:30 } },

  // Tier 2 — control branch
  static_field:   { id:'static_field',   path:'fortress',tier:2, branch:'con', maxRanks:2, requires:['fortress_t1'],           name:'Static Field',   stats:{ auraRadius:4, slowPct:25 } },
  gravity_well:   { id:'gravity_well',   path:'fortress',tier:2, branch:'con', maxRanks:1, requires:['fortress_t1'],           name:'Gravity Well',   stats:{ pullRadius:6, cooldown:12 } },
  anchor:         { id:'anchor',         path:'fortress',tier:2, branch:'con', maxRanks:1, requires:['node_lock'],             name:'Anchor',         stats:{ defBonusPct:20, captureSpeedBonusPct:50 } },
  pulse_ward:     { id:'pulse_ward',     path:'fortress',tier:2, branch:'con', maxRanks:2, requires:['fortress_t1'],           name:'Pulse Ward',     stats:{ triggerRadius:3, wardDmg:40, knockback:true } },

  // Tier 3
  bastion:        { id:'bastion',        path:'fortress',tier:3, branch:null,  maxRanks:1, requires:['fortress_t2'],           name:'Bastion',        stats:{ nodeRegenHpPerSec:8, nodeDmgReductionPct:15 } },
  citadel:        { id:'citadel',        path:'fortress',tier:3, branch:null,  maxRanks:1, requires:['fortress_t2'],           name:'Citadel',        stats:{ surviveAtHp:1, dmgReductionPct:80, duration:2, usesPerRound:1 } },
  immovable:      { id:'immovable',      path:'fortress',tier:3, branch:null,  maxRanks:1, requires:['fortress_t2'],           name:'Immovable',      stats:{ knockbackImmune:true, ccImmune:true, bonusDmgReductionPct:10 } },
  storm_wall:     { id:'storm_wall',     path:'fortress',tier:3, branch:null,  maxRanks:1, requires:['fortress_t2'],           name:'Storm Wall',     stats:{ barrierLength:5, barrierDuration:4, allyPassable:true } },

  // Tier 4 capstone
  iron_citadel:   { id:'iron_citadel',   path:'fortress',tier:4, branch:null,  maxRanks:1, requires:['fortress_t3'],           name:'Iron Citadel',   stats:{ captureImmunity:true, auraSlowPct:40, auraRadius:4 } },


  // ══ HYBRIDS ═════════════════════════════════════════════════════════════════

  shadow_strike:   { id:'shadow_strike',   path:'hybrid', tier:4, branch:null, maxRanks:1, requires:['surge_burst','phase_step'],     name:'Shadow Strike',   stats:{ cloakDmgBonusPct:60, noRevealOnFirstShot:true } },
  phantom_bulwark: { id:'phantom_bulwark', path:'hybrid', tier:4, branch:null, maxRanks:1, requires:['phase_step','hardened_shell'],  name:'Phantom Bulwark', stats:{ hitsAbsorbedAfterBlink:1 } },
  siege_mode:      { id:'siege_mode',      path:'hybrid', tier:4, branch:null, maxRanks:1, requires:['surge_burst','hardened_shell'], name:'Siege Mode',      stats:{ stacksForDouble:3, knockback:true } },
};

// ─── Prerequisite aliases ─────────────────────────────────────────────────────
// 'breach_t1' means "any Tier 1 Breach upgrade owned". Resolved at validation time.

const TIER_ALIASES = {
  breach_t1:   (owned) => Object.values(UPGRADES).some(u => u.path==='breach'   && u.tier===1 && owned.has(u.id)),
  breach_t2:   (owned) => Object.values(UPGRADES).some(u => u.path==='breach'   && u.tier===2 && owned.has(u.id)),
  breach_t3:   (owned) => Object.values(UPGRADES).some(u => u.path==='breach'   && u.tier===3 && owned.has(u.id)),
  ghost_t1:    (owned) => Object.values(UPGRADES).some(u => u.path==='ghost'    && u.tier===1 && owned.has(u.id)),
  ghost_t2:    (owned) => Object.values(UPGRADES).some(u => u.path==='ghost'    && u.tier===2 && owned.has(u.id)),
  ghost_t3:    (owned) => Object.values(UPGRADES).some(u => u.path==='ghost'    && u.tier===3 && owned.has(u.id)),
  fortress_t1: (owned) => Object.values(UPGRADES).some(u => u.path==='fortress' && u.tier===1 && owned.has(u.id)),
  fortress_t2: (owned) => Object.values(UPGRADES).some(u => u.path==='fortress' && u.tier===2 && owned.has(u.id)),
  fortress_t3: (owned) => Object.values(UPGRADES).some(u => u.path==='fortress' && u.tier===3 && owned.has(u.id)),
};

function resolveReq(req, ownedSet) {
  if (TIER_ALIASES[req]) return TIER_ALIASES[req](ownedSet);
  return ownedSet.has(req);
}

// ─── Branch lock helper ────────────────────────────────────────────────────────
// Returns the branch id that is currently locked out for a player in a given
// path, or null if both are still available.

function getLockedBranch(path, ownedSet) {
  const t2upgrades = Object.values(UPGRADES).filter(u => u.path === path && u.tier === 2 && u.branch !== null);
  const branches   = [...new Set(t2upgrades.map(u => u.branch))];
  if (branches.length < 2) return null;

  const hasT3 = Object.values(UPGRADES).some(u => u.path === path && u.tier === 3 && ownedSet.has(u.id));
  if (hasT3) return null;   // T3 owned — both branches re-open

  for (const branch of branches) {
    const owned = t2upgrades.filter(u => u.branch === branch).some(u => ownedSet.has(u.id));
    if (owned) {
      return branches.find(b => b !== branch);   // lock the other
    }
  }
  return null;   // nothing picked yet
}

// ─── Validation ────────────────────────────────────────────────────────────────
/**
 * canPickUpgrade(upgradeId, playerState) → { ok: bool, reason?: string }
 *
 * playerState = {
 *   upgrades: Map<upgradeId, rank>,   // rank = times picked (1-based)
 *   bonusPicks: number,
 *   basePicks: number,
 * }
 */
function canPickUpgrade(upgradeId, playerState) {
  const upgrade = UPGRADES[upgradeId];
  if (!upgrade) return { ok: false, reason: 'Unknown upgrade' };

  const totalPicks = (playerState.basePicks || 0) + (playerState.bonusPicks || 0);
  if (totalPicks < 1) return { ok: false, reason: 'No picks remaining' };

  const ownedSet = new Set(playerState.upgrades.keys());
  const currentRank = playerState.upgrades.get(upgradeId) || 0;

  if (currentRank >= upgrade.maxRanks) {
    return { ok: false, reason: `${upgrade.name} is already at max rank (${upgrade.maxRanks})` };
  }

  // Check prerequisites
  for (const req of upgrade.requires) {
    if (!resolveReq(req, ownedSet)) {
      return { ok: false, reason: `Requires: ${req}` };
    }
  }

  // Check branch lock
  if (upgrade.branch && upgrade.path !== 'hybrid') {
    const lockedBranch = getLockedBranch(upgrade.path, ownedSet);
    if (lockedBranch === upgrade.branch) {
      return { ok: false, reason: `${upgrade.branch} branch is locked — pick a T3 ${upgrade.path} upgrade first` };
    }
  }

  return { ok: true };
}

// ─── Apply upgrade ────────────────────────────────────────────────────────────
/**
 * applyUpgrade(upgradeId, playerState) → updatedPlayerState
 * Mutates and returns playerState. Always call canPickUpgrade first.
 */
function applyUpgrade(upgradeId, playerState) {
  const upgrade = UPGRADES[upgradeId];

  // Increment rank
  const rank = (playerState.upgrades.get(upgradeId) || 0) + 1;
  playerState.upgrades.set(upgradeId, rank);

  // Spend a pick (base picks first, then bonus)
  if (playerState.basePicks > 0) {
    playerState.basePicks--;
  } else {
    playerState.bonusPicks--;
  }

  // Apply stat changes to the player's derived stats object
  applyStats(upgrade, rank, playerState.derivedStats);

  return playerState;
}

// ─── Stat application ─────────────────────────────────────────────────────────
/**
 * Walk the upgrade's stats and apply them to derivedStats.
 * For stackable upgrades the stats apply per-rank (called once per pick).
 */
function applyStats(upgrade, rank, ds) {
  const s = upgrade.stats;

  // ── Breach ──
  if (s.fireRatePct)        ds.fireRatePct        = (ds.fireRatePct || 0)        + s.fireRatePct;
  if (s.flatDmgBonus)       ds.flatDmgBonus        = (ds.flatDmgBonus || 0)       + s.flatDmgBonus;
  if (s.slowChancePct)      ds.slowChancePct       = (ds.slowChancePct || 0)      + s.slowChancePct;
  if (s.armourPiercePct)    ds.armourPiercePct     = Math.min(100, (ds.armourPiercePct || 0) + s.armourPiercePct);
  if (s.burstDmg !== undefined) {
    ds.burstDmg     = s.burstDmg;
    ds.burstRadius  = s.burstRadius;
    ds.burstCooldown= s.burstCooldown;
    ds.hasBurst     = true;
  }
  if (s.throughWalls)       ds.beamThroughWalls    = true;
  if (s.abilityDisableDuration) ds.abilityDisableDuration = s.abilityDisableDuration;
  if (s.shieldPierce)       ds.burstPiercesShields = true;

  // ── Ghost ──
  if (s.moveSpeedPct)       ds.moveSpeedPct        = (ds.moveSpeedPct || 0)       + s.moveSpeedPct;
  if (s.blinkRange)         { ds.blinkRange = s.blinkRange; ds.hasBlink = true; }
  if (s.blinkCdReduction)   ds.blinkCooldown       = Math.max(1, (ds.blinkCooldown || 5) - s.blinkCdReduction);
  if (s.procChancePct)      ds.refractionChance    = (ds.refractionChance || 0)   + s.procChancePct;
  if (s.decoyTauntDuration) ds.decoyOnBlink        = s.decoyTauntDuration;
  if (s.smokeGrantsInvis)   ds.smokeInvis          = true;
  if (s.radarBlindRadius)   ds.radarBlindRadius    = s.radarBlindRadius;
  if (s.noRevealOnFirstShot)ds.cloakNoRevealFirst  = true;
  if (s.cloakDmgBonusPct)   ds.cloakDmgBonusPct   = s.cloakDmgBonusPct;
  if (s.moveAndAttackCloaked)ds.fullCloak          = true;

  // ── Fortress ──
  if (s.maxHpBonus)         ds.maxHp               = (ds.maxHp || 100)            + s.maxHpBonus;
  if (s.dmgReductionPct)    ds.dmgReductionPct     = Math.min(85, (ds.dmgReductionPct || 0) + s.dmgReductionPct);
  if (s.captureSpeedBonusPct) ds.captureSpeedBonusPct = (ds.captureSpeedBonusPct || 0) + s.captureSpeedBonusPct;
  if (s.ccReductionPct)     ds.ccReductionPct      = Math.min(100, (ds.ccReductionPct || 0) + s.ccReductionPct);
  if (s.auraRadius)         ds.slowAuraRadius      = s.auraRadius;
  if (s.auraSlowPct)        ds.slowAuraPct         = s.auraSlowPct;
  if (s.captureImmunity)    ds.captureImmunity     = true;
  if (s.knockbackImmune)    ds.knockbackImmune     = true;
  if (s.ccImmune)           ds.ccImmune            = true;
  if (s.bonusDmgReductionPct) ds.dmgReductionPct  = Math.min(85, (ds.dmgReductionPct || 0) + s.bonusDmgReductionPct);
  if (s.hitsAbsorbedAfterBlink) ds.blinkAbsorb    = s.hitsAbsorbedAfterBlink;
  if (s.stacksForDouble)    ds.siegeModeStacks     = s.stacksForDouble;
}

// ─── Derived stats baseline ───────────────────────────────────────────────────
function freshDerivedStats() {
  return {
    maxHp:                100,
    fireRatePct:          0,
    flatDmgBonus:         0,
    moveSpeedPct:         0,
    dmgReductionPct:      0,
    captureSpeedBonusPct: 0,
    ccReductionPct:       0,
    armourPiercePct:      0,
    slowChancePct:        0,
    hasBurst:             false,
    hasBlink:             false,
    blinkRange:           0,
    blinkCooldown:        5,
  };
}

// ─── Available upgrades for a player ─────────────────────────────────────────
/**
 * getAvailableUpgrades(playerState) → upgradeId[]
 * Returns IDs of all upgrades the player can legally pick right now.
 */
function getAvailableUpgrades(playerState) {
  return Object.keys(UPGRADES).filter(id => canPickUpgrade(id, playerState).ok);
}

// ─── Export (works both as CommonJS and via <script> tag) ─────────────────────
if (typeof module !== 'undefined') {
  module.exports = { UPGRADES, canPickUpgrade, applyUpgrade, getAvailableUpgrades, freshDerivedStats, getLockedBranch };
} else {
  window.UPGRADES = UPGRADES;
  window.canPickUpgrade = canPickUpgrade;
  window.applyUpgrade = applyUpgrade;
  window.getAvailableUpgrades = getAvailableUpgrades;
  window.freshDerivedStats = freshDerivedStats;
  window.getLockedBranch = getLockedBranch;
}