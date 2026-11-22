const ROOT_PIN = "3210123";
const MODS_STORAGE_KEY = "browos-root-mods";
const BACKUP_SUFFIX = "__browos_clean_bak";
const INJECT_START = "/* BROWOS-ROOT-MOD:START */";
const INJECT_END = "/* BROWOS-ROOT-MOD:END */";
const HTML_INJECT_START = "<!-- BROWOS-ROOT-MOD:START -->";
const HTML_INJECT_END = "<!-- BROWOS-ROOT-MOD:END -->";

const DEFAULT_MODS = [
	{
		id: "mod-oled-black",
		name: "OLED Pitch-Black UI",
		targetPath: "index.html",
		mode: "inject",
		enabled: true,
		css: `.taskbar, .start-menu, .apps-panel, .context-menu, .app-window, .window-header {
	background: #000000 !important;
	border-color: #1f1f27 !important;
}`,
		js: `console.log("[BrowOS Root] OLED Pitch-Black UI active");`,
	},
];

let mods = loadMods();
let selectedModId = mods[0] ? mods[0].id : null;
let activeEditorTab = "js";
let lastCopiedPath = "";
let cachedEntries = []; // { cacheName, cache, request, url, relPath }
let selectedCacheEntry = null;
let warningAcknowledged = false;
let currentPreviewObjectUrl = null;

// --- 1. PIN AUTHENTICATION ---
const pinOverlay = document.getElementById("pinOverlay");
const pinForm = document.getElementById("pinForm");
const pinInput = document.getElementById("pinInput");
const pinError = document.getElementById("pinError");

if (sessionStorage.getItem("browos-root-unlocked") === "1") {
	pinOverlay.hidden = true;
}

pinForm.addEventListener("submit", (e) => {
	e.preventDefault();
	if (pinInput.value.trim() === ROOT_PIN) {
		sessionStorage.setItem("browos-root-unlocked", "1");
		pinOverlay.hidden = true;
		pinError.hidden = true;
	} else {
		pinError.hidden = false;
		pinInput.value = "";
		pinInput.focus();
	}
});

// --- 2. CONFIRMATION / WARNING DIALOG ---
const confirmOverlay = document.getElementById("confirmOverlay");
const confirmBadge = document.getElementById("confirmBadge");
const confirmTitle = document.getElementById("confirmTitle");
const confirmMessage = document.getElementById("confirmMessage");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
const confirmProceedBtn = document.getElementById("confirmProceedBtn");

function askConfirmation({ badge, title, message, proceedText }) {
	return new Promise((resolve) => {
		confirmBadge.textContent = badge || "WARNING";
		confirmTitle.textContent = title || "Are you sure?";
		confirmMessage.textContent = message;
		confirmProceedBtn.textContent = proceedText || "Continue";
		confirmOverlay.hidden = false;

		function cleanup(result) {
			confirmOverlay.hidden = true;
			confirmCancelBtn.removeEventListener("click", onCancel);
			confirmProceedBtn.removeEventListener("click", onProceed);
			resolve(result);
		}

		function onCancel() { cleanup(false); }
		function onProceed() { cleanup(true); }

		confirmCancelBtn.addEventListener("click", onCancel);
		confirmProceedBtn.addEventListener("click", onProceed);
	});
}

// --- 3. ROOTING ANIMATION OVERLAY ---
const bootAnimOverlay = document.getElementById("bootAnimOverlay");
const animTitle = document.getElementById("animTitle");
const animProgress = document.getElementById("animProgress");
const animLog = document.getElementById("animLog");

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function runBootAnimation(title, steps) {
	animTitle.textContent = title;
	animProgress.style.width = "0%";
	animLog.innerHTML = "";
	bootAnimOverlay.hidden = false;

	for (let i = 0; i < steps.length; i++) {
		const line = document.createElement("div");
		line.textContent = "> " + steps[i];
		animLog.appendChild(line);
		animLog.scrollTop = animLog.scrollHeight;
		animProgress.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
		await sleep(240);
	}
}

// --- 4. SDK & HELPERS ---
const bannerEl = document.getElementById("banner");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const cacheNameEl = document.getElementById("cacheName");
const sdkStatusEl = document.getElementById("sdkStatus");
const unrootBtn = document.getElementById("unrootBtn");

function showBanner(text) {
	bannerEl.textContent = text;
	bannerEl.hidden = false;
	clearTimeout(showBanner._timer);
	showBanner._timer = setTimeout(() => {
		bannerEl.hidden = true;
	}, 4500);
}

function notifyOS(title, msg) {
	if (typeof BrowOS !== "undefined" && BrowOS.available) {
		BrowOS.notify(title, msg).catch(() => {});
	}
}

if (typeof BrowOS !== "undefined" && BrowOS.available) {
	sdkStatusEl.textContent = "Connected";
	BrowOS.ready
		.then((info) => {
			if (info && info.theme) document.body.dataset.theme = info.theme;
			if (info && info.accent) document.documentElement.style.setProperty("--accent", info.accent);
		})
		.catch(() => {});
} else {
	sdkStatusEl.textContent = "Standalone";
}

// Navigation tabs (Cache Explorer vs Mod Patcher)
document.querySelectorAll(".nav-pill").forEach((pill) => {
	pill.addEventListener("click", () => {
		document.querySelectorAll(".nav-pill").forEach((p) => p.classList.remove("active"));
		document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
		pill.classList.add("active");
		document.getElementById(pill.dataset.view).classList.add("active");
	});
});

// --- 5. REAL CACHE FILE EXPLORER ---
const baseRootUrl = new URL("../../", window.location.href).href;

function toRelativePath(fullUrl) {
	if (fullUrl.startsWith(baseRootUrl)) {
		const rel = fullUrl.slice(baseRootUrl.length).split("?")[0];
		return rel === "" ? "index.html" : rel;
	}
	try {
		const u = new URL(fullUrl);
		return u.pathname.replace(/^\/+/, "") || "index.html";
	} catch (e) {
		return fullUrl;
	}
}

function isImagePathOrType(relPath, contentType) {
	return (
		(contentType && contentType.startsWith("image/")) ||
		/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i.test(relPath)
	);
}

function guessImageMime(filename) {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".svg")) return "image/svg+xml";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".ico")) return "image/x-icon";
	return "image/png";
}

async function scanOfflineCache() {
	cachedEntries = [];
	if (!("caches" in window)) {
		statusText.textContent = "Cache API unavailable";
		return;
	}

	const names = await caches.keys();
	if (names.length === 0) {
		statusDot.className = "status-dot unpatched";
		statusText.textContent = "Offline PWA cache empty — reload BrowOS once";
		cacheNameEl.textContent = "None";
		renderFileTree();
		return;
	}

	cacheNameEl.textContent = names[0];
	let hasAnyBackup = false;
	let hasAnyPatch = false;

	for (const name of names) {
		const cache = await caches.open(name);
		const requests = await cache.keys();

		for (const req of requests) {
			if (req.url.endsWith(BACKUP_SUFFIX)) {
				hasAnyBackup = true;
				continue;
			}
			const relPath = toRelativePath(req.url);
			cachedEntries.push({
				cacheName: name,
				cache,
				request: req,
				url: req.url,
				relPath,
			});

			if (relPath === "index.html" || relPath.endsWith(".js") || relPath.endsWith(".css")) {
				try {
					const res = await cache.match(req);
					if (res) {
						const txt = await res.clone().text();
						if (txt.includes(INJECT_START) || txt.includes(HTML_INJECT_START)) {
							hasAnyPatch = true;
						}
					}
				} catch (e) {}
			}
		}
	}

	cachedEntries.sort((a, b) => a.relPath.localeCompare(b.relPath));
	document.getElementById("fileCount").textContent = cachedEntries.length;
	unrootBtn.disabled = !hasAnyBackup;

	if (hasAnyPatch || hasAnyBackup) {
		statusDot.className = "status-dot patched";
		statusText.textContent = "Rooted • Offline Cache Active (" + cachedEntries.length + " files)";
	} else {
		statusDot.className = "status-dot unpatched";
		statusText.textContent = "Stock PWA Cache (" + cachedEntries.length + " files)";
	}

	renderFileTree();
}

function renderFileTree() {
	const treeEl = document.getElementById("fileTree");
	const filter = document.getElementById("treeSearch").value.toLowerCase().trim();
	treeEl.innerHTML = "";

	const filtered = cachedEntries.filter((e) => e.relPath.toLowerCase().includes(filter));
	const groups = {};

	filtered.forEach((entry) => {
		const parts = entry.relPath.split("/");
		const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "/";
		if (!groups[folder]) groups[folder] = [];
		groups[folder].push(entry);
	});

	Object.keys(groups)
		.sort()
		.forEach((folderName) => {
			const groupDiv = document.createElement("div");
			groupDiv.className = "folder-group";

			const titleDiv = document.createElement("div");
			titleDiv.className = "folder-title";
			titleDiv.textContent = "▾ " + folderName;
			titleDiv.addEventListener("click", () => {
				groupDiv.classList.toggle("collapsed");
				titleDiv.textContent = (groupDiv.classList.contains("collapsed") ? "▸ " : "▾ ") + folderName;
			});

			const childrenDiv = document.createElement("div");
			childrenDiv.className = "folder-children";

			groups[folderName].forEach((entry) => {
				const fileName = entry.relPath.split("/").pop();
				const row = document.createElement("div");
				row.className =
					"tree-file" + (selectedCacheEntry && selectedCacheEntry.url === entry.url ? " active" : "");

				const nameSpan = document.createElement("span");
				nameSpan.className = "tree-file-name";
				nameSpan.textContent = fileName;

				row.appendChild(nameSpan);
				row.addEventListener("click", () => inspectCacheEntry(entry));
				childrenDiv.appendChild(row);
			});

			groupDiv.append(titleDiv, childrenDiv);
			treeEl.appendChild(groupDiv);
		});
}

async function inspectCacheEntry(entry) {
	selectedCacheEntry = entry;
	renderFileTree();

	document.getElementById("selectedFilePath").textContent = entry.relPath;
	document.getElementById("copyPathBtn").disabled = false;
	document.getElementById("useInModBtn").disabled = false;
	document.getElementById("replaceFileInput").disabled = false;
	document.getElementById("replaceUploadLabel").classList.remove("disabled");

	const previewEl = document.getElementById("filePreview");
	const imgBox = document.getElementById("imagePreviewBox");
	const imgEl = document.getElementById("imagePreviewImg");
	const metaEl = document.getElementById("fileMeta");

	if (currentPreviewObjectUrl) {
		URL.revokeObjectURL(currentPreviewObjectUrl);
		currentPreviewObjectUrl = null;
	}

	try {
		const res = await entry.cache.match(entry.request);
		if (!res) {
			imgBox.hidden = true;
			previewEl.hidden = false;
			previewEl.value = "File missing in cache.";
			return;
		}

		const contentType = res.headers.get("Content-Type") || "";
		const isImage = isImagePathOrType(entry.relPath, contentType);
		const blob = await res.clone().blob();
		const sizeKB = (blob.size / 1024).toFixed(1);
		const isPatched = await entry.cache.match(entry.url + BACKUP_SUFFIX);

		if (isImage) {
			const typedBlob = blob.type ? blob : new Blob([blob], { type: guessImageMime(entry.relPath) });
			currentPreviewObjectUrl = URL.createObjectURL(typedBlob);
			imgEl.src = currentPreviewObjectUrl;
			imgBox.hidden = false;
			previewEl.hidden = true;

			imgEl.onload = () => {
				metaEl.textContent =
					`Cache: ${entry.cacheName} • Image: ${imgEl.naturalWidth}×${imgEl.naturalHeight}px • Size: ${sizeKB} KB` +
					(isPatched ? " • [MODIFIED]" : "");
			};
		} else {
			imgBox.hidden = true;
			previewEl.hidden = false;
			metaEl.textContent =
				`Cache: ${entry.cacheName} • Type: ${contentType || "text/plain"} • Size: ${sizeKB} KB` +
				(isPatched ? " • [MODIFIED]" : "");
			previewEl.value = await res.text();
		}
	} catch (err) {
		imgBox.hidden = true;
		previewEl.hidden = false;
		previewEl.value = "Error reading cached file: " + err.message;
	}
}

document.getElementById("treeSearch").addEventListener("input", renderFileTree);
document.getElementById("refreshCacheBtn").addEventListener("click", scanOfflineCache);

document.getElementById("copyPathBtn").addEventListener("click", async () => {
	if (!selectedCacheEntry) return;
	lastCopiedPath = selectedCacheEntry.relPath;
	try {
		await navigator.clipboard.writeText(lastCopiedPath);
	} catch (e) {}
	showBanner("Copied path: " + lastCopiedPath);
});

document.getElementById("useInModBtn").addEventListener("click", () => {
	if (!selectedCacheEntry) return;
	lastCopiedPath = selectedCacheEntry.relPath;
	document.getElementById("modTargetInput").value = lastCopiedPath;

	const mod = getSelectedMod();
	if (mod && isImagePathOrType(lastCopiedPath, "")) {
		mod.targetPath = lastCopiedPath;
		mod.mode = "replace";
		persistMods();
		loadModIntoEditor();
		renderModList();
	}

	document.querySelector('.nav-pill[data-view="modsView"]').click();
	showBanner("Target set to: " + lastCopiedPath);
});

// Direct file / image replacement from Cache Explorer
document.getElementById("replaceFileInput").addEventListener("change", async (e) => {
	const file = e.target.files[0];
	e.target.value = "";
	if (!file || !selectedCacheEntry) return;

	const ok = await askConfirmation({
		badge: "ROOT OVERWRITE WARNING",
		title: "Overwrite Cached System File?",
		message: `You are about to replace "${selectedCacheEntry.relPath}" inside the offline PWA cache with "${file.name}". If the file is broken, BrowOS may fail to boot and you will need to Clear Site Data (Reset). Continue?`,
		proceedText: "Overwrite File",
	});

	if (!ok) return;

	const origRes = await selectedCacheEntry.cache.match(selectedCacheEntry.request);
	const backupUrl = selectedCacheEntry.url + BACKUP_SUFFIX;
	if (origRes && !(await selectedCacheEntry.cache.match(backupUrl))) {
		await selectedCacheEntry.cache.put(backupUrl, origRes.clone());
	}

	const headers = new Headers(origRes ? origRes.headers : {});
	const mime = file.type || (isImagePathOrType(selectedCacheEntry.relPath, "") ? guessImageMime(selectedCacheEntry.relPath) : "");
	if (mime) headers.set("Content-Type", mime);

	const buf = await file.arrayBuffer();
	await selectedCacheEntry.cache.put(
		selectedCacheEntry.request,
		new Response(buf, { status: 200, statusText: "OK", headers })
	);

	notifyOS("BrowOS Root", "Replaced " + selectedCacheEntry.relPath);
	showBanner("Replaced " + selectedCacheEntry.relPath + " in offline cache!");
	await scanOfflineCache();
	await inspectCacheEntry(selectedCacheEntry);
});

// --- 6. MOD PATCHER ---
function loadMods() {
	try {
		const raw = JSON.parse(localStorage.getItem(MODS_STORAGE_KEY));
		if (Array.isArray(raw) && raw.length > 0) return raw;
	} catch (e) {}
	return JSON.parse(JSON.stringify(DEFAULT_MODS));
}

function persistMods() {
	localStorage.setItem(MODS_STORAGE_KEY, JSON.stringify(mods));
}

function getSelectedMod() {
	return mods.find((m) => m.id === selectedModId) || null;
}

function fileToDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

function saveEditorToMemory() {
	const mod = getSelectedMod();
	if (!mod) return;
	mod.name = document.getElementById("modNameInput").value.trim() || "Untitled Mod";
	mod.targetPath = document.getElementById("modTargetInput").value.trim() || "index.html";
	mod.mode = document.getElementById("modModeSelect").value;
	mod.enabled = document.getElementById("modEnabledInput").checked;
	if (!mod.binaryDataUrl) {
		mod[activeEditorTab] = document.getElementById("codeEditor").value;
	}
}

function renderModList() {
	const listEl = document.getElementById("modList");
	listEl.innerHTML = "";

	mods.forEach((mod) => {
		const item = document.createElement("div");
		item.className = "mod-item" + (mod.id === selectedModId ? " active" : "");

		const left = document.createElement("div");
		left.style.minWidth = "0";

		const title = document.createElement("div");
		title.className = "mod-item-title";
		title.textContent = mod.name;

		const meta = document.createElement("div");
		meta.className = "mod-item-meta";
		meta.textContent = `${mod.targetPath} (${mod.binaryDataUrl ? "image" : mod.mode})`;

		left.append(title, meta);

		const badge = document.createElement("span");
		badge.className = "mod-badge" + (mod.enabled ? " on" : "");
		badge.textContent = mod.enabled ? "ON" : "OFF";

		item.append(left, badge);
		item.addEventListener("click", () => {
			saveEditorToMemory();
			persistMods();
			selectedModId = mod.id;
			loadModIntoEditor();
			renderModList();
		});

		listEl.appendChild(item);
	});
}

function loadModIntoEditor() {
	const mod = getSelectedMod();
	const nameEl = document.getElementById("modNameInput");
	const targetEl = document.getElementById("modTargetInput");
	const modeEl = document.getElementById("modModeSelect");
	const enabledEl = document.getElementById("modEnabledInput");
	const codeEl = document.getElementById("codeEditor");
	const tabsEl = document.getElementById("editorTabs");
	const modImgBox = document.getElementById("modImagePreviewBox");
	const modImgEl = document.getElementById("modImagePreviewImg");
	const modImgInfo = document.getElementById("modImageInfo");

	if (!mod) {
		nameEl.value = "";
		targetEl.value = "";
		codeEl.value = "";
		codeEl.hidden = false;
		modImgBox.hidden = true;
		return;
	}

	nameEl.value = mod.name;
	targetEl.value = mod.targetPath || "index.html";
	modeEl.value = mod.mode || "inject";
	enabledEl.checked = Boolean(mod.enabled);

	if (mod.binaryDataUrl && mod.mode === "replace") {
		tabsEl.style.display = "none";
		codeEl.hidden = true;
		modImgBox.hidden = false;
		modImgEl.src = mod.binaryDataUrl;
		modImgInfo.textContent = mod.binaryLabel || "Binary image asset ready for cache replacement";
		return;
	}

	modImgBox.hidden = true;
	codeEl.hidden = false;

	if (mod.mode === "replace") {
		tabsEl.style.display = "none";
		activeEditorTab = "js";
		codeEl.placeholder = "// Paste full replacement file content or click 'Load Image / File…'";
	} else {
		tabsEl.style.display = "flex";
		codeEl.placeholder = "// Write JS or CSS to inject/append into target file…";
	}

	codeEl.value = mod[activeEditorTab] || "";
}

document.getElementById("modModeSelect").addEventListener("change", () => {
	const mod = getSelectedMod();
	if (mod && document.getElementById("modModeSelect").value !== "replace") {
		delete mod.binaryDataUrl;
		delete mod.binaryMime;
		delete mod.binaryLabel;
	}
	saveEditorToMemory();
	loadModIntoEditor();
	renderModList();
});

document.querySelectorAll(".tab").forEach((btn) => {
	btn.addEventListener("click", () => {
		saveEditorToMemory();
		persistMods();
		document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
		btn.classList.add("active");
		activeEditorTab = btn.dataset.tab;
		loadModIntoEditor();
	});
});

document.getElementById("pastePathBtn").addEventListener("click", async () => {
	let text = lastCopiedPath;
	try {
		const clip = await navigator.clipboard.readText();
		if (clip) text = clip.trim();
	} catch (e) {}

	if (text) {
		document.getElementById("modTargetInput").value = text;
		const mod = getSelectedMod();
		if (mod && isImagePathOrType(text, "")) {
			mod.targetPath = text;
			mod.mode = "replace";
			loadModIntoEditor();
		} else {
			saveEditorToMemory();
		}
		renderModList();
		showBanner("Pasted path: " + text);
	} else {
		showBanner("No path copied yet — copy a file path in Cache Explorer first.");
	}
});

document.getElementById("loadModFileInput").addEventListener("change", async (e) => {
	const file = e.target.files[0];
	e.target.value = "";
	if (!file) return;

	const mod = getSelectedMod();
	if (!mod) return;

	if (isImagePathOrType(file.name, file.type)) {
		const dataUrl = await fileToDataUrl(file);
		mod.mode = "replace";
		mod.binaryDataUrl = dataUrl;
		mod.binaryMime = file.type || guessImageMime(file.name);
		mod.binaryLabel = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
		persistMods();
		loadModIntoEditor();
		renderModList();
		showBanner(`Loaded image "${file.name}" for cache replacement.`);
	} else {
		delete mod.binaryDataUrl;
		delete mod.binaryMime;
		delete mod.binaryLabel;
		const content = await file.text();
		document.getElementById("codeEditor").value = content;
		saveEditorToMemory();
		persistMods();
		loadModIntoEditor();
		renderModList();
		showBanner(`Loaded "${file.name}" into editor.`);
	}
});

document.getElementById("newModBtn").addEventListener("click", () => {
	saveEditorToMemory();
	const target = lastCopiedPath || "index.html";
	const isImg = isImagePathOrType(target, "");
	const id = "mod-" + Date.now();
	mods.push({
		id,
		name: (isImg ? "Image Mod " : "Custom Patch ") + (mods.length + 1),
		targetPath: target,
		mode: isImg ? "replace" : "inject",
		enabled: true,
		js: isImg ? "" : `console.log("Custom patch loaded!");`,
		css: ``,
	});
	selectedModId = id;
	persistMods();
	renderModList();
	loadModIntoEditor();
});

document.getElementById("deleteModBtn").addEventListener("click", () => {
	if (!selectedModId) return;
	mods = mods.filter((m) => m.id !== selectedModId);
	selectedModId = mods[0] ? mods[0].id : null;
	persistMods();
	renderModList();
	loadModIntoEditor();
});

document.getElementById("saveModBtn").addEventListener("click", () => {
	saveEditorToMemory();
	persistMods();
	renderModList();
	showBanner("Module saved.");
});

document.getElementById("modEnabledInput").addEventListener("change", () => {
	saveEditorToMemory();
	persistMods();
	renderModList();
});

// --- 7. APPLY ALL MODS TO OFFLINE CACHE & REBOOT ---
function buildInjectPayload(mod) {
	const safeCheck = `if (new URLSearchParams(location.search).get("safemode") === "1") return;`;
	const cssBlock =
		mod.css && mod.css.trim()
			? `(function(){var s=document.createElement("style");s.textContent=${JSON.stringify(mod.css)};document.head.appendChild(s);})();`
			: "";
	const jsBlock = mod.js && mod.js.trim() ? mod.js : "";
	return `(function(){\n${safeCheck}\ntry{\n${cssBlock}\n${jsBlock}\n}catch(e){console.error("[RootMod:${mod.name}]",e);}\n})();`;
}

document.getElementById("applyBtn").addEventListener("click", async () => {
	saveEditorToMemory();
	persistMods();

	if (!warningAcknowledged) {
		const agreed = await askConfirmation({
			badge: "DANGER • ROOT ACCESS",
			title: "Modify Offline PWA System Files?",
			message:
				"Root patching directly alters cached BrowOS HTML/JS/CSS/Image files. If a faulty script breaks the desktop interface, the ONLY way to recover is using ?safemode=1 or performing a full browser Clear Site Data (Reset). Do you want to proceed?",
			proceedText: "Yes, Patch & Reboot",
		});
		if (!agreed) return;
		warningAcknowledged = true;
	}

	await scanOfflineCache();
	if (cachedEntries.length === 0) {
		showBanner("Offline PWA cache is empty. Reload BrowOS first.");
		return;
	}

	const enabledMods = mods.filter((m) => m.enabled);
	const steps = [
		"Mounting PWA CacheStorage (" + cachedEntries[0].cacheName + ")…",
		"Verifying clean system backups…",
		`Applying ${enabledMods.length} enabled module(s)…`,
		"Flushing modified assets to Service Worker cache…",
		"Rebooting BrowOS shell…",
	];

	// Group mods by targetPath
	const modsByPath = {};
	enabledMods.forEach((mod) => {
		const p = (mod.targetPath || "index.html").replace(/^\/+/, "");
		if (!modsByPath[p]) modsByPath[p] = [];
		modsByPath[p].push(mod);
	});

	// Restore any previously patched files to clean backup first
	for (const entry of cachedEntries) {
		const backupUrl = entry.url + BACKUP_SUFFIX;
		const bakRes = await entry.cache.match(backupUrl);
		if (bakRes) {
			await entry.cache.put(entry.request, bakRes.clone());
		}
	}

	// Apply mods to each targeted file
	for (const [targetPath, pathMods] of Object.entries(modsByPath)) {
		const entry = cachedEntries.find((e) => e.relPath === targetPath);
		if (!entry) continue;

		const origRes = await entry.cache.match(entry.request);
		if (!origRes) continue;

		const backupUrl = entry.url + BACKUP_SUFFIX;
		if (!(await entry.cache.match(backupUrl))) {
			await entry.cache.put(backupUrl, origRes.clone());
		}

		// Binary image replacement takes precedence on that target path
		const binaryMod = [...pathMods].reverse().find((m) => m.mode === "replace" && m.binaryDataUrl);
		if (binaryMod) {
			const dataRes = await fetch(binaryMod.binaryDataUrl);
			const blob = await dataRes.blob();
			const headers = new Headers(origRes.headers);
			headers.set("Content-Type", binaryMod.binaryMime || blob.type || guessImageMime(targetPath));
			await entry.cache.put(entry.request, new Response(blob, { status: 200, statusText: "OK", headers }));
			continue;
		}

		let content = await origRes.text();
		const isHtml = targetPath.endsWith(".html");

		for (const mod of pathMods) {
			const payload = buildInjectPayload(mod);
			if (mod.mode === "replace") {
				content = mod.js || "";
			} else if (mod.mode === "append") {
				content += isHtml
					? `\n${HTML_INJECT_START}\n<script>\n${payload}\n</script>\n${HTML_INJECT_END}\n`
					: `\n${INJECT_START}\n${payload}\n${INJECT_END}\n`;
			} else {
				if (isHtml) {
					const tag = `\n${HTML_INJECT_START}\n<script>\n${payload}\n</script>\n${HTML_INJECT_END}\n`;
					content = content.includes("</body>") ? content.replace("</body>", tag + "</body>") : content + tag;
				} else {
					content += `\n${INJECT_START}\n${payload}\n${INJECT_END}\n`;
				}
			}
		}

		const headers = new Headers(origRes.headers);
		await entry.cache.put(entry.request, new Response(content, { status: 200, statusText: "OK", headers }));
	}

	notifyOS("BrowOS Root", "Offline cache patched. Rebooting…");
	await runBootAnimation("Rooting & Patching Cache…", steps);

	if (window.parent && window.parent !== window) {
		window.parent.location.reload();
	} else {
		window.location.reload();
	}
});

// --- 8. UNROOT / RESTORE STOCK FILES ---
unrootBtn.addEventListener("click", async () => {
	const ok = await askConfirmation({
		badge: "RESTORE STOCK",
		title: "Unroot & Restore Original Files?",
		message: "All patched files and images in the offline PWA cache will be reverted to their original clean backups.",
		proceedText: "Restore & Reboot",
	});
	if (!ok) return;

	await scanOfflineCache();
	for (const entry of cachedEntries) {
		const backupUrl = entry.url + BACKUP_SUFFIX;
		const bakRes = await entry.cache.match(backupUrl);
		if (bakRes) {
			await entry.cache.put(entry.request, bakRes.clone());
			await entry.cache.delete(backupUrl);
		}
	}

	notifyOS("BrowOS Root", "Stock files restored.");
	await runBootAnimation("Restoring Stock BrowOS…", [
		"Locating clean system backups…",
		"Reverting cached HTML/JS/CSS/Image assets…",
		"Cleaning root metadata…",
		"Rebooting BrowOS…",
	]);

	if (window.parent && window.parent !== window) {
		window.parent.location.reload();
	} else {
		window.location.reload();
	}
});

// --- 9. SYNC TO BROWOS FILES APP ---
document.getElementById("backupFilesBtn").addEventListener("click", async () => {
	saveEditorToMemory();
	persistMods();

	if (typeof BrowOS === "undefined" || !BrowOS.available) {
		showBanner("Open inside BrowOS to sync with Files.");
		return;
	}

	try {
		const name = await BrowOS.files.write("root-mods-backup.json", JSON.stringify(mods, null, 2));
		await BrowOS.notify("BrowOS Root", "Backup saved to Files: " + name);
		showBanner("Saved backup to Files / Apps / " + name);
	} catch (e) {
		showBanner("File permission denied.");
	}
});

// Init
renderModList();
loadModIntoEditor();
scanOfflineCache();
