/**
 * Fighter V2 Stage Intro Renderer
 * Shows World name + stage roster + start button
 * Per spec §5.2 Stage Select Scene
 */

import { getWorldStages, getWorld, MONSTER_TYPES } from './stages.js';
import { createElement, clearChildren } from './utils.js';

/**
 * Render stage intro into container element
 * @param {HTMLElement} container
 * @param {number} worldIdx
 * @param {Array<number>} worldsCleared - cleared world indices
 * @param {object} callbacks
 * @param {Function} callbacks.onStageClick - callback(stageIdx) when stage clicked
 * @param {Function} callbacks.onBack - callback when back button clicked
 */
export function renderStageIntro(container, worldIdx, worldsCleared, callbacks) {
  clearChildren(container);

  const world = getWorld(worldIdx);
  if (!world) {
    console.error(`World ${worldIdx} not found`);
    return;
  }

  const stages = getWorldStages(worldIdx);
  const isCleared = worldsCleared.includes(worldIdx);

  // Back button
  const backBtn = createElement(
    'button',
    {
      className: 'back-btn',
      onclick: callbacks.onBack,
    },
    '← 返回地图'
  );
  container.appendChild(backBtn);

  // World header
  const header = createElement(
    'div',
    {
      className: `stage-intro__header stage-intro__header--world-${worldIdx}`,
    },
    createElement('div', { className: 'stage-intro__title' }, `${worldIdx + 1} · ${world.name}`),
    createElement(
      'div',
      { className: 'stage-intro__subtitle' },
      isCleared ? '✓ 已通关' : '选择关卡开始挑战'
    )
  );
  container.appendChild(header);

  // Stages list
  const stagesList = createElement('div', { className: 'stage-intro__stages' });
  container.appendChild(stagesList);

  stages.forEach((stage, idx) => {
    const stageCleared = isStageCleared(worldIdx, idx, worldsCleared);

    // Build monster description
    const monsterDesc = buildMonsterDescription(stage);

    // Stage item
    const stageItem = createElement(
      'div',
      {
        className: `stage-item ${stageCleared ? 'cleared' : ''}`,
        'data-stage': idx,
      },
      // Info section
      createElement(
        'div',
        { className: 'stage-item__info' },
        createElement('div', { className: 'stage-item__name' }, `${worldIdx + 1}-${idx + 1}`),
        createElement('div', { className: 'stage-item__monsters' }, monsterDesc)
      ),
      // Action section
      createElement(
        'div',
        { className: 'stage-item__action' },
        stageCleared
          ? createElement('span', { className: 'stage-item__status stage-item__status--cleared' }, '✓')
          : createElement('button', { className: 'btn btn--primary' }, '开始')
      )
    );

    // Click handler
    stageItem.addEventListener('click', () => {
      if (callbacks.onStageClick) {
        callbacks.onStageClick(idx);
      }
    });

    stagesList.appendChild(stageItem);
  });
}

/**
 * Build human-readable monster description for a stage
 * @param {object} stage
 * @returns {string}
 */
export function buildMonsterDescription(stage) {
  if (!stage.monsters || stage.monsters.length === 0) {
    return '即将开放...';
  }

  const parts = stage.monsters.map(({ type, count }) => {
    const monster = MONSTER_TYPES[type];
    const name = monster ? monster.name : type;
    return `${name} ×${count}`;
  });

  return parts.join(' + ');
}

/**
 * Check if a specific stage is cleared
 * A stage is cleared if its world is cleared
 * @param {number} worldIdx
 * @param {number} stageIdx
 * @param {Array<number> | undefined} worldsCleared
 * @returns {boolean}
 */
export function isStageCleared(worldIdx, stageIdx, worldsCleared) {
  return Array.isArray(worldsCleared) && worldsCleared.includes(worldIdx);
}

/**
 * Start combat for a stage (P2: shows alert, P3: will hook combat)
 * @param {number} worldIdx
 * @param {number} stageIdx
 */
export function startCombat(worldIdx, stageIdx) {
  // P2: Just show alert that combat is coming
  alert(`Combat coming in P3!\n\n准备进入 ${worldIdx + 1}-${stageIdx + 1} 战斗...`);
}
