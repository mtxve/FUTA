// ==UserScript==
// @name         Flatline's Ultimate Torn Assistant
// @author       mtxve
// @namespace    http://github.com/mtxve
// @version      0.7.29a
// @updateURL    https://raw.githubusercontent.com/mtxve/FUTA/master/futa.js
// @downloadURL  https://raw.githubusercontent.com/mtxve/FUTA/master/futa.js
// @description  Flatline Family MegaScript
// @match        https://www.torn.com/*
// @grant        GM_addStyle
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        unsafeWindow
// @grant        GM.xmlHttpRequest
// @grant        GM.openInTab
// @run-at       document-start
// @connect      46.202.179.156
// @connect      api.torn.com
// ==/UserScript==

(function () {



  if (window.FUTA_ALREADY_LOADED) {
    console.log("[FUTA] Script already loaded, skipping...");
    return;
  }
  window.FUTA_ALREADY_LOADED = true;

  const FUTA = {
    tabStateKey: "charlemagne_last_tab",
    pingPromise: null,
    UPDATE_INTERVAL: 30000,
    VERSION: "0.7.29a",
    debugEnabled: false,
    sharedPingData: {},
    tornApiStatus: "Connecting...",
    chatButtonCreated: false,
    attackDebug: null,
    executeThreshold: null
  };

  const FACTION_ENDPOINTS = {
    Flatline: "http://46.202.179.156:8081",
    Darkline: "http://46.202.179.157:8082",
    Lifeline: "http://46.202.179.157:8083"
  };

  const FUTA_DRAG_MARGIN = 12;
  let panelResizeListenerAttached = false;
  const EXECUTE_PERK_CLASSES = [
    "bonus-attachment-execute",
  ];
  const ASSASSINATE_PERK_CLASSES = [
    "bonus-attachment-assassinate",
  ];

  function toBoolean(value) {
    if (typeof value === 'string') return value === 'true';
    return Boolean(value);
  }

  function debugLog(msg) {
    if (FUTA.debugEnabled) console.log("[FUTA] => " + msg);
  }

  function maskApiKey(k) {
    if (!k) return '';
    if (typeof k !== 'string') k = String(k);
    if (k.length <= 1) return k;
    return k[0] + '*'.repeat(Math.max(0, k.length - 1));
  }

  function ensureAttackDebugContext() {
    if (!FUTA.attackDebug) {
      FUTA.attackDebug = {
        counter: 0,
        active: false,
        executeDetected: false,
        assassinateDetected: false,
        startedAt: 0,
        context: "",
        perkScanTimeout: null
      };
    }
    return FUTA.attackDebug;
  }

  function extractExecuteThresholdFromDom() {
    const weaponIds = ["weapon_main", "weapon_second", "weapon_melee", "weapon_temp"];
    for (const weaponId of weaponIds) {
      const host = document.getElementById(weaponId);
      if (!host) continue;
      for (const cls of EXECUTE_PERK_CLASSES) {
        const perkEl = host.querySelector(`.${cls}`);
        if (!perkEl) continue;
        const desc = perkEl.getAttribute("data-bonus-attachment-description")
          || perkEl.getAttribute("data-title")
          || perkEl.getAttribute("title")
          || (perkEl.dataset ? perkEl.dataset.bonusAttachmentDescription : "");
        if (!desc) continue;
        const match = desc.match(/([0-9]+(?:\.[0-9]+)?)%/);
        if (match) {
          const value = Number(match[1]);
          if (!Number.isNaN(value)) return value;
        }
      }
    }
    return null;
  }

  function updateExecuteUI() {
    const display = document.getElementById('execute-threshold-display');
    if (display) {
      if (FUTA.executeThreshold != null) {
        display.textContent = `${FUTA.executeThreshold}%`;
        display.title = 'Execute perk detected';
      } else {
        display.textContent = '--';
        display.title = 'Execute perk not detected';
      }
    }
    const toggle = document.getElementById('execute-toggle');
    if (toggle) {
      const shouldDisable = FUTA.executeThreshold == null;
      toggle.disabled = shouldDisable;
      if (shouldDisable) {
        toggle.title = 'Execute perk not detected';
      } else {
        toggle.removeAttribute('title');
      }
    }
  }

  function detectWeaponPerk(perkClassList) {
    if (!Array.isArray(perkClassList) || perkClassList.length === 0) return false;
    const weaponIds = ["weapon_main", "weapon_second", "weapon_melee", "weapon_temp"];
    return weaponIds.some((id) => {
      const host = document.getElementById(id);
      if (!host) return false;
      return perkClassList.some((cls) => host.querySelector(`.${cls}`));
    });
  }

  function refreshAttackDebugPerks(reason = "manual") {
    if (!FUTA.debugEnabled) return;
    const ctx = ensureAttackDebugContext();
    const nextExecute = detectWeaponPerk(EXECUTE_PERK_CLASSES);
    const nextAssassinate = detectWeaponPerk(ASSASSINATE_PERK_CLASSES);
    const changed = nextExecute !== ctx.executeDetected || nextAssassinate !== ctx.assassinateDetected;
    ctx.executeDetected = nextExecute;
    ctx.assassinateDetected = nextAssassinate;
    FUTA.executeThreshold = nextExecute ? extractExecuteThresholdFromDom() : null;
    updateExecuteUI();

    const thresholdText = FUTA.executeThreshold != null ? `${FUTA.executeThreshold}%` : (nextExecute ? 'unknown' : 'n/a');
    if (changed || reason === "init" || reason === "post-init") {
      debugLog(`[Debug] Perk scan (${reason}): execute=${nextExecute}, executeThreshold=${thresholdText}, assassinate=${nextAssassinate}`);
    }
  }

  function initAttackDebug(context = "unknown") {
    if (!FUTA.debugEnabled) return;
    const ctx = ensureAttackDebugContext();
    if (ctx.perkScanTimeout) {
      clearTimeout(ctx.perkScanTimeout);
      ctx.perkScanTimeout = null;
    }
    ctx.counter = 0;
    ctx.active = true;
    ctx.startedAt = Date.now();
    ctx.context = context;
    refreshAttackDebugPerks("init");
    ctx.perkScanTimeout = setTimeout(() => refreshAttackDebugPerks("post-init"), 1000);
    debugLog(`[Debug] Attack counter reset (${context}).`);
  }

  function incrementAttackDebugCounter(source = "unknown") {
    if (!FUTA.debugEnabled) return;
    const ctx = ensureAttackDebugContext();
    if (!ctx.active) return;
    ctx.counter += 1;
    debugLog(`[Debug] Attack counter incremented (${source}): ${ctx.counter}`);
  }

  function finalizeAttackDebug(reason = "cleanup") {
    if (!FUTA.debugEnabled) return;
    const ctx = ensureAttackDebugContext();
    if (!ctx.active && ctx.counter === 0) {
      if (ctx.perkScanTimeout) {
        clearTimeout(ctx.perkScanTimeout);
        ctx.perkScanTimeout = null;
      }
      return;
    }
    debugLog(`[Debug] Attack counter finalized (${reason}): ${ctx.counter}`);
    ctx.counter = 0;
    ctx.active = false;
    if (ctx.perkScanTimeout) {
      clearTimeout(ctx.perkScanTimeout);
      ctx.perkScanTimeout = null;
    }
  }

  function waitForHead(callback) {
    if (document && document.head) {
      debugLog("document.head found; proceeding...");
      callback();
    } else {
      debugLog("document.head not ready, retrying in 500ms...");
      setTimeout(() => waitForHead(callback), 500);
    }
  }

  function waitForElm(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(selector)) return resolve(document.querySelector(selector));
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);
    });
  }

  function clampToViewport(left, top, width, height) {
    const margin = FUTA_DRAG_MARGIN;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(left, margin), maxLeft),
      top: Math.min(Math.max(top, margin), maxTop)
    };
  }

  function makeMovable(element, { handle, storageKey, fallbackSize } = {}) {
    if (!element || element.dataset.futaMovable === 'true') return;
    const dragHandle = handle || element;
    if (!dragHandle) return;
    element.dataset.futaMovable = 'true';
    element.dataset.futaPreventClick = 'false';
    if (storageKey) element.dataset.futaMoveStorage = storageKey;

    const getSize = () => {
      const rect = element.getBoundingClientRect();
      let width = rect.width;
      let height = rect.height;
      if (!width || !height) {
        const computed = getComputedStyle(element);
        width = parseFloat(computed.width) || fallbackSize?.width || element.offsetWidth || 0;
        height = parseFloat(computed.height) || fallbackSize?.height || element.offsetHeight || 0;
      }
      if ((!width || !height) && fallbackSize) {
        width = width || fallbackSize.width || 0;
        height = height || fallbackSize.height || 0;
      }
      return {
        width: Math.max(width || 1, 1),
        height: Math.max(height || 1, 1)
      };
    };

    const applyStoredPosition = () => {
      if (!storageKey) return;
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return;
        const size = getSize();
        const clamped = clampToViewport(parsed.left, parsed.top, size.width, size.height);
        element.style.left = `${clamped.left}px`;
        element.style.top = `${clamped.top}px`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        localStorage.setItem(storageKey, JSON.stringify(clamped));
      } catch (err) {
        debugLog(`Error applying stored position for ${storageKey}: ${err}`);
      }
    };

    applyStoredPosition();

    let pointerId = null;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    let hasMoved = false;

    const handlePointerDown = (event) => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      const rect = element.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;
      hasMoved = false;
      element.dataset.futaPreventClick = 'false';
      if (dragHandle.setPointerCapture) {
        dragHandle.setPointerCapture(pointerId);
      }
    };

    const handlePointerMove = (event) => {
      if (event.pointerId !== pointerId) return;
      const deltaX = Math.abs(event.clientX - startX);
      const deltaY = Math.abs(event.clientY - startY);
      if (!hasMoved && (deltaX > 3 || deltaY > 3)) {
        hasMoved = true;
        element.classList.add('futa-dragging');
        dragHandle.classList.add('grabbing');
        element.style.right = 'auto';
        element.style.bottom = 'auto';
      }
      if (!hasMoved) return;
      event.preventDefault();
      const newLeft = event.clientX - offsetX;
      const newTop = event.clientY - offsetY;
      const size = getSize();
      const clamped = clampToViewport(newLeft, newTop, size.width, size.height);
      element.style.left = `${clamped.left}px`;
      element.style.top = `${clamped.top}px`;
    };

    const finalizeDrag = (event) => {
      if (event.pointerId !== pointerId) return;
      if (dragHandle.releasePointerCapture) {
        try { dragHandle.releasePointerCapture(pointerId); } catch (e) { /* ignore */ }
      }
      if (hasMoved) {
        const rect = element.getBoundingClientRect();
        const size = getSize();
        const clamped = clampToViewport(rect.left, rect.top, size.width, size.height);
        element.style.left = `${clamped.left}px`;
        element.style.top = `${clamped.top}px`;
        if (storageKey) {
          localStorage.setItem(storageKey, JSON.stringify(clamped));
        }
        element.dataset.futaPreventClick = 'true';
        setTimeout(() => {
          element.dataset.futaPreventClick = 'false';
        }, 0);
        event.preventDefault();
        event.stopPropagation();
      } else {
        element.dataset.futaPreventClick = 'false';
      }
      element.classList.remove('futa-dragging');
      dragHandle.classList.remove('grabbing');
      pointerId = null;
      hasMoved = false;
    };

    dragHandle.addEventListener('pointerdown', handlePointerDown);
    dragHandle.addEventListener('pointermove', handlePointerMove);
    dragHandle.addEventListener('pointerup', finalizeDrag);
    dragHandle.addEventListener('pointercancel', finalizeDrag);

    const suppressClickAfterDrag = (event) => {
      if (element.dataset.futaPreventClick === 'true') {
        event.preventDefault();
        event.stopPropagation();
        element.dataset.futaPreventClick = 'false';
      }
    };
    dragHandle.addEventListener('click', suppressClickAfterDrag, true);

    window.addEventListener('resize', applyStoredPosition);
  }

  function setPanelMinHeightFromSettings() {
    const panel = document.getElementById('futa-panel');
    if (!panel) return;
    if (panel.hidden || panel.hasAttribute('hidden')) return;
    const content = panel.querySelector('.futa-content');
    if (!content) return;

    const explicitHeight = panel.style.height && panel.style.height.trim() !== '';
    const viewportCap = Math.min(window.innerHeight - FUTA_DRAG_MARGIN * 2, 640);
    const cappedPanel = Math.max(260, viewportCap);
    panel.style.maxHeight = `${cappedPanel}px`;
    if (!explicitHeight) {
    }

    const headerHeight = panel.querySelector('.futa-header')?.offsetHeight || 0;
    const tabsHeight = panel.querySelector('.futa-tabs')?.offsetHeight || 0;
    const bannerEl = panel.querySelector('#persistent-banner');
    const bannerHeight = bannerEl && window.getComputedStyle(bannerEl).display !== 'none'
      ? bannerEl.offsetHeight
      : 0;

    const chromeAllowance = headerHeight + tabsHeight + bannerHeight + 48;
    const available = Math.max(220, cappedPanel - chromeAllowance);

    content.style.minHeight = `0px`;
    content.style.maxHeight = `${available}px`;
    requestAnimationFrame(() => {
      try {
        if (content.scrollHeight <= content.clientHeight) {
          content.style.overflowY = 'hidden';
        } else {
          content.style.overflowY = 'auto';
        }
      } catch (e) {}
    });
  }

  function attachPanelSizePersistence(wrapper) {
    const MIN_W = 260, MIN_H = 220;
    try {
      const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          const el = entry.target;
          if (el.hasAttribute('hidden')) continue;
          const w = Math.round(entry.contentRect.width);
          const h = Math.round(entry.contentRect.height);
          if (w < MIN_W || h < MIN_H) continue;
          GM.setValue('futa_panel_width', w);
          GM.setValue('futa_panel_height', h);
        }
      });
      ro.observe(wrapper);
    } catch (e) {}
  }

  function addCustomStyles() {
  debugLog("Injecting custom styles...");
  GM_addStyle(`#futa-toggle-button{position:fixed;bottom:24px;right:24px;z-index:2147483646;border:none;border-radius:999px;padding:12px 18px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;transition:transform .15s ease,box-shadow .2s ease,background .2s ease;box-shadow:0 12px 25px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;gap:8px;cursor:grab;user-select:none;touch-action:none}#futa-toggle-button:focus-visible{outline:2px solid rgba(111,147,255,.85);outline-offset:2px}#futa-toggle-button:hover{transform:translateY(-1px)}body.dark-mode #futa-toggle-button{background:linear-gradient(135deg,#6f5bff,#2f9dff);color:#fff}body:not(.dark-mode) #futa-toggle-button{background:linear-gradient(135deg,#4756ff,#00b7ff);color:#fff}#futa-toggle-button.active{box-shadow:0 18px 28px rgba(87,133,255,.45)}#futa-toggle-button.futa-dragging{cursor:grabbing;transform:none!important}#futa-toggle-button img{width:28px;height:28px;display:block;pointer-events:none}#futa-toggle-button.futa-alert-active{background:linear-gradient(135deg,#ffd24a,#ffdb4d)!important;color:#111!important;box-shadow:0 18px 34px rgba(255,198,34,.35)!important}#futa-toggle-button .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}#futa-panel{position:fixed;bottom:72px;right:24px;width:min(320px,calc(100vw - 40px));max-height:min(70vh,520px);display:flex;flex-direction:column;border-radius:16px;background:#1e2333;color:#f5f7ff;border:1px solid rgba(255,255,255,.06);box-shadow:0 24px 40px rgba(0,0,0,.45);z-index:2147483645;font-family:"Roboto","Open Sans",Arial,sans-serif;font-size:13px;line-height:1.45;backdrop-filter:blur(14px)}body:not(.dark-mode) #futa-panel{background:rgba(255,255,255,.98);color:#1d1f28;border:1px solid rgba(16,22,48,.08);box-shadow:0 18px 36px rgba(25,42,89,.22);backdrop-filter:unset}#futa-panel[hidden]{display:none!important}#futa-panel .futa-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);cursor:grab;user-select:none;touch-action:none;position:sticky;top:0;z-index:10;--futa-header-height:56px}body:not(.dark-mode) #futa-panel .futa-header{border-bottom:1px solid rgba(0,0,0,.08);background:linear-gradient(180deg,#eef2f6,#e6eaee);color:#1d1f28}#futa-panel .futa-header.grabbing{cursor:grabbing}#futa-panel.futa-dragging{box-shadow:0 30px 45px rgba(0,0,0,.55)}#futa-panel .futa-title{display:flex;align-items:center;gap:10px}#futa-panel .futa-title img{width:32px;height:32px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.45)}#futa-panel .futa-title-text{display:flex;flex-direction:column;gap:2px;font-weight:600}#futa-panel .futa-title-primary{font-size:15px;letter-spacing:.03em}#futa-panel .futa-title-sub{font-size:10px;line-height:1;opacity:.7;letter-spacing:.04em;text-transform:uppercase}#futa-panel .futa-tabs{display:flex;gap:6px;padding:6px 8px;background:rgba(255,255,255,.04);align-items:center;height:36px;position:sticky;top:var(--futa-header-height,56px);z-index:9;backdrop-filter:inherit}body:not(.dark-mode) #futa-panel .futa-tabs{background:rgba(0,0,0,.04)}#futa-panel .futa-tab{flex:1;border:none;border-radius:10px;padding:6px 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:background .15s ease,transform .08s ease,color .15s ease;background:transparent;color:inherit;height:28px;display:inline-flex;align-items:center;justify-content:center}#futa-panel .futa-tab:hover{background:rgba(255,255,255,.12);transform:translateY(-1px)}body:not(.dark-mode) #futa-panel .futa-tab:hover{background:rgba(0,0,0,.08)}#futa-panel .futa-tab.active{background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.02));color:inherit;box-shadow:0 6px 10px rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.04)}#futa-panel button.torn-btn.futa-quick-highlight{box-shadow:0 0 0 2px rgba(255,255,255,.06),0 6px 14px rgba(0,0,0,.22);border-color:rgba(255,255,255,.12)}#futa-panel .futa-content{padding:16px 18px 18px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:18px}#futa-panel .futa-tab-panel{display:flex;flex-direction:column;gap:16px}#futa-panel .futa-tab-panel[hidden]{display:none!important}#check-summary-box{border-radius:14px;border:1px solid rgba(255,255,255,.08);padding:14px;background:rgba(0,0,0,.22);font-size:13px;line-height:1.55;white-space:pre-line}body:not(.dark-mode) #check-summary-box{background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.1)}#action-buttons{display:flex;flex-direction:column;gap:10px}#action-buttons .button-row{display:flex;gap:10px;align-items:stretch}#action-buttons button{flex:1;padding:10px 12px;border-radius:12px;font-size:13px;border-width:2px!important;display:flex;align-items:center;justify-content:center}#futa-panel button.torn-btn{background:rgba(255,255,255,.04);color:inherit;border:1px solid rgba(255,255,255,.08);transition:transform .1s ease,background .15s ease,opacity .12s ease;display:flex;align-items:center;justify-content:center;padding:10px 12px;border-radius:10px}#futa-panel button.torn-btn:hover:not([disabled]){background:rgba(255,255,255,.08);transform:translateY(-1px)}body:not(.dark-mode) #futa-panel button.torn-btn{background:rgba(0,0,0,.04);border:1px solid rgba(0,0,0,.08)}body:not(.dark-mode) #futa-panel button.torn-btn:hover:not([disabled]){background:rgba(0,0,0,.06)}#futa-panel button.torn-btn:disabled{opacity:.55;cursor:not-allowed;transform:none}#futa-panel button.torn-btn.primary{background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.12);color:inherit;font-weight:700}body:not(.dark-mode) #futa-panel button.torn-btn.primary{background:linear-gradient(135deg,#f4f6g9,#eef2f6);border:1px solid rgba(0,0,0,.08);color:#111}#futa-panel .futa-inline-field{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;width:100%}#futa-panel .futa-inline-field .field-label{font-size:12px;font-weight:400;white-space:nowrap;margin-right:4px}#futa-panel .futa-inline-field input[type="text"],#futa-panel .futa-inline-field select{flex:1 1 auto;margin:0}#futa-panel .futa-inline-field button.torn-btn{flex:0 0 auto;padding:8px 10px;font-size:13px;height:auto;min-width:64px}#futa-panel .quick-attack-inline{display:flex;align-items:center;gap:4px;font-size:12px;font-weight:300;user-select:none}#futa-panel .quick-attack-inline span{white-space:nowrap}#futa-panel .quick-attack-inline input[type="checkbox"]{margin:0}#futa-panel .quick-attack-inline select{flex:0 0 80px;margin:0;font-weight:300;padding:6px 8px;font-size:12px;line-height:1;box-sizing:border-box;appearance:none}#futa-panel .quick-attack-inline input[type="checkbox"]{margin:0 6px 0 0;transform:translateY(1px)}#save-api-key.torn-btn{padding:6px 8px!important;font-size:12px!important;min-width:48px;height:auto}#content-settings #save-api-key.torn-btn,#futa-panel .collapsible-content #save-api-key.torn-btn{padding:4px 8px!important;font-size:12px!important;min-width:44px!important;height:28px!important;line-height:1!important}#futa-panel .collapsible{border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.18)}body:not(.dark-mode) #futa-panel .collapsible{background:rgba(0,0,0,.02);border-color:rgba(0,0,0,.08)}#futa-panel .collapsible-header{cursor:pointer;font-weight:600;padding:8px 12px;font-size:13px;user-select:none;display:flex;align-items:center;justify-content:space-between;letter-spacing:.03em}#futa-panel .collapsible-header::after{content:"▾";font-size:14px;opacity:.7;transition:transform .2s ease}#futa-panel .collapsible.collapsed .collapsible-header::after{transform:rotate(-90deg)}#futa-panel .collapsible-content{padding:14px 16px;border-top:1px solid rgba(255,255,255,.05);display:block}body:not(.dark-mode) #futa-panel .collapsible-content{border-top-color:rgba(0,0,0,.08)}#futa-panel .collapsible-content label{display:flex;align-items:center;gap:4px;font-size:12px;line-height:1.3;padding:0;margin:0;font-weight:400}#futa-panel .collapsible-content label+label{margin-top:2px}#futa-panel .collapsible-content label input[type="checkbox"]{margin:0}#futa-panel .collapsible-content input[type="text"],#futa-panel .collapsible-content input[type="number"],#futa-panel .collapsible-content select{width:100%;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.2);color:inherit;transition:border .2s ease,box-shadow .2s ease;margin:4px 0 8px}body:not(.dark-mode) #futa-panel .collapsible-content input[type="text"],body:not(.dark-mode) #futa-panel .collapsible-content input[type="number"],body:not(.dark-mode) #futa-panel .collapsible-content select{background:rgba(255,255,255,.96);border-color:rgba(0,0,0,.1)}#futa-panel .collapsible-content input[type="text"]:focus,#futa-panel .collapsible-content input[type="number"]:focus,#futa-panel .collapsible-content select:focus{outline:none;border-color:rgba(113,159,255,.8);box-shadow:0 0 0 3px rgba(113,159,255,.25)}#futa-panel #quick-attack-action{padding:1px 2px}#futa-panel .execute-inline span{white-space:nowrap;font-weight:400}#futa-panel .execute-threshold{font-weight:500;padding:0 6px;border-radius:8px;background:rgba(255,255,255,.06);font-variant-numeric:tabular-nums}#settings-api-status{text-align:center;font-size:12px;line-height:1.6;padding:12px 16px;border-radius:12px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08)}body:not(.dark-mode) #settings-api-status{background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.08)}#persistent-banner{font-size:11px;text-align:center;padding:10px 14px;border-top:1px solid rgba(255,255,255,.08);display:none;background:rgba(255,94,94,.12)}body:not(.dark-mode) #persistent-banner{border-top-color:rgba(0,0,0,.08);background:rgba(255,95,95,.18);color:#2d2d2d}#persistent-banner strong{font-weight:700}html.futa-hide-primary .weaponWrapper___h3buK:has(.topMarker___OjRyU[id*="Primary"]) img{display:none!important}html.futa-hide-secondary .weaponWrapper___h3buK:has(.topMarker___OjRyU[id*="Secondary"]) img{display:none!important}html.futa-hide-melee .weaponWrapper___h3buK:has(.topMarker___OjRyU[id*="Melee"]) img{display:none!important}html.futa-hide-temp .weaponWrapper___h3buK:has(.topMarker___OjRyU[id*="Temporary"]) img{display:none!important}@media(max-width:600px){#futa-toggle-button{bottom:12px;right:12px;padding:8px 10px;font-size:11px}#futa-toggle-button img{width:20px;height:20px}#futa-panel{width:min(320px,calc(100vw - 28px));right:12px;bottom:72px;border-radius:12px;font-size:12px}#futa-panel .futa-header{padding:10px 12px}#futa-panel .futa-content{padding:12px;gap:12px}#futa-panel .futa-tabs{padding:8px 10px;gap:4px}#futa-panel .futa-tab{padding:8px 10px;font-size:11px}#futa-panel button.torn-btn{padding:8px 10px;font-size:12px}}#futa-panel{resize:none;overflow:auto;min-width:260px;min-height:220px}#futa-panel.futa-no-corner-resize{resize:both}#futa-panel .futa-resize-handle{position:absolute;width:14px;height:14px;background:transparent;z-index:2147483650;opacity:.6}#futa-panel .futa-resize-handle::after{content:'';position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:2px solid rgba(255,255,255,.18);border-bottom:2px solid rgba(255,255,255,.18);border-radius:2px;transform:rotate(0)}#futa-panel:hover .futa-resize-handle::after{opacity:1}#futa-panel .futa-resize-nw{top:4px;left:4px;cursor:nwse-resize}#futa-panel .futa-resize-ne{top:4px;right:4px;cursor:nesw-resize}#futa-panel .futa-resize-sw{bottom:4px;left:4px;cursor:sw-resize}#futa-panel .futa-resize-se{bottom:4px;right:4px;cursor:nwse-resize}body.futa-on-pda #futa-toggle-button{padding:6px 8px;bottom:10px;right:10px}body.futa-on-pda #futa-toggle-button img{width:18px;height:18px}body.futa-on-pda #futa-panel{width:300px;right:10px;bottom:72px;font-size:12px}#futa-panel.futa-compact{width:260px!important;font-size:12px}@media(max-width:600px){#futa-panel.futa-compact{width:calc(100vw - 28px)!important;right:12px!important}}#futa-panel .futa-header{position:sticky;top:0;z-index:6;backdrop-filter:inherit}#futa-panel .futa-content{-webkit-overflow-scrolling:touch}`);
  }

  function applyHideClassesFromLocalStorage() {
    try {
      const root = document.documentElement;
      const map = {
        primary: localStorage.getItem('futa_hide_primary') === 'true',
        secondary: localStorage.getItem('futa_hide_secondary') === 'true',
        melee: localStorage.getItem('futa_hide_melee') === 'true',
        temp: localStorage.getItem('futa_hide_temp') === 'true',
      };
      toggleRootHideClass(root, 'primary', map.primary);
      toggleRootHideClass(root, 'secondary', map.secondary);
      toggleRootHideClass(root, 'melee', map.melee);
      toggleRootHideClass(root, 'temp', map.temp);
    } catch (e) {
    }
  }

  function toggleRootHideClass(root, type, enabled) {
    const cls = `futa-hide-${type}`;
    if (enabled) root.classList.add(cls); else root.classList.remove(cls);
  }

  async function getCachedPingData() {
  debugLog("getCachedPingData() called...");
  const now = Date.now();
  const lastPingTimestamp = parseInt(localStorage.getItem("lastPingTimestamp") || "0", 10);
  const cachedData = localStorage.getItem("lastPingData");

  if ((now - lastPingTimestamp) < FUTA.UPDATE_INTERVAL && cachedData) {
    try {
      const parsedData = JSON.parse(cachedData);
      debugLog("Returning cached ping data: " + JSON.stringify(parsedData));
      return parsedData;
    } catch (e) {
      debugLog("Error parsing cached data: " + e);
    }
  }

  debugLog("Fetching new ping data...");
  const apiKey = await GM.getValue("api_key", "");
  if (!apiKey) {
    debugLog("No API key provided. Ping request skipped.");
    localStorage.setItem("charlemagne_status", "No Connection");
    return {};
  }

  const faction = await GM.getValue("user_faction", "Flatline");
  const baseEndpoint = FACTION_ENDPOINTS[faction] || FACTION_ENDPOINTS.Flatline;
  const pingUrlWithKey = `${baseEndpoint}/ping?api_key=${encodeURIComponent(apiKey)}`;
  return new Promise((resolve) => {
    GM.xmlHttpRequest({
      method: "GET",
      url: pingUrlWithKey,
      onload: (res) => {
        try {
          const data = JSON.parse(res.responseText);
          localStorage.setItem("lastPingTimestamp", now.toString());
          localStorage.setItem("lastPingData", JSON.stringify(data));
          const isConnected = data && Object.keys(data).length > 0 && data.success !== false;
          localStorage.setItem("charlemagne_status", isConnected ? "Established" : "No Connection");
          debugLog("New ping data fetched: " + JSON.stringify(data));
          resolve(data);
        } catch (e) {
          debugLog("Error parsing ping response: " + e);
          localStorage.setItem("charlemagne_status", "No Connection");
          resolve({});
        }
      },
      onerror: () => {
        localStorage.setItem("lastPingTimestamp", now.toString());
        localStorage.setItem("charlemagne_status", "No Connection");
        resolve({});
      }
    });
  });
}

  async function fetchTornAPIStatus() {
    debugLog("fetchTornAPIStatus() called...");
    const summary = await fetchCheckSummary();
    FUTA.tornApiStatus = summary.indexOf("❌") === 0 ? "No Connection" : "Established";
    debugLog("TornAPI status: " + FUTA.tornApiStatus);
  }

  async function fetchCheckSummary() {
    try {
      const now = Date.now();
      const lastSummaryTimestamp = parseInt(localStorage.getItem("lastSummaryTimestamp") || "0", 10);
      const cachedSummary = localStorage.getItem("lastSummary");
      if ((now - lastSummaryTimestamp) < FUTA.UPDATE_INTERVAL && cachedSummary) {
        return cachedSummary;
      }
      const api_key = await GM.getValue("api_key", "");
      if (!api_key) return "No API key saved.";
      const ignores = {
        ignore_bank: await GM.getValue("ignore_bank", false),
        ignore_medical: await GM.getValue("ignore_medical", false),
        ignore_booster: await GM.getValue("ignore_booster", false),
        ignore_drug: await GM.getValue("ignore_drug", false),
        ignore_travel: await GM.getValue("ignore_travel", false)
      };
      return new Promise((resolve) => {
        GM.xmlHttpRequest({
          method: "GET",
          url: `https://api.torn.com/user/?selections=bars,cooldowns,travel,missions,icons,refills&key=${api_key}`,
          onload: (res) => {
            try {
              const data = JSON.parse(res.responseText);
              const output = [];
              const refills = data.refills || {};
              const cd = data.cooldowns || {};
              const icons = data.icons || {};
              const missions = data.missions || {};
              if (!refills.energy_refill_used || !refills.nerve_refill_used) {
                output.push(`You haven't used your ${!refills.energy_refill_used ? "energy" : ""}${(!refills.energy_refill_used && !refills.nerve_refill_used) ? " & " : ""}${!refills.nerve_refill_used ? "nerve" : ""} refill today.`);
              }
              if (!ignores.ignore_drug && cd.drug === 0) output.push("You're not currently on any drugs.");
              if (!ignores.ignore_booster && cd.booster === 0) output.push("You're not using your booster cooldown.");
              if (!ignores.ignore_medical && cd.medical === 0) output.push("You're not using your medical cooldown.");
              let missionArray = [];
              if (missions && typeof missions === "object") {
                for (let key in missions) {
                  if (Array.isArray(missions[key])) missionArray = missionArray.concat(missions[key]);
                  else missionArray.push(missions[key]);
                }
              }
              const missionCount = missionArray.filter(m => m && m.status === "notAccepted").length;
              if (missionCount > 0) output.push(`You have ${missionCount} mission${missionCount > 1 ? "s" : ""} available.`);
              try {
                const travelData = data.travel || {};
                if (!ignores.ignore_travel) {
                    const isTravelingOrRacing = Boolean(
                      (icons && icons.icon71) ||
                      (icons && icons.icon17) ||
                      (travelData && travelData.time_left && travelData.time_left > 0)
                    );
                    if (!isTravelingOrRacing) {
                      output.push("You're not currently racing or traveling.");
                    }
                }
              } catch (e) {
              }
              const summary = output.join("\n") || "All checks passed.";
              localStorage.setItem("lastSummaryTimestamp", now.toString());
              localStorage.setItem("lastSummary", summary);
              resolve(summary);
            } catch (e) {
              resolve("❌ Error parsing Torn API response.");
            }
          },
          onerror: () => resolve("❌ Error connecting to Torn API.")
        });
      });
    } catch (err) {
      return "❌ Error in fetchCheckSummary: " + err.toString();
    }
  }

  async function updateAllStatuses() {
    debugLog("updateAllStatuses() called...");
    try {
      const pingDataPromise = getCachedPingData();
      const tornStatusPromise = fetchTornAPIStatus();
      FUTA.sharedPingData = (await pingDataPromise) || {};
      await tornStatusPromise;
      debugLog("Shared tornApiStatus: " + FUTA.tornApiStatus);
      _updateBannerWithPingData(FUTA.sharedPingData);
      _updateSettingsAPIStatus(FUTA.sharedPingData);
      const panel = document.getElementById("futa-panel");
      if (panel) await _updatePanelContent();
    } catch (error) {
      debugLog("Error in updateAllStatuses: " + error);
      FUTA.sharedPingData = {};
      FUTA.tornApiStatus = "No Connection";
      _updateBannerWithPingData(FUTA.sharedPingData);
      _updateSettingsAPIStatus(FUTA.sharedPingData);
      const panel = document.getElementById("futa-panel");
      if (panel) await _updatePanelContent();
    }
  }

  function getConnectionStatus(pingData) {
    const isCharlConnected = pingData && Object.keys(pingData).length > 0 && pingData.success !== false;
    const charlStatus = isCharlConnected ? "Established" : "No Connection";
    localStorage.setItem("charlemagne_status", charlStatus);
    return {
      charlStatus: charlStatus,
      charlColor: isCharlConnected ? "green" : "red",
      tornStatus: FUTA.tornApiStatus,
      tornColor: FUTA.tornApiStatus === "Established" ? "green" : "red"
    };
  }

  function _updateBannerWithPingData(pingData) {
  const storedCharlStatus = localStorage.getItem("charlemagne_status") || "No Connection";
  const { charlStatus, charlColor, tornStatus, tornColor } = pingData ? getConnectionStatus(pingData) : {
    charlStatus: storedCharlStatus,
    charlColor: storedCharlStatus === "Established" ? "green" : "red",
    tornStatus: FUTA.tornApiStatus,
    tornColor: FUTA.tornApiStatus === "Established" ? "green" : "red"
  };

  const newBannerState = { charlStatus, charlColor, tornStatus, tornColor };
  FUTA._lastDisplayedConnection = FUTA._lastDisplayedConnection || null;
  if (FUTA._lastDisplayedConnection && JSON.stringify(FUTA._lastDisplayedConnection) === JSON.stringify(newBannerState)) {
    return;
  }
  FUTA._lastDisplayedConnection = newBannerState;

  const bannerEl = document.getElementById("persistent-banner");
  if (bannerEl) {
    bannerEl.innerHTML = `
      Conn to Charlemage:: <strong style="color: ${charlColor};">${charlStatus}</strong><br/>
      Conn to TornAPI: <strong style="color: ${tornColor};">${tornStatus}</strong>`;
    bannerEl.style.display = (charlStatus !== "Established" || tornStatus !== "Established") ? "block" : "none";
  }
}

function _updateSettingsAPIStatus(pingData) {
  const storedCharlStatus = localStorage.getItem("charlemagne_status") || "No Connection";
  const { charlStatus, charlColor, tornStatus, tornColor } = pingData ? getConnectionStatus(pingData) : {
    charlStatus: storedCharlStatus,
    charlColor: storedCharlStatus === "Established" ? "green" : "red",
    tornStatus: FUTA.tornApiStatus,
    tornColor: FUTA.tornApiStatus === "Established" ? "green" : "red"
  };

  const newSettingsState = { charlStatus, charlColor, tornStatus, tornColor, version: FUTA.VERSION };
  FUTA._lastDisplayedSettings = FUTA._lastDisplayedSettings || null;
  if (FUTA._lastDisplayedSettings && JSON.stringify(FUTA._lastDisplayedSettings) === JSON.stringify(newSettingsState)) {
    debugLog("_updateSettingsAPIStatus skipped (no visible change)");
    return;
  }
  FUTA._lastDisplayedSettings = newSettingsState;

  const statusEl = document.getElementById("settings-api-status");
  if (statusEl) {
    statusEl.innerHTML = `
      <span style="font-size:12px;">Connection to Charlemagne: <strong style="color: ${charlColor};">${charlStatus}</strong><br/>
      Connection to TornAPI: <strong style="color: ${tornColor};">${tornStatus}</strong><br/>
      Version: <a href="https://www.torn.com/forums.php#/p=threads&f=999&t=16460741&b=1&a=36891&to=25815503" target="_blank" style="color: inherit; text-decoration: underline;">${FUTA.VERSION}</a><br/>
      Made by <a href="https://www.torn.com/profiles.php?XID=2270413" target="_blank" style="color: inherit; text-decoration: underline;">Asemov</a></span>`;
  }
}

  async function createChatButton() {
    if (document.getElementById("futa-toggle-button")) {
      return;
    }
    debugLog("Charlemagne has entered the building.");
    try {
      await waitForElm("body");
      const button = document.createElement("button");
      button.id = "futa-toggle-button";
      button.type = "button";
      button.setAttribute("aria-label", "Toggle Charlemagne panel");
      button.innerHTML = '<img src="https://i.imgur.com/8ULhpqB.png" alt="" aria-hidden="true" /><span class="sr-only">Charlemagne</span>';
      button.addEventListener("click", () => {
        if (button.dataset.futaPreventClick === 'true') return;
        togglePanel();
      });
      document.body.appendChild(button);
      makeMovable(button, { storageKey: 'futa_toggle_position', fallbackSize: { width: 64, height: 64 } });
      FUTA.chatButtonCreated = true;
      const panel = await createOrUpdateChatPanel();
      if (panel) {
        syncToggleButtonState(!panel.hidden);
      }
    } catch (e) {
      debugLog("Error creating toggle button, retrying: " + e);
      setTimeout(createChatButton, 500);
    }
  }

  async function createChatPanel() {
    await waitForElm("body");
    const savedKey = await GM.getValue("api_key", "");
    const wasOpen = await GM.getValue("charlemagne_panel_open", false);
    const cachedSummary = localStorage.getItem("lastSummary") || "Loading status...";
    const defaultModes = {
      request_bust: { enabled: false },
      request_revive: { enabled: false },
      big_boi_mode: { enabled: false, active: false },
      assist_mode: { enabled: false, active: false }
    };
    const storedModesStr = await GM.getValue("charlemagne_modes", JSON.stringify(defaultModes));
    let modes;
    try {
      modes = JSON.parse(storedModesStr);
    } catch (e) {
      debugLog("Error parsing stored modes, using defaults: " + e);
      modes = defaultModes;
    }

    const wrapper = document.createElement("div");
    wrapper.id = "futa-panel";
    wrapper.hidden = !wasOpen;
    wrapper.innerHTML = `
      <div class="futa-header">
        <div class="futa-title" id="charlemagne-header">
          <img src="https://i.imgur.com/8ULhpqB.png" alt="Charlemagne frog" />
          <div class="futa-title-text">
            <span class="futa-title-primary">Charlemagne</span>
            <span class="futa-title-sub">Flatline's Ultimate Torn Assistant</span>
          </div>
        </div>
      </div>
      <div class="futa-tabs" role="tablist">
        <button type="button" class="futa-tab" id="tab-main" role="tab" aria-controls="content-main">Main</button>
        <button type="button" class="futa-tab" id="tab-settings" role="tab" aria-controls="content-settings">Settings</button>
      </div>
      <div class="futa-content">
        <section id="content-main" class="futa-tab-panel" role="tabpanel" hidden>
          <div id="check-summary-box">
            ${cachedSummary}
          </div>
          <div id="action-buttons">
            <div class="button-row">
              <button id="request-bust" class="torn-btn" style="border-color: ${modes.request_bust.enabled ? 'gold' : 'grey'};" ${modes.request_bust.enabled ? '' : 'disabled'}>Request Bust</button>
              <button id="request-revive" class="torn-btn" style="border-color: ${modes.request_revive.enabled ? 'green' : 'grey'};" ${modes.request_revive.enabled ? '' : 'disabled'}>Request Revive</button>
            </div>
            <div class="button-row">
              <button id="big-boi-mode" class="torn-btn" style="border-color: ${modes.big_boi_mode.enabled ? (modes.big_boi_mode.active ? 'green' : 'red') : 'grey'};" ${modes.big_boi_mode.enabled ? '' : 'disabled'} data-enabled="${modes.big_boi_mode.active}">Big Boi Mode</button>
              <button id="assist-mode" class="torn-btn" style="border-color: ${modes.assist_mode.enabled ? (modes.assist_mode.active ? 'green' : 'red') : 'grey'};" ${modes.assist_mode.enabled ? '' : 'disabled'} data-enabled="${modes.assist_mode.active}">Assist Mode</button>
            </div>
          </div>
        </section>
        <section id="content-settings" class="futa-tab-panel" role="tabpanel" hidden>
          <div class="collapsible">
            <div class="collapsible-header">API Key:</div>
            <div class="collapsible-content">
              <div class="futa-inline-field">
                <input type="text" id="api-key" name="apikey" placeholder="Enter API Key" value="${savedKey}">
                <button id="save-api-key" class="torn-btn primary">Save</button>
              </div>
            </div>
          </div>
          <div class="collapsible">
            <div class="collapsible-header">Attack Settings:</div>
            <div class="collapsible-content">
              <label class="quick-attack-inline">
                <input type="checkbox" id="quick-attack-toggle">
                <span>Quick Attack:</span>
                <select id="quick-attack-action">
                  <option value="leave">Leave</option>
                  <option value="hospital">Hosp</option>
                  <option value="mug">Mug</option>
                </select>
              </label>
              <label><input type="checkbox" id="open-attack-new-tab"> Open attack in new tab</label>
              <label><input type="checkbox" id="minimize-on-attack"> Minimize on attack page</label>
              <label><input type="checkbox" id="hide-primary"> Hide Primary</label>
              <label><input type="checkbox" id="hide-secondary"> Hide Secondary</label>
              <label><input type="checkbox" id="hide-melee"> Hide Melee</label>
              <label><input type="checkbox" id="hide-temp"> Hide Temp</label>
              <input type="checkbox" id="execute-toggle" />
              <span>Execute</span>
              <span id="execute-threshold-display" class="execute-threshold">--</span>
              <label title="WIP"><input type="checkbox" id="assassinate-toggle"> Assassinate <small style="margin-left:6px;color:#888">(WIP)</small></label>
            </div>
          </div>
          <div class="collapsible">
            <div class="collapsible-header">User Settings:</div>
            <div class="collapsible-content">
              <label><input type="checkbox" id="charlemagne-alerts"> Charlemagne Alerts</label>
              <label><input type="checkbox" id="compact-mode-toggle"> Compact mode (mobile)</label>
              <label><input type="checkbox" id="ignore-bank"> ignore bank check</label>
              <label><input type="checkbox" id="ignore-medical"> ignore medical check</label>
              <label><input type="checkbox" id="ignore-booster"> ignore booster check</label>
              <label><input type="checkbox" id="ignore-drug"> ignore drug check</label>
              <label><input type="checkbox" id="ignore-travel"> ignore travel/racing check</label>
              <label><input type="checkbox" id="debugging-toggle"> debugging</label>
            </div>
          </div>
          <div id="settings-api-status"></div>
        </section>
      </div>
      <div id="persistent-banner"></div>
    `;
  document.body.appendChild(wrapper);
    try {
      const apiInput = wrapper.querySelector('#api-key');
      if (apiInput) {
        (async () => {
          const stored = await GM.getValue('api_key', '');
          apiInput.dataset.realKey = stored || '';
          apiInput.value = maskApiKey(stored || '');
          apiInput.dataset.futaMasked = (stored ? 'true' : 'false');
          apiInput.addEventListener('focus', () => {
            apiInput.dataset.futaMasked = 'false';
            apiInput.value = apiInput.dataset.realKey || '';
            setTimeout(() => {
              try { apiInput.selectionStart = apiInput.selectionEnd = apiInput.value.length; } catch (e) {}
            }, 0);
          });
          apiInput.addEventListener('blur', () => {
            const v = apiInput.value.trim();
            apiInput.dataset.realKey = v;
            apiInput.dataset.futaMasked = 'true';
            apiInput.value = maskApiKey(v);
          });
        })();
      }
    } catch (e) {
      debugLog('API key masking init failed: ' + e);
    }
    makeMovable(wrapper, {
      handle: wrapper.querySelector('.futa-header'),
      storageKey: 'futa_panel_position',
      fallbackSize: { width: 320, height: 420 }
    });

    try {
      const savedW = Number(await GM.getValue('futa_panel_width', 0));
      const savedH = Number(await GM.getValue('futa_panel_height', 0));
      if (savedW >= 260 && savedH >= 220) {
        wrapper.style.width = `${savedW}px`;
        wrapper.style.height = `${savedH}px`;
      }
    } catch (e) {
      debugLog('Error restoring saved panel size: ' + e);
    }

    try {
      const h = document.createElement('div');
      h.className = `futa-resize-handle futa-resize-se`;
      h.style.touchAction = 'none';
      h.style.position = 'absolute';
      h.style.right = '0px';
      h.style.bottom = '0px';
      h.style.width = '18px';
      h.style.height = '18px';
      h.style.zIndex = '2147483650';
      h.style.cursor = 'nwse-resize';
      try {
        const isDark = document.body.classList.contains('dark-mode');
        const cueColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
        h.style.borderRight = `2px solid ${cueColor}`;
        h.style.borderBottom = `2px solid ${cueColor}`;
        h.style.borderBottomRightRadius = '2px';
      } catch (_) {}
      wrapper.appendChild(h);

      let resizing = false;
      let resizeCorner = null;
      let startX = 0, startY = 0, startW = 0, startH = 0, startLeft = 0, startTop = 0;

      const onPointerDown = (ev) => {
        const handle = ev.target.closest('.futa-resize-handle');
        if (!handle) return;
        ev.preventDefault();
        resizing = true;
        const m = handle.className.match(/futa-resize-(nw|ne|sw|se)/);
        resizeCorner = m ? m[1] : null;
        startX = ev.clientX;
        startY = ev.clientY;
        const rect = wrapper.getBoundingClientRect();
        startW = rect.width;
        startH = rect.height;
        startLeft = rect.left + window.scrollX;
        startTop = rect.top + window.scrollY;
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp, { once: true });
      };

      const onPointerMove = (ev) => {
        if (!resizing) return;
        ev.preventDefault();
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let newW = startW;
        let newH = startH;
        let newLeft = startLeft;
        let newTop = startTop;
        if (resizeCorner === 'se') {
          newW = Math.max(260, Math.round(startW + dx));
          newH = Math.max(220, Math.round(startH + dy));
        } else if (resizeCorner === 'sw') {
          newW = Math.max(260, Math.round(startW - dx));
          newH = Math.max(220, Math.round(startH + dy));
          newLeft = Math.round(startLeft + dx);
        } else if (resizeCorner === 'ne') {
          newW = Math.max(260, Math.round(startW + dx));
          newH = Math.max(220, Math.round(startH - dy));
          newTop = Math.round(startTop + dy);
        } else if (resizeCorner === 'nw') {
          newW = Math.max(260, Math.round(startW - dx));
          newH = Math.max(220, Math.round(startH - dy));
          newLeft = Math.round(startLeft + dx);
          newTop = Math.round(startTop + dy);
        }
        wrapper.style.width = `${newW}px`;
        wrapper.style.height = `${newH}px`;
        if (newLeft !== startLeft) wrapper.style.left = `${newLeft}px`;
        if (newTop !== startTop) wrapper.style.top = `${newTop}px`;
      };

      const onPointerUp = (ev) => {
        if (!resizing) return;
        resizing = false;
        resizeCorner = null;
        document.removeEventListener('pointermove', onPointerMove);
        try {
          const rect = wrapper.getBoundingClientRect();
          GM.setValue('futa_panel_width', Math.round(rect.width));
          GM.setValue('futa_panel_height', Math.round(rect.height));
        } catch (e) {}
      };

      wrapper.addEventListener('pointerdown', onPointerDown);
    } catch (e) {
      debugLog('Corner resize setup failed: ' + e);
    }

    attachPanelSizePersistence(wrapper);
    setPanelMinHeightFromSettings();
    if (!panelResizeListenerAttached) {
      panelResizeListenerAttached = true;
      window.addEventListener('resize', () => setPanelMinHeightFromSettings());
    }
    _updateSettingsAPIStatus(FUTA.sharedPingData);

    await setupPanelEventListeners();
    setupCollapsibleSections();
    const alertsEnabled = await GM.getValue('charlemagne_alerts_enabled', false);
    FUTA.charlemagneAlertsEnabled = Boolean(alertsEnabled);
    if (FUTA.charlemagneAlertsEnabled) {
      await checkAlerts();
    }
    const lastTab = await GM.getValue(FUTA.tabStateKey, "content-main");
    const tabMap = { "content-main": "main", "content-settings": "settings" };
    const initialTab = tabMap[lastTab] || "main";
    debugLog(`Initial tab set to: ${initialTab}`);
    await _updatePanelContent(initialTab);
    if (!wrapper.hidden) {
      setPanelMinHeightFromSettings();
      requestAnimationFrame(() => setPanelMinHeightFromSettings());
    } else {
      setPanelMinHeightFromSettings();
    }
    syncToggleButtonState(!wrapper.hidden);
    return wrapper;
  }

  async function updateChatPanel() {
    await _updatePanelContent();
  }

  async function createOrUpdateChatPanel() {
    const panel = document.getElementById("futa-panel");
    if (panel) {
      debugLog("Updating existing Charlemagne panel...");
      await updateChatPanel();
      return panel;
    }
    return await createChatPanel();
  }

  async function _updatePanelContent(tabId) {
    if (!tabId) {
      const lastTab = await GM.getValue(FUTA.tabStateKey, "content-main");
      const tabMap = { "content-main": "main", "content-settings": "settings" };
      tabId = tabMap[lastTab] || "main";
    }
    debugLog(`Updating panel content for tab: ${tabId}`);

    const futaPanel = document.querySelector('#futa-panel');
    if (!futaPanel) {
      debugLog('Error: #futa-panel not found in the DOM');
      return;
    }

    const tabsContainer = futaPanel.querySelector('.futa-tabs');
    if (!tabsContainer) {
      debugLog('Error: .futa-tabs not found in #futa-panel');
      return;
    }

    const tabs = ['main', 'settings'];
    tabs.forEach(tab => {
      const tabElement = tabsContainer.querySelector(`#tab-${tab}`);
      if (!tabElement) {
        debugLog(`Error: Tab element #tab-${tab} not found`);
        return;
      }

      const contentElement = futaPanel.querySelector(`#content-${tab}`);
      if (!contentElement) {
        debugLog(`Error: Content element #content-${tab} not found`);
        return;
      }

      const isActive = tab === tabId;
      tabElement.classList.toggle('active', isActive);
      tabElement.setAttribute('aria-selected', isActive ? 'true' : 'false');
      contentElement.hidden = !isActive;
      contentElement.setAttribute('aria-hidden', (!isActive).toString());
    });
    const tabMap = { "main": "content-main", "settings": "content-settings" };
    if (tabMap[tabId]) {
      await GM.setValue(FUTA.tabStateKey, tabMap[tabId]);
    }
    const forceMeasure = tabId === 'settings';
    setPanelMinHeightFromSettings();
    requestAnimationFrame(() => setPanelMinHeightFromSettings());
  }

  async function setupPanelEventListeners() {
    const panel = document.getElementById("futa-panel");
    if (!panel) return;

    const debounce = (func, wait) => {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    };

    const handleTabSwitch = debounce(async (tabId) => {
      debugLog(`handleTabSwitch called for tab: ${tabId}`);
      const tabMap = { "tab-main": "main", "tab-settings": "settings" };
      if (!tabMap[tabId]) {
        debugLog(`Invalid tabId: ${tabId}`);
        return;
      }
      await _updatePanelContent(tabMap[tabId]);
    }, 100);

    panel.addEventListener("click", async (event) => {
      const target = event.target;
      const tabButton = target.closest(".futa-tab");
      if (tabButton) {
        await handleTabSwitch(tabButton.id);
        return;
      }

      if (target.closest("#save-api-key")) {
        const apiEl = document.getElementById("api-key");
        let key = '';
        if (apiEl) {
          if (apiEl.dataset && apiEl.dataset.futaMasked === 'true') {
            key = apiEl.dataset.realKey || '';
          } else {
            key = (apiEl.value || '').trim();
          }
        } else {
          key = document.getElementById("api-key").value.trim();
        }
        if (!key) return alert("Please enter an API key.");
        await GM.setValue("api_key", key);
        await GM.setValue("api_key_provided", true);
        const faction = await GM.getValue("user_faction", "Flatline");
        const baseEndpoint = FACTION_ENDPOINTS[faction] || FACTION_ENDPOINTS.Flatline;
        GM.xmlHttpRequest({
          method: "POST",
          url: `${baseEndpoint}/submit-key`,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ api_key: key }),
          onload: async (res) => {
            console.log("[FUTA] submit-key status:", res.status);
            console.log("[FUTA] submit-key raw response:", res.responseText);
            try {
              const response = JSON.parse(res.responseText);
              if (response.success) {
                await GM.setValue("unique_identifier", response.identifier);
                await GM.setValue("user_faction", response.modes.big_boi_mode.enabled ? faction : "Flatline");
                await GM.setValue("charlemagne_modes", JSON.stringify(response.modes));
                alert(`API Key saved and submitted successfully. Welcome, ${response.name}!`);
                const modes = response.modes;

                const requestBustBtn = document.getElementById("request-bust");
                requestBustBtn.disabled = !modes.request_bust.enabled;
                requestBustBtn.style.borderColor = modes.request_bust.enabled ? "gold" : "grey";

                const requestReviveBtn = document.getElementById("request-revive");
                requestReviveBtn.disabled = !modes.request_revive.enabled;
                requestReviveBtn.style.borderColor = modes.request_revive.enabled ? "green" : "grey";

                const bigBoiBtn = document.getElementById("big-boi-mode");
                bigBoiBtn.disabled = !modes.big_boi_mode.enabled;
                bigBoiBtn.setAttribute("data-enabled", modes.big_boi_mode.active);
                bigBoiBtn.style.borderColor = modes.big_boi_mode.enabled ? (modes.big_boi_mode.active ? "green" : "red") : "grey";
                await GM.setValue("big_boi_mode_enabled", modes.big_boi_mode.active);

                const assistBtn = document.getElementById("assist-mode");
                assistBtn.disabled = !modes.assist_mode.enabled;
                assistBtn.setAttribute("data-enabled", modes.assist_mode.active);
                assistBtn.style.borderColor = modes.assist_mode.enabled ? (modes.assist_mode.active ? "green" : "red") : "grey";
                await GM.setValue("assist_mode_enabled", modes.assist_mode.active);

                updateAllStatuses();
              } else {
                alert(`❌ Failed to submit API key to Charlemagne: ${response.error}`);
              }
            } catch (e) {
              console.log("[FUTA] JSON parse error:", e);
              alert(`❌ Server returned invalid response (status ${res.status}). API key saved locally but not submitted.`);
            }
          },
          onerror: () => alert("❌ Error connecting to Charlemagne server. API key saved locally but not submitted.")
        });
      } else if (target.closest("#request-bust")) {
        const key = await GM.getValue("api_key", "");
        const faction = await GM.getValue("user_faction", "Flatline");
        const baseEndpoint = FACTION_ENDPOINTS[faction] || FACTION_ENDPOINTS.Flatline;
        if (!key) return alert("Please set your API key in the Settings tab.");
        GM.xmlHttpRequest({
          method: "POST",
          url: `${baseEndpoint}/trigger-bust`,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ api_key: key }),
          onload: () => alert("✅ Bust request sent!"),
          onerror: () => alert("❌ Error sending bust request.")
        });
      } else if (target.closest("#request-revive")) {
        alert("Request Revive placeholder. Functionality coming soon.");
      } else if (target.closest("#big-boi-mode")) {
        const bigBoiBtn = document.getElementById("big-boi-mode");
        if (bigBoiBtn.disabled) return;
        const current = bigBoiBtn.getAttribute("data-enabled") === "true";
        const newState = !current;
        const key = await GM.getValue("api_key", "");
        const faction = await GM.getValue("user_faction", "Flatline");
        const baseEndpoint = FACTION_ENDPOINTS[faction] || FACTION_ENDPOINTS.Flatline;
        GM.xmlHttpRequest({
          method: "POST",
          url: `${baseEndpoint}/toggleBigBoiMode`,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ api_key: key, enabled: newState }),
          onload: async (res) => {
            const response = JSON.parse(res.responseText);
            if (response.status === "ok") {
              bigBoiBtn.setAttribute("data-enabled", newState);
              bigBoiBtn.style.borderColor = newState ? "green" : "red";
              await GM.setValue("big_boi_mode_enabled", newState);
              const storedModesStr = await GM.getValue("charlemagne_modes", "{}");
              const modes = JSON.parse(storedModesStr);
              modes.big_boi_mode.active = newState;
              await GM.setValue("charlemagne_modes", JSON.stringify(modes));
              debugLog("Big boi mode updated on server: " + res.responseText);
            } else {
              alert("❌ Failed to update Big Boi Mode: " + response.error);
            }
          },
          onerror: () => {
            debugLog("Error updating big boi mode on server");
            alert("❌ Error updating Big Boi Mode on server.");
          }
        });
      } else if (target.closest('#charlemagne-alerts')) {
        const chk = document.getElementById('charlemagne-alerts');
        await GM.setValue('charlemagne_alerts_enabled', chk.checked);
        FUTA.charlemagneAlertsEnabled = Boolean(chk.checked);
        if (FUTA.charlemagneAlertsEnabled) {
          checkAlerts();
        } else {
          updateToggleBadge(0);
        }
      } else if (target.closest("#assist-mode")) {
        const assistBtn = document.getElementById("assist-mode");
        const current = assistBtn.getAttribute("data-enabled") === "true";
        const newState = !current;
        const key = await GM.getValue("api_key", "");
        const faction = await GM.getValue("user_faction", "Flatline");
        const baseEndpoint = FACTION_ENDPOINTS[faction] || FACTION_ENDPOINTS.Flatline;
        GM.xmlHttpRequest({
          method: "POST",
          url: `${baseEndpoint}/toggleAssistMode`,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ api_key: key, enabled: newState }),
          onload: async (res) => {
            const response = JSON.parse(res.responseText);
            if (response.status === "ok") {
              assistBtn.setAttribute("data-enabled", newState);
              assistBtn.style.borderColor = newState ? "green" : "red";
              await GM.setValue("assist_mode_enabled", newState);
              const storedModesStr = await GM.getValue("charlemagne_modes", "{}");
              const modes = JSON.parse(storedModesStr);
              modes.assist_mode.active = newState;
              await GM.setValue("charlemagne_modes", JSON.stringify(modes));
              debugLog("Assist mode updated on server: " + res.responseText);
            } else {
              alert("❌ Failed to update Assist Mode: " + response.error);
            }
          },
          onerror: () => {
            debugLog("Error updating assist mode on server");
            alert("❌ Error updating Assist Mode on server.");
          }
        });
      }
      setPanelMinHeightFromSettings();
    });
  const toggles = [
      { id: "quick-attack-toggle", key: "quick_attack_enabled" },
      { id: "open-attack-new-tab", key: "open_attack_new_tab" },
      { id: "minimize-on-attack", key: "minimize_on_attack" },
      { id: "hide-primary", key: "hide_primary" },
      { id: "hide-secondary", key: "hide_secondary" },
      { id: "hide-melee", key: "hide_melee" },
      { id: "hide-temp", key: "hide_temp" },
      { id: "assassinate-toggle", key: "assassinate" },
      { id: "execute-toggle", key: "execute_enabled" },
      { id: "ignore-bank", key: "ignore_bank" },
      { id: "ignore-medical", key: "ignore_medical" },
      { id: "ignore-booster", key: "ignore_booster" },
      { id: "ignore-drug", key: "ignore_drug" },
      { id: "ignore-travel", key: "ignore_travel" },
      { id: "debugging-toggle", key: "debug_mode" },
      { id: "charlemagne-alerts", key: "charlemagne_alerts_enabled" }
    ];
    for (const { id, key } of toggles) {
      const el = document.getElementById(id);
      if (el) {
        el.checked = await GM.getValue(key, false);
        if (key === 'assassinate') FUTA.assassinate = el.checked;
        if (key === 'hide_primary') toggleRootHideClass(document.documentElement, 'primary', el.checked);
        if (key === 'hide_secondary') toggleRootHideClass(document.documentElement, 'secondary', el.checked);
        if (key === 'hide_melee') toggleRootHideClass(document.documentElement, 'melee', el.checked);
        if (key === 'hide_temp') toggleRootHideClass(document.documentElement, 'temp', el.checked);
        el.addEventListener("change", async () => {
          await GM.setValue(key, el.checked);
          if (key === 'assassinate') FUTA.assassinate = el.checked;
          if (key === 'hide_primary') { localStorage.setItem('futa_hide_primary', String(el.checked)); toggleRootHideClass(document.documentElement, 'primary', el.checked); }
          if (key === 'hide_secondary') { localStorage.setItem('futa_hide_secondary', String(el.checked)); toggleRootHideClass(document.documentElement, 'secondary', el.checked); }
          if (key === 'hide_melee') { localStorage.setItem('futa_hide_melee', String(el.checked)); toggleRootHideClass(document.documentElement, 'melee', el.checked); }
          if (key === 'hide_temp') { localStorage.setItem('futa_hide_temp', String(el.checked)); toggleRootHideClass(document.documentElement, 'temp', el.checked); }
          if (key === "open_attack_new_tab") openAttackNewTab = el.checked;
          if (key === "minimize_on_attack") {
            minimizeOnAttack = el.checked;
            if (minimizeOnAttack) maybeMinimizePanelForAttack('settings-toggle');
          }
          if (key === "quick_attack_enabled") {
            void updateQuickAttackUI();
          }
          if (key === "debug_mode") FUTA.debugEnabled = el.checked;
          if (key === "charlemagne_alerts_enabled") {
            FUTA.charlemagneAlertsEnabled = Boolean(el.checked);
            if (FUTA.charlemagneAlertsEnabled) {
              checkAlerts();
            } else {
              updateToggleBadge(0);
            }
          }
        });
      }
    }

    const attackExecuteInput = document.getElementById("attack-execute");
    if (attackExecuteInput) {
      attackExecuteInput.value = await GM.getValue("attack_execute", "60");
      attackExecuteInput.addEventListener("change", () => GM.setValue("attack_execute", attackExecuteInput.value));
    }

    const quickAttackActionSelect = document.getElementById("quick-attack-action");
    if (quickAttackActionSelect) {
      quickAttackActionSelect.value = await GM.getValue("quick_attack_action", "leave");
      quickAttackActionSelect.addEventListener("change", () => {
        GM.setValue("quick_attack_action", quickAttackActionSelect.value);
        void updateQuickAttackUI();
      });
    }
  }

    (async () => {
      try {
        const compactToggle = document.getElementById('compact-mode-toggle');
        if (compactToggle) {
          const isPDA = !!(window.location.hostname && window.location.hostname.includes('tornpda'));
          const stored = await GM.getValue('futa_compact_mode', isPDA);
          compactToggle.checked = Boolean(stored);
          const panelEl = document.getElementById('futa-panel');
          if (panelEl) panelEl.classList.toggle('futa-compact', Boolean(stored));
          compactToggle.addEventListener('change', async () => {
            await GM.setValue('futa_compact_mode', compactToggle.checked);
            if (panelEl) panelEl.classList.toggle('futa-compact', compactToggle.checked);
            setPanelMinHeightFromSettings();
          });
        }
      } catch (e) {
        debugLog('Compact mode init failed: ' + e);
      }
    })();

  async function checkAlerts() {
    try {
      const alerts = [];
      const api_key = await GM.getValue('api_key', '');
      const ignores = {
        ignore_travel: await GM.getValue('ignore_travel', false),
        ignore_drug: await GM.getValue('ignore_drug', false),
        ignore_booster: await GM.getValue('ignore_booster', false),
        ignore_medical: await GM.getValue('ignore_medical', false)
      };

      if (api_key) {
        const summary = await fetchCheckSummary();
        const lines = (summary || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
        const nerveLine = lines.find(l => /nerve/i.test(l) && /refill/i.test(l));
        if (nerveLine && /haven't used/i.test(nerveLine)) alerts.push("You haven't used your nerve refill today.");
        if (!ignores.ignore_drug && lines.some(l => /not currently on any drugs/i.test(l) || /no drugs/i.test(l))) {
          alerts.push("You're not currently on any drugs.");
        }
        if (!ignores.ignore_booster && lines.some(l => /not using your booster cooldown/i.test(l) || /booster/i.test(l) && /0\b/.test(l))) {
          alerts.push("You're not using your booster cooldown.");
        }
        if (!ignores.ignore_medical && lines.some(l => /not using your medical cooldown/i.test(l) || /medical/i.test(l) && /0\b/.test(l))) {
          alerts.push("You're not using your medical cooldown.");
        }
        if (!ignores.ignore_travel) {
          const negativeTravelLine = lines.find(l => /not currently racing or traveling|not currently racing|not currently traveling|not currently travelling/i.test(l));
          if (negativeTravelLine) {
            alerts.push("You aren't currently racing/travelling");
          }
        }
      } else {
        const nerveEl = document.querySelector('#nerve-refill-status, .refills, [data-refills]');
        if (!nerveEl || /haven'?t used your nerve refill/i.test(nerveEl.innerText || '')) {
          alerts.push("You haven't used your nerve refill today.");
        }
        if (!ignores.ignore_drug) {
          const drugEl = document.querySelector('.drug-status, #drug-status, .drug-info');
          if (!drugEl || /not currently on any drugs|no drugs active/i.test(drugEl.innerText || '')) alerts.push("You're not currently on any drugs.");
        }
        if (!ignores.ignore_booster) {
          const boosterEl = document.querySelector('.booster-cooldown, #booster-cooldown, .booster-info');
          if (!boosterEl || /booster ready|no booster/i.test(boosterEl.innerText || '')) alerts.push("You're not using your booster cooldown.");
        }
        if (!ignores.ignore_medical) {
          const medicalEl = document.querySelector('.medical-cooldown, #medical-cooldown, .medical-info');
          if (!medicalEl || /medical ready|no medical/i.test(medicalEl.innerText || '')) alerts.push("You're not using your medical cooldown.");
        }
      }
      const ignoreTravel = await GM.getValue('ignore_travel', false);
      if (!api_key && !ignoreTravel) {
        let isTravelling = false;
        try {
          if (window.topBannerInitData && window.topBannerInitData.user && window.topBannerInitData.user.state) {
            isTravelling = Boolean(window.topBannerInitData.user.state.isTravelling || window.topBannerInitData.user.state.isTravelling === true || window.topBannerInitData.user.state.isTravelling === 'true');
          }
        } catch (e) {
          isTravelling = false;
        }
        if (!isTravelling) {
          const bodyTrav = document.body && (document.body.getAttribute('data-traveling') === 'true' || document.body.getAttribute('data-travelling') === 'true');
          if (!bodyTrav) alerts.push("You aren't currently racing/travelling");
        }
      }
      const uniqueAlerts = Array.from(new Set(alerts.map(a => (a || '').trim()))).filter(Boolean);
      FUTA._lastAlerts = uniqueAlerts;
      updateToggleBadge(uniqueAlerts.length);
      const summaryBox = document.getElementById('check-summary-box');
      if (summaryBox) {
        if (uniqueAlerts.length === 0) {
          summaryBox.textContent = 'All good — no Charlemagne alerts.';
        } else {
          summaryBox.innerHTML = uniqueAlerts.map(a => `<div class="futa-alert">${a}</div>`).join('');
        }
      }
    } catch (e) {
      debugLog('checkAlerts error: ' + e);
    }
  }

  function updateToggleBadge(count) {
    const btn = document.getElementById('futa-toggle-button');
    if (!btn) return;
    const existing = btn.querySelector('.futa-alert-badge');
    if (existing) existing.remove();
    btn.classList.toggle('futa-alert-active', Boolean(count && count > 0));
    if (!count || count === 0) return;
    const badge = document.createElement('span');
    badge.className = 'futa-alert-badge';
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.position = 'absolute';
    badge.style.right = '2px';
    badge.style.top = '2px';
    badge.style.background = '#ff0000ff';
    badge.style.color = 'white';
    badge.style.borderRadius = '8px';
    badge.style.padding = '2px 5px';
    badge.style.fontSize = '11px';
    badge.style.zIndex = '9999';
    btn.appendChild(badge);
  }

  function setupCollapsibleSections() {
    document.querySelectorAll('#futa-panel .collapsible').forEach(section => {
      const header = section.querySelector('.collapsible-header');
      const content = section.querySelector('.collapsible-content');
      if (!header || !content) return;
      const sectionKey = 'collapsible_' + header.textContent.trim().replace(/\s+/g, '_');
      GM.getValue(sectionKey, "block").then(savedDisplay => {
        content.style.display = savedDisplay;
        section.classList.toggle('collapsed', savedDisplay === "none");
      });
      header.addEventListener('click', () => {
        const isHidden = content.style.display === "none";
        const newDisplay = isHidden ? "block" : "none";
        content.style.display = newDisplay;
        section.classList.toggle('collapsed', newDisplay === "none");
        GM.setValue(sectionKey, newDisplay);
        setPanelMinHeightFromSettings();
      });
    });
  }

  const FUTA_ATTACK_SESSION_KEY = 'futa_attack_tab';
  const FUTA_ATTACK_REDIRECT_KEY = 'futa_attack_redirect';
  let lastHandledAttackNavigation = { url: null, time: 0 };

  function normalizeAttackUrl(url) {
    if (!url) return null;
    try {
      const absolute = new URL(url, window.location.origin);
      if (absolute.pathname !== '/loader.php') return null;
      if (absolute.searchParams.get('sid') !== 'attack') return null;
      if (!absolute.searchParams.get('user2ID')) return null;
      absolute.hash = '';
      return absolute.href;
    } catch (err) {
      debugLog('normalizeAttackUrl error: ' + err);
      return null;
    }
  }

  function isAttackUrl(url) {
    return Boolean(normalizeAttackUrl(url));
  }

  function markAttackTabIfExpected() {
    try {
      const payload = localStorage.getItem(FUTA_ATTACK_REDIRECT_KEY);
      if (!payload) return;
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed.url !== 'string' || typeof parsed.time !== 'number') {
        localStorage.removeItem(FUTA_ATTACK_REDIRECT_KEY);
        return;
      }
      const normalizedCurrent = normalizeAttackUrl(window.location.href);
      if (normalizedCurrent && normalizedCurrent === parsed.url && (Date.now() - parsed.time) < 5000) {
        sessionStorage.setItem(FUTA_ATTACK_SESSION_KEY, 'true');
        localStorage.removeItem(FUTA_ATTACK_REDIRECT_KEY);
        debugLog('Marked current tab as attack target.');
      }
    } catch (err) {
      debugLog('markAttackTabIfExpected error: ' + err);
      localStorage.removeItem(FUTA_ATTACK_REDIRECT_KEY);
    }
  }

  function rememberAttackRedirect(targetUrl) {
    try {
      localStorage.setItem(FUTA_ATTACK_REDIRECT_KEY, JSON.stringify({ url: targetUrl, time: Date.now() }));
    } catch (err) {
      debugLog('rememberAttackRedirect error: ' + err);
    }
  }

  function isCurrentTabAttackTarget() {
    return sessionStorage.getItem(FUTA_ATTACK_SESSION_KEY) === 'true';
  }

  async function maybeMinimizePanelForAttack(reason = 'unknown') {
    if (!minimizeOnAttack) return;
    const isAttack = window.location.href.includes('loader.php?sid=attack');
    if (!isAttack) return;
    debugLog(`Attempting to minimize panel due to attack page (${reason}).`);
    const panel = document.getElementById('futa-panel');
    if (panel) {
      if (!panel.hidden) {
        await togglePanel(false);
      } else {
        await GM.setValue('charlemagne_panel_open', false);
      }
    } else {
      await GM.setValue('charlemagne_panel_open', false);
    }
  }

  function maybeHandleAttackNavigation(rawUrl, source = 'unknown') {
    if (!openAttackNewTab) return false;
    const normalized = normalizeAttackUrl(rawUrl);
    if (!normalized) return false;
    if (isCurrentTabAttackTarget()) {
      debugLog(`Attack navigation ignored in designated attack tab (${source}).`);
      return false;
    }
    const now = Date.now();
    if (lastHandledAttackNavigation.url === normalized && (now - lastHandledAttackNavigation.time) < 500) {
      debugLog(`Attack navigation throttled for ${normalized} (${source}).`);
      return true;
    }
    lastHandledAttackNavigation = { url: normalized, time: now };
    debugLog(`Opening attack in new tab from ${source}: ${normalized}`);
    rememberAttackRedirect(normalized);
    openAttack(normalized, { forceNewTab: true });
    return true;
  }

  function setupAttackLinkInterception() {
    const handler = (event) => {
      if (!openAttackNewTab) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      const url = anchor.href || href;
      if (!isAttackUrl(url)) return;
      event.preventDefault();
      event.stopPropagation();
      try { event.stopImmediatePropagation(); } catch (_err) { }
      maybeHandleAttackNavigation(url, 'click');
    };
    document.addEventListener('click', handler, true);
  }

  function hookHistoryForAttackBindings() {
    const rebindIfAttack = () => {
      if (location.href.includes('loader.php?sid=attack')) {
        enableQuickAttackAndHiding();
      }
    };

    const _pushState = history.pushState;
    const _replaceState = history.replaceState;

    history.pushState = function(state, title, url) {
      if (maybeHandleAttackNavigation(url, 'pushState')) return;
      const ret = _pushState.apply(this, arguments);
      setTimeout(rebindIfAttack, 0);
      return ret;
    };

    history.replaceState = function(state, title, url) {
      if (maybeHandleAttackNavigation(url, 'replaceState')) return;
      const ret = _replaceState.apply(this, arguments);
      setTimeout(rebindIfAttack, 0);
      return ret;
    };

    window.addEventListener('popstate', rebindIfAttack);
  }

  function syncToggleButtonState(isOpen) {
    const button = document.getElementById("futa-toggle-button");
    if (!button) return;
    button.classList.toggle("active", isOpen);
    button.setAttribute("aria-pressed", isOpen ? "true" : "false");
    button.setAttribute("title", isOpen ? "Hide Charlemagne" : "Show Charlemagne");
  }

  async function togglePanel(forceOpen) {
    let panel = document.getElementById("futa-panel");
    if (!panel) {
      panel = await createOrUpdateChatPanel();
    }
    if (!panel) return;

    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
    panel.hidden = !shouldOpen;
    await GM.setValue("charlemagne_panel_open", shouldOpen);
    syncToggleButtonState(shouldOpen);
    if (shouldOpen) {
      setPanelMinHeightFromSettings();
      requestAnimationFrame(() => setPanelMinHeightFromSettings());
    }
  }

  async function updateMainTabSummary() {
    const summaryBox = document.getElementById("check-summary-box");
    if (!summaryBox) return;
    const now = Date.now();
    const lastSummaryTimestamp = parseInt(localStorage.getItem("lastSummaryTimestamp") || "0", 10);
    const cachedSummary = localStorage.getItem("lastSummary");
    if ((now - lastSummaryTimestamp) < FUTA.UPDATE_INTERVAL && cachedSummary) {
      summaryBox.innerText = cachedSummary;
    } else {
      summaryBox.innerText = await fetchCheckSummary();
    }
  }

  async function getWeaponType(markerId) {
    if (markerId.includes("Primary")) return "primary";
    if (markerId.includes("Secondary")) return "secondary";
    if (markerId.includes("Melee")) return "melee";
    if (markerId.includes("Temporary")) return "temp";
    return null;
  }


async function enableQuickAttackAndHiding() {
  const settings = {
    quick: await GM.getValue("quick_attack_enabled", false),
    primary: await GM.getValue("hide_primary", false),
    secondary: await GM.getValue("hide_secondary", false),
    melee: await GM.getValue("hide_melee", false),
    temp: await GM.getValue("hide_temp", false),
    assassinate: await GM.getValue("assassinate", false)
  };

  const hiddenWeaponTypes = new Set();
  let hiddenWeaponLogTimer = null;
  let lastHiddenWeaponSignature = "";
  const scheduleHiddenWeaponsLog = () => {
    if (!FUTA.debugEnabled || hiddenWeaponTypes.size === 0) return;
    if (hiddenWeaponLogTimer) clearTimeout(hiddenWeaponLogTimer);
    hiddenWeaponLogTimer = setTimeout(() => {
      hiddenWeaponLogTimer = null;
      if (!FUTA.debugEnabled || hiddenWeaponTypes.size === 0) return;
      const names = Array.from(hiddenWeaponTypes)
        .sort()
        .map((type) => type.charAt(0).toUpperCase() + type.slice(1));
      const signature = names.join('|');
      if (signature === lastHiddenWeaponSignature) return;
      lastHiddenWeaponSignature = signature;
      debugLog(`[Debug] Hid weapons: ${names.join(', ')}`);
    }, 150);
  };

  let fightState = "pre-fight";
  let lastClickTime = 0;
  let hasAssassinated = false;
  let shouldForceAssassinate = false;

  const globalWeaponClickInterceptor = (e) => {
    try {
      if (!e.isTrusted) return;
      const clicked = e.target && e.target.closest ? e.target.closest('.weaponWrapper___h3buK') : null;
      if (!clicked) return;
      const currentFightState = determineFightState();
      if (currentFightState !== 'in-fight') return;
      if (!FUTA.assassinate || hasAssassinated) {
        if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: assassinate not armed or already used');
        return;
      }

      const assassinateWrapper = Array.from(document.querySelectorAll('.weaponWrapper___h3buK'))
        .find(w => w.querySelector('i.bonus-attachment-assassinate'));
      if (!assassinateWrapper) {
        shouldForceAssassinate = false;
        if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: no assassinate wrapper found');
        return;
      }
      if (assassinateWrapper === clicked) {
        shouldForceAssassinate = false;
        hasAssassinated = true;
        if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: user clicked assassinate wrapper directly; marking consumed');
        try { document.removeEventListener('click', globalWeaponClickInterceptor, true); } catch (_) {}
        return;
      }

      shouldForceAssassinate = false;
      hasAssassinated = true;
      if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: redirecting first in-fight click to assassinate wrapper');
      try { assassinateWrapper.dataset.futaSynthetic = '1'; } catch (_) {}
      assassinateWrapper.click();
      try { document.removeEventListener('click', globalWeaponClickInterceptor, true); } catch (_) {}
      try {
        const inner = assassinateWrapper.querySelector('.topMarker___OjRyU, button, a, [role="button"]');
        const targetEl = inner || assassinateWrapper;
        const rect = targetEl.getBoundingClientRect();
        const cx = Math.round(rect.left + rect.width / 2);
        const cy = Math.round(rect.top + rect.height / 2);
        if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: dispatching pointer events to target:', targetEl.tagName, 'coords', cx, cy);
        targetEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerType: 'mouse' }));
        targetEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerType: 'mouse' }));
        targetEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));

        setTimeout(() => {
          try {
            const checkActive = () => {
              const top = assassinateWrapper.querySelector('.topMarker___OjRyU[aria-pressed="true"], .topMarker___OjRyU.active, .topMarker___OjRyU[data-selected="true"]');
              const glow = /\bglow[-_\w]*\b/.test(assassinateWrapper.className || '');
              return !!top || glow;
            };
            if (checkActive()) {
              if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: assassinate click registered');
              return;
            }
            for (let attempt = 1; attempt <= 2; attempt++) {
              if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: retrying assassinate click, attempt ' + attempt);
              const tryEl = assassinateWrapper.querySelector('.topMarker___OjRyU, button, a, [role="button"]') || assassinateWrapper;
              try { tryEl.click(); } catch (_) {}
              try {
                const r = tryEl.getBoundingClientRect();
                const tx = Math.round(r.left + r.width / 2);
                const ty = Math.round(r.top + r.height / 2);
                tryEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, pointerType: 'mouse' }));
                tryEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, pointerType: 'mouse' }));
                tryEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: tx, clientY: ty }));
              } catch (_) {}
              if (checkActive()) {
                if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: assassinate click registered on retry ' + attempt);
                return;
              }
            }
            if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor: failed to register assassinate click after retries');
          } catch (err) {
            if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor verify error: ' + err);
          }
        }, 150);
      } catch (err) { if (FUTA.debugEnabled) debugLog('globalWeaponClickInterceptor fallback error: ' + err); }
      e.stopPropagation();
      e.preventDefault();
    } catch (err) {
      debugLog('globalWeaponClickInterceptor error: ' + err);
    }
  };
  document.addEventListener('click', globalWeaponClickInterceptor, true);

  const isAttackPage = () => {
    return window.location.href.includes("loader.php?sid=attack") && window.location.search.includes("user2ID=");
  };

  const determineFightState = () => {
    const startBtn = document.querySelector(`[class*='dialogButtons_'] button.torn-btn[type="submit"]`);
    const inFightUI = document.querySelector(".attackWrapper___p0_It");
    const postFightContainer = document.querySelector("div.dialogButtons___nX4Bz");

    if (startBtn && (startBtn.textContent.trim() === "Start Fight" || startBtn.textContent.includes("Start Fight ("))) {
      fightState = "pre-fight";
      debugLog("Fight state: pre-fight (Start Fight button found)");
    } else if (inFightUI) {
      fightState = "in-fight";
      debugLog("Fight state: in-fight (attackWrapper found)");
    } else if (postFightContainer) {
      const buttons = postFightContainer.querySelectorAll("button.torn-btn");
      const postFightButtonNames = ["leave", "mug", "hospitalize", "hosp"];
      let isPostFight = false;
      const buttonTexts = [];

      buttons.forEach(btn => {
        const btnText = btn.innerText.trim().toLowerCase();
        buttonTexts.push(btnText);
        if (postFightButtonNames.includes(btnText)) {
          isPostFight = true;
        }
      });

      debugLog(`Post-fight buttons found: ${buttonTexts.join(", ")}`);
      if (isPostFight && buttons.length > 0) {
        fightState = "post-fight";
        debugLog("Fight state: post-fight (post-fight buttons matched)");
      } else {
        fightState = "pre-fight";
        debugLog("Fight state: pre-fight (post-fight container found but no valid post-fight buttons)");
      }
    } else {
      fightState = "pre-fight";
      debugLog("Fight state: pre-fight (default state)");
    }
    return fightState;
  };

  if (isAttackPage()) {
    if (FUTA.debugEnabled) {
      initAttackDebug('attack-page-entry');
    }
    debugLog("On attack page, setting up fight state observer...");
    let prevState = "pre-fight";
    hasAssassinated = false;
    const stateObserver = new MutationObserver(async () => {
      const newState = determineFightState();
      if (newState === "pre-fight" && prevState !== "pre-fight") {
        hasAssassinated = false;
        shouldForceAssassinate = false;
        if (FUTA.debugEnabled) {
          initAttackDebug('state-pre-fight');
        }
      }
      if (settings.assassinate && prevState !== "in-fight" && newState === "in-fight") {
        debugLog("Assassinate: armed for first in-fight click");
        shouldForceAssassinate = true;
      }
      if (newState === "post-fight") {
        void updateQuickAttackUI();
        if (FUTA.debugEnabled) {
          finalizeAttackDebug('post-fight');
        }
      }
      if (newState === "in-fight" && FUTA.debugEnabled) {
        refreshAttackDebugPerks('state-in-fight');
      }
      prevState = newState;
    });
    stateObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    if (FUTA.debugEnabled) {
      finalizeAttackDebug('not-attack-page');
    }
    debugLog("Not on attack page, skipping fight state observer setup.");
  }
  async function bindWeaponWrapper(wrapper) {
    try {
      if (!wrapper || wrapper.dataset.quickBound) return;
      wrapper.dataset.quickBound = "true";
      if (FUTA.debugEnabled) debugLog('bindWeaponWrapper: bound wrapper', wrapper?.id || '(no-id)', wrapper?.className || '');
      const marker = wrapper.querySelector(".topMarker___OjRyU");
      const type = await getWeaponType(marker?.id || "");
      const img = wrapper.querySelector("img");
      if (img && type && settings[type]) {
        const name = img.alt || type.charAt(0).toUpperCase() + type.slice(1);
        img.style.display = "none";
        const label = document.createElement("div");
        label.className = "hide-label";
        label.textContent = name;
        label.style.color = "#aaa";
        label.style.textAlign = "center";
        label.style.fontSize = "14px";
        label.style.margin = "6px";
        label.style.fontWeight = "bold";
        if (!img.parentNode.contains(label)) img.parentNode.appendChild(label);
        if (!hiddenWeaponTypes.has(type)) {
          hiddenWeaponTypes.add(type);
          scheduleHiddenWeaponsLog();
        }
      }
      if (FUTA.debugEnabled) {
        refreshAttackDebugPerks('weapon-bind');
      }

      wrapper.addEventListener("click", async (e) => {
        if (!e.isTrusted && wrapper.dataset.futaSynthetic !== '1') {
          if (FUTA.debugEnabled) debugLog('bindWeaponWrapper: ignored non-trusted click and no synthetic marker present');
          return;
        }
        if (wrapper.dataset.futaSynthetic === '1') {
          try { delete wrapper.dataset.futaSynthetic; } catch (err) { wrapper.removeAttribute('data-futa-synthetic'); }
          if (FUTA.debugEnabled) debugLog('bindWeaponWrapper: consumed synthetic click marker on wrapper');
        }
        const now = Date.now();
        if (now - lastClickTime < 300) return;
        lastClickTime = now;

        const currentFightState = isAttackPage() ? determineFightState() : "pre-fight";
        debugLog(`Weapon clicked, fight state: ${currentFightState}`);

        if (currentFightState === "in-fight") {
          incrementAttackDebugCounter('weapon-click');
        }

        try {
          if (currentFightState === "in-fight" && settings.assassinate && shouldForceAssassinate && !hasAssassinated) {
            const assassinateWrapper = Array.from(document.querySelectorAll('.weaponWrapper___h3buK'))
              .find(w => w.querySelector('i.bonus-attachment-assassinate'));
            if (assassinateWrapper && assassinateWrapper !== wrapper) {
              hasAssassinated = true;
              shouldForceAssassinate = false;
              debugLog('Assassinate: redirecting first in-fight click to assassinate weapon');
              try { assassinateWrapper.dataset.futaSynthetic = '1'; } catch (err) { }
              assassinateWrapper.click();
              e.stopPropagation();
              e.preventDefault();
              return;
            }
          }

          const isExecEnabled = await GM.getValue('execute_enabled', false);
          if (isExecEnabled && currentFightState === "in-fight") {
            const execActive = await isExecuteActive();
            if (execActive) {
              const highlighted = Array.from(document.querySelectorAll('.weaponWrapper___h3buK'))
                .find(w => {
                  const classStr = w.className || '';
                  const hasGlow = /\bglow[-_\w]*\b/.test(classStr);
                  const topMarkerActive = !!w.querySelector('.topMarker___OjRyU[aria-pressed="true"], .topMarker___OjRyU.active, .topMarker___OjRyU[data-selected="true"]');
                  const isHighlighted = hasGlow || topMarkerActive || document.activeElement && w.contains(document.activeElement);
                  if (!isHighlighted) return false;
                  return !!w.querySelector(EXECUTE_PERK_CLASSES.map(c=>'.'+c).join(','));
                });
              if (highlighted && highlighted !== wrapper) {
                debugLog('Redirecting click to highlighted Execute weapon');
                try { highlighted.dataset.futaSynthetic = '1'; } catch (err) { }
                highlighted.click();
                e.stopPropagation();
                e.preventDefault();
                return;
              }
            }
          }
        } catch (ex) {
          debugLog('Error while attempting execute-redirect: ' + ex);
        }

        if (currentFightState === "pre-fight" && settings.quick) {
          const startBtn = document.querySelector(`[class*='dialogButtons_'] button.torn-btn[type="submit"]`);
          if (startBtn) {
            debugLog("Starting fight via weapon click");
            startBtn.click();
          } else {
            debugLog("Start Fight button not found");
          }
        } else if (currentFightState === "post-fight" && settings.quick) {
          debugLog("Weapon clicked in post-fight state, triggering Quick Attack action");
          const targetButton = await updateQuickAttackUI();
          if (targetButton) {
            debugLog(`Quick Attack: Clicking button '${targetButton.innerText}'`);
            targetButton.click();
          } else {
            debugLog("Quick Attack: No target button found to click");
          }
        }
      });
    } catch (err) {
      debugLog('bindWeaponWrapper failed: ' + err);
    }
  }
  try {
    const existingWrappers = Array.from(document.querySelectorAll('.weaponWrapper___h3buK'));
    existingWrappers.forEach(w => void bindWeaponWrapper(w));
  } catch (e) {
    debugLog('Error binding existing weapon wrappers: ' + e);
  }
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const wrappers = node.classList?.contains("weaponWrapper___h3buK")
          ? [node]
          : node.querySelectorAll?.(".weaponWrapper___h3buK");
        if (wrappers && wrappers.length > 0) {
          wrappers.forEach((wrapper) => {
            void bindWeaponWrapper(wrapper).catch(e => debugLog('bindWeaponWrapper error: ' + e));
          });
        }

        const postFightNode = node.classList?.contains("dialogButtons___nX4Bz")
          ? node
          : node.querySelector?.("div.dialogButtons___nX4Bz");
        if (postFightNode) {
          void updateQuickAttackUI();
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function updateQuickAttackUI() {
  const quickEnabled = await GM.getValue("quick_attack_enabled", false);
  const action = await GM.getValue("quick_attack_action", "leave");
  debugLog(`Quick Attack: Retrieved action setting: '${action}'`);

  const postFightContainer = document.querySelector("div.dialogButtons___nX4Bz");
  if (!postFightContainer) {
    debugLog("Quick Attack: Post-fight container not found");
    return null;
  }

  const buttons = postFightContainer.querySelectorAll("button.torn-btn");
  if (!buttons || buttons.length === 0) {
    debugLog("Quick Attack: No buttons found in post-fight container");
    return null;
  }

  buttons.forEach(btn => btn.classList.remove("futa-quick-highlight"));

  const actionMap = {
    leave: ["leave"],
    hospital: ["hospitalize", "hospitalise", "hospital", "hosp"],
    mug: ["mug"]
  };

  const expectedActions = actionMap[action] || actionMap.leave;
  debugLog(`Quick Attack: Expected actions: ${expectedActions.join(", ")} based on action '${action}'`);

  const buttonTexts = Array.from(buttons).map(btn => btn.innerText.trim());
  debugLog(`Quick Attack: Available buttons: ${buttonTexts.join(", ")}`);

  let targetButton = null;

  Array.from(buttons).forEach(btn => {
    const btnText = btn.innerText.trim();
    const btnTextLower = btnText.toLowerCase();
    const normalized = btnTextLower.replace(/\s+/g, ' ');
    debugLog(`Quick Attack: Checking button with text: '${btnText}'`);

    const matched = expectedActions.some(expected => {
      if (normalized === expected) return true;
      if (normalized.startsWith(expected + ' ')) return true;
      if (normalized.startsWith(expected + ':')) return true;
      return false;
    });

    if (matched) {
      debugLog(`Quick Attack: Match found for '${btnText}'`);
      targetButton = btn;
    }
  });

  if (quickEnabled && targetButton) {
    targetButton.classList.add("futa-quick-highlight");
  }

  if (targetButton) {
    debugLog(`Quick Attack: Identified target button with text '${targetButton.innerText}'`);
  } else {
    debugLog(`Quick Attack: No matching button found for action '${action}' (expected one of: ${expectedActions.join(", ")})`);
  }

  return targetButton;
}

  async function executeAttackNotifier() {
    if (!(window.location.href.includes("loader.php?sid=attack") || window.location.href.includes("tornpda.com/attack"))) {
      try {
        const weaponSecond = document.getElementById('weapon_second');
        if (weaponSecond) {
          weaponSecond.style.background = '';
          weaponSecond.style.removeProperty('background');
          weaponSecond.style.removeProperty('background-color');
        }
        const wrappers = document.querySelectorAll('.weaponWrapper___h3buK');
        wrappers.forEach(w => {
          try {
            if (w && w.style && w.style.background) {
              w.style.background = '';
              w.style.removeProperty('background');
              w.style.removeProperty('background-color');
            }
          } catch (e) { }
        });
      } catch (e) { }
      return;
    }

    const execEnabled = await GM.getValue("execute_enabled", false);

    const clearExecuteHighlight = () => {
      try {
        const weaponSecond = document.getElementById('weapon_second');
        if (weaponSecond) {
          weaponSecond.style.background = '';
          weaponSecond.style.removeProperty('background');
          weaponSecond.style.removeProperty('background-color');
        }
        const wrappers = document.querySelectorAll('.weaponWrapper___h3buK');
        wrappers.forEach(w => {
          try {
            if (w && w.style && w.style.background) {
              w.style.background = '';
              w.style.removeProperty('background');
              w.style.removeProperty('background-color');
            }
          } catch (e) { }
        });
      } catch (e) {
        debugLog('clearExecuteHighlight error: ' + e);
      }
    };

    if (!execEnabled) {
      clearExecuteHighlight();
      if (FUTA.debugEnabled) debugLog('executeAttackNotifier: execute disabled, cleared highlights');
      return;
    }

    if (FUTA.executeThreshold == null) {
      try {
        const extracted = extractExecuteThresholdFromDom();
        FUTA.executeThreshold = extracted;
        updateExecuteUI();
      } catch (e) {
        debugLog('executeAttackNotifier: error extracting execute threshold: ' + e);
      }
    }

    if (FUTA.executeThreshold == null) {
      clearExecuteHighlight();
      if (FUTA.debugEnabled) debugLog('executeAttackNotifier: no execute perk threshold detected, skipping highlight');
      return;
    }

    const healthElements = document.querySelectorAll('[id^=player-health-value]');
    if (!healthElements || healthElements.length < 2) {
      clearExecuteHighlight();
      return;
    }

    const parts = healthElements[1].innerText.split("/");
    if (parts.length < 2) {
      clearExecuteHighlight();
      return;
    }

    const currentHealth = parseFloat(parts[0].replace(/,/g, ''));
    const maxHealth = parseFloat(parts[1].replace(/,/g, ''));
    if (isNaN(currentHealth) || isNaN(maxHealth) || maxHealth === 0) {
      clearExecuteHighlight();
      return;
    }

    const thresholdPct = Number(await GM.getValue("attack_execute", "15"));
    const threshold = thresholdPct / 100;

    if ((currentHealth / maxHealth) <= threshold) {
      const weaponSecond = document.getElementById('weapon_second');
      if (weaponSecond) weaponSecond.style.background = 'red';
      if (FUTA.debugEnabled) debugLog('executeAttackNotifier: execute active — weapon_second highlighted');
    } else {
      clearExecuteHighlight();
      if (FUTA.debugEnabled) debugLog('executeAttackNotifier: execute not active at current HP — cleared highlights');
    }
  }

  async function isExecuteActive() {
    try {
      const execEnabled = await GM.getValue("execute_enabled", false);
      if (!execEnabled) return false;
      if (FUTA.executeThreshold == null) {
        try {
          FUTA.executeThreshold = extractExecuteThresholdFromDom();
          updateExecuteUI();
        } catch (e) {
          debugLog('isExecuteActive: error extracting execute threshold: ' + e);
        }
      }
      if (FUTA.executeThreshold == null) return false;
      const healthElements = document.querySelectorAll('[id^=player-health-value]');
      if (!healthElements || healthElements.length < 2) return false;
      const parts = healthElements[1].innerText.split("/");
      if (parts.length < 2) return false;
      const currentHealth = parseFloat(parts[0].replace(/,/g, ''));
      const maxHealth = parseFloat(parts[1].replace(/,/g, ''));
      if (isNaN(currentHealth) || isNaN(maxHealth) || maxHealth === 0) return false;
      const thresholdPct = Number(await GM.getValue("attack_execute", "60"));
      const threshold = thresholdPct / 100;
      return (currentHealth / maxHealth) <= threshold;
    } catch (e) {
      debugLog('isExecuteActive error: ' + e);
      return false;
    }
  }

  let openAttackNewTab = false;
  let minimizeOnAttack = false;

  function openAttack(url, { forceNewTab = false } = {}) {
    const shouldOpenNewTab = forceNewTab || openAttackNewTab;
    console.log("openAttackNewTab =", openAttackNewTab, "forceNewTab =", forceNewTab, "URL =", url);
    if (shouldOpenNewTab) {
      try {
        GM.openInTab(url, { active: true });
      } catch (err) {
        debugLog('GM.openInTab failed, falling back to window.open: ' + err);
        window.open(url, '_blank', 'noopener');
      }
    } else {
      window.location.href = url;
    }
  }

  (function heartbeat() {
    const ATTACK_PING_INTERVAL = 15000;
    const HEARTBEAT_KEY = 'attack_session_id';
    function getOrCreateSessionID() {
      let sessionID = sessionStorage.getItem(HEARTBEAT_KEY);
      if (!sessionID) {
        sessionID = '_' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem(HEARTBEAT_KEY, sessionID);
      }
      return sessionID;
    }
    async function sendHeartbeat() {
      const apiKey = await GM.getValue("api_key", "");
      if (!apiKey) return;
      const targetID = new URLSearchParams(window.location.search).get("user2ID") ||
                      (window.attackData && window.attackData.DB && window.attackData.DB.defenderUser && window.attackData.DB.defenderUser.userID);
      if (!targetID) return;
      const sessionID = getOrCreateSessionID();
      const faction = await GM.getValue("user_faction", "Flatline");
      const baseEndpoint = FACTION_ENDPOINTS[faction] || FACTION_ENDPOINTS.Flatline;
      const payload = { user2ID: targetID, action: "heartbeat", sessionID: sessionID, api_key: apiKey };
      GM.xmlHttpRequest({
        method: "POST",
        url: `${baseEndpoint}/reportAttack`,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload),
        onload: (res) => console.log("[FUTA] Heartbeat sent:", res.responseText),
        onerror: (err) => console.error("[FUTA] Error sending heartbeat:", err)
      });
    }
    const isAttackPage = window.location.href.includes("loader.php?sid=attack") || window.location.href.includes("tornpda.com/attack");
    if (isAttackPage) {
      sendHeartbeat();
      setInterval(sendHeartbeat, ATTACK_PING_INTERVAL);
      window.addEventListener("pagehide", () => finalizeAttackDebug('pagehide'));
    }
  })();

  async function initialize() {
    FUTA.debugEnabled = await GM.getValue("debug_mode", false);
    openAttackNewTab = toBoolean(await GM.getValue("open_attack_new_tab", false));
    minimizeOnAttack = toBoolean(await GM.getValue("minimize_on_attack", false));
    markAttackTabIfExpected();
    await maybeMinimizePanelForAttack('initialize');
    await GM.getValue("currentWarMode", "Peace");
    try {
      if (window.location.hostname && window.location.hostname.includes('tornpda')) {
        document.body.classList.add('futa-on-pda');
      }
    } catch (e) {
    }
    addCustomStyles();
    applyHideClassesFromLocalStorage();
    setupAttackLinkInterception();
    await createChatButton();
    await initUI();
    setupIntervals();
    hookHistoryForAttackBindings();
  }

  async function initUI() {
  try {
    const cachedPingData = localStorage.getItem("lastPingData");
    if (cachedPingData) {
      const parsedPingData = JSON.parse(cachedPingData);
      FUTA.sharedPingData = (parsedPingData && Object.keys(parsedPingData).length > 0 && parsedPingData.success !== false) ? parsedPingData : {};
    } else {
      FUTA.sharedPingData = {};
    }
    const cachedSummary = localStorage.getItem("lastSummary");
    if (cachedSummary) {
      FUTA.tornApiStatus = cachedSummary.indexOf("❌") === 0 ? "No Connection" : "Established";
    }
    await updateAllStatuses();
    await createChatButton();
    await waitForElm("body").then(() => enableQuickAttackAndHiding());
    if (minimizeOnAttack) {
      waitForKeyElements("a.profile-button-attack", (node) => {
        node.removeAttribute("onclick");
        node.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          openAttack(node.href);
          return false;
        };
      }, true);
    }
  } catch (e) {
    debugLog("Error loading cached data: " + e);
    FUTA.sharedPingData = {};
    FUTA.tornApiStatus = "No Connection";
    localStorage.setItem("charlemagne_status", "No Connection");
    if (!FUTA.chatButtonCreated) await createChatButton();
  }
}

  function setupIntervals() {
    setInterval(updateAllStatuses, FUTA.UPDATE_INTERVAL);
    setInterval(executeAttackNotifier, 500);
    const healthObserver = new MutationObserver(() => executeAttackNotifier());
    const healthEl = document.querySelector('[id^=player-health-value]');
    if (healthEl) {
      healthObserver.observe(healthEl, { childList: true, characterData: true, subtree: true });
    } else {
      waitForKeyElements('[id^=player-health-value]', (node) => {
        healthObserver.observe(node, { childList: true, characterData: true, subtree: true });
      }, true);
    }
    setInterval(() => {
      if (FUTA.charlemagneAlertsEnabled) checkAlerts();
    }, 30000);
  }

  function waitForKeyElements(selector, actionFunction, bWaitOnce, iframeSelector) {
    const targetNodes = document.querySelectorAll(selector);
    if (targetNodes && targetNodes.length > 0) {
      targetNodes.forEach((node) => {
        if (!node.dataset.found) {
          node.dataset.found = "true";
          actionFunction(node);
        }
      });
      if (bWaitOnce) return;
    }
    setTimeout(() => waitForKeyElements(selector, actionFunction, bWaitOnce, iframeSelector), 300);
  }

  window.addEventListener('beforeunload', () => finalizeAttackDebug('beforeunload'));

  waitForHead(initialize);
})();
