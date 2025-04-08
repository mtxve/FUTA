// ==UserScript==
// @name         Flatline's Ultimate Torn Assistant
// @namespace    http://github.com/mtxve
// @version      0.4.2
// @updateURL    https://raw.githubusercontent.com/mtxve/FUTA/master/futa.js
// @downloadURL  https://raw.githubusercontent.com/mtxve/FUTA/master/futa.js
// @description  Flatline Family MegaScript
// @match        https://www.torn.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @connect      46.202.179.156
// @connect      api.torn.com
// ==/UserScript==

(function addCustomStyles(){
  const style = document.createElement("style");
  style.textContent = `
    /* Dark mode styles */
    body.dark-mode .active-tab {
      background-color: #333 !important;
      color: #fff !important;
    }
    body.dark-mode #persistent-banner {
      padding: 8px;
      border-top: 1px solid #444 !important;
      font-size: 12px;
      background: #222 !important;
      text-align: center;
      color: #fff !important;
    }
    body.dark-mode .collapsible-header {
      cursor: pointer;
      font-weight: bold;
      margin: 8px 0;
      background: #222 !important;
      padding: 6px;
      border: 1px solid #444 !important;
      color: #fff !important;
    }
    body.dark-mode .collapsible-content {
      padding: 8px;
      border: 1px solid #444 !important;
      border-top: none !important;
      background: #2a2a2a !important;
      color: #fff !important;
    }
    body.dark-mode input[type="text"] {
      background: #333 !important;
      color: #fff !important;
      border: 1px solid #444 !important;
    }
    body.dark-mode .chat-list-header__tab___okUFS p {
      color: #fff !important;
    }

    /* Light mode styles */
    body:not(.dark-mode) .active-tab {
      background-color: #eee !important;
      color: #000 !important;
    }
    body:not(.dark-mode) #persistent-banner {
      padding: 8px;
      border-top: 1px solid #ccc !important;
      font-size: 12px;
      background: #fff !important;
      text-align: center;
      color: #000 !important;
    }
    body:not(.dark-mode) .collapsible-header {
      cursor: pointer;
      font-weight: bold;
      margin: 8px 0;
      background: #f0f0f0 !important;
      padding: 6px;
      border: 1px solid #ccc !important;
      color: #000 !important;
    }
    body:not(.dark-mode) .collapsible-content {
      padding: 8px;
      border: 1px solid #ccc !important;
      border-top: none !important;
      background: #fff !important;
      color: #000 !important;
    }
    body:not(.dark-mode) input[type="text"] {
      background: #fff !important;
      color: #000 !important;
      border: 1px solid #ccc !important;
    }
    body:not(.dark-mode) .chat-list-header__tab___okUFS p {
      color: #000 !important;
    }

    /* Buttons container remains the same */
    #main-buttons, #extra-buttons {
      display: flex;
      gap: 20px;
      margin-top: 10px;
    }

    /* Additional style to mimic People header sizing for Charlemagne */
    #charlemagne-header {
      padding-top: 3px;
      padding-bottom: 3px;
    }
  `;
  document.head.appendChild(style);
})();

(async function () {
  'use strict';
  const THROTTLE_INTERVAL = 30000; // 30 seconds throttle interval
  const panelId = "bust-panel";
  const pingURL = "http://46.202.179.156:8081/ping";
  const tabStateKey = "charlemagne_last_tab";
  const PING_INTERVAL = 60000;

  let currentWarMode = await GM.getValue("currentWarMode", "Peace");

  // --- Consolidated Ping Logic with In-Flight Handling ---
  let pingPromise = null;  // Global variable to hold a promise if ping is in progress

  async function getPingData() {
    const now = Date.now();
    const lastPingTimestamp = parseInt(localStorage.getItem("lastPingTimestamp") || "0", 10);
    const cachedData = localStorage.getItem("lastPingData");

    // If the last ping is recent and data exists, return it immediately.
    if ((now - lastPingTimestamp) < THROTTLE_INTERVAL && cachedData) {
      try {
        return JSON.parse(cachedData);
      } catch (e) {
        // Fall through to fetching if parsing fails.
      }
    }

    // If a ping is already in progress, return its promise.
    if (pingPromise) {
      return pingPromise;
    }

    pingPromise = new Promise((resolve) => {
      GM.xmlHttpRequest({
        method: "GET",
        url: pingURL,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            localStorage.setItem("lastPingTimestamp", now.toString());
            localStorage.setItem("lastPingData", JSON.stringify(data));
            resolve(data);
          } catch (e) {
            resolve({});
          } finally {
            pingPromise = null; // Clear in-flight flag
          }
        },
        onerror: () => {
          localStorage.setItem("lastPingTimestamp", now.toString());
          resolve({});
          pingPromise = null;
        }
      });
    });

    return pingPromise;
  }
  // --- End Consolidated Ping Logic ---

  // Update war mode and connection status using the consolidated ping result.
  async function updateWarModeStatusPersist() {
    const data = await getPingData();
    currentWarMode = data.war_mode || "Peace";
    GM.setValue("currentWarMode", currentWarMode);
    const bannerEl = document.getElementById("persistent-banner");
    if (bannerEl) {
      const connectionStatusEl = bannerEl.querySelector("#connection-status");
      if (connectionStatusEl) {
        // If data was returned, we consider the connection established.
        const isConnected = Object.keys(data).length > 0;
        connectionStatusEl.innerText = isConnected ? "Established" : "No Connection";
        connectionStatusEl.style.color = isConnected ? "green" : "red";
      }
    }
  }

  // --- Torn API Summary (unchanged) ---
  async function fetchCheckSummary() {
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
      ignore_travel: await GM.getValue("ignore_travel", false),
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
              output.push(`You haven't used your ${!refills.energy_refill_used ? "energy" : ""}${!refills.energy_refill_used && !refills.nerve_refill_used ? " & " : ""}${!refills.nerve_refill_used ? "nerve" : ""} refill today.`);
            }
            if (!ignores.ignore_drug && cd.drug === 0) {
              output.push("You're not currently on any drugs.");
            }
            if (!ignores.ignore_booster && cd.booster === 0) {
              output.push("You're not using your booster cooldown.");
            }
            if (!ignores.ignore_medical && cd.medical === 0) {
              output.push("You're not using your medical cooldown.");
            }
            if (!ignores.ignore_travel) {
              if ("icon71" in icons) {
                output.push("You're currently traveling.");
              } else if ("icon17" in icons) {
                output.push("You're currently racing.");
              } else {
                output.push("You're not currently racing or traveling.");
              }
            }
            const missionCount = Object.values(missions).flat().filter(m => m.status === "notAccepted").length;
            if (missionCount > 0) output.push(`You have ${missionCount} mission${missionCount > 1 ? "s" : ""} available.`);
            const summary = output.join("\n") || "All checks passed.";
            localStorage.setItem("lastSummaryTimestamp", now.toString());
            localStorage.setItem("lastSummary", summary);
            resolve(summary);
          } catch (e) {
            resolve("❌ Error parsing Torn API response.");
          }
        },
        onerror: function () {
          resolve("❌ Error connecting to Torn API.");
        }
      });
    });
  }

  async function updateMainTabSummary() {
    const summaryBox = document.getElementById("check-summary-box");
    if (summaryBox) {
      summaryBox.innerText = await fetchCheckSummary();
    }
  }
  // --- End Torn API Summary Section ---

  async function checkBattlestatsAndAddButtons(apiKey) {
    const extraButtons = document.getElementById("extra-buttons");
    if (!apiKey) {
      let bigBoiButton = document.getElementById("big-boi-mode");
      if (!bigBoiButton) {
        bigBoiButton = document.createElement("button");
        bigBoiButton.id = "big-boi-mode";
        bigBoiButton.className = "torn-btn";
        bigBoiButton.innerText = "Big Boi Mode";
        extraButtons.appendChild(bigBoiButton);
      }
      bigBoiButton.disabled = true;
      bigBoiButton.style.borderColor = "grey";

      let assistButton = document.getElementById("assist-mode");
      if (!assistButton) {
        assistButton = document.createElement("button");
        assistButton.id = "assist-mode";
        assistButton.className = "torn-btn";
        assistButton.innerText = "Assist Mode";
        extraButtons.appendChild(assistButton);
      }
      assistButton.disabled = true;
      assistButton.style.borderColor = "grey";
      return;
    }
    GM.xmlHttpRequest({
      method: "GET",
      url: `https://api.torn.com/user/?selections=battlestats&key=${apiKey}`,
      onload: async function(res) {
        try {
          const data = JSON.parse(res.responseText);
          const total = data.total;
          const bigBoiValid = total > 4000000000;
          await GM.setValue("big_boi_valid", bigBoiValid);
          let bigBoiButton = document.getElementById("big-boi-mode");
          if (!bigBoiButton) {
            bigBoiButton = document.createElement("button");
            bigBoiButton.id = "big-boi-mode";
            bigBoiButton.className = "torn-btn";
            bigBoiButton.innerText = "Big Boi Mode";
            extraButtons.appendChild(bigBoiButton);
          }
          bigBoiButton.disabled = !bigBoiValid;
          bigBoiButton.style.borderColor = bigBoiValid ? "green" : "red";
          bigBoiButton.onclick = function() {
            if (bigBoiButton.disabled) return;
            const current = bigBoiButton.getAttribute("data-enabled") === "true";
            const newState = !current;
            bigBoiButton.setAttribute("data-enabled", newState);
            bigBoiButton.style.borderColor = newState ? "green" : "red";
            GM.setValue("big_boi_mode_enabled", newState);
          };

          let assistButton = document.getElementById("assist-mode");
          if (!assistButton) {
            assistButton = document.createElement("button");
            assistButton.id = "assist-mode";
            assistButton.className = "torn-btn";
            assistButton.innerText = "Assist Mode";
            extraButtons.appendChild(assistButton);
          }
          const storedAssist = await GM.getValue("assist_mode_enabled", false);
          assistButton.disabled = false;
          assistButton.setAttribute("data-enabled", storedAssist);
          assistButton.style.borderColor = storedAssist ? "green" : "red";
          assistButton.onclick = function() {
            const current = assistButton.getAttribute("data-enabled") === "true";
            const newState = !current;
            assistButton.setAttribute("data-enabled", newState);
            assistButton.style.borderColor = newState ? "green" : "red";
            GM.setValue("assist_mode_enabled", newState);
          };
        } catch(e) {
          console.error("Error parsing battlestats", e);
        }
      },
      onerror: function(err) {
        console.error("Error fetching battlestats", err);
      }
    });
  }

  async function createChatButton() {
    if (document.getElementById(panelId)) return;
    const chatBtnRef = document.querySelector("button[class^='chat-setting-button']");
    if (!chatBtnRef) return setTimeout(createChatButton, 500);
    const button = document.createElement("button");
    button.className = chatBtnRef.className;
    button.id = "bust-tab-button";
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

    // Use the consolidated ping to get connection data.
    const pingData = await getPingData();
    const isConnected = Object.keys(pingData).length > 0;
    const connectionStatusText = isConnected ? "Established" : "No Connection";
    const connectionColor = isConnected ? "green" : "red";

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
          <button type="button" class="chat-list-header__tab___okUFS" id="tab-settings">
            <p class="typography___Dc5WV body4 bold" style="color: white;">Settings</p>
          </button>
          <button type="button" class="chat-list-header__tab___okUFS" id="tab-about">
            <p class="typography___Dc5WV body4 bold" style="color: white;">About</p>
          </button>
        </div>
        <div class="settings-panel__section___Jszgh" style="padding: 12px;">
          <div id="content-main" hidden>
            <div id="check-summary-box" style="padding:10px;margin-bottom:10px;font-size:13px;
            border-radius:5px;white-space:pre-line;border:1px solid #444;background:inherit;color:inherit">
              Loading status...
            </div>
            <div id="main-buttons">
              <button id="request-bust" class="torn-btn" style="border-color: gold;">Request Bust</button>
              <button id="request-revive" class="torn-btn" style="border-color: green;">Request Revive</button>
            </div>
            <div id="extra-buttons"></div>
            <div id="supplemental-script-container" style="margin-top: 10px;"></div>
          </div>
          <div id="content-settings" hidden>
            <div class="collapsible">
              <div class="collapsible-header">API Key:</div>
              <div class="collapsible-content">
                <div style="display: flex; align-items: center;">
                  <div>
                    <input type="text" id="api-key" name="apikey" style="outline: none; box-shadow: none; padding: 5px; border: 1px solid #ccc;" placeholder="Enter API Key" value="${savedKey}">
                  </div>
                  <button id="save-api-key" class="torn-btn" style="border-color: green; margin-left: 8px;">Save</button>
                </div>
              </div>
            </div>
            <div class="collapsible">
              <div class="collapsible-header">Attack Settings:</div>
              <div class="collapsible-content">
                <label><input type="checkbox" id="quick-attack-toggle"> Quick Attack</label><br/>
                <label><input type="checkbox" id="hide-primary"> Hide Primary</label><br/>
                <label><input type="checkbox" id="hide-secondary"> Hide Secondary</label><br/>
                <label><input type="checkbox" id="hide-melee"> Hide Melee</label><br/>
                <label><input type="checkbox" id="hide-temp"> Hide Temp</label><br/>
                <label>Execute: <input type="number" id="attack-execute" style="width:50px;" min="0" max="99" value="60"></label><br/>
              </div>
            </div>
            <div class="collapsible">
              <div class="collapsible-header">User Settings:</div>
              <div class="collapsible-content">
                <label><input type="checkbox" id="ignore-bank"> ignore bank check</label><br/>
                <label><input type="checkbox" id="ignore-medical"> ignore medical check</label><br/>
                <label><input type="checkbox" id="ignore-booster"> ignore booster check</label><br/>
                <label><input type="checkbox" id="ignore-drug"> ignore drug check</label><br/>
                <label><input type="checkbox" id="ignore-travel"> ignore travel/racing check</label>
              </div>
            </div>
          </div>
          <div id="content-about" hidden>
            <p style="font-size: 12px; margin: 8px 0;">Made by <a href="https://www.torn.com/profiles.php?XID=2270413" class="t-blue">Asemov</a></p>
            <p style="font-size: 12px; margin: 8px 0;">Version: 0.4.2</p>
            <p style="font-size: 12px; margin: 8px 0;">War Mode: <span id="war-mode-banner">${currentWarMode}</span></p>
          </div>
        </div>
        <div id="persistent-banner">
          Connection to Charlemagne: <strong id="connection-status" style="color: ${connectionColor};">${connectionStatusText}</strong>
        </div>
      </div>`;
    chatGroup.after(wrapper);

    if (!savedKey) {
      document.getElementById("request-bust").disabled = true;
      document.getElementById("request-revive").disabled = true;
    } else {
      document.getElementById("request-bust").disabled = false;
      document.getElementById("request-revive").disabled = false;
    }

    const tabMap = {
      "tab-main": "content-main",
      "tab-settings": "content-settings",
      "tab-about": "content-about"
    };
    for (const [tabId, contentId] of Object.entries(tabMap)) {
      document.getElementById(tabId).onclick = async () => {
        Object.keys(tabMap).forEach(id => document.getElementById(id).classList.remove("active-tab"));
        Object.values(tabMap).forEach(id => document.getElementById(id).hidden = true);
        document.getElementById(contentId).hidden = false;
        document.getElementById(tabId).classList.add("active-tab");
        await GM.setValue(tabStateKey, contentId);
      };
    }
    if (document.getElementById(lastTab)) {
      document.getElementById(lastTab).hidden = false;
      const activeTab = Object.keys(tabMap).find(key => tabMap[key] === lastTab);
      if (activeTab) {
        document.getElementById(activeTab).classList.add("active-tab");
      } else {
        document.getElementById("tab-main").classList.add("active-tab");
      }
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
      alert("🔐 API Key saved locally!");
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
      ["quick-attack-toggle", "quick_attack_enabled"],
      ["hide-primary", "hide_primary"],
      ["hide-secondary", "hide_secondary"],
      ["hide-melee", "hide_melee"],
      ["hide-temp", "hide_temp"],
      ["ignore-bank", "ignore_bank"],
      ["ignore-medical", "ignore_medical"],
      ["ignore-booster", "ignore_booster"],
      ["ignore-drug", "ignore_drug"],
      ["ignore-travel", "ignore_travel"]
    ];
    for (const [elId, storeKey] of toggleSettings) {
      const el = document.getElementById(elId);
      el.checked = await GM.getValue(storeKey, false);
      el.addEventListener("change", () => GM.setValue(storeKey, el.checked));
    }
    const attackExecuteInput = document.getElementById("attack-execute");
    attackExecuteInput.value = await GM.getValue("attack_execute", "60");
    attackExecuteInput.addEventListener("change", () => {
      GM.setValue("attack_execute", attackExecuteInput.value);
    });
    await updateMainTabSummary();
    setInterval(updateMainTabSummary, 60000);
    setupCollapsibleSections();
    checkBattlestatsAndAddButtons(savedKey);
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
    const panel = document.getElementById(panelId);
    if (panel) {
      const nowOpen = panel.hidden;
      panel.hidden = !nowOpen;
      await GM.setValue("charlemagne_panel_open", nowOpen);
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
          wrapper.addEventListener("click", () => {
            const startBtn = document.querySelector("#react-root button.torn-btn[type='submit']");
            if (startBtn) startBtn.click();
          });
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
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

  // Initialize panel and periodic updates.
  createChatButton();
  enableQuickAttackAndHiding();
  setInterval(executeAttackNotifier, 5000);
  updateWarModeStatusPersist();
  setInterval(updateWarModeStatusPersist, PING_INTERVAL);
})();
