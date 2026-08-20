/* Santu Hardware PWA bootstrap — runs once on every desk page load */
(function () {
  /* 1. Manifest link */
  if (!document.querySelector('link[rel="manifest"]')) {
    const lnk = document.createElement("link");
    lnk.rel = "manifest";
    lnk.href = "/assets/santu_hardware/manifest.json";
    document.head.appendChild(lnk);
  }

  /* 2. iOS / Safari meta tags */
  const metas = {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Santu HW",
    "mobile-web-app-capable": "yes",
    "theme-color": "#3730a3",
  };
  Object.entries(metas).forEach(([name, content]) => {
    if (!document.querySelector(`meta[name="${name}"]`)) {
      const m = document.createElement("meta");
      m.name = name;
      m.content = content;
      document.head.appendChild(m);
    }
  });

  /* 3. Apple touch icon */
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const icon = document.createElement("link");
    icon.rel = "apple-touch-icon";
    icon.href = "/assets/santu_hardware/images/logo.png";
    document.head.appendChild(icon);
  }

  /* 4. Service worker */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {}); // silently ignore — SW is optional
  }

  /* 5. "Install App" prompt — shown once after 30 s on home page */
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show a subtle install chip after a short delay
    setTimeout(() => {
      if (!deferredPrompt) return;
      if (sessionStorage.getItem("santu_pwa_dismissed")) return;
      const chip = document.createElement("div");
      chip.id = "santu-pwa-chip";
      chip.innerHTML = `
        <span>📲 App install karein</span>
        <button id="santu-pwa-install">Install</button>
        <button id="santu-pwa-dismiss">✕</button>
      `;
      chip.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        background:#3730a3;color:#fff;padding:10px 16px;border-radius:24px;
        display:flex;align-items:center;gap:10px;z-index:9999;
        font-size:14px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.3);
        white-space:nowrap;
      `;
      document.body.appendChild(chip);

      document.getElementById("santu-pwa-install").onclick = async () => {
        chip.remove();
        deferredPrompt.prompt();
        deferredPrompt = null;
      };
      document.getElementById("santu-pwa-dismiss").onclick = () => {
        chip.remove();
        sessionStorage.setItem("santu_pwa_dismissed", "1");
      };
      // Auto-hide after 10 s
      setTimeout(() => chip.remove(), 10000);
    }, 30000);
  });
})();
