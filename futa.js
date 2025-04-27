// ==UserScript==
// @name         Flatline's Ultimate Torn Assistant
// @namespace    http://github.com/mtxve
// @version      0.7.01a
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
  let isFetchIntercepted = false;
  const originalFetch = unsafeWindow.fetch;
  let hospitalStatus = { isInHospital: false, until: 0 };
  let lastAttackDataFetch = 0;

  function enableFetchIntercept() {
    if (isFetchIntercepted) return;
    unsafeWindow.fetch = async (...args) => {
      const [resource, config] = args;
      const response = await originalFetch(resource, config);
      const cloneJson = async () => {
        let data = await response.clone().json();
        if (response.url.includes('?sid=attackData')) {
          const error = data?.DB?.error || '';
          const reactiveEnabled = await GM.getValue("reactive_attack_enabled", false);
          if (
            error.includes('in hospital') ||
            error.includes('unconscious') ||
            error.includes('This fight no longer exists')
          ) {
            if (data?.DB?.defenderUser?.playername && !data.DB.defenderUser.playername.includes('[Hospital]')) {
              data.DB.defenderUser.playername += ' [Hospital]';
            }
            hospitalStatus.isInHospital = true;
            hospitalStatus.until = 0;
            delete data.DB.error;
            delete data.startErrorTitle;
          } else {
            hospitalStatus.isInHospital = false;
            hospitalStatus.until = 0;
          }
          if (reactiveEnabled) {
            setTimeout(() => updateStartFightButtonState(), 100);
          }
        }
        return data;
      };
      response.json = cloneJson;
      response.text = async () => JSON.stringify(await cloneJson());
      return response;
    };
    isFetchIntercepted = true;
  }

  function disableFetchIntercept() {
    if (!isFetchIntercepted) return;
    unsafeWindow.fetch = originalFetch;
    isFetchIntercepted = false;
    hospitalStatus = { isInHospital: false, until: 0 };
  }

  async function updateStartFightButtonState() {
    const btn = document.querySelector(`[class*='dialogButtons_'] button.torn-btn[type="submit"]`);
    if (!btn) {
      debugLog("Reactive Attack: Start Fight button not found for state update.");
      return;
    }
    const reactiveEnabled = await GM.getValue("reactive_attack_enabled", false);
    if (!reactiveEnabled) {
      btn.disabled = false;
      btn.classList.remove("disabled");
      btn.textContent = "Start Fight";
      return;
    }
    btn.style.minWidth = "175px";
    if (hospitalStatus.isInHospital) {
      btn.disabled = true;
      btn.classList.add("disabled");
      btn.textContent = "Start Fight (In Hospital)";
    } else {
      btn.disabled = false;
      btn.classList.remove("disabled");
      btn.textContent = "Start Fight";
    }
  }

  if (window.FUTA_ALREADY_LOADED) {
    console.log("[FUTA] Script already loaded, skipping...");
    return;
  }
  window.FUTA_ALREADY_LOADED = true;

  const FUTA = {
    tabStateKey: "charlemagne_last_tab",
    pingPromise: null,
    UPDATE_INTERVAL: 30000,
    VERSION: "0.7.01a",
    debugEnabled: false,
    sharedPingData: {},
    tornApiStatus: "Connecting...",
    chatButtonCreated: false
  };

  const FACTION_ENDPOINTS = {
    Flatline: "http://46.202.179.156:8081",
    Darkline: "http://46.202.179.157:8082",
    Lifeline: "http://46.202.179.157:8083"
  };

  function debugLog(msg) {
    if (FUTA.debugEnabled) console.log("[FUTA] => " + msg);
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

  function addCustomStyles() {
    debugLog("Injecting custom styles...");
    GM_addStyle(`
      #futa-panel .chat-list-header__tab___okUFS { box-sizing: border-box !important; background: transparent linear-gradient(180deg, #555, #333) 0% 0% no-repeat padding-box !important; border: 0 !important; margin: 0 !important; padding: 7px 6px 8px 6px !important; display: flex !important; align-items: center !important; justify-content: center !important; }
      #futa-panel .chat-list-header__tab___okUFS:hover { background: transparent linear-gradient(180deg, #555, #444) 0% 0% no-repeat padding-box !important; }
      #futa-panel .chat-list-header__tabs___zL8JZ .chat-list-header__tab___okUFS.active-tab { background: transparent linear-gradient(0deg, #555, #333) 0% 0% no-repeat padding-box !important; border-bottom: none !important; }
      body:not(.dark-mode) #futa-panel .chat-list-header__tab___okUFS { background: transparent linear-gradient(0deg, #ddd, #fff) 0% 0% no-repeat padding-box !important; }
      body:not(.dark-mode) #futa-panel .chat-list-header__tab___okUFS:hover { background: transparent linear-gradient(0deg, #eee, #fff) 0% 0% no-repeat padding-box !important; }
      body:not(.dark-mode) #futa-panel .chat-list-header__tabs___zL8JZ .chat-list-header__tab___okUFS.active-tab { background: transparent linear-gradient(180deg, #ddd, #fff) 0% 0% no-repeat padding-box !important; border-bottom: none !important; }
      #futa-panel .settings-panel__section___Jszgh { margin-top: 0 !important; padding-top: 0 !important; }
      #futa-panel .chat-list-header__text-action-wrapper___sWKdh { padding-bottom: 2px !important; }
      #futa-panel .chat-list-header__tab___okUFS p { margin: 0 !important; line-height: 1.5 !important; }
      body.dark-mode .collapsible-header { cursor: pointer; font-weight: bold; margin: 8px 0; background: #222 !important; padding: 6px; border: 1px solid #444 !important; color: #fff !important; margin-bottom: 0 !important; }
      body.dark-mode .collapsible-content { padding: 8px; border: 1px solid #444 !important; border-top: none !important; background: #2a2a2a !important; color: #fff !important; }
      body:not(.dark-mode) .collapsible-header { cursor: pointer; font-weight: bold; margin: 8px 0; background: #f0f0f0 !important; padding: 6px; border: 1px solid #ccc !important; color: #000 !important; margin-bottom: 0 !important; }
      body:not(.dark-mode) .collapsible-content { padding: 8px; border: 1px solid #ccc !important; border-top: none !important; background: #fff !important; color: #000 !important; }
      #action-buttons { display: flex; flex-direction: column; align-items: center; margin-top: 10px; padding: 0 10px; }
      #action-buttons .button-row { display: flex; flex-direction: row; justify-content: center; width: 100%; gap: 10px; margin-bottom: 5px; }
      #action-buttons button { width: 100%; max-width: 120px; margin: 5px 0; }
      #charlemagne-header { padding-top: 3px; padding-bottom: 3px; }
      #persistent-banner { font-size: 12px; text-align: center; padding: 5px 0; border-top: 1px solid currentColor; display: none; }
      #settings-api-status { margin-top: 10px; text-align: center; font-size: 12px; }
      body.dark-mode #futa-panel { background-color: #2a2a2a !important; color: #fff !important; border: 1px solid #444 !important; }
      body.dark-mode #futa-panel input[type="text"],
      body.dark-mode #futa-panel input[type="number"],
      body.dark-mode #futa-panel select,
      body.dark-mode #futa-panel .collapsible-header { background: #222 !important; border-color: #444 !important; color: #fff !important; margin-bottom: 0 !important; }
      body.dark-mode #futa-panel .collapsible-content { background: #2a2a2a !important; border-color: #444 !important; color: #fff !important; }
      body:not(.dark-mode) #futa-panel { background-color: #f7f7f7 !important; color: #000 !important; border: 1px solid #ccc !important; }
      body:not(.dark-mode) #futa-panel input[type="text"],
      body:not(.dark-mode) #futa-panel input[type="number"],
      body:not(.dark-mode) #futa-panel select,
      body:not(.dark-mode) #futa-panel .collapsible-header { background: #f0f0f0 !important; border-color: #ccc !important; color: #000 !important; margin-bottom: 0 !important; }
      body:not(.dark-mode) #futa-panel .collapsible-content { background: #fff !important; border-color: #ccc !important; color: #000 !important; }
    `);
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
            debugLog("New ping data fetched: " + JSON.stringify(data));
            resolve(data);
          } catch (e) {
            debugLog("Error parsing ping response: " + e);
            resolve({});
          }
        },
        onerror: () => {
          localStorage.setItem("lastPingTimestamp", now.toString());
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
              if (!ignores.ignore_travel) {
                if (icons && icons.icon71) output.push("You're currently traveling.");
                else if (icons && icons.icon17) output.push("You're currently racing.");
                else output.push("You're not currently racing or traveling.");
              }
              let missionArray = [];
              if (missions && typeof missions === "object") {
                for (let key in missions) {
                  if (Array.isArray(missions[key])) missionArray = missionArray.concat(missions[key]);
                  else missionArray.push(missions[key]);
                }
              }
              const missionCount = missionArray.filter(m => m && m.status === "notAccepted").length;
              if (missionCount > 0) output.push(`You have ${missionCount} mission${missionCount > 1 ? "s" : ""} available.`);
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
      debugLog("Shared pingData: " + JSON.stringify(FUTA.sharedPingData));
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
    const isCharlConnected = pingData && Object.keys(pingData).length > 0;
    return {
      charlStatus: isCharlConnected ? "Established" : "No Connection",
      charlColor: isCharlConnected ? "green" : "red",
      tornStatus: FUTA.tornApiStatus,
      tornColor: FUTA.tornApiStatus === "Established" ? "green" : "red"
    };
  }

  function _updateBannerWithPingData(pingData) {
    debugLog("_updateBannerWithPingData called with pingData: " + JSON.stringify(pingData));
    const { charlStatus, charlColor, tornStatus, tornColor } = getConnectionStatus(pingData);
    const bannerEl = document.getElementById("persistent-banner");
    if (bannerEl) {
      bannerEl.innerHTML = `
        Connection to Charlemagne: <strong style="color: ${charlColor};">${charlStatus}</strong><br/>
        Connection to TornAPI: <strong style="color: ${tornColor};">${tornStatus}</strong>`;
      bannerEl.style.display = (charlStatus !== "Established" || tornStatus !== "Established") ? "block" : "none";
    }
  }

  function _updateSettingsAPIStatus(pingData) {
    debugLog("_updateSettingsAPIStatus called with pingData: " + JSON.stringify(pingData));
    const { charlStatus, charlColor, tornStatus, tornColor } = getConnectionStatus(pingData);
    const statusEl = document.getElementById("settings-api-status");
    if (statusEl) {
      statusEl.innerHTML = `
        Connection to Charlemagne: <strong style="color: ${charlColor};">${charlStatus}</strong><br/>
        Connection to TornAPI: <strong style="color: ${tornColor};">${tornStatus}</strong><br/>
        Version: <a href="https://www.torn.com/forums.php#/p=threads&f=999&t=16460741&b=1&a=36891&to=25815503" target="_blank" style="color: inherit; text-decoration: underline;">${FUTA.VERSION}</a><br/>
        Made by <a href="https://www.torn.com/profiles.php?XID=2270413" target="_blank">Asemov</a>`;
    }
  }

  async function createChatButton() {
    if (document.getElementById("bust-tab-button")) {
      debugLog("Chat button already exists, skipping...");
      return;
    }
    debugLog("Creating Charlemagne chat button...");
    try {
      const chatBtnRef = await waitForElm("button[class^='chat-setting-button']");
      const button = document.createElement("button");
      button.id = "bust-tab-button";
      button.className = chatBtnRef.className;
      button.innerText = "Charlemagne";
      button.onclick = togglePanel;
      chatBtnRef.parentNode.insertBefore(button, chatBtnRef);
      FUTA.chatButtonCreated = true;
      await createOrUpdateChatPanel();
    } catch (e) {
      debugLog("Error creating chat button, retrying: " + e);
      setTimeout(createChatButton, 500);
    }
  }

  async function createChatPanel() {
    debugLog("Creating new Charlemagne panel...");
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
    wrapper.className = "chat-app__panel___wh6nM";
    wrapper.id = "futa-panel";
    wrapper.hidden = !wasOpen;
    wrapper.innerHTML = `
      <div class="chat-tab___gh1rq">
        <div class="chat-list-header__text-action-wrapper___sWKdh" role="button" id="charlemagne-header">
          <div class="chat-list-header__text-wrapper___R6R0A">
            <img src="https://i.imgur.com/8ULhpqB.png" alt="frog" style="width: 26px; height: 26px; filter: drop-shadow(0 0 2px black);" />
            <p class="typography___Dc5WV body3 bold color-white">Charlemagne</p>
          </div>
        </div>
        <div class="chat-list-header__tabs___zL8JZ">
          <button type="button" class="chat-list-header__tab___okUFS" id="tab-main">
            <p class="typography___Dc5WV body4 bold">Main</p>
          </button>
          <button type="button" class="chat-list-header__tab___okUFS" id="tab-about">
            <p class="typography___Dc5WV body4 bold">WHACK (WIP)</p>
          </button>
          <button type="button" class="chat-list-header__tab___okUFS" id="tab-settings">
            <p class="typography___Dc5WV body4 bold">Settings</p>
          </button>
        </div>
        <div class="chat-tab-content___jNmk8">
          <div id="content-main" hidden>
            <div id="check-summary-box" style="margin-top: 2px; font-size:13px; border-radius:4px; white-space:pre-line; border:1px solid #444; background:inherit; color:inherit">
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
          </div>
          <div id="content-about" hidden></div>
          <div id="content-settings" hidden>
            <div class="collapsible">
              <div class="collapsible-header">API Key:</div>
              <div class="collapsible-content">
                <div style="display: flex; align-items: center;">
                  <input type="text" id="api-key" name="apikey" style="outline: none; box-shadow: none; padding: 5px; border: 1px solid #ccc;" placeholder="Enter API Key" value="${savedKey}">
                  <button id="save-api-key" class="torn-btn" style="border-color: green; margin-left: 8px;">Save</button>
                </div>
              </div>
            </div>
            <div class="collapsible">
              <div class="collapsible-header">Attack Settings:</div>
              <div class="collapsible-content">
                <label><input type="checkbox" id="quick-attack-toggle"> Quick Attack</label>
                <select id="quick-attack-action">
                  <option value="leave">Leave</option>
                  <option value="hospital">Hosp</option>
                  <option value="mug">Mug</option>
                </select><br/>
                <label><input type="checkbox" id="reactive-attack-toggle"> Reactive Attack</label><br/>
                <label><input type="checkbox" id="open-attack-new-tab"> Open attack in new tab</label><br/>
                <label><input type="checkbox" id="minimize-on-attack"> Minimize on attack page</label><br/>
                <label><input type="checkbox" id="hide-primary"> Hide Primary</label><br/>
                <label><input type="checkbox" id="hide-secondary"> Hide Secondary</label><br/>
                <label><input type="checkbox" id="hide-melee"> Hide Melee</label><br/>
                <label><input type="checkbox" id="hide-temp"> Hide Temp</label><br/>
                <label>Execute: <input type="number" id="attack-execute" style="width:30px;" min="0" max="99" value="15"></label><br/>
              </div>
            </div>
            <div class="collapsible">
              <div class="collapsible-header">User Settings:</div>
              <div class="collapsible-content">
                <label><input type="checkbox" id="ignore-bank"> ignore bank check</label><br/>
                <label><input type="checkbox" id="ignore-medical"> ignore medical check</label><br/>
                <label><input type="checkbox" id="ignore-booster"> ignore booster check</label><br/>
                <label><input type="checkbox" id="ignore-drug"> ignore drug check</label><br/>
                <label><input type="checkbox" id="ignore-travel"> ignore travel/racing check</label><br/>
                <label><input type="checkbox" id="debugging-toggle"> debugging</label>
              </div>
            </div>
            <div id="settings-api-status"></div>
          </div>
        </div>
        <div id="persistent-banner"></div>
      </div>`;
    const chatGroup = await waitForElm("div[class^='group-chat-box']");
    chatGroup.after(wrapper);
    _updateSettingsAPIStatus(FUTA.sharedPingData);
    _updateBannerWithPingData(FUTA.sharedPingData);

    await setupPanelEventListeners();
    setupCollapsibleSections();
    monitorChatGroup();
    const lastTab = await GM.getValue(FUTA.tabStateKey, "content-main");
    const tabMap = { "content-main": "main", "content-about": "about", "content-settings": "settings" };
    const initialTab = tabMap[lastTab] || "main";
    debugLog(`Initial tab set to: ${initialTab}`);
    await _updatePanelContent(initialTab);
  }

  async function updateChatPanel() {
    await _updatePanelContent();
  }

  async function createOrUpdateChatPanel() {
    const panel = document.getElementById("futa-panel");
    if (panel) {
      debugLog("Updating existing Charlemagne panel...");
      await updateChatPanel();
      const chatGroup = await waitForElm("div[class^='group-chat-box']");
      chatGroup.after(panel);
    } else {
      await createChatPanel();
    }
  }

  async function _updatePanelContent(tabId) {
    if (!tabId) {
      const lastTab = await GM.getValue(FUTA.tabStateKey, "content-main");
      const tabMap = { "content-main": "main", "content-about": "about", "content-settings": "settings" };
      tabId = tabMap[lastTab] || "main";
    }
    debugLog(`Updating panel content for tab: ${tabId}`);

    const futaPanel = document.querySelector('#futa-panel');
    if (!futaPanel) {
      debugLog('Error: #futa-panel not found in the DOM');
      return;
    }

    const tabsContainer = futaPanel.querySelector('.chat-list-header__tabs___zL8JZ');
    if (!tabsContainer) {
      debugLog('Error: .chat-list-header__tabs___zL8JZ not found in #futa-panel');
      return;
    }

    const tabs = ['main', 'about', 'settings'];
    tabs.forEach(tab => {
      const tabElement = tabsContainer.querySelector(`#tab-${tab}`);
      if (!tabElement) {
        debugLog(`Error: Tab element #tab-${tab} not found`);
        return;
      }

      const pElement = tabElement.querySelector('p');
      if (!pElement) {
        debugLog(`Error: <p> element not found in #tab-${tab}`);
        return;
      }

      const contentElement = futaPanel.querySelector(`#content-${tab}`);
      if (!contentElement) {
        debugLog(`Error: Content element #content-${tab} not found`);
        return;
      }

      if (tab === tabId) {
        tabElement.classList.add('active-tab');
        pElement.classList.remove('color-peopleTab');
        pElement.classList.add('color-peopleTabActive');
        contentElement.hidden = false;
        debugLog(`Activated #tab-${tab} with classes: ${tabElement.className}`);
        debugLog(`<p> classes in #tab-${tab}: ${pElement.className}`);
        debugLog(`Showing content-${tab}`);
      } else {
        tabElement.classList.remove('active-tab');
        pElement.classList.remove('color-peopleTabActive');
        pElement.classList.add('color-peopleTab');
        contentElement.hidden = true;
        debugLog(`Deactivated #tab-${tab} with classes: ${tabElement.className}`);
        debugLog(`<p> classes in #tab-${tab}: ${pElement.className}`);
        debugLog(`Hiding content-${tab}`);
      }
    });
    const tabMap = { "main": "content-main", "about": "content-about", "settings": "content-settings" };
    if (tabMap[tabId]) {
      await GM.setValue(FUTA.tabStateKey, tabMap[tabId]);
    }
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
      const tabMap = { "tab-main": "main", "tab-about": "about", "tab-settings": "settings" };
      if (!tabMap[tabId]) {
        debugLog(`Invalid tabId: ${tabId}`);
        return;
      }
      await _updatePanelContent(tabMap[tabId]);
    }, 100);

    panel.addEventListener("click", async (event) => {
      const target = event.target;
      const tabButton = target.closest("#tab-main, #tab-about, #tab-settings");
      if (tabButton) {
        await handleTabSwitch(tabButton.id);
      } else if (target.id === "charlemagne-header") {
        panel.hidden = true;
        await GM.setValue("charlemagne_panel_open", false);
      } else if (target.id === "save-api-key") {
        const key = document.getElementById("api-key").value.trim();
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
      } else if (target.id === "request-bust") {
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
      } else if (target.id === "request-revive") {
        alert("Request Revive placeholder. Functionality coming soon.");
      } else if (target.id === "big-boi-mode") {
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
              // Update stored modes
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
      } else if (target.id === "assist-mode") {
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
    });

    const toggles = [
      { id: "reactive-attack-toggle", key: "reactive_attack_enabled" },
      { id: "quick-attack-toggle", key: "quick_attack_enabled" },
      { id: "open-attack-new-tab", key: "open_attack_new_tab" },
      { id: "minimize-on-attack", key: "minimize_on_attack" },
      { id: "hide-primary", key: "hide_primary" },
      { id: "hide-secondary", key: "hide_secondary" },
      { id: "hide-melee", key: "hide_melee" },
      { id: "hide-temp", key: "hide_temp" },
      { id: "ignore-bank", key: "ignore_bank" },
      { id: "ignore-medical", key: "ignore_medical" },
      { id: "ignore-booster", key: "ignore_booster" },
      { id: "ignore-drug", key: "ignore_drug" },
      { id: "ignore-travel", key: "ignore_travel" },
      { id: "debugging-toggle", key: "debug_mode" }
    ];
    for (const { id, key } of toggles) {
      const el = document.getElementById(id);
      if (el) {
        el.checked = await GM.getValue(key, false);
        el.addEventListener("change", async () => {
          await GM.setValue(key, el.checked);
          if (key === "open_attack_new_tab") openAttackNewTab = el.checked;
          if (key === "debug_mode") FUTA.debugEnabled = el.checked;
          if (key === "reactive_attack_enabled") {
            if (el.checked) {
              enableFetchIntercept();
              forceAttackInterfaceIfHospital();
            } else {
              disableFetchIntercept();
            }
            const btn = document.querySelector(`[class*='dialogButtons_'] button.torn-btn[type="submit"]`);
            if (btn) {
              if (el.checked) {
                btn.disabled = true;
                btn.classList.add("disabled");
                btn.textContent = "Start Fight (Checking...)";
                await updateStartFightButtonState();
              } else {
                btn.disabled = false;
                btn.classList.remove("disabled");
                btn.textContent = "Start Fight";
              }
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
      quickAttackActionSelect.addEventListener("change", () => GM.setValue("quick_attack_action", quickAttackActionSelect.value));
    }
  }

  function setupCollapsibleSections() {
    document.querySelectorAll('.collapsible-header').forEach(header => {
      const sectionKey = 'collapsible_' + header.innerText.trim().replace(/\s+/g, '_');
      GM.getValue(sectionKey, "block").then(savedDisplay => {
        header.nextElementSibling.style.display = savedDisplay;
      });
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        content.style.display = (content.style.display === "none") ? "block" : "none";
        GM.setValue(sectionKey, content.style.display);
      });
    });
  }

  function monitorChatGroup() {
    const observer = new MutationObserver(() => {
      const chatGroup = document.querySelector("div[class^='group-chat-box']");
      const panel = document.getElementById("futa-panel");
      const button = document.getElementById("bust-tab-button");
      if (chatGroup && panel && chatGroup.nextElementSibling?.id !== "futa-panel") {
        debugLog("Chat group changed, reattaching panel...");
        chatGroup.after(panel);
        _updatePanelContent();
      }
      if (chatGroup && !button) {
        debugLog("Chat button missing, recreating...");
        FUTA.chatButtonCreated = false;
        createChatButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function togglePanel() {
    const panel = document.getElementById("futa-panel");
    if (panel) {
      const newState = !panel.hidden;
      panel.hidden = newState;
      await GM.setValue("charlemagne_panel_open", !newState);
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

  async function reloadAttackData() {
    const now = Date.now();
    if (now - lastAttackDataFetch < 2000) {
      debugLog("Attack data fetch debounced to prevent spam.");
      return;
    }
    lastAttackDataFetch = now;

    let targetID = window.attackData?.DB?.defenderUser?.userID;
    if (!targetID) {
      const urlParams = new URLSearchParams(window.location.search);
      targetID = urlParams.get("user2ID");
    }
    if (!targetID) {
      debugLog("No target ID found for attack data reload.");
      return;
    }

    debugLog("Reloading attack data for target ID: " + targetID);
    const attackDataUrl = `https://www.torn.com/loader.php?sid=attackData&user2ID=${targetID}`;
    try {
      const response = await fetch(attackDataUrl, { credentials: "same-origin" });
      const data = await response.json();
      debugLog("Attack data reloaded: " + JSON.stringify(data));
    } catch (err) {
      debugLog("Error reloading attack data: " + err);
    }
  }

  async function enableQuickAttackAndHiding() {
    const settings = {
      quick: await GM.getValue("quick_attack_enabled", false),
      reactive: await GM.getValue("reactive_attack_enabled", false),
      primary: await GM.getValue("hide_primary", false),
      secondary: await GM.getValue("hide_secondary", false),
      melee: await GM.getValue("hide_melee", false),
      temp: await GM.getValue("hide_temp", false)
    };
    const observer = new MutationObserver(() => {
      document.querySelectorAll(".weaponWrapper___h3buK").forEach(wrapper => {
        if (wrapper.dataset.quickBound) return;
        wrapper.dataset.quickBound = "true";
        const marker = wrapper.querySelector(".topMarker___OjRyU");
        const type = getWeaponType(marker?.id || "");
        const img = wrapper.querySelector("img");
        if (img && type && settings[type]) {
          const name = img.alt || type.charAt(0).toUpperCase() + type.slice(1);
          img.style.display = "none";
          const label = document.createElement("div");
          label.textContent = name;
          label.style.color = "#aaa";
          label.style.textAlign = "center";
          label.style.fontSize = "14px";
          label.style.margin = "6px";
          label.style.fontWeight = "bold";
          img.parentNode.appendChild(label);
        }
        wrapper.addEventListener("click", async () => {
          if (settings.reactive) {
            await reloadAttackData();
          }
          if (settings.quick) {
            const startBtn = document.querySelector("#react-root button.torn-btn[type='submit']");
            if (startBtn) startBtn.click();
            setTimeout(async () => {
              try {
                const postFightContainer = await waitForElm("div.dialogButtons___nX4Bz");
                await updateQuickAttackUI(postFightContainer);
              } catch (e) {
                console.error("Post-fight dialog not found for Quick Attack:", e);
              }
            }, 1500);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function updateQuickAttackUI(postFightContainer) {
    const action = document.getElementById("quick-attack-action")?.value || "leave";
    const buttons = postFightContainer.querySelectorAll("button.torn-btn");
    let targetButton = null;
    Array.from(buttons).forEach(btn => {
      const txt = btn.innerText.toLowerCase();
      if (action === "leave" && txt.includes("leave")) targetButton = btn;
      else if (action === "hospital" && (txt.includes("hospital") || txt.includes("hosp"))) targetButton = btn;
      else if (action === "mug" && txt.includes("mug")) targetButton = btn;
    });
    if (targetButton) {
      debugLog(`Quick Attack: Clicking post-fight button '${targetButton.innerText}'`);
      setTimeout(() => {
        targetButton.click();
      }, 500);
    } else {
      debugLog(`Quick Attack: No matching post-fight button found for action '${action}'`);
    }
  }

  async function executeAttackNotifier() {
    const healthElements = document.querySelectorAll('[id^=player-health-value]');
    if (!healthElements || healthElements.length < 2) return;
    const parts = healthElements[1].innerText.split("/");
    if (parts.length < 2) return;
    const currentHealth = parseFloat(parts[0].replace(/,/g, ''));
    const maxHealth = parseFloat(parts[1].replace(/,/g, ''));
    if (isNaN(currentHealth) || isNaN(maxHealth) || maxHealth === 0) return;
    if (currentHealth / maxHealth <= Number((await GM.getValue("attack_execute", "60")) / 100)) {
      const weaponSecond = document.getElementById('weapon_second');
      if (weaponSecond) weaponSecond.style.background = 'red';
    }
  }

  let openAttackNewTab = false;

  function openAttack(url) {
    console.log("openAttackNewTab =", openAttackNewTab, "URL =", url);
    if (openAttackNewTab) GM.openInTab(url, { active: true });
    else window.location.href = url;
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
      window.addEventListener("pagehide", () => {});
    }
  })();

  async function disableStartFightButtonOnLoad() {
    const reactiveEnabled = await GM.getValue("reactive_attack_enabled", false);
    if (!reactiveEnabled) return;

    const observer = new MutationObserver((mutations, obs) => {
      const btn = document.querySelector(`[class*='dialogButtons_'] button.torn-btn[type="submit"]`);
      if (btn && !btn.dataset.reactiveDisabled) {
        btn.dataset.reactiveDisabled = "true";
        btn.disabled = true;
        btn.classList.add("disabled");
        btn.style.minWidth = "175px";
        btn.textContent = "Start Fight (Checking...)";
        debugLog("Reactive Attack: Start Fight button disabled on load");
        obs.disconnect();
        updateStartFightButtonState();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function isHospitalErrorPage() {
    return document.querySelector('.info-msg-cont.red .msg')?.textContent.includes("This area is unavailable while you're in hospital");
  }

  function loadResources() {
    const cssFiles = [
      '/builds/attack/app.ddcc0e24bac85a4888b0.css',
      '/css/style/events/halloween/halloween.css'
    ];
    cssFiles.forEach(css => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = css;
      document.head.appendChild(link);
    });

    const jsFiles = [
      '/builds/attack/runtime.132f1b9e15de98f65113.js',
      '/builds/attack/vendors.c89120d009fdb14b968b.js',
      '/builds/attack/app.2fb65b1044cc67a16416.js'
    ];
    jsFiles.forEach(js => {
      const script = document.createElement('script');
      script.src = js;
      script.type = 'text/javascript';
      document.body.appendChild(script);
    });
  }

  async function injectAttackInterface() {
    const reactiveEnabled = await GM.getValue("reactive_attack_enabled", false);
    if (!reactiveEnabled) {
      debugLog("Reactive Attack not enabled, skipping attack interface injection.");
      return;
    }

    const mainContainer = document.querySelector('#body > div.content.responsive-sidebar-container.logged-in');
    if (!mainContainer) {
      debugLog("Main container not found for attack interface injection.");
      return;
    }

    debugLog("Injecting attack interface...");
    mainContainer.innerHTML = '';
    mainContainer.innerHTML = `
      <div class="container" id="mainContainer">
        <div id="sidebarroot"></div>
        <div class="content-wrapper logged-out spring" role="main">
          <div id="react-root">
            <div class="coreWrap___LtSEy">
              <div class="appHeaderWrapper___uyPti disableLinksRightMargin___gY7V5">
                <svg width="0" height="0" style="position: absolute;">
                  <defs>
                    <linearGradient id="app-header-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stop-color="#666"></stop>
                      <stop offset="100%" stop-color="#999"></stop>
                    </linearGradient>
                  </defs>
                </svg>
                <div class="topSection___U7sVi">
                  <div class="titleContainer___QrlWP" data-userscript-alreadyfound="true">
                    <h4 class="title___rhtB4">Attacking</h4>
                  </div>
                </div>
                <hr class="delimiter___zFh2E">
                <div class="bottomSection___ROxsQ"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    loadResources();
    setTimeout(() => {
      enableQuickAttackAndHiding();
      disableStartFightButtonOnLoad();
    }, 500);
  }

  async function forceAttackInterfaceIfHospital() {
    if (isHospitalErrorPage()) {
      debugLog("Hospital error detected. Forcing attack interface...");
      await injectAttackInterface();
    }
  }

  function monitorHospitalErrorPage() {
    const observer = new MutationObserver(async () => {
      if (isHospitalErrorPage()) {
        debugLog("Hospital error page loaded dynamically. Forcing attack interface...");
        await injectAttackInterface();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function blockSearchBarInjection() {
    debugLog("Setting up observer to block tt-chat-filter within #futa-panel...");
    try {
      const futaPanel = await waitForElm("#futa-panel");
      if (!futaPanel) {
        debugLog("Error: #futa-panel not found in the DOM, cannot block tt-chat-filter.");
        return;
      }

      const existingFilter = futaPanel.querySelector("div.tt-chat-filter");
      if (existingFilter) {
        debugLog("Found existing tt-chat-filter in #futa-panel, removing...");
        existingFilter.remove();
      }

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const filterDiv = node.classList?.contains("tt-chat-filter")
                ? node
                : node.querySelector?.("div.tt-chat-filter");
              if (filterDiv) {
                debugLog("Detected tt-chat-filter injection in #futa-panel, removing...");
                filterDiv.remove();
              }
            }
          });
        });
      });

      observer.observe(futaPanel, { childList: true, subtree: true });
      debugLog("Observer set up to block tt-chat-filter within #futa-panel.");
    } catch (e) {
      debugLog("Error setting up tt-chat-filter blocker: " + e);
    }
  }

  async function initialize() {
    FUTA.debugEnabled = await GM.getValue("debug_mode", false);
    openAttackNewTab = JSON.parse(await GM.getValue("open_attack_new_tab", "false"));
    await GM.getValue("currentWarMode", "Peace");
    const reactiveEnabled = await GM.getValue("reactive_attack_enabled", false);
    if (reactiveEnabled) {
      enableFetchIntercept();
      await forceAttackInterfaceIfHospital();
    }
    addCustomStyles();
    await initUI();
    setupIntervals();
    if (window.location.href.includes("loader.php?sid=attack")) {
      disableStartFightButtonOnLoad();
    }
    monitorHospitalErrorPage();
    blockSearchBarInjection();
  }

  async function initUI() {
    try {
      const cachedPingData = localStorage.getItem("lastPingData");
      if (cachedPingData) FUTA.sharedPingData = JSON.parse(cachedPingData) || {};
      const cachedSummary = localStorage.getItem("lastSummary");
      if (cachedSummary) FUTA.tornApiStatus = cachedSummary.indexOf("❌") === 0 ? "No Connection" : "Established";
      await createChatButton();
      await waitForElm("body").then(() => enableQuickAttackAndHiding());
      waitForKeyElements("a.profile-button-attack", (node) => {
        node.removeAttribute("onclick");
        node.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          openAttack(node.href);
          return false;
        };
      }, false);
    } catch (e) {
      debugLog("Error loading cached data: " + e);
      FUTA.sharedPingData = {};
      FUTA.tornApiStatus = "No Connection";
      if (!FUTA.chatButtonCreated) createChatButton();
    }
  }

  function setupIntervals() {
    setInterval(updateAllStatuses, FUTA.UPDATE_INTERVAL);
    setInterval(executeAttackNotifier, 5000);
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

  waitForHead(initialize);
})();
