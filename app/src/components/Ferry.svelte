<script lang="ts">
  // A little ferry bobbing on the waves, for empty corners of dialogs.
  // It sits still when the system asks for reduced motion.
</script>

<svg class="ferry" width="96" height="30" viewBox="0 0 96 30" aria-hidden="true">
  <g class="boat">
    <path d="M30 13 H44 V18 H30 Z" fill="none" stroke="currentColor" stroke-width="1.4" />
    <path d="M24 18 H52 L48 24 H28 Z" fill="currentColor" />
    <path d="M34 13 V9 M33 9 H38" fill="none" stroke="currentColor" stroke-width="1.2" />
  </g>
  <g class="waves">
    <path d="M-24 26 Q-18 22 -12 26 T0 26 T12 26 T24 26 T36 26 T48 26 T60 26 T72 26 T84 26 T96 26 T108 26 T120 26" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" />
  </g>
</svg>

<style>
  .ferry {
    display: block;
    flex: none;
    color: var(--muted);
    opacity: 0.85;
  }

  .boat {
    animation: bob 2.8s ease-in-out infinite;
    transform-origin: 38px 22px;
  }

  .waves {
    animation: drift 3.2s linear infinite;
  }

  @keyframes bob {
    0%,
    100% {
      transform: translateY(0) rotate(-2deg);
    }
    50% {
      transform: translateY(-1.5px) rotate(2deg);
    }
  }

  @keyframes drift {
    to {
      transform: translateX(-24px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .boat,
    .waves {
      animation: none;
    }
  }
</style>
