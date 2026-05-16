/**
 * upgradeScreen.js
 * Client-side upgrade pick screen, shown during the upgrade phase.
 *
 * Usage:
 *   const screen = new UpgradeScreen(containerEl, sendWS);
 *   screen.open({ picks, available, upgrades, stats });   // from server
 *   screen.applyConfirmed(upgradeId, rank, picksLeft);    // from server echo
 *   screen.close();
 *
 * Requires upgrades.js to be loaded first (UPGRADES, getLockedBranch, etc.)
 */

class UpgradeScreen {
  constructor(containerEl, sendFn) {
    this.container = containerEl;
    this.send      = sendFn;

    // State from server
    this.picksLeft  = 0;
    this.available  = new Set();
    this.owned      = new Map();    // upgradeId → rank
    this.stats      = null;

    this.selectedId = null;
    this.timer      = null;
    this.timeLeft   = 30;

    this._render();
  }

  // ─── Public ────────────────────────────────────────────────────────────────

  open({ picks, available, upgrades, stats }) {
    this.picksLeft = picks;
    this.available = new Set(available);
    this.owned     = new Map(Object.entries(upgrades || {}));
    this.stats     = stats;

    this.container.style.display = 'flex';
    this.timeLeft = 30;
    this._startTimer();
    this._refresh();
  }

  close() {
    this.container.style.display = 'none';
    clearInterval(this.timer);
  }

  applyConfirmed(upgradeId, rank, picksLeft) {
    this.owned.set(upgradeId, rank);
    this.picksLeft = picksLeft;
    this.available = new Set(getAvailableUpgrades({
      upgrades: this.owned,
      basePicks: this.picksLeft,
      bonusPicks: 0,
    }));
    if (this.picksLeft === 0) {
      setTimeout(() => this.close(), 800);
    } else {
      this._refresh();
    }
  }

  // ─── Timer ────────────────────────────────────────────────────────────────

  _startTimer() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.timeLeft--;
      const el = this.container.querySelector('#upg-timer');
      if (el) el.textContent = this.timeLeft + 's';
      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        this.send({ type: 'skip_picks' });
        this.close();
      }
    }, 1000);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  _render() {
    this.container.innerHTML = '';
    this.container.style.cssText = `
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.88);
      align-items: center;
      justify-content: center;
      z-index: 200;
      font-family: 'IBM Plex Mono', monospace;
      padding: 16px;
    `;

    this.container.innerHTML = `
      <div id="upg-panel" style="
        background: #16161a;
        border: 1px solid #2a2a32;
        border-radius: 10px;
        width: 100%;
        max-width: 640px;
        max-height: 92vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      ">
        <!-- Header -->
        <div style="padding: 18px 20px 14px; border-bottom: 1px solid #2a2a32; display:flex; align-items:center; gap:12px;">
          <div style="flex:1">
            <div style="font-size:11px;letter-spacing:.15em;color:#6b6b7a;text-transform:uppercase;margin-bottom:3px">Upgrade phase</div>
            <div id="upg-headline" style="font-size:18px;font-weight:600;color:#e8e8ec">Choose an upgrade</div>
          </div>
          <div style="text-align:right">
            <div id="upg-picks-label" style="font-size:22px;font-weight:600;color:#7fff6e"></div>
            <div style="font-size:11px;color:#6b6b7a;margin-top:2px">picks left</div>
          </div>
          <div style="text-align:right;min-width:36px">
            <div id="upg-timer" style="font-size:18px;font-weight:600;color:#6b6b7a">30s</div>
            <div style="font-size:10px;color:#6b6b7a">auto-skip</div>
          </div>
        </div>

        <!-- Path tabs -->
        <div id="upg-tabs" style="display:flex;gap:0;border-bottom:1px solid #2a2a32;"></div>

        <!-- Upgrade grid -->
        <div id="upg-grid" style="padding:16px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;"></div>

        <!-- Detail pane -->
        <div id="upg-detail" style="
          margin:0 16px 16px;
          background:#0d0d0f;
          border:1px solid #2a2a32;
          border-radius:6px;
          padding:16px;
          min-height:80px;
        ">
          <div style="color:#6b6b7a;font-size:12px">Select an upgrade to preview</div>
        </div>

        <!-- Stats bar -->
        <div id="upg-stats" style="
          margin:0 16px 16px;
          padding:12px;
          background:#0d0d0f;
          border:1px solid #2a2a32;
          border-radius:6px;
          display:flex;
          flex-wrap:wrap;
          gap:8px;
        "></div>

        <!-- Footer -->
        <div style="padding:12px 16px;border-top:1px solid #2a2a32;display:flex;gap:8px;">
          <button id="upg-confirm" style="
            flex:1;padding:10px;
            background:#7fff6e;color:#0d0d0f;
            border:none;border-radius:6px;
            font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;
            cursor:pointer;opacity:.4;
          " disabled>Confirm pick</button>
          <button id="upg-skip" style="
            padding:10px 18px;
            background:transparent;color:#6b6b7a;
            border:1px solid #2a2a32;border-radius:6px;
            font-family:'IBM Plex Mono',monospace;font-size:13px;
            cursor:pointer;
          ">Skip remaining</button>
        </div>
      </div>
    `;

    // Build tabs
    const paths = ['breach','ghost','fortress'];
    const pathColors = { breach:'#D85A30', ghost:'#534AB7', fortress:'#185FA5' };
    const pathLabels = { breach:'⚡ Breach', ghost:'👻 Ghost', fortress:'🛡 Fortress' };
    this._currentTab = 'breach';

    const tabBar = this.container.querySelector('#upg-tabs');
    for (const p of paths) {
      const tab = document.createElement('button');
      tab.dataset.path = p;
      tab.textContent  = pathLabels[p];
      tab.style.cssText = `
        flex:1;padding:10px 4px;border:none;background:transparent;
        font-family:'IBM Plex Mono',monospace;font-size:12px;
        color:#6b6b7a;cursor:pointer;
        border-bottom:2px solid transparent;
        transition:all .15s;
      `;
      tab.addEventListener('click', () => {
        this._currentTab = p;
        tabBar.querySelectorAll('button').forEach(t => {
          t.style.color       = '#6b6b7a';
          t.style.borderColor = 'transparent';
        });
        tab.style.color       = pathColors[p];
        tab.style.borderColor = pathColors[p];
        this._renderGrid();
      });
      tabBar.appendChild(tab);
    }
    // Activate first tab
    tabBar.firstChild.style.color       = pathColors['breach'];
    tabBar.firstChild.style.borderColor = pathColors['breach'];

    // Confirm button
    this.container.querySelector('#upg-confirm').addEventListener('click', () => {
      if (!this.selectedId) return;
      this.send({ type: 'pick_upgrade', upgradeId: this.selectedId });
      this.selectedId = null;
      this._setConfirmEnabled(false);
    });

    // Skip button
    this.container.querySelector('#upg-skip').addEventListener('click', () => {
      this.send({ type: 'skip_picks' });
      this.close();
    });
  }

  _refresh() {
    const picksEl = this.container.querySelector('#upg-picks-label');
    if (picksEl) picksEl.textContent = this.picksLeft;

    const headline = this.container.querySelector('#upg-headline');
    if (headline) {
      headline.textContent = this.picksLeft === 0
        ? 'All picks spent'
        : `${this.picksLeft} pick${this.picksLeft > 1 ? 's' : ''} remaining`;
    }

    this._renderGrid();
    this._renderStats();
  }

  _renderGrid() {
    const grid = this.container.querySelector('#upg-grid');
    const path = this._currentTab;
    const pathColors = { breach:'#D85A30', ghost:'#534AB7', fortress:'#185FA5' };
    const color = pathColors[path];

    // Get all upgrades for this path (and hybrids that reference it)
    const upgrades = Object.values(UPGRADES).filter(u =>
      u.path === path ||
      (u.path === 'hybrid' && u.requires.some(r => {
        const match = UPGRADES[r];
        return match && match.path === path;
      }))
    );

    // Group by tier
    const tiers = {};
    for (const u of upgrades) {
      if (!tiers[u.tier]) tiers[u.tier] = [];
      tiers[u.tier].push(u);
    }

    grid.innerHTML = '';

    for (const tier of [1,2,3,4]) {
      if (!tiers[tier]) continue;

      // Tier label
      const tierLabel = document.createElement('div');
      tierLabel.style.cssText = 'grid-column:1/-1;font-size:10px;letter-spacing:.12em;color:#6b6b7a;text-transform:uppercase;margin-top:4px;';
      tierLabel.textContent = tier < 4 ? `Tier ${tier}` : 'Tier 4 — Capstone / Hybrid';
      grid.appendChild(tierLabel);

      // Group T2 by branch
      const byBranch = {};
      for (const u of tiers[tier]) {
        const key = u.branch || '__none__';
        if (!byBranch[key]) byBranch[key] = [];
        byBranch[key].push(u);
      }

      for (const [branch, group] of Object.entries(byBranch)) {
        if (branch !== '__none__' && u_path !== 'hybrid') {
          const bl = document.createElement('div');
          bl.style.cssText = 'grid-column:1/-1;font-size:10px;color:#6b6b7a;font-style:italic;margin-top:2px;';
          bl.textContent   = branch === 'dmg' || branch === 'eva' || branch === 'def'
            ? '— offensive / evasion / defence branch'
            : '— ability / stealth / control branch';
          grid.appendChild(bl);
        }

        for (const u of group) {
          grid.appendChild(this._makeCard(u, color, path));
        }
      }
    }

    // Fix: simple loop without branch label reference bug
    grid.innerHTML = '';
    for (const tier of [1,2,3,4]) {
      if (!tiers[tier]) continue;

      const tierLabel = document.createElement('div');
      tierLabel.style.cssText = 'grid-column:1/-1;font-size:10px;letter-spacing:.12em;color:#6b6b7a;text-transform:uppercase;margin-top:8px;';
      tierLabel.textContent   = tier < 4 ? `Tier ${tier}` : 'Tier 4 — Capstone & Hybrids';
      grid.appendChild(tierLabel);

      // Branch subheadings for T2
      if (tier === 2) {
        const byBranch = {};
        for (const u of tiers[tier]) {
          if (!byBranch[u.branch]) byBranch[u.branch] = [];
          byBranch[u.branch].push(u);
        }
        const lockedBranch = getLockedBranch(path, this.owned);

        for (const [br, group] of Object.entries(byBranch)) {
          const isLocked = lockedBranch === br;
          const bl = document.createElement('div');
          bl.style.cssText = 'grid-column:1/-1;font-size:10px;color:' + (isLocked ? '#3a3a44' : '#6b6b7a') + ';font-style:italic;margin-top:4px;';
          bl.textContent   = this._branchName(br, path) + (isLocked ? '  (locked until T3)' : '');
          grid.appendChild(bl);
          for (const u of group) {
            grid.appendChild(this._makeCard(u, color, path));
          }
        }
      } else {
        for (const u of tiers[tier]) {
          grid.appendChild(this._makeCard(u, color, path));
        }
      }
    }
  }

  _branchName(branch, path) {
    const names = {
      breach:   { dmg: 'Damage branch', abi: 'Ability branch' },
      ghost:    { eva: 'Evasion branch', ste: 'Stealth branch' },
      fortress: { def: 'Defence branch', con: 'Control branch' },
    };
    return names[path]?.[branch] ?? branch;
  }

  _makeCard(upgrade, pathColor, path) {
    const isAvailable = this.available.has(upgrade.id);
    const rank        = this.owned.get(upgrade.id) || 0;
    const isOwned     = rank > 0;
    const isMaxed     = rank >= upgrade.maxRanks;
    const isSelected  = this.selectedId === upgrade.id;
    const isHybrid    = upgrade.path === 'hybrid';
    const hybridColors= { shadow_strike:'#D4537E', phantom_bulwark:'#534AB7', siege_mode:'#D85A30' };
    const color       = isHybrid ? (hybridColors[upgrade.id] || pathColor) : pathColor;

    const card = document.createElement('div');
    card.style.cssText = `
      background: ${isOwned ? color + '14' : '#0d0d0f'};
      border: 1px solid ${isSelected ? color : isOwned ? color + '66' : '#2a2a32'};
      border-radius: 6px;
      padding: 10px 12px;
      cursor: ${isAvailable && !isMaxed ? 'pointer' : 'default'};
      opacity: ${!isAvailable ? '0.35' : '1'};
      position: relative;
      transition: border-color .15s, background .15s;
    `;

    // Badge
    let badge = '';
    if (isMaxed)     badge = `<span style="position:absolute;top:7px;right:8px;font-size:9px;padding:1px 6px;background:#2a2a32;color:#6b6b7a;border-radius:3px">MAX</span>`;
    else if (isOwned) badge = `<span style="position:absolute;top:7px;right:8px;font-size:9px;padding:1px 6px;background:${color}22;color:${color};border-radius:3px">rank ${rank}</span>`;

    // Rank pips
    let pips = '';
    if (upgrade.maxRanks > 1) {
      pips = '<div style="display:flex;gap:3px;margin-top:6px;">';
      for (let i = 0; i < upgrade.maxRanks; i++) {
        pips += `<div style="width:10px;height:3px;border-radius:2px;background:${i < rank ? color : '#2a2a32'}"></div>`;
      }
      pips += '</div>';
    }

    const statPreview = Object.entries(upgrade.stats).slice(0,2)
      .map(([k,v]) => `${k}: ${v}`)
      .join(' · ');

    card.innerHTML = `
      ${badge}
      <div style="font-size:13px;font-weight:600;color:${isAvailable ? '#e8e8ec' : '#4a4a58'};margin-bottom:3px;padding-right:${isOwned||isMaxed?44:0}px">${upgrade.name}</div>
      <div style="font-size:11px;color:#6b6b7a;line-height:1.4">${statPreview}</div>
      ${pips}
    `;

    if (isAvailable && !isMaxed) {
      card.addEventListener('click', () => {
        this.selectedId = upgrade.id;
        this._renderGrid();
        this._renderDetail(upgrade, color);
        this._setConfirmEnabled(true);
      });
    } else {
      card.addEventListener('click', () => this._renderDetail(upgrade, color));
    }

    return card;
  }

  _renderDetail(upgrade, color) {
    const el   = this.container.querySelector('#upg-detail');
    const rank = this.owned.get(upgrade.id) || 0;
    const reqText = upgrade.requires.length
      ? upgrade.requires.join(' + ')
      : 'None';

    const statRows = Object.entries(upgrade.stats)
      .map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1a1a22;">
        <span style="color:#6b6b7a;font-size:11px">${this._statLabel(k)}</span>
        <span style="font-size:11px;color:#e8e8ec">${this._statValue(k,v)}</span>
      </div>`)
      .join('');

    el.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
        <div style="font-size:15px;font-weight:600;color:${color}">${upgrade.name}</div>
        ${upgrade.maxRanks > 1 ? `<div style="font-size:10px;color:#6b6b7a">${rank}/${upgrade.maxRanks} ranks owned</div>` : ''}
      </div>
      <div style="font-size:12px;color:#a0a0b0;line-height:1.5;margin-bottom:10px">${this._upgradeDesc(upgrade)}</div>
      <div style="margin-bottom:8px">${statRows}</div>
      <div style="font-size:10px;color:#4a4a58">Requires: ${reqText}</div>
    `;
  }

  _renderStats() {
    const el = this.container.querySelector('#upg-stats');
    if (!el || !this.stats) return;

    const show = [
      ['maxHp',               'Max HP',      v => v],
      ['fireRatePct',         'Fire rate',   v => '+' + v + '%'],
      ['flatDmgBonus',        'Damage',      v => '+' + v],
      ['moveSpeedPct',        'Move speed',  v => '+' + v + '%'],
      ['dmgReductionPct',     'Damage reduction', v => v + '%'],
      ['armourPiercePct',     'Armour pierce',    v => v + '%'],
      ['captureSpeedBonusPct','Capture speed',    v => '+' + v + '%'],
      ['ccReductionPct',      'CC reduction',     v => v + '%'],
      ['slowChancePct',       'Slow chance',      v => v + '%'],
    ];

    el.innerHTML = show
      .filter(([key]) => this.stats[key])
      .map(([key, label, fmt]) =>
        `<div style="font-size:11px;padding:3px 8px;background:#1a1a22;border-radius:4px;color:#a0a0b0">
          <span style="color:#6b6b7a">${label}:</span> ${fmt(this.stats[key])}
        </div>`)
      .join('') || '<div style="font-size:11px;color:#6b6b7a">No stat bonuses yet</div>';
  }

  _setConfirmEnabled(on) {
    const btn = this.container.querySelector('#upg-confirm');
    if (!btn) return;
    btn.disabled = !on;
    btn.style.opacity = on ? '1' : '.4';
    btn.style.cursor  = on ? 'pointer' : 'default';
  }

  _statLabel(key) {
    const labels = {
      burstDmg:'Burst damage', burstRadius:'Burst radius', burstCooldown:'Cooldown',
      fireRatePct:'Fire rate', flatDmgBonus:'Flat damage', slowChancePct:'Slow chance',
      slowAmtPct:'Slow amount', slowDuration:'Slow duration', armourPiercePct:'Armour pierce',
      chainDmg:'Chain damage', chainRange:'Chain range', burnDps:'Burn DPS',
      burnMaxStacks:'Max stacks', beamDmg:'Beam damage', beamCooldown:'Beam cooldown',
      abilityDisableDuration:'Disable duration', pulseRadius:'Pulse radius',
      silenceDuration:'Silence duration', pulseCooldown:'Pulse cooldown',
      dmgBonusPct:'Damage bonus', blinkRange:'Blink range', blinkCooldown:'Blink cooldown',
      smokeRadius:'Smoke radius', smokeDuration:'Smoke duration', procChancePct:'Proc chance',
      moveSpeedPct:'Move speed', decoyTauntDuration:'Decoy duration',
      cloneDuration:'Clone duration', dashDmg:'Dash damage', stunDuration:'Stun duration',
      blinkCdReduction:'CD reduction', cloakDuration:'Cloak duration',
      cloakCooldown:'Cloak cooldown', radarBlindRadius:'Radar blind radius',
      disorientDuration:'Disorient duration', autoCloakDuration:'Auto-cloak duration',
      postBlinkDmgBonusPct:'Post-blink damage', lethalBlockDuration:'Invuln duration',
      usesPerRound:'Uses per round', maxHpBonus:'Max HP bonus',
      dmgReductionPct:'Damage reduction', captureSpeedBonusPct:'Capture speed',
      ccReductionPct:'CC reduction', hpThresholdPct:'HP threshold',
      immunityDuration:'Immunity duration', cooldown:'Cooldown',
      hitsRequired:'Hits required', window:'Window (s)', burstDmgField:'Burst damage',
      blockDuration:'Block duration', regenHpPerSec:'HP regen/s',
      auraRadius:'Aura radius', slowPct:'Slow amount', pullRadius:'Pull radius',
      defBonusPct:'Defence bonus', triggerRadius:'Trigger radius', wardDmg:'Ward damage',
      nodeRegenHpPerSec:'Node regen/s', nodeDmgReductionPct:'Node damage reduction',
      surviveAtHp:'Survive at HP', duration:'Duration', barrierLength:'Barrier length',
      barrierDuration:'Barrier duration', auraSlowPct:'Aura slow',
      cloakDmgBonusPct:'Cloak damage bonus', hitsAbsorbedAfterBlink:'Hits absorbed',
      stacksForDouble:'Stacks for 2× burst',
    };
    return labels[key] || key;
  }

  _statValue(key, v) {
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (key.endsWith('Pct') || key.endsWith('Percent')) return v + '%';
    if (key.endsWith('Duration') || key.endsWith('Cooldown') || key === 'window') return v + 's';
    if (key.endsWith('Range') || key.endsWith('Radius') || key.endsWith('Length')) return v + 'm';
    if (key.endsWith('Dps')) return v + '/s';
    return v;
  }

  _upgradeDesc(upgrade) {
    const descs = {
      surge_burst:    'Activate a short-range energy burst dealing 35 damage in a 3m radius.',
      overclock:      'Permanently increase fire rate by 20% per rank.',
      shatter_round:  'Every 5th shot explodes on impact for 20% bonus AoE damage.',
      neural_spike:   'Shots have a chance to slow enemy movement for 1.5s per rank.',
      zero_point:     'Shots briefly ignore 30–50% of target armour.',
      cascade:        'Kills trigger a chain reaction dealing 25 damage to the nearest enemy.',
      armour_pierce:  'Permanently increase damage by 8 per rank.',
      meltdown:       'Consecutive hits stack a burn. Max 3 stacks.',
      phase_cannon:   'Replace burst with an 80-damage charged beam that pierces walls.',
      disruptor:      'Burst applies a 2s ability disable on hit.',
      emp_pulse:      'Detonate a 6m pulse that silences enemies for 1.5s.',
      killshot:       'Gain +50% damage when targeting enemies below 25% HP.',
      overload:       'Burst fires a second delayed wave at 60% damage.',
      chain_reaction: 'Kills reduce all cooldowns by 2s.',
      nullifier:      'Shots apply a stacking defence debuff (max 5 stacks).',
      detonator:      'Every 4th hit on the same target detonates for 60 bonus damage.',
      zero_day:       'Burst leaves a persistent damage zone for 3s. Pierces shields.',
      phase_step:     'Short-range 6m blink with 5s cooldown.',
      smoke_screen:   'Deploy a 4m smoke cloud lasting 4s. Stackable charges.',
      refraction:     '15% chance per rank to cloak briefly when hit.',
      ghost_walk:     '+12% movement speed per rank.',
      afterimage:     'Blinking leaves a taunting decoy for 1.5s.',
      mirror_clone:   'Create a moving clone that mimics your path for 3s. Once per round.',
      static_dash:    'Dashing through enemies deals 20 damage and stuns for 0.5s.',
      flicker:        'Reduce blink cooldown by 1.5s per rank.',
      cloak:          'Go fully invisible for 2s. Attacking breaks cloak.',
      dark_veil:      'Smoke clouds grant full invisibility to allies inside.',
      signal_jam:     'While cloaked, blind enemy radar in a 5m radius.',
      blind_spot:     'Enemies attacked from cloak are disoriented for 1s.',
      ghost_protocol: 'Kills reset blink cooldown and grant 1s auto-cloak.',
      phantom_rush:   '0.8s pass-through dash that ignores all obstacles.',
      echo_step:      '+40% damage on your next attack within 2s of blinking.',
      wraithform:     'Block one lethal hit per round, surviving at 1 HP with 2s invuln.',
      wraith_form:    'Full 8s invisibility. Move and attack without breaking cloak.',
      hardened_shell: '+30 max HP per rank.',
      iron_skin:      '-5% incoming damage per rank.',
      node_lock:      '+25% capture speed and slows enemy decapture rate.',
      bulwark:        'Dropping below 30% HP triggers a 3s damage immunity.',
      reactive_armour:'Taking 3 hits in 2s triggers a 15-damage burst to nearby enemies.',
      null_shield:    'Block all frontal damage for 1.5s.',
      redoubt:        'Regenerate 5 HP/s while standing still.',
      ironclad:       '-30% crowd control duration per rank.',
      static_field:   '4m slow aura reducing enemy movement by 25%.',
      gravity_well:   'Pull all enemies within 6m toward you.',
      anchor:         'Tether to an objective for +20% defence and +50% capture speed.',
      pulse_ward:     'Drop a ward that detonates for 40 damage when triggered.',
      bastion:        'Regenerate 8 HP/s and gain 15% damage reduction while on a node.',
      citadel:        'Survive one lethal hit per round at 1 HP with 80% damage reduction.',
      immovable:      'Immune to knockback and crowd control. +10% damage reduction.',
      storm_wall:     'Place a 5m energy barrier for 4s. Allies pass freely.',
      iron_citadel:   'Complete immunity while capturing. 40% slow aura in 4m.',
      shadow_strike:  'Fire from cloak without breaking it on the first shot. +60% damage.',
      phantom_bulwark:'Absorb the next hit after blinking.',
      siege_mode:     'Build 3 damage stacks; your next burst hits twice as hard with knockback.',
    };
    return descs[upgrade.id] || 'No description available.';
  }
}

// Export for Node (tests) or leave as global for browser
if (typeof module !== 'undefined') {
  module.exports = { UpgradeScreen };
} else {
  window.UpgradeScreen = UpgradeScreen;
}