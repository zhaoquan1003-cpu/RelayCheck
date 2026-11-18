<template>
  <svg
    class="pelican-bike"
    viewBox="0 0 720 170"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
    data-testid="pelican-bike"
  >
    <g class="pb-shadow">
      <ellipse cx="392" cy="150" rx="146" ry="5.5" />
    </g>

    <g class="pb-road">
      <line x1="32" y1="150" x2="688" y2="150" />
    </g>

    <g class="pb-speed">
      <line x1="198" y1="92" x2="240" y2="92" />
      <line x1="176" y1="110" x2="236" y2="110" />
      <line x1="208" y1="128" x2="246" y2="128" />
    </g>

    <g class="pb-wheel pb-wheel-rear">
      <circle class="pb-tyre" cx="282" cy="120" r="30" />
      <circle class="pb-rim" cx="282" cy="120" r="23" />
      <g class="pb-spokes">
        <line x1="256" y1="120" x2="308" y2="120" />
        <line x1="259.5" y1="107" x2="304.5" y2="133" />
        <line x1="269" y1="97.5" x2="295" y2="142.5" />
      </g>
      <circle class="pb-hub" cx="282" cy="120" r="3.5" />
    </g>

    <g class="pb-frame">
      <line x1="282" y1="120" x2="393" y2="118" />
      <line x1="282" y1="120" x2="362" y2="62" />
      <line x1="362" y1="62" x2="393" y2="118" />
      <line x1="362" y1="62" x2="492" y2="58" />
      <line x1="393" y1="118" x2="499" y2="70" />
      <line x1="492" y1="56" x2="500" y2="72" />
      <line x1="500" y1="72" x2="502" y2="120" />
      <circle class="pb-ring" cx="393" cy="118" r="10" />
      <line class="pb-crank" x1="393" y1="118" x2="404" y2="132" />
      <line class="pb-pedal" x1="398" y1="132" x2="410" y2="132" />
      <line class="pb-crank" x1="393" y1="118" x2="380" y2="104" />
      <line class="pb-pedal" x1="374" y1="104" x2="386" y2="104" />
      <line class="pb-saddle" x1="330" y1="50" x2="378" y2="50" />
      <line class="pb-seatpost" x1="354" y1="50" x2="362" y2="62" />
      <path class="pb-soft" d="M492 56 L489 46" />
      <path class="pb-soft" d="M478 48 C490 42 506 42 518 48" />
    </g>

    <g class="pb-chain">
      <path d="M393 108 L282 117" />
      <path d="M393 128 L282 123" />
    </g>

    <g class="pb-wheel pb-wheel-front">
      <circle class="pb-tyre" cx="502" cy="120" r="30" />
      <circle class="pb-rim" cx="502" cy="120" r="23" />
      <g class="pb-spokes">
        <line x1="476" y1="120" x2="528" y2="120" />
        <line x1="479.5" y1="107" x2="524.5" y2="133" />
        <line x1="489" y1="97.5" x2="515" y2="142.5" />
      </g>
      <circle class="pb-hub" cx="502" cy="120" r="3.5" />
    </g>

    <g class="pb-rider">
      <path
        class="pb-body"
        d="M362 72 C366 52 390 44 410 48 C428 52 438 66 436 80 C434 92 420 100 404 98 C386 96 368 90 362 72 Z"
      />
      <g class="pb-tail">
        <path d="M362 72 L340 62" />
        <path d="M360 80 L338 74" />
        <path d="M364 88 L342 86" />
      </g>
      <path class="pb-wing" d="M388 62 C402 58 418 62 426 70 C414 76 398 78 388 72 Z" />
      <path class="pb-wing-detail" d="M394 68 C402 70 410 70 418 68" />
      <path class="pb-flipper" d="M430 74 C444 66 462 58 480 53" />
      <path class="pb-neck" d="M424 68 C438 60 442 48 453 43" />
      <circle class="pb-head" cx="456" cy="38" r="11" />
      <path class="pb-crest" d="M449 30 C446 25 442 24 439 24" />
      <circle class="pb-eye" cx="461" cy="34" r="2" />
      <path class="pb-beak" d="M466 36 L540 42" />
      <path class="pb-pouch" d="M466 41 C484 64 512 60 540 42" />
      <path class="pb-pouch-line" d="M480 45 C494 56 510 54 524 46" />
      <g class="pb-legs">
        <path d="M400 96 L406 112 L404 130" />
        <path d="M388 94 L382 100 L378 104" />
      </g>
    </g>
  </svg>
</template>