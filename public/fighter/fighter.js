// public/fighter/fighter.js
// Fighter game Stage 2 wiring — hero-attacks-monster loop.
//
// Stage 1 (Foundation): canvas skeleton, hero placeholder, HP bar, start button.
// Stage 2 (Combat Core): monster display, combat loop, star rewards.
// Stage 3 (HP + Counter-Attack): hero HP, monster counter-attack, game over, restart.
//
// Pattern: pure functions mirrored from src/games/fighter/logic.ts for browser runtime.
// Assets from /public/assets/fighter/*.png are Stage 5. Game must not break on 404.

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  /** Tick interval for game loop (check counter-attack every 250ms) */
  const TICK_INTERVAL_MS = 250;

  /** Stage 5: Item catalog (mirrors src/games/fighter/items.ts ITEMS) */
  const ITEMS = {
    sword:  { type: 'sword',  name: '剑',     cost: 10, effect: { atk: 5 } },
    shield: { type: 'shield', name: '盾',     cost: 8,  effect: { def: 3 } },
    potion: { type: 'potion', name: '药水',   cost: 5,  effect: { heal: 30 } },
  };
  const ITEM_LIST = Object.values(ITEMS);

  // ---- Stage 5: Economy (localStorage bank) ----
  const BANK_KEY = 'fighterStarBank';

  function loadBank() {
    try {
      const raw = localStorage.getItem(BANK_KEY);
      return raw ? (parseInt(raw, 10) || 0) : 0;
    } catch {
      return 0;
    }
  }

  function saveBank(bank) {
    try {
      localStorage.setItem(BANK_KEY, String(bank));
    } catch { /* ignore */ }
  }

  // ============================================================
  // PURE LOGIC (mirrors src/games/fighter/logic.ts — kept in sync)
  // ============================================================

  // ---- Stage definitions (mirrors src/games/fighter/state.ts) ----
  const STAGES = [
    { id: 1, name: '新手试炼', monsters: Array(5).fill({ id: 'fungus', name: '懒词菌', atk: 5, def: 0 }), reward: 5 },
    { id: 2, name: '继续前进', monsters: Array(8).fill({ id: 'fungus', name: '懒词菌', atk: 5, def: 0 }), reward: 8 },
    { id: 3, name: '多义虫来袭', monsters: Array(6).fill({ id: 'worm', name: '多义虫', atk: 8, def: 2 }), reward: 10 },
    { id: 4, name: '混编突袭', monsters: [...Array(6).fill({ id: 'fungus', name: '懒词菌', atk: 5, def: 0 }), ...Array(4).fill({ id: 'worm', name: '多义虫', atk: 8, def: 2 })], reward: 12 },
    { id: 5, name: '巨龙巢穴', monsters: [{ id: 'dragon', name: '拼写巨龙', atk: 20, def: 5 }, ...Array(5).fill({ id: 'worm', name: '多义虫', atk: 8, def: 2 })], reward: 20 },
  ];

  /** Monster HP formula: small monster = 30 HP, dragon boss = 100 HP */
  function monsterHpFor(template) {
    if (template.id === 'dragon') return 100;
    if (template.id === 'worm') return 50;
    return 30; // fungus default
  }

  /** Monster variant definitions (mirrors src/games/fighter/state.ts MONSTER_VARIANTS). */
  const MONSTER_VARIANTS = {
    fungus:  { id: 'fungus',  name: '懒词菌',   atk: 5,  def: 0, counterIntervalMs: 6000 },
    worm:    { id: 'worm',    name: '多义虫',   atk: 8,  def: 2, counterIntervalMs: 6000 },
    dragon:  { id: 'dragon',  name: '拼写巨龙', atk: 20, def: 5, counterIntervalMs: 6000 },
  };

  /** Returns true if monster HP <= 0. */
  function isMonsterDead(monster) {
    if (monster === null) return true;
    return monster.hp <= 0;
  }

  /** Returns new state with monster HP reduced by hero.atk (clamped to 0). Pure. */
  function attackMonster(state) {
    if (state.currentMonster === null) {
      return state;
    }
    const newHp = Math.max(0, state.currentMonster.hp - state.hero.atk);
    return {
      ...state,
      currentMonster: { ...state.currentMonster, hp: newHp },
    };
  }

  /** Award stars to sessionStars (and bank). Pure. */
  function gainStars(state, amount) {
    return {
      ...state,
      sessionStars: state.sessionStars + amount,
      bank: state.bank + amount,
    };
  }

  /** Spawn next monster from current stage queue (consumed FIFO). Pure. */
  function spawnNextMonster(state) {
    if (state.stageQueueRemaining <= 0) {
      return { ...state, currentMonster: null };
    }

    const stage = STAGES[state.stageIdx];
    if (!stage || stage.monsters.length === 0) {
      return { ...state, currentMonster: null };
    }

    const monsterIndex = stage.monsters.length - state.stageQueueRemaining;
    if (monsterIndex < 0 || monsterIndex >= stage.monsters.length) {
      return { ...state, currentMonster: null };
    }

    const template = stage.monsters[monsterIndex];
    const hp = monsterHpFor(template);
    const newMonster = { ...template, hp, maxHp: hp };

    return {
      ...state,
      currentMonster: newMonster,
      stageQueueRemaining: state.stageQueueRemaining - 1,
    };
  }

  /** Kill current monster: award 1 star, then spawn next (or null if queue empty). Pure. */
  function killCurrentMonster(state) {
    const withStar = gainStars(state, 1);
    return spawnNextMonster(withStar);
  }

  /** Start the game: load stage 1 monsters and spawn the first one. Pure. */
  function startGame(state) {
    const stage = STAGES[0];
    return spawnNextMonster({
      ...state,
      status: 'fighting',
      stageQueueRemaining: stage.monsters.length,
    });
  }

  // ============================================================
  // STATE
  // ============================================================

  /** Returns a fresh initial state. */
  function makeInitialState() {
    return {
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
      currentMonster: null,
      stageIdx: 0,
      stageQueueRemaining: 0,
      stageStartIdx: 0,
      bank: loadBank(),
      sessionStars: 0,
      status: 'menu',
      equippedItems: { sword: false, shield: false, potion: false },
    };
  }

  const state = makeInitialState();

  // Expose for E2E introspection
  window.__fighterState = state;

  // ============================================================
  // DOM REFS
  // ============================================================

  const canvas       = document.getElementById('fighter-canvas');
  const ctx          = canvas ? canvas.getContext('2d') : null;
  const hpBar        = document.getElementById('hp-bar');
  const hpFill       = document.getElementById('hp-fill');
  const hpText       = document.getElementById('hp-text');
  const stageInfo    = document.getElementById('stage-info');
  const btnStart     = document.getElementById('btn-start-fight');

  // Stage 2 DOM refs
  const monsterSprite  = document.getElementById('monster-sprite');
  const monsterName     = document.getElementById('monster-name');
  const monsterHpBar    = document.getElementById('monster-hp-bar');
  const monsterHpFill   = document.getElementById('monster-hp-fill');
  const monsterHpText    = document.getElementById('monster-hp-text');
  const starsCounter     = document.getElementById('stars-counter');
  const starsValue       = document.getElementById('stars-value');
  const starBurst        = document.getElementById('star-burst');
  const queueInfo        = document.getElementById('queue-info');
  const queueCount       = document.getElementById('queue-count');

  // Stage 3 DOM refs
  const gameOverModal     = document.getElementById('game-over-modal');
  const gameOverStars     = document.getElementById('game-over-stars');
  const btnRestart        = document.getElementById('btn-restart');
  const victoryModal      = document.getElementById('victory-modal');
  const btnNextStage      = document.getElementById('btn-next-stage');

  // Stage 4 DOM refs
  const stageClearModal     = document.getElementById('stage-clear-modal');
  const stageClearText      = document.getElementById('stage-clear-text');
  const stageClearBonus     = document.getElementById('stage-clear-bonus');
  const shopBalance         = document.getElementById('shop-balance');
  const shopGrid            = document.getElementById('shop-grid');
  const btnRestartVictory   = document.getElementById('btn-restart-victory');
  const defeatModal         = document.getElementById('defeat-modal');
  const defeatStars        = document.getElementById('defeat-stars');
  const btnRestartDefeat    = document.getElementById('btn-restart-defeat');
  const victoryTotalStars  = document.getElementById('victory-total-stars');

  // ============================================================
  // STAGE 3: GAME LOOP STATE
  // ============================================================

  let gameInterval = null;

  // ============================================================
  // STAGE 3: GAME LOOP
  // ============================================================

  /**
   * Pure function: monster counter-attack tick.
   * Returns new state with updated hero HP if counter-attack should occur.
   */
  function monsterCounterAttackTick(state, nowMs) {
    // Only process counter-attack when fighting and monster exists
    if (state.status !== 'fighting' || state.currentMonster === null) {
      return state;
    }

    // Get counter interval for current monster type
    const variant = MONSTER_VARIANTS[state.currentMonster.id];
    if (!variant) return state;

    const counterIntervalMs = variant.counterIntervalMs;
    const timeSinceLastHit = nowMs - (state.hero.lastHitAt || 0);

    // Check if enough time has passed since last hit
    if (timeSinceLastHit < counterIntervalMs) {
      return state;
    }

    // Calculate damage after shield reduction (minimum 1)
    const shieldBonus = state.hero.shieldBonus || 0;
    const damageTaken = Math.max(1, state.currentMonster.atk - shieldBonus);
    const newHp = Math.max(0, state.hero.hp - damageTaken);

    // Check for game over
    if (newHp <= 0) {
      return {
        ...state,
        hero: { ...state.hero, hp: 0, lastHitAt: nowMs },
        currentMonster: null,
        status: 'lost',
      };
    }

    // Return state with reduced HP and updated lastHitAt
    return {
      ...state,
      hero: { ...state.hero, hp: newHp, lastHitAt: nowMs },
    };
  }

  /** Game over detected when status is 'lost'. */
  function isGameOver(state) {
    return state.status === 'lost';
  }

  /** Restart game: reset hero to full HP, stars to 0, status to 'menu'.
   *  Bank (persistent) is kept, equippedItems are cleared (per-run). */
  function restartGame(state) {
    return {
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
      currentMonster: null,
      stageIdx: 0,
      stageQueueRemaining: 0,
      stageStartIdx: 0,
      bank: state.bank,  // Keep persistent bank across restarts
      sessionStars: 0,
      status: 'menu',
      equippedItems: { sword: false, shield: false, potion: false },  // clear per-run
    };
  }

  // ---- Stage 4: Stage Progression ----

  /** Result of evaluating a stage transition. */
  function evaluateStageTransition(state) {
    if (state.status !== 'fighting') {
      return { nextStatus: state.status, reason: 'continue' };
    }
    if (state.currentMonster !== null) {
      return { nextStatus: 'fighting', reason: 'continue' };
    }

    const stageReward = (STAGES[state.stageIdx] && STAGES[state.stageIdx].reward) || 0;

    if (state.stageIdx === STAGES.length - 1) {
      // Last stage cleared → victory
      return { nextStatus: 'won', bonus: stageReward, reason: 'victory' };
    }

    // More stages remain → advance
    return { nextStatus: 'fighting', nextStageIdx: state.stageIdx + 1, bonus: stageReward, reason: 'cleared' };
  }

  /** Advance to next stage: award bonus + spawn first monster of next stage + reset hero HP. */
  function advanceToNextStage(state) {
    const stageReward = (STAGES[state.stageIdx] && STAGES[state.stageIdx].reward) || 0;
    const nextStageIdx = state.stageIdx + 1;
    const nextStage = STAGES[nextStageIdx];

    // Award stage bonus stars
    let next = {
      ...state,
      sessionStars: state.sessionStars + stageReward,
      bank: state.bank + stageReward,
      stageIdx: nextStageIdx,
      hero: {
        ...state.hero,
        hp: state.hero.maxHp,
        lastHitAt: Date.now() + 30000, // Set 30s ahead so first tick won't deal damage
      },
    };

    // Spawn first monster of next stage
    if (nextStage && nextStage.monsters.length > 0) {
      const template = nextStage.monsters[0];
      const hp = monsterHpFor(template);
      next = {
        ...next,
        currentMonster: { ...template, hp, maxHp: hp },
        stageQueueRemaining: nextStage.monsters.length - 1,
      };
    } else {
      next.currentMonster = null;
      next.stageQueueRemaining = 0;
    }

    return next;
  }

  // ---- Stage 5: Shop helpers ----

  function canAfford(state, item) {
    return state.sessionStars >= item.cost;
  }

  function applyItem(state, item) {
    switch (item.type) {
      case 'sword': {
        return { ...state, hero: { ...state.hero, atk: state.hero.atk + (item.effect.atk ?? 5) } };
      }
      case 'shield': {
        return { ...state, hero: { ...state.hero, def: state.hero.def + (item.effect.def ?? 3) } };
      }
      case 'potion': {
        const newHp = Math.min(state.hero.hp + (item.effect.heal ?? 30), state.hero.maxHp);
        return { ...state, hero: { ...state.hero, hp: newHp } };
      }
    }
  }

  function purchaseItem(state, itemType) {
    const item = ITEMS[itemType];
    if (!canAfford(state, item) || state.equippedItems[itemType]) {
      return state; // cannot afford or already owned
    }
    return applyItem({
      ...state,
      sessionStars: state.sessionStars - item.cost,
      equippedItems: { ...state.equippedItems, [itemType]: true },
    }, item);
  }

  function commitSessionToBank(state) {
    const newBank = state.bank + state.sessionStars;
    saveBank(newBank);
    return { ...state, bank: newBank, sessionStars: 0 }; // spec: reset after commit (call at game end, not on stage clear)
  }

  /** Mark the game as won (all 5 stages cleared). */
  function triggerVictory(state) {
    return { ...state, status: 'won', currentMonster: null };
  }

  /** Mark the game as lost (hero HP <= 0). */
  function triggerDefeat(state) {
    return { ...state, status: 'lost', currentMonster: null, hero: { ...state.hero, hp: 0 } };
  }

  /** Start the game loop (counter-attack tick every TICK_INTERVAL_MS). */
  function startGameLoop() {
    if (gameInterval !== null) return;

    gameInterval = setInterval(() => {
      const nowMs = Date.now();
      const prevHp = state.hero.hp;
      const nextState = monsterCounterAttackTick(state, nowMs);

      // Check if state changed
      if (nextState !== state) {
        setState(nextState);

        // Check for HP change (for damage flash)
        if (nextState.hero.hp < prevHp) {
          flashHpDamage();
        }

        renderHpBar();
        drawHero();

        // Check for game over
        if (isGameOver(nextState)) {
          stopGameLoop();
          showGameOverModal();
        }
      }
    }, TICK_INTERVAL_MS);
  }

  /** Stop the game loop. */
  function stopGameLoop() {
    if (gameInterval !== null) {
      clearInterval(gameInterval);
      gameInterval = null;
    }
  }

  /** Show game over modal. */
  function showGameOverModal() {
    // Use defeat modal instead of legacy game-over modal
    showDefeatModal();

    // Also hide legacy game-over modal if visible
    if (gameOverModal) gameOverModal.hidden = true;

    // Remove monster fighting state
    if (monsterSprite) {
      monsterSprite.removeAttribute('data-state');
    }
  }

  /** Hide game over modal. */
  function hideGameOverModal() {
    if (gameOverModal) {
      gameOverModal.hidden = true;
    }
  }

  /** Restart the game. */
  function restart() {
    stopGameLoop();
    hideGameOverModal();
    hideStageClearModal();
    hideVictoryModal();
    hideDefeatModal();

    const freshState = restartGame(state);
    setState(freshState);

    // Explicitly reset equippedItems to ensure clean state (Object.assign shallow merge safety)
    state.equippedItems = { sword: false, shield: false, potion: false };

    // Reset UI
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.textContent = '开始战斗';
    }

    // Reset monster display
    if (monsterSprite) {
      monsterSprite.textContent = '?';
      monsterSprite.setAttribute('data-monster-id', '');
      monsterSprite.removeAttribute('data-state');
    }
    if (monsterName) {
      monsterName.textContent = '点击「开始战斗」';
    }
    if (monsterHpBar) {
      monsterHpBar.hidden = true;
    }

    // Reset UI visibility
    if (starsCounter) starsCounter.hidden = true;
    if (queueInfo) queueInfo.hidden = true;

    // Re-render
    renderHpBar();
    renderStageInfo();
    drawHero();
  }

  /** Show stage clear modal with shop (between stages). */
  function showStageClearModal(bonus, stageIdx) {
    if (!stageClearModal) return;
    if (stageClearText) stageClearText.textContent = `第 ${stageIdx + 1} 关完成`;
    if (stageClearBonus) stageClearBonus.textContent = `+${bonus}⭐`;

    // Update balance display
    if (shopBalance) shopBalance.textContent = String(state.sessionStars);

    // Render shop items
    renderShopGrid();

    stageClearModal.hidden = false;
  }

  /** Render the shop grid with 3 item buttons. */
  function renderShopGrid() {
    if (!shopGrid) return;
    shopGrid.innerHTML = '';

    for (const item of ITEM_LIST) {
      const btn = document.createElement('button');
      btn.className = 'shop-item';
      btn.dataset.itemType = item.type;

      const isOwned = state.equippedItems[item.type];
      const canBuy = canAfford(state, item);

      if (isOwned) {
        btn.dataset.owned = 'true';
        btn.disabled = true;
      } else {
        btn.disabled = !canBuy;
      }

      // Icon: try PNG first, fallback to emoji
      const iconWrap = document.createElement('span');
      const iconImg = document.createElement('img');
      iconImg.className = 'shop-item-icon';
      iconImg.src = `/assets/fighter/equip-${item.type}.png`;
      iconImg.alt = item.name;
      iconImg.onerror = function () {
        iconImg.style.display = 'none';
        const fallback = document.createElement('span');
        fallback.className = 'shop-item-emoji-fallback';
        fallback.textContent = item.type === 'sword' ? '⚔️' : item.type === 'shield' ? '🛡️' : '🧪';
        fallback.style.display = 'block';
        iconWrap.appendChild(fallback);
      };
      iconWrap.appendChild(iconImg);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'shop-item-name';
      nameSpan.textContent = item.name;

      const effectSpan = document.createElement('span');
      effectSpan.className = 'shop-item-effect';
      effectSpan.textContent = item.type === 'sword' ? '+5 ATK' : item.type === 'shield' ? '+3 DEF' : '+30 HP';

      const costSpan = document.createElement('span');
      costSpan.className = 'shop-item-cost';
      costSpan.textContent = isOwned ? '已拥有' : `${item.cost}⭐`;

      btn.appendChild(iconWrap);
      btn.appendChild(nameSpan);
      btn.appendChild(effectSpan);
      btn.appendChild(costSpan);

      btn.addEventListener('click', () => onShopItemClick(item.type));

      shopGrid.appendChild(btn);
    }

    shopGrid.hidden = false;
  }

  /** Handle shop item click — purchase if affordable and not owned. */
  function onShopItemClick(itemType) {
    const before = state.sessionStars;
    const next = purchaseItem(state, itemType);

    if (next === state) return; // no-op (couldn't afford or already owned)

    setState(next);
    renderShopGrid();
    renderStars(state.sessionStars);
    renderHeroStats();
  }

  /** Re-render hero ATK/DEF display in canvas or as overlay text. */
  function renderHeroStats() {
    // Canvas drawHero already renders HP — stats shown there on canvas hero box
    drawHero();
  }

  /** Hide stage clear modal. */
  function hideStageClearModal() {
    if (stageClearModal) stageClearModal.hidden = true;
  }

  /** Show victory modal (all 5 stages cleared). */
  function showVictoryModal() {
    if (!victoryModal) return;
    if (victoryTotalStars) victoryTotalStars.textContent = state.sessionStars;
    victoryModal.hidden = false;
    // Disable start button
    if (btnStart) {
      btnStart.disabled = true;
      btnStart.textContent = '已胜利';
    }
  }

  /** Hide victory modal. */
  function hideVictoryModal() {
    if (victoryModal) victoryModal.hidden = true;
  }

  /** Show defeat modal (hero HP <= 0). */
  function showDefeatModal() {
    if (!defeatModal) return;
    if (defeatStars) defeatStars.textContent = state.sessionStars;
    defeatModal.hidden = false;
    // Disable start button
    if (btnStart) {
      btnStart.disabled = true;
      btnStart.textContent = '游戏结束';
    }
  }

  /** Hide defeat modal. */
  function hideDefeatModal() {
    if (defeatModal) defeatModal.hidden = true;
  }

  // ============================================================
  // RENDER HELPERS
  // ============================================================

  /** Dispatch state-change event for E2E tests. */
  function notifyStateChange() {
    window.dispatchEvent(new CustomEvent('fighter:state-change', { detail: state }));
  }

  /** Update hero HP bar fill width and color. */
  function renderHpBar() {
    if (!hpFill) return;
    const pct = Math.max(0, Math.min(100, (state.hero.hp / state.hero.maxHp) * 100));
    hpFill.style.width = pct + '%';
    // Use red gradient per spec (same as monster HP bar)
    hpFill.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';

    // Update HP text
    if (hpText) {
      hpText.textContent = `${state.hero.hp}/${state.hero.maxHp}`;
    }

    // Update accessibility attributes
    if (hpBar) {
      hpBar.setAttribute('aria-valuenow', Math.round(pct));
    }
  }

  /** Flash HP bar red when hero takes damage. */
  function flashHpDamage() {
    if (!hpBar) return;
    hpBar.classList.remove('damaged');
    void hpBar.offsetWidth; // force reflow
    hpBar.classList.add('damaged');
  }

  /** Render hero sprite from Stage 5 asset (img tag with onerror fallback). */
  function renderHero() {
    const heroEl = document.getElementById('hero-sprite');
    if (!heroEl) return;
    const url = window.__fighterAssets?.['hero.png'];
    if (url) {
      heroEl.innerHTML = `<img src="${url}" alt="Hero" class="hero-img" onerror="this.style.display='none'; this.parentElement.classList.add('hero-placeholder')">`;
    }
    // No fallback div needed — canvas drawHero renders the visual
  }

  /** Update stage info text. */
  function renderStageInfo() {
    if (!stageInfo) return;
    stageInfo.textContent = `Stage ${state.stageIdx + 1} / 5`;
  }

  /** Render monster display with img tag from Stage 5 assets. */
  function renderMonster(monster) {
    if (!monsterSprite || !monsterName || !monsterHpBar) return;

    if (monster === null) {
      monsterSprite.textContent = '✓';
      monsterSprite.setAttribute('data-monster-id', '');
      monsterSprite.removeAttribute('data-state');
      monsterName.textContent = '已击败全部怪物!';
      monsterHpBar.hidden = true;
      return;
    }

    monsterSprite.setAttribute('data-monster-id', monster.id);
    const url = window.__fighterAssets?.[`monster-${monster.id}.png`];
    if (url) {
      monsterSprite.innerHTML = `<img src="${url}" alt="${monster.name}" class="monster-img" onerror="this.style.display='none'; this.parentElement.textContent='${monster.id === 'fungus' ? '菌' : monster.id === 'worm' ? '虫' : '龙'}'">`;
    } else {
      monsterSprite.textContent = monster.id === 'fungus' ? '菌' : monster.id === 'worm' ? '虫' : '龙';
    }
    monsterName.textContent = monster.name;

    // HP bar
    monsterHpBar.hidden = false;
    const pct = Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100));
    monsterHpFill.style.width = pct + '%';
    monsterHpText.textContent = `${monster.hp}/${monster.maxHp}`;
  }

  /** Update stars counter. */
  function renderStars(n) {
    if (!starsValue) return;
    starsValue.textContent = n;
  }

  /** Update queue counter. */
  function renderQueue(n) {
    if (!queueCount) return;
    queueCount.textContent = n;
  }

  /** Draw hero placeholder on canvas. */
  function drawHero() {
    if (!ctx) return;
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, '#0d1117');
    grad.addColorStop(1, '#161b22');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);

    // Hero placeholder: blue box on left side
    const heroX = 60;
    const heroY = ch / 2 - 60;
    const heroW = 80;
    const heroH = 80;

    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(heroX, heroY, heroW, heroH);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Hero', heroX + heroW / 2, heroY + heroH / 2);

    ctx.fillStyle = '#8b949e';
    ctx.font = '12px monospace';
    ctx.fillText(`HP: ${state.hero.hp}/${state.hero.maxHp}`, heroX + heroW / 2, heroY + heroH + 16);

    // Show ATK/DEF stats
    ctx.fillStyle = '#4ade80';
    ctx.font = '11px monospace';
    ctx.fillText(`ATK ${state.hero.atk}  DEF ${state.hero.def}`, heroX + heroW / 2, heroY - 12);

    // Center divider line
    ctx.strokeStyle = '#30363d';
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(cw / 2, 40);
    ctx.lineTo(cw / 2, ch - 40);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ============================================================
  // COMBAT ACTIONS
  // ============================================================

  /** Replace state with a new immutable copy and re-render. */
  function setState(newState) {
    // Preserve object reference for window.__fighterState so E2E sees updates
    Object.assign(state, newState);
    notifyStateChange();
  }

  /** Show +1⭐ burst animation briefly. */
  function animateStarBurst() {
    if (!starBurst) return;
    starBurst.hidden = false;
    // Remove and re-add to restart animation
    starBurst.classList.remove('star-burst');
    void starBurst.offsetWidth; // force reflow
    starBurst.classList.add('star-burst');
    setTimeout(() => {
      starBurst.hidden = true;
    }, 800);
  }

  /** Start fight — initialize stage and spawn first monster. */
  function startFight() {
    if (state.status !== 'menu') return;
    const next = startGame(state);
    setState(next);

    // Update sprite fighting state
    if (monsterSprite) {
      monsterSprite.setAttribute('data-state', 'fighting');
    }

    // Show UI elements
    if (starsCounter) starsCounter.hidden = false;
    if (queueInfo) queueInfo.hidden = false;

    // Initial renders
    renderMonster(state.currentMonster);
    renderStars(state.sessionStars);
    renderQueue(state.stageQueueRemaining);

    // Disable start button
    if (btnStart) {
      btnStart.disabled = true;
      btnStart.textContent = '战斗中...';
    }

    // Start game loop for counter-attack
    startGameLoop();
  }

  /** Handle click on monster sprite — attack and kill logic. */
  function attackMonsterClick() {
    if (state.status !== 'fighting') return;
    if (!state.currentMonster) return;

    const afterAttack = attackMonster(state);
    setState(afterAttack);
    renderMonster(state.currentMonster);

    if (isMonsterDead(state.currentMonster)) {
      // Kill monster, award star, spawn next
      const afterKill = killCurrentMonster(state);
      setState(afterKill);

      // Animate star burst
      animateStarBurst();

      // Render updated state
      renderMonster(state.currentMonster);
      renderStars(state.sessionStars);
      renderQueue(state.stageQueueRemaining);
      renderStageInfo();

      // Stage 4: Evaluate stage transition
      const transition = evaluateStageTransition(state);

      if (transition.reason === 'cleared') {
        // Stage cleared: award bonus + advance + show modal
        stopGameLoop(); // Stop counter-attack while modal is shown
        const afterAdvance = advanceToNextStage(state);
        setState(afterAdvance);
        renderHpBar();
        renderMonster(state.currentMonster);
        renderStars(state.sessionStars);
        renderQueue(state.stageQueueRemaining);
        renderStageInfo();
        showStageClearModal(transition.bonus, state.stageIdx - 1); // -1 since advance already happened

        if (btnStart) {
          btnStart.disabled = false;
          btnStart.textContent = '下一关';
        }
        if (monsterSprite) {
          monsterSprite.removeAttribute('data-state');
        }

      } else if (transition.reason === 'victory') {
        // All 5 stages cleared
        const afterVictory = triggerVictory(state);
        setState(afterVictory);
        stopGameLoop();
        showVictoryModal();

        if (monsterSprite) {
          monsterSprite.removeAttribute('data-state');
        }

      } else {
        // Normal fighting: monster spawned, continue
        if (btnStart) {
          btnStart.disabled = false;
          btnStart.textContent = '开始战斗';
        }
        if (monsterSprite) {
          monsterSprite.removeAttribute('data-state');
        }
      }
    }
  }

  // ============================================================
  // EVENT LISTENERS
  // ============================================================

  btnStart?.addEventListener('click', () => {
    startFight();
  });

  monsterSprite?.addEventListener('click', () => {
    attackMonsterClick();
  });

  btnRestart?.addEventListener('click', () => {
    restart();
  });

  btnNextStage?.addEventListener('click', () => {
    // Start next stage: spawn monsters and resume game loop
    hideStageClearModal();
    if (state.currentMonster) {
      if (monsterSprite) {
        monsterSprite.setAttribute('data-state', 'fighting');
      }
      if (btnStart) {
        btnStart.disabled = true;
        btnStart.textContent = '战斗中...';
      }
      startGameLoop();
    }
  });

  btnRestartVictory?.addEventListener('click', () => {
    restart();
  });

  btnRestartDefeat?.addEventListener('click', () => {
    restart();
  });

  // ============================================================
  // INITIAL RENDER
  // ============================================================

  drawHero();
  renderHpBar();
  renderStageInfo();

  // ============================================================
  // STAGE 5: ASSET PRELOADING + QUIZ INTEGRATION
  // ============================================================

  const FIGHTER_ASSET_FILES = [
    'hero.png',
    'monster-fungus.png',
    'monster-worm.png',
    'monster-dragon.png',
    'equip-sword.png',
    'equip-shield.png',
    'equip-potion.png',
    'ui-hpbar.png',
  ];

  /**
   * Load a single asset, returning URL or null.
   * @param {string} filename
   * @returns {Promise<string|null>}
   */
  async function loadAsset(filename) {
    const url = `/assets/fighter/${filename}`;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      return res.ok ? url : null;
    } catch {
      return null;
    }
  }

  /**
   * Preload all fighter assets in parallel and expose on window for E2E.
   */
  async function preloadAllAssets() {
    const entries = await Promise.all(FIGHTER_ASSET_FILES.map(async (f) => [f, await loadAsset(f)]));
    const assetMap = Object.fromEntries(entries);
    window.__fighterAssets = assetMap;

    // If HP bar image loaded, apply image overlay class
    if (assetMap['ui-hpbar.png'] && hpBar) {
      hpBar.classList.add('hp-bar--has-image');
    }

    // Render hero sprite from loaded assets
    renderHero();

    // Re-render current monster if fighting
    if (state.currentMonster) {
      renderMonster(state.currentMonster);
    }

    return assetMap;
  }

  /** Subscribe to fighter:add-stars event for quiz hook. */
  window.addEventListener('fighter:add-stars', (e) => {
    const { stars } = e.detail ?? {};
    if (typeof stars === 'number' && stars > 0) {
      setState({
        ...state,
        sessionStars: state.sessionStars + stars,
        bank: state.bank + stars,
      });
      renderStars(state.sessionStars);
      // Animate if stars counter is visible
      if (starsCounter && !starsCounter.hidden) {
        animateStarBurst();
      }
    }
  });

  // Start asset preloading in background (don't await — game starts immediately)
  preloadAllAssets();

  // ---- Expose helpers for E2E testing ----
  window.__showShopModal = () => showStageClearModal(state.bank, state.stageIdx);
  window.__renderShopGrid = () => renderShopGrid();
  window.__setSessionStars = (n) => {
    state.sessionStars = n;
    notifyStateChange();
  };
  window.__setState = (overrides) => {
    setState({ ...state, ...overrides });
  };
  window.__simulateShopClick = (itemType) => {
    onShopItemClick(itemType);
  };
  window.__restartGame = () => {
    restart();
  };
  // Expose bank directly for E2E testing (localStorage reload may not work in wrangler dev)
  Object.defineProperty(window, '__fighterBank', {
    get: () => state.bank,
    configurable: true,
  });

})();
