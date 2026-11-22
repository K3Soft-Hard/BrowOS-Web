const MODS_STORAGE_KEY = "browos-root-mods";
const BACKUP_KEY_SUFFIX = "__browos_clean_backup";
const INJECT_START = "<!-- BROWOS-ROOT-LOADER:START -->";
const INJECT_END = "<!-- BROWOS-ROOT-LOADER:END -->";

const DEFAULT_MODS = [
	{
		id: "mod-header-size",
		name: "Tall Window Headers (Mobile)",
		enabled: true,
		css: `.window-header, .explorer-header {
	height: 48px !important;
	min-height: 48px !important;
	padding: 0 14px !important;
}
.window-controls button, .window-tab-button {
	width: 32px !important;
	height: 32px !important;
	font-size: 18px !important;
}`,
		js: `console.log("[RootMod] Tall Window Headers active");`,
	},
	{
		id: "mod-oled-black",
		name: "OLED Pitch-Black Theme",
		enabled: false,
		css: `.taskbar, .start-menu, .apps-panel, .context-menu, .app-window, .window-header {
	background: #000000 !important;
	border-color: #1e1e24 !important;
}`,
		js: ``,
	},
	{
		id: "mod-hud",
		name: "Performance HUD",
		enabled: false,
		css: `#browos-root-hud {
	position: fixed;
	top: 8px;
	right: 12px;
	z-index: 99999;
	background: rgba(0, 0, 0, 0.78);
	color: #00e5ff;
	font: 11px/1.3 monospace;
	padding: 4px 8px;
	border-radius: 6px;
	border: 1px solid #222;
	pointer-events: none;
}`,
		js: `(function() {
	if (document.getElementById("browos-root-hud")) return;
	const hud = document.createElement("div");
	hud.id = "browos-root-hud";
	document.body.appendChild(hud);
	let frames = 0, last = performance.now();
	function tick(now) {
		frames++;
		if (now - last >= 1000) {
			const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + "MB" : "";
			hud.textContent = frames + " FPS" + (mem ? " | " + mem : "");
			frames = 0;
			last = now;
		}
		requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);
})();`,
	},
];

let mods = loadMods();
let selectedId = mods[0] ? mods[0].id : null;
let activeTab = "js";

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const cacheNameEl = document.getElementById("cacheName");
const sdkStatusEl = document.getElementById("sdkStatus");
const bannerEl = document.getElementById("banner");
const modListEl = document.getElementById("modList");
const modNameInput = document.getElementById("modNameInput");
const modEnabledInput = document.getElementById("modEnabledInput");
const codeEditor = document.getElementById("codeEditor");
const applyBtn = document.getElementById("applyBtn");
const unrootBtn = document.getElementById("unrootBtn");
const backupFilesBtn = document.getElementById("backupFilesBtn");

function showBanner(msg) {
	bannerEl.textContent = msg;
	bannerEl.hidden = false;
	clearTimeout(showBanner._t);
	showBanner._t = setTimeout(() => {
		bannerEl.hidden = true;
	}, 5000);
}

function loadMods() {
	try {
		const raw = JSON.parse(localStorage.getItem(MODS_STORAGE_KEY));
		if (Array.isArray(raw) && raw.length > 0) {
			return raw;
		}
	} catch (e) {}
	return JSON.parse(JSON.stringify(DEFAULT_MODS));
}

function persistMods() {
	localStorage.setItem(MODS_STORAGE_KEY, JSON.stringify(mods));
}

function notifyOS(title, message) {
	if (typeof BrowOS !== "undefined" && BrowOS.available) {
		BrowOS.notify(title, message).catch(() => {});
	}
}

// Initialize BrowOS SDK
if (typeof BrowOS !== "undefined" && BrowOS.available) {
	sdkStatusEl.textContent = "Connected";
	BrowOS.ready
		.then((info) => {
			if (info && info.theme) {
				document.body.dataset.theme = info.theme;
			}
			if (info && info.accent) {
				document.documentElement.style.setProperty("--accent", info.accent);
			}
		})
		.catch(() => {});
} else {
	sdkStatusEl.textContent = "Standalone";
}

// Locate offline PWA cache and cached index.html
async function locateIndexInCache() {
	if (!("caches" in window)) {
		return null;
	}

	const names = await caches.keys();
	if (names.length === 0) {
		return null;
	}

	// Calculate root URL of BrowOS (two levels up from apps/modmanager/)
	const rootUrl = new URL("../../", window.location.href).href;
	const indexUrl = new URL("../../index.html", window.location.href).href;

	for (const name of names) {
		const cache = await caches.open(name);
		const keys = await cache.keys();

		for (const req of keys) {
			if (req.url === indexUrl || req.url === rootUrl || req.url.endsWith("/BrowOS-Web/") || req.url.endsWith("/index.html")) {
				const res = await cache.match(req);
				if (res) {
					return { cacheName: name, cache, request: req, response: res };
				}
			}
		}
	}

	return { cacheName: names[0], cache: await caches.open(names[0]), request: null, response: null };
}

async function refreshPatchStatus() {
	const found = await locateIndexInCache();

	if (!found) {
		statusDot.className = "status-dot";
		statusText.textContent = "Cache Storage unavailable (open over HTTPS / localhost)";
		cacheNameEl.textContent = "None";
		return;
	}

	cacheNameEl.textContent = found.cacheName;

	if (!found.response) {
		statusDot.className = "status-dot unpatched";
		statusText.textContent = "Offline PWA cache not primed yet — reload BrowOS once";
		unrootBtn.disabled = true;
		return;
	}

	const html = await found.response.text();
	const isPatched = html.includes(INJECT_START);
	const backupRes = await found.cache.match(found.request.url + BACKUP_KEY_SUFFIX);

	if (isPatched) {
		statusDot.className = "status-dot patched";
		statusText.textContent = "Rooted & Patched in Offline PWA Cache";
		unrootBtn.disabled = !backupRes;
	} else {
		statusDot.className = "status-dot unpatched";
		statusText.textContent = "Stock BrowOS (Unpatched)";
		unrootBtn.disabled = !backupRes;
	}
}

// Build lightweight bootstrap loader injected into cached index.html
function buildBootLoaderSnippet() {
	return `${INJECT_START}
<script>
(function () {
	try {
		if (new URLSearchParams(location.search).get("safemode") === "1") {
			console.warn("[BrowOS Root] Safe Mode active — skipping custom mods.");
			return;
		}
		var mods = JSON.parse(localStorage.getItem("${MODS_STORAGE_KEY}") || "[]");
		mods.forEach(function (mod) {
			if (!mod || !mod.enabled) return;
			if (mod.css && mod.css.trim()) {
				var st = document.createElement("style");
				st.dataset.browosMod = mod.id;
				st.textContent = mod.css;
				document.head.appendChild(st);
			}
			if (mod.js && mod.js.trim()) {
				try {
					var fn = new Function(mod.js);
					fn();
				} catch (err) {
					console.error("[BrowOS Root] Error in mod " + mod.name + ":", err);
				}
			}
		});
	} catch (e) {
		console.error("[BrowOS Root] Bootloader error:", e);
	}
})();
</script>
${INJECT_END}`;
}

async function patchAndReboot() {
	saveCurrentEditorToMemory();
	persistMods();

	const found = await locateIndexInCache();
	if (!found || !found.response) {
		showBanner("Offline PWA cache not found. Reload BrowOS first so Service Worker caches index.html.");
		return;
	}

	const currentHtml = await found.response.text();
	const backupUrl = found.request.url + BACKUP_KEY_SUFFIX;

	// Save clean backup if not already backed up
	const existingBackup = await found.cache.match(backupUrl);
	let cleanHtml = currentHtml;

	if (!existingBackup) {
		// Strip any old markers just in case
		cleanHtml = currentHtml.replace(
			new RegExp(`${INJECT_START}[\\s\\S]*?${INJECT_END}\\s*`, "g"),
			""
		);
		await found.cache.put(
			backupUrl,
			new Response(cleanHtml, {
				status: 200,
				headers: { "Content-Type": "text/html; charset=utf-8" },
			})
		);
	} else {
		cleanHtml = await existingBackup.text();
	}

	const loader = buildBootLoaderSnippet();
	const patchedHtml = cleanHtml.includes("</body>")
		? cleanHtml.replace("</body>", loader + "\n</body>")
		: cleanHtml + "\n" + loader;

	const headers = new Headers(found.response.headers);
	headers.set("Content-Type", "text/html; charset=utf-8");

	await found.cache.put(
		found.request,
		new Response(patchedHtml, {
			status: 200,
			statusText: "OK",
			headers,
		})
	);

	notifyOS("BrowOS Root", "Offline PWA patched. Rebooting BrowOS…");
	showBanner("Patched offline cache! Rebooting BrowOS…");

	setTimeout(() => {
		if (window.parent && window.parent !== window) {
			window.parent.location.reload();
		} else {
			window.location.reload();
		}
	}, 700);
}

async function unrootAndRestore() {
	const found = await locateIndexInCache();
	if (!found || !found.request) {
		return;
	}

	const backupUrl = found.request.url + BACKUP_KEY_SUFFIX;
	const backupRes = await found.cache.match(backupUrl);

	if (!backupRes) {
		showBanner("No clean backup found in cache.");
		return;
	}

	const cleanHtml = await backupRes.text();
	await found.cache.put(
		found.request,
		new Response(cleanHtml, {
			status: 200,
			statusText: "OK",
			headers: { "Content-Type": "text/html; charset=utf-8" },
		})
	);

	notifyOS("BrowOS Root", "Original index.html restored. Rebooting…");
	showBanner("Restored stock index.html! Rebooting…");

	setTimeout(() => {
		if (window.parent && window.parent !== window) {
			window.parent.location.reload();
		} else {
			window.location.reload();
		}
	}, 700);
}

// UI Rendering
function getSelectedMod() {
	return mods.find((m) => m.id === selectedId) || null;
}

function saveCurrentEditorToMemory() {
	const mod = getSelectedMod();
	if (!mod) return;
	mod.name = modNameInput.value.trim() || "Untitled Module";
	mod.enabled = modEnabledInput.checked;
	mod[activeTab] = codeEditor.value;
}

function renderModList() {
	modListEl.innerHTML = "";

	mods.forEach((mod) => {
		const item = document.createElement("div");
		item.className = "mod-item" + (mod.id === selectedId ? " active" : "");

		const title = document.createElement("span");
		title.className = "mod-item-title";
		title.textContent = mod.name;

		const badge = document.createElement("span");
		badge.className = "mod-badge" + (mod.enabled ? " on" : "");
		badge.textContent = mod.enabled ? "ON" : "OFF";

		item.append(title, badge);
		item.addEventListener("click", () => {
			saveCurrentEditorToMemory();
			persistMods();
			selectedId = mod.id;
			loadSelectedIntoEditor();
			renderModList();
		});

		modListEl.appendChild(item);
	});
}

function loadSelectedIntoEditor() {
	const mod = getSelectedMod();
	if (!mod) {
		modNameInput.value = "";
		modEnabledInput.checked = false;
		codeEditor.value = "";
		return;
	}

	modNameInput.value = mod.name;
	modEnabledInput.checked = Boolean(mod.enabled);
	codeEditor.value = mod[activeTab] || "";
}

document.querySelectorAll(".tab").forEach((tabBtn) => {
	tabBtn.addEventListener("click", () => {
		saveCurrentEditorToMemory();
		persistMods();

		document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
		tabBtn.classList.add("active");
		activeTab = tabBtn.dataset.tab;
		loadSelectedIntoEditor();
	});
});

document.getElementById("newModBtn").addEventListener("click", () => {
	saveCurrentEditorToMemory();
	const id = "mod-" + Date.now();
	mods.push({
		id,
		name: "Custom Mod " + (mods.length + 1),
		enabled: true,
		js: `// Custom JavaScript injected into BrowOS\nconsole.log("Custom mod loaded!");`,
		css: `/* Custom CSS injected into BrowOS */`,
	});
	selectedId = id;
	persistMods();
	renderModList();
	loadSelectedIntoEditor();
});

document.getElementById("deleteModBtn").addEventListener("click", () => {
	if (!selectedId) return;
	mods = mods.filter((m) => m.id !== selectedId);
	selectedId = mods[0] ? mods[0].id : null;
	persistMods();
	renderModList();
	loadSelectedIntoEditor();
});

document.getElementById("saveModBtn").addEventListener("click", () => {
	saveCurrentEditorToMemory();
	persistMods();
	renderModList();
	showBanner("Module saved. Click 'Patch & Reboot' to apply to offline PWA.");
});

modEnabledInput.addEventListener("change", () => {
	saveCurrentEditorToMemory();
	persistMods();
	renderModList();
});

// Sync backup JSON to BrowOS Files app via SDK
backupFilesBtn.addEventListener("click", async () => {
	saveCurrentEditorToMemory();
	persistMods();

	if (typeof BrowOS === "undefined" || !BrowOS.available) {
		showBanner("Open inside BrowOS to sync with the Files app.");
		return;
	}

	try {
		const savedName = await BrowOS.files.write("mods-backup.json", JSON.stringify(mods, null, 2));
		await BrowOS.notify("Root & Mod Manager", "Saved " + savedName + " to Files");
		showBanner("Synced to Files / Apps / " + savedName);
	} catch (err) {
		showBanner("File permission denied or unavailable.");
	}
});

applyBtn.addEventListener("click", patchAndReboot);
unrootBtn.addEventListener("click", unrootAndRestore);

renderModList();
loadSelectedIntoEditor();
refreshPatchStatus();
