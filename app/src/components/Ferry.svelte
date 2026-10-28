<script lang="ts">
  // A little ferry for empty corners of dialogs: it carries a crate from the
  // left pier (this computer) to the right one (the server) and back, as the
  // app does with files. It waits in the middle when the system asks for
  // reduced motion.
</script>

<svg class="ferry" width="160" height="34" viewBox="0 0 160 34" aria-hidden="true">
  <defs>
    <clipPath id="ferry-water"><rect x="0" y="0" width="160" height="34" /></clipPath>
  </defs>

  <!-- Piers: a deck on two posts at each bank. -->
  <g class="pier" fill="currentColor">
    <rect x="0" y="23" width="15" height="2" rx="0.5" />
    <rect x="3" y="25" width="1.6" height="7" />
    <rect x="10" y="25" width="1.6" height="7" />
    <rect x="145" y="23" width="15" height="2" rx="0.5" />
    <rect x="148.4" y="25" width="1.6" height="7" />
    <rect x="155.4" y="25" width="1.6" height="7" />
  </g>

  <g transform="translate(32 25)">
    <g class="cross">
      <g class="turn">
        <g class="bob">
          <!-- Smoke from the funnel, drifting up. -->
          <circle class="puff p1" cx="0" cy="-13" r="1.6" fill="currentColor" />
          <circle class="puff p2" cx="0" cy="-13" r="1.2" fill="currentColor" />
          <!-- Funnel, cabin with windows, flag at the stern. -->
          <rect x="-1.5" y="-12" width="3" height="5" fill="currentColor" />
          <rect x="-9" y="-7" width="13" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
          <rect x="-6.5" y="-5" width="2.4" height="2.2" fill="currentColor" />
          <rect x="-2.5" y="-5" width="2.4" height="2.2" fill="currentColor" />
          <path d="M-14 0 V-9 M-14 -9 L-10 -7.5 L-14 -6" fill="none" stroke="var(--accent)" stroke-width="1.1" stroke-linejoin="round" />
          <!-- The crate on deck. -->
          <rect x="6" y="-5" width="6" height="5" fill="none" stroke="currentColor" stroke-width="1.2" />
          <path d="M6 -5 L12 0" stroke="currentColor" stroke-width="0.9" />
          <!-- Hull. -->
          <path d="M-16 0 H16 L12 5 H-12 Z" fill="currentColor" />
        </g>
      </g>
    </g>
  </g>

  <g clip-path="url(#ferry-water)">
    <path
      class="wave back"
      d="M-24 29 Q-18 26 -12 29 T0 29 T12 29 T24 29 T36 29 T48 29 T60 29 T72 29 T84 29 T96 29 T108 29 T120 29 T132 29 T144 29 T156 29 T168 29 T180 29 T192 29"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
    />
    <path
      class="wave front"
      d="M-24 31 Q-18 28 -12 31 T0 31 T12 31 T24 31 T36 31 T48 31 T60 31 T72 31 T84 31 T96 31 T108 31 T120 31 T132 31 T144 31 T156 31 T168 31 T180 31 T192 31"
      fill="none"
      stroke="var(--accent)"
      stroke-width="1.5"
      stroke-linecap="round"
    />
  </g>
</svg>

<style>
  .ferry {
    display: block;
    flex: none;
    color: var(--muted);
  }

  .pier {
    opacity: 0.7;
  }

  .cross,
  .turn,
  .bob {
    transform-origin: 0 0;
  }

  /* Wait at the left pier, cross, wait at the right pier, come back. */
  .cross {
    animation: cross 12s ease-in-out infinite;
  }

  /* The bow turns while the ferry waits at a pier. */
  .turn {
    animation: turn 12s linear infinite;
  }

  .bob {
    animation: bob 2.6s ease-in-out infinite;
  }

  .puff {
    transform-box: fill-box;
    transform-origin: center;
    opacity: 0;
    animation: puff 2.4s ease-out infinite;
  }

  .p2 {
    animation-delay: 1.2s;
  }

  .wave.back {
    opacity: 0.45;
    animation: drift 4.6s linear infinite reverse;
  }

  .wave.front {
    animation: drift 3.2s linear infinite;
  }

  @keyframes cross {
    0%,
    10% {
      transform: translateX(0);
    }
    42%,
    58% {
      transform: translateX(96px);
    }
    90%,
    100% {
      transform: translateX(0);
    }
  }

  @keyframes turn {
    0%,
    48% {
      transform: scaleX(1);
    }
    52%,
    96% {
      transform: scaleX(-1);
    }
    100% {
      transform: scaleX(1);
    }
  }

  @keyframes bob {
    0%,
    100% {
      transform: translateY(0) rotate(-1.5deg);
    }
    50% {
      transform: translateY(-1px) rotate(1.5deg);
    }
  }

  @keyframes puff {
    0% {
      opacity: 0.6;
      transform: translate(0, 0) scale(0.6);
    }
    100% {
      opacity: 0;
      transform: translate(-5px, -7px) scale(1.6);
    }
  }

  @keyframes drift {
    to {
      transform: translateX(-24px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cross,
    .turn,
    .bob,
    .puff,
    .wave {
      animation: none;
    }

    .cross {
      transform: translateX(48px);
    }
  }
</style>
