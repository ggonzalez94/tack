const PROD_URL = process.env.LANDING_URL ?? 'https://tack.taiko.xyz';

export function landingPageHtml(): string {
  const o = PROD_URL;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tack — Agent-native IPFS. Pay on Taiko or Tempo.</title>
  <meta name="description" content="IPFS pinning and retrieval for AI agents. No API keys, no accounts. Pay per use with USDC on Taiko (x402) or USDC.e on Tempo (MPP)." />
  <meta name="theme-color" content="#050912" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="Tack — Agent-native IPFS. Pay on Taiko or Tempo." />
  <meta property="og:description" content="IPFS pinning and retrieval for AI agents. No API keys, no accounts. Pay per use with USDC on Taiko (x402) or USDC.e on Tempo (MPP)." />
  <meta property="og:url" content="${o}" />
  <meta property="og:site_name" content="Tack" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Tack — Agent-native IPFS. Pay on Taiko or Tempo." />
  <meta name="twitter:description" content="No API keys, no accounts. Your AI agent pays per pin in USDC — x402 on Taiko or MPP on Tempo." />

  <style>
    :root {
      --taiko-200: #ff6fc8;
      --taiko-300: #e81899;
      --taiko-400: #c8047d;

      --tempo-200: #a78bfa;
      --tempo-300: #7c3aed;
      --tempo-400: #5b21b6;

      --surface-0: #050912;
      --surface-50: #0b101b;
      --surface-100: #191e28;
      --surface-200: #2b303b;
      --surface-400: #5d636f;
      --surface-500: #767c89;
      --surface-600: #91969f;
      --surface-700: #adb1b8;
      --surface-900: #f3f3f3;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
    ::selection { background-color: var(--taiko-300); color: white; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--surface-0);
      color: var(--surface-900);
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }

    code, .mono { font-family: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace; }

    a { color: inherit; text-decoration: none; }
    button { font-family: inherit; }
    :focus-visible { outline: 2px solid var(--taiko-200); outline-offset: 2px; border-radius: 6px; }

    .container { max-width: 1152px; margin: 0 auto; padding: 0 24px; }

    /* ── Nav ── */
    nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 50;
      background: rgba(5, 9, 18, 0.8);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--surface-200);
    }
    .nav-inner {
      display: flex; align-items: center; justify-content: space-between;
      height: 64px;
    }
    .logo {
      display: flex; align-items: center; gap: 10px;
      font-weight: 700; font-size: 18px;
    }
    .logo-icon {
      width: 32px; height: 32px; border-radius: 8px;
      background: var(--taiko-300);
      display: flex; align-items: center; justify-content: center;
    }
    .logo-icon svg { width: 18px; height: 18px; }
    .nav-links { display: flex; align-items: center; gap: 28px; }
    .nav-links a {
      font-size: 14px; color: var(--surface-600);
      transition: color 0.2s;
    }
    .nav-links a:hover { color: var(--surface-900); }
    .nav-cta {
      font-size: 14px; font-weight: 600;
      padding: 8px 18px; border-radius: 8px;
      background: var(--taiko-300); color: white !important;
      transition: background 0.2s, box-shadow 0.2s;
    }
    .nav-cta:hover { background: var(--taiko-400); }

    @media (max-width: 820px) {
      .nav-links a:not(.nav-cta) { display: none; }
    }

    /* ── Hero ── */
    .hero {
      position: relative; overflow: hidden;
      padding: 160px 0 100px;
      text-align: center;
    }
    .hero-glow {
      position: absolute; top: -240px; left: 50%; transform: translateX(-50%);
      width: 900px; height: 600px; border-radius: 50%;
      background:
        radial-gradient(ellipse at 30% 50%, rgba(232, 24, 153, 0.12), transparent 60%),
        radial-gradient(ellipse at 70% 50%, rgba(124, 58, 237, 0.12), transparent 60%);
      pointer-events: none;
      filter: blur(20px);
    }
    .hero-content { position: relative; z-index: 1; }

    .badge {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 6px 14px 6px 10px; border-radius: 9999px;
      background: var(--surface-100);
      border: 1px solid var(--surface-200);
      font-size: 13px; font-weight: 500; color: var(--surface-700);
      margin-bottom: 32px;
    }
    .badge-dots { display: inline-flex; gap: 4px; }
    .badge-dot {
      width: 6px; height: 6px; border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }
    .badge-dot.taiko { background: var(--taiko-300); }
    .badge-dot.tempo { background: var(--tempo-300); animation-delay: 0.6s; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }

    h1 {
      font-size: clamp(2.5rem, 6vw, 3.75rem);
      font-weight: 700; line-height: 1.08;
      letter-spacing: -0.03em;
      margin-bottom: 20px;
    }
    .gradient-text {
      background: linear-gradient(120deg, var(--taiko-200) 0%, var(--taiko-300) 50%, var(--tempo-300) 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-sub {
      font-size: clamp(1.05rem, 2vw, 1.2rem);
      color: var(--surface-600); max-width: 620px;
      margin: 0 auto 36px;
    }

    .hero-buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 8px; }
    .btn-primary {
      padding: 14px 26px; border-radius: 10px;
      background: var(--taiko-300); color: white;
      font-weight: 600; font-size: 15px;
      border: none; cursor: pointer;
      display: inline-flex; align-items: center; gap: 8px;
      transition: background 0.2s, box-shadow 0.2s, transform 0.1s;
      box-shadow: 0 0 24px rgba(232, 24, 153, 0.25);
    }
    .btn-primary:hover { background: var(--taiko-400); }
    .btn-primary:active { transform: translateY(1px); }
    .btn-primary svg { width: 16px; height: 16px; }
    .btn-secondary {
      padding: 14px 26px; border-radius: 10px;
      background: var(--surface-100); color: var(--surface-900);
      font-weight: 600; font-size: 15px;
      border: 1px solid var(--surface-200);
      cursor: pointer; transition: border-color 0.2s, background 0.2s;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .btn-secondary:hover { border-color: var(--surface-400); background: var(--surface-50); }
    .btn-secondary svg { width: 15px; height: 15px; }

    .hero-tagline {
      font-size: 13px; color: var(--surface-500);
      margin-top: 20px;
    }
    .hero-tagline .mono { color: var(--surface-700); }

    .stats {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 1px; margin-top: 56px;
      border: 1px solid var(--surface-200); border-radius: 14px;
      overflow: hidden; max-width: 640px; margin-left: auto; margin-right: auto;
      background: var(--surface-200);
    }
    .stat { padding: 22px 16px; background: var(--surface-50); text-align: center; }
    .stat-value { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
    .stat-label { font-size: 12px; color: var(--surface-500); margin-top: 4px; line-height: 1.4; }
    .stat-value .mono-unit { font-size: 16px; font-weight: 600; color: var(--surface-500); margin-left: 2px; }

    /* ── Sections ── */
    section { padding: 96px 0; scroll-margin-top: 72px; }
    section + section { border-top: 1px solid var(--surface-100); }

    .section-head { margin-bottom: 48px; }
    .section-head-center { text-align: center; max-width: 640px; margin: 0 auto 48px; }
    .section-label {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.12em; color: var(--taiko-300);
      margin-bottom: 12px;
    }
    .section-title {
      font-size: clamp(1.75rem, 4vw, 2.25rem);
      font-weight: 700; letter-spacing: -0.02em;
      margin-bottom: 16px;
    }
    .section-sub {
      font-size: 16px; color: var(--surface-500);
      max-width: 560px;
    }
    .section-head-center .section-sub { margin-left: auto; margin-right: auto; }

    /* ── Steps ── */
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .step {
      padding: 28px; border-radius: 16px;
      border: 1px solid var(--surface-200);
      background: var(--surface-50);
      transition: border-color 0.2s, transform 0.2s;
    }
    .step:hover { border-color: rgba(232, 24, 153, 0.3); transform: translateY(-2px); }
    .step-number { font-size: 12px; font-weight: 600; color: var(--surface-400); margin-bottom: 16px; letter-spacing: 0.08em; }
    .step-icon {
      width: 44px; height: 44px; border-radius: 12px;
      background: rgba(232, 24, 153, 0.1);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 16px;
    }
    .step-icon svg { width: 22px; height: 22px; color: var(--taiko-300); }
    .step h3 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .step p { font-size: 14px; color: var(--surface-500); line-height: 1.6; }
    .step-meta {
      margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap;
    }
    .step-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 8px; border-radius: 6px;
      font-size: 11px; font-weight: 500; letter-spacing: 0.01em;
      background: var(--surface-100); color: var(--surface-600);
      border: 1px solid var(--surface-200);
    }
    .step-chip-dot { width: 6px; height: 6px; border-radius: 50%; }
    .step-chip-dot.taiko { background: var(--taiko-300); }
    .step-chip-dot.tempo { background: var(--tempo-300); }

    /* ── Rails ── */
    .rails { display: grid; grid-template-columns: 1fr; gap: 20px; }
    @media (min-width: 820px) { .rails { grid-template-columns: 1fr 1fr; } }
    .rail {
      position: relative; overflow: hidden;
      padding: 32px; border-radius: 20px;
      border: 1px solid var(--surface-200);
      background: var(--surface-50);
      transition: border-color 0.2s, transform 0.2s;
    }
    .rail::before {
      content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
      background: var(--_rail-color);
    }
    .rail.taiko { --_rail-color: var(--taiko-300); }
    .rail.tempo { --_rail-color: var(--tempo-300); }
    .rail:hover { border-color: var(--_rail-color); transform: translateY(-2px); }
    .rail-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .rail-protocol {
      display: inline-flex; align-items: center; gap: 10px;
      font-size: 18px; font-weight: 700; letter-spacing: -0.01em;
    }
    .rail-badge {
      font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px;
      background: color-mix(in oklab, var(--_rail-color) 20%, transparent);
      color: var(--_rail-color);
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .rail-pitch {
      font-size: 14px; color: var(--surface-600); line-height: 1.6;
      margin-bottom: 24px;
    }
    .rail-meta {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      padding-top: 20px; border-top: 1px solid var(--surface-200);
    }
    .rail-meta-item { min-width: 0; }
    .rail-meta-label {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--surface-400);
      margin-bottom: 4px;
    }
    .rail-meta-value { font-size: 13px; color: var(--surface-700); font-weight: 500; }
    .rail-meta-value.mono { font-size: 12px; }

    /* ── API ── */
    .api-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
    .api-card {
      padding: 22px; border-radius: 12px;
      border: 1px solid var(--surface-200);
      background: var(--surface-50);
      transition: border-color 0.2s;
    }
    .api-card:hover { border-color: rgba(232, 24, 153, 0.3); }
    .api-method {
      display: inline-block; padding: 3px 8px; border-radius: 6px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
      margin-bottom: 10px;
    }
    .method-get { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .method-post { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .method-delete { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .api-path { font-size: 15px; font-weight: 600; margin-bottom: 6px; word-break: break-all; }
    .api-desc { font-size: 13px; color: var(--surface-500); line-height: 1.55; }
    .api-tags { margin-top: 12px; display: flex; gap: 6px; flex-wrap: wrap; }
    .api-tag {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 8px; border-radius: 6px;
      font-size: 11px; font-weight: 500;
      background: var(--surface-100); color: var(--surface-600);
      border: 1px solid var(--surface-200);
    }
    .api-tag-dot { width: 5px; height: 5px; border-radius: 50%; }
    .api-tag.pay { background: rgba(232, 24, 153, 0.08); color: var(--taiko-200); border-color: rgba(232, 24, 153, 0.25); }
    .api-tag.pay .api-tag-dot { background: linear-gradient(90deg, var(--taiko-300), var(--tempo-300)); }
    .api-tag.auth .api-tag-dot { background: var(--surface-600); }

    /* ── Pricing ── */
    .pricing-card {
      max-width: 460px; margin: 0 auto;
      padding: 40px; border-radius: 18px;
      border: 1px solid var(--surface-200);
      background: linear-gradient(180deg, var(--surface-50) 0%, var(--surface-0) 100%);
      position: relative; overflow: hidden;
    }
    .pricing-card::after {
      content: ''; position: absolute; inset: -1px; border-radius: 18px;
      padding: 1px;
      background: linear-gradient(135deg, rgba(232, 24, 153, 0.4), transparent 40%, rgba(124, 58, 237, 0.3));
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor; mask-composite: exclude;
      pointer-events: none;
    }
    .pricing-label {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.12em; color: var(--taiko-300);
      margin-bottom: 12px;
    }
    .pricing-value { font-size: 52px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
    .pricing-unit { font-size: 14px; color: var(--surface-500); margin-top: 10px; margin-bottom: 28px; }
    .pricing-formula {
      display: inline-block; margin-bottom: 32px;
      padding: 8px 14px; border-radius: 10px;
      background: var(--surface-100);
      border: 1px solid var(--surface-200);
      font-size: 12px;
    }
    .pricing-formula .mono { color: var(--surface-900); }
    .pricing-features { list-style: none; margin-bottom: 28px; }
    .pricing-features li {
      display: flex; align-items: flex-start; gap: 10px;
      font-size: 14px; color: var(--surface-700);
      padding: 7px 0;
    }
    .pricing-features li svg {
      width: 16px; height: 16px; color: var(--taiko-200);
      flex-shrink: 0; margin-top: 4px;
    }
    .pricing-features li > span { flex: 1; min-width: 0; }
    .pricing-features li code {
      display: inline-block; padding: 1px 6px; border-radius: 5px;
      background: var(--surface-100); border: 1px solid var(--surface-200);
      font-size: 12px; color: var(--surface-900);
    }

    /* ── Integrate ── */
    .endpoint-box {
      border-radius: 16px;
      border: 1px solid rgba(232, 24, 153, 0.3);
      background: var(--surface-50);
      padding: 22px 24px;
      box-shadow: 0 4px 24px rgba(232, 24, 153, 0.05);
      max-width: 680px; margin: 0 auto;
    }
    .endpoint-label {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.12em; color: var(--surface-400);
      margin-bottom: 12px;
    }
    .endpoint-row {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 14px; border-radius: 10px;
      background: var(--surface-0);
      border: 1px solid var(--surface-200);
    }
    .endpoint-url {
      flex: 1; font-size: 16px; word-break: break-all;
      color: var(--surface-900);
    }
    .copy-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 12px; border-radius: 8px;
      background: var(--surface-100); color: var(--surface-900);
      border: 1px solid var(--surface-200);
      font-size: 12px; font-weight: 600;
      cursor: pointer; transition: background 0.2s, border-color 0.2s, color 0.2s;
      flex-shrink: 0;
    }
    .copy-btn:hover { background: var(--surface-200); border-color: var(--surface-400); }
    .copy-btn.copied { background: rgba(34, 197, 94, 0.15); color: #22c55e; border-color: rgba(34, 197, 94, 0.35); }
    .copy-btn svg { width: 13px; height: 13px; }
    .endpoint-note { font-size: 13px; color: var(--surface-400); margin-top: 14px; }

    .checklist {
      display: flex; flex-wrap: wrap; gap: 10px 28px;
      justify-content: center; margin-top: 28px;
    }
    .checklist-item {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; color: var(--surface-500);
    }
    .checklist-icon {
      width: 16px; height: 16px; border-radius: 50%;
      background: rgba(232, 24, 153, 0.15);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .checklist-icon svg { width: 10px; height: 10px; color: var(--taiko-200); }

    .code-grid { display: grid; grid-template-columns: 1fr; gap: 32px; margin-top: 48px; max-width: 960px; margin-left: auto; margin-right: auto; }
    @media (min-width: 900px) { .code-grid { grid-template-columns: 1fr 1.6fr; } }
    .code-details h3 { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
    .code-details p { font-size: 14px; color: var(--surface-500); line-height: 1.6; margin-bottom: 22px; }
    .code-detail-item { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--surface-100); }
    .code-detail-item:last-child { border-bottom: none; }
    .code-detail-label { font-size: 10px; font-weight: 600; color: var(--surface-400); text-transform: uppercase; letter-spacing: 0.1em; }
    .code-detail-value { font-size: 13px; color: var(--surface-700); margin-top: 6px; word-break: break-all; }
    .code-detail-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .chain-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 8px; border-radius: 6px;
      font-size: 12px; font-weight: 500;
      background: var(--surface-100);
      border: 1px solid var(--surface-200);
      color: var(--surface-700);
    }
    .chain-pill-dot { width: 6px; height: 6px; border-radius: 50%; }
    .chain-pill-dot.taiko { background: var(--taiko-300); }
    .chain-pill-dot.tempo { background: var(--tempo-300); }

    .code-block {
      border-radius: 16px; border: 1px solid var(--surface-200);
      background: var(--surface-50); overflow: hidden;
    }
    .code-chrome {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; border-bottom: 1px solid var(--surface-200);
      background: var(--surface-50);
    }
    .code-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--surface-200); }
    .code-tabs { display: flex; margin-left: 16px; gap: 2px; flex: 1; }
    .code-tab {
      padding: 6px 12px; border-radius: 7px;
      background: transparent; border: 1px solid transparent;
      color: var(--surface-500); font-size: 12px; font-weight: 500;
      cursor: pointer; transition: all 0.15s;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .code-tab:hover { color: var(--surface-900); }
    .code-tab[aria-selected="true"] {
      background: var(--surface-100);
      border-color: var(--surface-200);
      color: var(--surface-900);
    }
    .code-tab-dot { width: 6px; height: 6px; border-radius: 50%; }
    .code-tab-dot.taiko { background: var(--taiko-300); }
    .code-tab-dot.tempo { background: var(--tempo-300); }
    .code-filename { font-size: 12px; font-weight: 500; color: var(--surface-400); }
    .code-pane { display: none; }
    .code-pane[data-active="true"] { display: block; }
    .code-block pre {
      padding: 22px; overflow-x: auto;
      font-size: 13px; line-height: 1.7; color: var(--surface-700);
    }
    .code-block pre .k { color: #c084fc; }
    .code-block pre .s { color: #86efac; }
    .code-block pre .c { color: var(--surface-500); font-style: italic; }
    .code-block pre .f { color: #93c5fd; }

    .cta-buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 40px; }

    /* ── Trust strip ── */
    .trust {
      display: flex; flex-wrap: wrap; justify-content: center;
      gap: 14px 28px; padding: 36px 0 0;
      border-top: 1px solid var(--surface-100);
      margin-top: 72px;
    }
    .trust-item {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 12px; color: var(--surface-500);
      font-weight: 500; letter-spacing: 0.02em;
    }
    .trust-item .mono { color: var(--surface-600); font-size: 11px; }
    .trust-dot { width: 7px; height: 7px; border-radius: 50%; }
    .trust-dot.taiko { background: var(--taiko-300); box-shadow: 0 0 6px rgba(232, 24, 153, 0.5); }
    .trust-dot.tempo { background: var(--tempo-300); box-shadow: 0 0 6px rgba(124, 58, 237, 0.5); }
    .trust-dot.ipfs { background: #65c2cb; box-shadow: 0 0 6px rgba(101, 194, 203, 0.5); }
    .trust-dot.a2a { background: #f59e0b; box-shadow: 0 0 6px rgba(245, 158, 11, 0.5); }

    /* ── Footer ── */
    footer { padding: 40px 0 48px; border-top: 1px solid var(--surface-100); }
    .footer-inner {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }
    @media (min-width: 720px) {
      .footer-inner { grid-template-columns: 1fr auto 1fr; align-items: center; }
    }
    .footer-left { display: flex; align-items: center; gap: 10px; }
    .footer-icon {
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--taiko-300);
      display: flex; align-items: center; justify-content: center;
    }
    .footer-icon svg { width: 14px; height: 14px; }
    .footer-links { display: flex; gap: 24px; flex-wrap: wrap; justify-content: center; }
    .footer-links a { font-size: 13px; color: var(--surface-500); transition: color 0.2s; }
    .footer-links a:hover { color: var(--surface-900); }
    .footer-tagline {
      font-size: 12px; color: var(--surface-400);
      text-align: right;
    }
    @media (max-width: 720px) {
      .footer-tagline, .footer-left { text-align: center; justify-content: center; }
    }
  </style>
</head>
<body>

  <nav aria-label="Primary">
    <div class="container nav-inner">
      <a class="logo" href="#top" aria-label="Tack home">
        <span class="logo-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.29 7 12 12 20.71 7"/>
            <line x1="12" y1="22" x2="12" y2="12"/>
          </svg>
        </span>
        Tack
      </a>
      <div class="nav-links">
        <a href="#how-it-works">How it works</a>
        <a href="#rails">Payment rails</a>
        <a href="#api">API</a>
        <a href="#pricing">Pricing</a>
        <a href="#integrate" class="nav-cta">Use with your agent</a>
      </div>
    </div>
  </nav>

  <section class="hero" id="top">
    <div class="hero-glow" aria-hidden="true"></div>
    <div class="container hero-content">
      <div class="badge" role="status">
        <span class="badge-dots" aria-hidden="true">
          <span class="badge-dot taiko"></span>
          <span class="badge-dot tempo"></span>
        </span>
        Live on Taiko Alethia &amp; Tempo
      </div>
      <h1>
        Agent-native IPFS.<br/>
        <span class="gradient-text">Pay on Taiko or Tempo.</span>
      </h1>
      <p class="hero-sub">
        Let your AI agents pin and retrieve content on IPFS. No API keys, no accounts. Pay per use in USDC via <strong style="color:var(--surface-900);white-space:nowrap;">x402 on Taiko</strong> or USDC.e via <strong style="color:var(--surface-900);white-space:nowrap;">MPP on Tempo</strong> &mdash; same endpoints, pick your rail.
      </p>
      <div class="hero-buttons">
        <button class="btn-primary copy-btn" data-copy="${o}" aria-label="Copy API endpoint to clipboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span class="copy-btn-label">Copy endpoint</span>
        </button>
        <a href="#how-it-works" class="btn-secondary">
          See how it works
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </a>
      </div>
      <div class="hero-tagline">
        Drop <code class="mono">${o}</code> into any x402 or MPP client.
      </div>
      <div class="stats" aria-label="Key service stats">
        <div class="stat">
          <div class="stat-value">$0.10<span class="mono-unit">/GB/mo</span></div>
          <div class="stat-label">Linear &middot; $0.001 min</div>
        </div>
        <div class="stat">
          <div class="stat-value">2</div>
          <div class="stat-label">Chains &middot; 2 payment rails</div>
        </div>
        <div class="stat">
          <div class="stat-value">0</div>
          <div class="stat-label">Signups &middot; API keys</div>
        </div>
      </div>
    </div>
  </section>

  <section id="how-it-works">
    <div class="container">
      <div class="section-head">
        <div class="section-label">How it works</div>
        <div class="section-title">Three steps. No accounts.</div>
        <div class="section-sub">
          The wallet that pays owns the pin. Tack speaks two HTTP-native payment protocols &mdash; x402 on Taiko and MPP on Tempo &mdash; so your agent can use whichever rail its wallet already holds.
        </div>
      </div>
      <div class="steps">
        <div class="step">
          <div class="step-number">01</div>
          <div class="step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <h3>Pin or upload</h3>
          <p>Send a CID to pin, or upload a file directly. The first call returns HTTP 402 with a machine-readable payment challenge &mdash; for both rails at once.</p>
        </div>
        <div class="step">
          <div class="step-number">02</div>
          <div class="step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <h3>Pay on your rail</h3>
          <p>Your client signs once &mdash; either a USDC authorization on Taiko (x402) or a USDC.e spend on Tempo (MPP). Tack settles the payment on-chain.</p>
          <div class="step-meta" aria-label="Supported rails">
            <span class="step-chip"><span class="step-chip-dot taiko"></span>x402 &middot; Taiko</span>
            <span class="step-chip"><span class="step-chip-dot tempo"></span>MPP &middot; Tempo</span>
          </div>
        </div>
        <div class="step">
          <div class="step-number">03</div>
          <div class="step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h3>Pinned &amp; owned</h3>
          <p>Your content is pinned and retrievable via the gateway. The response returns a short-lived wallet auth token so you can list, replace, or delete your pins without re-paying.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="rails">
    <div class="container">
      <div class="section-head-center">
        <div class="section-label">Payment rails</div>
        <div class="section-title">One API. Two rails.</div>
        <div class="section-sub">
          Same endpoints serve both protocols. Protocol detection is header-based &mdash; your agent picks the one matching its wallet and chain.
        </div>
      </div>

      <div class="rails">
        <div class="rail taiko">
          <div class="rail-head">
            <div class="rail-protocol">
              <span class="step-chip-dot taiko" aria-hidden="true" style="width:10px;height:10px;"></span>
              x402
            </div>
            <span class="rail-badge">Taiko Alethia</span>
          </div>
          <p class="rail-pitch">
            HTTP 402 with EIP-3009 <code class="mono">transferWithAuthorization</code>. Settled post-response by a facilitator &mdash; your agent signs once, no ETH needed for gas.
          </p>
          <div class="rail-meta">
            <div class="rail-meta-item">
              <div class="rail-meta-label">Asset</div>
              <div class="rail-meta-value">USDC</div>
            </div>
            <div class="rail-meta-item">
              <div class="rail-meta-label">Chain</div>
              <div class="rail-meta-value mono">167000</div>
            </div>
            <div class="rail-meta-item">
              <div class="rail-meta-label">Header</div>
              <div class="rail-meta-value mono">payment-signature</div>
            </div>
          </div>
        </div>

        <div class="rail tempo">
          <div class="rail-head">
            <div class="rail-protocol">
              <span class="step-chip-dot tempo" aria-hidden="true" style="width:10px;height:10px;"></span>
              MPP
            </div>
            <span class="rail-badge">Tempo</span>
          </div>
          <p class="rail-pitch">
            Machine Payment Protocol with a TIP-20 transfer. Tack re-reads the on-chain <code class="mono">Transfer</code> event to derive the verified payer &mdash; the wallet that signed, not a relay.
          </p>
          <div class="rail-meta">
            <div class="rail-meta-item">
              <div class="rail-meta-label">Asset</div>
              <div class="rail-meta-value">USDC.e</div>
            </div>
            <div class="rail-meta-item">
              <div class="rail-meta-label">Chain</div>
              <div class="rail-meta-value mono">4217</div>
            </div>
            <div class="rail-meta-item">
              <div class="rail-meta-label">Header</div>
              <div class="rail-meta-value mono">Authorization: Payment</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section id="api">
    <div class="container">
      <div class="section-head">
        <div class="section-label">API</div>
        <div class="section-title">Standard IPFS Pinning Service API.</div>
        <div class="section-sub">
          Fully compliant with the <a href="https://ipfs.github.io/pinning-services-api-spec/" target="_blank" rel="noopener" style="color:var(--taiko-200);">IPFS Pinning Service spec</a>. Plus file upload and a content gateway with optional paywalls. Owner endpoints are wallet-scoped.
        </div>
      </div>
      <div class="api-grid">
        <div class="api-card">
          <span class="api-method method-post">POST</span>
          <div class="api-path mono">/pins</div>
          <div class="api-desc">Pin a CID. First call returns 402 with the exact USDC price; sign and retry.</div>
          <div class="api-tags">
            <span class="api-tag pay"><span class="api-tag-dot" aria-hidden="true"></span>x402 or MPP</span>
          </div>
        </div>
        <div class="api-card">
          <span class="api-method method-post">POST</span>
          <div class="api-path mono">/upload</div>
          <div class="api-desc">Upload a file (up to 100 MB) and pin it in one request.</div>
          <div class="api-tags">
            <span class="api-tag pay"><span class="api-tag-dot" aria-hidden="true"></span>x402 or MPP</span>
          </div>
        </div>
        <div class="api-card">
          <span class="api-method method-get">GET</span>
          <div class="api-path mono">/pins</div>
          <div class="api-desc">List your pins. Scoped to the wallet that owns them.</div>
          <div class="api-tags">
            <span class="api-tag auth"><span class="api-tag-dot" aria-hidden="true"></span>Bearer</span>
          </div>
        </div>
        <div class="api-card">
          <span class="api-method method-get">GET</span>
          <div class="api-path mono">/pins/:requestid</div>
          <div class="api-desc">Get pin status by request ID.</div>
          <div class="api-tags">
            <span class="api-tag auth"><span class="api-tag-dot" aria-hidden="true"></span>Bearer</span>
          </div>
        </div>
        <div class="api-card">
          <span class="api-method method-post">POST</span>
          <div class="api-path mono">/pins/:requestid</div>
          <div class="api-desc">Replace an existing pin with a new CID, keeping the same identifier.</div>
          <div class="api-tags">
            <span class="api-tag auth"><span class="api-tag-dot" aria-hidden="true"></span>Bearer</span>
          </div>
        </div>
        <div class="api-card">
          <span class="api-method method-delete">DELETE</span>
          <div class="api-path mono">/pins/:requestid</div>
          <div class="api-desc">Unpin content you own.</div>
          <div class="api-tags">
            <span class="api-tag auth"><span class="api-tag-dot" aria-hidden="true"></span>Bearer</span>
          </div>
        </div>
        <div class="api-card">
          <span class="api-method method-get">GET</span>
          <div class="api-path mono">/ipfs/:cid</div>
          <div class="api-desc">Retrieve content. Supports range requests, ETags, and optional per-CID paywalls.</div>
          <div class="api-tags">
            <span class="api-tag"><span class="api-tag-dot" style="background:#22c55e" aria-hidden="true"></span>Free by default</span>
          </div>
        </div>
        <div class="api-card">
          <span class="api-method method-get">GET</span>
          <div class="api-path mono">/.well-known/agent.json</div>
          <div class="api-desc">A2A agent card for machine discovery. Lists both payment rails.</div>
          <div class="api-tags">
            <span class="api-tag"><span class="api-tag-dot" style="background:#f59e0b" aria-hidden="true"></span>Public</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section id="pricing">
    <div class="container">
      <div class="section-head-center">
        <div class="section-label">Pricing</div>
        <div class="section-title">Pay per pin. No subscription.</div>
        <div class="section-sub">
          Linear pricing by file size and duration. Settled in USDC on Taiko or USDC.e on Tempo &mdash; whichever your agent pays with.
        </div>
      </div>

      <div class="pricing-card">
        <div class="pricing-label">Pay-per-use</div>
        <div class="pricing-value">$0.10</div>
        <div class="pricing-unit">per GB per month &middot; $0.001 minimum &middot; $50 max</div>
        <div class="pricing-formula">
          <code class="mono">max($0.001, sizeGB &times; $0.10 &times; months)</code>
        </div>
        <ul class="pricing-features">
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Choose duration 1&ndash;24 months via <code class="mono">X-Pin-Duration-Months</code></span>
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Pins auto-expire &mdash; no unbounded storage charge</span>
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Settled on-chain in USDC on Taiko or USDC.e on Tempo</span>
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <span>No signups, API keys, or subscriptions</span>
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Retrieval free by default &middot; paywalls optional</span>
          </li>
        </ul>
        <a href="#integrate" class="btn-primary" style="display:inline-flex;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          Start pinning
        </a>
      </div>
    </div>
  </section>

  <section id="integrate">
    <div class="container">
      <div class="section-head-center">
        <div class="section-label">Integrate</div>
        <div class="section-title">One endpoint. Give it to your agent.</div>
        <p style="font-size:16px;color:var(--surface-500);">
          Tell your AI agent to use this URL for IPFS storage. It handles the rest &mdash; pricing, payment, pinning. Standard HTTP plus <a href="https://www.x402.org/" target="_blank" rel="noopener" style="color:var(--taiko-200);">x402</a> or <a href="https://mpp.dev/" target="_blank" rel="noopener" style="color:var(--tempo-200);">MPP</a>.
        </p>
      </div>

      <div class="endpoint-box">
        <div class="endpoint-label">API endpoint</div>
        <div class="endpoint-row">
          <code class="mono endpoint-url" id="endpoint-url">${o}</code>
          <button class="copy-btn" data-copy="${o}" aria-label="Copy API endpoint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span class="copy-btn-label">Copy</span>
          </button>
        </div>
        <div class="endpoint-note">Your agent only needs USDC on Taiko or USDC.e on Tempo &mdash; no ETH, no API keys, no accounts.</div>
      </div>

      <div class="checklist">
        <div class="checklist-item">
          <div class="checklist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></div>
          Works with any x402 or MPP client
        </div>
        <div class="checklist-item">
          <div class="checklist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></div>
          Agent only needs USDC or USDC.e
        </div>
        <div class="checklist-item">
          <div class="checklist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></div>
          No API keys or signup
        </div>
        <div class="checklist-item">
          <div class="checklist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></div>
          A2A agent card included
        </div>
      </div>

      <div class="code-grid">
        <div class="code-details">
          <h3>If you want the details</h3>
          <p>Pick the rail that matches your agent's wallet. Same endpoints, same request body &mdash; only the payment header changes.</p>

          <div class="code-detail-item">
            <div class="code-detail-label">Protocols</div>
            <div class="code-detail-value">IPFS Pinning Service API + x402 + MPP</div>
          </div>
          <div class="code-detail-item">
            <div class="code-detail-label">Networks</div>
            <div class="code-detail-value code-detail-row">
              <span class="chain-pill"><span class="chain-pill-dot taiko" aria-hidden="true"></span>Taiko Alethia <span class="mono">167000</span></span>
              <span class="chain-pill"><span class="chain-pill-dot tempo" aria-hidden="true"></span>Tempo <span class="mono">4217</span></span>
            </div>
          </div>
          <div class="code-detail-item">
            <div class="code-detail-label">Assets</div>
            <div class="code-detail-value">USDC (Taiko) &middot; USDC.e (Tempo)</div>
          </div>
          <div class="code-detail-item">
            <div class="code-detail-label">Agent card</div>
            <div class="code-detail-value mono">${o}/.well-known/agent.json</div>
          </div>
        </div>

        <div class="code-block">
          <div class="code-chrome">
            <div class="code-dot" aria-hidden="true"></div>
            <div class="code-dot" aria-hidden="true"></div>
            <div class="code-dot" aria-hidden="true"></div>
            <div class="code-tabs" role="tablist" aria-label="Choose payment rail">
              <button class="code-tab" role="tab" aria-selected="true" aria-controls="code-x402" id="tab-x402" data-tab="x402">
                <span class="code-tab-dot taiko" aria-hidden="true"></span>x402 &middot; Taiko
              </button>
              <button class="code-tab" role="tab" aria-selected="false" aria-controls="code-mpp" id="tab-mpp" data-tab="mpp">
                <span class="code-tab-dot tempo" aria-hidden="true"></span>MPP &middot; Tempo
              </button>
            </div>
          </div>

          <div class="code-pane" data-active="true" id="code-x402" role="tabpanel" aria-labelledby="tab-x402">
            <pre><code class="mono"><span class="k">import</span> { wrapFetchWithPaymentFromConfig } <span class="k">from</span> <span class="s">"@x402/fetch"</span>;
<span class="k">import</span> { ExactEvmScheme } <span class="k">from</span> <span class="s">"@x402/evm"</span>;

<span class="c">// One-time setup: wrap fetch so 402 is handled automatically.</span>
<span class="k">const</span> pay = <span class="f">wrapFetchWithPaymentFromConfig</span>(fetch, {
  schemes: [{
    network: <span class="s">"eip155:167000"</span>,       <span class="c">// Taiko Alethia</span>
    client: <span class="k">new</span> <span class="f">ExactEvmScheme</span>(wallet),
  }],
});

<span class="c">// Pin a CID for 6 months — x402 pays in USDC on Taiko.</span>
<span class="k">const</span> res = <span class="k">await</span> <span class="f">pay</span>(<span class="s">"${o}/pins"</span>, {
  method: <span class="s">"POST"</span>,
  headers: {
    <span class="s">"Content-Type"</span>: <span class="s">"application/json"</span>,
    <span class="s">"X-Pin-Duration-Months"</span>: <span class="s">"6"</span>,
  },
  body: <span class="f">JSON</span>.<span class="f">stringify</span>({ cid: <span class="s">"Qm..."</span> }),
});

<span class="c">// res.status === 202             → pinned
// res.headers["x-wallet-auth-token"] → owner bearer
// (await res.json()).info.expiresAt  → expiry</span></code></pre>
          </div>

          <div class="code-pane" data-active="false" id="code-mpp" role="tabpanel" aria-labelledby="tab-mpp" hidden>
            <pre><code class="mono"><span class="k">import</span> { Mppx, tempo } <span class="k">from</span> <span class="s">"mppx/client"</span>;

<span class="c">// One-time setup: payment-aware fetch over MPP.</span>
<span class="k">const</span> mppx = Mppx.<span class="f">create</span>({
  methods: [<span class="f">tempo</span>({ account })],   <span class="c">// viem account · Tempo 4217</span>
});

<span class="c">// Same endpoint, same body — MPP pays USDC.e on Tempo.</span>
<span class="k">const</span> res = <span class="k">await</span> mppx.<span class="f">fetch</span>(<span class="s">"${o}/pins"</span>, {
  method: <span class="s">"POST"</span>,
  headers: {
    <span class="s">"Content-Type"</span>: <span class="s">"application/json"</span>,
    <span class="s">"X-Pin-Duration-Months"</span>: <span class="s">"6"</span>,
  },
  body: <span class="f">JSON</span>.<span class="f">stringify</span>({ cid: <span class="s">"Qm..."</span> }),
});

<span class="c">// Tack verifies the on-chain Transfer event and
// binds the pin to the EOA that signed — not the relay.</span></code></pre>
          </div>
        </div>
      </div>

      <div class="cta-buttons">
        <a href="${o}/.well-known/agent.json" class="btn-primary" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          View agent card
        </a>
        <a href="https://github.com/ggonzalez94/ipfs-manager" class="btn-secondary" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.76 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.09 0 4.42-2.71 5.39-5.29 5.68.41.36.77 1.06.77 2.14v3.17c0 .31.21.68.8.56 4.56-1.52 7.85-5.83 7.85-10.91C23.5 5.65 18.35.5 12 .5z"/></svg>
          View on GitHub
        </a>
      </div>

      <div class="trust" aria-label="Ecosystem">
        <div class="trust-item"><span class="trust-dot taiko" aria-hidden="true"></span>Taiko Alethia <span class="mono">167000</span></div>
        <div class="trust-item"><span class="trust-dot tempo" aria-hidden="true"></span>Tempo <span class="mono">4217</span></div>
        <div class="trust-item"><span class="trust-dot ipfs" aria-hidden="true"></span>IPFS via Kubo</div>
        <div class="trust-item"><span class="trust-dot a2a" aria-hidden="true"></span>A2A agent card</div>
      </div>
    </div>
  </section>

  <footer>
    <div class="container footer-inner">
      <div class="footer-left">
        <div class="footer-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.29 7 12 12 20.71 7"/>
            <line x1="12" y1="22" x2="12" y2="12"/>
          </svg>
        </div>
        <span style="font-weight:600;font-size:15px;">Tack</span>
      </div>
      <div class="footer-links">
        <a href="https://github.com/ggonzalez94/ipfs-manager" target="_blank" rel="noopener">GitHub</a>
        <a href="${o}/health">Status</a>
        <a href="${o}/.well-known/agent.json" target="_blank" rel="noopener">Agent card</a>
        <a href="https://www.x402.org/" target="_blank" rel="noopener">x402</a>
        <a href="https://mpp.dev/" target="_blank" rel="noopener">MPP</a>
      </div>
      <div class="footer-tagline">Built on Taiko &amp; Tempo &middot; Powered by x402 + MPP</div>
    </div>
  </footer>

  <script>
  (function () {
    // Copy-to-clipboard for endpoint buttons
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
          navigator.clipboard.writeText(value).then(finish, function () {
            fallback();
          });
        } else {
          fallback();
        }
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = value; ta.setAttribute('readonly', '');
          ta.style.position = 'fixed'; ta.style.top = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); finish(); } catch (e) { /* noop */ }
          document.body.removeChild(ta);
        }
      });
    });

    // Tabbed code
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
        list[next].focus();
        list[next].click();
      });
    });
  })();
  </script>

</body>
</html>`;
}
