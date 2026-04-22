const PROD_URL = process.env.LANDING_URL ?? 'https://tack.taiko.xyz';

export function landingPageHtml(): string {
  const o = PROD_URL;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tack — Storage for agents.</title>
  <meta name="description" content="IPFS pinning your autonomous agent calls directly. Pay-per-pin in USDC, no accounts, no API keys. Live on Taiko and Tempo." />
  <meta name="theme-color" content="#05070d" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="Tack — Storage for agents." />
  <meta property="og:description" content="A place for your agent to keep things. IPFS pinning it calls directly — pay-per-pin, no API keys." />
  <meta property="og:url" content="${o}" />
  <meta property="og:site_name" content="Tack" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Tack — Storage for agents." />
  <meta name="twitter:description" content="A place for your agent to keep things. IPFS pinning it calls directly — pay-per-pin, no API keys." />

  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzBhMGQxNyIvPjxwYXRoIGQ9Ik0yMSA1IEgxNyBMMTEgMjcgSDE1IFoiIGZpbGw9IiNlODE4OTkiLz48L3N2Zz4K" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,400..700,30..100;1,9..144,400..700,30..100&family=IBM+Plex+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />

  <style>
    :root {
      /* Ink */
      --ink-950: #04060c;
      --ink-900: #0a0d17;
      --ink-850: #0e1220;
      --ink-800: #131827;
      --ink-700: #1d2333;
      --ink-600: #2d3449;
      --ink-500: #444c64;
      --ink-400: #656e88;
      --ink-300: #8d95ad;
      --ink-200: #b4bccd;
      --ink-100: #dce0eb;
      --ink-50:  #f1f3f9;

      /* One accent */
      --pink-100: #ffd9ee;
      --pink-200: #ffa1d6;
      --pink-300: #e81899;
      --pink-400: #b00d74;

      /* Tiny, reserved */
      --tempo-300: #8b5cf6;
      --signal:    #6ae3a1;
      --paper:     #ede7d8;

      /* Type */
      --f-display: 'Fraunces', ui-serif, 'Iowan Old Style', 'Apple Garamond', Georgia, serif;
      --f-body:    'IBM Plex Sans', ui-sans-serif, -apple-system, system-ui, sans-serif;
      --f-mono:    'JetBrains Mono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;

      --container: 1160px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
    ::selection { background: var(--pink-300); color: white; }

    html, body { background: var(--ink-950); }

    body {
      font-family: var(--f-body);
      color: var(--ink-100);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      line-height: 1.55;
      overflow-x: hidden;
    }

    /* Faintest graph paper. No gradients, no colored glows. */
    body::before {
      content: '';
      position: fixed; inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.014) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.014) 1px, transparent 1px);
      background-size: 64px 64px;
      background-position: -1px -1px;
      -webkit-mask-image: radial-gradient(ellipse at 50% 20%, #000 10%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0) 100%);
              mask-image: radial-gradient(ellipse at 50% 20%, #000 10%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0) 100%);
      pointer-events: none;
      z-index: 0;
    }

    main, nav, footer { position: relative; z-index: 1; }

    code, .mono, .num {
      font-family: var(--f-mono);
      font-feature-settings: 'zero' 1;
    }
    .num { font-variant-numeric: tabular-nums; }

    a { color: inherit; text-decoration: none; }
    button { font-family: inherit; }
    :focus-visible { outline: 2px solid var(--pink-200); outline-offset: 3px; border-radius: 4px; }

    .container { max-width: var(--container); margin: 0 auto; padding: 0 28px; }

    /* ── Nav ── */
    nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 50;
      background: rgba(4, 6, 12, 0.75);
      backdrop-filter: blur(16px) saturate(130%);
      -webkit-backdrop-filter: blur(16px) saturate(130%);
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .nav-inner {
      display: flex; align-items: center; justify-content: space-between;
      height: 62px;
    }
    .logo {
      display: inline-flex; align-items: baseline; gap: 2px;
      font-family: var(--f-mono);
      font-weight: 500; font-size: 15px;
      color: var(--ink-50);
    }
    .logo .slash { color: var(--pink-300); }

    .nav-links {
      display: flex; align-items: center; gap: 28px;
      font-family: var(--f-mono);
      font-size: 12.5px;
    }
    .nav-links a {
      color: var(--ink-300);
      transition: color 0.15s;
      letter-spacing: 0.02em;
    }
    .nav-links a:hover { color: var(--ink-50); }
    .nav-cta {
      color: var(--ink-950) !important;
      padding: 7px 13px; border-radius: 7px;
      background: var(--pink-300);
      transition: background 0.15s;
      font-weight: 500;
    }
    .nav-cta:hover { background: var(--pink-200); }

    @media (max-width: 860px) {
      .nav-links a:not(.nav-cta) { display: none; }
    }

    /* ── Hero ── */
    .hero {
      position: relative;
      padding: 160px 0 92px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 56px;
      align-items: end;
    }
    @media (min-width: 960px) {
      .hero-grid { grid-template-columns: minmax(0, 1fr) minmax(200px, 280px); gap: 80px; }
    }

    .eyebrow {
      font-family: var(--f-mono);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--ink-400);
      display: inline-flex; align-items: center; gap: 12px;
      margin-bottom: 40px;
    }
    .eyebrow .live {
      display: inline-flex; align-items: center; gap: 8px;
      color: var(--signal);
    }
    .eyebrow .live-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--signal);
      box-shadow: 0 0 0 3px rgba(106, 227, 161, 0.14);
      animation: pulse 2.4s ease-in-out infinite;
    }
    .eyebrow .sep { color: var(--ink-600); }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.5; transform: scale(0.88); }
    }

    h1.display {
      font-family: var(--f-display);
      font-weight: 400;
      font-variation-settings: 'opsz' 144, 'SOFT' 30;
      font-size: clamp(3.2rem, 10vw, 8rem);
      line-height: 0.94;
      letter-spacing: -0.035em;
      color: var(--ink-50);
      margin-bottom: 36px;
      max-width: 13ch;
    }
    h1.display em {
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 100, 'wght' 500;
      color: var(--pink-300);
    }
    h1.display .dot { color: var(--pink-300); font-style: normal; }

    .hero-body {
      font-size: clamp(1.05rem, 1.6vw, 1.2rem);
      color: var(--ink-300);
      max-width: 520px;
      margin-bottom: 38px;
    }

    .hero-cta { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }

    .btn-endpoint {
      padding: 0;
      border-radius: 10px;
      background: var(--ink-50);
      color: var(--ink-950);
      border: 1px solid var(--ink-50);
      cursor: pointer;
      transition: transform 0.08s, background 0.15s;
      display: inline-flex; align-items: stretch;
      overflow: hidden;
      font-family: var(--f-mono);
      font-size: 13px;
    }
    .btn-endpoint:hover { background: var(--pink-100); border-color: var(--pink-100); }
    .btn-endpoint:active { transform: translateY(1px); }
    .btn-endpoint .btn-verb {
      padding: 13px 10px 13px 14px;
      color: var(--pink-400);
      font-weight: 500;
      border-right: 1px solid rgba(5, 7, 13, 0.1);
    }
    .btn-endpoint .btn-url { padding: 13px 14px; font-weight: 500; font-size: 13.5px; }
    .btn-endpoint .btn-icon {
      padding: 13px 14px 13px 10px;
      display: inline-flex; align-items: center;
      color: var(--ink-500);
      border-left: 1px solid rgba(5, 7, 13, 0.1);
    }
    .btn-endpoint .btn-icon svg { width: 14px; height: 14px; }
    .btn-endpoint.copied { background: var(--signal); border-color: var(--signal); }
    .btn-endpoint.copied .btn-verb { color: var(--ink-950); border-right-color: rgba(5, 7, 13, 0.25); }
    .btn-endpoint.copied .btn-icon { color: var(--ink-950); border-left-color: rgba(5, 7, 13, 0.25); }

    .btn-ghost {
      padding: 13px 18px;
      border-radius: 10px;
      background: transparent;
      color: var(--ink-100);
      border: 1px solid var(--ink-600);
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
      display: inline-flex; align-items: center; gap: 10px;
      font-family: var(--f-mono);
      font-size: 13px;
    }
    .btn-ghost:hover { border-color: var(--pink-300); color: var(--ink-50); }
    .btn-ghost svg { width: 13px; height: 13px; }

    /* Hero side stats */
    .hero-stats {
      display: grid;
      grid-template-columns: 1fr;
      gap: 22px;
    }
    .hero-stat {
      padding-top: 14px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .hero-stat-label {
      font-family: var(--f-mono);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--ink-500);
      margin-bottom: 10px;
    }
    .hero-stat-value {
      font-family: var(--f-display);
      font-weight: 400;
      font-variation-settings: 'opsz' 144, 'SOFT' 40;
      font-size: clamp(1.7rem, 2.6vw, 2.2rem);
      letter-spacing: -0.02em;
      color: var(--ink-50);
      line-height: 1;
    }
    .hero-stat-value .unit {
      font-family: var(--f-mono);
      font-size: 0.52em;
      color: var(--ink-400);
      margin-left: 6px;
      vertical-align: 0.2em;
    }
    @media (max-width: 959px) {
      .hero-stats { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 560px) {
      .hero-stats { grid-template-columns: 1fr; }
    }

    /* ── Sections ── */
    section { padding: 104px 0; scroll-margin-top: 72px; }
    .rule-top { border-top: 1px solid rgba(255,255,255,0.05); }

    /* ── Works-with strip (between hero and §01) ── */
    .works-strip {
      padding: 32px 0;
      border-top: 1px solid rgba(255,255,255,0.06);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .works-inner {
      display: grid;
      grid-template-columns: 1fr;
      gap: 18px;
      align-items: center;
    }
    @media (min-width: 820px) {
      .works-inner { grid-template-columns: minmax(200px, 260px) 1fr; gap: 32px; }
    }
    .works-label {
      font-family: var(--f-mono);
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--ink-400);
      display: inline-flex; align-items: center; gap: 10px;
    }
    .works-label .mark { color: var(--pink-300); }
    .works-chips { display: flex; flex-wrap: wrap; gap: 10px; }
    .wchip {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.02);
      font-family: var(--f-body);
      font-size: 13.5px;
      color: var(--ink-100);
      font-weight: 500;
      transition: border-color 0.15s, color 0.15s;
    }
    .wchip:hover { border-color: var(--pink-300); color: var(--ink-50); }
    .wchip .wmark {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--pink-300);
      flex-shrink: 0;
    }
    .wchip.wchip-dim {
      color: var(--ink-400);
      border-style: dashed;
      font-family: var(--f-mono);
      font-size: 12.5px;
    }
    .wchip.wchip-dim .wmark { background: var(--ink-500); }
    .wchip .wlogo {
      width: 18px; height: 18px;
      flex-shrink: 0;
      display: inline-block;
      object-fit: contain;
      border-radius: 3px;
    }
    .wchip .wlogo-openai { filter: invert(1); }
    .wchip .wlogo-hermes { background: #f5f5f0; padding: 1px; }

    /* ── Rails strip (after integrate) ── */
    .rails-section {
      padding: 80px 0;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    .rails-head { margin-bottom: 32px; display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; justify-content: space-between; }
    .rails-title {
      font-family: var(--f-display);
      font-weight: 400;
      font-variation-settings: 'opsz' 96, 'SOFT' 50;
      font-size: clamp(1.5rem, 2.6vw, 2rem);
      letter-spacing: -0.02em;
      color: var(--ink-50);
    }
    .rails-title em {
      font-style: italic;
      font-variation-settings: 'opsz' 96, 'SOFT' 100, 'wght' 500;
      color: var(--pink-300);
    }
    .rails-sub {
      font-family: var(--f-mono);
      font-size: 12px;
      letter-spacing: 0.04em;
      color: var(--ink-400);
    }
    .rails-pair {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 860px) { .rails-pair { grid-template-columns: 1fr 1fr; gap: 20px; } }
    .rail-card {
      position: relative;
      padding: 32px 32px 28px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background: var(--ink-900);
      overflow: hidden;
      transition: border-color 0.2s, transform 0.2s;
    }
    .rail-card::before {
      content: ''; position: absolute; inset: 0 0 auto 0; height: 2px;
      background: var(--_c);
    }
    .rail-card.c-taiko { --_c: var(--pink-300); }
    .rail-card.c-tempo { --_c: var(--tempo-300); }
    .rail-card:hover { border-color: var(--_c); transform: translateY(-2px); }
    .rail-card-head {
      display: flex; align-items: baseline; justify-content: space-between;
      margin-bottom: 14px;
    }
    .rail-proto {
      font-family: var(--f-display);
      font-weight: 500;
      font-variation-settings: 'opsz' 96, 'SOFT' 40;
      font-size: 2rem;
      letter-spacing: -0.025em;
      line-height: 1;
      color: var(--ink-50);
    }
    .rail-chain {
      font-family: var(--f-mono);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      padding: 4px 10px;
      border-radius: 5px;
      color: var(--_c);
      background: color-mix(in oklab, var(--_c) 14%, transparent);
    }
    .rail-blurb {
      font-size: 14px;
      color: var(--ink-300);
      line-height: 1.55;
      margin-bottom: 20px;
      max-width: 36ch;
    }
    .rail-blurb em { font-style: italic; color: var(--ink-100); font-variation-settings: 'wght' 500; }
    .rail-spec {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
      border-top: 1px dashed rgba(255,255,255,0.08);
    }
    .rail-spec-row {
      display: grid;
      grid-template-columns: 100px 1fr;
      gap: 14px;
      padding: 10px 0;
      border-bottom: 1px dashed rgba(255,255,255,0.06);
      align-items: baseline;
    }
    .rail-spec-row:last-child { border-bottom: 0; }
    .rail-spec-k {
      font-family: var(--f-mono);
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ink-500);
    }
    .rail-spec-v {
      font-family: var(--f-mono);
      font-size: 13px;
      color: var(--ink-100);
      font-variant-numeric: tabular-nums;
      word-break: break-all;
    }
    .rail-spec-v .accent { color: var(--_c); }

    .section-label {
      font-family: var(--f-mono);
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--ink-400);
      margin-bottom: 28px;
      display: flex; align-items: center; gap: 10px;
    }
    .section-label .ord { color: var(--pink-300); }
    .section-label .sep { color: var(--ink-600); }

    h2.section-title {
      font-family: var(--f-display);
      font-weight: 400;
      font-variation-settings: 'opsz' 144, 'SOFT' 40;
      font-size: clamp(2.2rem, 5.2vw, 4rem);
      line-height: 1.0;
      letter-spacing: -0.03em;
      color: var(--ink-50);
      max-width: 18ch;
      margin-bottom: 16px;
    }
    h2.section-title em {
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 100, 'wght' 500;
      color: var(--pink-300);
    }
    h2.section-title .dot { color: var(--pink-300); font-style: normal; }

    .section-sub {
      font-size: 1.0625rem;
      color: var(--ink-300);
      max-width: 560px;
      line-height: 1.55;
    }
    .section-head { margin-bottom: 56px; }

    /* ── Compare table ── */
    .compare-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 15px;
    }
    .compare-table th, .compare-table td {
      padding: 22px 20px;
      text-align: left;
      vertical-align: top;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .compare-table thead th {
      border-top: 1px solid rgba(255,255,255,0.15);
      border-bottom: 1px solid rgba(255,255,255,0.15);
      padding-top: 16px; padding-bottom: 16px;
      font-family: var(--f-mono);
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 500;
    }
    .compare-table th.c-key { width: 24%; color: var(--ink-500); }
    .compare-table th.c-legacy { width: 38%; color: var(--ink-400); }
    .compare-table th.c-tack {
      width: 38%;
      color: var(--pink-300);
      position: relative;
    }
    .compare-table td.c-key {
      font-family: var(--f-mono);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--ink-400);
    }
    .compare-table td.c-legacy { color: var(--ink-300); }
    .compare-table td.c-legacy .strike { text-decoration: line-through; text-decoration-color: rgba(255,255,255,0.2); }
    .compare-table td.c-tack {
      color: var(--ink-50);
      background: linear-gradient(180deg, rgba(232, 24, 153, 0.04) 0%, transparent 100%);
      font-weight: 500;
    }
    .compare-table tbody tr:last-child td { border-bottom: 1px solid rgba(255,255,255,0.08); }
    .compare-foot {
      margin-top: 18px;
      font-family: var(--f-mono);
      font-size: 12px;
      color: var(--ink-500);
      letter-spacing: 0.01em;
    }
    @media (max-width: 700px) {
      .compare-table { font-size: 13.5px; }
      .compare-table th, .compare-table td { padding: 14px 10px; }
    }

    /* ── Use cases list ── */
    .cases-list {
      list-style: none;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .cases-list li {
      display: grid;
      grid-template-columns: 48px minmax(220px, 1fr) 2fr;
      gap: 24px;
      padding: 22px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      transition: background 0.2s;
      align-items: baseline;
    }
    @media (max-width: 720px) {
      .cases-list li { grid-template-columns: 40px 1fr; }
      .cases-list li .desc { grid-column: 2; }
    }
    .cases-list li:hover { background: rgba(255,255,255,0.015); }
    .cases-list .ord {
      font-family: var(--f-mono);
      font-size: 13px;
      color: var(--ink-500);
      letter-spacing: 0.04em;
    }
    .cases-list .name {
      font-family: var(--f-display);
      font-weight: 500;
      font-variation-settings: 'opsz' 96, 'SOFT' 40;
      font-size: 1.45rem;
      letter-spacing: -0.018em;
      color: var(--ink-50);
    }
    .cases-list .desc {
      font-size: 14.5px;
      color: var(--ink-300);
      line-height: 1.5;
    }

    /* ── Flow ── */
    .flow-list {
      list-style: none;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .flow-list li {
      display: grid;
      grid-template-columns: 88px 1fr;
      gap: 28px;
      padding: 32px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      align-items: baseline;
    }
    @media (max-width: 720px) {
      .flow-list li { grid-template-columns: 52px 1fr; gap: 16px; padding: 24px 0; }
    }
    .flow-list .ord {
      font-family: var(--f-mono);
      font-size: 13px;
      color: var(--pink-300);
      letter-spacing: 0.04em;
    }
    .flow-list .step {
      font-family: var(--f-display);
      font-weight: 400;
      font-variation-settings: 'opsz' 96, 'SOFT' 50;
      font-size: clamp(1.4rem, 2.8vw, 2rem);
      letter-spacing: -0.02em;
      color: var(--ink-50);
      line-height: 1.15;
    }
    .flow-list .step em {
      font-style: italic;
      font-variation-settings: 'opsz' 96, 'SOFT' 100, 'wght' 500;
      color: var(--pink-300);
    }
    .flow-list .step code {
      font-size: 0.75em;
      color: var(--ink-200);
      padding: 1px 8px; border-radius: 6px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      font-weight: 500;
      vertical-align: 0.08em;
    }

    /* ── Pricing ── */
    .price-wrap {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      overflow: hidden;
      background: var(--ink-900);
    }
    @media (min-width: 900px) {
      .price-wrap { grid-template-columns: 1.1fr 0.9fr; }
    }

    .price-left { padding: 44px 44px 36px; }
    .price-right {
      padding: 44px;
      background: var(--ink-850);
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    @media (min-width: 900px) {
      .price-right { border-top: 0; border-left: 1px solid rgba(255,255,255,0.08); }
    }
    @media (max-width: 560px) {
      .price-left, .price-right { padding: 28px; }
    }

    .price-eyebrow {
      font-family: var(--f-mono);
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--ink-400);
      margin-bottom: 20px;
    }

    .price-live {
      font-family: var(--f-display);
      font-weight: 400;
      font-variation-settings: 'opsz' 144, 'SOFT' 30;
      font-size: clamp(4.5rem, 10vw, 7.5rem);
      line-height: 0.9;
      letter-spacing: -0.04em;
      color: var(--ink-50);
      margin-bottom: 20px;
      display: inline-block;
      font-variant-numeric: tabular-nums;
    }
    .price-live .currency {
      color: var(--pink-300);
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 100, 'wght' 500;
      margin-right: 4px;
    }
    .price-sub {
      font-family: var(--f-mono);
      font-size: 13px;
      color: var(--ink-400);
      margin-bottom: 36px;
      letter-spacing: 0.02em;
    }
    .price-sub .price-sub-val { color: var(--ink-100); }

    .slider-group { margin-bottom: 24px; }
    .slider-row {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: 10px;
    }
    .slider-label {
      font-family: var(--f-mono);
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--ink-400);
    }
    .slider-val {
      font-family: var(--f-mono);
      font-size: 15px;
      color: var(--ink-50);
      font-variant-numeric: tabular-nums;
    }
    .slider-val .unit { color: var(--ink-400); font-size: 0.85em; margin-left: 2px; }

    input[type="range"].tick-slider {
      -webkit-appearance: none; appearance: none;
      width: 100%;
      height: 36px;
      background: transparent;
      cursor: pointer;
      display: block;
    }
    input[type="range"].tick-slider:focus { outline: none; }
    input[type="range"].tick-slider::-webkit-slider-runnable-track {
      height: 2px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
    }
    input[type="range"].tick-slider::-moz-range-track {
      height: 2px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
    }
    input[type="range"].tick-slider::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--pink-300);
      border: 3px solid var(--ink-950);
      box-shadow: 0 0 0 1px var(--pink-300);
      margin-top: -8px;
      transition: transform 0.1s;
    }
    input[type="range"].tick-slider::-moz-range-thumb {
      width: 14px; height: 14px; border-radius: 50%;
      background: var(--pink-300);
      border: 3px solid var(--ink-950);
      box-shadow: 0 0 0 1px var(--pink-300);
      transition: transform 0.1s;
    }
    input[type="range"].tick-slider:hover::-webkit-slider-thumb { transform: scale(1.15); }
    input[type="range"].tick-slider:hover::-moz-range-thumb { transform: scale(1.15); }
    input[type="range"].tick-slider:active::-webkit-slider-thumb { transform: scale(1.25); }

    .price-compare {
      margin-top: 24px;
      padding-top: 22px;
      border-top: 1px dashed rgba(255,255,255,0.08);
    }
    .price-compare-label {
      font-family: var(--f-mono);
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--ink-500);
      margin-bottom: 14px;
    }

    .price-kicker {
      padding: 18px 22px 20px;
      border-radius: 12px 12px 0 0;
      border: 1px solid rgba(232, 24, 153, 0.25);
      border-bottom: 0;
      background: linear-gradient(180deg, rgba(232, 24, 153, 0.08), rgba(232, 24, 153, 0.02) 80%);
      margin-bottom: 0;
    }
    .price-kicker p {
      font-size: 14px;
      color: var(--ink-200);
      line-height: 1.55;
      margin: 0;
    }
    .price-kicker strong { color: var(--ink-50); font-weight: 500; }
    .price-kicker strong.pink { color: var(--pink-200); }
    .kicker-headline {
      font-family: var(--f-display);
      font-size: clamp(22px, 3vw, 28px);
      line-height: 1.15;
      letter-spacing: -0.01em;
      color: var(--ink-50);
      margin: 2px 0 8px;
    }
    .kicker-headline strong { color: var(--ink-50); font-weight: 500; }
    .kicker-big {
      font-family: var(--f-display);
      font-size: clamp(36px, 5.5vw, 52px);
      line-height: 1;
      letter-spacing: -0.02em;
      color: var(--pink-300);
      font-weight: 500;
      margin: 10px 0 6px;
    }
    .kicker-big sup {
      font-size: 0.35em;
      color: var(--pink-300);
      font-weight: 400;
      vertical-align: super;
      margin-left: 2px;
    }
    .kicker-big .big-sub {
      font-family: var(--f-body);
      font-size: 13.5px;
      font-weight: 400;
      color: var(--ink-300);
      letter-spacing: 0;
      display: block;
      margin-top: 4px;
    }

    .price-compare-table tr.highlight td {
      background: rgba(232, 24, 153, 0.04);
    }
    .price-compare-table tr.highlight td.c-tack { background: rgba(232, 24, 153, 0.10); }
    .price-compare-table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--f-mono);
      font-size: 12.5px;
      border: 1px solid rgba(232, 24, 153, 0.18);
      border-top: 0;
      border-radius: 0 0 12px 12px;
      background: rgba(0,0,0,0.15);
      overflow: hidden;
    }
    .price-compare-table tr.price-row td { padding: 16px 12px 16px 0; }
    .price-compare-table tr.price-row td:first-child {
      color: var(--ink-200);
      font-weight: 400;
    }
    .price-compare-table tr.price-row td.c-legacy,
    .price-compare-table tr.price-row td.c-tack {
      font-family: var(--f-display);
      font-size: clamp(22px, 2.6vw, 28px);
      letter-spacing: -0.01em;
      line-height: 1.1;
    }
    .price-compare-table tr.price-row td.c-legacy { color: var(--ink-400); }
    .price-compare-table tr.price-row td.c-tack { color: var(--pink-200); font-weight: 500; }
    .price-compare-table tr.price-row td .save-badge {
      display: inline-block;
      margin-left: 10px;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(232, 24, 153, 0.15);
      border: 1px solid rgba(232, 24, 153, 0.35);
      color: var(--pink-200);
      font-family: var(--f-mono);
      font-size: 11px;
      letter-spacing: 0.04em;
      font-weight: 500;
      vertical-align: middle;
    }
    .price-compare-table th {
      text-align: left;
      padding: 8px 10px 10px 0;
      font-weight: 500;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink-500);
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .price-compare-table th.c-legacy { color: var(--ink-400); text-align: right; }
    .price-compare-table th.c-tack { color: var(--pink-300); text-align: right; }
    .price-compare-table td {
      padding: 12px 10px 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      color: var(--ink-200);
      font-variant-numeric: tabular-nums;
    }
    .price-compare-table td.c-legacy {
      color: var(--ink-400);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .price-compare-table td.c-legacy.dash { color: var(--ink-600); }
    .price-compare-table td.c-tack {
      color: var(--ink-50);
      text-align: right;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      background: linear-gradient(180deg, rgba(232, 24, 153, 0.06) 0%, transparent 100%);
      box-shadow: inset 2px 0 0 rgba(232, 24, 153, 0.35);
    }
    .price-compare-table td.c-tack .accent { color: var(--pink-300); }
    .price-compare-table th small {
      display: block;
      font-size: 9px;
      font-weight: 400;
      color: var(--ink-500);
      letter-spacing: 0.08em;
      margin-top: 3px;
      text-transform: none;
    }
    .price-compare-table tbody tr:last-child td { border-bottom: 0; }
    .price-compare-foot {
      margin-top: 14px;
      font-family: var(--f-mono);
      font-size: 11px;
      color: var(--ink-500);
      line-height: 1.5;
      letter-spacing: 0.01em;
    }

    .price-right h3 {
      font-family: var(--f-display);
      font-weight: 500;
      font-variation-settings: 'opsz' 72, 'SOFT' 50;
      font-size: 1.3rem;
      color: var(--ink-50);
      margin-bottom: 18px;
      letter-spacing: -0.01em;
    }
    .price-facts {
      list-style: none;
      display: grid;
      gap: 14px;
      margin-bottom: 24px;
    }
    .price-facts li {
      display: grid;
      grid-template-columns: 14px 1fr;
      gap: 12px;
      align-items: start;
      font-size: 14px;
      color: var(--ink-200);
      line-height: 1.5;
    }
    .price-facts li svg { width: 14px; height: 14px; color: var(--signal); margin-top: 4px; }
    .price-facts li code {
      padding: 1px 7px; border-radius: 4px;
      background: var(--ink-900); border: 1px solid rgba(255,255,255,0.06);
      font-size: 0.85em; color: var(--ink-50);
    }

    details.price-formula {
      border-top: 1px dashed rgba(255,255,255,0.08);
      padding-top: 18px;
    }
    details.price-formula summary {
      font-family: var(--f-mono);
      font-size: 12px;
      letter-spacing: 0.04em;
      color: var(--ink-400);
      cursor: pointer;
      list-style: none;
      display: flex; align-items: center; gap: 8px;
      user-select: none;
      transition: color 0.15s;
    }
    details.price-formula summary:hover { color: var(--ink-100); }
    details.price-formula summary::-webkit-details-marker { display: none; }
    details.price-formula summary::before {
      content: '+';
      display: inline-block;
      color: var(--pink-300);
      width: 10px;
      font-weight: 600;
    }
    details.price-formula[open] summary::before { content: '−'; }
    details.price-formula .formula-body {
      padding-top: 14px;
      font-family: var(--f-mono);
      font-size: 12px;
      color: var(--ink-300);
      line-height: 1.7;
    }
    details.price-formula .formula-body code {
      display: inline-block;
      padding: 2px 8px;
      background: rgba(232, 24, 153, 0.06);
      border: 1px solid rgba(232, 24, 153, 0.2);
      border-radius: 4px;
      color: var(--ink-50);
    }

    /* ── Integrate ── */
    .integrate-wrap { display: grid; grid-template-columns: 1fr; gap: 24px; }
    @media (min-width: 960px) {
      .integrate-wrap { grid-template-columns: 0.9fr 1.1fr; gap: 32px; align-items: start; }
    }

    .endpoint-box {
      padding: 28px;
      border-radius: 16px;
      border: 1px solid rgba(232, 24, 153, 0.25);
      background: var(--ink-900);
    }
    .endpoint-label {
      font-family: var(--f-mono);
      font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--ink-400);
      margin-bottom: 14px;
    }
    .endpoint-url-row {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 12px 12px 16px;
      border-radius: 9px;
      background: var(--ink-950);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .endpoint-url-row .url {
      flex: 1; min-width: 0;
      font-family: var(--f-mono);
      font-size: 14.5px;
      color: var(--ink-50);
      overflow: hidden; text-overflow: ellipsis;
    }
    .endpoint-url-row .url .host { color: var(--pink-200); }
    .copy-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 11px; border-radius: 7px;
      font-family: var(--f-mono);
      font-size: 12px; font-weight: 500;
      background: var(--ink-50); color: var(--ink-950);
      border: 1px solid var(--ink-50);
      cursor: pointer;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    .copy-btn:hover { background: var(--pink-100); border-color: var(--pink-100); }
    .copy-btn.copied { background: var(--signal); border-color: var(--signal); color: var(--ink-950); }
    .copy-btn svg { width: 12px; height: 12px; }
    .endpoint-note {
      font-size: 14px;
      color: var(--ink-300);
      margin-top: 18px;
      line-height: 1.55;
    }
    .endpoint-note strong { color: var(--ink-100); font-weight: 500; }
    .endpoint-check { list-style: none; margin-top: 16px; display: grid; gap: 8px; }
    .endpoint-check li {
      display: flex; align-items: flex-start; gap: 10px;
      font-size: 13px; color: var(--ink-200);
    }
    .endpoint-check li svg { width: 13px; height: 13px; margin-top: 4px; color: var(--signal); flex-shrink: 0; }
    .endpoint-check li code {
      padding: 1px 5px; border-radius: 3px;
      background: var(--ink-850); font-size: 0.9em; color: var(--ink-50);
    }

    .rails-row {
      display: flex; gap: 10px; flex-wrap: wrap;
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px dashed rgba(255,255,255,0.08);
    }
    .rail-chip {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 10px; border-radius: 6px;
      font-family: var(--f-mono);
      font-size: 11.5px;
      color: var(--ink-200);
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.015);
    }
    .rail-chip .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .rail-chip .dot.taiko { background: var(--pink-300); }
    .rail-chip .dot.tempo { background: var(--tempo-300); }

    /* Code block */
    .code-block {
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.08);
      background: var(--ink-900);
      overflow: hidden;
    }
    .code-chrome {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 14px;
      background: var(--ink-850);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .code-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ink-700); }
    .code-tabs { display: flex; margin-left: 8px; gap: 3px; flex: 1; }
    .code-tab {
      padding: 6px 11px;
      border-radius: 6px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--ink-400);
      font-family: var(--f-mono);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex; align-items: center; gap: 7px;
    }
    .code-tab:hover { color: var(--ink-100); }
    .code-tab[aria-selected="true"] {
      background: rgba(255,255,255,0.05);
      border-color: rgba(255,255,255,0.08);
      color: var(--ink-50);
    }
    .code-tab-dot { width: 6px; height: 6px; border-radius: 50%; }
    .code-tab-dot.taiko { background: var(--pink-300); }
    .code-tab-dot.tempo { background: var(--tempo-300); }
    .code-tab-dot.neutral { background: var(--ink-400); }
    .code-pane { display: none; }
    .code-pane[data-active="true"] { display: block; }
    .code-block pre {
      padding: 22px 24px;
      overflow-x: auto;
      font-family: var(--f-mono);
      font-size: 12.5px;
      line-height: 1.72;
      color: var(--ink-200);
    }
    .code-block pre .k { color: #f58cc0; }
    .code-block pre .s { color: var(--signal); }
    .code-block pre .c { color: var(--ink-500); font-style: italic; }
    .code-block pre .f { color: #a7c6ff; }
    .code-block pre .n { color: var(--pink-200); }

    /* ── API grid ── */
    .api-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px;
      overflow: hidden;
    }
    @media (min-width: 720px) { .api-grid { grid-template-columns: 1fr 1fr; } }
    .api-row {
      padding: 22px 24px;
      background: var(--ink-900);
      display: flex; gap: 18px; align-items: flex-start;
      transition: background 0.2s;
    }
    .api-row:hover { background: var(--ink-850); }
    .api-method {
      font-family: var(--f-mono);
      font-size: 10.5px; font-weight: 500;
      letter-spacing: 0.1em;
      padding: 4px 8px;
      border-radius: 5px;
      flex-shrink: 0;
      width: 58px; text-align: center;
    }
    .method-get { background: rgba(106, 227, 161, 0.1); color: var(--signal); }
    .method-post { background: rgba(167, 198, 255, 0.1); color: #a7c6ff; }
    .method-delete { background: rgba(255, 122, 89, 0.1); color: #ff7a59; }
    .api-body { flex: 1; min-width: 0; }
    .api-path {
      font-family: var(--f-mono);
      font-size: 14px;
      color: var(--ink-50);
      margin-bottom: 4px;
      word-break: break-all;
    }
    .api-desc { font-size: 12.5px; color: var(--ink-300); line-height: 1.5; }
    .api-tag {
      display: inline-block;
      margin-top: 8px;
      font-family: var(--f-mono);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 3px;
      background: rgba(255,255,255,0.04);
      color: var(--ink-300);
    }
    .api-tag.pay { color: var(--pink-200); background: rgba(232, 24, 153, 0.08); }
    .api-tag.auth { color: var(--ink-50); background: rgba(255,255,255,0.07); }
    .api-tag.open { color: var(--signal); background: rgba(106, 227, 161, 0.06); }

    /* ── Final CTA ── */
    .final-cta {
      padding: 96px 40px;
      text-align: center;
    }
    @media (max-width: 600px) { .final-cta { padding: 64px 20px; } }
    .final-cta h2 {
      font-family: var(--f-display);
      font-weight: 400;
      font-variation-settings: 'opsz' 144, 'SOFT' 50;
      font-size: clamp(2.6rem, 7vw, 5.5rem);
      line-height: 0.98;
      letter-spacing: -0.035em;
      color: var(--ink-50);
      margin-bottom: 16px;
      max-width: 16ch;
      margin-left: auto; margin-right: auto;
    }
    .final-cta h2 em {
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 100, 'wght' 500;
      color: var(--pink-300);
    }
    .final-cta h2 .dot { color: var(--pink-300); font-style: normal; }
    .final-cta .sub {
      font-size: 1.05rem; color: var(--ink-400);
      max-width: 460px; margin: 0 auto 32px;
    }
    .final-cta .btns {
      display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;
    }

    /* Trust strip */
    .trust {
      display: flex; flex-wrap: wrap; justify-content: center;
      gap: 12px 30px;
      padding-top: 40px;
      margin-top: 52px;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    .trust-item {
      display: inline-flex; align-items: center; gap: 9px;
      font-family: var(--f-mono);
      font-size: 11.5px;
      color: var(--ink-400);
      letter-spacing: 0.04em;
    }
    .trust-item strong { color: var(--ink-100); font-weight: 500; }
    .trust-dot { width: 6px; height: 6px; border-radius: 50%; }
    .trust-dot.taiko { background: var(--pink-300); }
    .trust-dot.tempo { background: var(--tempo-300); }
    .trust-dot.ipfs  { background: #65c2cb; }
    .trust-dot.a2a   { background: var(--signal); }

    /* Footer */
    footer {
      padding: 36px 0 52px;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    .footer-inner {
      display: grid; grid-template-columns: 1fr; gap: 20px;
      align-items: center;
    }
    @media (min-width: 820px) {
      .footer-inner { grid-template-columns: auto 1fr auto; }
    }
    .footer-links {
      display: flex; gap: 22px; flex-wrap: wrap; justify-content: center;
      font-family: var(--f-mono); font-size: 12px;
    }
    .footer-links a { color: var(--ink-400); transition: color 0.15s; }
    .footer-links a:hover { color: var(--ink-50); }
    .footer-tag {
      font-family: var(--f-mono);
      font-size: 11.5px;
      color: var(--ink-500);
      letter-spacing: 0.04em;
      text-align: right;
    }
    @media (max-width: 819px) { .footer-tag { text-align: center; } }
  </style>
</head>
<body>

  <nav aria-label="Primary">
    <div class="container nav-inner">
      <a class="logo" href="#top" aria-label="Tack home">
        <span class="slash">/</span><span>tack</span>
      </a>
      <div class="nav-links">
        <a href="#keep">keep</a>
        <a href="#pricing">pricing</a>
        <a href="#api">api</a>
        <a href="#integrate" class="nav-cta">point your agent →</a>
      </div>
    </div>
  </nav>

  <main>

    <section class="hero" id="top">
      <div class="container">
        <div class="hero-grid">
          <div>
            <div class="eyebrow">
              <span class="live"><span class="live-dot" aria-hidden="true"></span>LIVE</span>
              <span class="sep">·</span>
              <span>Taiko</span>
              <span class="sep">·</span>
              <span>Tempo</span>
            </div>
            <h1 class="display">
              Storage for <em>agents</em><span class="dot">.</span>
            </h1>
            <p class="hero-body">
              Your agent uploads a file and pays a fraction of a cent in USDC. Tack hands back an address any other agent can read. No signup, no API keys, no platform to live inside.
            </p>
            <div class="hero-cta">
              <button class="btn-endpoint" data-copy="${o}" aria-label="Copy API endpoint">
                <span class="btn-verb">POST</span>
                <span class="btn-url">${o}</span>
                <span class="btn-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </span>
              </button>
              <a href="#pricing" class="btn-ghost">
                Try the pricing
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </a>
            </div>
          </div>

          <div class="hero-stats" aria-label="Stats">
            <div class="hero-stat">
              <div class="hero-stat-label">Min&nbsp;per&nbsp;pin</div>
              <div class="hero-stat-value num">$0.001</div>
            </div>
            <div class="hero-stat">
              <div class="hero-stat-label">First&nbsp;pin</div>
              <div class="hero-stat-value num">~30<span class="unit">s</span></div>
            </div>
            <div class="hero-stat">
              <div class="hero-stat-label">Signups</div>
              <div class="hero-stat-value num">0</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="works-strip" aria-label="Works with">
      <div class="container">
        <div class="works-inner">
          <div class="works-label"><span class="mark">→</span> Works with any agent</div>
          <div class="works-chips">
            <span class="wchip"><img class="wlogo wlogo-claude" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCEtLSBHZW5lcmF0ZWQgYnkgUGl4ZWxtYXRvciBQcm8gMy42LjE3IC0tPgo8c3ZnIHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjEyMDAiIHZpZXdCb3g9IjAgMCAxMjAwIDEyMDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgICA8ZyBpZD0iZzMxNCI+CiAgICAgICAgPHBhdGggaWQ9InBhdGgxNDciIGZpbGw9IiNkOTc3NTciIHN0cm9rZT0ibm9uZSIgZD0iTSAyMzMuOTU5NzkzIDgwMC4yMTQ5MDUgTCA0NjguNjQ0Mjg3IDY2OC41MzY5ODcgTCA0NzIuNTkwNjM3IDY1Ny4xMDA2NDcgTCA0NjguNjQ0Mjg3IDY1MC43Mzg0MDMgTCA0NTcuMjA4MDY5IDY1MC43Mzg0MDMgTCA0MTcuOTg2NjMzIDY0OC4zMjIxNDQgTCAyODMuODkyNjM5IDY0NC42OTgxMiBMIDE2Ny41OTczMjEgNjM5Ljg2NTg0NSBMIDU0LjkyNjIwOCA2MzMuODI1NjIzIEwgMjYuNTc3MjM4IDYyNy43ODUzMzkgTCAzLjNlLTA1IDU5Mi43NTE3MDkgTCAyLjczODMyIDU3NS4yNzUzMyBMIDI2LjU3NzIzOCA1NTkuMjQ4MzUyIEwgNjAuNzI0ODczIDU2Mi4yMjgxNDkgTCAxMzYuMTg3OTczIDU2Ny4zODI2MjkgTCAyNDkuNDIyODY3IDU3NS4xOTQ3NjMgTCAzMzEuNTcwNDk2IDU4MC4wMjY5NzggTCA0NTMuMjYxODQxIDU5Mi42NzEwODIgTCA0NzIuNTkwNjM3IDU5Mi42NzEwODIgTCA0NzUuMzI4ODU3IDU4NC44NTkwMDkgTCA0NjguNzI0OTE1IDU4MC4wMjY5NzggTCA0NjMuNTcwNTU3IDU3NS4xOTQ3NjMgTCAzNDYuMzg5MzEzIDQ5NS43ODUyMTcgTCAyMTkuNTQzNjcxIDQxMS44NjU5MDYgTCAxNTMuMTAwNzIzIDM2My41NDM3NjIgTCAxMTcuMTgxMjY3IDMzOS4wNjA0MjUgTCA5OS4wNjA0NTUgMzE2LjEwNzM2MSBMIDkxLjI0ODM2NyAyNjYuMDEzNTUgTCAxMjMuODY1Nzg0IDIzMC4wOTM5OTQgTCAxNjcuNjc3ODg3IDIzMy4wNzM4NTMgTCAxNzguODcyNTEzIDIzNi4wNTM3NzIgTCAyMjMuMjQ4MzY3IDI3MC4yMDE0NzcgTCAzMTguMDQwMjgzIDM0My41NzA0OTYgTCA0NDEuODI1NTkyIDQzNC43MzgzNDIgTCA0NTkuOTQ2NDExIDQ0OS43OTg3MDYgTCA0NjcuMTk0NjcyIDQ0NC42NDQ0NyBMIDQ2OC4wODA1OTcgNDQxLjAyMDIwMyBMIDQ1OS45NDY0MTEgNDI3LjQwOTQ4NSBMIDM5Mi42MTc0OTMgMzA1LjcxODMyMyBMIDMyMC43Nzg1NjQgMTgxLjkzMjk4MyBMIDI4OC44MDU0MiAxMzAuNjMwODU5IEwgMjgwLjM0ODk5OSA5OS44NjU4NDUgQyAyNzcuMzY5MTcxIDg3LjIyMTQzNiAyNzUuMTk0NjQxIDc2LjU5MDY5OCAyNzUuMTk0NjQxIDYzLjYyNDI2OCBMIDMxMi4zMjIxNzQgMTMuMjA4MTMgTCAzMzIuODU5MSA2LjYwNDEyNiBMIDM4Mi4zODkzMTMgMTMuMjA4MTMgTCA0MDMuMjQ4MzUyIDMxLjMyODk3OSBMIDQzNC4wMTM1MTkgMTAxLjcxODE0IEwgNDgzLjg2NTc1MyAyMTIuNTM3MDQ4IEwgNTYxLjE4MTI3NCAzNjMuMjIxNDk3IEwgNTgzLjgxMjEzNCA0MDcuOTE5NDM0IEwgNTk1Ljg5MjYzOSA0NDkuMzE1NDkxIEwgNjAwLjQwMjcxIDQ2MS45NTk4MzkgTCA2MDguMjE0NzgzIDQ2MS45NTk4MzkgTCA2MDguMjE0NzgzIDQ1NC43MTE2MDkgTCA2MTQuNTc3MjcxIDM2OS44MjU2MjMgTCA2MjYuMzM1NjMyIDI2NS42MTA4NCBMIDYzNy43NzE4NTEgMTMxLjUxNjg0NiBMIDY0MS43MTgyMDEgOTMuNzQ1MTE3IEwgNjYwLjQwMjgzMiA0OC40ODMyNzYgTCA2OTcuNTMwMzM0IDI0LjAwMDEyMiBMIDcyNi41MjM1NiAzNy44NTI0MTcgTCA3NTAuMzYyNTQ5IDcyIEwgNzQ3LjA2MDQ4NiA5NC4wNjcxMzkgTCA3MzIuODg2MDQ3IDE4Ni4yMDE0MTYgTCA3MDUuMTAwNzA4IDMzMC41MjM1NiBMIDY4Ni45Nzk5MTkgNDI3LjE2Nzg0NyBMIDY5Ny41MzAzMzQgNDI3LjE2Nzg0NyBMIDcwOS42MTA4NCA0MTUuMDg3MzQxIEwgNzU4LjQ5NjcwNCAzNTAuMTc0NTYxIEwgODQwLjY0NDM0OCAyNDcuNDkwMDUxIEwgODc2Ljg4NTkyNSAyMDYuNzM4MzQyIEwgOTE5LjE2Nzg0NyAxNjEuNzE4MTQgTCA5NDYuMzA4ODM4IDE0MC4yOTU0MSBMIDk5Ny42MTA4NCAxNDAuMjk1NDEgTCAxMDM1LjM4MjY5IDE5Ni40Mjk2MjYgTCAxMDE4LjQ2OTg0OSAyNTQuNDE2MTk5IEwgOTY1LjYzNzYzNCAzMjEuNDIyODUyIEwgOTIxLjgyNTU2MiAzNzguMjAxNTM4IEwgODU5LjAwNjcxNCA0NjIuNzY1MjU5IEwgODE5Ljc4NTI3OCA1MzAuNDE2MjYgTCA4MjMuNDA5NDI0IDUzNS44MTIwNzMgTCA4MzIuNzUxNzcgNTM0LjkyNjI3IEwgOTc0LjY1Nzc3NiA1MDQuNzI0OTE1IEwgMTA1MS4zMjg5NzkgNDkwLjg3MjU1OSBMIDExNDIuODE4ODQ4IDQ3NS4xNjc3ODYgTCAxMTg0LjIxNDg0NCA0OTQuNDk2NTgyIEwgMTE4OC43MjQ4NTQgNTE0LjE0NzY0NCBMIDExNzIuNDU2NDIxIDU1NC4zMzU2OTMgTCAxMDc0LjYwNDEyNiA1NzguNDk2NzY1IEwgOTU5LjgzODk4OSA2MDEuNDQ5ODI5IEwgNzg4LjkzOTYzNiA2NDEuODc5MjcyIEwgNzg2Ljg0NTc2NCA2NDMuNDA5NDg1IEwgNzg5LjI2MTg0MSA2NDYuMzg5MzQzIEwgODY2LjI1NTEyNyA2NTMuNjM3NjM0IEwgODk5LjE5NDcwMiA2NTUuNDA5NDI0IEwgOTc5LjgxMjEzNCA2NTUuNDA5NDI0IEwgMTEyOS45MzI4NjEgNjY2LjYwNDE4NyBMIDExNjkuMTU0NDE5IDY5Mi41MzcxMDkgTCAxMTkyLjY3MTI2NSA3MjQuMjY4Njc3IEwgMTE4OC43MjQ4NTQgNzQ4LjQyOTY4OCBMIDExMjguMzIyMTQ0IDc3OS4xOTQ2NDEgTCAxMDQ2LjgxODg0OCA3NTkuODY1ODQ1IEwgODU2LjU5MDc1OSA3MTQuNjA0MTI2IEwgNzkxLjM1NTc3NCA2OTguMzM1NzU0IEwgNzgyLjMzNTY5MyA2OTguMzM1NzU0IEwgNzgyLjMzNTY5MyA3MDMuNzMxNTY3IEwgODM2LjY5ODEyIDc1Ni44ODU5ODYgTCA5MzYuMzIyMjA1IDg0Ni44NDU1ODEgTCAxMDYxLjA3Mzk3NSA5NjIuODE4OTcgTCAxMDY3LjQzNjI3OSA5OTEuNDkwMTEyIEwgMTA1MS40MDk0MjQgMTAxNC4xMjA5MTEgTCAxMDM0LjQ5NjcwNCAxMDExLjcwNDcxMiBMIDkyNC44ODU5ODYgOTI5LjIzNDkyNCBMIDg4Mi42MDQxMjYgODkyLjEwNzU0NCBMIDc4Ni44NDU3NjQgODExLjQ4OTk5IEwgNzgwLjQ4MzI3NiA4MTEuNDg5OTkgTCA3ODAuNDgzMjc2IDgxOS45NDYyODkgTCA4MDIuNTUwNDE1IDg1Mi4yNDE2OTkgTCA5MTkuMDg3MzQxIDEwMjcuNDA5NDI0IEwgOTI1LjEyNzYyNSAxMDgxLjEyNzY4NiBMIDkxNi42NzEyMDQgMTA5OC42MDQxMjYgTCA4ODYuNDY5ODQ5IDExMDkuMTU0NDE5IEwgODUzLjI4ODY5NiAxMTAzLjExNDEzNiBMIDc4NS4wNzM5MTQgMTAwNy4zNTU4MzUgTCA3MTQuNjg0NjMxIDg5OS41MTY3ODUgTCA2NTcuOTA2MDY3IDgwMi44NzI0OTggTCA2NTAuOTc5ODU4IDgwNi44MTg5NyBMIDYxNy40NzY2MjQgMTE2Ny43MDQ4MzQgTCA2MDEuNzcxODUxIDExODYuMTQ3NzA1IEwgNTY1LjUzMDIxMiAxMjAwIEwgNTM1LjMyODg1NyAxMTc3LjA0Njk5NyBMIDUxOS4zMDIxMjQgMTEzOS45MTk1NTYgTCA1MzUuMzI4ODU3IDEwNjYuNTUwNTM3IEwgNTU0LjY1Nzc3NiA5NzAuNzkyMDUzIEwgNTcwLjM2MjQ4OCA4OTQuNjg0NTcgTCA1ODQuNTM2OTI2IDgwMC4xMzQyNzcgTCA1OTIuOTkzMzQ3IDc2OC43MjQ5NzYgTCA1OTIuNDI5NjI2IDc2Ni42MzA4NTkgTCA1ODUuNTAzNDc5IDc2Ny41MTY5NjggTCA1MTQuMjI4MjEgODY1LjM2OTI2MyBMIDQwNS44MjU1MzEgMTAxMS44NjU5MDYgTCAzMjAuMDUzNzExIDExMDMuNjc3OTc5IEwgMjk5LjUxNjgxNSAxMTExLjgxMjI1NiBMIDI2My45MTk1MjUgMTA5My4zNjkyNjMgTCAyNjcuMjIxNDk3IDEwNjAuNDI5Njg4IEwgMjg3LjExNDEzNiAxMDMxLjExNDEzNiBMIDQwNS44MjU1MzEgODgwLjEwNzM2MSBMIDQ3Ny40MjI5MTMgNzg2LjUyMzU2IEwgNTIzLjY1MTA2MiA3MzIuNDgzMjc2IEwgNTIzLjMyODkxOCA3MjQuNjcxMjY1IEwgNTIwLjU5MDY5OCA3MjQuNjcxMjY1IEwgMjA1LjI4ODYwNSA5MjkuMzk1OTM1IEwgMTQ5LjE1NDQzNCA5MzYuNjQ0NDA5IEwgMTI0Ljk5MzM1NSA5MTQuMDEzNTUgTCAxMjcuOTczMTgzIDg3Ni44ODU5ODYgTCAxMzkuNDA5NDA5IDg2NC44MDU0MiBMIDIzNC4yMDEzODUgNzk5LjU3MDQzNSBMIDIzMy44NzkyMjcgNzk5Ljg5MjcgWiIvPgogICAgPC9nPgo8L3N2Zz4K" alt="" aria-hidden="true" loading="lazy" width="18" height="18">Claude Code</span>
            <span class="wchip"><img class="wlogo wlogo-openai" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjEiIHZpZXdCb3g9IjAgMCAxNTguNzEyOCAxNTcuMjk2Ij4KICA8IS0tIEdlbmVyYXRvcjogQWRvYmUgSWxsdXN0cmF0b3IgMjkuMi4xLCBTVkcgRXhwb3J0IFBsdWctSW4gLiBTVkcgVmVyc2lvbjogMi4xLjAgQnVpbGQgMTE2KSAgLS0+CiAgPHBhdGggZD0iTTYwLjg3MzQsNTcuMjU1NnYtMTQuOTQzMmMwLTEuMjU4Ni40NzIyLTIuMjAyOSwxLjU3MjgtMi44MzE0bDMwLjA0NDMtMTcuMzAyM2M0LjA4OTktMi4zNTkzLDguOTY2Mi0zLjQ1OTksMTMuOTk4OC0zLjQ1OTksMTguODc1OSwwLDMwLjgzMDcsMTQuNjI4OSwzMC44MzA3LDMwLjIwMDYsMCwxLjEwMDcsMCwyLjM1OTMtLjE1OCwzLjYxNzhsLTMxLjE0NDYtMTguMjQ2N2MtMS44ODcyLTEuMTAwNi0zLjc3NTQtMS4xMDA2LTUuNjYyOSwwbC0zOS40ODEyLDIyLjk2NTFaTTEzMS4wMjc2LDExNS40NTYxdi0zNS43MDc0YzAtMi4yMDI4LS45NDQ2LTMuNzc1Ni0yLjgzMTgtNC44NzYzbC0zOS40ODEtMjIuOTY1MSwxMi44OTgyLTcuMzkzNGMxLjEwMDctLjYyODUsMi4wNDUzLS42Mjg1LDMuMTQ1OCwwbDMwLjA0NDEsMTcuMzAyNGM4LjY1MjMsNS4wMzQxLDE0LjQ3MDgsMTUuNzI5NiwxNC40NzA4LDI2LjExMDcsMCwxMS45NTM5LTcuMDc2OSwyMi45NjUtMTguMjQ2MSwyNy41Mjd2LjAwMjFaTTUxLjU5Myw4My45OTY0bC0xMi44OTgyLTcuNTQ5N2MtMS4xMDA3LS42Mjg1LTEuNTcyOC0xLjU3MjgtMS41NzI4LTIuODMxNHYtMzQuNjA0OGMwLTE2LjgzMDMsMTIuODk4Mi0yOS41NzIyLDMwLjM1ODUtMjkuNTcyMiw2LjYwNywwLDEyLjc0MDMsMi4yMDI5LDE3LjkzMjQsNi4xMzQ5bC0zMC45ODcsMTcuOTMyNGMtMS44ODcxLDEuMTAwNy0yLjgzMTQsMi42NzM1LTIuODMxNCw0Ljg3NjR2NDUuNjE1OWwtLjAwMTQtLjAwMTVaTTc5LjM1NjIsMTAwLjA0MDNsLTE4LjQ4MjktMTAuMzgxMXYtMjIuMDIwOWwxOC40ODI5LTEwLjM4MTEsMTguNDgxMiwxMC4zODExdjIyLjAyMDlsLTE4LjQ4MTIsMTAuMzgxMVpNOTEuMjMxOSwxNDcuODU5MWMtNi42MDcsMC0xMi43NDAzLTIuMjAzMS0xNy45MzI0LTYuMTM0NGwzMC45ODY2LTE3LjkzMzNjMS44ODcyLTEuMTAwNSwyLjgzMTgtMi42NzI4LDIuODMxOC00Ljg3NTl2LTQ1LjYxNmwxMy4wNTY0LDcuNTQ5OGMxLjEwMDUuNjI4NSwxLjU3MjMsMS41NzI4LDEuNTcyMywyLjgzMTR2MzQuNjA1MWMwLDE2LjgyOTctMTMuMDU2NCwyOS41NzIzLTMwLjUxNDcsMjkuNTcyM3YuMDAxWk01My45NTIyLDExMi43ODIybC0zMC4wNDQzLTE3LjMwMjRjLTguNjUyLTUuMDM0My0xNC40NzEtMTUuNzI5Ni0xNC40NzEtMjYuMTEwNywwLTEyLjExMTksNy4yMzU2LTIyLjk2NTIsMTguNDAzLTI3LjUyNzJ2MzUuODYzNGMwLDIuMjAyOC45NDQzLDMuNzc1NiwyLjgzMTQsNC44NzYzbDM5LjMyNDgsMjIuODA2OC0xMi44OTgyLDcuMzkzOGMtMS4xMDA3LjYyODctMi4wNDUuNjI4Ny0zLjE0NTYsMFpNNTIuMjIyOSwxMzguNTc5MWMtMTcuNzc0NSwwLTMwLjgzMDYtMTMuMzcxMy0zMC44MzA2LTI5Ljg4NzEsMC0xLjI1ODUuMTU3OC0yLjUxNjkuMzE0My0zLjc3NTRsMzAuOTg3LDE3LjkzMjNjMS44ODcxLDEuMTAwNSwzLjc3NTcsMS4xMDA1LDUuNjYyOCwwbDM5LjQ4MTEtMjIuODA3djE0Ljk0MzVjMCwxLjI1ODUtLjQ3MjEsMi4yMDIxLTEuNTcyOCwyLjgzMDhsLTMwLjA0NDMsMTcuMzAyNWMtNC4wODk4LDIuMzU5LTguOTY2MiwzLjQ2MDUtMTMuOTk4OSwzLjQ2MDVoLjAwMTRaTTkxLjIzMTksMTU3LjI5NmMxOS4wMzI3LDAsMzQuOTE4OC0xMy41MjcyLDM4LjUzODMtMzEuNDU5NCwxNy42MTY0LTQuNTYyLDI4Ljk0MjUtMjEuMDc3OSwyOC45NDI1LTM3LjkwOCwwLTExLjAxMTItNC43MTktMjEuNzA2Ni0xMy4yMTMzLTI5LjQxNDMuNzg2Ny0zLjMwMzUsMS4yNTk1LTYuNjA3LDEuMjU5NS05LjkwOSwwLTIyLjQ5MjktMTguMjQ3MS0zOS4zMjQ3LTM5LjMyNTEtMzkuMzI0Ny00LjI0NjEsMC04LjMzNjMuNjI4NS0xMi40MjYyLDIuMDQ1LTcuMDc5Mi02LjkyMTMtMTYuODMxOC0xMS4zMjU0LTI3LjUyNzEtMTEuMzI1NC0xOS4wMzMxLDAtMzQuOTE5MSwxMy41MjY4LTM4LjUzODQsMzEuNDU5MUMxMS4zMjU1LDM2LjAyMTIsMCw1Mi41MzczLDAsNjkuMzY3NWMwLDExLjAxMTIsNC43MTg0LDIxLjcwNjUsMTMuMjEyNSwyOS40MTQyLS43ODY1LDMuMzAzNS0xLjI1ODYsNi42MDY3LTEuMjU4Niw5LjkwOTIsMCwyMi40OTIzLDE4LjI0NjYsMzkuMzI0MSwzOS4zMjQ4LDM5LjMyNDEsNC4yNDYyLDAsOC4zMzYyLS42Mjc3LDEyLjQyNi0yLjA0NDEsNy4wNzc2LDYuOTIxLDE2LjgzMDIsMTEuMzI1MSwyNy41MjcxLDExLjMyNTFaIi8+Cjwvc3ZnPg==" alt="" aria-hidden="true" loading="lazy" width="18" height="18">Codex</span>
            <span class="wchip"><img class="wlogo wlogo-openclaw" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDE2IDE2IiByb2xlPSJpbWciIGFyaWEtbGFiZWw9IlBpeGVsIGxvYnN0ZXIiPgogIDxyZWN0IHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0ibm9uZSIvPgogIDwhLS0gb3V0bGluZSAtLT4KICA8ZyBmaWxsPSIjM2EwYTBkIj4KICAgIDxyZWN0IHg9IjEiIHk9IjUiIHdpZHRoPSIxIiBoZWlnaHQ9IjMiLz4KICAgIDxyZWN0IHg9IjIiIHk9IjQiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjIiIHk9IjgiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjMiIHk9IjkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjQiIHk9IjIiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjQiIHk9IjEwIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIi8+CiAgICA8cmVjdCB4PSI1IiB5PSIyIiB3aWR0aD0iNiIgaGVpZ2h0PSIxIi8+CiAgICA8cmVjdCB4PSIxMSIgeT0iMiIgd2lkdGg9IjEiIGhlaWdodD0iMSIvPgogICAgPHJlY3QgeD0iMTIiIHk9IjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjEyIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIi8+CiAgICA8cmVjdCB4PSIxMyIgeT0iNCIgd2lkdGg9IjEiIGhlaWdodD0iMSIvPgogICAgPHJlY3QgeD0iMTMiIHk9IjgiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjE0IiB5PSI1IiB3aWR0aD0iMSIgaGVpZ2h0PSIzIi8+CiAgICA8cmVjdCB4PSI1IiB5PSIxMSIgd2lkdGg9IjYiIGhlaWdodD0iMSIvPgogICAgPHJlY3QgeD0iNCIgeT0iMTIiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjExIiB5PSIxMiIgd2lkdGg9IjEiIGhlaWdodD0iMSIvPgogICAgPHJlY3QgeD0iMyIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjEyIiB5PSIxMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIvPgogICAgPHJlY3QgeD0iNSIgeT0iMTQiIHdpZHRoPSI2IiBoZWlnaHQ9IjEiLz4KICA8L2c+CgogIDwhLS0gYm9keSAtLT4KICA8ZyBmaWxsPSIjZmY0ZjQwIj4KICAgIDxyZWN0IHg9IjUiIHk9IjMiIHdpZHRoPSI2IiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjQiIHk9IjQiIHdpZHRoPSI4IiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjMiIHk9IjUiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxIi8+CiAgICA8cmVjdCB4PSIzIiB5PSI2IiB3aWR0aD0iMTAiIGhlaWdodD0iMSIvPgogICAgPHJlY3QgeD0iMyIgeT0iNyIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjQiIHk9IjgiIHdpZHRoPSI4IiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjUiIHk9IjkiIHdpZHRoPSI2IiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjUiIHk9IjEyIiB3aWR0aD0iNiIgaGVpZ2h0PSIxIi8+CiAgICA8cmVjdCB4PSI2IiB5PSIxMyIgd2lkdGg9IjQiIGhlaWdodD0iMSIvPgogIDwvZz4KCiAgPCEtLSBjbGF3cyAtLT4KICA8ZyBmaWxsPSIjZmY3NzVmIj4KICAgIDxyZWN0IHg9IjEiIHk9IjYiIHdpZHRoPSIyIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjIiIHk9IjUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjIiIHk9IjciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjEzIiB5PSI2IiB3aWR0aD0iMiIgaGVpZ2h0PSIxIi8+CiAgICA8cmVjdCB4PSIxMyIgeT0iNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIvPgogICAgPHJlY3QgeD0iMTMiIHk9IjciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICA8L2c+CgogIDwhLS0gZXllcyAtLT4KICA8ZyBmaWxsPSIjMDgxMDE2Ij4KICAgIDxyZWN0IHg9IjYiIHk9IjUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICAgIDxyZWN0IHg9IjkiIHk9IjUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4KICA8L2c+CiAgPGcgZmlsbD0iI2Y1ZmJmZiI+CiAgICA8cmVjdCB4PSI2IiB5PSI0IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIi8+CiAgICA8cmVjdCB4PSI5IiB5PSI0IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIi8+CiAgPC9nPgo8L3N2Zz4KCg==" alt="" aria-hidden="true" loading="lazy" width="18" height="18">OpenClaw</span>
            <span class="wchip"><img class="wlogo wlogo-hermes" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAYKADAAQAAAABAAAAYAAAAACpM19OAAAkCUlEQVR4Ae2dB7hVxbXHB6SJDVQsgAqIDeyiSWxcjL1hS2LvYjeWYNRogl3z2XsHW0QsKIotIkqTojRFRMpFQEE6CIK0ef/fOnf23WffU+89N+R9763vO2e32dPWzGqzZu06zrmu+v0/rKUeqKNy/dVXX+3atWvnvPdrqRr/t4qtU6eOGzdunLv//vudIWDAgAHugAMO+L/VC2u5tfR5x44dXT3qsXz5cqvOf9MMYJQkYc2aNe7nn392CxcutN+KX1fYrK3foL5rslET13Tjpm6jjTZyyXdTE/u/Z3ZTv9DnhoBkQ9fGdVqnqa8WLFjopk+f5r7RVB09ZoyO37hpup43b55btGiRW7ZsmVu9erUhYJ111nGNGjVyTZo0cS1btnQ77bST22uvvdw+e+/j2rVv59Zff301KYXQdCq79pGyVhEQ7/TFixa7H378wf3www9u7ty5NsIXLFgQjXj6b+XKlfYsjJ4wUEDE0qVL7cf7w4YNcz169HB169Zxbdps6w488EB37LHH6tjRNW3axF5LISLMsrWHiLWCgNDxK1asdD+q02fPnu0gL5tsson77W9/WzFiQ/dWHletWu2mTp3q+vf/xL3yyivus88+s/cqU6SfrVnj3aRJk+z33HPPuVatWrnjjz/enXXWWW633XazxGsbEQwB/9FHH7lDDjmk1qWg0PGQkS+/+MJ99fXXRlJWChErV+mnEd6wYUO32Wabu+23397tuuuurm3bbdN7NXbVv39/d9dddznqXwysu+66hoiuXbu63Xff3V6tJE21PxvoB+p82GGHpcrWhfiv9xqFtfKzzPU3/ptv/DVXX+N33HFHL2bpRbtpbdafaLcvKyvzTz/9tBfjDdmojtGp16zwjz/+uG/atGnWfLKVsd566/lru3b18+fPtwzJt/JXO31BHwMffvhhqK/NgIoKlLZQy1R/474e57t06eI32GCDUGjRxx122MF3797dr16dakDoqFDGFyNG+Hbtdio6X5Czyy67eJGzkFWtI4GCahUBoSViiP6qq66qUccnR2/nzp19eXm5FRGQwBH4/vvv/d57d6gWEho3buwfeeSRVEb6T+Vd2gEZKAyF1BoCyHzVqlVGNrbeeutqdUay05PX22yzjf/3v/9NUbHRapd+xowZXnS92uXKKuDFi2J5lx4JZF5yBKSa7/03ovNHHnlktTsg2dnZrhmxL774YqyjUsjgxsSJE/0221Qf+RdedJGXqBvLu7RIIOOSIsBqqj+Jer5Zs01rrfPr1q2bljdMXPK+FZ8kR5/07+8l7aSlz4ZMSV6+Qf0GPuQPQ7/7rrv8r7/+Gsu7dEgg04CAuqpUjQCRCvPAhV26uHPPPdfNmTO3Rvllepky+NWrV89tuOGGlgStF+33/PPPd3379tXzyjcRKTuVlblu//hH5c0cZ4i/LVo0d8233NJpZrnFixe7Cd9NcK+++mqti+Y1QgCdgmIkkuOeevpph3ydCeg4zAXFAO80aNDAXqFzN954Y7dixQq38847O4mxpikfeuih0hk2c2effbb79tsJaUjgxatk5QURuQAzBe2YOWuW6QToBdS1vHyq22KLLdwnn/Svkm+u/Ip9Vk0EpEbkGNloDj74YMdx8803d5qyVcrXtHabbrppTo01+RIdgnlh7733Nu1Y5MXe33bbbaU5/+huvfVWd8mll7onnnjS9er1amoGXtjFEASyAGZB/fr13T333mujOnXXyTyR3mSQ2rZtW6v7sOHD3IGyCh90UCe3SAa//fbdz5VPmexmzPjBkBTyKOUxvTYF5kwjx6rTjzjiCOsoTAhotzQujHQ0WmCfffYxDVdkzzVer7E1hDR0ci5gNkEKbrv1NssTu9BWW23levd+y7TYRx95RKO/mayfTdzf//53h3n3mWeeScsSJOy5555GGsMDkLLddtuFS0MadiSJr5rBjd3SX35x119/gzvhpJOMxM1VuzB9YCqpLcAUUcFs8jMaEiJvqzP8fvvtZ3L3Rhtt6IUEv+mmm6jJzsssbFquLJL+9NNPt3tquN9a7/C8VatWnmvO+XEuhETX3GvRooVHEx4+fIS//vrr7ZlMB1bP8AeTFEnyDz/8sN93332tDj/9NNsex2XuKVPKvXhGlP+pp5ziW7duHV1T3gEH7O9Fxvwvv/xi76+oEEU1w70MeSZZ8SDkW5Mj+VSLCTNqMQP/8Y9/dHvssYdrJ7MvtHK7ttuJBG0mUrDErI3rr7e+jZ5rrrnGffzxx2qfs9EaRv1vfvMbmxX2QH/QemnJdsksghEuWbrEtWje3I0aNdLddNNNRue7detmaRjZAGmx/9922202K4Q016fP26mHMfNz69at3BlnnFFx37mflyxxd9xxh5mtw0ydN2++a67yAh+rLx40ffoMN2f2HKfOcu+9956TfhPlUaqToq2hN998s5OC5Y4++ih3wQVd3OGHH+YWzF9g9vs1a1bblO/X7xN35513ijF+62aJuQHNm7dw48ePd5oFZh7m/ko1aObMmW6JpCgaDy9hqtORkuXV8X8Xove0TtFMcsOGDzemCvWS/UbILzf+MnjwYDd06Of2/ptv9nY//fST8STvK8kcjHrLLbZ0u+62q9Mod3/4wx/cttu2dQsWLlBHT3dlWp3aYIP13S8aYOtKuoKkfv75ECeaYPyhZ89XxBsOMiFAA7hU/e8K5gGM3uHqAKyWTz31lOz2P7q//e1v1jmIhFPErA4/7HAxyZm2vnzqqae6RYsXmcRCbUWm3BKNvI5lZU52Hctj8KBBxks+//xzd6mYKtByq5aOd7t2vdade865QugexlBZMn3u2WedSI276KKL3GWXXebOO+88N1udDV3v0+cdd99992kWLnZjxo61vMIf/SV7j+j7UveWeEiQrmbNmukuufhiN1WIRBSFh1x/3XXugw8+cEOGDDGTN3UFRo4c5aR9a4CUrvOj+hXCA6C3DzzwgP9l6VKjldAxQEgxY5Zmgr9YGqQYrBm2RHr81KnfezFP/+STT3ohy19++eV691vfu3dvr45IZVDxP3nyZKP1c+bMSbvPBUoW8Pbbb9N6+wUa3r5du8iqinVT4qs/RTQe4L3w4xpFMbx/3V//qrqMFw/b2+5JpzBFbMstt/RXXnmlv/32231T8Y3DDz9cymUzSyPzsZ82bTpZ1YgX8H7gASAhLxPmhX7qUOwvdBD2lgBaOrTrZ5991mua+z59+ljlsFz6io4LacOx95u9/Z/+9CfLS7PCGB/H1157LSSJjsuX/2oWUElEQuZCv+suu1pnBKYtEbeKsQ9Tt+i35ZFCQKoiInsSFFKaOu9rccZfcsklhrSAGI4nnXSSP+GEE/z+++9vgoAkOSuTd998882KfPMLLNkYNRkEBBTEA2A+H370obv22uuMprfXOiv0e6Vk6CZNNnITv/tOYpzWX+XawuoWLhey09giD8uHrOFO+36ae+3110yuR9mB/Bx26GF6ttDVlVjKuy2NifYRXzncFis+FxmYPWeO8QFJXuIp492mzTZl0EQaKrwAEhQHyhswcICTtENKewQZQleBlGkG2vuaUU6SnNH10aNHR1lAEqmjTBLiF0tN8GgssZil0n7ibwcffIjxC/Vj9E5NTnLOALA1cOBA3759e9+373v+X//6l//666/9G2+8YeSE571e7eUnTJjgmb5YIiW724iRJukhC1tvvZUtwKiSZp/p2LGjV2dYGu6F37Zt2kTnWse1RZZOncr8Oeec46+44gp/9NFHVxFXw7vJ47nnnUfVjATZScXfE088EZXBO5AeZqMkqrT7HTse6PeTaNtG4iptaNmipT3XUqYfOnSY5ZZthOe7z8tFzYAXnn9eI2GZ1PJP3L333mPSAFovi93tdmrnut3czUwDSA6Ide+8+47a5iIJCKnDV4xExFjWcjEnMHphfgEmT5kSTiWBfG7MctLESe677yZKBFxpC+yqe5Qm18kIabXkzewQGVL9FtgIplzuhXKZodRbHe0mTZ4cZUm5mDmaygQyRUx6Ex0Re5HOBgz4zHXosJeuMa8UVp8o4wwnWWcAmGIpUBXxEtu04tTORgHnWBoltnnZWuxeRU2MZjJiwnW2Y4cOHTQzts6bTp3lGzZoYOmkF6QpcNny5j5KHAz/r2K2MFqJufYu9n5W1+LvYsE9UTQ/fg8egZK3w/bbe0zf8BXyJA2KmfQfuqdazJj3wgzIK4YyEsV4jWYixyNyMmLML0deCtyLA6Imqn0+IA10Nh8wUn8VrwFmSeTERlQIkD9i8wvPv+BGjBhhNiTqzgwIFtWQzxxZcOtpVmDwC6A+shlKO1ESMYs0qjCvwOO+/PLLkLRGx7wIYPUebZNCqZQkASeR0QqVbOGwlVQH8N/BToN+USjQ+ShqhQB11ShzL7z4gjtYHh/AmWeead4IICQJKI27V7iqhGcw3VUqc7UEDvJbrbIhQxgEhw0bWvBgCPllOmZFAB1DoTg5AeWig0C9euuYpMM59LO66jkjCsQyImsLXn75ZXNbWU+mDQCNWWRF9LtDlSInTPjWSbewDg4PsZTSPmYg5vFly5cZj2NWfPXVV6ZxFzOAQr7xY1YEkAgmOUWMEbGOzqawn2XvoQKlAGaVlKZSZJUxD2xKu8n0ACkChg4dKvN1L1dWVub+8pe/mPkjvCh9wy2WSaRVq1bhlh2XLftF1ti6Nhh/VZog8rIO8p0Yck0hJwJmzpxl9J6ZEACklAow1B155FEmb5cqz5APpAKThqypZm8K97Vm7e655x4npc9MIsEswXOJ12ZkDGk5Iv3Vq1ffyA39wA+iib7zVcLkEX+v0POcCJg7d04krpEhhRcy+hl5YaTkqgijiDIuvPDCXMmq9UwSixumET9ICh91Yc1ic4mVW2yxuf2g43jWBXGUQnBjxCgIuQmQ4juro3UOxOH6st5CQseMGWt9EtJW55gTAZCd6gANhsEWAhjAMFujpZYS6CBcHwEWgJCKZsu0PGvWT7ZuHRaO4rMbZMB4WXmLA/0QBhT+rPXr1zPeAN9YuHBRUYJEPF/OcyIgmbjQa3gGCCiEwb777rtG5mT8qlFDctWNDuQXlEFGNdeZADKUFI/hDwFRvBsoMoLJ9BnTM2VT8L2cCFhP07i6MGDgQFsTgBTkAjri2muvtfXfJANMvseSZKlnSrIMNF32GIQZwnNE3zipCpIf+tEEOQPUBHIiYEt5BYQVomILGaeRxGILrh1htSvkgfjZoEKp4R68AIYsc3dOhowOUihpC2UVe2RAQL5Adhzi+gcIQCJETGURqSZQyW0y5MJIYFQmtd0MSTPe+uc//6mFjJHu/fffdzffcotrrbwOOeRQKXKT3D/ks3PMMcdEoz8sDb7wwgumQIE0NNZ11qnn6mijBSMQvx0slEg4U2UdnaYfPkmlBtrLAg4DIxOAjCD/jxlbMwSQfxZbkKiegEUU0hT6ww6k9VcvJcjcFCXGpTKq+J82bZot4GhVzUuZ8Y8+9qi/8qorvZY65Wr4kv963Dizr6S9lOGCBSLpKF4zouC6FdoGmSRsUaaQ9PKw8KxlAEJMQT/SBluQysiNgC+++EJue5UeDKx4abRWabRGhJmsWciQwkMZEaheqljq8vvvp2mlbKqXEuMvuewy36JlysxLPTAN06CLL77Yjx07tsr7IR8aGuDEE0+qUpdCOi5fGox2eHrkS0dffPPNeKtOdRCQkwfA7dnsdooUmjggJYQpGO7feOONRm4eePBBN3LUqGj6qmZRGzjX2oCTd7P0ieVusky+ayRVMN0B6C9MUBsubAtnt27djMSI3Ko8S1LxlzKTcBFIV/xptnN0AXyCCmHkU6eWm9kiW17hPmb5r8elxN1wr5hjDgTQcSnAwyEsTiOGIdloUSU8tiMdZ/YS2f533GFHU/u1floFUSmEyNWwaRPZ++u71197PS0fLigLmw0eGFosMbdHVsYyAWaCfIDnG3YhtOAvvxxp3hp95WaCa002QMkKAyNbmnB/eIW9LFwXc8xbewawVrqkuvcyFz4yx0CnHS9pCgvLe1qxskWaSy652HY7lpdPyWgxBAl4tN1xx522Ka9NmzZpdRZZcZ9++qn785//bEuLOOEGg1olO0q9EhCalkHiAoSyKHTBBRfIDtTRfIRwPWSzHnlnAhhwE0lr2Z7H38HWRD2SVCGeJtd5FiYcGEol/S4vL/dHHXWU0RSOLE1qT65dqwA7shWJc3iC3Ea8NEfVrSqD4t6iRYs5eO14jPKQhONff/0NL1HQn3f++f7Bhx72wUstncbaq/7kk0+O3g11KNWR+msW5M1f69RevkhWofQ6hj5MP5IwMOG8MyDVr/pXNRBJGelM57nz5kYeYyeeeKLa7ExElGuKmXVVhtlWIEucJwGxEl8iFjYOOqiTe/TRR0VuTjZDGQ5ezLBOnQ6S385FDi+1THmQZyGLP8myC70ePXqU26OARaN5c+cZeSs033i6AhBA8lQH0o9oiFgZBw8abE5WEjvNR59UTPMNJLuzUx045eSTE8zTbtsf8j2kAS+27t17uOViZjhhgVjM1AQQOVn0PxsCYcogBdtNbYGkG9dcnhpxrThTWdQjrJtkep7rXk5FLP3FgISUOEKl9qowuEm2t6RIBCxhYt2cM2e2O03uhJkB93ZnWjZ7C/ihVdKQpFSTbeSTL5JUbSIAyy/md3gUQkYuwJOuOlAEAkL2ARGpaxgP6wYAJoYePbrb2uozzzxr0lLmDgx5pJDJf7DLM8tSEJ2EG1WOCxbMr1UEUCCaPKJ4PgTgV4QJA+09c5urVN9uFEiCMr8c7gYHXMwEjOZbbrnNdrnnr0gFIpQRHZ/qfO7l73zKxqaP5bU2AXKIszDmj1zAGjfrysVC7lwLzG327J8s5YqVK7Rp4yiZoXeo6MzUCM+dTejwcMydOv6UBRRJHfFbJT+HDGFvQhTPBehHLHkWCzVCQJB7Ax3eZeddtJ0nZR/H9o6kE9IUW7FC0jM6qwvUq9C64QVC7Ip8wKJ/sVAjBFCY5HxjVJyXlZVxcOOkcdZVA4cMGWxLgoU21F4u4o/Fk+oAytX6669X8KvQ/220JyIfjBz5pUmCxbS3xgjAeZX9WwCOT2zaw99+vOgh5grc+2Q7y1f3op7TQCSu7+QUXAjIs860WuqH8xUMf+lSuUtWcvy0bKD38U5kXWNdrXPn4wNyxxcfKG6BpsYIkDYb2eTr1ElVnM17I6VgQT+ZuuqvkgNML4i/+TLHr4dtSUv1Y7AgreTiHegeQSojb0jpcvkExT3nMpXJQs2gQQMzPcp6r8YImD9/XqSN4gALMFIaNWooO1DtMchvJ0yIys3autgDmCQu9dlGfSypKV7JVTwW8/MxYvL4uF+/eFZ5z2uMADRZGgdgbQSQifEWkPOuXTOdU1OaqVCa6cA22VIDo556gqQkArQppSAEjJBhDnfNOAnLVc8aIyDoABSCz+XKlatsw8U77/Rxn8qiCS+YPHmK1cFIUWn632nBJle7qvUM1xNmL+Qp6UwAH0gihUIgV3GgPxS7KH4r53mNEcDICIC0MHrMaLdz+/YOG9FVV13pXn/9dde587HuuOOOtwVsmwM1YAqMLGhtIUpPPqYZ6h2OmFfoUGZ08AMKzwiVCSRHNov3SWTh0Fwo1BgBbPEMQMfgBUHDzzzzLNviP0SyMao8Cyfa5eJkPrYtQsmGhDwKOeIOwpalAJnywtCXdLAK6bMdIT3kxQxIrgPQNoyNSVtVJic0Zn6hOlCNERCfATSsp6IZLpR5AJHvFnlCsJ30ee2w0ZYm99BDD5mBjp01WSTAbH2Tdl/rypHoy4NMjFUb7dKcb9MyyHFhs0aVwwSeBMweuF3GAZJDwMP4bIMXFioiVxsBjBSmKrQxDoiHPbp3t+U+OpkKDtUKGnI7oSKP0aoZa7OF2nvieYfzSZMmZuz08Bxmym7+JBkJz7Md6UTrSLUt0wBBhE36SSHStm7dOgqDSd60ldgVhUC1EUDmFI6XcBIeePABm64nnniCVbh9u/aSqxtapzFaM43YZB65rvPRf6KssJ6b7KxcefIMMknd4AVsSE8C7ZWHSPK2my/EsHYdB/bTFQJZEcAIz0Rb45lCi9mulITvpRGywoX3AYs3KXG0dNpwPtMw5Ie6byzrbDFQv34Do//MHJTIJLD6Fic14flkGQUJCBtX3uTOU+HRkVvsy4gAKg+2U7aW7BlA/7M5uT4o95TAoDNN51D5Yo7UCwYZZ8DJ95G+jj76GLu9RR4LZvJdGCzMliPtTwKkRR5JydsKufyjubtoK2/0jLYXwgcyICCliDzyyMOawsT3ifKschL2ilV5oBvMDtxZKiFHRpWJ8p5hUkjynfhLbLwO0XZZySoG2IyN9AIJIohHElbpWSbyuUzSEYMj/gkA+OOoUanN36Ilyayi6yoIoMPfkOw+fPgIiXFtMhYY3s5nDu7Ro4cqMSqGxOwVCXnmO84Xycu1S4coKABLhD179syXXfQcfrFOheSzUusaPy+u6nPKJj027CUhIKWDeE8cwu57+AkIymQFSEMAiZiCtyuWDiFp8kE+czB0lFg/zFor3zIsFAmhwunpWXvI5gmB9zTOVldcfrk8KjrZDph8bQjPWc0jbA6ApZR+SALkb1mGfQVQCgBpKA7jx6dMMwgqaO6pPkhvTxoCeFm+P6axQkuzAYhCM8wnjfA+EQ1ZJwaoQOqXYvDkk/1nr8T+UhWH6YcRF3top8jop59xuntY4cxY5Md4lpTbk++Ea9az58ydY5fBthWexY+ZvLEVKcyS4DwWZ9I4dy1ZstSC/2ERYAWP9sehirYxRbsiaWDcxhN/IZyzTTMXLQ7pOMrD2hDGjshmzTZTJVPMlBkCImdpUb9cvphUkPJR4lDg8CFN8bzKWmdj+pQTzNNII+fLC06BuU06gQzmAtJD39mQlw9gxEmQg7HdWqWN6/HBwWzFWgw12W677R3+s5nIYuQZp5cVjCPlpbajPN7UWG6ZZ7OmX+R6zT28h1VqUT/i7sjRyUIHcNSUtVhuQkiVfMRAvTY/UFRF+Xbq34rFDMpUvkiPHzhoUCqx/k877bQqeSffE/mJwhAknxVyHSL4Eqonnl52Ja+vf1hdvhk/3stjIvL6zuoZp+YqD6etN9/KrtPLzuPTBpIxY/oM99JLL9mz+F/SfhJ/xjmS0SiZqrGacoTcMQMyrZgxE9Bm0azj5W9YEVsumTfXCrRk3nr7SxJSqy1JWVmnTEmje7QHckWIheoA7webU3KmwUcCX2km/gQPIVROHNJ4ANN7uZydABpwzTVX2+4WrgOtRh2/8KILq2jAmGp/97vfkbRkoBA4FpaMFa2ABKyP2eg64cxQouh76gvg/pgLaGc2pp7rvfCMVTLEXQYRoRGSsFpkCWjUaF3zGfq438d2HerHRUSCxK0V1qt7FKKLZ2qQRQeRNOO1uzyKmMKz+O+cc8+ttaDd+kqGTWP+RFctLlG87HC+114d7DnpJKp6wlyKKabVM6Qt1ZFwmep8L3tXxkguAwYMpDpyRF5koTglGBhpJ6RbRR0qESAJwyvwnZf5IDws6Kh1Xz94yJAqO0qk0BT0fr7OkITiFUvIU78jFMMtV3rqor1nHh6SK12pnjEwAcKcJfOk/dqPYM9lNTAeIEphodr69esX0lciQFzcK6KIf+eddwr+JAgYZV/XrbelomSFSjBzWrVqFQqp8fG44zr7AxTDjfy1ABIF6gvlrY0jHcw+N21CzFgf6qnVQEOAfIbMZb+x9tDN0IctZKyztqTxgHVkDYSWf/DBh04RBvNaE4k6wuoPKvx9itEcB9xRcOkrFbz11ttO0o0pWho9Be9eKVX5mfLB9IDZgo0fmXQH+EPQEXBaFiZsxS3Fp+j/FEQ8AFQpfoJhRiEEvNR5XyaxjtGspNGPaX7X3XdH0Q5lf4mehXTEdxNTrnI/PK/OkThy0j1sRMn5t6R5F1sfRMyu4on60lPWeiASI74LORaBkTKk29h3CYhAWVFmJQmiZfJ0ixLfcMMNtvNjwoTvLFzjywrYB61XdFnrBOja73//+5BR2hFeQpiwYhuWLT0hJOEBAWQ0s2B72dLX9n0pb1EgwmxlXX/d9VbdgQMHRaEx6S9AlCP0TSUC4OaApovFSSNjlCWFizdaJ83VsFdeXm5BXLPFfNtDe3d7KQaoRK1QSI2OmupemrnNOILHTpw4yerJ/lz2JGfrgLV5n7YrOKHVkw8PhbpomdbuBUVM99MREJBAeEpZCKMXEecY0a3FWOHkIcNMRzRCvp6U6Vkh9yTn+10VHpLI5cwkqf9WaWYkUz98wIebTPGHHnrQJIxC8v5PpWnfvp19DEhhkCMGzawZM3p0fgQEJIAl6H0xlWaTnrTbGpEf7U6MVHZIooJ5WOhjaZqS0N61cMIBKdYa/Um79vCIYupam2nlgOCl1KbxCKItMmCALDMAe0+67UUxdvyNN97kFTcib+PQH6DNWojJmzZf46kszEsmCS+ThI0iQggTgxo6qi2u1pBQX7vQH98SYKRly592EIRWbitS6JqbSCtzspfE4hVN3RNOU76t/rjjjvP6rmXB4ni8PAatPrVrAyfc1yqb1z6yUM1cCKiKBN7iwwgvvvSSKWmQIEIKyAbiZX+3jzT0fisVjFtbevIyp1CpfEcknQDaeeMVakwdf4d1IJ2sHZbhsR2JPU29yBfDV9hiiuSBViz3GMWKvtTvqM5Hsmuo0AgSle3TivqmgZd7iZE9GD5SHAMJ+f3VXr28or5nRWqyHegFBBqPK6I36CMUQAEzoNLqGUZXxayxDPgjPPGTTz4VZRYejJTWB1LiFZKBLmOY4niabOebb7G5V1QUy57OppM+lPSglSZPsA+Zr+0ZommXLhdE5bJ3mL3HRFFnRmC+kMNYZEbBKqvPnnjiYCBZIVyEjqGtc+fO859++pm/7rrrTCKEnMheZFHgUa6y1Zf7lyvE8uDBg9K+2MHgCZJjKCcHCYojIHme6mp5vVlgDRgtMaS12OC1qz2t0FBJpjLTPVwXe0TFp9LySrOR37nzcSYRURMtjvjHHnvMRjH5Qj4Ugcs+N/K47mth3NKAiFBu/FOIqdZU/icHGk9AsvY5GDmSN4b/7NNPs5IlSGNPIZpIw6E8fekpEp9pR0kQoK35UTjhUFCmIyRAn/4wZGV6Xui9PjKNwFvCiNfmPIvv36ZNa2soIZUJlw9jZkR/NfYr69WZM3+0b9yEcmTdjX2msOrgAgHJHxlpE4rtyMcm9cEH73vsOMzskC/Httu1tSDjWkmM7mu7rg0A8gidX0MEUGmy857vBcQLi1eGc+I1l5eX+4c1fZPPir1mCgPywjCLbBhh0Pl7773Xy1PCnjPiIU8AswNaHsrigwwB4p2R/bwSGbzHADj77LNMt4HXyO8pyhuZn0WdUFZb8aGer/YMxaV1fkkQEJCA6Ec8he1FYppp2mGYo+MxU8ivxiqAJBEqVt0jIw/Soc9gRXkdJqsoRsAA8+bNl2TxgV+jz90iPV1x+RVRWkXuCsmqdEZ2BKQGG20N7WWG8dEHmCvyPVbXeJtQTDFKzhHPCZApf55VkweEaVtZKTLTt7c8awlMfyyqAeQlnCYJxCtbyHncmsq3CLDUKhKjV1gz+2Ir5YTOea9vX9M/WAfgs1f166XsVzff3C1Up8jOT29rKAcdRyEV/DZSSGHsQeQlsphW/Aoqi0Q1REAYHalKRqVWnITKhsgqhXR2Mg3KFx9u4D7mENaHkaPnVXz9mqLCdH733b5eO1Os9Ls1+9CWeQ8hIUCmkVj4vRSiQ7vk/Wz6A52OZIZBDhIFFJIn6UqAgDBCqh4pADpZ3dUofRTUPlVLRxI2DKYfh9BI7hGbTh4U9p0Z+eyYpETn81WMYjol5Jn7WDnjntBn1JmN1FUfFLXq5X63sp9IXEsIsHrY50z42EJyVGe73kyfMwnx2fbbfz9DHgwWmxBKDZBsHPfofH3DxgyFXKMrgHQC+UEqgOR7Nb+2bGU1XqGv7x1gQgGaejFlkTYNAcFqZ7nU8A9RMWig2Tqc+zAy5Pb7Zd0cOXKUNQRJ4v777zc7Ep3P566yAV8zgv5eUDH6SIdOQN4wyP8EjBjxhUcklqNC0cXBH6mrOWaxwoQTkXLRveoBq/z4bPKJwHK5m+QCda47QkE9jlXcUDyI2WGuDlWw1JYOr2qCcEipMS8z7serhbMD7i36NIm5k2wkJy7SALh8sEJFPNHUe9VvT676y+fCHjds2EBuMzOs3zKtiGXLg74KfqPkVFu1zFZ+5DJSE4Rnzfx/2YP/AfcsG3f7Ix0uAAAAAElFTkSuQmCC" alt="" aria-hidden="true" loading="lazy" width="18" height="18">Hermes</span>
            <span class="wchip wchip-dim"><span class="wmark" aria-hidden="true"></span>+ any HTTP client</span>
          </div>
        </div>
      </div>
    </section>

    <section id="problem" class="rule-top">
      <div class="container">
        <div class="section-head">
          <div class="section-label"><span class="ord">§ 01</span><span class="sep">/</span><span>Problem</span></div>
          <h2 class="section-title">
            Pin-for-humans doesn&rsquo;t work <em>for agents</em><span class="dot">.</span>
          </h2>
        </div>

        <table class="compare-table">
          <thead>
            <tr>
              <th class="c-key" scope="col">&nbsp;</th>
              <th class="c-legacy" scope="col">Pinata · NFT.Storage · Storacha</th>
              <th class="c-tack" scope="col">Tack</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="c-key">Identity</td>
              <td class="c-legacy"><span class="strike">Email + API key</span></td>
              <td class="c-tack">Wallet address</td>
            </tr>
            <tr>
              <td class="c-key">Payment</td>
              <td class="c-legacy"><span class="strike">Credit card, monthly plan</span></td>
              <td class="c-tack">On-chain USDC, per pin</td>
            </tr>
            <tr>
              <td class="c-key">Minimum</td>
              <td class="c-legacy"><span class="strike">$20 / month</span></td>
              <td class="c-tack"><span class="num">$0.001</span> / pin</td>
            </tr>
            <tr>
              <td class="c-key">Machine-native</td>
              <td class="c-legacy">—</td>
              <td class="c-tack">HTTP 402 + A2A agent card</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="keep" class="rule-top">
      <div class="container">
        <div class="section-head">
          <div class="section-label"><span class="ord">§ 02</span><span class="sep">/</span><span>What to keep</span></div>
          <h2 class="section-title">
            Everything they <em>make</em><span class="dot">.</span>
          </h2>
        </div>

        <ol class="cases-list">
          <li>
            <span class="ord">01</span>
            <span class="name">Long-term memory</span>
            <span class="desc">State, embeddings, context. Recall across runs by CID.</span>
          </li>
          <li>
            <span class="ord">02</span>
            <span class="name">Generated artifacts</span>
            <span class="desc">Images, PDFs, code bundles, video. The run&rsquo;s outputs, pinned.</span>
          </li>
          <li>
            <span class="ord">03</span>
            <span class="name">RAG corpora</span>
            <span class="desc">Shared knowledge across an agent fleet. Replace by pinning a new CID.</span>
          </li>
          <li>
            <span class="ord">04</span>
            <span class="name">Task receipts</span>
            <span class="desc">On-chain payment, off-chain content. Verifiable provenance per job.</span>
          </li>
          <li>
            <span class="ord">05</span>
            <span class="name">Inter-agent handoffs</span>
            <span class="desc">CIDs as pointers. One agent pins, another retrieves.</span>
          </li>
          <li>
            <span class="ord">06</span>
            <span class="name">Replayable outputs</span>
            <span class="desc">Cache deterministic tool calls. Skip the work if the CID resolves.</span>
          </li>
        </ol>
      </div>
    </section>

    <section id="flow" class="rule-top">
      <div class="container">
        <div class="section-head">
          <div class="section-label"><span class="ord">§ 03</span><span class="sep">/</span><span>The loop</span></div>
          <h2 class="section-title">
            Three round-trips. <em>One signature</em><span class="dot">.</span>
          </h2>
        </div>

        <ol class="flow-list">
          <li>
            <span class="ord">STEP&nbsp;01</span>
            <span class="step">Agent <em>POSTs</em> <code>/pins</code>. Tack returns <code>402</code> with the price.</span>
          </li>
          <li>
            <span class="ord">STEP&nbsp;02</span>
            <span class="step">Agent <em>signs</em> one on-chain payment. x402 on Taiko, MPP on Tempo.</span>
          </li>
          <li>
            <span class="ord">STEP&nbsp;03</span>
            <span class="step"><code>202 Accepted</code>. <em>Pinned.</em> Wallet owns it.</span>
          </li>
        </ol>
      </div>
    </section>

    <section id="integrate" class="rule-top">
      <div class="container">
        <div class="section-head">
          <div class="section-label"><span class="ord">§ 04</span><span class="sep">/</span><span>Integrate</span></div>
          <h2 class="section-title">
            One endpoint. <em>Point your agent</em><span class="dot">.</span>
          </h2>
        </div>

        <div class="integrate-wrap">

          <aside class="endpoint-box">
            <div class="endpoint-label">→ API endpoint</div>
            <div class="endpoint-url-row">
              <code class="url"><span class="host">${o}</span></code>
              <button class="copy-btn" data-copy="${o}" aria-label="Copy endpoint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span class="copy-btn-label">Copy</span>
              </button>
            </div>
            <p class="endpoint-note">
              Your agent needs <strong>USDC on Taiko</strong> or <strong>USDC.e on Tempo</strong>. No ETH, no API keys.
            </p>
            <ul class="endpoint-check">
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <span>IPFS Pinning Service API spec</span>
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <span>A2A agent card at <code>/.well-known/agent.json</code></span>
              </li>
            </ul>
            <div class="rails-row">
              <span class="rail-chip"><span class="dot taiko" aria-hidden="true"></span>x402 · Taiko <span class="num" style="color:var(--ink-400);">167000</span></span>
              <span class="rail-chip"><span class="dot tempo" aria-hidden="true"></span>MPP · Tempo <span class="num" style="color:var(--ink-400);">4217</span></span>
            </div>
          </aside>

          <div class="code-block">
            <div class="code-chrome">
              <div class="code-dot" aria-hidden="true"></div>
              <div class="code-dot" aria-hidden="true"></div>
              <div class="code-dot" aria-hidden="true"></div>
              <div class="code-tabs" role="tablist" aria-label="Choose client">
                <button class="code-tab" role="tab" aria-selected="true" aria-controls="code-x402" id="tab-x402" data-tab="x402">
                  <span class="code-tab-dot taiko" aria-hidden="true"></span>x402 · Taiko
                </button>
                <button class="code-tab" role="tab" aria-selected="false" aria-controls="code-mpp" id="tab-mpp" data-tab="mpp">
                  <span class="code-tab-dot tempo" aria-hidden="true"></span>MPP · Tempo
                </button>
                <button class="code-tab" role="tab" aria-selected="false" aria-controls="code-curl" id="tab-curl" data-tab="curl">
                  <span class="code-tab-dot neutral" aria-hidden="true"></span>curl
                </button>
              </div>
            </div>

            <div class="code-pane" data-active="true" id="code-x402" role="tabpanel" aria-labelledby="tab-x402">
              <pre><code><span class="k">import</span> { wrapFetchWithPaymentFromConfig } <span class="k">from</span> <span class="s">"@x402/fetch"</span>;
<span class="k">import</span> { ExactEvmScheme, toClientEvmSigner } <span class="k">from</span> <span class="s">"@x402/evm"</span>;
<span class="k">import</span> { privateKeyToAccount } <span class="k">from</span> <span class="s">"viem/accounts"</span>;
<span class="k">import</span> { createPublicClient, http } <span class="k">from</span> <span class="s">"viem"</span>;
<span class="k">import</span> { taiko } <span class="k">from</span> <span class="s">"viem/chains"</span>;

<span class="k">const</span> account = <span class="f">privateKeyToAccount</span>(<span class="s">"0x..."</span>);  <span class="c">// holds USDC on Taiko</span>
<span class="k">const</span> rpc     = <span class="f">createPublicClient</span>({ chain: taiko, transport: <span class="f">http</span>() });
<span class="k">const</span> signer  = <span class="f">toClientEvmSigner</span>(account, rpc);

<span class="k">const</span> pay = <span class="f">wrapFetchWithPaymentFromConfig</span>(fetch, {
  schemes: [{
    network: <span class="s">"eip155:<span class="n">167000</span>"</span>,   <span class="c">// Taiko</span>
    client: <span class="k">new</span> <span class="f">ExactEvmScheme</span>(signer),
  }],
});

<span class="c">// Pin a CID for 6 months. USDC on Taiko.</span>
<span class="k">const</span> res = <span class="k">await</span> <span class="f">pay</span>(<span class="s">"${o}/pins"</span>, {
  method: <span class="s">"POST"</span>,
  headers: { <span class="s">"X-Pin-Duration-Months"</span>: <span class="s">"6"</span> },
  body: <span class="f">JSON</span>.<span class="f">stringify</span>({ cid: <span class="s">"Qm..."</span> }),
});</code></pre>
            </div>

            <div class="code-pane" data-active="false" id="code-mpp" role="tabpanel" aria-labelledby="tab-mpp" hidden>
              <pre><code><span class="k">import</span> { Mppx, tempo } <span class="k">from</span> <span class="s">"mppx/client"</span>;
<span class="k">import</span> { privateKeyToAccount } <span class="k">from</span> <span class="s">"viem/accounts"</span>;

<span class="k">const</span> account = <span class="f">privateKeyToAccount</span>(<span class="s">"0x..."</span>);  <span class="c">// holds USDC.e on Tempo</span>

<span class="k">const</span> mppx = Mppx.<span class="f">create</span>({
  methods: [<span class="f">tempo</span>({ account })],   <span class="c">// Tempo <span class="n">4217</span></span>
});

<span class="c">// Same endpoint. USDC.e on Tempo.</span>
<span class="k">const</span> res = <span class="k">await</span> mppx.<span class="f">fetch</span>(<span class="s">"${o}/pins"</span>, {
  method: <span class="s">"POST"</span>,
  headers: { <span class="s">"X-Pin-Duration-Months"</span>: <span class="s">"6"</span> },
  body: <span class="f">JSON</span>.<span class="f">stringify</span>({ cid: <span class="s">"Qm..."</span> }),
});</code></pre>
            </div>

            <div class="code-pane" data-active="false" id="code-curl" role="tabpanel" aria-labelledby="tab-curl" hidden>
              <pre><code><span class="c"># Ask for the quote. Tack returns a machine-readable 402.</span>
<span class="f">curl</span> -i -X POST <span class="s">${o}/pins</span> \\
  -H <span class="s">"X-Pin-Duration-Months: 6"</span> \\
  -d <span class="s">'{"cid":"Qm..."}'</span>

<span class="c"># → HTTP/1.1 402 Payment Required
# → payment-required:   {network:"eip155:167000", asset:"USDC", amount:"0.10"}
# → WWW-Authenticate: Payment method="tempo", chainId=4217

# Sign with x402 or MPP, retry with the header. Tack pins, returns 202.</span></code></pre>
            </div>
          </div>

        </div>
      </div>
    </section>

    <section class="rails-section" aria-label="Payment rails">
      <div class="container">
        <div class="rails-head">
          <div>
            <div class="section-label" style="margin-bottom: 10px;"><span class="ord">§ 05</span><span class="sep">/</span><span>Rails</span></div>
            <div class="rails-title">Two protocols. <em>Two chains.</em> Same endpoints.</div>
          </div>
          <div class="rails-sub">your agent picks whichever its wallet already holds</div>
        </div>

        <div class="rails-pair">

          <article class="rail-card c-taiko">
            <div class="rail-card-head">
              <div class="rail-proto">x402<span style="color:var(--pink-300); font-style: italic;">.</span></div>
              <div class="rail-chain">Taiko</div>
            </div>
            <p class="rail-blurb">
              HTTP 402 + <em>EIP-3009</em>. Your agent signs a <code class="mono" style="font-size:0.92em; color:var(--ink-100);">transferWithAuthorization</code> once &mdash; a facilitator settles it. No gas needed.
            </p>
            <div class="rail-spec">
              <div class="rail-spec-row"><span class="rail-spec-k">Asset</span><span class="rail-spec-v">USDC</span></div>
              <div class="rail-spec-row"><span class="rail-spec-k">Chain</span><span class="rail-spec-v"><span class="accent">167000</span> &middot; Taiko</span></div>
              <div class="rail-spec-row"><span class="rail-spec-k">Scheme</span><span class="rail-spec-v">ExactEvm</span></div>
              <div class="rail-spec-row"><span class="rail-spec-k">Header</span><span class="rail-spec-v"><span class="accent">payment-signature</span></span></div>
            </div>
          </article>

          <article class="rail-card c-tempo">
            <div class="rail-card-head">
              <div class="rail-proto">MPP<span style="color:var(--tempo-300); font-style: italic;">.</span></div>
              <div class="rail-chain">Tempo</div>
            </div>
            <p class="rail-blurb">
              Machine Payment Protocol + <em>TIP-20</em>. Tack re-reads the on-chain <code class="mono" style="font-size:0.92em; color:var(--ink-100);">Transfer</code> event to bind the pin to the EOA that signed &mdash; not the relay.
            </p>
            <div class="rail-spec">
              <div class="rail-spec-row"><span class="rail-spec-k">Asset</span><span class="rail-spec-v">USDC.e</span></div>
              <div class="rail-spec-row"><span class="rail-spec-k">Chain</span><span class="rail-spec-v"><span class="accent">4217</span> &middot; Tempo</span></div>
              <div class="rail-spec-row"><span class="rail-spec-k">Scheme</span><span class="rail-spec-v">TIP-20 Transfer</span></div>
              <div class="rail-spec-row"><span class="rail-spec-k">Header</span><span class="rail-spec-v"><span class="accent">Authorization: Payment</span></span></div>
            </div>
          </article>

        </div>
      </div>
    </section>

    <section id="pricing" class="rule-top">
      <div class="container">
        <div class="section-head">
          <div class="section-label"><span class="ord">§ 06</span><span class="sep">/</span><span>Pricing</span></div>
          <h2 class="section-title">
            Pay per <em>pin</em><span class="dot">.</span>
          </h2>
          <p class="section-sub">
            No plans. No minimums. The slider below is the real formula &mdash; try it.
          </p>
        </div>

        <div class="price-wrap">

          <div class="price-left">
            <div class="price-eyebrow">→ Live quote</div>
            <div class="price-live" aria-live="polite">
              <span class="currency">$</span><span id="price-out">0.293</span>
            </div>
            <div class="price-sub">
              <span class="price-sub-val" id="price-summary">500 MB · 6 months</span>
              &nbsp;·&nbsp;settled on-chain
            </div>

            <div class="slider-group">
              <div class="slider-row">
                <span class="slider-label">Size</span>
                <span class="slider-val" id="size-val">500<span class="unit">&nbsp;MB</span></span>
              </div>
              <input type="range" class="tick-slider" id="size-slider" min="0" max="1000" value="539" aria-label="Storage size" />
            </div>

            <div class="slider-group" style="margin-bottom: 0;">
              <div class="slider-row">
                <span class="slider-label">Duration</span>
                <span class="slider-val" id="month-val">6<span class="unit">&nbsp;months</span></span>
              </div>
              <input type="range" class="tick-slider" id="month-slider" min="1" max="24" value="6" aria-label="Duration in months" />
            </div>

            <div class="price-compare">
              <div class="price-compare-label">vs &middot; Pinata&rsquo;s x402 offer</div>

              <div class="price-kicker">
                <div class="kicker-headline">
                  Pay for <strong>1 month</strong>, not <strong>12</strong>.
                </div>
                <div class="kicker-big">
                  12&times; cheaper<sup>*</sup>
                  <span class="big-sub">for a short pin on Tack vs Pinata&rsquo;s 12&#8209;month lock-in.</span>
                </div>
              </div>

              <table class="price-compare-table">
                <thead>
                  <tr>
                    <th></th>
                    <th class="c-legacy">Pinata x402<small>open-source demo</small></th>
                    <th class="c-tack">Tack<small>live in production</small></th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="price-row">
                    <td>Price &middot; 1&nbsp;GB &middot; 1&nbsp;mo</td>
                    <td class="c-legacy">$1.20</td>
                    <td class="c-tack">$0.10<span class="save-badge">12&times; cheaper</span></td>
                  </tr>
                  <tr class="highlight">
                    <td>Duration</td>
                    <td class="c-legacy">Fixed <span style="color:var(--ink-300);">12 months</span></td>
                    <td class="c-tack"><span class="accent">1&ndash;24 months</span> (you pick)</td>
                  </tr>
                  <tr>
                    <td>Chains</td>
                    <td class="c-legacy">Base</td>
                    <td class="c-tack">Taiko &middot; Tempo</td>
                  </tr>
                  <tr>
                    <td>Payment protocols</td>
                    <td class="c-legacy">x402</td>
                    <td class="c-tack">x402 &middot; MPP</td>
                  </tr>
                  <tr>
                    <td>IPFS Pinning Service API</td>
                    <td class="c-legacy dash">&mdash;</td>
                    <td class="c-tack"><span class="accent">&#10003;</span></td>
                  </tr>
                  <tr>
                    <td>A2A agent card</td>
                    <td class="c-legacy dash">&mdash;</td>
                    <td class="c-tack"><span class="accent">&#10003;</span></td>
                  </tr>
                </tbody>
              </table>
              <div class="price-compare-foot">
                <sup>*</sup> Same $0.10 / GB&middot;month rate. Pinata&rsquo;s <a href="https://pinata.cloud/blog/pay-to-pin-on-ipfs-with-x402" target="_blank" rel="noopener" style="color:var(--pink-200);border-bottom:1px dashed currentColor;">demo</a> locks every pin to 12 months; Tack lets you pick 1&ndash;24. At 3&nbsp;mo it&rsquo;s 4&times; cheaper, 6&nbsp;mo 2&times;, 12&nbsp;mo the same.
              </div>
            </div>
          </div>

          <div class="price-right">
            <h3>Built-in</h3>
            <ul class="price-facts">
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Settled in <code>USDC</code> on Taiko or <code>USDC.e</code> on Tempo.</span>
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Retrieval is free. Paywalls are opt-in, per CID.</span>
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Pins auto-expire. No recurring charges.</span>
              </li>
              <li>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Owner ops &mdash; list, replace, delete &mdash; don&rsquo;t re-charge.</span>
              </li>
            </ul>

            <details class="price-formula">
              <summary>How it&rsquo;s calculated</summary>
              <div class="formula-body">
                <code>price = clamp(sizeGB × $0.10 × months, $0.001, $50)</code>
                <br/><br/>
                Size is binary (1&nbsp;GB = 1,073,741,824 bytes). Duration is 1&ndash;24 months, set with <code style="background:transparent;border:0;padding:0;color:var(--pink-200);">X-Pin-Duration-Months</code>. Settlement rounds up to the next asset unit.
              </div>
            </details>
          </div>

        </div>
      </div>
    </section>

    <section id="api" class="rule-top">
      <div class="container">
        <div class="section-head">
          <div class="section-label"><span class="ord">§ 07</span><span class="sep">/</span><span>API</span></div>
          <h2 class="section-title">
            Standard <em>spec</em><span class="dot">.</span>
          </h2>
          <p class="section-sub">
            IPFS Pinning Service API spec, plus <code class="mono" style="font-size:0.92em;">/upload</code>, a gateway with optional paywalls, and an A2A agent card.
          </p>
        </div>

        <div class="api-grid">
          <div class="api-row">
            <span class="api-method method-post">POST</span>
            <div class="api-body">
              <div class="api-path">/pins</div>
              <div class="api-desc">Pin a CID. 402 with price → sign → retry.</div>
              <span class="api-tag pay">x402 · MPP</span>
            </div>
          </div>
          <div class="api-row">
            <span class="api-method method-post">POST</span>
            <div class="api-body">
              <div class="api-path">/upload</div>
              <div class="api-desc">Upload bytes (up to 100 MB) and pin in one request.</div>
              <span class="api-tag pay">x402 · MPP</span>
            </div>
          </div>
          <div class="api-row">
            <span class="api-method method-get">GET</span>
            <div class="api-body">
              <div class="api-path">/pins</div>
              <div class="api-desc">List pins your wallet owns.</div>
              <span class="api-tag auth">bearer</span>
            </div>
          </div>
          <div class="api-row">
            <span class="api-method method-get">GET</span>
            <div class="api-body">
              <div class="api-path">/pins/:requestid</div>
              <div class="api-desc">Status for a specific pin request.</div>
              <span class="api-tag auth">bearer</span>
            </div>
          </div>
          <div class="api-row">
            <span class="api-method method-post">POST</span>
            <div class="api-body">
              <div class="api-path">/pins/:requestid</div>
              <div class="api-desc">Replace a pin, keep the request id.</div>
              <span class="api-tag auth">bearer</span>
            </div>
          </div>
          <div class="api-row">
            <span class="api-method method-delete">DELETE</span>
            <div class="api-body">
              <div class="api-path">/pins/:requestid</div>
              <div class="api-desc">Unpin content your wallet owns.</div>
              <span class="api-tag auth">bearer</span>
            </div>
          </div>
          <div class="api-row">
            <span class="api-method method-get">GET</span>
            <div class="api-body">
              <div class="api-path">/ipfs/:cid</div>
              <div class="api-desc">Retrieve content. Ranges, ETags, optional paywall.</div>
              <span class="api-tag open">public</span>
            </div>
          </div>
          <div class="api-row">
            <span class="api-method method-get">GET</span>
            <div class="api-body">
              <div class="api-path">/.well-known/agent.json</div>
              <div class="api-desc">A2A agent card. Machines discover, verify, pay.</div>
              <span class="api-tag open">public</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="cta" class="rule-top">
      <div class="container">
        <div class="final-cta">
          <h2>
            Give your agent a place to <em>keep&nbsp;things</em><span class="dot">.</span>
          </h2>
          <p class="sub">
            One endpoint away.
          </p>
          <div class="btns">
            <button class="btn-endpoint" data-copy="${o}" aria-label="Copy endpoint">
              <span class="btn-verb">GET</span>
              <span class="btn-url">${o}</span>
              <span class="btn-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </span>
            </button>
            <a href="${o}/.well-known/agent.json" class="btn-ghost" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="15 3 21 3 21 9"/>
                <polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/>
                <line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
              Agent card
            </a>
          </div>

          <div class="trust" aria-label="Ecosystem">
            <div class="trust-item"><span class="trust-dot taiko" aria-hidden="true"></span><strong>Taiko</strong> <span class="num">167000</span></div>
            <div class="trust-item"><span class="trust-dot tempo" aria-hidden="true"></span><strong>Tempo</strong> <span class="num">4217</span></div>
            <div class="trust-item"><span class="trust-dot ipfs" aria-hidden="true"></span><strong>IPFS</strong> Kubo</div>
            <div class="trust-item"><span class="trust-dot a2a" aria-hidden="true"></span><strong>A2A</strong> agent card</div>
          </div>
        </div>
      </div>
    </section>

  </main>

  <footer>
    <div class="container footer-inner">
      <a class="logo" href="#top" aria-label="Tack home">
        <span class="slash">/</span><span>tack</span>
      </a>
      <div class="footer-links">
        <a href="${o}/health">status</a>
        <a href="${o}/.well-known/agent.json" target="_blank" rel="noopener">agent card</a>
        <a href="https://www.x402.org/" target="_blank" rel="noopener">x402</a>
        <a href="https://mpp.dev/" target="_blank" rel="noopener">mpp</a>
      </div>
      <div class="footer-tag">a place for your agent to keep things</div>
    </div>
  </footer>

  <script>
  (function () {
    // Copy-to-clipboard
    var copyBtns = document.querySelectorAll('[data-copy]');
    copyBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var value = btn.getAttribute('data-copy');
        var label = btn.querySelector('.copy-btn-label');
        var originalLabel = label ? label.textContent : '';
        var finish = function () {
          btn.classList.add('copied');
          if (label) label.textContent = 'Copied';
          setTimeout(function () {
            btn.classList.remove('copied');
            if (label) label.textContent = originalLabel;
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(finish, fallback);
        } else { fallback(); }
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = value; ta.setAttribute('readonly', '');
          ta.style.position = 'fixed'; ta.style.top = '-9999px';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); finish(); } catch (e) { /* noop */ }
          document.body.removeChild(ta);
        }
      });
    });

    // Code tabs
    var tabs = document.querySelectorAll('[role="tab"][data-tab]');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-tab');
        tabs.forEach(function (t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
        document.querySelectorAll('.code-pane').forEach(function (p) {
          var isMatch = p.id === 'code-' + key;
          p.setAttribute('data-active', isMatch ? 'true' : 'false');
          if (isMatch) { p.removeAttribute('hidden'); } else { p.setAttribute('hidden', ''); }
        });
      });
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var list = Array.prototype.slice.call(tabs);
        var idx = list.indexOf(tab);
        var next = e.key === 'ArrowRight' ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length;
        list[next].focus(); list[next].click();
      });
    });

    // Pricing slider. Size is log-mapped over [1 MB, 100 GB]; duration linear [1, 24].
    // Formula mirrors calculatePriceUsd(): clamp(sizeGB × 0.10 × months, 0.001, 50).
    // sizeGB = sizeMB / 1024 (binary GiB, same as server).
    var sizeSlider  = document.getElementById('size-slider');
    var monthSlider = document.getElementById('month-slider');
    var sizeVal     = document.getElementById('size-val');
    var monthVal    = document.getElementById('month-val');
    var priceOut    = document.getElementById('price-out');
    var priceSum    = document.getElementById('price-summary');

    if (sizeSlider && monthSlider && priceOut) {
      var MB_MIN = 1;        // 1 MB
      var MB_MAX = 100 * 1024; // 100 GB
      var LOG_MIN = Math.log10(MB_MIN);
      var LOG_MAX = Math.log10(MB_MAX);

      function sliderToMB(v) {
        var t = v / 1000;
        return Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
      }
      function niceMB(mb) {
        // Snap sizes so the display and computed price agree to the rendered precision.
        if (mb < 10) return Math.max(1, Math.round(mb));
        if (mb < 100) return Math.round(mb / 5) * 5;
        if (mb < 1024) return Math.round(mb / 10) * 10;
        // GB territory: snap to 0.5 GB (512 MB) up to 10 GB, then to 1 GB increments.
        if (mb < 10 * 1024) return Math.round(mb / 512) * 512;
        return Math.round(mb / 1024) * 1024;
      }
      function formatSize(mb) {
        if (mb < 1024) return { n: String(mb), u: 'MB' };
        var gb = mb / 1024;
        if (gb < 10) return { n: gb.toFixed(1).replace(/\\.0$/, ''), u: 'GB' };
        return { n: String(Math.round(gb)), u: 'GB' };
      }
      function formatPrice(usd) {
        if (usd <= 0.001)  return '0.001';
        if (usd < 0.01)    return usd.toFixed(4).replace(/0+$/, '').replace(/\\.$/, '');
        if (usd < 1)       return usd.toFixed(3).replace(/0+$/, '').replace(/\\.$/, '');
        if (usd < 100)     return usd.toFixed(2);
        return String(Math.round(usd));
      }
      function calcPrice(sizeMB, months) {
        var gb = sizeMB / 1024;
        var raw = gb * 0.10 * months;
        return Math.min(Math.max(raw, 0.001), 50);
      }

      function update() {
        var rawMB = sliderToMB(parseFloat(sizeSlider.value));
        var mb = niceMB(rawMB);
        var months = parseInt(monthSlider.value, 10);
        var sz = formatSize(mb);
        sizeVal.innerHTML = sz.n + '<span class="unit">&nbsp;' + sz.u + '</span>';
        monthVal.innerHTML = months + '<span class="unit">&nbsp;' + (months === 1 ? 'month' : 'months') + '</span>';
        priceOut.textContent = formatPrice(calcPrice(mb, months));
        priceSum.textContent = sz.n + ' ' + sz.u + ' · ' + months + ' ' + (months === 1 ? 'month' : 'months');
      }

      sizeSlider.addEventListener('input', update);
      monthSlider.addEventListener('input', update);
      update();
    }
  })();
  </script>

</body>
</html>`;
}
