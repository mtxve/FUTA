// ==UserScript==
// @name         Flatline's Ultimate Torn Assistant
// @namespace    http://github.com/mtxve
// @version      0.6.76a
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

(function interceptAttackFetch() {
  const { fetch: originalFetch } = unsafeWindow;
  unsafeWindow.fetch = async (...args) => {
    const [resource, config] = args;
    const response = await originalFetch(resource, config);
    const cloneJson = async () => {
      let data = await response.clone().json();
      if (response.url.includes('?sid=attackData')) {
        const error = data?.DB?.error || '';
        if (
          error.includes('in hospital') ||
          error.includes('unconscious') ||
          error.includes('This fight no longer exists')
        ) {
          if (data?.DB?.defenderUser?.playername && !data.DB.defenderUser.playername.includes('[Hospital]')) {
            data.DB.defenderUser.playername += ' [Hospital]';
          }
          delete data.DB.error;
          delete data.startErrorTitle;
        }
      }
      return data;
    };
    response.json = cloneJson;
    response.text = async () => JSON.stringify(await cloneJson());
    return response;
  };
})();

(function () {
  if (window.FUTA_ALREADY_LOADED) {
    console.log("[FUTA] script loaded.");
    return;
  }
  window.FUTA_ALREADY_LOADED = true;

  let debugEnabled = false;
  function debugLog(msg) {
    if (debugEnabled) {
      console.log("[FUTA] => " + msg);
    }
  }

  function waitForHead() {
    if (document && document.head) {
      debugLog("[FUTA]document.head found; proceeding with main()...");
      main();
    } else {
      debugLog("[FUTA]document.head not ready, retrying in 500ms...");
      setTimeout(waitForHead, 500);
    }
  }

  function main() {
    GM.getValue("debug_mode", false).then(function(val) {
      debugEnabled = val;
      debugLog("[FUTA] Started with debugging: " + val);
      try {
        const THROTTLE_INTERVAL = 30000;
        const panelId = "bust-panel";
        const pingURL = "http://46.202.179.156:8081/ping";
        const tabStateKey = "charlemagne_last_tab";
        const PING_INTERVAL = 30000;
        const VERSION = "0.6.76a";

        let currentWarMode = "Peace";
        let tornApiStatus = "Connecting...";
        let openAttackNewTab = false;
        let pingPromise = null;

        GM.getValue("open_attack_new_tab", "false").then(function(o) {
          openAttackNewTab = JSON.parse(o);
        });

        addCustomStyles();
        init();

        function addCustomStyles() {
          debugLog("addCustomStyles() - injecting styles into <head>...");
          const style = document.createElement("style");
          style.textContent = `
    body.dark-mode .active-tab { background-color: #333 !important; color: #fff !important; }
    body.dark-mode .collapsible-header { cursor: pointer; font-weight: bold; margin: 8px 0; background: #222 !important; padding: 6px; border: 1px solid #444 !important; color: #fff !important; }
    body.dark-mode .collapsible-content { padding: 8px; border: 1px solid #444 !important; border-top: none !important; background: #2a2a2a !important; color: #fff !important; }
    body.dark-mode .chat-list-header__tab___okUFS p { color: #fff !important; }
    body:not(.dark-mode) .active-tab { background-color: #eee !important; color: #000 !important; }
    body:not(.dark-mode) .collapsible-header { cursor: pointer; font-weight: bold; margin: 8px 0; background: #f0f0f0 !important; padding: 6px; border: 1px solid #ccc !important; color: #000 !important; }
    body:not(.dark-mode) .collapsible-content { padding: 8px; border: 1px solid #ccc !important; border-top: none !important; background: #fff !important; color: #000 !important; }
    body:not(.dark-mode) .chat-list-header__tab___okUFS p { color: #000 !important; }
    #main-buttons, #extra-buttons { display: flex; gap: 20px; margin-top: 10px; }
    #charlemagne-header { padding-top: 3px; padding-bottom: 3px; }
    #persistent-banner { font-size: 12px; text-align: center; padding: 5px 0; border-top: 1px solid currentColor; }
    #settings-api-status { margin-top: 10px; text-align: center; font-size: 12px; }
    body.dark-mode #bust-panel { background-color: #2a2a2a !important; color: #fff !important; border: 1px solid #444 !important; }
    body.dark-mode #bust-panel input[type="text"],
    body.dark-mode #bust-panel input[type="number"],
    body.dark-mode #bust-panel select,
    body.dark-mode #bust-panel .collapsible-header { background: #222 !important; border-color: #444 !important; color: #fff !important; }
    body.dark-mode #bust-panel .collapsible-content { background: #2a2a2a !important; border-color: #444 !important; color: #fff !important; }
    body:not(.dark-mode) #bust-panel { background-color: #f7f7f7 !important; color: #000 !important; border: 1px solid #ccc !important; }
    body:not(.dark-mode) #bust-panel input[type="text"],
    body:not(.dark-mode) #bust-panel input[type="number"],
    body:not(.dark-mode) #bust-panel select,
    body:not(.dark-mode) #bust-panel .collapsible-header { background: #f0f0f0 !important; border-color: #ccc !important; color: #000 !important; }
    body:not(.dark-mode) #bust-panel .collapsible-content { background: #fff !important; border-color: #ccc !important; color: #000 !important; }
          `;
          document.head.appendChild(style);
        }

        function init() {
          debugLog("init() started...");
          GM.getValue("currentWarMode", "Peace").then(function(m) {
            currentWarMode = m;
            return GM.getValue("open_attack_new_tab", "false");
          }).then(function(o) {
            openAttackNewTab = JSON.parse(o);
            createChatButton();
            waitForElm("body").then(function() {
              enableQuickAttackAndHiding();
            });
            updateWarModeStatusPersist();
            setInterval(updateWarModeStatusPersist, PING_INTERVAL);
            setInterval(executeAttackNotifier, 5000);
            waitForKeyElements("a.profile-button-attack", function(node) {
              node.removeAttribute("onclick");
              node.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                openAttack(node.href);
                return false;
              };
            }, false);
          }).catch(function(err) {
            debugLog("init() caught error => " + err);
            createChatButton();
          });
        }


        function waitForElm(selector) {
          return new Promise(resolve => {
            if (document.querySelector(selector)) return resolve(document.querySelector(selector));
            const observer = new MutationObserver(() => {
              const found = document.querySelector(selector);
              if (found) { observer.disconnect(); resolve(found); }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
          });
        }
        async function getPingData() {
          debugLog("getPingData() called...");
          const apiKey = await GM.getValue("api_key", "");
          if (!apiKey) {
            console.warn("No API key provided. Ping request skipped.");
            return {};
          }
          const now = Date.now();
          const lastPingTimestamp = parseInt(localStorage.getItem("lastPingTimestamp") || "0", 10);
          const cachedData = localStorage.getItem("lastPingData");
          if ((now - lastPingTimestamp) < THROTTLE_INTERVAL && cachedData) {
            try { return JSON.parse(cachedData); } catch (e) {}
          }
          if (pingPromise) return pingPromise;
          const pingUrlWithKey = `${pingURL}?api_key=${encodeURIComponent(apiKey)}`;
          pingPromise = new Promise((resolve) => {
            GM.xmlHttpRequest({
              method: "GET",
              url: pingUrlWithKey,
              onload: function(res) {
                try {
                  const data = JSON.parse(res.responseText);
                  localStorage.setItem("lastPingTimestamp", now.toString());
                  localStorage.setItem("lastPingData", JSON.stringify(data));
                  resolve(data);
                } catch (e) { resolve({}); }
                finally { pingPromise = null; }
              },
              onerror: function() {
                localStorage.setItem("lastPingTimestamp", now.toString());
                resolve({});
                pingPromise = null;
              }
            });
          });
          return pingPromise;
        }

        function updateWarModeStatusPersist() {
          getPingData().then(function(data) {
            currentWarMode = data.war_mode || "Peace";
            GM.setValue("currentWarMode", currentWarMode);
            updatePersistentBanner();
          });
        }

        function updateTornAPIStatusForBanner() {
          debugLog("updateTornAPIStatusForBanner()...");
          return fetchCheckSummary().then(function(summary) {
            if (summary.indexOf("❌") === 0) { tornApiStatus = "No Connection"; }
            else { tornApiStatus = "Established"; }
          });
        }

        function updatePersistentBanner() {
          debugLog("updatePersistentBanner()...");
          updateTornAPIStatusForBanner().then(function() {
            getPingData().then(function(pingData) {
              const isConnected = Object.keys(pingData).length > 0;
              const charlStatus = isConnected ? "Established" : "No Connection";
              const charlColor = isConnected ? "green" : "red";
              const tornColor = (tornApiStatus === "Established") ? "green" : "red";
              const bannerEl = document.getElementById("persistent-banner");
              if (bannerEl) {
                if (charlStatus !== "Established" || tornApiStatus !== "Established") {
                  bannerEl.innerHTML = `
        Connection to Charlemagne: <strong style="color: ${charlColor};">${charlStatus}</strong><br/>
        Connection to TornAPI: <strong style="color: ${tornColor};">${tornApiStatus}</strong>
      `;
                  bannerEl.style.display = "block";
                } else { bannerEl.style.display = "none"; }
              }
            });
          });
        }

        function updateSettingsAPIStatus() {
          debugLog("updateSettingsAPIStatus()...");
          updateTornAPIStatusForBanner().then(function() {
            getPingData().then(function(pingData) {
              const charlStatus = (Object.keys(pingData).length > 0) ? "Established" : "No Connection";
              const charlColor = (charlStatus === "Established") ? "green" : "red";
              const tornColor = (tornApiStatus === "Established") ? "green" : "red";
              const statusHTML = `
        Connection to Charlemagne: <strong style="color: ${charlColor};">${charlStatus}</strong><br/>
        Connection to TornAPI: <strong style="color: ${tornColor};">${tornApiStatus}</strong><br/>
        Version: <a href="https://www.torn.com/forums.php#/p=threads&f=999&t=16460741&b=1&a=36891&to=25815503" target="_blank" style="color: inherit; text-decoration: underline;">${VERSION}</a><br/>
        Made by <a href="https://www.torn.com/profiles.php?XID=2270413" target="_blank">Asemov</a>
      `;
              const statusEl = document.getElementById("settings-api-status");
              if (statusEl) { statusEl.innerHTML = statusHTML; }
            });
          });
        }

        async function fetchCheckSummary() {
          try {
            const now = Date.now();
            const lastSummaryTimestamp = parseInt(localStorage.getItem("lastSummaryTimestamp") || "0", 10);
            const cachedSummary = localStorage.getItem("lastSummary");
            if ((now - lastSummaryTimestamp) < THROTTLE_INTERVAL && cachedSummary) {
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
                onload: function (res) {
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
                    if (!ignores.ignore_drug && cd.drug === 0) { output.push("You're not currently on any drugs."); }
                    if (!ignores.ignore_booster && cd.booster === 0) { output.push("You're not using your booster cooldown."); }
                    if (!ignores.ignore_medical && cd.medical === 0) { output.push("You're not using your medical cooldown."); }
                    if (!ignores.ignore_travel) {
                      if (icons && icons.icon71) { output.push("You're currently traveling."); }
                      else if (icons && icons.icon17) { output.push("You're currently racing."); }
                      else { output.push("You're not currently racing or traveling."); }
                    }
                    let missionArray = [];
                    if (missions && typeof missions === "object") {
                      for (let key in missions) {
                        if (Array.isArray(missions[key])) { missionArray = missionArray.concat(missions[key]); }
                        else { missionArray.push(missions[key]); }
                      }
                    }
                    const missionCount = missionArray.filter(m => m && m.status === "notAccepted").length;
                    if (missionCount > 0) { output.push(`You have ${missionCount} mission${missionCount > 1 ? "s" : ""} available.`); }
                    const summary = output.join("\n") || "All checks passed.";
                    localStorage.setItem("lastSummaryTimestamp", now.toString());
                    localStorage.setItem("lastSummary", summary);
                    resolve(summary);
                  } catch (e) {
                    resolve("❌ Error parsing Torn API response.");
                  }
                },
                onerror: function () { resolve("❌ Error connecting to Torn API."); }
              });
            });
          } catch (err) {
            return "❌ Error in fetchCheckSummary: " + err.toString();
          }
        }

        async function updateMainTabSummary() {
          const summaryBox = document.getElementById("check-summary-box");
          if (summaryBox) { summaryBox.innerText = await fetchCheckSummary(); }
        }

        async function restoreToggleButtons() {
          const storedBigBoi = await GM.getValue("big_boi_mode_enabled", false);
          const storedAssist = await GM.getValue("assist_mode_enabled", false);
          const bigBoiButton = document.getElementById("big-boi-mode");
          const assistButton = document.getElementById("assist-mode");
          if (bigBoiButton) { bigBoiButton.setAttribute("data-enabled", storedBigBoi); bigBoiButton.style.borderColor = storedBigBoi ? "green" : "red"; }
          if (assistButton) { assistButton.setAttribute("data-enabled", storedAssist); assistButton.style.borderColor = storedAssist ? "green" : "red"; }
        }

        async function checkBattlestatsAndAddButtons(apiKey) {
          const extraButtons = document.getElementById("extra-buttons");
          let bigBoiButton = document.getElementById("big-boi-mode");
          if (!bigBoiButton) {
            bigBoiButton = document.createElement("button");
            bigBoiButton.id = "big-boi-mode";
            bigBoiButton.className = "torn-btn";
            bigBoiButton.innerText = "Big Boi Mode";
            extraButtons.appendChild(bigBoiButton);
          }
          let assistButton = document.getElementById("assist-mode");
          if (!assistButton) {
            assistButton = document.createElement("button");
            assistButton.id = "assist-mode";
            assistButton.className = "torn-btn";
            assistButton.innerText = "Assist Mode";
            extraButtons.appendChild(assistButton);
          }
          if (!apiKey) {
            bigBoiButton.disabled = true; bigBoiButton.style.borderColor = "grey";
            assistButton.disabled = true; assistButton.style.borderColor = "grey";
            return;
          }
          const bigBoiValid = await GM.getValue("big_boi_valid", false);
          await GM.setValue("big_boi_valid", bigBoiValid);
          bigBoiButton.disabled = !bigBoiValid;
          if (!bigBoiValid) { bigBoiButton.style.borderColor = "grey"; }
          else {
            const storedBigBoi = await GM.getValue("big_boi_mode_enabled", false);
            bigBoiButton.setAttribute("data-enabled", storedBigBoi);
            bigBoiButton.style.borderColor = storedBigBoi ? "green" : "red";
            bigBoiButton.onclick = function() {
              if (bigBoiButton.disabled) return;
              const current = bigBoiButton.getAttribute("data-enabled") === "true";
              const newState = !current;
              bigBoiButton.setAttribute("data-enabled", newState);
              bigBoiButton.style.borderColor = newState ? "green" : "red";
              GM.setValue("big_boi_mode_enabled", newState);
            };
          }
          assistButton.disabled = false;
          const storedAssist = await GM.getValue("assist_mode_enabled", false);
          assistButton.setAttribute("data-enabled", storedAssist);
          assistButton.style.borderColor = storedAssist ? "green" : "red";
          assistButton.onclick = function() {
            const current = assistButton.getAttribute("data-enabled") === "true";
            const newState = !current;
            assistButton.setAttribute("data-enabled", newState);
            assistButton.style.borderColor = newState ? "green" : "red";
            GM.setValue("assist_mode_enabled", newState);
          };
        }

        async function createChatButton() {
  if (document.getElementById("bust-tab-button")) return;
  const chatBtnRef = document.querySelector("button[class^='chat-setting-button']");
  if (!chatBtnRef) {
    return setTimeout(createChatButton, 500);
  }

  const button = document.createElement("button");
  button.id = "bust-tab-button";
  button.className = chatBtnRef.className;
  button.innerText = "Charlemagne";
  button.onclick = togglePanel;
  chatBtnRef.parentNode.insertBefore(button, chatBtnRef);
  createChatPanel();
}
        async function createChatPanel() {
          const chatGroup = document.querySelector("div[class^='group-chat-box']");
          if (!chatGroup) return setTimeout(createChatPanel, 500);
          const savedKey = await GM.getValue("api_key", "");
          const wasOpen = await GM.getValue("charlemagne_panel_open", false);
          const lastTab = await GM.getValue(tabStateKey, "content-main");
          const pingData = await getPingData();
          const isConnected = Object.keys(pingData).length > 0;
          const charlStatus = isConnected ? "Established" : "No Connection";
          const charlColor = isConnected ? "green" : "red";
          const summary = await fetchCheckSummary();
          const tornStatus = (summary.indexOf("❌") === 0) ? "No Connection" : "Established";
          const tornColor = tornStatus === "Established" ? "green" : "red";
          const persistentBannerHTML = `
        Connection to Charlemagne: <strong style="color: ${charlColor};">${charlStatus}</strong><br/>
        Connection to TornAPI: <strong style="color: ${tornColor};">${tornStatus}</strong>
      `;
          const wrapper = document.createElement("div");
          wrapper.className = "chat-app__panel___wh6nM";
          wrapper.id = panelId;
          wrapper.hidden = !wasOpen;
          wrapper.innerHTML = `
    <div class="chat-tab___gh1rq">
      <div class="chat-list-header__text-action-wrapper___sWKdh" role="button" id="charlemagne-header">
        <div class="chat-list-header__text-wrapper___R6R0A" style="display: flex; align-items: center; gap: 6px; height: 100%;">
          <img src="https://i.imgur.com/8ULhpqB.png" alt="frog" style="width: 26px; height: 26px; filter: drop-shadow(0 0 2px black);" />
          <p class="typography___Dc5WV body3 bold color-white">Charlemagne</p>
        </div>
      </div>
      <div style="align-items: center; display: flex; justify-content: space-between; margin-top: 1px;">
        <button type="button" class="chat-list-header__tab___okUFS" id="tab-main">
          <p class="typography___Dc5WV body4 bold" style="color: white;">Main</p>
        </button>
        <button type="button" class="chat-list-header__tab___okUFS" id="tab-about">
          <p class="typography___Dc5WV body4 bold" style="color: white;">WHACK - WIP</p>
        </button>
        <button type="button" class="chat-list-header__tab___okUFS" id="tab-settings">
          <p class="typography___Dc5WV body4 bold" style="color: white;">Settings</p>
        </button>
      </div>
      <div class="settings-panel__section___Jszgh" style="padding: 12px;">
        <div id="content-main" hidden>
          <div id="check-summary-box" style="padding:10px;margin-bottom:10px;font-size:13px; border-radius:5px; white-space:pre-line; border:1px solid #444; background:inherit; color:inherit">
            Loading status...
          </div>
          <div id="main-buttons">
            <button id="request-bust" class="torn-btn" style="border-color: gold;">Request Bust</button>
            <button id="request-revive" class="torn-btn" style="border-color: green;">Request Revive</button>
          </div>
          <div id="extra-buttons"></div>
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
      <div id="persistent-banner">
        ${persistentBannerHTML}
      </div>
    </div>`;
          chatGroup.after(wrapper);

          const quickAttackActionSelect = document.getElementById("quick-attack-action");
          if (quickAttackActionSelect) {
            quickAttackActionSelect.value = await GM.getValue("quick_attack_action", "leave");
            quickAttackActionSelect.addEventListener("change", () => {
              GM.setValue("quick_attack_action", quickAttackActionSelect.value);
            });
          }

          if (!savedKey) {
            document.getElementById("request-bust").disabled = true;
            document.getElementById("request-revive").disabled = true;
          } else {
            document.getElementById("request-bust").disabled = false;
            document.getElementById("request-revive").disabled = false;
          }

          const tabMap = { "tab-main": "content-main", "tab-about": "content-about", "tab-settings": "content-settings" };
          Object.entries(tabMap).forEach(([tabId, contentId]) => {
            const tabButton = document.getElementById(tabId);
            tabButton.onclick = async () => {
              Object.keys(tabMap).forEach(id => { const btn = document.getElementById(id); if (btn) { btn.className = "chat-list-header__tab___okUFS"; } });
              Object.values(tabMap).forEach(id => { const content = document.getElementById(id); if (content) content.hidden = true; });
              const activeContent = document.getElementById(contentId);
              if (activeContent) activeContent.hidden = false;
              tabButton.className = "chat-list-header__tab___okUFS chat-list-header__tab--active___cVDea";
              await GM.setValue(tabStateKey, contentId);
            };
          });
          (async function persistActiveTab() {
            const activeContent = await GM.getValue(tabStateKey, "content-main");
            Object.entries(tabMap).forEach(([tabId, contentId]) => {
              const tabButton = document.getElementById(tabId);
              if (tabButton) {
                if (contentId === activeContent) {
                  tabButton.classList.add("active-tab");
                  document.getElementById(contentId).hidden = false;
                } else {
                  tabButton.classList.remove("active-tab");
                  document.getElementById(contentId).hidden = true;
                }
              }
            });
          })();
          if (document.getElementById(lastTab)) {
            document.getElementById(lastTab).hidden = false;
            const activeTab = Object.keys(tabMap).find(key => tabMap[key] === lastTab);
            if (activeTab) { document.getElementById(activeTab).classList.add("active-tab"); }
            else { document.getElementById("tab-main").classList.add("active-tab"); }
          } else {
            document.getElementById("content-main").hidden = false;
            document.getElementById("tab-main").classList.add("active-tab");
          }

          document.getElementById("charlemagne-header").onclick = () => {
            wrapper.hidden = true;
            GM.setValue("charlemagne_panel_open", false);
          };

          document.getElementById("save-api-key").onclick = async () => {
            const key = document.getElementById("api-key").value.trim();
            await GM.setValue("api_key", key);
            await GM.setValue("api_key_provided", true);
            alert("API Key saved & sent to Charlemagne");
            document.getElementById("request-bust").disabled = false;
            document.getElementById("request-revive").disabled = false;
            checkBattlestatsAndAddButtons(key);
          };

          document.getElementById("request-bust").onclick = async () => {
            const key = await GM.getValue("api_key", "");
            if (!key) return alert("Please set your API key in the Settings tab.");
            GM.xmlHttpRequest({
              method: "POST",
              url: "http://46.202.179.156:8081/trigger-bust",
              headers: { "Content-Type": "application/json" },
              data: JSON.stringify({ api_key: key }),
              onload: () => alert("✅ Bust request sent!"),
              onerror: () => alert("❌ Error sending bust request.")
            });
          };

          document.getElementById("request-revive").onclick = () => {
            alert("Request Revive placeholder. Functionality coming soon.");
          };

          const toggleSettings = [
            ["reactive-attack-toggle", "reactive_attack_enabled"],
            ["quick-attack-toggle", "quick_attack_enabled"],
            ["open-attack-new-tab", "open_attack_new_tab"],
            ["minimize-on-attack", "minimize_on_attack"],
            ["hide-primary", "hide_primary"],
            ["hide-secondary", "hide_secondary"],
            ["hide-melee", "hide_melee"],
            ["hide-temp", "hide_temp"],
            ["ignore-bank", "ignore_bank"],
            ["ignore-medical", "ignore_medical"],
            ["ignore-booster", "ignore_booster"],
            ["ignore-drug", "ignore_drug"],
            ["ignore-travel", "ignore_travel"],
            ["debugging-toggle", "debug_mode"]
          ];
          for (const [elId, storeKey] of toggleSettings) {
            const el = document.getElementById(elId);
            el.checked = await GM.getValue(storeKey, false);
            el.addEventListener("change", () => {
              GM.setValue(storeKey, el.checked);
              if (storeKey === "open_attack_new_tab") { openAttackNewTab = el.checked; }
              if (storeKey === "debug_mode") {
                debugEnabled = el.checked;
                debugLog("Debugging toggled => " + debugEnabled);
              }
            });
          }
          const attackExecuteInput = document.getElementById("attack-execute");
          attackExecuteInput.value = await GM.getValue("attack_execute", "60");
          attackExecuteInput.addEventListener("change", () => {
            GM.setValue("attack_execute", attackExecuteInput.value);
          });
          await updateMainTabSummary();
          setInterval(updateMainTabSummary, 30000);
          setupCollapsibleSections();
          if (savedKey) {
            restoreToggleButtons();
            checkBattlestatsAndAddButtons(savedKey);
          }
          updatePersistentBanner();
          updateSettingsAPIStatus();
          setInterval(updatePersistentBanner, 30000);
          setInterval(updateSettingsAPIStatus, 30000);
          const minimizeAttack = JSON.parse(await GM.getValue("minimize_on_attack", "false"));
          if (minimizeAttack && window.location.href.startsWith("https://www.torn.com/loader.php?sid=attack")) {
            wrapper.hidden = true;
          }
          (async function persistActiveTab() {
            const activeContent = await GM.getValue(tabStateKey, "content-main");
            const tabMap = { "tab-main": "content-main", "tab-about": "content-about", "tab-settings": "content-settings" };
            Object.entries(tabMap).forEach(([tabId, contentId]) => {
              if (contentId === activeContent) {
                document.getElementById(tabId).classList.add("active-tab");
              } else {
                document.getElementById(tabId).classList.remove("active-tab");
              }
            });
          })();
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

        async function togglePanel() {
  const panel = document.getElementById("bust-panel");
  if (panel) {
    const newState = !panel.hidden;
    panel.hidden = newState;
    await GM.setValue("charlemagne_panel_open", newState);
  }
}

          function getWeaponType(markerId) {
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
              if (settings.quick) {
                wrapper.addEventListener("click", async () => {
                  const startBtn = document.querySelector("#react-root button.torn-btn[type='submit']");
                  if (startBtn) startBtn.click();
                  setTimeout(async () => {
                    try {
                      const postFightContainer = await waitForElm("div.dialogButtons___nX4Bz");
                      updateQuickAttackUI(postFightContainer);
                    } catch (e) {
                      console.error("Post-fight dialog not found for Quick Attack:", e);
                    }
                  }, 1500);
                });
              }
            });
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }

        function updateQuickAttackUI(postFightContainer) {
          const action = document.getElementById("quick-attack-action")?.value || "leave";
          const buttons = postFightContainer.querySelectorAll("button.torn-btn");
          let targetButton = null;
          Array.from(buttons).forEach(btn => {
            const txt = btn.innerText.toLowerCase();
            if (action === "leave" && txt.includes("leave")) {
              targetButton = btn;
            } else if (action === "hospital" && (txt.includes("hospital") || txt.includes("hosp"))) {
              targetButton = btn;
            } else if (action === "mug" && txt.includes("mug")) {
              targetButton = btn;
            }
          });
          if (targetButton) {
            targetButton.style.boxShadow = "0 0 5px 2px red";
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

        createChatButton();
        waitForElm("body").then(() => enableQuickAttackAndHiding());
        setInterval(executeAttackNotifier, 5000);
        updateWarModeStatusPersist();
        setInterval(updateWarModeStatusPersist, PING_INTERVAL);

        function waitForKeyElements(selector, actionFunction, bWaitOnce, iframeSelector) {
          const targetNodes = document.querySelectorAll(selector);
          if (targetNodes && targetNodes.length > 0) {
            targetNodes.forEach(function(node) {
              if (!node.dataset.found) {
                node.dataset.found = "true";
                actionFunction(node);
              }
            });
            if (bWaitOnce) return;
          }
          setTimeout(function() { waitForKeyElements(selector, actionFunction, bWaitOnce, iframeSelector); }, 300);
        }
        waitForKeyElements("a.profile-button-attack", function(node) {
          node.removeAttribute("onclick");
          node.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openAttack(node.href);
            return false;
          };
        }, false);

        function openAttack(url) {
          console.log("openAttackNewTab =", openAttackNewTab, "URL =", url);
          if (openAttackNewTab) { GM.openInTab(url, { active: true }); } else { window.location.href = url; }
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

  const payload = {
    user2ID: targetID,
    action: "heartbeat",
    sessionID: sessionID,
    api_key: apiKey
  };

  GM.xmlHttpRequest({
    method: "POST",
    url: "http://46.202.179.156:8081/reportAttack",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify(payload),
    onload: (res) => console.log("[FUTA] Heartbeat sent via GM.xmlHttpRequest:", res.responseText),
    onerror: (err) => console.error("[FUTA] Error sending heartbeat via GM.xmlHttpRequest:", err)
  });
}
  const isAttackPage = window.location.href.includes("loader.php?sid=attack") ||
                       window.location.href.includes("tornpda.com/attack");

  if (isAttackPage) {
    sendHeartbeat();
    setInterval(sendHeartbeat, ATTACK_PING_INTERVAL);
    window.addEventListener("pagehide", () => {
    });
  }
})();

        let reactiveCountdownInterval = null;
        async function startReactiveCountdown() {
          const reactiveEnabled = await GM.getValue("reactive_attack_enabled", false);
          if (!reactiveEnabled) return;
          const apiKey = await GM.getValue("api_key", "");
          if (!apiKey) return;
          let targetID = window.attackData?.DB?.defenderUser?.userID;
          if (!targetID) { const urlParams = new URLSearchParams(window.location.search); targetID = urlParams.get("user2ID"); }
          if (!targetID) return;
          const btn = await waitForElm(`[class*='dialogButtons_'] button.torn-btn[type="submit"]`);
          if (!btn) return;
          btn.style.minWidth = "175px";
          try {
            const response = await fetch(`https://api.torn.com/user/${targetID}?selections=profile&key=${apiKey}`, { credentials: "same-origin" });
            const data = await response.json();
            if (data?.status?.state === "Hospital") {
              btn.disabled = true;
              btn.classList.add("disabled");
              const until = data.status.until;
              if (reactiveCountdownInterval) clearInterval(reactiveCountdownInterval);
              const update = () => {
                const now = Math.floor(Date.now() / 1000);
                const remaining = until - now;
                if (remaining > 0) {
                  const mins = Math.floor(remaining / 60);
                  const secs = remaining % 60;
                  btn.textContent = `Start Fight (${mins}m ${secs}s)`;
                } else {
                  clearInterval(reactiveCountdownInterval);
                  reactiveCountdownInterval = null;
                  btn.disabled = false;
                  btn.classList.remove("disabled");
                  btn.textContent = "Start Fight";
                }
              };
              update();
              reactiveCountdownInterval = setInterval(update, 1000);
            } else {
              if (reactiveCountdownInterval) clearInterval(reactiveCountdownInterval);
              reactiveCountdownInterval = null;
              btn.disabled = false;
              btn.classList.remove("disabled");
              btn.textContent = "Start Fight";
            }
          } catch (err) {
            console.error("Error in reactive countdown fetch:", err);
            btn.textContent = "Start Fight (API error)";
          }
        }
        if (window.location.href.includes("loader.php?sid=attack")) {
          GM.getValue("reactive_attack_enabled", false).then(enabled => {
            if (!enabled) return;
            startReactiveCountdown();
            setInterval(startReactiveCountdown, 30000);
          });
        }

      } catch (e) {
        console.log("FUTA: main() error =>", e);
      }
    });
  }

  waitForHead();
})();
