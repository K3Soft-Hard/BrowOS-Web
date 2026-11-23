// BrowOS Browser — Non-destructive In-App Iframe Tabs, Custom Search Engines & Clean Settings

(function () {
	const browserWindow = document.getElementById("browserWindow");
	const browserInput = document.getElementById("browserInput");
	const enginesContainer = document.getElementById("browserEngines");

	if (!browserWindow || !browserInput || !enginesContainer) {
		return;
	}

	const STORAGE_KEYS = {
		engine: "browos-search-engine",
		customEngines: "browos-custom-engines",
		settings: "browos-browser-settings",
	};

	const DEFAULT_ENGINES = {
		google: { name: "Google", url: "https://www.google.com/search?q=", builtIn: true },
		duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=", builtIn: true },
		bing: { name: "Bing", url: "https://www.bing.com/search?q=", builtIn: true },
		brave: { name: "Brave", url: "https://search.brave.com/search?q=", builtIn: true },
	};

	const DEFAULT_SETTINGS = {
		openMode: "tab", // "tab" | "iframe"
		tabBarPosition: "top", // "top" | "bottom"
		tabBarStyle: "tabs", // "tabs" | "pills"
		showTabUrls: false,
		clearInputOnSearch: true,
		strictSandbox: false,
		homeMode: "search", // "search" | "url"
		customHomeUrl: "https://example.com",
	};

	function loadJson(key, fallback) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return fallback;
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" ? parsed : fallback;
		} catch (e) {
			return fallback;
		}
	}

	let customEngines = loadJson(STORAGE_KEYS.customEngines, {});
	let settings = Object.assign({}, DEFAULT_SETTINGS, loadJson(STORAGE_KEYS.settings, {}));
	let searchEngine = localStorage.getItem(STORAGE_KEYS.engine) || "google";

	function getAllEngines() {
		return Object.assign({}, DEFAULT_ENGINES, customEngines);
	}

	if (!getAllEngines()[searchEngine]) {
		searchEngine = "google";
	}

	function saveSettings() {
		localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
	}

	function saveCustomEngines() {
		localStorage.setItem(STORAGE_KEYS.customEngines, JSON.stringify(customEngines));
	}

	// Prevent mobile Google Password Manager / iOS Keychain bar on search & URL inputs
	function preventPasswordBar(inputEl) {
		if (!inputEl) return;
		inputEl.setAttribute("readonly", "readonly");
		inputEl.setAttribute("autocomplete", "off");
		inputEl.setAttribute("autocorrect", "off");
		inputEl.setAttribute("autocapitalize", "off");
		inputEl.setAttribute("spellcheck", "false");
		inputEl.setAttribute("name", "bos_q_" + Math.random().toString(36).slice(2, 7));

		const unlock = () => inputEl.removeAttribute("readonly");
		inputEl.addEventListener("pointerdown", unlock);
		inputEl.addEventListener("focus", () => setTimeout(unlock, 15));
	}

	preventPasswordBar(browserInput);

	// Prevent iframes from capturing pointer events while dragging any BrowOS window
	document.addEventListener("pointerdown", (e) => {
		if (e.target.closest(".window-header")) {
			document.body.classList.add("bos-dragging");
		}
	}, true);

	["pointerup", "pointercancel"].forEach((evt) => {
		document.addEventListener(evt, () => {
			document.body.classList.remove("bos-dragging");
		}, true);
	});

	// --- Styles (Isolated to bos-* classes, never alters #browserWindow box model) ---
	const styleEl = document.createElement("style");
	styleEl.textContent = `
		body.bos-dragging iframe {
			pointer-events: none !important;
		}
		#browserWindow .bos-mode-link {
			background: none;
			border: none;
			color: inherit;
			font: inherit;
			font-size: 12.5px;
			opacity: 0.78;
			cursor: pointer;
			padding: 2px 6px;
			border-radius: 4px;
			text-decoration: underline;
			text-underline-offset: 3px;
		}
		#browserWindow .bos-mode-link:hover {
			opacity: 1;
			background: rgba(255, 255, 255, 0.08);
		}
		#browserWindow .bos-corner-settings {
			position: absolute;
			top: 44px;
			right: 10px;
			z-index: 15;
			width: 30px;
			height: 30px;
			border-radius: 7px;
			border: 1px solid rgba(255, 255, 255, 0.14);
			background: rgba(255, 255, 255, 0.06);
			color: inherit;
			font-size: 15px;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
		}
		#browserWindow .bos-corner-settings:hover {
			background: rgba(255, 255, 255, 0.14);
		}
		#browserEngines button {
			display: inline-flex;
			align-items: center;
			gap: 5px;
		}
		#browserEngines .bos-engine-del {
			font-size: 12px;
			opacity: 0.7;
			padding: 0 2px;
		}
		#browserEngines .bos-engine-del:hover {
			opacity: 1;
			color: #ef4444;
		}

		/* Top/Bottom Tab Bar Docked Inside Window Below Header */
		#bosTabStrip {
			position: absolute;
			left: 0;
			right: 0;
			top: 36px;
			z-index: 20;
			display: none;
			align-items: center;
			gap: 4px;
			padding: 5px 8px;
			background: #0c0c10;
			border-bottom: 1px solid #22222b;
			overflow-x: auto;
		}
		#browserWindow.bos-iframe-mode #bosTabStrip {
			display: flex;
		}
		#browserWindow.bos-iframe-mode.bos-tabs-bottom #bosTabStrip {
			top: auto;
			bottom: 0;
			border-bottom: none;
			border-top: 1px solid #22222b;
		}
		#browserWindow.bos-iframe-mode:not(.bos-tabs-bottom) .bos-corner-settings {
			top: 80px;
		}
		#bosTabStrip.style-pills .bos-tab {
			border-radius: 999px;
			padding: 4px 11px;
		}
		.bos-tab {
			display: flex;
			align-items: center;
			gap: 6px;
			min-width: 86px;
			max-width: 180px;
			padding: 5px 9px;
			border-radius: 6px;
			border: 1px solid #22222b;
			background: #14141a;
			color: #a0a0ae;
			font-size: 12px;
			cursor: pointer;
			flex-shrink: 0;
			user-select: none;
		}
		.bos-tab.active {
			background: #1e1e26;
			border-color: #3b82f6;
			color: #ffffff;
		}
		.bos-tab-title {
			flex: 1;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.bos-tab-close {
			border: none;
			background: transparent;
			color: inherit;
			font-size: 13px;
			line-height: 1;
			padding: 0 2px;
			cursor: pointer;
			opacity: 0.7;
		}
		.bos-tab-close:hover {
			opacity: 1;
			color: #ef4444;
		}
		.bos-new-tab-btn {
			width: 26px;
			height: 26px;
			border-radius: 6px;
			border: 1px solid #22222b;
			background: #14141a;
			color: #f3f3f8;
			font-size: 15px;
			cursor: pointer;
			flex-shrink: 0;
		}
		.bos-new-tab-btn:hover {
			background: #22222c;
		}

		/* Overlay Container Only When Viewing an Active Iframe URL */
		#bosIframeOverlay {
			position: absolute;
			left: 0;
			right: 0;
			top: 72px;
			bottom: 0;
			z-index: 18;
			display: none;
			flex-direction: column;
			background: #0e0e13;
		}
		#browserWindow.bos-in-iframe #bosIframeOverlay {
			display: flex;
		}
		#browserWindow.bos-in-iframe.bos-tabs-bottom #bosIframeOverlay {
			top: 36px;
			bottom: 36px;
		}
		.bos-nav-bar {
			display: flex;
			align-items: center;
			gap: 5px;
			padding: 5px 8px;
			background: #101015;
			border-bottom: 1px solid #22222b;
			flex-shrink: 0;
		}
		.bos-nav-btn {
			padding: 5px 8px;
			border-radius: 6px;
			border: 1px solid #24242e;
			background: #181820;
			color: #e4e4ec;
			font-size: 12px;
			cursor: pointer;
			white-space: nowrap;
		}
		.bos-nav-btn:hover {
			background: #24242f;
		}
		.bos-url-input {
			flex: 1;
			min-width: 70px;
			padding: 5px 9px;
			border-radius: 6px;
			border: 1px solid #262632;
			background: #08080b;
			color: #f3f3f8;
			font-size: 12.5px;
			outline: none;
		}
		.bos-url-input:focus {
			border-color: #3b82f6;
		}
		.bos-frame-stage {
			position: relative;
			flex: 1;
			min-height: 0;
			background: #ffffff;
		}
		.bos-frame-stage iframe {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			border: none;
			display: none;
			background: #ffffff;
		}
		.bos-frame-stage iframe.active {
			display: block;
		}

		/* Simple Settings Dialog */
		#bosSettingsModal {
			position: absolute;
			inset: 36px 0 0 0;
			z-index: 40;
			background: rgba(0, 0, 0, 0.78);
			display: none;
			align-items: center;
			justify-content: center;
			padding: 12px;
		}
		#bosSettingsModal.open {
			display: flex;
		}
		.bos-settings-card {
			width: 100%;
			max-width: 400px;
			max-height: 100%;
			overflow-y: auto;
			background: #111116;
			border: 1px solid #262630;
			border-radius: 10px;
			padding: 14px;
			color: #f3f3f8;
			display: flex;
			flex-direction: column;
			gap: 10px;
		}
		.bos-settings-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			border-bottom: 1px solid #22222b;
			padding-bottom: 8px;
			font-weight: 600;
			font-size: 13.5px;
		}
		.bos-setting-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			font-size: 12.5px;
		}
		.bos-setting-row select,
		.bos-setting-row input[type="text"],
		.bos-engine-form input {
			background: #181820;
			border: 1px solid #2a2a35;
			color: #f3f3f8;
			padding: 5px 8px;
			border-radius: 6px;
			font-size: 12px;
			outline: none;
		}
		.bos-engine-section {
			border-top: 1px solid #22222b;
			padding-top: 10px;
			display: flex;
			flex-direction: column;
			gap: 7px;
			font-size: 12.5px;
		}
		.bos-engine-form {
			display: flex;
			gap: 6px;
		}
		.bos-engine-form input {
			flex: 1;
			min-width: 0;
		}
		.bos-engine-list {
			display: flex;
			flex-direction: column;
			gap: 4px;
			max-height: 115px;
			overflow-y: auto;
		}
		.bos-engine-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 4px 8px;
			border-radius: 6px;
			background: #17171e;
			font-size: 12px;
		}
	`;
	document.head.appendChild(styleEl);

	// --- Attach Corner Settings Button & Clickable "Opens in new tab" Link ---
	const cornerSettingsBtn = document.createElement("button");
	cornerSettingsBtn.type = "button";
	cornerSettingsBtn.className = "bos-corner-settings";
	cornerSettingsBtn.title = "Settings";
	cornerSettingsBtn.textContent = "⚙";
	browserWindow.appendChild(cornerSettingsBtn);

	let modeToggleBtn = null;
	const walker = document.createTreeWalker(browserWindow, NodeFilter.SHOW_ELEMENT);
	while (walker.nextNode()) {
		const el = walker.currentNode;
		if (el.children.length === 0 && /opens in new tab/i.test(el.textContent.trim())) {
			el.textContent = "";
			modeToggleBtn = document.createElement("button");
			modeToggleBtn.type = "button";
			modeToggleBtn.className = "bos-mode-link";
			el.appendChild(modeToggleBtn);
			break;
		}
	}

	if (!modeToggleBtn) {
		modeToggleBtn = document.createElement("button");
		modeToggleBtn.type = "button";
		modeToggleBtn.className = "bos-mode-link";
		modeToggleBtn.style.marginTop = "8px";
		enginesContainer.insertAdjacentElement("afterend", modeToggleBtn);
	}

	// --- Tab Strip & Iframe Overlay (Non-Destructive Siblings) ---
	const tabStripEl = document.createElement("div");
	tabStripEl.id = "bosTabStrip";
	browserWindow.appendChild(tabStripEl);

	const iframeOverlay = document.createElement("div");
	iframeOverlay.id = "bosIframeOverlay";
	iframeOverlay.innerHTML = `
		<div class="bos-nav-bar">
			<button type="button" class="bos-nav-btn" id="bosHomeBtn" title="Home">⌂</button>
			<button type="button" class="bos-nav-btn" id="bosBackBtn" title="Back">←</button>
			<button type="button" class="bos-nav-btn" id="bosReloadBtn" title="Reload">↻</button>
			<input type="text" class="bos-url-input" id="bosAddressInput" placeholder="Search or enter address">
			<button type="button" class="bos-nav-btn" id="bosPopoutBtn" title="Open in new tab">↗</button>
			<button type="button" class="bos-nav-btn" id="bosIframeSettingsBtn" title="Settings">⚙</button>
		</div>
		<div class="bos-frame-stage" id="bosFrameStage"></div>
	`;
	browserWindow.appendChild(iframeOverlay);

	const frameStageEl = document.getElementById("bosFrameStage");
	const addressInputEl = document.getElementById("bosAddressInput");
	preventPasswordBar(addressInputEl);

	let tabs = [
		{ id: "tab-home-1", type: "home", title: "New Tab", url: "", iframe: null },
	];
	let activeTabId = tabs[0].id;

	function syncModeUI() {
		const isIframeMode = settings.openMode === "iframe";
		modeToggleBtn.textContent = isIframeMode ? "Opens in iframe ▾" : "Opens in new tab ▾";
		browserWindow.classList.toggle("bos-iframe-mode", isIframeMode);
		browserWindow.classList.toggle("bos-tabs-bottom", settings.tabBarPosition === "bottom");

		const activeTab = tabs.find((t) => t.id === activeTabId);
		const showingFrame = isIframeMode && activeTab && activeTab.type === "url";
		browserWindow.classList.toggle("bos-in-iframe", showingFrame);

		if (isIframeMode) {
			renderTabs();
		}
	}

	modeToggleBtn.addEventListener("click", () => {
		settings.openMode = settings.openMode === "tab" ? "iframe" : "tab";
		saveSettings();
		syncModeUI();
	});

	// --- Search Engines ---
	function renderEngines() {
		const all = getAllEngines();
		if (!all[searchEngine]) {
			searchEngine = "google";
			localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
		}

		enginesContainer.innerHTML = "";

		Object.entries(all).forEach(([key, engine]) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.dataset.engine = key;
			btn.classList.toggle("active", key === searchEngine);

			const label = document.createElement("span");
			label.textContent = engine.name;
			btn.appendChild(label);

			if (!engine.builtIn) {
				const del = document.createElement("span");
				del.className = "bos-engine-del";
				del.textContent = "×";
				del.addEventListener("click", (ev) => {
					ev.stopPropagation();
					delete customEngines[key];
					saveCustomEngines();
					if (searchEngine === key) {
						searchEngine = "google";
						localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
					}
					renderEngines();
					renderSettingsEnginesList();
				});
				btn.appendChild(del);
			}

			btn.addEventListener("click", () => {
				searchEngine = key;
				localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
				renderEngines();
			});

			enginesContainer.appendChild(btn);
		});

		const addBtn = document.createElement("button");
		addBtn.type = "button";
		addBtn.textContent = "+";
		addBtn.title = "Add search engine";
		addBtn.addEventListener("click", () => openSettingsModal(true));
		enginesContainer.appendChild(addBtn);
	}

	// --- URL & Query Resolver ---
	function webAddress(text) {
		if (/\s/.test(text)) return null;
		let value = text;
		if (!/^https?:\/\//i.test(value)) {
			if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value)) {
				return null;
			}
			value = "https://" + value;
		}
		try {
			const url = new URL(value);
			if (url.protocol === "http:" || url.protocol === "https:") {
				return url.href;
			}
		} catch (error) {}
		return null;
	}

	function resolveQueryOrUrl(rawText) {
		const text = rawText.trim();
		if (!text) return null;

		const direct = webAddress(text);
		if (direct) return direct;

		const all = getAllEngines();
		const engine = all[searchEngine] || DEFAULT_ENGINES.google;
		const encoded = encodeURIComponent(text);

		if (engine.url.includes("{q}")) {
			return engine.url.replace(/\{q\}/g, encoded);
		}
		return engine.url + encoded;
	}

	// --- Tabs Management ---
	function formatTabLabel(tab) {
		if (tab.type === "home") return "New Tab";
		if (settings.showTabUrls) return tab.url.replace(/^https?:\/\//i, "");
		return tab.title || tab.url.replace(/^https?:\/\//i, "");
	}

	function renderTabs() {
		tabStripEl.classList.toggle("style-pills", settings.tabBarStyle === "pills");
		tabStripEl.innerHTML = "";

		tabs.forEach((tab) => {
			const el = document.createElement("div");
			el.className = "bos-tab" + (tab.id === activeTabId ? " active" : "");

			const titleSpan = document.createElement("span");
			titleSpan.className = "bos-tab-title";
			titleSpan.textContent = formatTabLabel(tab);
			el.appendChild(titleSpan);

			if (tabs.length > 1) {
				const closeBtn = document.createElement("button");
				closeBtn.type = "button";
				closeBtn.className = "bos-tab-close";
				closeBtn.textContent = "×";
				closeBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					closeTab(tab.id);
				});
				el.appendChild(closeBtn);
			}

			el.addEventListener("click", () => switchTab(tab.id));
			tabStripEl.appendChild(el);
		});

		const newBtn = document.createElement("button");
		newBtn.type = "button";
		newBtn.className = "bos-new-tab-btn";
		newBtn.textContent = "+";
		newBtn.addEventListener("click", () => {
			if (settings.homeMode === "url" && settings.customHomeUrl) {
				openUrlInNewTab(settings.customHomeUrl);
			} else {
				const homeTab = {
					id: "tab-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5),
					type: "home",
					title: "New Tab",
					url: "",
					iframe: null,
				};
				tabs.push(homeTab);
				switchTab(homeTab.id);
			}
		});
		tabStripEl.appendChild(newBtn);
	}

	function attachIframeToTab(tab, url) {
		if (!tab.iframe) {
			const iframe = document.createElement("iframe");
			if (settings.strictSandbox) {
				iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin");
			}
			iframe.addEventListener("load", () => {
				try {
					const docTitle = iframe.contentDocument && iframe.contentDocument.title;
					if (docTitle) {
						tab.title = docTitle;
						renderTabs();
					}
				} catch (e) {}
			});
			frameStageEl.appendChild(iframe);
			tab.iframe = iframe;
		}
		tab.type = "url";
		tab.url = url;
		try {
			tab.title = new URL(url).hostname.replace(/^www\./, "");
		} catch (e) {
			tab.title = url;
		}
		tab.iframe.src = url;
	}

	function openUrlInCurrentOrNewTab(url) {
		let current = tabs.find((t) => t.id === activeTabId);
		if (!current) {
			current = { id: "tab-" + Date.now(), type: "home", title: "New Tab", url: "", iframe: null };
			tabs.push(current);
			activeTabId = current.id;
		}
		attachIframeToTab(current, url);
		switchTab(current.id);
	}

	function openUrlInNewTab(url) {
		const tab = {
			id: "tab-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5),
			type: "url",
			title: url,
			url,
			iframe: null,
		};
		tabs.push(tab);
		attachIframeToTab(tab, url);
		switchTab(tab.id);
	}

	function switchTab(id) {
		activeTabId = id;
		tabs.forEach((t) => {
			if (t.iframe) {
				t.iframe.classList.toggle("active", t.id === id && t.type === "url");
			}
		});
		const current = tabs.find((t) => t.id === id);
		if (current && current.type === "url") {
			addressInputEl.value = current.url;
		}
		syncModeUI();
	}

	function closeTab(id) {
		const idx = tabs.findIndex((t) => t.id === id);
		if (idx === -1) return;
		if (tabs[idx].iframe) {
			tabs[idx].iframe.remove();
		}
		tabs.splice(idx, 1);

		if (tabs.length === 0) {
			tabs.push({ id: "tab-" + Date.now(), type: "home", title: "New Tab", url: "", iframe: null });
		}
		const next = tabs[Math.min(idx, tabs.length - 1)];
		switchTab(next.id);
	}

	document.getElementById("bosHomeBtn").addEventListener("click", () => {
		const current = tabs.find((t) => t.id === activeTabId);
		if (current) {
			if (current.iframe) {
				current.iframe.remove();
				current.iframe = null;
			}
			current.type = "home";
			current.title = "New Tab";
			current.url = "";
			switchTab(current.id);
		}
	});

	document.getElementById("bosBackBtn").addEventListener("click", () => {
		const current = tabs.find((t) => t.id === activeTabId);
		if (!current || !current.iframe) return;
		try {
			current.iframe.contentWindow.history.back();
		} catch (e) {}
	});

	document.getElementById("bosReloadBtn").addEventListener("click", () => {
		const current = tabs.find((t) => t.id === activeTabId);
		if (!current || !current.iframe) return;
		current.iframe.src = current.url;
	});

	document.getElementById("bosPopoutBtn").addEventListener("click", () => {
		const current = tabs.find((t) => t.id === activeTabId);
		if (current && current.url) {
			window.open(current.url, "_blank", "noopener");
		}
	});

	addressInputEl.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			const resolved = resolveQueryOrUrl(addressInputEl.value);
			if (resolved) {
				openUrlInCurrentOrNewTab(resolved);
			}
		}
	});

	// --- Settings Modal ---
	const settingsModal = document.createElement("div");
	settingsModal.id = "bosSettingsModal";
	settingsModal.innerHTML = `
		<div class="bos-settings-card">
			<div class="bos-settings-head">
				<span>Settings</span>
				<button type="button" class="bos-nav-btn" id="bosCloseSettingsBtn">Done</button>
			</div>

			<div class="bos-setting-row">
				<span>Open mode</span>
				<select id="bosSetOpenMode">
					<option value="tab">New tab</option>
					<option value="iframe">Iframe</option>
				</select>
			</div>

			<div class="bos-setting-row">
				<span>Tab bar position</span>
				<select id="bosSetTabPos">
					<option value="top">Top</option>
					<option value="bottom">Bottom</option>
				</select>
			</div>

			<div class="bos-setting-row">
				<span>Tab bar style</span>
				<select id="bosSetTabStyle">
					<option value="tabs">Tabs</option>
					<option value="pills">Pills</option>
				</select>
			</div>

			<div class="bos-setting-row">
				<span>Show URL in tabs</span>
				<input type="checkbox" id="bosSetShowUrls">
			</div>

			<div class="bos-setting-row">
				<span>Clear search after enter</span>
				<input type="checkbox" id="bosSetClearInput">
			</div>

			<div class="bos-setting-row">
				<span>Strict sandbox</span>
				<input type="checkbox" id="bosSetSandbox">
			</div>

			<div class="bos-setting-row">
				<span>New tab</span>
				<select id="bosSetHomeMode">
					<option value="search">Search</option>
					<option value="url">Custom URL</option>
				</select>
			</div>

			<div class="bos-setting-row" id="bosCustomHomeRow">
				<span>Home URL</span>
				<input type="text" id="bosSetCustomHome" placeholder="https://example.com">
			</div>

			<div class="bos-engine-section">
				<span>Search engines</span>
				<div class="bos-engine-form">
					<input type="text" id="bosNewEngineName" placeholder="Name">
					<input type="text" id="bosNewEngineUrl" placeholder="https://...">
					<button type="button" class="bos-nav-btn" id="bosAddEngineSubmit">Add</button>
				</div>
				<div class="bos-engine-list" id="bosSettingsEngineList"></div>
			</div>
		</div>
	`;
	browserWindow.appendChild(settingsModal);

	const setOpenMode = document.getElementById("bosSetOpenMode");
	const setTabPos = document.getElementById("bosSetTabPos");
	const setTabStyle = document.getElementById("bosSetTabStyle");
	const setShowUrls = document.getElementById("bosSetShowUrls");
	const setClearInput = document.getElementById("bosSetClearInput");
	const setSandbox = document.getElementById("bosSetSandbox");
	const setHomeMode = document.getElementById("bosSetHomeMode");
	const setCustomHome = document.getElementById("bosSetCustomHome");
	const customHomeRow = document.getElementById("bosCustomHomeRow");

	preventPasswordBar(setCustomHome);
	preventPasswordBar(document.getElementById("bosNewEngineName"));
	preventPasswordBar(document.getElementById("bosNewEngineUrl"));

	function renderSettingsEnginesList() {
		const list = document.getElementById("bosSettingsEngineList");
		list.innerHTML = "";
		const all = getAllEngines();

		Object.entries(all).forEach(([key, eng]) => {
			const row = document.createElement("div");
			row.className = "bos-engine-item";

			const nameSpan = document.createElement("span");
			nameSpan.textContent = eng.name;
			row.appendChild(nameSpan);

			if (!eng.builtIn) {
				const rm = document.createElement("button");
				rm.type = "button";
				rm.className = "bos-nav-btn";
				rm.style.color = "#f87171";
				rm.textContent = "Remove";
				rm.addEventListener("click", () => {
					delete customEngines[key];
					saveCustomEngines();
					if (searchEngine === key) {
						searchEngine = "google";
						localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
					}
					renderEngines();
					renderSettingsEnginesList();
				});
				row.appendChild(rm);
			}

			list.appendChild(row);
		});
	}

	function openSettingsModal(focusEngine) {
		setOpenMode.value = settings.openMode;
		setTabPos.value = settings.tabBarPosition;
		setTabStyle.value = settings.tabBarStyle;
		setShowUrls.checked = Boolean(settings.showTabUrls);
		setClearInput.checked = Boolean(settings.clearInputOnSearch);
		setSandbox.checked = Boolean(settings.strictSandbox);
		setHomeMode.value = settings.homeMode;
		setCustomHome.value = settings.customHomeUrl || "";
		customHomeRow.style.display = settings.homeMode === "url" ? "flex" : "none";
		renderSettingsEnginesList();
		settingsModal.classList.add("open");
		if (focusEngine) {
			document.getElementById("bosNewEngineName").focus();
		}
	}

	cornerSettingsBtn.addEventListener("click", () => openSettingsModal(false));
	document.getElementById("bosIframeSettingsBtn").addEventListener("click", () => openSettingsModal(false));
	document.getElementById("bosCloseSettingsBtn").addEventListener("click", () => {
		settingsModal.classList.remove("open");
	});

	setOpenMode.addEventListener("change", () => {
		settings.openMode = setOpenMode.value;
		saveSettings();
		syncModeUI();
	});
	setTabPos.addEventListener("change", () => {
		settings.tabBarPosition = setTabPos.value;
		saveSettings();
		syncModeUI();
	});
	setTabStyle.addEventListener("change", () => {
		settings.tabBarStyle = setTabStyle.value;
		saveSettings();
		renderTabs();
	});
	setShowUrls.addEventListener("change", () => {
		settings.showTabUrls = setShowUrls.checked;
		saveSettings();
		renderTabs();
	});
	setClearInput.addEventListener("change", () => {
		settings.clearInputOnSearch = setClearInput.checked;
		saveSettings();
	});
	setSandbox.addEventListener("change", () => {
		settings.strictSandbox = setSandbox.checked;
		saveSettings();
	});
	setHomeMode.addEventListener("change", () => {
		settings.homeMode = setHomeMode.value;
		customHomeRow.style.display = settings.homeMode === "url" ? "flex" : "none";
		saveSettings();
	});
	setCustomHome.addEventListener("input", () => {
		settings.customHomeUrl = setCustomHome.value.trim();
		saveSettings();
	});

	document.getElementById("bosAddEngineSubmit").addEventListener("click", () => {
		const nameInput = document.getElementById("bosNewEngineName");
		const urlInput = document.getElementById("bosNewEngineUrl");
		const name = nameInput.value.trim();
		let url = urlInput.value.trim();

		if (!name || !url) return;
		if (!/^https?:\/\//i.test(url)) {
			url = "https://" + url;
		}

		const id = "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
		customEngines[id] = { name, url, builtIn: false };
		saveCustomEngines();

		searchEngine = id;
		localStorage.setItem(STORAGE_KEYS.engine, searchEngine);

		nameInput.value = "";
		urlInput.value = "";
		renderEngines();
		renderSettingsEnginesList();
	});

	// --- Main Search / Launch Handler ---
	function openBrowserSearch() {
		const text = browserInput.value.trim();
		if (text === "") return;

		const url = resolveQueryOrUrl(text);
		if (!url) return;

		if (settings.openMode === "iframe") {
			openUrlInCurrentOrNewTab(url);
		} else {
			window.open(url, "_blank", "noopener");
		}

		if (settings.clearInputOnSearch) {
			browserInput.value = "";
		}
	}

	browserInput.addEventListener("keydown", function (event) {
		if (event.key === "Enter") {
			openBrowserSearch();
		}
	});

	// Init
	renderEngines();
	syncModeUI();
})();
