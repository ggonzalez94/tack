function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function landingPageHtml(origin: string): string {
  const o = escapeHtml(origin);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tack — Pin to IPFS, Pay with Your Wallet</title>
  <meta name="description" content="IPFS pinning and retrieval with x402 payments. No account needed — your wallet is your identity. Pay in USDC on Taiko." />
  <style>
    :root {
      --taiko-200: #ff6fc8;
      --taiko-300: #e81899;
      --taiko-400: #c8047d;

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
    .nav-links { display: flex; align-items: center; gap: 32px; }
    .nav-links a {
      font-size: 14px; color: var(--surface-600);
      transition: color 0.2s;
    }
    .nav-links a:hover { color: var(--surface-900); }
    .nav-cta {
      font-size: 14px; font-weight: 600;
      padding: 8px 18px; border-radius: 8px;
      background: var(--taiko-300); color: white !important;
      transition: background 0.2s;
    }
    .nav-cta:hover { background: var(--taiko-400); }

    @media (max-width: 768px) {
      .nav-links { display: none; }
    }

    /* ── Hero ── */
    .hero {
      position: relative; overflow: hidden;
      padding: 160px 0 120px;
      text-align: center;
    }
    .hero-glow {
      position: absolute; top: -200px; left: 50%; transform: translateX(-50%);
      width: 700px; height: 500px; border-radius: 50%;
      background: radial-gradient(ellipse, rgba(232, 24, 153, 0.08), transparent 70%);
      pointer-events: none;
    }
    .hero-content { position: relative; z-index: 1; }

    .badge {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 16px; border-radius: 9999px;
      background: var(--surface-100);
      border: 1px solid var(--surface-200);
      font-size: 13px; font-weight: 500; color: var(--surface-700);
      margin-bottom: 32px;
    }
    .badge-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--taiko-300);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    h1 {
      font-size: clamp(2.5rem, 6vw, 3.75rem);
      font-weight: 700; line-height: 1.1;
      letter-spacing: -0.03em;
      margin-bottom: 20px;
    }
    .gradient-text {
      background: linear-gradient(135deg, var(--taiko-200), var(--taiko-300));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-sub {
      font-size: clamp(1.05rem, 2vw, 1.25rem);
      color: var(--surface-600); max-width: 560px;
      margin: 0 auto 40px;
    }

    .hero-buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .btn-primary {
      padding: 14px 28px; border-radius: 10px;
      background: var(--taiko-300); color: white;
      font-weight: 600; font-size: 15px;
      border: none; cursor: pointer;
      transition: background 0.2s, box-shadow 0.2s;
      box-shadow: 0 0 24px rgba(232, 24, 153, 0.25);
    }
    .btn-primary:hover { background: var(--taiko-400); }
    .btn-secondary {
      padding: 14px 28px; border-radius: 10px;
      background: var(--surface-100); color: var(--surface-900);
      font-weight: 600; font-size: 15px;
      border: 1px solid var(--surface-200);
      cursor: pointer; transition: border-color 0.2s;
    }
    .btn-secondary:hover { border-color: var(--surface-400); }

    .stats {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 1px; margin-top: 64px;
      border: 1px solid var(--surface-200); border-radius: 12px;
      overflow: hidden; max-width: 540px; margin-left: auto; margin-right: auto;
    }
    .stat { padding: 24px; background: var(--surface-50); text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-label { font-size: 13px; color: var(--surface-500); margin-top: 4px; }

    /* ── Sections ── */
    section { padding: 96px 0; }
    section + section { border-top: 1px solid var(--surface-100); }

    .section-label {
      font-size: 13px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--taiko-300);
      margin-bottom: 12px;
    }
    .section-title {
      font-size: clamp(1.75rem, 4vw, 2.25rem);
      font-weight: 700; letter-spacing: -0.02em;
      margin-bottom: 16px;
    }
    .section-sub {
      font-size: 16px; color: var(--surface-500);
      max-width: 520px; margin-bottom: 48px;
    }

    /* ── Steps ── */
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
    .step {
      padding: 32px; border-radius: 16px;
      border: 1px solid var(--surface-200);
      background: var(--surface-50);
      transition: border-color 0.2s;
    }
    .step:hover { border-color: rgba(232, 24, 153, 0.3); }
    .step-number { font-size: 13px; font-weight: 600; color: var(--surface-400); margin-bottom: 16px; }
    .step-icon {
      width: 44px; height: 44px; border-radius: 12px;
      background: rgba(232, 24, 153, 0.1);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 16px;
    }
    .step-icon svg { width: 22px; height: 22px; color: var(--taiko-300); }
    .step h3 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .step p { font-size: 14px; color: var(--surface-500); line-height: 1.6; }

    /* ── API ── */
    .api-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
    .api-card {
      padding: 24px; border-radius: 12px;
      border: 1px solid var(--surface-200);
      background: var(--surface-50);
      transition: border-color 0.2s;
    }
    .api-card:hover { border-color: rgba(232, 24, 153, 0.3); }
    .api-method {
      display: inline-block; padding: 3px 8px; border-radius: 6px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .method-get { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
    .method-post { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
    .method-delete { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .api-path { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
    .api-desc { font-size: 13px; color: var(--surface-500); }
    .api-tag {
      display: inline-block; margin-top: 10px;
      padding: 2px 8px; border-radius: 6px;
      font-size: 11px; font-weight: 500;
      background: rgba(232, 24, 153, 0.1); color: var(--taiko-200);
    }

    /* ── Pricing ── */
    .pricing-card {
      max-width: 420px; padding: 40px; border-radius: 16px;
      border: 1px solid var(--surface-200);
      background: var(--surface-50);
    }
    .pricing-label {
      font-size: 13px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--taiko-300);
      margin-bottom: 8px;
    }
    .pricing-value { font-size: 48px; font-weight: 700; margin-bottom: 4px; }
    .pricing-unit { font-size: 15px; color: var(--surface-500); margin-bottom: 32px; }
    .pricing-features { list-style: none; margin-bottom: 32px; }
    .pricing-features li {
      display: flex; align-items: center; gap: 10px;
      font-size: 14px; color: var(--surface-700);
      padding: 8px 0;
    }
    .pricing-features li svg { width: 18px; height: 18px; color: var(--taiko-200); flex-shrink: 0; }

    /* ── Integrate ── */
    .endpoint-box {
      border-radius: 16px;
      border: 1px solid rgba(232, 24, 153, 0.3);
      background: var(--surface-50);
      padding: 28px 32px;
      box-shadow: 0 4px 24px rgba(232, 24, 153, 0.05);
      max-width: 640px;
    }
    .endpoint-label {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--surface-400);
      margin-bottom: 12px;
    }
    .endpoint-url {
      font-size: 17px; word-break: break-all;
      color: var(--surface-900);
    }
    .endpoint-note { font-size: 13px; color: var(--surface-400); margin-top: 12px; }
    .checklist {
      display: flex; flex-wrap: wrap; gap: 12px 32px;
      justify-content: center; margin-top: 32px;
    }
    .checklist-item {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; color: var(--surface-500);
    }
    .checklist-icon {
      width: 16px; height: 16px; border-radius: 50%;
      background: rgba(232, 24, 153, 0.15);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .checklist-icon svg { width: 10px; height: 10px; color: var(--taiko-200); }

    .code-grid { display: grid; grid-template-columns: 1fr; gap: 32px; margin-top: 48px; max-width: 900px; }
    @media (min-width: 900px) { .code-grid { grid-template-columns: 1fr 1.4fr; } }
    .code-details h3 { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
    .code-details p { font-size: 14px; color: var(--surface-500); line-height: 1.6; margin-bottom: 24px; }
    .code-detail-item { margin-bottom: 16px; }
    .code-detail-label { font-size: 11px; font-weight: 600; color: var(--surface-400); }
    .code-detail-value { font-size: 13px; color: var(--surface-700); margin-top: 4px; word-break: break-all; }
    .code-block {
      border-radius: 16px; border: 1px solid var(--surface-200);
      background: var(--surface-50); overflow: hidden;
    }
    .code-chrome {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; border-bottom: 1px solid var(--surface-200);
    }
    .code-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--surface-200); }
    .code-filename { font-size: 12px; font-weight: 500; color: var(--surface-400); margin-left: 12px; }
    .code-block pre {
      padding: 24px; overflow-x: auto;
      font-size: 13px; line-height: 1.7; color: var(--surface-600);
    }

    .cta-buttons { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 40px; }

    /* ── Footer ── */
    footer { padding: 32px 0; border-top: 1px solid var(--surface-100); }
    .footer-inner {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 16px;
    }
    .footer-left { display: flex; align-items: center; gap: 10px; }
    .footer-icon {
      width: 28px; height: 28px; border-radius: 7px;
      background: var(--taiko-300);
      display: flex; align-items: center; justify-content: center;
    }
    .footer-icon svg { width: 14px; height: 14px; }
    .footer-links { display: flex; gap: 24px; }
    .footer-links a { font-size: 13px; color: var(--surface-500); transition: color 0.2s; }
    .footer-links a:hover { color: var(--surface-900); }
    .footer-tagline { font-size: 12px; color: var(--surface-400); }
  </style>
</head>
<body>

  <nav>
    <div class="container nav-inner">
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.29 7 12 12 20.71 7"/>
            <line x1="12" y1="22" x2="12" y2="12"/>
          </svg>
        </div>
        Tack
      </div>
      <div class="nav-links">
        <a href="#how-it-works">How it works</a>
        <a href="#api">API</a>
        <a href="#pricing">Pricing</a>
        <a href="#integrate" class="nav-cta">Use with your agent</a>
      </div>
    </div>
  </nav>

  <section class="hero">
    <div class="hero-glow"></div>
    <div class="container hero-content">
      <div class="badge">
        <span class="badge-dot"></span>
        Live on Taiko Alethia
      </div>
      <h1>
        Agent-native IPFS.<br/>
        <span class="gradient-text">Pin and pay with USDC.</span>
      </h1>
      <p class="hero-sub">
        Let your AI agents pin and retrieve content on IPFS. No API keys, no accounts &mdash; just x402 payments settled in USDC on Taiko.
      </p>
      <div class="hero-buttons">
        <a href="#integrate" class="btn-primary">Use with your agent</a>
        <a href="#how-it-works" class="btn-secondary">See how it works</a>
      </div>
      <div class="stats">
        <div class="stat">
          <div class="stat-value">$0.001</div>
          <div class="stat-label">Base pin price</div>
        </div>
        <div class="stat">
          <div class="stat-value">0</div>
          <div class="stat-label">Signup required</div>
        </div>
        <div class="stat">
          <div class="stat-value">100 MB</div>
          <div class="stat-label">Max upload</div>
        </div>
      </div>
    </div>
  </section>

  <section id="how-it-works">
    <div class="container">
      <div class="section-label">How it works</div>
      <div class="section-title">Three steps. No accounts.</div>
      <div class="section-sub">
        Tack uses the x402 protocol &mdash; HTTP-native payments that settle on-chain. Your wallet address is your identity and your access key.
      </div>
      <div class="steps">
        <div class="step">
          <div class="step-number">01</div>
          <div class="step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <h3>Pin or upload content</h3>
          <p>Send a CID to pin, or upload a file directly. The API returns an HTTP 402 with the exact USDC price for your request.</p>
        </div>
        <div class="step">
          <div class="step-number">02</div>
          <div class="step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <h3>Pay with USDC</h3>
          <p>Your agent or client signs a USDC payment via x402. No ETH for gas, no approval transactions &mdash; just a single signature.</p>
        </div>
        <div class="step">
          <div class="step-number">03</div>
          <div class="step-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h3>Content is pinned</h3>
          <p>Your content is pinned to IPFS and retrievable via the gateway. The response includes an auth token for managing your pins without re-paying.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="api">
    <div class="container">
      <div class="section-label">API</div>
      <div class="section-title">Standard IPFS Pinning Service API</div>
      <div class="section-sub">
        Fully compliant with the IPFS Pinning Service API spec. Plus file upload and a content gateway with optional paywalls.
      </div>
      <div class="api-grid">
        <div class="api-card">
          <span class="api-method method-post">POST</span>
          <div class="api-path mono">/pins</div>
          <div class="api-desc">Pin a CID to IPFS. Pays via x402.</div>
          <span class="api-tag">x402 payment</span>
        </div>
        <div class="api-card">
          <span class="api-method method-post">POST</span>
          <div class="api-path mono">/upload</div>
          <div class="api-desc">Upload a file (up to 100 MB) and pin it.</div>
          <span class="api-tag">x402 payment</span>
        </div>
        <div class="api-card">
          <span class="api-method method-get">GET</span>
          <div class="api-path mono">/pins</div>
          <div class="api-desc">List your pins. Filtered by wallet identity.</div>
          <span class="api-tag">bearer auth</span>
        </div>
        <div class="api-card">
          <span class="api-method method-get">GET</span>
          <div class="api-path mono">/pins/:requestid</div>
          <div class="api-desc">Get pin status by request ID.</div>
          <span class="api-tag">bearer auth</span>
        </div>
        <div class="api-card">
          <span class="api-method method-get">GET</span>
          <div class="api-path mono">/ipfs/:cid</div>
          <div class="api-desc">Retrieve content. Supports range requests, ETags, and optional paywall.</div>
        </div>
        <div class="api-card">
          <span class="api-method method-delete">DELETE</span>
          <div class="api-path mono">/pins/:requestid</div>
          <div class="api-desc">Unpin content you own.</div>
          <span class="api-tag">bearer auth</span>
        </div>
      </div>
    </div>
  </section>

  <section id="pricing">
    <div class="container">
      <div class="section-label">Pricing</div>
      <div class="section-title">Pay per pin. No subscription.</div>
      <div class="section-sub">
        Dynamic pricing based on content size. Settled on-chain in USDC on Taiko Alethia.
      </div>
      <div class="pricing-card">
        <div class="pricing-label">Pay-per-use</div>
        <div class="pricing-value">$0.001</div>
        <div class="pricing-unit">base + $0.001/MB &middot; capped at $0.01</div>
        <ul class="pricing-features">
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Unlimited pins &amp; uploads
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Content gateway included
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Settled on-chain in USDC
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            No signup or API keys
          </li>
          <li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Free retrieval by default
          </li>
        </ul>
        <a href="#integrate" class="btn-primary" style="display:block;text-align:center;">Start pinning</a>
      </div>
    </div>
  </section>

  <section id="integrate">
    <div class="container">
      <div style="text-align:center;max-width:640px;margin:0 auto;">
        <div class="section-label">Integrate</div>
        <div class="section-title">One endpoint. Give it to your agent.</div>
        <p style="font-size:16px;color:var(--surface-500);margin-bottom:40px;">
          Tell your AI agent to use this URL for IPFS storage. It handles the rest &mdash; pricing, payment, pinning. Standard HTTP + <a href="https://www.x402.org/" target="_blank" style="color:var(--taiko-200);">x402</a>. Use <code class="mono">@x402/fetch</code> to handle payments automatically, or implement the protocol manually.
        </p>
      </div>

      <div style="display:flex;justify-content:center;">
        <div class="endpoint-box">
          <div class="endpoint-label">API endpoint</div>
          <code class="mono endpoint-url">${o}</code>
          <div class="endpoint-note">Your agent only needs USDC on Taiko &mdash; no ETH, no API keys, no accounts.</div>
        </div>
      </div>

      <div class="checklist">
        <div class="checklist-item">
          <div class="checklist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
          Works with any x402-compatible client
        </div>
        <div class="checklist-item">
          <div class="checklist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
          Agent only needs USDC
        </div>
        <div class="checklist-item">
          <div class="checklist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
          No API keys or signup
        </div>
        <div class="checklist-item">
          <div class="checklist-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
          A2A agent card included
        </div>
      </div>

      <div class="code-grid">
        <div class="code-details">
          <h3>If you want the details</h3>
          <p>Use <code class="mono">@x402/fetch</code> to wrap your fetch &mdash; it reads the 402 response, signs the USDC payment, and retries automatically. Or handle x402 manually if you prefer.</p>
          <div class="code-detail-item">
            <div class="code-detail-label">Protocol</div>
            <div class="code-detail-value mono">IPFS Pinning Service API + x402</div>
          </div>
          <div class="code-detail-item">
            <div class="code-detail-label">Network</div>
            <div class="code-detail-value mono">Taiko Alethia (167000)</div>
          </div>
          <div class="code-detail-item">
            <div class="code-detail-label">Agent card</div>
            <div class="code-detail-value mono">${o}/.well-known/agent.json</div>
          </div>
        </div>

        <div class="code-block">
          <div class="code-chrome">
            <div class="code-dot"></div>
            <div class="code-dot"></div>
            <div class="code-dot"></div>
            <span class="code-filename">agent.ts</span>
          </div>
          <pre><code class="mono">import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";

const x402Fetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:167000", client: new ExactEvmScheme(wallet) }],
});

// Pin a CID &mdash; x402 payment is handled automatically
const res = await x402Fetch("${o}/pins", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cid: "Qm..." }),
});
// res.status === 202
// res.headers["x-wallet-auth-token"] &rarr; save for owner requests

// Retrieve content &mdash; free by default
const content = await fetch("${o}/ipfs/Qm...");
</code></pre>
        </div>
      </div>

      <div class="cta-buttons">
        <a href="${o}/.well-known/agent.json" class="btn-primary" target="_blank">View agent card</a>
        <a href="https://github.com/ggonzalez94/ipfs-manager" class="btn-secondary" target="_blank">View on GitHub</a>
      </div>
    </div>
  </section>

  <footer>
    <div class="container footer-inner">
      <div class="footer-left">
        <div class="footer-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.29 7 12 12 20.71 7"/>
            <line x1="12" y1="22" x2="12" y2="12"/>
          </svg>
        </div>
        <span style="font-weight:600;font-size:15px;">Tack</span>
      </div>
      <div class="footer-links">
        <a href="https://github.com/ggonzalez94/ipfs-manager" target="_blank">GitHub</a>
        <a href="${o}/health">Status</a>
        <a href="${o}/.well-known/agent.json" target="_blank">Agent Card</a>
      </div>
      <div class="footer-tagline">Built on Taiko Alethia. Powered by x402.</div>
    </div>
  </footer>

</body>
</html>`;
}
