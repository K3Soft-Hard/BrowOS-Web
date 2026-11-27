// BrowOS Browser — Frosted Glass UI, Editable Search Engines, Bookmarks, History & BrowOS Bubble Search

(function () {
	const browserWindow = document.getElementById("browserWindow");
	const browserInput = document.getElementById("browserInput");
	const enginesContainer = document.getElementById("browserEngines");

	if (!browserWindow || !browserInput || !enginesContainer) {
		return;
	}

	const STORAGE_KEYS = {
		engine: "browos-search-engine",
		engines: "browos-browser-engines-v2",
		legacyCustomEngines: "browos-custom-engines",
		settings: "browos-browser-settings",
		bookmarks: "browos-browser-bookmarks",
		history: "browos-browser-history",
	};

	const BUILTIN_DEFAULTS = {
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
		bubbleSearchEnabled: true,
		bubbleSearchEngine: "default", // "default" or an engine key
	};

	function loadJson(key, fallback) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return fallback;
			const parsed = JSON.parse(raw);
			return parsed !== null && typeof parsed === "object" ? parsed : fallback;
		} catch (e) {
			return fallback;
		}
	}

	function saveJson(key, val) {
		try {
			localStorage.setItem(key, JSON.stringify(val));
		} catch (e) {}
	}

	// Initialize editable engines store (migrates any legacy custom engines seamlessly)
	let enginesMap = (function initEngines() {
		const saved = loadJson(STORAGE_KEYS.engines, null);
		if (saved && Object.keys(saved).length > 0) {
			return saved;
		}
		const merged = JSON.parse(JSON.stringify(BUILTIN_DEFAULTS));
		const legacy = loadJson(STORAGE_KEYS.legacyCustomEngines, {});
		Object.entries(legacy).forEach(([k, v]) => {
			if (v && v.name && v.url) {
				merged[k] = { name: v.name, url: v.url, builtIn: false };
			}
		});
		saveJson(STORAGE_KEYS.engines, merged);
		return merged;
	})();

	let settings = Object.assign({}, DEFAULT_SETTINGS, loadJson(STORAGE_KEYS.settings, {}));
	let searchEngine = localStorage.getItem(STORAGE_KEYS.engine) || "google";

	if (!enginesMap[searchEngine]) {
		searchEngine = Object.keys(enginesMap)[0] || "google";
	}

	let bookmarks = (function initBookmarks() {
		const saved = loadJson(STORAGE_KEYS.bookmarks, null);
		return Array.isArray(saved) ? saved : [];
	})();

	let historyItems = (function initHistory() {
		const saved = loadJson(STORAGE_KEYS.history, null);
		return Array.isArray(saved) ? saved : [];
	})();

	let editingEngineKey = null;

	function saveSettings() {
		saveJson(STORAGE_KEYS.settings, settings);
		syncBubbleSearchCard();
	}

	function saveEngines() {
		saveJson(STORAGE_KEYS.engines, enginesMap);
		syncBubbleSearchCard();
	}

	function saveBookmarks() {
		saveJson(STORAGE_KEYS.bookmarks, bookmarks);
		renderHomeBookmarksBar();
		syncBookmarkStarButton();
	}

	function saveHistory() {
		saveJson(STORAGE_KEYS.history, historyItems);
	}

	function escapeHtml(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	// Prevent mobile password manager bar on search & URL inputs
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

	// Dynamic window header height sync so top bars align cleanly across Compact/Normal/Large/XLarge
	function syncBrowserHeaderOffset() {
		const header = browserWindow.querySelector(".window-header");
		const h = header ? Math.max(32, header.offsetHeight) : 46;
		browserWindow.style.setProperty("--bos-browser-hdr", h + "px");
	}

	syncBrowserHeaderOffset();
	const headerEl = browserWindow.querySelector(".window-header");
	if (headerEl && window.ResizeObserver) {
		new ResizeObserver(syncBrowserHeaderOffset).observe(headerEl);
	}

	// ============================================================================
	// Frosted Glass Styles (Matching BrowOS UI in Dark & Light Mode)
	// ============================================================================
	const styleEl = document.createElement("style");
	styleEl.textContent = `
		#browserWindow {
			--bos-browser-hdr: 46px;
			--bos-br-glass: rgba(20, 22, 31, 0.64);
			--bos-br-glass-strong: rgba(24, 26, 38, 0.82);
			--bos-br-glass-subtle: rgba(255, 255, 255, 0.07);
			--bos-br-glass-hover: rgba(255, 255, 255, 0.14);
			--bos-br-border: rgba(255, 255, 255, 0.14);
			--bos-br-input: rgba(10, 11, 16, 0.56);
		}
		html.light-mode #browserWindow {
			--bos-br-glass: rgba(245, 247, 252, 0.72);
			--bos-br-glass-strong: rgba(252, 253, 255, 0.88);
			--bos-br-glass-subtle: rgba(15, 23, 42, 0.05);
			--bos-br-glass-hover: rgba(15, 23, 42, 0.11);
			--bos-br-border: rgba(15, 23, 42, 0.12);
			--bos-br-input: rgba(255, 255, 255, 0.82);
		}
		body.bos-dragging iframe {
			pointer-events: none !important;
		}

		/* Corner Action Buttons (Bookmarks/History + Settings) */
		#browserWindow .bos-corner-actions {
			position: absolute;
			top: calc(var(--bos-browser-hdr) + 10px);
			right: 12px;
			z-index: 15;
			display: flex;
			align-items: center;
			gap: 6px;
		}
		#browserWindow.bos-iframe-mode:not(.bos-tabs-bottom) .bos-corner-actions {
			top: calc(var(--bos-browser-hdr) + 46px);
		}
		#browserWindow .bos-glass-icon-btn {
			height: 32px;
			padding: 0 10px;
			border-radius: 10px;
			border: 1px solid var(--bos-br-border);
			background: var(--bos-br-glass);
			backdrop-filter: blur(20px) saturate(165%);
			-webkit-backdrop-filter: blur(20px) saturate(165%);
			box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.12);
			color: inherit;
			font-family: inherit;
			font-size: 12.5px;
			font-weight: 500;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 5px;
			cursor: pointer;
			transition: background 0.15s ease, transform 0.12s ease, border-color 0.15s ease;
		}
		#browserWindow .bos-glass-icon-btn:hover {
			background: var(--bos-br-glass-hover);
			border-color: var(--accent, #2196f3);
		}
		#browserWindow .bos-glass-icon-btn:active {
			transform: scale(0.95);
		}

		/* Home Screen Bookmarks Strip */
		#bosHomeBookmarks {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: center;
			gap: 6px;
			max-width: 520px;
			margin-top: 10px;
		}
		#bosHomeBookmarks[hidden] {
			display: none !important;
		}
		.bos-home-bm-chip {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 5px 11px;
			border-radius: 999px;
			border: 1px solid var(--bos-br-border);
			background: var(--bos-br-glass);
			backdrop-filter: blur(18px) saturate(160%);
			-webkit-backdrop-filter: blur(18px) saturate(160%);
			color: inherit;
			font-family: inherit;
			font-size: 12px;
			cursor: pointer;
			max-width: 165px;
			transition: background 0.15s ease, transform 0.12s ease;
		}
		.bos-home-bm-chip:hover {
			background: var(--bos-br-glass-hover);
			transform: translateY(-1px);
		}
		.bos-home-bm-chip span {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		#browserWindow .bos-mode-link {
			background: none;
			border: none;
			color: inherit;
			font: inherit;
			font-size: 12.5px;
			opacity: 0.82;
			cursor: pointer;
			padding: 3px 8px;
			border-radius: 6px;
			text-decoration: underline;
			text-underline-offset: 3px;
		}
		#browserWindow .bos-mode-link:hover {
			opacity: 1;
			background: var(--bos-br-glass-subtle);
		}

		/* Frosted Glass Tab Strip */
		#bosTabStrip {
			position: absolute;
			left: 0;
			right: 0;
			top: var(--bos-browser-hdr);
			height: 36px;
			z-index: 20;
			display: none;
			align-items: center;
			gap: 5px;
			padding: 4px 10px;
			background: var(--bos-br-glass);
			backdrop-filter: blur(22px) saturate(170%);
			-webkit-backdrop-filter: blur(22px) saturate(170%);
			border-bottom: 1px solid var(--bos-br-border);
			overflow-x: auto;
			box-sizing: border-box;
		}
		#browserWindow.bos-iframe-mode #bosTabStrip {
			display: flex;
		}
		#browserWindow.bos-iframe-mode.bos-tabs-bottom #bosTabStrip {
			top: auto;
			bottom: 0;
			border-bottom: none;
			border-top: 1px solid var(--bos-br-border);
		}
		#bosTabStrip.style-pills .bos-tab {
			border-radius: 999px;
			padding: 3px 12px;
		}
		.bos-tab {
			display: flex;
			align-items: center;
			gap: 6px;
			min-width: 86px;
			max-width: 185px;
			padding: 4px 10px;
			border-radius: 8px;
			border: 1px solid var(--bos-br-border);
			background: var(--bos-br-glass-subtle);
			color: inherit;
			opacity: 0.78;
			font-size: 12px;
			cursor: pointer;
			flex-shrink: 0;
			user-select: none;
			transition: background 0.14s ease, border-color 0.14s ease, opacity 0.14s ease;
		}
		.bos-tab:hover {
			opacity: 0.96;
			background: var(--bos-br-glass-hover);
		}
		.bos-tab.active {
			opacity: 1;
			background: var(--bos-br-glass-strong);
			border-color: var(--accent, #2196f3);
			font-weight: 600;
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
			opacity: 0.65;
		}
		.bos-tab-close:hover {
			opacity: 1;
			color: #ef4444;
		}
		.bos-new-tab-btn {
			width: 26px;
			height: 26px;
			border-radius: 8px;
			border: 1px solid var(--bos-br-border);
			background: var(--bos-br-glass-subtle);
			color: inherit;
			font-size: 15px;
			cursor: pointer;
			flex-shrink: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}
		.bos-new-tab-btn:hover {
			background: var(--bos-br-glass-hover);
		}

		/* Frosted Glass Iframe Navigation Bar & Stage */
		#bosIframeOverlay {
			position: absolute;
			left: 0;
			right: 0;
			top: calc(var(--bos-browser-hdr) + 36px);
			bottom: 0;
			z-index: 18;
			display: none;
			flex-direction: column;
			background: transparent;
		}
		#browserWindow.bos-in-iframe #bosIframeOverlay {
			display: flex;
		}
		#browserWindow.bos-in-iframe.bos-tabs-bottom #bosIframeOverlay {
			top: var(--bos-browser-hdr);
			bottom: 36px;
		}
		.bos-nav-bar {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 10px;
			background: var(--bos-br-glass);
			backdrop-filter: blur(22px) saturate(170%);
			-webkit-backdrop-filter: blur(22px) saturate(170%);
			border-bottom: 1px solid var(--bos-br-border);
			flex-shrink: 0;
		}
		.bos-nav-btn {
			padding: 5px 9px;
			border-radius: 9px;
			border: 1px solid var(--bos-br-border);
			background: var(--bos-br-glass-subtle);
			color: inherit;
			font-family: inherit;
			font-size: 12.5px;
			cursor: pointer;
			white-space: nowrap;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 4px;
			transition: background 0.14s ease, border-color 0.14s ease;
		}
		.bos-nav-btn:hover {
			background: var(--bos-br-glass-hover);
		}
		.bos-nav-btn.primary {
			background: var(--accent, #2196f3);
			border-color: transparent;
			color: #ffffff;
			font-weight: 600;
		}
		.bos-nav-btn.bookmarked {
			color: #fbbf24;
			border-color: rgba(251, 191, 36, 0.45);
			background: rgba(251, 191, 36, 0.14);
		}
		.bos-url-input {
			flex: 1;
			min-width: 70px;
			padding: 6px 11px;
			border-radius: 10px;
			border: 1px solid var(--bos-br-border);
			background: var(--bos-br-input);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
			color: inherit;
			font-family: inherit;
			font-size: 12.5px;
			outline: none;
		}
		.bos-url-input:focus {
			border-color: var(--accent, #2196f3);
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

		/* Frosted Glass Modals (Settings & Bookmarks/History Library) */
		.bos-browser-modal {
			position: absolute;
			inset: var(--bos-browser-hdr) 0 0 0;
			z-index: 40;
			background: rgba(8, 10, 16, 0.46);
			backdrop-filter: blur(12px);
			-webkit-backdrop-filter: blur(12px);
			display: none;
			align-items: center;
			justify-content: center;
			padding: 14px;
		}
		.bos-browser-modal.open {
			display: flex;
		}
		.bos-glass-card {
			width: 100%;
			max-width: 470px;
			max-height: 100%;
			overflow-y: auto;
			background: var(--bos-br-glass-strong);
			backdrop-filter: blur(28px) saturate(180%);
			-webkit-backdrop-filter: blur(28px) saturate(180%);
			border: 1px solid var(--bos-br-border);
			border-radius: 16px;
			box-shadow: 0 22px 54px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.14);
			padding: 15px 16px;
			color: inherit;
			display: flex;
			flex-direction: column;
			gap: 11px;
		}
		.bos-settings-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			border-bottom: 1px solid var(--bos-br-border);
			padding-bottom: 8px;
			font-weight: 600;
			font-size: 14px;
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
		.bos-engine-form input,
		.bos-lib-form input {
			background: var(--bos-br-input);
			border: 1px solid var(--bos-br-border);
			color: inherit;
			padding: 6px 9px;
			border-radius: 8px;
			font-family: inherit;
			font-size: 12px;
			outline: none;
		}
		.bos-setting-row select:focus,
		.bos-setting-row input[type="text"]:focus,
		.bos-engine-form input:focus,
		.bos-lib-form input:focus {
			border-color: var(--accent, #2196f3);
		}
		.bos-engine-section {
			border-top: 1px solid var(--bos-br-border);
			padding-top: 10px;
			display: flex;
			flex-direction: column;
			gap: 8px;
			font-size: 12.5px;
		}
		.bos-engine-form,
		.bos-lib-form {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		}
		.bos-engine-form input,
		.bos-lib-form input {
			flex: 1;
			min-width: 110px;
		}
		.bos-engine-list,
		.bos-lib-list {
			display: flex;
			flex-direction: column;
			gap: 5px;
			max-height: 185px;
			overflow-y: auto;
		}
		.bos-engine-item,
		.bos-lib-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 6px 9px;
			border-radius: 9px;
			border: 1px solid var(--bos-br-border);
			background: var(--bos-br-glass-subtle);
			font-size: 12px;
		}
		.bos-lib-item-main {
			flex: 1;
			min-width: 0;
			cursor: pointer;
			display: flex;
			flex-direction: column;
		}
		.bos-lib-item-title {
			font-weight: 600;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.bos-lib-item-sub {
			font-size: 11px;
			opacity: 0.68;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.bos-lib-tabs {
			display: flex;
			gap: 6px;
		}
		.bos-lib-tab-btn {
			flex: 1;
			padding: 6px 10px;
			border-radius: 9px;
			border: 1px solid var(--bos-br-border);
			background: var(--bos-br-glass-subtle);
			color: inherit;
			font-family: inherit;
			font-size: 12.5px;
			font-weight: 600;
			cursor: pointer;
		}
		.bos-lib-tab-btn.active {
			background: var(--accent, #2196f3);
			border-color: transparent;
			color: #ffffff;
		}
	`;
	document.head.appendChild(styleEl);

	// ============================================================================
	// Corner Controls (Bookmarks & History + Settings) & Home Bookmarks Bar
	// ============================================================================
	const cornerActions = document.createElement("div");
	cornerActions.className = "bos-corner-actions";

	const cornerLibraryBtn = document.createElement("button");
	cornerLibraryBtn.type = "button";
	cornerLibraryBtn.className = "bos-glass-icon-btn";
	cornerLibraryBtn.title = "Bookmarks & History";
	cornerLibraryBtn.innerHTML = "<span>★</span><span>Library</span>";

	const cornerSettingsBtn = document.createElement("button");
	cornerSettingsBtn.type = "button";
	cornerSettingsBtn.className = "bos-glass-icon-btn";
	cornerSettingsBtn.title = "Browser Settings";
	cornerSettingsBtn.textContent = "⚙";

	cornerActions.append(cornerLibraryBtn, cornerSettingsBtn);
	browserWindow.appendChild(cornerActions);

	let modeToggleBtn = null;
	const walker = document.createTreeWalker(browserWindow, NodeFilter.SHOW_ELEMENT);
	while (walker.nextNode()) {
		const el = walker.currentNode;
		if (el.children.length === 0 && /opens in a new tab|opens in new tab/i.test(el.textContent.trim())) {
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

	const homeBookmarksEl = document.createElement("div");
	homeBookmarksEl.id = "bosHomeBookmarks";
	enginesContainer.insertAdjacentElement("afterend", homeBookmarksEl);

	function renderHomeBookmarksBar() {
		homeBookmarksEl.innerHTML = "";
		if (!bookmarks.length) {
			homeBookmarksEl.hidden = true;
			return;
		}
		homeBookmarksEl.hidden = false;
		bookmarks.slice(0, 6).forEach((bm) => {
			const chip = document.createElement("button");
			chip.type = "button";
			chip.className = "bos-home-bm-chip";
			chip.title = bm.url;
			chip.innerHTML = `<span>★</span><span>${escapeHtml(bm.title || bm.url)}</span>`;
			chip.addEventListener("click", () => {
				recordHistoryEntry(bm.url, bm.title);
				if (settings.openMode === "iframe") {
					openUrlInCurrentOrNewTab(bm.url);
				} else {
					window.open(bm.url, "_blank", "noopener");
				}
			});
			homeBookmarksEl.appendChild(chip);
		});
	}

	// ============================================================================
	// Tab Strip & Frosted Iframe Navigation Overlay
	// ============================================================================
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
			<button type="button" class="bos-nav-btn" id="bosBookmarkStarBtn" title="Bookmark this page">☆</button>
			<button type="button" class="bos-nav-btn" id="bosIframeLibraryBtn" title="Bookmarks & History">☰</button>
			<button type="button" class="bos-nav-btn" id="bosPopoutBtn" title="Open in new browser tab">↗</button>
			<button type="button" class="bos-nav-btn" id="bosIframeSettingsBtn" title="Settings">⚙</button>
		</div>
		<div class="bos-frame-stage" id="bosFrameStage"></div>
	`;
	browserWindow.appendChild(iframeOverlay);

	const frameStageEl = document.getElementById("bosFrameStage");
	const addressInputEl = document.getElementById("bosAddressInput");
	const bookmarkStarBtn = document.getElementById("bosBookmarkStarBtn");
	preventPasswordBar(addressInputEl);

	let tabs = [
		{ id: "tab-home-1", type: "home", title: "New Tab", url: "", iframe: null },
	];
	let activeTabId = tabs[0].id;

	function getActiveTab() {
		return tabs.find((t) => t.id === activeTabId) || tabs[0];
	}

	function syncBookmarkStarButton() {
		if (!bookmarkStarBtn) return;
		const current = getActiveTab();
		const activeUrl = current && current.type === "url" ? current.url : "";
		const isSaved = Boolean(activeUrl && bookmarks.some((b) => b.url === activeUrl));
		bookmarkStarBtn.textContent = isSaved ? "★" : "☆";
		bookmarkStarBtn.classList.toggle("bookmarked", isSaved);
		bookmarkStarBtn.title = isSaved ? "Remove bookmark" : "Bookmark this page";
	}

	function syncModeUI() {
		const isIframeMode = settings.openMode === "iframe";
		modeToggleBtn.textContent = isIframeMode ? "Opens in iframe ▾" : "Opens in a new tab ▾";
		browserWindow.classList.toggle("bos-iframe-mode", isIframeMode);
		browserWindow.classList.toggle("bos-tabs-bottom", settings.tabBarPosition === "bottom");

		const activeTab = getActiveTab();
		const showingFrame = isIframeMode && activeTab && activeTab.type === "url";
		browserWindow.classList.toggle("bos-in-iframe", showingFrame);

		if (isIframeMode) {
			renderTabs();
		}
		syncBookmarkStarButton();
	}

	modeToggleBtn.addEventListener("click", () => {
		settings.openMode = settings.openMode === "tab" ? "iframe" : "tab";
		saveSettings();
		syncModeUI();
	});

	// ============================================================================
	// URL & Search Engine Resolution
	// ============================================================================
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

	function resolveQueryOrUrl(rawText, engineOverrideKey) {
		const text = String(rawText || "").trim();
		if (!text) return null;

		const direct = webAddress(text);
		if (direct) return direct;

		const key = engineOverrideKey && enginesMap[engineOverrideKey] ? engineOverrideKey : searchEngine;
		const engine = enginesMap[key] || enginesMap[Object.keys(enginesMap)[0]] || BUILTIN_DEFAULTS.google;
		const encoded = encodeURIComponent(text);

		if (engine.url.includes("{q}")) {
			return engine.url.replace(/\{q\}/g, encoded);
		}
		return engine.url + encoded;
	}

	// ============================================================================
	// History & Bookmarks Helpers
	// ============================================================================
	function recordHistoryEntry(url, titleHint) {
		if (!url) return;
		let label = titleHint || "";
		if (!label) {
			try {
				label = new URL(url).hostname.replace(/^www\./, "");
			} catch (e) {
				label = url;
			}
		}
		// Deduplicate immediate consecutive identical URL
		if (historyItems.length > 0 && historyItems[0].url === url) {
			historyItems[0].visitedAt = Date.now();
			if (titleHint) historyItems[0].title = titleHint;
		} else {
			historyItems.unshift({
				id: "hist-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5),
				url: url,
				title: label,
				visitedAt: Date.now(),
			});
			if (historyItems.length > 250) {
				historyItems.length = 250;
			}
		}
		saveHistory();
	}

	function updateLatestHistoryTitle(url, title) {
		if (!url || !title) return;
		const match = historyItems.find((h) => h.url === url);
		if (match) {
			match.title = title;
			saveHistory();
		}
	}

	function toggleBookmarkForCurrentPage() {
		const current = getActiveTab();
		if (!current || current.type !== "url" || !current.url) return;

		const idx = bookmarks.findIndex((b) => b.url === current.url);
		if (idx !== -1) {
			bookmarks.splice(idx, 1);
		} else {
			bookmarks.unshift({
				id: "bm-" + Date.now(),
				title: current.title || current.url,
				url: current.url,
				createdAt: Date.now(),
			});
		}
		saveBookmarks();
	}

	if (bookmarkStarBtn) {
		bookmarkStarBtn.addEventListener("click", toggleBookmarkForCurrentPage);
	}

	// ============================================================================
	// Search Engines Rendering & Editing
	// ============================================================================
	function renderEngines() {
		if (!enginesMap[searchEngine]) {
			searchEngine = Object.keys(enginesMap)[0] || "google";
			localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
		}

		enginesContainer.innerHTML = "";

		Object.entries(enginesMap).forEach(([key, engine]) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.dataset.engine = key;
			btn.classList.toggle("active", key === searchEngine);
			btn.textContent = engine.name;

			btn.addEventListener("click", () => {
				searchEngine = key;
				localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
				renderEngines();
				syncBubbleSearchCard();
			});

			enginesContainer.appendChild(btn);
		});

		const editEnginesBtn = document.createElement("button");
		editEnginesBtn.type = "button";
		editEnginesBtn.textContent = "+ / Edit";
		editEnginesBtn.title = "Add or edit search engines";
		editEnginesBtn.addEventListener("click", () => openSettingsModal(true));
		enginesContainer.appendChild(editEnginesBtn);
	}

	// ============================================================================
	// Tabs Management
	// ============================================================================
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
				const resolved = resolveQueryOrUrl(settings.customHomeUrl);
				if (resolved) openUrlInNewTab(resolved);
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
						updateLatestHistoryTitle(url, docTitle);
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
		recordHistoryEntry(url, tab.title);
		tab.iframe.src = url;
	}

	function openUrlInCurrentOrNewTab(url) {
		let current = getActiveTab();
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
		const current = getActiveTab();
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
		const current = getActiveTab();
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
		const current = getActiveTab();
		if (!current || !current.iframe) return;
		try {
			current.iframe.contentWindow.history.back();
		} catch (e) {}
	});

	document.getElementById("bosReloadBtn").addEventListener("click", () => {
		const current = getActiveTab();
		if (!current || !current.iframe) return;
		current.iframe.src = current.url;
	});

	document.getElementById("bosPopoutBtn").addEventListener("click", () => {
		const current = getActiveTab();
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

	// ============================================================================
	// Bookmarks & History Library Modal
	// ============================================================================
	const libraryModal = document.createElement("div");
	libraryModal.id = "bosLibraryModal";
	libraryModal.className = "bos-browser-modal";
	libraryModal.innerHTML = `
		<div class="bos-glass-card">
			<div class="bos-settings-head">
				<span>Bookmarks &amp; History</span>
				<button type="button" class="bos-nav-btn" id="bosCloseLibraryBtn">Done</button>
			</div>

			<div class="bos-lib-tabs">
				<button type="button" class="bos-lib-tab-btn active" data-lib-tab="bookmarks">Bookmarks</button>
				<button type="button" class="bos-lib-tab-btn" data-lib-tab="history">History</button>
			</div>

			<!-- Bookmarks View -->
			<div id="bosBookmarksPane" style="display:flex;flex-direction:column;gap:8px;">
				<div class="bos-lib-form">
					<input type="text" id="bosBmTitleInput" placeholder="Bookmark title">
					<input type="text" id="bosBmUrlInput" placeholder="https://...">
					<button type="button" class="bos-nav-btn primary" id="bosAddBmBtn">Save</button>
				</div>
				<div class="bos-lib-list" id="bosBookmarksList"></div>
			</div>

			<!-- History View -->
			<div id="bosHistoryPane" style="display:none;flex-direction:column;gap:8px;">
				<div class="bos-lib-form">
					<input type="text" id="bosHistFilterInput" placeholder="Search history...">
					<button type="button" class="bos-nav-btn" id="bosClearHistoryBtn" style="color:#f87171;">Clear All</button>
				</div>
				<div class="bos-lib-list" id="bosHistoryList"></div>
			</div>
		</div>
	`;
	browserWindow.appendChild(libraryModal);

	const bmTitleInput = document.getElementById("bosBmTitleInput");
	const bmUrlInput = document.getElementById("bosBmUrlInput");
	const histFilterInput = document.getElementById("bosHistFilterInput");
	preventPasswordBar(bmTitleInput);
	preventPasswordBar(bmUrlInput);
	preventPasswordBar(histFilterInput);

	let editingBookmarkId = null;

	function navigateFromLibrary(url) {
		libraryModal.classList.remove("open");
		recordHistoryEntry(url);
		if (settings.openMode === "iframe") {
			openUrlInCurrentOrNewTab(url);
		} else {
			window.open(url, "_blank", "noopener");
		}
	}

	function renderBookmarksList() {
		const listEl = document.getElementById("bosBookmarksList");
		listEl.innerHTML = "";

		if (!bookmarks.length) {
			listEl.innerHTML = `<div style="text-align:center;opacity:0.65;padding:16px;font-size:12px;">No bookmarks yet. Click ☆ in the address bar or add one above.</div>`;
			return;
		}

		bookmarks.forEach((bm) => {
			const row = document.createElement("div");
			row.className = "bos-lib-item";

			const main = document.createElement("div");
			main.className = "bos-lib-item-main";
			main.innerHTML = `
				<span class="bos-lib-item-title">${escapeHtml(bm.title || bm.url)}</span>
				<span class="bos-lib-item-sub">${escapeHtml(bm.url)}</span>
			`;
			main.addEventListener("click", () => navigateFromLibrary(bm.url));

			const editBtn = document.createElement("button");
			editBtn.type = "button";
			editBtn.className = "bos-nav-btn";
			editBtn.textContent = "Edit";
			editBtn.addEventListener("click", () => {
				editingBookmarkId = bm.id;
				bmTitleInput.value = bm.title || "";
				bmUrlInput.value = bm.url || "";
				document.getElementById("bosAddBmBtn").textContent = "Update";
				bmTitleInput.focus();
			});

			const delBtn = document.createElement("button");
			delBtn.type = "button";
			delBtn.className = "bos-nav-btn";
			delBtn.style.color = "#f87171";
			delBtn.textContent = "×";
			delBtn.addEventListener("click", () => {
				bookmarks = bookmarks.filter((x) => x.id !== bm.id);
				saveBookmarks();
				renderBookmarksList();
			});

			row.append(main, editBtn, delBtn);
			listEl.appendChild(row);
		});
	}

	function renderHistoryList() {
		const listEl = document.getElementById("bosHistoryList");
		const q = (histFilterInput.value || "").trim().toLowerCase();
		listEl.innerHTML = "";

		const filtered = historyItems.filter(
			(h) => !q || (h.title && h.title.toLowerCase().includes(q)) || h.url.toLowerCase().includes(q)
		);

		if (!filtered.length) {
			listEl.innerHTML = `<div style="text-align:center;opacity:0.65;padding:16px;font-size:12px;">No browsing history found.</div>`;
			return;
		}

		filtered.forEach((item) => {
			const row = document.createElement("div");
			row.className = "bos-lib-item";

			const timeStr = new Date(item.visitedAt || Date.now()).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});

			const main = document.createElement("div");
			main.className = "bos-lib-item-main";
			main.innerHTML = `
				<span class="bos-lib-item-title">${escapeHtml(item.title || item.url)}</span>
				<span class="bos-lib-item-sub">${timeStr} · ${escapeHtml(item.url)}</span>
			`;
			main.addEventListener("click", () => navigateFromLibrary(item.url));

			const delBtn = document.createElement("button");
			delBtn.type = "button";
			delBtn.className = "bos-nav-btn";
			delBtn.style.color = "#f87171";
			delBtn.textContent = "×";
			delBtn.addEventListener("click", () => {
				historyItems = historyItems.filter((x) => x.id !== item.id);
				saveHistory();
				renderHistoryList();
			});

			row.append(main, delBtn);
			listEl.appendChild(row);
		});
	}

	function openLibraryModal(initialTab) {
		editingBookmarkId = null;
		const active = getActiveTab();
		bmTitleInput.value = active && active.type === "url" ? active.title : "";
		bmUrlInput.value = active && active.type === "url" ? active.url : "";
		document.getElementById("bosAddBmBtn").textContent = "Save";

		const tabName = initialTab || "bookmarks";
		libraryModal.querySelectorAll(".bos-lib-tab-btn").forEach((b) => {
			b.classList.toggle("active", b.dataset.libTab === tabName);
		});
		document.getElementById("bosBookmarksPane").style.display = tabName === "bookmarks" ? "flex" : "none";
		document.getElementById("bosHistoryPane").style.display = tabName === "history" ? "flex" : "none";

		renderBookmarksList();
		renderHistoryList();
		libraryModal.classList.add("open");
	}

	libraryModal.querySelectorAll(".bos-lib-tab-btn").forEach((btn) => {
		btn.addEventListener("click", () => openLibraryModal(btn.dataset.libTab));
	});

	document.getElementById("bosAddBmBtn").addEventListener("click", () => {
		const title = bmTitleInput.value.trim();
		const resolvedUrl = webAddress(bmUrlInput.value.trim()) || resolveQueryOrUrl(bmUrlInput.value.trim());
		if (!resolvedUrl) return;

		if (editingBookmarkId) {
			const target = bookmarks.find((b) => b.id === editingBookmarkId);
			if (target) {
				target.title = title || resolvedUrl;
				target.url = resolvedUrl;
			}
			editingBookmarkId = null;
			document.getElementById("bosAddBmBtn").textContent = "Save";
		} else {
			bookmarks.unshift({
				id: "bm-" + Date.now(),
				title: title || resolvedUrl,
				url: resolvedUrl,
				createdAt: Date.now(),
			});
		}

		bmTitleInput.value = "";
		bmUrlInput.value = "";
		saveBookmarks();
		renderBookmarksList();
	});

	histFilterInput.addEventListener("input", renderHistoryList);

	document.getElementById("bosClearHistoryBtn").addEventListener("click", () => {
		historyItems = [];
		saveHistory();
		renderHistoryList();
	});

	cornerLibraryBtn.addEventListener("click", () => openLibraryModal("bookmarks"));
	document.getElementById("bosIframeLibraryBtn").addEventListener("click", () => openLibraryModal("bookmarks"));
	document.getElementById("bosCloseLibraryBtn").addEventListener("click", () => {
		libraryModal.classList.remove("open");
	});

	// ============================================================================
	// Settings Modal (Search Engine Editor + Bubble Search Settings)
	// ============================================================================
	const settingsModal = document.createElement("div");
	settingsModal.id = "bosSettingsModal";
	settingsModal.className = "bos-browser-modal";
	settingsModal.innerHTML = `
		<div class="bos-glass-card">
			<div class="bos-settings-head">
				<span>Browser Settings</span>
				<button type="button" class="bos-nav-btn" id="bosCloseSettingsBtn">Done</button>
			</div>

			<div class="bos-setting-row">
				<span>Open mode</span>
				<select id="bosSetOpenMode">
					<option value="tab">New tab</option>
					<option value="iframe">Iframe (In-App)</option>
				</select>
			</div>

			<div class="bos-setting-row">
				<span>Default search engine</span>
				<select id="bosSetDefaultEngine"></select>
			</div>

			<div class="bos-setting-row">
				<span>Show Search in BrowOS Bubble</span>
				<input type="checkbox" id="bosSetBubbleSearch">
			</div>

			<div class="bos-setting-row" id="bosBubbleEngineRow">
				<span>Bubble search engine</span>
				<select id="bosSetBubbleEngine"></select>
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
				<div style="display:flex;align-items:center;justify-content:space-between;">
					<span style="font-weight:600;">Manage &amp; Edit Search Engines</span>
					<button type="button" class="bos-nav-btn" id="bosResetEnginesBtn">Reset defaults</button>
				</div>
				<div class="bos-engine-form">
					<input type="text" id="bosNewEngineName" placeholder="Engine name">
					<input type="text" id="bosNewEngineUrl" placeholder="https://example.com/search?q=">
					<button type="button" class="bos-nav-btn primary" id="bosAddEngineSubmit">Add</button>
					<button type="button" class="bos-nav-btn" id="bosCancelEngineEditBtn" hidden>Cancel</button>
				</div>
				<div class="bos-engine-list" id="bosSettingsEngineList"></div>
			</div>
		</div>
	`;
	browserWindow.appendChild(settingsModal);

	const setOpenMode = document.getElementById("bosSetOpenMode");
	const setDefaultEngine = document.getElementById("bosSetDefaultEngine");
	const setBubbleSearch = document.getElementById("bosSetBubbleSearch");
	const setBubbleEngine = document.getElementById("bosSetBubbleEngine");
	const bubbleEngineRow = document.getElementById("bosBubbleEngineRow");
	const setTabPos = document.getElementById("bosSetTabPos");
	const setTabStyle = document.getElementById("bosSetTabStyle");
	const setShowUrls = document.getElementById("bosSetShowUrls");
	const setClearInput = document.getElementById("bosSetClearInput");
	const setSandbox = document.getElementById("bosSetSandbox");
	const setHomeMode = document.getElementById("bosSetHomeMode");
	const setCustomHome = document.getElementById("bosSetCustomHome");
	const customHomeRow = document.getElementById("bosCustomHomeRow");
	const engineNameInput = document.getElementById("bosNewEngineName");
	const engineUrlInput = document.getElementById("bosNewEngineUrl");
	const addEngineSubmitBtn = document.getElementById("bosAddEngineSubmit");
	const cancelEngineEditBtn = document.getElementById("bosCancelEngineEditBtn");

	preventPasswordBar(setCustomHome);
	preventPasswordBar(engineNameInput);
	preventPasswordBar(engineUrlInput);

	function populateEngineSelects() {
		if (setDefaultEngine) {
			setDefaultEngine.innerHTML = "";
			Object.entries(enginesMap).forEach(([key, eng]) => {
				const opt = document.createElement("option");
				opt.value = key;
				opt.textContent = eng.name;
				setDefaultEngine.appendChild(opt);
			});
			setDefaultEngine.value = searchEngine;
		}

		if (setBubbleEngine) {
			setBubbleEngine.innerHTML = "";
			const defOpt = document.createElement("option");
			defOpt.value = "default";
			defOpt.textContent = "Same as default (" + ((enginesMap[searchEngine] && enginesMap[searchEngine].name) || "Google") + ")";
			setBubbleEngine.appendChild(defOpt);

			Object.entries(enginesMap).forEach(([key, eng]) => {
				const opt = document.createElement("option");
				opt.value = key;
				opt.textContent = eng.name;
				setBubbleEngine.appendChild(opt);
			});

			setBubbleEngine.value =
				settings.bubbleSearchEngine === "default" || enginesMap[settings.bubbleSearchEngine]
					? settings.bubbleSearchEngine
					: "default";
		}
	}

	function clearEngineEditorForm() {
		editingEngineKey = null;
		engineNameInput.value = "";
		engineUrlInput.value = "";
		addEngineSubmitBtn.textContent = "Add";
		cancelEngineEditBtn.hidden = true;
	}

	function renderSettingsEnginesList() {
		populateEngineSelects();
		const list = document.getElementById("bosSettingsEngineList");
		list.innerHTML = "";

		Object.entries(enginesMap).forEach(([key, eng]) => {
			const row = document.createElement("div");
			row.className = "bos-engine-item";

			const info = document.createElement("div");
			info.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;";
			info.innerHTML = `
				<span style="font-weight:600;">${escapeHtml(eng.name)}${key === searchEngine ? " (Default)" : ""}</span>
				<span style="font-size:11px;opacity:0.66;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(eng.url)}</span>
			`;
			row.appendChild(info);

			const editBtn = document.createElement("button");
			editBtn.type = "button";
			editBtn.className = "bos-nav-btn";
			editBtn.textContent = "Edit";
			editBtn.addEventListener("click", () => {
				editingEngineKey = key;
				engineNameInput.value = eng.name;
				engineUrlInput.value = eng.url;
				addEngineSubmitBtn.textContent = "Save";
				cancelEngineEditBtn.hidden = false;
				engineNameInput.focus();
			});
			row.appendChild(editBtn);

			if (Object.keys(enginesMap).length > 1) {
				const rm = document.createElement("button");
				rm.type = "button";
				rm.className = "bos-nav-btn";
				rm.style.color = "#f87171";
				rm.textContent = "Delete";
				rm.addEventListener("click", () => {
					delete enginesMap[key];
					if (editingEngineKey === key) clearEngineEditorForm();
					if (searchEngine === key) {
						searchEngine = Object.keys(enginesMap)[0] || "google";
						localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
					}
					if (settings.bubbleSearchEngine === key) {
						settings.bubbleSearchEngine = "default";
						saveSettings();
					}
					saveEngines();
					renderEngines();
					renderSettingsEnginesList();
				});
				row.appendChild(rm);
			}

			list.appendChild(row);
		});
	}

	function openSettingsModal(focusEngine) {
		clearEngineEditorForm();
		setOpenMode.value = settings.openMode;
		setBubbleSearch.checked = settings.bubbleSearchEnabled !== false;
		bubbleEngineRow.style.display = setBubbleSearch.checked ? "flex" : "none";
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
			engineNameInput.focus();
		}
	}

	cornerSettingsBtn.addEventListener("click", () => openSettingsModal(false));
	document.getElementById("bosIframeSettingsBtn").addEventListener("click", () => openSettingsModal(false));
	document.getElementById("bosCloseSettingsBtn").addEventListener("click", () => {
		clearEngineEditorForm();
		settingsModal.classList.remove("open");
	});

	setOpenMode.addEventListener("change", () => {
		settings.openMode = setOpenMode.value;
		saveSettings();
		syncModeUI();
	});
	setDefaultEngine.addEventListener("change", () => {
		searchEngine = setDefaultEngine.value;
		localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
		renderEngines();
		renderSettingsEnginesList();
		syncBubbleSearchCard();
	});
	setBubbleSearch.addEventListener("change", () => {
		settings.bubbleSearchEnabled = setBubbleSearch.checked;
		bubbleEngineRow.style.display = settings.bubbleSearchEnabled ? "flex" : "none";
		saveSettings();
	});
	setBubbleEngine.addEventListener("change", () => {
		settings.bubbleSearchEngine = setBubbleEngine.value;
		saveSettings();
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

	cancelEngineEditBtn.addEventListener("click", clearEngineEditorForm);

	document.getElementById("bosResetEnginesBtn").addEventListener("click", () => {
		enginesMap = JSON.parse(JSON.stringify(BUILTIN_DEFAULTS));
		searchEngine = "google";
		localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
		settings.bubbleSearchEngine = "default";
		clearEngineEditorForm();
		saveEngines();
		saveSettings();
		renderEngines();
		renderSettingsEnginesList();
	});

	addEngineSubmitBtn.addEventListener("click", () => {
		const name = engineNameInput.value.trim();
		let url = engineUrlInput.value.trim();

		if (!name || !url) return;
		if (!/^https?:\/\//i.test(url)) {
			url = "https://" + url;
		}

		if (editingEngineKey && enginesMap[editingEngineKey]) {
			enginesMap[editingEngineKey].name = name;
			enginesMap[editingEngineKey].url = url;
			searchEngine = editingEngineKey;
		} else {
			const id = "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
			enginesMap[id] = { name, url, builtIn: false };
			searchEngine = id;
		}

		localStorage.setItem(STORAGE_KEYS.engine, searchEngine);
		clearEngineEditorForm();
		saveEngines();
		renderEngines();
		renderSettingsEnginesList();
	});

	// ============================================================================
	// BrowOS Bubble Search Card (Mini Iframe in Bubble + Open in App Iframe Mode)
	// ============================================================================
	let lastBubbleTarget = "";

	function getActiveBubbleEngine() {
		const chosenKey =
			settings.bubbleSearchEngine && settings.bubbleSearchEngine !== "default" && enginesMap[settings.bubbleSearchEngine]
				? settings.bubbleSearchEngine
				: searchEngine;
		return enginesMap[chosenKey] || enginesMap[Object.keys(enginesMap)[0]] || BUILTIN_DEFAULTS.google;
	}

	function buildBubbleSearchHtml() {
		const activeEng = getActiveBubbleEngine();
		const engineName = escapeHtml(activeEng.name);
		const engineUrl = escapeHtml(activeEng.url);

		return `
			<div style="display:flex;flex-direction:column;gap:7px;">
				<div style="display:flex;gap:5px;align-items:center;">
					<input
						type="text"
						id="bosBubbleQueryInput"
						data-bubble-input
						placeholder="Search ${engineName} or URL..."
						autocomplete="off"
						autocorrect="off"
						autocapitalize="off"
						spellcheck="false"
						style="flex:1;min-width:0;padding:6px 9px;border-radius:9px;"
					>
					<button type="button" id="bosBubbleSearchBtn" style="padding:6px 10px;">Search</button>
					<button type="button" id="bosBubbleOpenAppBtn" style="padding:6px 9px;background:rgba(255,255,255,0.16);" title="Open in Browser app (iframe mode)">Open in App</button>
				</div>

				<div id="bosBubbleMiniWrap" style="display:none;flex-direction:column;gap:5px;">
					<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;opacity:0.86;">
						<span id="bosBubbleMiniLabel" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;"></span>
						<div style="display:flex;gap:4px;flex-shrink:0;">
							<button type="button" id="bosBubbleMiniReload" style="padding:2px 7px;font-size:11px;background:rgba(255,255,255,0.12);">↻</button>
							<button type="button" id="bosBubbleMiniClose" style="padding:2px 7px;font-size:11px;background:rgba(239,68,68,0.28);">×</button>
						</div>
					</div>
					<iframe
						id="bosBubbleMiniFrame"
						sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
						style="width:100%;height:215px;border:1px solid rgba(255,255,255,0.18);border-radius:10px;background:#ffffff;"
					></iframe>
				</div>
			</div>

			<script>
			(function () {
				var ENGINE_URL = ${JSON.stringify(activeEng.url)};
				var inp = document.getElementById("bosBubbleQueryInput");
				var searchBtn = document.getElementById("bosBubbleSearchBtn");
				var openAppBtn = document.getElementById("bosBubbleOpenAppBtn");
				var miniWrap = document.getElementById("bosBubbleMiniWrap");
				var miniFrame = document.getElementById("bosBubbleMiniFrame");
				var miniLabel = document.getElementById("bosBubbleMiniLabel");
				var miniReload = document.getElementById("bosBubbleMiniReload");
				var miniClose = document.getElementById("bosBubbleMiniClose");
				var currentUrl = "";

				function resolveInput(raw) {
					var text = String(raw || "").trim();
					if (!text) return "";
					if (!/\\s/.test(text)) {
						var candidate = /^https?:\\/\\//i.test(text)
							? text
							: (/^[a-z0-9-]+(\\.[a-z0-9-]+)+(:\\d+)?(\\/.*)?$/i.test(text) ? "https://" + text : "");
						if (candidate) {
							try {
								var u = new URL(candidate);
								if (u.protocol === "http:" || u.protocol === "https:") return u.href;
							} catch (e) {}
						}
					}
					var enc = encodeURIComponent(text);
					return ENGINE_URL.indexOf("{q}") !== -1 ? ENGINE_URL.replace(/\\{q\\}/g, enc) : ENGINE_URL + enc;
				}

				function notifyParentHeight() {
					try {
						var h = Math.max(64, Math.min(340, document.body.scrollHeight || 84));
						window.parent.postMessage({ browosBubbleFrame: 1, type: "resize", height: h }, "*");
					} catch (e) {}
				}

				function runBubbleMiniSearch() {
					var raw = inp.value.trim();
					var resolved = resolveInput(raw);
					if (!resolved) return;
					currentUrl = resolved;
					miniLabel.textContent = resolved.replace(/^https?:\\/\\//i, "");
					miniWrap.style.display = "flex";
					miniFrame.src = resolved;
					notifyParentHeight();
					if (typeof window.bubbleAction === "function") {
						window.bubbleAction("bubble-record-history", resolved);
					}
				}

				searchBtn.addEventListener("click", function (e) {
					e.preventDefault();
					e.stopPropagation();
					runBubbleMiniSearch();
				});

				inp.addEventListener("keydown", function (e) {
					if (e.key === "Enter") {
						e.preventDefault();
						e.stopPropagation();
						runBubbleMiniSearch();
					}
				});

				openAppBtn.addEventListener("click", function (e) {
					e.preventDefault();
					e.stopPropagation();
					var payload = inp.value.trim() || currentUrl;
					if (typeof window.bubbleAction === "function") {
						window.bubbleAction("bubble-open-in-app", payload);
						window.bubbleAction("open-app", "");
					}
				});

				miniReload.addEventListener("click", function () {
					if (currentUrl) miniFrame.src = currentUrl;
				});

				miniClose.addEventListener("click", function () {
					miniWrap.style.display = "none";
					miniFrame.src = "about:blank";
					currentUrl = "";
					notifyParentHeight();
				});
			})();
			<\/script>
		`;
	}

	function syncBubbleSearchCard() {
		const api = window.browosApi;
		if (!api || !api.bubble) return;

		if (settings.bubbleSearchEnabled === false) {
			api.bubble.hideCard("browser:search");
			return;
		}

		api.bubble.showCard({
			id: "browser:search",
			appId: "browser",
			appName: "Browser",
			title: "Browser",
			html: buildBubbleSearchHtml(),
		});
	}

	function openQueryInBrowserAppIframeMode(rawQueryOrUrl) {
		const engineKey =
			settings.bubbleSearchEngine && settings.bubbleSearchEngine !== "default" && enginesMap[settings.bubbleSearchEngine]
				? settings.bubbleSearchEngine
				: searchEngine;

		const resolved = resolveQueryOrUrl(rawQueryOrUrl || lastBubbleTarget, engineKey);

		// Ensure Browser window is open and visible
		if (typeof launchApp === "function") {
			launchApp("browser");
		} else {
			browserWindow.classList.add("show");
			browserWindow.classList.remove("minimized");
		}

		// Force in-app iframe rendering mode (not new tab)
		if (settings.openMode !== "iframe") {
			settings.openMode = "iframe";
			saveSettings();
		}

		if (resolved) {
			openUrlInNewTab(resolved);
		} else {
			syncModeUI();
		}
		lastBubbleTarget = "";
	}

	// Hook sdkSendBubbleAction so Bubble Search actions open in-app iframe mode & log history
	function installBubbleActionBridge() {
		if (typeof window.sdkSendBubbleAction !== "function" || window.sdkSendBubbleAction.__bosBrowserHooked) {
			return false;
		}
		const prevBridge = window.sdkSendBubbleAction;
		const wrappedBridge = function (appId, action, value) {
			if (appId === "browser") {
				if (action === "bubble-record-history" && value) {
					lastBubbleTarget = value;
					recordHistoryEntry(value);
					return;
				}
				if (action === "bubble-open-in-app") {
					openQueryInBrowserAppIframeMode(value);
					return;
				}
			}
			return prevBridge.apply(this, arguments);
		};
		wrappedBridge.__bosBrowserHooked = true;
		window.sdkSendBubbleAction = wrappedBridge;
		return true;
	}

	if (!installBubbleActionBridge()) {
		window.addEventListener("load", () => {
			installBubbleActionBridge();
			syncBubbleSearchCard();
		});
	}

	// ============================================================================
	// Main Home Search / Launch Handler
	// ============================================================================
	function openBrowserSearch() {
		const text = browserInput.value.trim();
		if (text === "") return;

		const url = resolveQueryOrUrl(text);
		if (!url) return;

		if (settings.openMode === "iframe") {
			openUrlInCurrentOrNewTab(url);
		} else {
			recordHistoryEntry(url);
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

	// Initial Render
	renderEngines();
	renderHomeBookmarksBar();
	syncModeUI();
	syncBubbleSearchCard();
	setTimeout(() => {
		installBubbleActionBridge();
		syncBubbleSearchCard();
	}, 400);
})();
