/**
 * Fighter V2 Skill Effects & VFX
 * DOM-based animations for fireball, heal, shield
 * Per spec §4 Skill Effects
 */

/**
 * Show floating damage/heal text on a target element
 * @param {HTMLElement | null} targetEl
 * @param {number} value - positive for damage, negative for heal
 * @param {'damage' | 'heal' | 'shield'} type
 */
export function showFloatingText(targetEl, value, type) {
  if (!targetEl) return;

  const span = document.createElement('span');
  span.className = `floating-text floating-text--${type}`;

  let text;
  switch (type) {
    case 'damage':
      text = `-${value}`;
      break;
    case 'heal':
      text = `+${value}`;
      break;
    case 'shield':
      text = `🛡️ +10`;
      break;
    default:
      text = String(value);
  }

  span.textContent = text;

  // Position near target
  const rect = targetEl.getBoundingClientRect();
  const parentRect = targetEl.parentElement?.getBoundingClientRect() || rect;

  // Center horizontally, above the target
  span.style.left = `${(rect.left + rect.width / 2) - (parentRect.left || 0)}px`;
  span.style.top = `${rect.top - (parentRect.top || 0)}px`;

  // Append to parent for animation
  targetEl.parentElement?.appendChild(span);

  // Remove after animation completes
  setTimeout(() => span.remove(), 1000);
}

/**
 * Show skill VFX animation on target
 * @param {HTMLElement | null} targetEl
 * @param {'fireball' | 'heal' | 'shield'} skillId
 */
export function showSkillEffect(targetEl, skillId) {
  if (!targetEl) return;

  switch (skillId) {
    case 'fireball':
      showFireballEffect(targetEl);
      break;
    case 'heal':
      showHealEffect(targetEl);
      break;
    case 'shield':
      showShieldEffect(targetEl);
      break;
  }
}

function showFireballEffect(targetEl) {
  // Create fireball particle elements
  const container = document.createElement('div');
  container.className = 'skill-vfx skill-vfx--fireball';

  const rect = targetEl.getBoundingClientRect();
  const parentRect = targetEl.parentElement?.getBoundingClientRect() || rect;

  // Position in center of target
  container.style.left = `${(rect.left + rect.width / 2) - (parentRect.left || 0)}px`;
  container.style.top = `${(rect.top + rect.height / 2) - (parentRect.top || 0)}px`;

  // Create explosion particles
  for (let i = 0; i < 8; i++) {
    const particle = document.createElement('div');
    particle.className = 'skill-particle skill-particle--fire';
    particle.style.setProperty('--angle', `${(i * 45) + Math.random() * 20 - 10}deg`);
    particle.style.setProperty('--distance', `${40 + Math.random() * 30}px`);
    container.appendChild(particle);
  }

  // Flash the target
  targetEl.classList.add('flash-damage');
  setTimeout(() => targetEl.classList.remove('flash-damage'), 300);

  targetEl.parentElement?.appendChild(container);
  setTimeout(() => container.remove(), 600);
}

function showHealEffect(targetEl) {
  // Create heal sparkles
  const container = document.createElement('div');
  container.className = 'skill-vfx skill-vfx--heal';

  const rect = targetEl.getBoundingClientRect();
  const parentRect = targetEl.parentElement?.getBoundingClientRect() || rect;

  // Position in center of target
  container.style.left = `${(rect.left + rect.width / 2) - (parentRect.left || 0)}px`;
  container.style.top = `${(rect.top + rect.height / 2) - (parentRect.top || 0)}px`;

  // Create sparkle particles
  for (let i = 0; i < 6; i++) {
    const sparkle = document.createElement('div');
    sparkle.className = 'skill-particle skill-particle--heal';
    sparkle.style.setProperty('--angle', `${(i * 60) + Math.random() * 30}deg`);
    sparkle.style.setProperty('--delay', `${i * 0.05}s`);
    container.appendChild(sparkle);
  }

  // Glow the target
  targetEl.classList.add('glow-heal');
  setTimeout(() => targetEl.classList.remove('glow-heal'), 500);

  targetEl.parentElement?.appendChild(container);
  setTimeout(() => container.remove(), 800);
}

function showShieldEffect(targetEl) {
  // Create shield ring effect
  const container = document.createElement('div');
  container.className = 'skill-vfx skill-vfx--shield';

  const rect = targetEl.getBoundingClientRect();
  const parentRect = targetEl.parentElement?.getBoundingClientRect() || rect;

  // Position in center of target
  container.style.left = `${(rect.left + rect.width / 2) - (parentRect.left || 0)}px`;
  container.style.top = `${(rect.top + rect.height / 2) - (parentRect.top || 0)}px`;

  // Create shield ring
  const ring = document.createElement('div');
  ring.className = 'skill-particle skill-particle--shield';
  container.appendChild(ring);

  targetEl.parentElement?.appendChild(container);
  setTimeout(() => container.remove(), 1000);
}

/**
 * Inject VFX CSS into head (called once)
 */
export function injectVFXStyles() {
  if (document.getElementById('fighter-vfx-styles')) return;

  const style = document.createElement('style');
  style.id = 'fighter-vfx-styles';
  style.textContent = `
    /* ==================== Floating Text ==================== */
    .floating-text {
      position: absolute;
      font-size: 1.5rem;
      font-weight: bold;
      pointer-events: none;
      z-index: 50;
      animation: floatUp 1s ease-out forwards;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .floating-text--damage {
      color: #ef4444;
    }

    .floating-text--heal {
      color: #22c55e;
    }

    .floating-text--shield {
      color: #3b82f6;
    }

    @keyframes floatUp {
      0% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      50% {
        opacity: 1;
        transform: translateY(-20px) scale(1.2);
      }
      100% {
        opacity: 0;
        transform: translateY(-40px) scale(0.8);
      }
    }

    /* ==================== Skill VFX Container ==================== */
    .skill-vfx {
      position: absolute;
      pointer-events: none;
      z-index: 40;
      transform: translate(-50%, -50%);
    }

    /* ==================== Fireball Effect ==================== */
    .skill-vfx--fireball {
      animation: fireballPulse 0.3s ease-out;
    }

    @keyframes fireballPulse {
      0% {
        transform: translate(-50%, -50%) scale(0.5);
        opacity: 1;
      }
      100% {
        transform: translate(-50%, -50%) scale(2);
        opacity: 0;
      }
    }

    .skill-particle--fire {
      position: absolute;
      width: 12px;
      height: 12px;
      background: radial-gradient(circle, #fbbf24 0%, #ef4444 50%, transparent 100%);
      border-radius: 50%;
      animation: fireParticle 0.5s ease-out forwards;
      transform: rotate(var(--angle)) translateX(0);
    }

    @keyframes fireParticle {
      0% {
        opacity: 1;
        transform: rotate(var(--angle)) translateX(0);
      }
      100% {
        opacity: 0;
        transform: rotate(var(--angle)) translateX(var(--distance));
      }
    }

    /* ==================== Heal Effect ==================== */
    .skill-vfx--heal {
      animation: healPulse 0.4s ease-out;
    }

    @keyframes healPulse {
      0% {
        transform: translate(-50%, -50%) scale(0.8);
        opacity: 0;
      }
      30% {
        opacity: 1;
      }
      100% {
        transform: translate(-50%, -50%) scale(1.5);
        opacity: 0;
      }
    }

    .skill-particle--heal {
      position: absolute;
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      animation: healSparkle 0.6s ease-out forwards;
      animation-delay: var(--delay);
      transform: rotate(var(--angle)) translateX(0);
      box-shadow: 0 0 6px #22c55e;
    }

    @keyframes healSparkle {
      0% {
        opacity: 1;
        transform: rotate(var(--angle)) translateX(0);
      }
      100% {
        opacity: 0;
        transform: rotate(var(--angle)) translateX(30px) translateY(-20px);
      }
    }

    /* ==================== Shield Effect ==================== */
    .skill-vfx--shield {
      animation: shieldPulse 0.6s ease-out;
    }

    @keyframes shieldPulse {
      0% {
        transform: translate(-50%, -50%) scale(0.8);
        opacity: 0;
      }
      30% {
        opacity: 1;
      }
      100% {
        transform: translate(-50%, -50%) scale(1.3);
        opacity: 0;
      }
    }

    .skill-particle--shield {
      position: absolute;
      width: 60px;
      height: 60px;
      border: 4px solid #3b82f6;
      border-radius: 50%;
      background: rgba(59, 130, 246, 0.2);
      transform: translate(-50%, -50%);
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.5), inset 0 0 20px rgba(59, 130, 246, 0.3);
    }

    /* ==================== Flash Effects ==================== */
    .flash-damage {
      animation: flashDamage 0.3s ease-out;
    }

    @keyframes flashDamage {
      0%, 100% {
        filter: brightness(1);
      }
      50% {
        filter: brightness(2) saturate(0.5) hue-rotate(-20deg);
      }
    }

    .glow-heal {
      animation: glowHeal 0.5s ease-out;
    }

    @keyframes glowHeal {
      0%, 100% {
        filter: brightness(1) drop-shadow(0 0 0 transparent);
      }
      50% {
        filter: brightness(1.3) drop-shadow(0 0 15px #22c55e);
      }
    }
  `;

  document.head.appendChild(style);
}

// Auto-inject styles when module loads in browser
if (typeof document !== 'undefined') {
  injectVFXStyles();
}
