// Terminal: a full Linux-style shell (bsh 3.0) for BrowOS.
// Mounts the real BrowOS Files store at /files, supports isolated VMs (app-data only),
// ephemeral no-cache/no-storage Visual BrowOS VM, and two-way BrowOS Bubble cards.

const term = document.getElementById("term");
const output = document.getElementById("output");
const input = document.getElementById("input");
const promptEl = document.getElementById("prompt") || (input && input.previousElementSibling);

const MAX_LINES = 1000;
const STORAGE_VFS_KEY = "browos-terminal-vfs-v2";
const STORAGE_VMS_KEY = "browos-terminal-vms-v1";
const STORAGE_HISTORY_KEY = "browos-terminal-history-v1";
const STORAGE_ALIASES_KEY = "browos-terminal-aliases-v1";
const BOOT_TIME = Date.now();

const history = loadJson(STORAGE_HISTORY_KEY, []);
let historyPosition = history.length;
let activeAbortController = null;
let editorSession = null;

// Active isolated VM state (null = host BrowOS shell)
let activeVmId = null;
let hostSavedPwd = "/files";
let hostSavedOldPwd = "/home/browos";

// Tracks the active Bubble card so button/input actions can refresh it
let activeBubbleState = {
	title: "Terminal",
	templateHtml: "",
	lastOutput: "",
};

const envVars = {
	USER: "browos",
	LOGNAME: "browos",
	HOSTNAME: "desktop",
	HOME: "/home/browos",
	SHELL: "/bin/bsh",
	TERM: "xterm-256color",
	PWD: "/files",
	OLDPWD: "/home/browos",
	PATH: "/usr/local/bin:/usr/bin:/bin:/apps",
	EDITOR: "nano",
	LANG: navigator.language || "en_US.UTF-8",
	"?": "0",
};

const defaultAliases = {
	ll: "ls -la",
	la: "ls -a",
	l: "ls -lh",
	cls: "clear",
	dir: "ls",
	md: "mkdir -p",
	rd: "rm -r",
	browse: "open",
	"xdg-open": "open",
	edit: "nano",
	vi: "nano",
	vim: "nano",
	poweroff: "shutdown",
	halt: "shutdown",
};

const aliases = Object.assign({}, defaultAliases, loadJson(STORAGE_ALIASES_KEY, {}));

function loadJson(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) {
			return fallback;
		}
		const parsed = JSON.parse(raw);
		return parsed !== null && typeof parsed === "object" ? parsed : fallback;
	} catch (error) {
		return fallback;
	}
}

function saveJson(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (error) {
		// Ignore quota errors
	}
}

function print(text, kind) {
	const line = document.createElement("div");

	if (kind) {
		line.className = kind;
	}

	line.textContent = text;
	output.appendChild(line);

	while (output.childElementCount > MAX_LINES) {
		output.firstElementChild.remove();
	}

	output.scrollTop = output.scrollHeight;
}

function printLines(text, kind) {
	const clean = String(text).replace(/\n$/, "");
	if (!clean && text !== "") {
		return;
	}
	clean.split("\n").forEach(function (line) {
		print(line, kind);
	});
}

function escapeHtml(str) {
	return String(str || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function getDesktopApi() {
	if (window.browos) return window.browos;
	try {
		if (window.parent && window.parent !== window && window.parent.browosApi) {
			return window.parent.browosApi;
		}
	} catch (e) {}
	return null;
}

function os(silent) {
	const api = getDesktopApi();
	if (!api) {
		if (!silent) {
			print("bsh: BrowOS desktop bridge is unavailable in standalone mode.", "err");
		}
		return null;
	}
	return api;
}

function readTodos() {
	try {
		const saved = JSON.parse(localStorage.getItem("browos-todo"));
		return Array.isArray(saved) ? saved : [];
	} catch (error) {
		return [];
	}
}

function writeTodos(tasks) {
	localStorage.setItem("browos-todo", JSON.stringify(tasks));
}

// ============================================================================
// Isolated Virtual Machines Store (App-Data Only, Never Visible in /files)
// ============================================================================

let vmStore = loadJson(STORAGE_VMS_KEY, {});
if (!vmStore || typeof vmStore !== "object" || Array.isArray(vmStore)) {
	vmStore = {};
}

function persistVmStore() {
	saveJson(STORAGE_VMS_KEY, vmStore);
}

function cleanVmId(rawId) {
	return String(rawId || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function createVmTree(vmId) {
	const now = Date.now();
	return {
		"/": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/home": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/home/vm": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "vm" },
		"/home/vm/Documents": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "vm" },
		"/home/vm/Downloads": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "vm" },
		"/home/vm/Desktop": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "vm" },
		"/home/vm/scripts": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "vm" },
		"/home/vm/readme.txt": {
			type: "file",
			mtime: now,
			mode: "-rw-r--r--",
			owner: "vm",
			content:
				"Isolated Virtual Filespace: " + vmId + "\n" +
				"-----------------------------------------\n" +
				"- Files inside this VM are stored privately in Terminal app data.\n" +
				"- They do not appear in BrowOS Files (/files).\n" +
				"- Type 'exit' to return to the host BrowOS shell.\n" +
				"- Run 'vm export " + vmId + "' on the host to export files out to /files.\n",
		},
		"/etc": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/etc/hostname": {
			type: "file",
			mtime: now,
			mode: "-rw-r--r--",
			owner: "root",
			content: vmId + "\n",
		},
		"/tmp": { type: "dir", mtime: now, mode: "drwxrwxrwt", owner: "root" },
		"/var": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/var/log": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/var/log/vm.log": {
			type: "file",
			mtime: now,
			mode: "-rw-r--r--",
			owner: "root",
			content: "[" + new Date(now).toISOString() + "] VM '" + vmId + "' initialized.\n",
		},
	};
}

function getActiveTree() {
	if (activeVmId && vmStore[activeVmId] && vmStore[activeVmId].tree) {
		return vmStore[activeVmId].tree;
	}
	return hostVfs;
}

function enterVm(rawId) {
	const id = cleanVmId(rawId);
	if (!id || !vmStore[id]) {
		print("vm: virtual filespace '" + rawId + "' does not exist.", "err");
		return false;
	}
	if (!activeVmId) {
		hostSavedPwd = envVars.PWD;
		hostSavedOldPwd = envVars.OLDPWD;
	}
	activeVmId = id;
	vmStore[id].lastUsed = Date.now();
	persistVmStore();

	envVars.USER = "vm";
	envVars.HOSTNAME = id;
	envVars.HOME = "/home/vm";
	envVars.PWD = "/home/vm";
	envVars.OLDPWD = "/home/vm";
	updatePromptDisplay();

	print("Entered isolated VM '" + id + "' (app-data storage only). Type 'exit' to return to BrowOS.", "accent");
	return true;
}

function exitVm() {
	if (!activeVmId) {
		return false;
	}
	const prevId = activeVmId;
	persistVmStore();
	activeVmId = null;

	envVars.USER = "browos";
	envVars.HOSTNAME = (hostVfs["/etc/hostname"] && hostVfs["/etc/hostname"].content.trim()) || "desktop";
	envVars.HOME = "/home/browos";
	envVars.PWD = hostSavedPwd || "/files";
	envVars.OLDPWD = hostSavedOldPwd || "/home/browos";
	syncFromBrowOSFiles();
	updatePromptDisplay();

	print("Exited VM '" + prevId + "'. Returned to host BrowOS shell.", "accent");
	return true;
}

// ============================================================================
// Visual BrowOS VM (No Cache, Sandboxed Ephemeral RAM Storage, In-App Iframe)
// ============================================================================

let visualVmOverlayEl = null;

function closeVisualVm() {
	if (visualVmOverlayEl) {
		visualVmOverlayEl.remove();
		visualVmOverlayEl = null;
		print("Closed Visual BrowOS VM (all session storage discarded).", "dim");
	}
	input.focus();
}

async function launchVisualBrowOSVm() {
	closeVisualVm();
	print("Booting ephemeral Visual BrowOS VM (no cache, isolated RAM-only storage)...", "accent");

	const overlay = document.createElement("div");
	overlay.id = "bosVisualVmOverlay";
	overlay.style.cssText =
		"position:fixed;inset:0;z-index:99999;background:#090a0f;display:flex;flex-direction:column;font-family:inherit;";

	const bar = document.createElement("div");
	bar.style.cssText =
		"height:38px;padding:0 12px;background:#13151e;border-bottom:1px solid rgba(255,255,255,0.14);color:#f3f4f6;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;flex-shrink:0;";

	const titleSpan = document.createElement("span");
	titleSpan.style.fontWeight = "600";
	titleSpan.textContent = "Visual VM: BrowOS (No Cache · Ephemeral RAM Storage)";

	const btnGroup = document.createElement("div");
	btnGroup.style.cssText = "display:flex;align-items:center;gap:8px;";

	const rebootBtn = document.createElement("button");
	rebootBtn.type = "button";
	rebootBtn.textContent = "Reset & Reboot VM";
	rebootBtn.style.cssText =
		"padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;font-size:12px;cursor:pointer;";

	const closeBtn = document.createElement("button");
	closeBtn.type = "button";
	closeBtn.textContent = "Close VM";
	closeBtn.style.cssText =
		"padding:4px 10px;border-radius:7px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.2);color:#fca5a5;font-size:12px;font-weight:600;cursor:pointer;";
	closeBtn.onclick = closeVisualVm;

	btnGroup.append(rebootBtn, closeBtn);
	bar.append(titleSpan, btnGroup);

	const iframe = document.createElement("iframe");
	// Omit allow-same-origin so the VM gets an opaque origin and cannot touch host localStorage/IndexedDB/parent
	iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals");
	iframe.style.cssText = "flex:1;width:100%;height:100%;border:none;background:#000;";

	overlay.append(bar, iframe);
	document.body.appendChild(overlay);
	visualVmOverlayEl = overlay;

	async function loadFreshEphemeralBrowOS() {
		try {
			const baseUrl = new URL("../../index.html", window.location.href);
			const fetchUrl = baseUrl.href + "?safemode=1&vm=1&nocache=" + Date.now();
			const resp = await fetch(fetchUrl, { cache: "no-store" });
			if (!resp.ok) {
				throw new Error("HTTP " + resp.status);
			}
			let html = await resp.text();

			// Inject <base> for relative assets + ephemeral RAM-only storage shim so BrowOS runs with zero host storage
			const shimScript =
				'<base href="' + baseUrl.href.replace(/"/g, "&quot;") + '">' +
				"<script>(function(){" +
				"function makeMemStore(){const m=new Map();return{get length(){return m.size;},key:function(i){return Array.from(m.keys())[i]||null;},getItem:function(k){return m.has(String(k))?m.get(String(k)):null;},setItem:function(k,v){m.set(String(k),String(v));},removeItem:function(k){m.delete(String(k));},clear:function(){m.clear();}};}" +
				"const ls=makeMemStore(),ss=makeMemStore();" +
				"try{Object.defineProperty(window,'localStorage',{value:ls,configurable:true});}catch(e){}" +
				"try{Object.defineProperty(window,'sessionStorage',{value:ss,configurable:true});}catch(e){}" +
				"try{Object.defineProperty(window,'indexedDB',{value:null,configurable:true});}catch(e){}" +
				"try{Object.defineProperty(navigator,'serviceWorker',{value:undefined,configurable:true});}catch(e){}" +
				"})();<\/script>";

			if (/<head[^>]*>/i.test(html)) {
				html = html.replace(/<head[^>]*>/i, function (m) {
					return m + shimScript;
				});
			} else {
				html = shimScript + html;
			}

			iframe.srcdoc = html;
		} catch (err) {
			iframe.srcdoc =
				'<body style="background:#0d0e14;color:#f87171;font-family:sans-serif;padding:24px;">' +
				"<h3>Failed to boot Visual BrowOS VM</h3><p>" +
				escapeHtml(err && err.message ? err.message : "Could not fetch index.html") +
				"</p></body>";
		}
	}

	rebootBtn.onclick = function () {
		loadFreshEphemeralBrowOS();
	};

	await loadFreshEphemeralBrowOS();
	return true;
}

// ============================================================================
// Real BrowOS Files Bridge (/files <-> localStorage browos-filestore:*)
// ============================================================================

function getRealFileStoreKey() {
	try {
		const meta = JSON.parse(localStorage.getItem("browos-profiles-meta") || "null");
		const id = meta && meta.current ? meta.current : "default";
		return "browos-filestore:" + (id === "default" ? "browos-files" : "browos-files-" + id);
	} catch (e) {
		return "browos-filestore:browos-files";
	}
}

function readRealFileStoreMap() {
	try {
		const parsed = JSON.parse(localStorage.getItem(getRealFileStoreKey()) || "{}") || {};
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch (e) {
		return {};
	}
}

function writeRealFileStoreMap(map) {
	localStorage.setItem(getRealFileStoreKey(), JSON.stringify(map));
	window.dispatchEvent(new Event("files-changed"));
	try {
		if (window.parent && window.parent !== window && window.parent.document) {
			window.parent.document.dispatchEvent(new Event("files-changed"));
		}
	} catch (e) {}
}

function decodeStoredRecordText(record) {
	if (!record) return "";
	if (typeof record.text === "string") return record.text;
	if (typeof record.dataUrl === "string" && record.dataUrl.startsWith("data:")) {
		const comma = record.dataUrl.indexOf(",");
		const meta = record.dataUrl.slice(5, comma);
		const body = record.dataUrl.slice(comma + 1);
		try {
			if (/;base64$/i.test(meta)) {
				const bin = atob(body);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
			}
			return decodeURIComponent(body);
		} catch (e) {
			return "[binary data]";
		}
	}
	return "";
}

function encodeTextToDataUrl(text) {
	const bytes = new TextEncoder().encode(String(text || ""));
	let bin = "";
	for (let i = 0; i < bytes.length; i++) {
		bin += String.fromCharCode(bytes[i]);
	}
	return "data:text/plain;base64," + btoa(bin);
}

function isRealStorePath(absPath) {
	return !activeVmId && (absPath === "/files" || absPath.startsWith("/files/"));
}

function syncFromBrowOSFiles() {
	if (activeVmId) {
		return;
	}
	const map = readRealFileStoreMap();
	const now = Date.now();

	Object.keys(hostVfs).forEach(function (k) {
		if (k === "/files" || k.startsWith("/files/")) {
			delete hostVfs[k];
		}
	});

	hostVfs["/files"] = {
		type: "dir",
		mtime: now,
		mode: "drwxr-xr-x",
		owner: "browos",
		realId: "root",
	};

	const pathById = { root: "/files" };
	let progress = true;
	const remaining = Object.values(map).filter(function (n) {
		return n && n.parent !== "trash";
	});

	while (progress && remaining.length > 0) {
		progress = false;
		for (let i = remaining.length - 1; i >= 0; i--) {
			const node = remaining[i];
			const parentPath = pathById[node.parent || "root"];
			if (parentPath) {
				const fullPath = (parentPath === "/" ? "" : parentPath) + "/" + node.name;
				pathById[node.id] = fullPath;
				hostVfs[fullPath] = {
					type: node.type === "folder" ? "dir" : "file",
					mtime: node.modified || node.created || now,
					mode: node.type === "folder" ? "drwxr-xr-x" : "-rw-r--r--",
					owner: "browos",
					realId: node.id,
					realSize: node.size || 0,
					content: node.type === "folder" ? undefined : decodeStoredRecordText(node),
				};
				remaining.splice(i, 1);
				progress = true;
			}
		}
	}
}

function ensureRealStoreFolderPath(dirPath) {
	const norm = normalizePath(dirPath);
	if (norm === "/files") return "root";

	const rel = norm.replace(/^\/files\/?/, "");
	if (!rel) return "root";

	const segments = rel.split("/").filter(Boolean);
	const map = readRealFileStoreMap();
	let parentId = "root";

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		let existing = Object.values(map).find(function (n) {
			return n && n.type === "folder" && n.parent === parentId && n.name === seg;
		});
		if (!existing) {
			const newId = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
			existing = {
				id: newId,
				parent: parentId,
				name: seg,
				type: "folder",
				created: Date.now(),
				modified: Date.now(),
			};
			map[newId] = existing;
			writeRealFileStoreMap(map);
		}
		parentId = existing.id;
	}

	syncFromBrowOSFiles();
	return parentId;
}

function writeRealStoreFile(absPath, content, append) {
	const norm = normalizePath(absPath);
	const parentPath = getParentPath(norm);
	const baseName = getBaseName(norm);
	const parentId = ensureRealStoreFolderPath(parentPath);

	const map = readRealFileStoreMap();
	let existing = Object.values(map).find(function (n) {
		return n && n.type === "file" && n.parent === parentId && n.name === baseName;
	});

	const prevText = append && existing ? decodeStoredRecordText(existing) : "";
	const nextText = prevText + content;
	const byteLen = new TextEncoder().encode(nextText).length;
	const dataUrl = encodeTextToDataUrl(nextText);

	if (existing) {
		existing.dataUrl = dataUrl;
		existing.size = byteLen;
		existing.modified = Date.now();
		map[existing.id] = existing;
	} else {
		const newId = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
		map[newId] = {
			id: newId,
			parent: parentId,
			name: baseName,
			type: "file",
			mime: baseName.endsWith(".html") ? "text/html" : baseName.endsWith(".json") ? "application/json" : "text/plain",
			size: byteLen,
			created: Date.now(),
			modified: Date.now(),
			dataUrl: dataUrl,
		};
	}

	writeRealFileStoreMap(map);
	syncFromBrowOSFiles();
	return true;
}

function deleteRealStorePath(absPath) {
	const norm = normalizePath(absPath);
	const node = hostVfs[norm];
	if (!node || !node.realId || node.realId === "root") return;

	const map = readRealFileStoreMap();
	const toDelete = new Set([node.realId]);
	let added = true;
	while (added) {
		added = false;
		Object.values(map).forEach(function (n) {
			if (n && toDelete.has(n.parent) && !toDelete.has(n.id)) {
				toDelete.add(n.id);
				added = true;
			}
		});
	}
	toDelete.forEach(function (id) {
		delete map[id];
	});
	writeRealFileStoreMap(map);
	syncFromBrowOSFiles();
}

// ============================================================================
// Host Virtual Filesystem
// ============================================================================

function createDefaultVfs() {
	const now = Date.now();
	return {
		"/": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/files": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "browos", realId: "root" },
		"/bin": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/etc": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/etc/hostname": {
			type: "file",
			mtime: now,
			mode: "-rw-r--r--",
			owner: "root",
			content: "desktop\n",
		},
		"/etc/hosts": {
			type: "file",
			mtime: now,
			mode: "-rw-r--r--",
			owner: "root",
			content: "127.0.0.1\tlocalhost desktop\n::1\t\tlocalhost ip6-localhost\n",
		},
		"/etc/os-release": {
			type: "file",
			mtime: now,
			mode: "-rw-r--r--",
			owner: "root",
			content:
				'NAME="BrowOS"\nVERSION="3.0 (Web Kernel)"\nID=browos\nID_LIKE=linux\nPRETTY_NAME="BrowOS Web Desktop"\n',
		},
		"/home": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/home/browos": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "browos" },
		"/home/browos/.bashrc": {
			type: "file",
			mtime: now,
			mode: "-rw-r--r--",
			owner: "browos",
			content: "alias ll='ls -la'\nalias la='ls -a'\nalias l='ls -lh'\n",
		},
		"/var": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/var/log": { type: "dir", mtime: now, mode: "drwxr-xr-x", owner: "root" },
		"/var/log/syslog": {
			type: "file",
			mtime: now,
			mode: "-rw-r-----",
			owner: "root",
			content:
				"[    0.001] BrowOS Web Kernel initializing...\n" +
				"[    0.014] Mounted BrowOS Files store on /files\n" +
				"[    0.028] Desktop IPC bridge registered\n",
		},
		"/tmp": { type: "dir", mtime: now, mode: "drwxrwxrwt", owner: "root" },
	};
}

let hostVfs = (function initVfs() {
	const saved = loadJson(STORAGE_VFS_KEY, null);
	if (saved && saved["/"] && saved["/home/browos"]) {
		return saved;
	}
	const initial = createDefaultVfs();
	saveJson(STORAGE_VFS_KEY, initial);
	return initial;
})();

function persistActiveStorage() {
	if (activeVmId) {
		persistVmStore();
		return;
	}
	const cleanCopy = {};
	Object.keys(hostVfs).forEach(function (k) {
		if (!isRealStorePath(k)) {
			cleanCopy[k] = hostVfs[k];
		}
	});
	saveJson(STORAGE_VFS_KEY, cleanCopy);
}

function logSyslog(message) {
	const tree = getActiveTree();
	const sec = ((Date.now() - BOOT_TIME) / 1000).toFixed(3).padStart(8, " ");
	const entry = "[" + sec + "] " + message + "\n";
	if (!tree["/var/log/syslog"]) {
		ensureParentDirs("/var/log/syslog");
		tree["/var/log/syslog"] = { type: "file", mtime: Date.now(), mode: "-rw-r-----", owner: "root", content: "" };
	}
	tree["/var/log/syslog"].content += entry;
	tree["/var/log/syslog"].mtime = Date.now();
}

function normalizePath(inputPath, baseDir) {
	const defaultCwd = activeVmId ? "/home/vm" : "/files";
	const cwd = baseDir || envVars.PWD || defaultCwd;
	let raw = (inputPath || "").trim();

	if (!raw || raw === "~") {
		raw = envVars.HOME;
	} else if (!activeVmId && (raw === "~/Files" || raw.startsWith("~/Files/"))) {
		raw = "/files" + raw.slice("~/Files".length);
	} else if (raw.startsWith("~/")) {
		raw = envVars.HOME + "/" + raw.slice(2);
	} else if (!raw.startsWith("/")) {
		raw = (cwd === "/" ? "" : cwd) + "/" + raw;
	}

	const parts = raw.split("/");
	const stack = [];

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (stack.length > 0) {
				stack.pop();
			}
		} else {
			stack.push(part);
		}
	}

	return "/" + stack.join("/");
}

function getParentPath(filePath) {
	const norm = normalizePath(filePath);
	if (norm === "/") {
		return "/";
	}
	const idx = norm.lastIndexOf("/");
	return idx <= 0 ? "/" : norm.slice(0, idx);
}

function getBaseName(filePath) {
	const norm = normalizePath(filePath);
	if (norm === "/") {
		return "/";
	}
	const idx = norm.lastIndexOf("/");
	return norm.slice(idx + 1);
}

function ensureParentDirs(targetPath) {
	const parent = getParentPath(targetPath);
	if (isRealStorePath(parent)) {
		ensureRealStoreFolderPath(parent);
		return;
	}
	const tree = getActiveTree();
	if (parent === "/" || tree[parent]) {
		return;
	}
	const segments = parent.split("/").filter(Boolean);
	let current = "";
	for (let i = 0; i < segments.length; i++) {
		current += "/" + segments[i];
		if (!tree[current]) {
			tree[current] = {
				type: "dir",
				mtime: Date.now(),
				mode: "drwxr-xr-x",
				owner: envVars.USER,
			};
		}
	}
}

function writeVfsFile(filePath, content, append) {
	const resolved = normalizePath(filePath);
	if (isRealStorePath(resolved)) {
		return writeRealStoreFile(resolved, content, append);
	}

	const tree = getActiveTree();
	const parent = getParentPath(resolved);
	if (!tree[parent] || tree[parent].type !== "dir") {
		return false;
	}
	const existing = append && tree[resolved] && tree[resolved].type === "file" ? tree[resolved].content || "" : "";
	const nextContent = existing + content;
	tree[resolved] = {
		type: "file",
		mtime: Date.now(),
		mode: (tree[resolved] && tree[resolved].mode) || "-rw-r--r--",
		owner: (tree[resolved] && tree[resolved].owner) || envVars.USER,
		content: nextContent,
	};
	persistActiveStorage();
	return true;
}

function listChildren(dirPath) {
	const tree = getActiveTree();
	const norm = normalizePath(dirPath);
	const prefix = norm === "/" ? "/" : norm + "/";
	const results = [];

	Object.keys(tree).forEach(function (key) {
		if (key === norm || !key.startsWith(prefix)) {
			return;
		}
		const rest = key.slice(prefix.length);
		if (rest && !rest.includes("/")) {
			results.push({
				name: rest,
				path: key,
				node: tree[key],
			});
		}
	});

	results.sort(function (a, b) {
		if (a.node.type !== b.node.type) {
			return a.node.type === "dir" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

	return results;
}

function formatShortPath(absPath) {
	if (absPath === envVars.HOME) {
		return "~";
	}
	if (absPath.startsWith(envVars.HOME + "/")) {
		return "~" + absPath.slice(envVars.HOME.length);
	}
	return absPath;
}

function getPromptText() {
	if (editorSession) {
		return "[nano:" + getBaseName(editorSession.path) + " L" + (editorSession.lines.length + 1) + "]> ";
	}
	if (activeVmId) {
		return "vm@" + activeVmId + ":" + formatShortPath(envVars.PWD) + "$ ";
	}
	return envVars.USER + "@" + envVars.HOSTNAME + ":" + formatShortPath(envVars.PWD) + "$ ";
}

function updatePromptDisplay() {
	if (promptEl && (promptEl.id === "prompt" || (promptEl.textContent && (promptEl.textContent.includes("@") || promptEl.textContent.startsWith("[nano:"))))) {
		promptEl.textContent = getPromptText();
	}
}

function formatDateShort(timestamp) {
	const d = new Date(timestamp || Date.now());
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const mon = months[d.getMonth()];
	const day = String(d.getDate()).padStart(2, " ");
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return mon + " " + day + " " + hh + ":" + mm;
}

function formatBytes(bytes, human) {
	if (!human) {
		return String(bytes);
	}
	if (bytes < 1024) {
		return bytes + "B";
	}
	if (bytes < 1024 * 1024) {
		return (bytes / 1024).toFixed(1) + "K";
	}
	return (bytes / (1024 * 1024)).toFixed(1) + "M";
}

function wildcardToRegex(pattern) {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp("^" + escaped + "$", "i");
}

function expandGlobs(tokens) {
	const tree = getActiveTree();
	const out = [];
	tokens.forEach(function (tok) {
		if (!tok.includes("*") && !tok.includes("?")) {
			out.push(tok);
			return;
		}
		const slashIdx = tok.lastIndexOf("/");
		const dirPart = slashIdx === -1 ? "" : tok.slice(0, slashIdx + 1);
		const patPart = slashIdx === -1 ? tok : tok.slice(slashIdx + 1);
		const dirAbs = normalizePath(dirPart || envVars.PWD);
		if (!tree[dirAbs] || tree[dirAbs].type !== "dir") {
			out.push(tok);
			return;
		}
		const rx = wildcardToRegex(patPart);
		const matches = listChildren(dirAbs)
			.filter(function (c) {
				return (patPart.startsWith(".") || !c.name.startsWith(".")) && rx.test(c.name);
			})
			.map(function (c) {
				return dirPart + c.name;
			});

		if (matches.length > 0) {
			out.push.apply(out, matches);
		} else {
			out.push(tok);
		}
	});
	return out;
}

// ============================================================================
// URL Helpers
// ============================================================================

function looksLikeUrl(target) {
	if (!target || /\s/.test(target)) {
		return false;
	}
	if (/^(https?:\/\/|mailto:|tel:|about:|data:|blob:)/i.test(target)) {
		return true;
	}
	if (/^localhost(:\d+)?(\/.*)?$/i.test(target)) {
		return true;
	}
	if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(target)) {
		return true;
	}
	if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(target)) {
		const ext = target.split(/[/?#]/)[0].split(".").pop().toLowerCase();
		const localFileExts = [
			"txt", "md", "js", "json", "css", "html", "log", "sh", "py",
			"csv", "xml", "yml", "yaml", "ini", "conf", "cfg", "ts", "tsx",
		];
		if (localFileExts.includes(ext) && !target.includes("/")) {
			return false;
		}
		return true;
	}
	return false;
}

function normalizeUrl(rawUrl) {
	if (/^(https?:\/\/|mailto:|tel:|about:|data:|blob:)/i.test(rawUrl)) {
		return rawUrl;
	}
	if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?/i.test(rawUrl)) {
		return "http://" + rawUrl;
	}
	return "https://" + rawUrl;
}

// ============================================================================
// Shell Parser: Variables, Quotes, Pipes (|), Redirections (<, >, >>), Chains
// ============================================================================

function expandVariables(text) {
	return text.replace(/\$([A-Za-z_?][A-Za-z0-9_]*)|\$\{([A-Za-z_?][A-Za-z0-9_]*)\}/g, function (_, v1, v2) {
		const key = v1 || v2;
		return Object.prototype.hasOwnProperty.call(envVars, key) ? String(envVars[key]) : "";
	});
}

function tokenizeStage(segment) {
	const tokens = [];
	let current = "";
	let quote = null;
	let hasToken = false;
	let wasQuoted = false;

	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];

		if (quote) {
			if (ch === "\\" && quote === '"' && i + 1 < segment.length) {
				i++;
				const next = segment[i];
				current += next === "n" ? "\n" : next === "t" ? "\t" : next;
			} else if (ch === quote) {
				quote = null;
			} else {
				current += ch;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			quote = ch;
			hasToken = true;
			wasQuoted = true;
			continue;
		}

		if (ch === "\\" && i + 1 < segment.length) {
			i++;
			current += segment[i];
			hasToken = true;
			continue;
		}

		if (ch === ">" || ch === "<") {
			if (hasToken || current.length > 0) {
				tokens.push({ value: expandVariables(current), quoted: wasQuoted });
				current = "";
				hasToken = false;
				wasQuoted = false;
			}
			if (ch === ">" && segment[i + 1] === ">") {
				tokens.push({ value: ">>", op: true });
				i++;
			} else {
				tokens.push({ value: ch, op: true });
			}
			continue;
		}

		if (/\s/.test(ch)) {
			if (hasToken || current.length > 0) {
				tokens.push({ value: expandVariables(current), quoted: wasQuoted });
				current = "";
				hasToken = false;
				wasQuoted = false;
			}
			continue;
		}

		current += ch;
		hasToken = true;
	}

	if (hasToken || current.length > 0) {
		tokens.push({ value: expandVariables(current), quoted: wasQuoted });
	}

	return tokens;
}

function splitPipeline(commandStr) {
	const stages = [];
	let current = "";
	let quote = null;

	for (let i = 0; i < commandStr.length; i++) {
		const ch = commandStr[i];
		if (quote) {
			current += ch;
			if (ch === quote && commandStr[i - 1] !== "\\") {
				quote = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "|") {
			stages.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	if (current.trim()) {
		stages.push(current.trim());
	}
	return stages;
}

function splitChainedCommands(line) {
	const chain = [];
	let current = "";
	let quote = null;
	let nextOp = ";";

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];

		if (quote) {
			current += ch;
			if (ch === quote && line[i - 1] !== "\\") {
				quote = null;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}

		if (ch === "#") {
			break;
		}

		if (ch === ";") {
			if (current.trim()) {
				chain.push({ raw: current.trim(), op: nextOp });
			}
			current = "";
			nextOp = ";";
			continue;
		}

		if (ch === "&" && line[i + 1] === "&") {
			if (current.trim()) {
				chain.push({ raw: current.trim(), op: nextOp });
			}
			current = "";
			nextOp = "&&";
			i++;
			continue;
		}

		if (ch === "|" && line[i + 1] === "|") {
			if (current.trim()) {
				chain.push({ raw: current.trim(), op: nextOp });
			}
			current = "";
			nextOp = "||";
			i++;
			continue;
		}

		current += ch;
	}

	if (current.trim()) {
		chain.push({ raw: current.trim(), op: nextOp });
	}

	return chain;
}

// ============================================================================
// Interactive Inline File Editor (nano / edit)
// ============================================================================

function startNanoEditor(targetPath) {
	syncFromBrowOSFiles();
	const tree = getActiveTree();
	const resolved = normalizePath(targetPath);
	const parent = getParentPath(resolved);
	if (!isRealStorePath(resolved) && (!tree[parent] || tree[parent].type !== "dir")) {
		print("nano: directory '" + parent + "' does not exist", "err");
		return false;
	}
	if (tree[resolved] && tree[resolved].type === "dir") {
		print("nano: '" + targetPath + "' is a directory", "err");
		return false;
	}

	const existing = tree[resolved] ? tree[resolved].content || "" : "";
	const lines = existing ? existing.replace(/\n$/, "").split("\n") : [];

	editorSession = {
		path: resolved,
		lines: lines,
		dirty: false,
	};

	updatePromptDisplay();
	print("  GNU nano (bsh) - Editing " + formatShortPath(resolved), "accent");
	print("  Commands: :w (save) | :wq (save & quit) | :q (quit) | :p (print) | :d <line#> (delete) | :c (clear)", "dim");
	print("  Shortcuts: Ctrl+S save | Ctrl+X exit | Enter appends a new line", "dim");
	if (lines.length > 0) {
		lines.forEach(function (l, idx) {
			print(String(idx + 1).padStart(3) + " | " + l);
		});
	} else {
		print("  (new empty buffer)", "dim");
	}
	return true;
}

function saveNanoBuffer() {
	if (!editorSession) {
		return;
	}
	const body = editorSession.lines.join("\n") + (editorSession.lines.length > 0 ? "\n" : "");
	writeVfsFile(editorSession.path, body, false);
	editorSession.dirty = false;
	print("[ Wrote " + editorSession.lines.length + " lines (" + body.length + " bytes) to " + formatShortPath(editorSession.path) + " ]", "accent");
}

function exitNanoEditor() {
	if (!editorSession) {
		return;
	}
	const closedPath = editorSession.path;
	editorSession = null;
	updatePromptDisplay();
	print("[ Closed " + formatShortPath(closedPath) + " ]", "dim");
}

function handleNanoLine(rawLine) {
	const trimmed = rawLine.trim();

	if (trimmed === ":w") {
		saveNanoBuffer();
		return;
	}
	if (trimmed === ":wq" || trimmed === ":x") {
		saveNanoBuffer();
		exitNanoEditor();
		return;
	}
	if (trimmed === ":q" || trimmed === ":q!") {
		exitNanoEditor();
		return;
	}
	if (trimmed === ":p") {
		if (editorSession.lines.length === 0) {
			print("  (empty buffer)", "dim");
		} else {
			editorSession.lines.forEach(function (l, idx) {
				print(String(idx + 1).padStart(3) + " | " + l);
			});
		}
		return;
	}
	if (trimmed === ":c") {
		editorSession.lines = [];
		editorSession.dirty = true;
		updatePromptDisplay();
		print("[ Buffer cleared ]", "dim");
		return;
	}
	if (trimmed.startsWith(":d ")) {
		const lineNum = parseInt(trimmed.slice(3), 10) - 1;
		if (!Number.isNaN(lineNum) && lineNum >= 0 && lineNum < editorSession.lines.length) {
			const removed = editorSession.lines.splice(lineNum, 1)[0];
			editorSession.dirty = true;
			updatePromptDisplay();
			print("[ Deleted line " + (lineNum + 1) + ": " + removed + " ]", "dim");
		} else {
			print("[ Invalid line number ]", "err");
		}
		return;
	}

	editorSession.lines.push(rawLine);
	editorSession.dirty = true;
	updatePromptDisplay();
	print(String(editorSession.lines.length).padStart(3) + " | " + rawLine);
}

// ============================================================================
// Commands
// ============================================================================

const commands = {
	help: {
		about: "show command reference or help for one command",
		usage: "help [command]",
		run: function (args) {
			if (args[0]) {
				const target = args[0].toLowerCase();
				const cmd = commands[target];
				if (!cmd) {
					print("help: no manual entry for '" + target + "'", "err");
					return false;
				}
				print(target + " - " + cmd.about, "accent");
				if (cmd.usage) {
					print("Usage: " + cmd.usage);
				}
				return true;
			}

			const groups = {
				"Virtual Machines & Isolation": [
					"vm", "exit",
				],
				"Files & Text": [
					"ls", "cd", "pwd", "tree", "mkdir", "rmdir", "touch", "nano", "cat", "tac",
					"head", "tail", "less", "wc", "grep", "sed", "cut", "tr", "sort", "uniq",
					"diff", "tee", "find", "stat", "file", "du", "df", "chmod", "chown", "cp", "mv", "rm",
				],
				"Network & Data": [
					"curl", "wget", "dig", "nslookup", "ping", "ip", "open", "search", "json", "base64",
				],
				"BrowOS Desktop & Bubble": [
					"bubble", "apps", "systemctl", "apt", "ps", "top", "kill", "killall", "pgrep",
					"notify", "notify-send", "theme", "accent", "wallpaper", "note", "todo",
					"lock", "screensaver", "reboot", "shutdown",
				],
				"Shell & System": [
					"sh", "neofetch", "uname", "uptime", "free", "dmesg", "date", "cal",
					"whoami", "id", "hostname", "env", "export", "unset", "alias", "unalias",
					"which", "type", "calc", "seq", "sleep", "history", "clear", "man",
				],
			};

			print("BrowOS Shell (bsh 3.0) - Command Reference", "accent");
			Object.keys(groups).forEach(function (groupName) {
				print("");
				print(groupName + ":", "accent");
				print("  " + groups[groupName].join(", "));
			});

			print("");
			print("Run 'help <command>' for syntax & flags. Supports pipes (|), redirects (>, >>, <), &&, ;, and Tab completion.", "dim");
			return true;
		},
	},

	man: {
		about: "display manual page for a command",
		usage: "man <command>",
		run: function (args) {
			return commands.help.run(args);
		},
	},

	clear: {
		about: "clear the terminal screen",
		usage: "clear",
		run: function () {
			output.innerHTML = "";
			return true;
		},
	},

	exit: {
		about: "exit active VM back to host shell, or close Terminal",
		usage: "exit",
		run: function () {
			if (activeVmId) {
				return exitVm();
			}
			const api = os(true);
			if (api && typeof api.closeApp === "function") {
				api.closeApp("terminal");
			} else {
				print("No active VM session to exit.", "dim");
			}
			return true;
		},
	},

	logout: {
		about: "exit active VM session",
		usage: "logout",
		run: function () {
			return commands.exit.run();
		},
	},

	// ------------------------------------------------------------------------
	// Isolated Virtual Machines (App-Data Filespaces + Visual BrowOS VM)
	// ------------------------------------------------------------------------

	vm: {
		about: "manage isolated virtual filespaces & ephemeral Visual BrowOS VM",
		usage: "vm <create <id> | enter <id> | exit | list | delete <id> | export <id> [folder] | move-out <id> [folder] | visual>",
		run: async function (args) {
			const sub = (args[0] || "list").toLowerCase();

			if (sub === "visual" || sub === "os" || sub === "gui" || sub === "browos") {
				return launchVisualBrowOSVm();
			}

			if (sub === "exit" || sub === "leave" || sub === "host") {
				if (!activeVmId) {
					print("Already on host BrowOS shell.", "dim");
					return true;
				}
				return exitVm();
			}

			if (sub === "list" || sub === "ls") {
				const ids = Object.keys(vmStore).sort();
				if (!ids.length) {
					print("No saved virtual filespaces. Create one with: vm create <id>", "dim");
					return true;
				}
				print("VM ID               FILES   SIZE     STATUS", "accent");
				ids.forEach(function (id) {
					const tree = vmStore[id].tree || {};
					let files = 0;
					let bytes = 0;
					Object.keys(tree).forEach(function (p) {
						if (tree[p] && tree[p].type === "file") {
							files++;
							bytes += (tree[p].content || "").length;
						}
					});
					const status = activeVmId === id ? "active" : "saved";
					print(
						id.padEnd(20) +
							String(files).padEnd(8) +
							formatBytes(bytes, true).padEnd(9) +
							status
					);
				});
				return true;
			}

			if (sub === "create" || sub === "new" || sub === "init") {
				const rawId = args[1];
				const id = cleanVmId(rawId);
				if (!id) {
					print("Usage: vm create <id> [--enter]", "err");
					return false;
				}
				if (vmStore[id]) {
					print("vm: virtual filespace '" + id + "' already exists.", "err");
					return false;
				}
				vmStore[id] = {
					id: id,
					created: Date.now(),
					lastUsed: Date.now(),
					tree: createVmTree(id),
				};
				persistVmStore();
				print("Created isolated virtual filespace '" + id + "' (stored in app data only).", "accent");
				if (args.includes("--enter") || args.includes("-e")) {
					return enterVm(id);
				}
				print("Run 'vm enter " + id + "' to switch into it.", "dim");
				return true;
			}

			if (sub === "enter" || sub === "start" || sub === "use" || sub === "switch") {
				if (!args[1]) {
					print("Usage: vm enter <id>", "err");
					return false;
				}
				return enterVm(args[1]);
			}

			if (sub === "delete" || sub === "rm" || sub === "remove") {
				const id = cleanVmId(args[1]);
				if (!id || !vmStore[id]) {
					print("vm: virtual filespace '" + (args[1] || "") + "' not found.", "err");
					return false;
				}
				if (activeVmId === id) {
					exitVm();
				}
				delete vmStore[id];
				persistVmStore();
				print("Deleted virtual filespace '" + id + "'.");
				return true;
			}

			if (sub === "export" || sub === "move-out" || sub === "pull") {
				const id = cleanVmId(args[1]);
				if (!id || !vmStore[id]) {
					print("Usage: vm " + sub + " <id> [dest-folder-in-/files]", "err");
					return false;
				}
				const shouldMove = sub === "move-out" || args.includes("--move") || args.includes("-m");
				const destArg = args.slice(2).find(function (a) { return !a.startsWith("-"); });
				const destRoot = destArg
					? (destArg.startsWith("/files") ? normalizePath(destArg) : normalizePath("/files/" + destArg.replace(/^\/+/, "")))
					: "/files/vm-" + id;

				const wasInVm = activeVmId;
				if (wasInVm) {
					activeVmId = null;
				}

				syncFromBrowOSFiles();
				ensureRealStoreFolderPath(destRoot);

				const tree = vmStore[id].tree || {};
				const filePaths = Object.keys(tree).filter(function (p) {
					return tree[p] && tree[p].type === "file";
				});

				let exportedCount = 0;
				filePaths.forEach(function (p) {
					// Strip /home/vm prefix so Documents/foo.txt lands cleanly in destRoot/Documents/foo.txt
					const relPath = p.startsWith("/home/vm/") ? p.slice("/home/vm/".length) : p.replace(/^\/+/, "");
					const outFullPath = destRoot + "/" + relPath;
					writeRealStoreFile(outFullPath, tree[p].content || "", false);
					exportedCount++;
					if (shouldMove) {
						delete tree[p];
					}
				});

				if (shouldMove) {
					persistVmStore();
				}

				if (wasInVm) {
					activeVmId = wasInVm;
				}

				print(
					(shouldMove ? "Moved " : "Exported ") +
						exportedCount +
						" file(s) from VM '" +
						id +
						"' to '" +
						destRoot +
						"'.",
					"accent"
				);
				return true;
			}

			print("Usage: vm <create <id> | enter <id> | exit | list | delete <id> | export <id> [folder] | move-out <id> [folder] | visual>", "err");
			return false;
		},
	},

	// ------------------------------------------------------------------------
	// BrowOS Bubble Command (Two-Way Interactive HTML Cards)
	// ------------------------------------------------------------------------

	bubble: {
		about: "display custom HTML from a file or string inside BrowOS Bubble",
		usage: "bubble show <file.html> [title] | bubble html \"<p>Hi</p>\" [title] | bubble shell | bubble hide | bubble list",
		run: function (args, stdin) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			const api = os();
			if (!api || !api.bubble) {
				print("bubble: BrowOS Bubble API is unavailable.", "err");
				return false;
			}

			const sub = (args[0] || "").toLowerCase();

			if (sub === "hide" || sub === "clear" || sub === "remove") {
				const cardId = args[1] || "terminal:main";
				const fullId = cardId.includes(":") ? cardId : "terminal:" + cardId;
				api.bubble.hideCard(fullId);
				activeBubbleState.templateHtml = "";
				print("Hidden Bubble card '" + fullId + "'.");
				return true;
			}

			if (sub === "list" || sub === "ls") {
				const cards = api.bubble.listCards();
				if (!cards.length) {
					print("No custom app cards currently active in BrowOS Bubble.", "dim");
					return true;
				}
				cards.forEach(function (c) {
					print(c.id + "  (" + c.title + ")");
				});
				return true;
			}

			if (sub === "shell" || sub === "widget") {
				const shellHtml =
					'<div>' +
					'<p data-bubble-output style="font-family:monospace;font-size:11.5px;max-height:70px;overflow-y:auto;margin:0 0 6px;">Ready. Run a command below.</p>' +
					'<div style="display:flex;gap:5px;margin-bottom:6px;">' +
					'<input type="text" data-bubble-input placeholder="Command (e.g. uptime, ls)..." style="flex:1;padding:4px 8px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.25);color:inherit;font-size:12px;">' +
					'<button type="button" data-bubble-action="run">Run</button>' +
					"</div>" +
					'<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
					'<button type="button" data-bubble-action="run" data-bubble-prompt="uptime">Uptime</button>' +
					'<button type="button" data-bubble-action="run" data-bubble-prompt="df -h">Disk</button>' +
					'<button type="button" data-bubble-action="open-app">Open Terminal</button>' +
					"</div>" +
					"</div>";

				activeBubbleState = {
					title: "Terminal",
					templateHtml: shellHtml,
					lastOutput: "",
				};
				api.bubble.showCard({
					id: "terminal:main",
					appId: "terminal",
					appName: "Terminal",
					title: "Terminal",
					html: shellHtml,
				});
				print("Opened interactive Terminal card in BrowOS Bubble.", "accent");
				return true;
			}

			if (sub === "html") {
				const rawHtml = args[1] || (typeof stdin === "string" ? stdin : "");
				const title = args.slice(2).join(" ") || "Terminal";
				if (!rawHtml.trim()) {
					print("Usage: bubble html \"<h3>Hello</h3>\" [title]", "err");
					return false;
				}
				activeBubbleState = {
					title: title,
					templateHtml: rawHtml,
					lastOutput: "",
				};
				api.bubble.showCard({
					id: "terminal:main",
					appId: "terminal",
					appName: "Terminal",
					title: title,
					html: rawHtml,
				});
				print("Displayed custom HTML card '" + title + "' in BrowOS Bubble.", "accent");
				return true;
			}

			const fileArg = sub === "show" ? args[1] : args[0];
			const titleArgs = sub === "show" ? args.slice(2) : args.slice(1);

			if (!fileArg && typeof stdin === "string" && stdin.trim()) {
				const title = titleArgs.join(" ") || "Terminal";
				activeBubbleState = {
					title: title,
					templateHtml: stdin,
					lastOutput: "",
				};
				api.bubble.showCard({
					id: "terminal:main",
					appId: "terminal",
					appName: "Terminal",
					title: title,
					html: stdin,
				});
				print("Displayed piped HTML card '" + title + "' in BrowOS Bubble.", "accent");
				return true;
			}

			if (!fileArg) {
				print("Usage: bubble show <file.html> [title] | bubble html \"<p>Hi</p>\" [title] | bubble shell | bubble hide", "err");
				return false;
			}

			const resolved = normalizePath(fileArg);
			const node = tree[resolved];
			if (!node || node.type !== "file") {
				print("bubble: cannot open '" + fileArg + "': No such file", "err");
				return false;
			}

			const title = titleArgs.join(" ") || getBaseName(resolved);
			const htmlBody = node.content || "";
			activeBubbleState = {
				title: title,
				templateHtml: htmlBody,
				lastOutput: "",
			};
			api.bubble.showCard({
				id: "terminal:main",
				appId: "terminal",
				appName: "Terminal",
				title: title,
				html: htmlBody,
			});
			print("Loaded '" + formatShortPath(resolved) + "' into BrowOS Bubble (" + title + ").", "accent");
			return true;
		},
	},

	// ------------------------------------------------------------------------
	// Filesystem & Navigation
	// ------------------------------------------------------------------------

	pwd: {
		about: "print current working directory",
		usage: "pwd",
		run: function () {
			print(envVars.PWD);
			return true;
		},
	},

	cd: {
		about: "change current working directory",
		usage: "cd [dir | - | ~ | /files | ..]",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			let target = args[0] || (activeVmId ? "/home/vm" : "/files");
			if (target === "-") {
				target = envVars.OLDPWD || (activeVmId ? "/home/vm" : "/files");
				print(target);
			}

			const resolved = normalizePath(target);
			const node = tree[resolved];

			if (!node) {
				print("cd: " + target + ": No such file or directory", "err");
				return false;
			}
			if (node.type !== "dir") {
				print("cd: " + target + ": Not a directory", "err");
				return false;
			}

			envVars.OLDPWD = envVars.PWD;
			envVars.PWD = resolved;
			updatePromptDisplay();
			return true;
		},
	},

	ls: {
		about: "list directory contents: ls [-a] [-l] [-h] [-S] [-t] [-R] [path]",
		usage: "ls [-alhStR] [path]",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			let showAll = false;
			let longFormat = false;
			let human = false;
			let sortSize = false;
			let sortTime = false;
			let recursive = false;
			const targets = [];

			args.forEach(function (arg) {
				if (arg.startsWith("-") && arg.length > 1) {
					if (arg.includes("a")) showAll = true;
					if (arg.includes("l")) longFormat = true;
					if (arg.includes("h")) human = true;
					if (arg.includes("S")) sortSize = true;
					if (arg.includes("t")) sortTime = true;
					if (arg.includes("R")) recursive = true;
				} else {
					targets.push(arg);
				}
			});

			const listPaths = targets.length > 0 ? targets : [envVars.PWD];
			let allOk = true;

			function renderDir(dirTarget, showHeader) {
				const resolved = normalizePath(dirTarget);
				const node = tree[resolved];

				if (!node) {
					print("ls: cannot access '" + dirTarget + "': No such file or directory", "err");
					allOk = false;
					return;
				}

				if (node.type === "file") {
					const size = typeof node.realSize === "number" ? node.realSize : (node.content || "").length;
					if (longFormat) {
						print(
							(node.mode || "-rw-r--r--") +
								"  1 " +
								(node.owner || envVars.USER).padEnd(7) +
								" " +
								formatBytes(size, human).padStart(6) +
								"  " +
								formatDateShort(node.mtime) +
								"  " +
								getBaseName(resolved)
						);
					} else {
						print(getBaseName(resolved));
					}
					return;
				}

				if (showHeader) {
					print(formatShortPath(resolved) + ":", "accent");
				}

				let entries = listChildren(resolved);
				if (!showAll) {
					entries = entries.filter(function (item) {
						return !item.name.startsWith(".");
					});
				}

				if (sortSize) {
					entries.sort(function (a, b) {
						const sa = a.node.type === "dir" ? 4096 : (typeof a.node.realSize === "number" ? a.node.realSize : (a.node.content || "").length);
						const sb = b.node.type === "dir" ? 4096 : (typeof b.node.realSize === "number" ? b.node.realSize : (b.node.content || "").length);
						return sb - sa;
					});
				} else if (sortTime) {
					entries.sort(function (a, b) {
						return (b.node.mtime || 0) - (a.node.mtime || 0);
					});
				}

				const subDirs = entries.filter(function (e) {
					return e.node.type === "dir";
				});

				if (showAll) {
					entries.unshift(
						{ name: ".", path: resolved, node: node },
						{ name: "..", path: getParentPath(resolved), node: tree[getParentPath(resolved)] || node }
					);
				}

				if (entries.length === 0) {
					if (!recursive) {
						print("(empty directory)", "dim");
					}
				} else if (longFormat) {
					print("total " + entries.length, "dim");
					entries.forEach(function (entry) {
						const isDir = entry.node.type === "dir";
						const mode = entry.node.mode || (isDir ? "drwxr-xr-x" : "-rw-r--r--");
						const owner = (entry.node.owner || envVars.USER).padEnd(7);
						const size = isDir ? 4096 : (typeof entry.node.realSize === "number" ? entry.node.realSize : (entry.node.content || "").length);
						const suffix = isDir && entry.name !== "." && entry.name !== ".." ? "/" : mode.includes("x") && !isDir ? "*" : "";
						print(
							mode +
								"  1 " +
								owner +
								" " +
								formatBytes(size, human).padStart(6) +
								"  " +
								formatDateShort(entry.node.mtime) +
								"  " +
								entry.name +
								suffix,
							isDir ? "accent" : ""
						);
					});
				} else {
					const formatted = entries.map(function (entry) {
						const isDir = entry.node.type === "dir";
						const isExec = !isDir && (entry.node.mode || "").includes("x");
						return entry.name + (isDir ? "/" : isExec ? "*" : "");
					});
					print(formatted.join("   "));
				}

				if (recursive) {
					subDirs.forEach(function (sub) {
						print("");
						renderDir(sub.path, true);
					});
				}
			}

			listPaths.forEach(function (t, i) {
				if (i > 0) print("");
				renderDir(t, listPaths.length > 1 || recursive);
			});

			return allOk;
		},
	},

	tree: {
		about: "display directory tree structure",
		usage: "tree [-a] [path]",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			const showAll = args.includes("-a");
			const targetArg = args.find(function (a) {
				return !a.startsWith("-");
			});
			const root = normalizePath(targetArg || envVars.PWD);
			const node = tree[root];

			if (!node) {
				print("tree: '" + (targetArg || root) + "' does not exist", "err");
				return false;
			}

			let dirCount = 0;
			let fileCount = 0;

			print(formatShortPath(root), "accent");

			function walk(dirPath, prefix) {
				const children = listChildren(dirPath).filter(function (c) {
					return showAll || !c.name.startsWith(".");
				});
				children.forEach(function (child, index) {
					const isLast = index === children.length - 1;
					const branch = isLast ? "└── " : "├── ";
					const nextPrefix = prefix + (isLast ? "    " : "│   ");

					if (child.node.type === "dir") {
						dirCount++;
						print(prefix + branch + child.name + "/", "accent");
						walk(child.path, nextPrefix);
					} else {
						fileCount++;
						print(prefix + branch + child.name);
					}
				});
			}

			if (node.type === "dir") {
				walk(root, "");
			}
			print("");
			print(dirCount + " directories, " + fileCount + " files", "dim");
			return true;
		},
	},

	mkdir: {
		about: "create directories: mkdir [-p] <dir...>",
		usage: "mkdir [-p] <directory...>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			const recursive = args.includes("-p");
			const targets = args.filter(function (a) {
				return !a.startsWith("-");
			});

			if (targets.length === 0) {
				print("Usage: mkdir [-p] <directory>", "err");
				return false;
			}

			let ok = true;
			targets.forEach(function (rawTarget) {
				const resolved = normalizePath(rawTarget);
				if (tree[resolved]) {
					if (!recursive || tree[resolved].type !== "dir") {
						print("mkdir: cannot create directory '" + rawTarget + "': File exists", "err");
						ok = false;
					}
					return;
				}

				if (isRealStorePath(resolved)) {
					const parent = getParentPath(resolved);
					if (!tree[parent] && !recursive) {
						print("mkdir: cannot create directory '" + rawTarget + "': No such file or directory", "err");
						ok = false;
						return;
					}
					ensureRealStoreFolderPath(resolved);
					return;
				}

				const parent = getParentPath(resolved);
				if (!tree[parent] && !recursive) {
					print("mkdir: cannot create directory '" + rawTarget + "': No such file or directory", "err");
					ok = false;
					return;
				}

				ensureParentDirs(resolved);
				tree[resolved] = {
					type: "dir",
					mtime: Date.now(),
					mode: "drwxr-xr-x",
					owner: envVars.USER,
				};
			});

			persistActiveStorage();
			return ok;
		},
	},

	rmdir: {
		about: "remove empty directories",
		usage: "rmdir <dir...>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			if (args.length === 0) {
				print("Usage: rmdir <directory>", "err");
				return false;
			}
			let ok = true;
			args.forEach(function (rawTarget) {
				const resolved = normalizePath(rawTarget);
				const node = tree[resolved];
				if (!node) {
					print("rmdir: failed to remove '" + rawTarget + "': No such file or directory", "err");
					ok = false;
					return;
				}
				if (node.type !== "dir") {
					print("rmdir: failed to remove '" + rawTarget + "': Not a directory", "err");
					ok = false;
					return;
				}
				if (resolved === "/" || resolved === "/files") {
					print("rmdir: cannot remove root directory '" + resolved + "'", "err");
					ok = false;
					return;
				}
				if (listChildren(resolved).length > 0) {
					print("rmdir: failed to remove '" + rawTarget + "': Directory not empty", "err");
					ok = false;
					return;
				}
				if (isRealStorePath(resolved)) {
					deleteRealStorePath(resolved);
				} else {
					delete tree[resolved];
				}
			});
			persistActiveStorage();
			return ok;
		},
	},

	touch: {
		about: "create empty files or update timestamps",
		usage: "touch <file...>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			if (args.length === 0) {
				print("Usage: touch <file>", "err");
				return false;
			}

			let ok = true;
			args.forEach(function (rawTarget) {
				const resolved = normalizePath(rawTarget);
				const parent = getParentPath(resolved);

				if (!tree[parent] || tree[parent].type !== "dir") {
					print("touch: cannot touch '" + rawTarget + "': No such file or directory", "err");
					ok = false;
					return;
				}

				if (tree[resolved]) {
					if (isRealStorePath(resolved)) {
						writeRealStoreFile(resolved, tree[resolved].content || "", false);
					} else {
						tree[resolved].mtime = Date.now();
					}
				} else {
					writeVfsFile(resolved, "", false);
				}
			});

			persistActiveStorage();
			return ok;
		},
	},

	nano: {
		about: "open interactive inline text editor: nano <file>",
		usage: "nano <file>",
		run: function (args) {
			if (!args[0]) {
				print("Usage: nano <file>", "err");
				return false;
			}
			return startNanoEditor(args[0]);
		},
	},

	cat: {
		about: "concatenate and print files or stdin: cat [-n] [-b] [file...]",
		usage: "cat [-n] [-b] [file...]",
		run: function (args, stdin) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			const numberAll = args.includes("-n");
			const numberNonBlank = args.includes("-b");
			const targets = args.filter(function (a) {
				return !a.startsWith("-");
			});

			const chunks = [];
			let ok = true;

			if (targets.length === 0) {
				if (typeof stdin === "string") {
					chunks.push(stdin);
				} else {
					print("Usage: cat [-n] <file...>", "err");
					return false;
				}
			} else {
				targets.forEach(function (rawTarget) {
					if (rawTarget === "-" && typeof stdin === "string") {
						chunks.push(stdin);
						return;
					}
					const resolved = normalizePath(rawTarget);
					const node = tree[resolved];

					if (!node) {
						print("cat: " + rawTarget + ": No such file or directory", "err");
						ok = false;
						return;
					}
					if (node.type === "dir") {
						print("cat: " + rawTarget + ": Is a directory", "err");
						ok = false;
						return;
					}
					chunks.push(node.content || "");
				});
			}

			const combined = chunks.join("");
			if (!combined) {
				return ok;
			}

			const lines = combined.replace(/\n$/, "").split("\n");
			let lineCounter = 1;
			lines.forEach(function (line) {
				if (numberNonBlank) {
					if (line.trim().length > 0) {
						print(String(lineCounter++).padStart(5) + "  " + line);
					} else {
						print("");
					}
				} else if (numberAll) {
					print(String(lineCounter++).padStart(5) + "  " + line);
				} else {
					print(line);
				}
			});

			return ok;
		},
	},

	tac: {
		about: "print lines of a file or stdin in reverse order",
		usage: "tac [file]",
		run: function (args, stdin) {
			const text = readTextSource(args[0], stdin, "tac");
			if (text === null) return false;
			const lines = text.replace(/\n$/, "").split("\n").reverse();
			lines.forEach(function (l) {
				print(l);
			});
			return true;
		},
	},

	head: {
		about: "output the first N lines: head [-n 10] [file]",
		usage: "head [-n <count>] [file]",
		run: function (args, stdin) {
			let count = 10;
			let fileArg = null;

			for (let i = 0; i < args.length; i++) {
				if (args[i] === "-n" && args[i + 1]) {
					count = Math.max(1, parseInt(args[i + 1], 10) || 10);
					i++;
				} else if (args[i].startsWith("-") && /^\d+$/.test(args[i].slice(1))) {
					count = Math.max(1, parseInt(args[i].slice(1), 10));
				} else {
					fileArg = args[i];
				}
			}

			const text = readTextSource(fileArg, stdin, "head");
			if (text === null) return false;
			if (!text) return true;

			text.replace(/\n$/, "")
				.split("\n")
				.slice(0, count)
				.forEach(function (line) {
					print(line);
				});
			return true;
		},
	},

	tail: {
		about: "output the last N lines: tail [-n 10] [file]",
		usage: "tail [-n <count>] [file]",
		run: function (args, stdin) {
			let count = 10;
			let fileArg = null;

			for (let i = 0; i < args.length; i++) {
				if (args[i] === "-n" && args[i + 1]) {
					count = Math.max(1, parseInt(args[i + 1], 10) || 10);
					i++;
				} else if (args[i].startsWith("-") && /^\d+$/.test(args[i].slice(1))) {
					count = Math.max(1, parseInt(args[i].slice(1), 10));
				} else {
					fileArg = args[i];
				}
			}

			const text = readTextSource(fileArg, stdin, "tail");
			if (text === null) return false;
			if (!text) return true;

			text.replace(/\n$/, "")
				.split("\n")
				.slice(-count)
				.forEach(function (line) {
					print(line);
				});
			return true;
		},
	},

	less: {
		about: "view file or piped output cleanly",
		usage: "less [file]",
		run: function (args, stdin) {
			return commands.cat.run(args, stdin);
		},
	},

	wc: {
		about: "print line, word, and byte counts: wc [-l|-w|-c] [file]",
		usage: "wc [-l] [-w] [-c] [file]",
		run: function (args, stdin) {
			const onlyL = args.includes("-l");
			const onlyW = args.includes("-w");
			const onlyC = args.includes("-c");
			const fileArg = args.find(function (a) {
				return !a.startsWith("-");
			});

			const text = readTextSource(fileArg, stdin, "wc");
			if (text === null) return false;

			const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
			const words = text.trim() ? text.trim().split(/\s+/).length : 0;
			const bytes = text.length;

			if (onlyL) print(String(lines));
			else if (onlyW) print(String(words));
			else if (onlyC) print(String(bytes));
			else print("  " + lines + "   " + words + "   " + bytes + (fileArg ? " " + fileArg : ""));
			return true;
		},
	},

	grep: {
		about: "filter lines matching a regex: grep [-i] [-n] [-v] [-c] <pattern> [file...]",
		usage: "grep [-invco] <pattern> [file...]",
		run: function (args, stdin) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			let ignoreCase = false;
			let showNumbers = false;
			let invert = false;
			let countOnly = false;
			let onlyMatching = false;
			const positional = [];

			args.forEach(function (arg) {
				if (arg.startsWith("-") && arg.length > 1) {
					if (arg.includes("i")) ignoreCase = true;
					if (arg.includes("n")) showNumbers = true;
					if (arg.includes("v")) invert = true;
					if (arg.includes("c")) countOnly = true;
					if (arg.includes("o")) onlyMatching = true;
				} else {
					positional.push(arg);
				}
			});

			const pattern = positional[0];
			const files = positional.slice(1);

			if (!pattern || (files.length === 0 && typeof stdin !== "string")) {
				print("Usage: grep [-invco] <pattern> [file...]", "err");
				return false;
			}

			let regex;
			try {
				regex = new RegExp(pattern, (ignoreCase ? "i" : "") + (onlyMatching ? "g" : ""));
			} catch (error) {
				print("grep: invalid regular expression: " + error.message, "err");
				return false;
			}

			let totalMatches = 0;

			function processSource(label, content) {
				let fileMatches = 0;
				const lines = content.replace(/\n$/, "").split("\n");
				lines.forEach(function (line, idx) {
					regex.lastIndex = 0;
					const hit = regex.test(line);
					const matched = invert ? !hit : hit;
					if (matched) {
						fileMatches++;
						totalMatches++;
						if (!countOnly) {
							const prefix =
								(label ? label + ":" : "") +
								(showNumbers ? (idx + 1) + ":" : "");
							if (onlyMatching && !invert) {
								regex.lastIndex = 0;
								const found = line.match(regex);
								if (found) {
									found.forEach(function (m) {
										print(prefix + m);
									});
								}
							} else {
								print(prefix + line);
							}
						}
					}
				});
				if (countOnly) {
					print((label ? label + ":" : "") + fileMatches);
				}
			}

			if (files.length === 0) {
				processSource("", stdin || "");
			} else {
				files.forEach(function (f) {
					const resolved = normalizePath(f);
					const node = tree[resolved];
					if (!node || node.type !== "file") {
						print("grep: " + f + ": No such file", "err");
						return;
					}
					processSource(files.length > 1 ? f : "", node.content || "");
				});
			}

			return totalMatches > 0;
		},
	},

	sed: {
		about: "stream text substitution: sed 's/old/new/g' [file]",
		usage: "sed 's/pattern/replacement/[gi]' [file]",
		run: function (args, stdin) {
			if (!args[0]) {
				print("Usage: sed 's/pattern/replacement/[gi]' [file]", "err");
				return false;
			}
			const expr = args[0];
			const match = expr.match(/^s(.)(.*?)\1(.*?)\1([gi]*)$/);
			if (!match) {
				print("sed: unsupported expression (expected s/pattern/replacement/g)", "err");
				return false;
			}

			const text = readTextSource(args[1], stdin, "sed");
			if (text === null) return false;

			let rx;
			try {
				rx = new RegExp(match[2], match[4]);
			} catch (error) {
				print("sed: invalid regex: " + error.message, "err");
				return false;
			}

			const out = text
				.replace(/\n$/, "")
				.split("\n")
				.map(function (line) {
					return line.replace(rx, match[3]);
				});
			out.forEach(function (l) {
				print(l);
			});
			return true;
		},
	},

	cut: {
		about: "extract fields from lines: cut -d ',' -f 1,3 [file]",
		usage: "cut [-d <delim>] -f <fields> [file]",
		run: function (args, stdin) {
			let delim = "\t";
			let fieldSpec = null;
			let fileArg = null;

			for (let i = 0; i < args.length; i++) {
				if (args[i] === "-d" && args[i + 1] !== undefined) {
					delim = args[i + 1];
					i++;
				} else if (args[i].startsWith("-d") && args[i].length > 2) {
					delim = args[i].slice(2);
				} else if (args[i] === "-f" && args[i + 1]) {
					fieldSpec = args[i + 1];
					i++;
				} else if (args[i].startsWith("-f") && args[i].length > 2) {
					fieldSpec = args[i].slice(2);
				} else if (!args[i].startsWith("-")) {
					fileArg = args[i];
				}
			}

			if (!fieldSpec) {
				print("Usage: cut [-d <delim>] -f <1,2...> [file]", "err");
				return false;
			}

			const text = readTextSource(fileArg, stdin, "cut");
			if (text === null) return false;

			const indices = fieldSpec
				.split(",")
				.map(function (n) {
					return parseInt(n, 10) - 1;
				})
				.filter(function (n) {
					return !Number.isNaN(n) && n >= 0;
				});

			text.replace(/\n$/, "")
				.split("\n")
				.forEach(function (line) {
					const parts = line.split(delim);
					const picked = indices.map(function (idx) {
						return parts[idx] !== undefined ? parts[idx] : "";
					});
					print(picked.join(delim));
				});
			return true;
		},
	},

	tr: {
		about: "translate or delete characters: tr 'a-z' 'A-Z'",
		usage: "tr [-d] <set1> [set2]",
		run: function (args, stdin) {
			if (typeof stdin !== "string") {
				print("Usage: <command> | tr [-d] <set1> [set2]", "err");
				return false;
			}
			const deleteMode = args[0] === "-d";
			const set1 = deleteMode ? args[1] : args[0];
			const set2 = deleteMode ? "" : args[1] || "";

			if (!set1) {
				print("Usage: tr [-d] <set1> [set2]", "err");
				return false;
			}

			function expandSet(s) {
				return s.replace(/([A-Za-z0-9])-([A-Za-z0-9])/g, function (_, a, b) {
					const start = a.charCodeAt(0);
					const end = b.charCodeAt(0);
					let res = "";
					const step = start <= end ? 1 : -1;
					for (let c = start; step > 0 ? c <= end : c >= end; c += step) {
						res += String.fromCharCode(c);
					}
					return res;
				});
			}

			const fromChars = expandSet(set1);
			const toChars = expandSet(set2);
			let result = "";

			for (let i = 0; i < stdin.length; i++) {
				const ch = stdin[i];
				const idx = fromChars.indexOf(ch);
				if (idx === -1) {
					result += ch;
				} else if (!deleteMode && toChars.length > 0) {
					result += toChars[Math.min(idx, toChars.length - 1)];
				}
			}

			printLines(result);
			return true;
		},
	},

	sort: {
		about: "sort lines of text: sort [-r] [-n] [-u] [file]",
		usage: "sort [-r] [-n] [-u] [file]",
		run: function (args, stdin) {
			let reverse = false;
			let numeric = false;
			let unique = false;
			let fileArg = null;

			args.forEach(function (a) {
				if (a.startsWith("-") && a.length > 1) {
					if (a.includes("r")) reverse = true;
					if (a.includes("n")) numeric = true;
					if (a.includes("u")) unique = true;
				} else {
					fileArg = a;
				}
			});

			const text = readTextSource(fileArg, stdin, "sort");
			if (text === null) return false;

			let lines = text.replace(/\n$/, "").split("\n");
			lines.sort(function (a, b) {
				if (numeric) {
					return (parseFloat(a) || 0) - (parseFloat(b) || 0);
				}
				return a.localeCompare(b);
			});

			if (reverse) lines.reverse();
			if (unique) lines = Array.from(new Set(lines));

			lines.forEach(function (l) {
				print(l);
			});
			return true;
		},
	},

	uniq: {
		about: "report or omit repeated adjacent lines: uniq [-c] [-d] [-u] [file]",
		usage: "uniq [-c] [-d] [-u] [file]",
		run: function (args, stdin) {
			let showCount = false;
			let onlyDupes = false;
			let onlyUnique = false;
			let fileArg = null;

			args.forEach(function (a) {
				if (a.startsWith("-") && a.length > 1) {
					if (a.includes("c")) showCount = true;
					if (a.includes("d")) onlyDupes = true;
					if (a.includes("u")) onlyUnique = true;
				} else {
					fileArg = a;
				}
			});

			const text = readTextSource(fileArg, stdin, "uniq");
			if (text === null) return false;

			const lines = text.replace(/\n$/, "").split("\n");
			const groups = [];
			lines.forEach(function (line) {
				if (groups.length > 0 && groups[groups.length - 1].line === line) {
					groups[groups.length - 1].count++;
				} else {
					groups.push({ line: line, count: 1 });
				}
			});

			groups.forEach(function (g) {
				if (onlyDupes && g.count < 2) return;
				if (onlyUnique && g.count > 1) return;
				print((showCount ? String(g.count).padStart(4) + " " : "") + g.line);
			});
			return true;
		},
	},

	diff: {
		about: "compare two files line by line: diff <file1> <file2>",
		usage: "diff <file1> <file2>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			if (args.length < 2) {
				print("Usage: diff <file1> <file2>", "err");
				return false;
			}
			const f1 = tree[normalizePath(args[0])];
			const f2 = tree[normalizePath(args[1])];
			if (!f1 || f1.type !== "file" || !f2 || f2.type !== "file") {
				print("diff: both arguments must be existing files", "err");
				return false;
			}
			const a = (f1.content || "").split("\n");
			const b = (f2.content || "").split("\n");
			const max = Math.max(a.length, b.length);
			let diffs = 0;

			for (let i = 0; i < max; i++) {
				if (a[i] !== b[i]) {
					diffs++;
					print("@@ line " + (i + 1) + " @@", "accent");
					if (a[i] !== undefined) print("- " + a[i], "err");
					if (b[i] !== undefined) print("+ " + b[i]);
				}
			}

			if (diffs === 0) {
				print("Files are identical.", "dim");
			}
			return diffs === 0;
		},
	},

	tee: {
		about: "write stdin to both stdout and a file: tee [-a] <file>",
		usage: "tee [-a] <file>",
		run: function (args, stdin) {
			const append = args.includes("-a");
			const target = args.find(function (a) {
				return !a.startsWith("-");
			});
			if (!target) {
				print("Usage: tee [-a] <file>", "err");
				return false;
			}
			const payload = typeof stdin === "string" ? stdin : "";
			if (!writeVfsFile(target, payload, append)) {
				print("tee: " + target + ": No such directory", "err");
				return false;
			}
			if (payload) {
				printLines(payload);
			}
			return true;
		},
	},

	find: {
		about: "search files by name or type: find [path] [-name pat] [-type f|d]",
		usage: "find [path] [-name <pattern>] [-type f|d]",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			let startPath = envVars.PWD;
			let namePattern = null;
			let typeFilter = null;

			for (let i = 0; i < args.length; i++) {
				if (args[i] === "-name" && args[i + 1]) {
					namePattern = args[i + 1];
					i++;
				} else if (args[i] === "-type" && args[i + 1]) {
					typeFilter = args[i + 1];
					i++;
				} else if (!args[i].startsWith("-")) {
					startPath = args[i];
				}
			}

			const resolvedRoot = normalizePath(startPath);
			if (!tree[resolvedRoot]) {
				print("find: '" + startPath + "': No such file or directory", "err");
				return false;
			}

			const matcher = namePattern ? wildcardToRegex(namePattern) : null;
			const prefix = resolvedRoot === "/" ? "/" : resolvedRoot + "/";

			Object.keys(tree)
				.filter(function (path) {
					return path === resolvedRoot || path.startsWith(prefix);
				})
				.sort()
				.forEach(function (path) {
					const node = tree[path];
					if (typeFilter === "f" && node.type !== "file") return;
					if (typeFilter === "d" && node.type !== "dir") return;
					if (matcher && !matcher.test(getBaseName(path))) return;
					print(formatShortPath(path) + (node.type === "dir" && path !== "/" ? "/" : ""));
				});

			return true;
		},
	},

	stat: {
		about: "display detailed file or directory metadata",
		usage: "stat <path>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			if (!args[0]) {
				print("Usage: stat <path>", "err");
				return false;
			}
			const resolved = normalizePath(args[0]);
			const node = tree[resolved];
			if (!node) {
				print("stat: cannot stat '" + args[0] + "': No such file or directory", "err");
				return false;
			}
			const size = node.type === "dir" ? 4096 : (typeof node.realSize === "number" ? node.realSize : (node.content || "").length);
			print("  File: " + resolved, "accent");
			print("  Type: " + (node.type === "dir" ? "directory" : "regular file") + (activeVmId ? " (VM: " + activeVmId + ")" : isRealStorePath(resolved) ? " (BrowOS Files)" : ""));
			print("  Size: " + size + " bytes");
			print("Access: " + (node.mode || (node.type === "dir" ? "drwxr-xr-x" : "-rw-r--r--")) + "  Owner: " + (node.owner || envVars.USER));
			print("Modify: " + new Date(node.mtime || Date.now()).toISOString());
			return true;
		},
	},

	file: {
		about: "determine file type",
		usage: "file <path...>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			if (args.length === 0) {
				print("Usage: file <path...>", "err");
				return false;
			}
			args.forEach(function (arg) {
				const resolved = normalizePath(arg);
				const node = tree[resolved];
				if (!node) {
					print(arg + ": cannot open (No such file or directory)");
					return;
				}
				if (node.type === "dir") {
					print(arg + ": directory");
					return;
				}
				const content = node.content || "";
				let desc = "ASCII text";
				if (!content.length) desc = "empty";
				else if (content.startsWith("#!")) desc = "POSIX shell script, ASCII text executable";
				else if (arg.endsWith(".json")) desc = "JSON data";
				else if (arg.endsWith(".js")) desc = "JavaScript source, UTF-8 text";
				else if (arg.endsWith(".html")) desc = "HTML document, UTF-8 text";
				print(arg + ": " + desc);
			});
			return true;
		},
	},

	du: {
		about: "estimate file and directory space usage: du [-h] [-s] [path]",
		usage: "du [-h] [-s] [path]",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			const human = args.includes("-h") || args.includes("-sh") || args.includes("-hs");
			const summary = args.includes("-s") || args.includes("-sh") || args.includes("-hs");
			const targetArg = args.find(function (a) {
				return !a.startsWith("-");
			});
			const root = normalizePath(targetArg || envVars.PWD);
			if (!tree[root]) {
				print("du: cannot access '" + (targetArg || root) + "': No such file or directory", "err");
				return false;
			}

			function calcSize(p) {
				const n = tree[p];
				if (!n) return 0;
				if (n.type === "file") return typeof n.realSize === "number" ? n.realSize : (n.content || "").length;
				let total = 4096;
				listChildren(p).forEach(function (c) {
					total += calcSize(c.path);
				});
				return total;
			}

			if (summary || tree[root].type === "file") {
				print(formatBytes(calcSize(root), human).padEnd(8) + formatShortPath(root));
			} else {
				listChildren(root).forEach(function (c) {
					if (c.node.type === "dir") {
						print(formatBytes(calcSize(c.path), human).padEnd(8) + formatShortPath(c.path));
					}
				});
				print(formatBytes(calcSize(root), human).padEnd(8) + formatShortPath(root));
			}
			return true;
		},
	},

	df: {
		about: "report filesystem disk space usage: df [-h]",
		usage: "df [-h]",
		run: function (args) {
			syncFromBrowOSFiles();
			const human = args.includes("-h");
			let used = 0;
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				if (k) used += (localStorage.getItem(k) || "").length;
			}
			const quota = 5 * 1024 * 1024;
			const avail = Math.max(0, quota - used);
			const pct = Math.min(100, Math.max(1, Math.round((used / quota) * 100))) + "%";

			print("Filesystem      Size      Used     Avail  Use%  Mounted on", "accent");
			print(
				(activeVmId ? "vm-" + activeVmId : "browos-fs").padEnd(13) +
					formatBytes(quota, human).padStart(7) +
					"   " +
					formatBytes(used, human).padStart(7) +
					"   " +
					formatBytes(avail, human).padStart(7) +
					"  " +
					pct.padStart(4) +
					"  " +
					(activeVmId ? "/home/vm" : "/files")
			);
			return true;
		},
	},

	chmod: {
		about: "change file permissions: chmod <+x|-x|755|644> <path>",
		usage: "chmod <mode> <path>",
		run: function (args) {
			const tree = getActiveTree();
			if (args.length < 2) {
				print("Usage: chmod <+x|-x|755|644> <path>", "err");
				return false;
			}
			const modeArg = args[0];
			const resolved = normalizePath(args[1]);
			const node = tree[resolved];
			if (!node) {
				print("chmod: cannot access '" + args[1] + "': No such file or directory", "err");
				return false;
			}
			const prefix = node.type === "dir" ? "d" : "-";
			if (modeArg === "+x") {
				node.mode = prefix + "rwxr-xr-x";
			} else if (modeArg === "-x") {
				node.mode = prefix + "rw-r--r--";
			} else if (/^[0-7]{3}$/.test(modeArg)) {
				const map = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
				node.mode = prefix + map[Number(modeArg[0])] + map[Number(modeArg[1])] + map[Number(modeArg[2])];
			} else {
				print("chmod: invalid mode '" + modeArg + "'", "err");
				return false;
			}
			persistActiveStorage();
			return true;
		},
	},

	chown: {
		about: "change file owner: chown <owner> <path>",
		usage: "chown <owner> <path>",
		run: function (args) {
			const tree = getActiveTree();
			if (args.length < 2) {
				print("Usage: chown <owner> <path>", "err");
				return false;
			}
			const resolved = normalizePath(args[1]);
			if (!tree[resolved]) {
				print("chown: cannot access '" + args[1] + "': No such file or directory", "err");
				return false;
			}
			tree[resolved].owner = args[0];
			persistActiveStorage();
			return true;
		},
	},

	cp: {
		about: "copy files or directories: cp [-r] <src> <dst>",
		usage: "cp [-r] <source> <destination>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			const recursive = args.includes("-r") || args.includes("-R");
			const paths = args.filter(function (a) {
				return !a.startsWith("-");
			});

			if (paths.length < 2) {
				print("Usage: cp [-r] <source> <destination>", "err");
				return false;
			}

			const src = normalizePath(paths[0]);
			let dst = normalizePath(paths[1]);
			const srcNode = tree[src];

			if (!srcNode) {
				print("cp: cannot stat '" + paths[0] + "': No such file or directory", "err");
				return false;
			}

			if (tree[dst] && tree[dst].type === "dir") {
				dst = normalizePath(dst + "/" + getBaseName(src));
			}

			if (!tree[getParentPath(dst)]) {
				print("cp: cannot create '" + paths[1] + "': No such file or directory", "err");
				return false;
			}

			if (srcNode.type === "dir") {
				if (!recursive) {
					print("cp: -r not specified; omitting directory '" + paths[0] + "'", "err");
					return false;
				}
				const srcPrefix = src === "/" ? "/" : src + "/";
				Object.keys(tree).forEach(function (key) {
					if (key === src || key.startsWith(srcPrefix)) {
						const suffix = key.slice(src.length);
						const targetKey = normalizePath(dst + suffix);
						if (tree[key].type === "dir") {
							ensureParentDirs(targetKey + "/placeholder");
						} else {
							writeVfsFile(targetKey, tree[key].content || "", false);
						}
					}
				});
			} else {
				writeVfsFile(dst, srcNode.content || "", false);
			}

			persistActiveStorage();
			return true;
		},
	},

	mv: {
		about: "move or rename files or directories: mv <src> <dst>",
		usage: "mv <source> <destination>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			if (args.length < 2) {
				print("Usage: mv <source> <destination>", "err");
				return false;
			}

			const src = normalizePath(args[0]);
			let dst = normalizePath(args[1]);
			const srcNode = tree[src];

			if (!srcNode) {
				print("mv: cannot stat '" + args[0] + "': No such file or directory", "err");
				return false;
			}
			if (src === "/" || src === "/files" || src === "/home" || src === "/home/browos" || src === "/home/vm") {
				print("mv: cannot move protected system directory '" + src + "'", "err");
				return false;
			}

			if (tree[dst] && tree[dst].type === "dir") {
				dst = normalizePath(dst + "/" + getBaseName(src));
			}

			if (!tree[getParentPath(dst)]) {
				print("mv: cannot move to '" + args[1] + "': No such file or directory", "err");
				return false;
			}

			if (!activeVmId && isRealStorePath(src) && isRealStorePath(dst) && srcNode.realId) {
				const map = readRealFileStoreMap();
				const rec = map[srcNode.realId];
				if (rec) {
					rec.parent = ensureRealStoreFolderPath(getParentPath(dst));
					rec.name = getBaseName(dst);
					rec.modified = Date.now();
					map[srcNode.realId] = rec;
					writeRealFileStoreMap(map);
					syncFromBrowOSFiles();
					return true;
				}
			}

			const srcPrefix = src + "/";
			const keysToMove = Object.keys(tree).filter(function (key) {
				return key === src || key.startsWith(srcPrefix);
			});

			keysToMove.forEach(function (key) {
				const suffix = key.slice(src.length);
				const newKey = normalizePath(dst + suffix);
				if (tree[key].type === "dir") {
					ensureParentDirs(newKey + "/placeholder");
				} else {
					writeVfsFile(newKey, tree[key].content || "", false);
				}
			});

			if (isRealStorePath(src)) {
				deleteRealStorePath(src);
			} else {
				keysToMove.forEach(function (k) { delete tree[k]; });
			}

			if (envVars.PWD === src || envVars.PWD.startsWith(srcPrefix)) {
				envVars.PWD = dst + envVars.PWD.slice(src.length);
				updatePromptDisplay();
			}

			persistActiveStorage();
			return true;
		},
	},

	rm: {
		about: "remove files or directories: rm [-r] [-f] <target...>",
		usage: "rm [-r] [-f] <target...>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			let recursive = false;
			let force = false;
			const targets = [];

			args.forEach(function (arg) {
				if (arg.startsWith("-") && arg.length > 1) {
					if (arg.includes("r") || arg.includes("R")) recursive = true;
					if (arg.includes("f")) force = true;
				} else {
					targets.push(arg);
				}
			});

			if (targets.length === 0) {
				print("Usage: rm [-r] [-f] <target...>", "err");
				return false;
			}

			let ok = true;
			targets.forEach(function (rawTarget) {
				const resolved = normalizePath(rawTarget);
				const node = tree[resolved];

				if (!node) {
					if (!force) {
						print("rm: cannot remove '" + rawTarget + "': No such file or directory", "err");
						ok = false;
					}
					return;
				}

				if (resolved === "/" || resolved === "/files" || resolved === "/home" || resolved === "/home/browos" || resolved === "/home/vm") {
					print("rm: refusing to remove protected path '" + resolved + "'", "err");
					ok = false;
					return;
				}

				if (node.type === "dir" && listChildren(resolved).length > 0 && !recursive) {
					print("rm: cannot remove '" + rawTarget + "': Is a non-empty directory (use -r)", "err");
					ok = false;
					return;
				}

				if (isRealStorePath(resolved)) {
					deleteRealStorePath(resolved);
				} else {
					const prefix = resolved + "/";
					Object.keys(tree).forEach(function (key) {
						if (key === resolved || key.startsWith(prefix)) {
							delete tree[key];
						}
					});
				}
			});

			persistActiveStorage();
			return ok;
		},
	},

	// ------------------------------------------------------------------------
	// Network & Web Requests (curl, wget, dig, ping, ip)
	// ------------------------------------------------------------------------

	curl: {
		about: "transfer data from URLs: curl [-X METHOD] [-H 'K: V'] [-d data] [-o file] [-I] [-i] [-s] <url>",
		usage: "curl [-X GET|POST|PUT|DELETE] [-H 'Header: Value'] [-d data] [-o file] [-O] [-I] [-i] [-s] [-v] <url>",
		run: async function (args, stdin) {
			let method = null;
			const headers = {};
			let bodyData = null;
			let outputFile = null;
			let saveRemoteName = false;
			let headOnly = false;
			let includeHeaders = false;
			let silent = false;
			let verbose = false;
			let targetUrl = null;

			for (let i = 0; i < args.length; i++) {
				const a = args[i];
				if ((a === "-X" || a === "--request") && args[i + 1]) {
					method = args[++i].toUpperCase();
				} else if ((a === "-H" || a === "--header") && args[i + 1]) {
					const hdr = args[++i];
					const colon = hdr.indexOf(":");
					if (colon !== -1) {
						headers[hdr.slice(0, colon).trim()] = hdr.slice(colon + 1).trim();
					}
				} else if ((a === "-d" || a === "--data" || a === "--data-raw") && args[i + 1] !== undefined) {
					bodyData = args[++i];
					if (bodyData.startsWith("@")) {
						syncFromBrowOSFiles();
						const tree = getActiveTree();
						const refNode = tree[normalizePath(bodyData.slice(1))];
						if (!refNode || refNode.type !== "file") {
							print("curl: failed to read data file '" + bodyData.slice(1) + "'", "err");
							return false;
						}
						bodyData = refNode.content || "";
					}
				} else if ((a === "-u" || a === "--user") && args[i + 1]) {
					headers["Authorization"] = "Basic " + btoa(args[++i]);
				} else if ((a === "-A" || a === "--user-agent") && args[i + 1]) {
					headers["User-Agent"] = args[++i];
				} else if ((a === "-o" || a === "--output") && args[i + 1]) {
					outputFile = args[++i];
				} else if (a === "-O" || a === "--remote-name") {
					saveRemoteName = true;
				} else if (a === "-I" || a === "--head") {
					headOnly = true;
				} else if (a === "-i" || a === "--include") {
					includeHeaders = true;
				} else if (a === "-s" || a === "--silent") {
					silent = true;
				} else if (a === "-v" || a === "--verbose") {
					verbose = true;
				} else if (a === "-L" || a === "--location") {
					// fetch follows redirects by default
				} else if (!a.startsWith("-")) {
					targetUrl = a;
				}
			}

			if (!targetUrl) {
				print("curl: try 'help curl' for more information", "err");
				return false;
			}

			if (bodyData === null && typeof stdin === "string" && stdin.length > 0) {
				bodyData = stdin;
			}

			const finalMethod = method || (headOnly ? "HEAD" : bodyData !== null ? "POST" : "GET");
			const fullUrl = normalizeUrl(targetUrl);

			if (bodyData !== null && !Object.keys(headers).some(function (k) { return k.toLowerCase() === "content-type"; })) {
				if (bodyData.trim().startsWith("{") || bodyData.trim().startsWith("[")) {
					headers["Content-Type"] = "application/json";
				} else {
					headers["Content-Type"] = "application/x-www-form-urlencoded";
				}
			}

			if (verbose) {
				print("> " + finalMethod + " " + fullUrl, "dim");
				Object.keys(headers).forEach(function (k) {
					print("> " + k + ": " + headers[k], "dim");
				});
			} else if (!silent && !outputFile && !saveRemoteName) {
				print("* Connecting to " + fullUrl + "...", "dim");
			}

			const controller = new AbortController();
			activeAbortController = controller;

			try {
				const started = performance.now();
				const response = await fetch(fullUrl, {
					method: finalMethod,
					headers: headers,
					body: finalMethod === "GET" || finalMethod === "HEAD" ? undefined : bodyData,
					signal: controller.signal,
				});
				const elapsed = (performance.now() - started).toFixed(0);

				if (headOnly || includeHeaders || verbose) {
					const prefix = verbose ? "< " : "";
					print(prefix + "HTTP/1.1 " + response.status + " " + (response.statusText || "OK"), "accent");
					response.headers.forEach(function (val, key) {
						print(prefix + key + ": " + val, "dim");
					});
					if (includeHeaders && !headOnly) {
						print("");
					}
				}

				if (headOnly) {
					return response.ok;
				}

				const text = await response.text();

				if (saveRemoteName && !outputFile) {
					const urlPath = new URL(fullUrl).pathname;
					outputFile = urlPath.split("/").filter(Boolean).pop() || "index.html";
				}

				if (outputFile) {
					if (!writeVfsFile(outputFile, text, false)) {
						print("curl: cannot write to '" + outputFile + "': No such directory", "err");
						return false;
					}
					if (!silent) {
						print("Saved " + formatBytes(text.length, true) + " to " + outputFile + " (" + elapsed + " ms)", "accent");
					}
					return response.ok;
				}

				if (text) {
					printLines(text);
				}
				return response.ok;
			} catch (error) {
				if (error.name === "AbortError") {
					print("curl: aborted", "err");
				} else {
					print("curl: (7) Failed to connect or blocked by browser CORS: " + error.message, "err");
				}
				return false;
			} finally {
				activeAbortController = null;
			}
		},
	},

	wget: {
		about: "download a URL into a file: wget [-O file] <url>",
		usage: "wget [-O <output-file>] <url>",
		run: async function (args) {
			let outName = null;
			let urlArg = null;
			for (let i = 0; i < args.length; i++) {
				if (args[i] === "-O" && args[i + 1]) {
					outName = args[++i];
				} else if (!args[i].startsWith("-")) {
					urlArg = args[i];
				}
			}
			if (!urlArg) {
				print("Usage: wget [-O <file>] <url>", "err");
				return false;
			}
			const forwarded = outName ? ["-o", outName, urlArg] : ["-O", urlArg];
			return commands.curl.run(forwarded);
		},
	},

	dig: {
		about: "DNS lookup utility (via DNS-over-HTTPS): dig <domain> [A|AAAA|MX|TXT|CNAME|NS]",
		usage: "dig <domain> [record-type]",
		run: async function (args) {
			const domain = args.find(function (a) {
				return !a.startsWith("-") && !/^(A|AAAA|MX|TXT|CNAME|NS|SOA|PTR)$/i.test(a);
			});
			const qtype = (
				args.find(function (a) {
					return /^(A|AAAA|MX|TXT|CNAME|NS|SOA|PTR)$/i.test(a);
				}) || "A"
			).toUpperCase();

			if (!domain) {
				print("Usage: dig <domain> [A|AAAA|MX|TXT|CNAME|NS]", "err");
				return false;
			}

			const cleanHost = domain.replace(/^https?:\/\//i, "").split("/")[0];
			const start = performance.now();

			try {
				const res = await fetch(
					"https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(cleanHost) + "&type=" + encodeURIComponent(qtype),
					{ headers: { Accept: "application/dns-json" } }
				);
				const data = await res.json();
				const ms = (performance.now() - start).toFixed(0);

				print("; <<>> DiG (bsh DoH) <<>> " + cleanHost + " " + qtype, "accent");
				print(";; status: " + (data.Status === 0 ? "NOERROR" : "CODE_" + data.Status) + ", Query time: " + ms + " msec", "dim");
				print("");
				print(";; ANSWER SECTION:", "accent");

				if (Array.isArray(data.Answer) && data.Answer.length > 0) {
					data.Answer.forEach(function (ans) {
						print(ans.name.padEnd(26) + String(ans.TTL).padEnd(8) + "IN   " + qtype.padEnd(7) + ans.data);
					});
					return true;
				} else {
					print("(no " + qtype + " records found)", "dim");
					return false;
				}
			} catch (error) {
				print("dig: DNS query failed: " + error.message, "err");
				return false;
			}
		},
	},

	nslookup: {
		about: "query DNS records for a domain",
		usage: "nslookup <domain>",
		run: function (args) {
			return commands.dig.run(args);
		},
	},

	ping: {
		about: "measure HTTP round-trip latency to a host: ping [-c 4] <host>",
		usage: "ping [-c <count>] <host>",
		run: async function (args) {
			let maxCount = 4;
			let hostArg = null;
			for (let i = 0; i < args.length; i++) {
				if (args[i] === "-c" && args[i + 1]) {
					maxCount = Math.max(1, Math.min(20, parseInt(args[++i], 10) || 4));
				} else if (!args[i].startsWith("-")) {
					hostArg = args[i];
				}
			}

			if (!hostArg) {
				print("Usage: ping [-c <count>] <host>", "err");
				return false;
			}

			const url = normalizeUrl(hostArg);
			print("PING " + hostArg + " (" + url + ") via HTTP/S:", "accent");

			const controller = new AbortController();
			activeAbortController = controller;
			const times = [];

			try {
				for (let seq = 1; seq <= maxCount; seq++) {
					if (controller.signal.aborted) break;
					const t0 = performance.now();
					await fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal });
					const rtt = performance.now() - t0;
					times.push(rtt);
					print("64 bytes from " + hostArg + ": icmp_seq=" + seq + " time=" + rtt.toFixed(1) + " ms");
					if (seq < maxCount) {
						await new Promise(function (resolve) {
							setTimeout(resolve, 400);
						});
					}
				}

				if (times.length > 0) {
					const min = Math.min.apply(null, times).toFixed(1);
					const max = Math.max.apply(null, times).toFixed(1);
					const avg = (times.reduce(function (a, b) { return a + b; }, 0) / times.length).toFixed(1);
					print("--- " + hostArg + " ping statistics ---", "dim");
					print(times.length + " packets transmitted, " + times.length + " received, 0% packet loss", "dim");
					print("rtt min/avg/max = " + min + "/" + avg + "/" + max + " ms", "dim");
				}
				return true;
			} catch (error) {
				if (error.name !== "AbortError") {
					print("ping: " + hostArg + ": " + error.message, "err");
				}
				return false;
			} finally {
				activeAbortController = null;
			}
		},
	},

	ip: {
		about: "show browser network interface & connection info",
		usage: "ip [addr | link]",
		run: function () {
			const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
			print("1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN", "accent");
			print("    inet 127.0.0.1/8 scope host lo");
			print("2: web0: <BROADCAST,MULTICAST," + (navigator.onLine ? "UP,LOWER_UP" : "DOWN") + "> state " + (navigator.onLine ? "UP" : "DOWN"), "accent");
			print("    origin " + window.location.origin);
			if (conn) {
				print("    link/ether type=" + (conn.effectiveType || "unknown") + " downlink=" + (conn.downlink || "?") + "Mbps rtt=" + (conn.rtt || "?") + "ms");
			}
			return true;
		},
	},

	// ------------------------------------------------------------------------
	// BrowOS Desktop Integration & Linux Service/Process Management
	// ------------------------------------------------------------------------

	apps: {
		about: "manage BrowOS apps: apps [list|running|open|close|info]",
		usage: "apps [list | running | open <id> | close <id> | info <id>]",
		run: function (args) {
			const api = os();
			if (!api) return false;

			const sub = (args[0] || "list").toLowerCase();

			if (sub === "list" || sub === "ls") {
				const installed = api.listApps().filter(function (app) {
					return app.installed;
				});
				if (installed.length === 0) {
					print("No installed apps found.", "dim");
					return true;
				}
				const runningIds = new Set(
					api.runningApps().map(function (r) {
						return r.id;
					})
				);
				print("ID              NAME                  STATUS", "accent");
				installed.forEach(function (app) {
					print(app.id.padEnd(16) + app.name.padEnd(22) + (runningIds.has(app.id) ? "running" : "installed"));
				});
				return true;
			}

			if (sub === "running" || sub === "ps") {
				return commands.ps.run();
			}

			if (sub === "open" || sub === "start" || sub === "launch") {
				return commands.open.run(args.slice(1));
			}

			if (sub === "close" || sub === "stop" || sub === "kill") {
				return commands.close.run(args.slice(1));
			}

			if (sub === "info") {
				const query = args.slice(1).join(" ").toLowerCase();
				if (!query) {
					print("Usage: apps info <app-id>", "err");
					return false;
				}
				const match = api.listApps().find(function (app) {
					return app.id.toLowerCase() === query || app.name.toLowerCase() === query;
				});
				if (!match) {
					print("No app found matching '" + query + "'.", "err");
					return false;
				}
				print("App:        " + match.name + " (" + match.id + ")", "accent");
				print("Installed:  " + (match.installed ? "yes" : "no"));
				if (match.category) print("Category:   " + match.category);
				if (match.url) print("Entry URL:  " + match.url);
				if (match.credit) print("Credit:     " + match.credit);
				return true;
			}

			print("Usage: apps [list | running | open <id> | close <id> | info <id>]", "err");
			return false;
		},
	},

	systemctl: {
		about: "control BrowOS services and apps: systemctl [status|start|stop|restart|reboot|poweroff]",
		usage: "systemctl <status|list-units|start|stop|restart|reboot|poweroff> [app-id]",
		run: function (args) {
			const action = (args[0] || "status").toLowerCase();
			const unit = (args[1] || "").replace(/\.service$/i, "");

			if (action === "reboot") {
				return commands.reboot.run();
			}
			if (action === "poweroff" || action === "halt") {
				return commands.shutdown.run();
			}

			const api = os();
			if (!api) return false;

			if (action === "status" && !unit) {
				const info = api.systemInfo();
				print("● " + envVars.HOSTNAME, "accent");
				print("    State: running (BrowOS Web Desktop)");
				print("    Units: " + info.installed + " installed, " + info.running + " active");
				print("    Theme: " + info.theme + " | Desktop: " + info.desktop + "/" + info.desktops);
				return true;
			}

			if (action === "list-units") {
				const runningSet = new Set(api.runningApps().map(function (a) { return a.id; }));
				print("UNIT                        LOAD      ACTIVE    SUB", "accent");
				api.listApps()
					.filter(function (a) { return a.installed; })
					.forEach(function (app) {
						const active = runningSet.has(app.id);
						print(
							(app.id + ".service").padEnd(28) +
								"loaded    " +
								(active ? "active    running" : "inactive  dead")
						);
					});
				return true;
			}

			if (!unit) {
				print("Usage: systemctl <start|stop|restart|status> <app-id>", "err");
				return false;
			}

			if (action === "status") {
				const app = api.listApps().find(function (a) { return a.id.toLowerCase() === unit.toLowerCase(); });
				if (!app) {
					print("Unit " + unit + ".service could not be found.", "err");
					return false;
				}
				const runEntry = api.runningApps().find(function (r) { return r.id.toLowerCase() === unit.toLowerCase(); });
				print("● " + app.id + ".service - " + app.name, "accent");
				print("   Loaded: " + (app.installed ? "loaded" : "not-installed"));
				print("   Active: " + (runEntry ? "active (running)" : "inactive (dead)"));
				return true;
			}

			if (action === "start") {
				logSyslog("systemd: Starting " + unit + ".service");
				return commands.open.run([unit]);
			}

			if (action === "stop") {
				logSyslog("systemd: Stopping " + unit + ".service");
				return commands.close.run([unit]);
			}

			if (action === "restart") {
				logSyslog("systemd: Restarting " + unit + ".service");
				api.closeApp(unit);
				setTimeout(function () {
					api.openApp(unit);
				}, 150);
				print("Restarted " + unit + ".service.");
				return true;
			}

			print("Unknown operation '" + action + "'.", "err");
			return false;
		},
	},

	apt: {
		about: "BrowStore package manager: apt [list|search|show|install|remove]",
		usage: "apt <list | search <query> | show <app> | install <app> | remove <app>>",
		run: function (args) {
			const api = os();
			if (!api) return false;

			const sub = (args[0] || "").toLowerCase();
			const query = args.slice(1).join(" ").toLowerCase();
			const allApps = api.listApps();

			if (sub === "list") {
				const onlyInstalled = args.includes("--installed");
				allApps
					.filter(function (a) { return !onlyInstalled || a.installed; })
					.forEach(function (a) {
						print(a.id + "/browstore 1.0 [" + (a.installed ? "installed" : "available") + "] - " + a.name);
					});
				return true;
			}

			if (sub === "search") {
				if (!query) {
					print("Usage: apt search <keyword>", "err");
					return false;
				}
				const hits = allApps.filter(function (a) {
					return a.id.toLowerCase().includes(query) || a.name.toLowerCase().includes(query);
				});
				if (hits.length === 0) {
					print("No matching packages found.", "dim");
					return false;
				}
				hits.forEach(function (a) {
					print(a.id + " - " + a.name + (a.installed ? " [installed]" : ""), "accent");
				});
				return true;
			}

			if (sub === "show") {
				return commands.apps.run(["info", query]);
			}

			if (sub === "install") {
				if (!query) {
					print("Usage: apt install <app-id>", "err");
					return false;
				}
				const target = allApps.find(function (a) { return a.id.toLowerCase() === query || a.name.toLowerCase() === query; });
				if (!target) {
					print("E: Unable to locate package " + query, "err");
					return false;
				}
				if (typeof api.installApp === "function") {
					api.installApp(target.id);
					logSyslog("apt: installed package " + target.id);
					print("Setting up " + target.id + " (" + target.name + ") ... done.", "accent");
					return true;
				}
				print("Opening BrowStore for " + target.name + "...", "dim");
				api.openApp("browstore");
				return true;
			}

			if (sub === "remove" || sub === "uninstall") {
				if (!query) {
					print("Usage: apt remove <app-id>", "err");
					return false;
				}
				if (typeof api.uninstallApp === "function") {
					api.uninstallApp(query);
					logSyslog("apt: removed package " + query);
					print("Removing " + query + " ... done.");
					return true;
				}
				print("Uninstall via CLI is not exposed by this BrowOS build; opening BrowStore.", "dim");
				api.openApp("browstore");
				return true;
			}

			print("Usage: apt <list | search | show | install | remove>", "err");
			return false;
		},
	},

	ps: {
		about: "report a snapshot of running BrowOS processes/apps",
		usage: "ps [aux]",
		run: function () {
			const api = os();
			if (!api) return false;

			const running = api.runningApps();
			print("USER       PID  %CPU %MEM  STAT  COMMAND", "accent");
			print("root         1   0.0  0.2  Ss    /sbin/browos-init");
			print(envVars.USER.padEnd(10) + "  42   0.1  0.4  Ss    /bin/bsh");

			running.forEach(function (app, index) {
				const pid = String(100 + index).padStart(4);
				const stat = app.visible ? "Sl+" : "Tl";
				print(envVars.USER.padEnd(10) + pid + "   0.4  1.2  " + stat.padEnd(5) + " /apps/" + app.id);
			});
			return true;
		},
	},

	top: {
		about: "display BrowOS resource and task summary",
		usage: "top",
		run: function () {
			const api = os(true);
			const running = api ? api.runningApps() : [];
			const mem = performance && performance.memory;

			print("top - " + new Date().toLocaleTimeString() + " up " + Math.floor((Date.now() - BOOT_TIME) / 1000) + "s, 1 user, load average: 0.12, 0.06, 0.02", "accent");
			print("Tasks: " + (running.length + 2) + " total,   " + (running.filter(function (a) { return a.visible; }).length + 1) + " running,   " + running.filter(function (a) { return !a.visible; }).length + " sleeping");
			if (mem) {
				print(
					"JS Heap: " +
						formatBytes(mem.jsHeapSizeLimit, true) +
						" total, " +
						formatBytes(mem.usedJSHeapSize, true) +
						" used, " +
						formatBytes(mem.totalJSHeapSize - mem.usedJSHeapSize, true) +
						" free"
				);
			}
			print("");
			return commands.ps.run();
		},
	},

	pgrep: {
		about: "look up running BrowOS apps by name: pgrep <pattern>",
		usage: "pgrep <pattern>",
		run: function (args) {
			const api = os();
			if (!api || !args[0]) {
				if (!args[0]) print("Usage: pgrep <pattern>", "err");
				return false;
			}
			const q = args[0].toLowerCase();
			let found = false;
			api.runningApps().forEach(function (app, index) {
				if (app.id.toLowerCase().includes(q) || app.name.toLowerCase().includes(q)) {
					print((100 + index) + " " + app.id);
					found = true;
				}
			});
			return found;
		},
	},

	kill: {
		about: "terminate a running BrowOS app by PID or app ID",
		usage: "kill <pid | app-id>",
		run: function (args) {
			const api = os();
			if (!api || !args[0]) {
				if (!args[0]) print("Usage: kill <pid | app-id>", "err");
				return false;
			}
			const target = args[0] === "-9" ? args[1] : args[0];
			if (!target) return false;

			if (/^\d+$/.test(target)) {
				const idx = parseInt(target, 10) - 100;
				const running = api.runningApps();
				if (idx >= 0 && idx < running.length) {
					return commands.close.run([running[idx].id]);
				}
				print("kill: (" + target + ") - No such process", "err");
				return false;
			}
			return commands.close.run([target]);
		},
	},

	killall: {
		about: "close all running apps (except terminal) or matching app",
		usage: "killall [app-id]",
		run: function (args) {
			const api = os();
			if (!api) return false;

			if (args[0]) {
				return commands.close.run(args);
			}

			const running = api.runningApps();
			let closedCount = 0;
			running.forEach(function (app) {
				if (app.id !== "terminal") {
					api.closeApp(app.id);
					closedCount++;
				}
			});
			print("Terminated " + closedCount + " background app(s).");
			return true;
		},
	},

	open: {
		about: "open a BrowOS app, URL, or file: open notepad | open github.com | open /files/note.txt",
		usage: "open <app-id | url | file-path>",
		run: function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			if (args.length === 0) {
				print("Usage: open <app | url | file>", "err");
				return false;
			}

			const target = args.join(" ").trim();

			if (args.length === 1 && looksLikeUrl(target)) {
				const fullUrl = normalizeUrl(target);
				window.open(fullUrl, "_blank", "noopener");
				print("Opening " + fullUrl + " in browser tab...");
				return true;
			}

			const resolvedPath = normalizePath(target);
			if (tree[resolvedPath]) {
				if (tree[resolvedPath].type === "dir") {
					envVars.OLDPWD = envVars.PWD;
					envVars.PWD = resolvedPath;
					updatePromptDisplay();
					return commands.ls.run([]);
				}
				return commands.cat.run([resolvedPath]);
			}

			const api = os();
			if (!api) return false;

			const opened = api.openApp(target);
			if (opened) {
				logSyslog("desktop: launched " + opened);
				print("Opened " + opened + ".");
				return true;
			}

			print("open: no installed app, file, or valid URL matching '" + target + "'", "err");
			return false;
		},
	},

	close: {
		about: "close a running BrowOS app: close notepad",
		usage: "close <app-id>",
		run: function (args) {
			const api = os();
			if (!api) return false;

			if (args.length === 0) {
				print("Usage: close <app name>", "err");
				return false;
			}

			const closed = api.closeApp(args.join(" "));
			print(
				closed ? "Closed " + closed + "." : "No running app called '" + args.join(" ") + "'.",
				closed ? "" : "err"
			);
			return Boolean(closed);
		},
	},

	theme: {
		about: "set desktop theme: theme dark | light",
		usage: "theme <dark | light>",
		run: function (args) {
			const api = os();
			if (!api) return false;

			if (args[0] !== "dark" && args[0] !== "light") {
				print("Usage: theme dark | light", "err");
				return false;
			}

			api.setTheme(args[0]);
			logSyslog("desktop: theme switched to " + args[0]);
			print("Theme set to " + args[0] + ".");
			return true;
		},
	},

	accent: {
		about: "set desktop accent color: accent #2196f3 | accent orange",
		usage: "accent <#rrggbb | color-name>",
		run: function (args) {
			const api = os();
			if (!api) return false;

			if (!args[0] || !api.setAccent(args[0])) {
				print("Usage: accent #2196f3  (or a color name like orange)", "err");
				return false;
			}

			print("Accent color changed to " + args[0] + ".");
			return true;
		},
	},

	wallpaper: {
		about: "cycle desktop wallpaper: wallpaper next",
		usage: "wallpaper next",
		run: function (args) {
			const api = os();
			if (!api) return false;

			if (args[0] !== "next") {
				print("Usage: wallpaper next", "err");
				return false;
			}

			api.nextWallpaper();
			print("Wallpaper changed.");
			return true;
		},
	},

	notify: {
		about: "send a desktop notification: notify Hello world",
		usage: "notify <message>",
		run: function (args) {
			const api = os();
			if (!api) return false;

			if (args.length === 0) {
				print("Usage: notify <text>", "err");
				return false;
			}

			api.notify("Terminal", args.join(" "));
			return true;
		},
	},

	"notify-send": {
		about: "Linux desktop notification: notify-send <summary> [body]",
		usage: "notify-send <summary> [body]",
		run: function (args) {
			const api = os();
			if (!api) return false;

			if (args.length === 0) {
				print("Usage: notify-send <summary> [body]", "err");
				return false;
			}

			const title = args[0];
			const body = args.slice(1).join(" ") || args[0];
			api.notify(title, body);
			return true;
		},
	},

	note: {
		about: "create a sticky note on the BrowOS desktop",
		usage: "note <text>",
		run: function (args) {
			const api = os();
			if (!api) return false;

			if (args.length === 0) {
				print("Usage: note <text>", "err");
				return false;
			}

			api.newNote(args.join(" "));
			print("Sticky note added to the desktop.");
			return true;
		},
	},

	todo: {
		about: "manage BrowOS to-do list: todo [add|list|done|rm|clear]",
		usage: "todo add <task> | todo list | todo done <#> | todo rm <#> | todo clear",
		run: function (args) {
			const action = (args[0] || "list").toLowerCase();
			const tasks = readTodos();

			if (action === "add" && args.length > 1) {
				tasks.unshift({ text: args.slice(1).join(" "), done: false, due: "" });
				writeTodos(tasks);
				print("Task added.");
				return true;
			}

			if (action === "list" || action === "ls") {
				if (tasks.length === 0) {
					print("No tasks.", "dim");
					return true;
				}
				tasks.forEach(function (task, position) {
					print((task.done ? "[x] " : "[ ] ") + (position + 1) + ". " + task.text);
				});
				return true;
			}

			if (action === "done" || action === "toggle") {
				const idx = parseInt(args[1], 10) - 1;
				if (Number.isNaN(idx) || idx < 0 || idx >= tasks.length) {
					print("Usage: todo done <task-number>", "err");
					return false;
				}
				tasks[idx].done = !tasks[idx].done;
				writeTodos(tasks);
				print((tasks[idx].done ? "Completed: " : "Reopened: ") + tasks[idx].text);
				return true;
			}

			if (action === "rm" || action === "del" || action === "remove") {
				const idx = parseInt(args[1], 10) - 1;
				if (Number.isNaN(idx) || idx < 0 || idx >= tasks.length) {
					print("Usage: todo rm <task-number>", "err");
					return false;
				}
				const removed = tasks.splice(idx, 1)[0];
				writeTodos(tasks);
				print("Removed: " + removed.text);
				return true;
			}

			if (action === "clear") {
				writeTodos(
					tasks.filter(function (t) {
						return !t.done;
					})
				);
				print("Cleared completed tasks.");
				return true;
			}

			print("Usage: todo add <task> | todo list | todo done <#> | todo rm <#> | todo clear", "err");
			return false;
		},
	},

	lock: {
		about: "lock the BrowOS screen",
		usage: "lock",
		run: function () {
			const api = os();
			if (!api) return false;
			api.lock();
			return true;
		},
	},

	screensaver: {
		about: "start the BrowOS screensaver",
		usage: "screensaver",
		run: function () {
			const api = os();
			if (!api) return false;
			api.screensaver();
			return true;
		},
	},

	reboot: {
		about: "reboot (reload) the BrowOS desktop",
		usage: "reboot",
		run: function () {
			print("Broadcast message from " + envVars.USER + "@" + envVars.HOSTNAME + ":", "accent");
			print("The system is going down for reboot NOW!");
			setTimeout(function () {
				window.location.reload();
			}, 450);
			return true;
		},
	},

	shutdown: {
		about: "lock or power down BrowOS session: shutdown [-r]",
		usage: "shutdown [-r | -h]",
		run: function (args) {
			if (args.includes("-r")) {
				return commands.reboot.run();
			}
			const api = os(true);
			print("System halted. Locking desktop session...", "accent");
			if (api && typeof api.lock === "function") {
				setTimeout(function () {
					api.lock();
				}, 400);
			}
			return true;
		},
	},

	// ------------------------------------------------------------------------
	// Shell Scripting & System Inspection
	// ------------------------------------------------------------------------

	sh: {
		about: "execute a shell script file: sh <script.sh>",
		usage: "sh <script.sh>",
		run: async function (args) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			if (!args[0]) {
				print("Usage: sh <script.sh>", "err");
				return false;
			}
			const resolved = normalizePath(args[0]);
			const node = tree[resolved];
			if (!node || node.type !== "file") {
				print("sh: 0: cannot open " + args[0] + ": No such file", "err");
				return false;
			}
			const lines = (node.content || "").split("\n");
			let ok = true;
			for (let i = 0; i < lines.length; i++) {
				const raw = lines[i].trim();
				if (!raw || raw.startsWith("#")) continue;
				const stepOk = await runPipelineChain(raw);
				if (!stepOk) ok = false;
			}
			return ok;
		},
	},

	source: {
		about: "run commands from a script in current shell",
		usage: "source <file>",
		run: function (args) {
			return commands.sh.run(args);
		},
	},

	echo: {
		about: "display a line of text: echo [-n] [text...]",
		usage: "echo [-n] [text...]",
		run: function (args) {
			if (args[0] === "-n") {
				print(args.slice(1).join(" "));
			} else {
				print(args.join(" "));
			}
			return true;
		},
	},

	date: {
		about: "print current system date and time: date [-u | +%Y-%m-%d]",
		usage: "date [-u | +FORMAT]",
		run: function (args) {
			const now = new Date();
			if (args[0] === "-u") {
				print(now.toUTCString());
				return true;
			}
			if (args[0] && args[0].startsWith("+")) {
				const fmt = args[0].slice(1);
				const pad2 = function (n) { return String(n).padStart(2, "0"); };
				const out = fmt
					.replace(/%Y/g, String(now.getFullYear()))
					.replace(/%m/g, pad2(now.getMonth() + 1))
					.replace(/%d/g, pad2(now.getDate()))
					.replace(/%H/g, pad2(now.getHours()))
					.replace(/%M/g, pad2(now.getMinutes()))
					.replace(/%S/g, pad2(now.getSeconds()));
				print(out);
				return true;
			}
			print(now.toLocaleString([], { dateStyle: "full", timeStyle: "medium" }));
			return true;
		},
	},

	cal: {
		about: "display an ASCII calendar for the current month",
		usage: "cal",
		run: function () {
			const now = new Date();
			const year = now.getFullYear();
			const month = now.getMonth();
			const monthNames = [
				"January", "February", "March", "April", "May", "June",
				"July", "August", "September", "October", "November", "December",
			];
			const title = monthNames[month] + " " + year;
			print(title.padStart(Math.floor((20 + title.length) / 2)), "accent");
			print("Su Mo Tu We Th Fr Sa", "dim");

			const firstDay = new Date(year, month, 1).getDay();
			const daysInMonth = new Date(year, month + 1, 0).getDate();
			let row = "   ".repeat(firstDay);

			for (let day = 1; day <= daysInMonth; day++) {
				row += String(day).padStart(2, " ") + " ";
				if ((firstDay + day) % 7 === 0 || day === daysInMonth) {
					print(row.trimEnd());
					row = "";
				}
			}
			return true;
		},
	},

	uptime: {
		about: "tell how long the system has been running",
		usage: "uptime",
		run: function () {
			const totalSec = Math.floor((Date.now() - BOOT_TIME) / 1000);
			const hrs = Math.floor(totalSec / 3600);
			const mins = Math.floor((totalSec % 3600) / 60);
			const secs = totalSec % 60;
			const upStr = (hrs > 0 ? hrs + "h " : "") + mins + "m " + secs + "s";
			print(new Date().toLocaleTimeString() + " up " + upStr + ",  1 user,  load average: 0.11, 0.05, 0.01");
			return true;
		},
	},

	free: {
		about: "display amount of free and used memory: free [-h]",
		usage: "free [-h]",
		run: function (args) {
			const human = args.includes("-h");
			const mem = performance && performance.memory;
			const total = mem ? mem.jsHeapSizeLimit : (navigator.deviceMemory || 4) * 1024 * 1024 * 1024;
			const used = mem ? mem.usedJSHeapSize : Math.round(total * 0.24);
			const free = Math.max(0, total - used);

			print("               total        used        free", "accent");
			print(
				"Mem:      " +
					formatBytes(total, human).padStart(10) +
					"  " +
					formatBytes(used, human).padStart(10) +
					"  " +
					formatBytes(free, human).padStart(10)
			);
			return true;
		},
	},

	dmesg: {
		about: "print kernel & BrowOS ring buffer messages",
		usage: "dmesg",
		run: function () {
			return commands.cat.run([activeVmId ? "/var/log/vm.log" : "/var/log/syslog"]);
		},
	},

	whoami: {
		about: "print effective user id",
		usage: "whoami",
		run: function () {
			print(envVars.USER);
			return true;
		},
	},

	id: {
		about: "print user and group IDs",
		usage: "id",
		run: function () {
			print("uid=1000(" + envVars.USER + ") gid=1000(" + envVars.USER + ") groups=1000(" + envVars.USER + "),27(sudo),100(browos-desktop)");
			return true;
		},
	},

	hostname: {
		about: "show or set the system's host name",
		usage: "hostname [new-name]",
		run: function (args) {
			if (args[0]) {
				envVars.HOSTNAME = args[0];
				writeVfsFile("/etc/hostname", args[0] + "\n", false);
				updatePromptDisplay();
			}
			print(envVars.HOSTNAME);
			return true;
		},
	},

	uname: {
		about: "print system information: uname [-a|-s|-n|-r|-m]",
		usage: "uname [-asnr]",
		run: function (args) {
			const browser =
				navigator.userAgentData && navigator.userAgentData.brands
					? navigator.userAgentData.brands
							.map(function (b) { return b.brand; })
							.filter(function (n) { return !/Not.*Brand/i.test(n); })
							.join("/")
					: navigator.platform || "Web";

			if (args.includes("-a")) {
				print("BrowOS " + envVars.HOSTNAME + " 3.0.0-web #1 SMP (" + browser + ") wasm64 BrowOS/Linux");
			} else if (args.includes("-r")) {
				print("3.0.0-web");
			} else if (args.includes("-n")) {
				print(envVars.HOSTNAME);
			} else if (args.includes("-m")) {
				print("wasm64");
			} else {
				print("BrowOS");
			}
			return true;
		},
	},

	neofetch: {
		about: "display BrowOS system information summary",
		usage: "neofetch",
		run: function () {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			const api = os(true);
			const info = api ? api.systemInfo() : null;
			const fileCount = Object.keys(tree).filter(function (k) {
				return (activeVmId || isRealStorePath(k)) && tree[k].type === "file";
			}).length;

			print(envVars.USER + "@" + envVars.HOSTNAME, "accent");
			print("------------------");
			print("OS:         BrowOS Web Desktop" + (activeVmId ? " (Isolated VM: " + activeVmId + ")" : ""));
			print("Kernel:     3.0.0-web");
			print("Shell:      bsh 3.0 (" + Object.keys(commands).length + " built-ins)");
			print("Files:      " + fileCount + " files (" + formatShortPath(envVars.PWD) + ")");
			print("Saved VMs:  " + Object.keys(vmStore).length);
			if (info) {
				print("DE:         BrowOS Desktop (" + info.theme + ")");
				print("Packages:   " + info.installed + " installed, " + info.running + " running");
				print("Workspace:  " + info.desktop + " of " + info.desktops);
				print("Resolution: " + info.screen);
				print("Locale:     " + info.language);
			} else {
				print("Resolution: " + window.innerWidth + "x" + window.innerHeight);
			}
			return true;
		},
	},

	env: {
		about: "print all environment variables",
		usage: "env",
		run: function () {
			Object.keys(envVars).forEach(function (key) {
				if (key !== "?") {
					print(key + "=" + envVars[key]);
				}
			});
			return true;
		},
	},

	export: {
		about: "set environment variables: export KEY=value",
		usage: "export KEY=value",
		run: function (args) {
			if (!args[0] || !args[0].includes("=")) {
				print("Usage: export KEY=value", "err");
				return false;
			}
			const joined = args.join(" ");
			const eqIdx = joined.indexOf("=");
			const key = joined.slice(0, eqIdx).trim();
			const val = joined.slice(eqIdx + 1);
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				print("export: '" + key + "': not a valid identifier", "err");
				return false;
			}
			envVars[key] = val;
			updatePromptDisplay();
			return true;
		},
	},

	unset: {
		about: "remove an environment variable",
		usage: "unset KEY",
		run: function (args) {
			if (!args[0]) {
				print("Usage: unset KEY", "err");
				return false;
			}
			delete envVars[args[0]];
			return true;
		},
	},

	alias: {
		about: "define or display command aliases: alias ll='ls -la'",
		usage: "alias [name='command']",
		run: function (args) {
			if (args.length === 0) {
				Object.keys(aliases)
					.sort()
					.forEach(function (name) {
						print("alias " + name + "='" + aliases[name] + "'");
					});
				return true;
			}
			const joined = args.join(" ");
			const eqIdx = joined.indexOf("=");
			if (eqIdx === -1) {
				if (!aliases[joined]) {
					print("alias: " + joined + ": not found", "err");
					return false;
				}
				print("alias " + joined + "='" + aliases[joined] + "'");
				return true;
			}
			const name = joined.slice(0, eqIdx).trim();
			let target = joined.slice(eqIdx + 1).trim();
			if ((target.startsWith("'") && target.endsWith("'")) || (target.startsWith('"') && target.endsWith('"'))) {
				target = target.slice(1, -1);
			}
			aliases[name] = target;
			saveJson(STORAGE_ALIASES_KEY, aliases);
			return true;
		},
	},

	unalias: {
		about: "remove an alias definition",
		usage: "unalias <name>",
		run: function (args) {
			if (!args[0] || !aliases[args[0]]) {
				print("unalias: " + (args[0] || "") + ": not found", "err");
				return false;
			}
			delete aliases[args[0]];
			saveJson(STORAGE_ALIASES_KEY, aliases);
			return true;
		},
	},

	which: {
		about: "locate a command or alias",
		usage: "which <command...>",
		run: function (args) {
			if (args.length === 0) return false;
			let ok = true;
			args.forEach(function (name) {
				if (aliases[name]) {
					print(name + ": aliased to " + aliases[name]);
				} else if (commands[name]) {
					print("/bin/" + name);
				} else {
					print(name + " not found", "err");
					ok = false;
				}
			});
			return ok;
		},
	},

	type: {
		about: "display information about command type",
		usage: "type <command>",
		run: function (args) {
			if (!args[0]) return false;
			const name = args[0];
			if (aliases[name]) print(name + " is aliased to `" + aliases[name] + "'");
			else if (commands[name]) print(name + " is a shell builtin");
			else {
				print("bsh: type: " + name + ": not found", "err");
				return false;
			}
			return true;
		},
	},

	calc: {
		about: "evaluate math expression: calc (2 + 3) * 4",
		usage: "calc <expression>",
		run: function (args) {
			if (args.length === 0) {
				print("Usage: calc <expression>", "err");
				return false;
			}
			try {
				const result =
					typeof safeCalculate === "function"
						? safeCalculate(args.join(" "))
						: Function('"use strict"; return (' + args.join(" ").replace(/[^0-9+\-*/%.()\s]/g, "") + ")")();
				if (Number.isFinite(result)) {
					print(String(result));
					return true;
				}
				print("Not a number (check for dividing by zero)", "err");
				return false;
			} catch (error) {
				print(error.message, "err");
				return false;
			}
		},
	},

	base64: {
		about: "base64 encode or decode text/stdin: base64 [-d] [text]",
		usage: "base64 [-d] [text]",
		run: function (args, stdin) {
			const decode = args[0] === "-d";
			const rest = decode ? args.slice(1) : args;
			const payload = rest.length > 0 ? rest.join(" ") : typeof stdin === "string" ? stdin.replace(/\n$/, "") : "";
			if (!payload) {
				print("Usage: base64 [-d] <text>", "err");
				return false;
			}
			try {
				if (decode) {
					print(decodeURIComponent(escape(atob(payload.trim()))));
				} else {
					print(btoa(unescape(encodeURIComponent(payload))));
				}
				return true;
			} catch (error) {
				print("base64: invalid input", "err");
				return false;
			}
		},
	},

	json: {
		about: "pretty-print and validate JSON from file, string, or pipe",
		usage: "json [file | json-string]",
		run: function (args, stdin) {
			syncFromBrowOSFiles();
			const tree = getActiveTree();
			let raw = "";
			if (args.length === 0 && typeof stdin === "string") {
				raw = stdin;
			} else if (args.length === 1 && tree[normalizePath(args[0])] && tree[normalizePath(args[0])].type === "file") {
				raw = tree[normalizePath(args[0])].content || "";
			} else {
				raw = args.join(" ");
			}

			if (!raw.trim()) {
				print("Usage: json <file | json-string>  (or pipe JSON into json)", "err");
				return false;
			}

			try {
				const parsed = JSON.parse(raw);
				printLines(JSON.stringify(parsed, null, 2));
				return true;
			} catch (error) {
				print("json: parse error: " + error.message, "err");
				return false;
			}
		},
	},

	seq: {
		about: "print a sequence of numbers: seq [first] <last>",
		usage: "seq [first] <last>",
		run: function (args) {
			const start = args.length > 1 ? parseInt(args[0], 10) : 1;
			const end = parseInt(args.length > 1 ? args[1] : args[0], 10);
			if (Number.isNaN(start) || Number.isNaN(end) || Math.abs(end - start) > 2000) {
				print("Usage: seq [first] <last> (max 2000 steps)", "err");
				return false;
			}
			const step = start <= end ? 1 : -1;
			for (let n = start; step > 0 ? n <= end : n >= end; n += step) {
				print(String(n));
			}
			return true;
		},
	},

	sleep: {
		about: "delay for a specified number of seconds",
		usage: "sleep <seconds>",
		run: function (args) {
			const sec = Math.min(30, Math.max(0, parseFloat(args[0]) || 0));
			return new Promise(function (resolve) {
				setTimeout(function () {
					resolve(true);
				}, sec * 1000);
			});
		},
	},

	true: {
		about: "do nothing, successfully",
		usage: "true",
		run: function () {
			return true;
		},
	},

	false: {
		about: "do nothing, unsuccessfully",
		usage: "false",
		run: function () {
			return false;
		},
	},

	search: {
		about: "search the web in a new browser tab",
		usage: "search <query>",
		run: function (args) {
			if (args.length === 0) {
				print("Usage: search <words>", "err");
				return false;
			}
			window.open("https://www.google.com/search?q=" + encodeURIComponent(args.join(" ")), "_blank", "noopener");
			return true;
		},
	},

	history: {
		about: "display or clear command history: history [-c]",
		usage: "history [-c]",
		run: function (args) {
			if (args[0] === "-c") {
				history.length = 0;
				historyPosition = 0;
				saveJson(STORAGE_HISTORY_KEY, history);
				print("History cleared.");
				return true;
			}
			history.forEach(function (line, position) {
				print(String(position + 1).padStart(4) + "  " + line);
			});
			return true;
		},
	},
};

function readTextSource(fileArg, stdin, cmdName) {
	syncFromBrowOSFiles();
	const tree = getActiveTree();
	if (!fileArg && typeof stdin === "string") {
		return stdin;
	}
	if (!fileArg) {
		print("Usage: " + cmdName + " <file>", "err");
		return null;
	}
	const resolved = normalizePath(fileArg);
	const node = tree[resolved];
	if (!node || node.type !== "file") {
		print(cmdName + ": " + fileArg + ": No such file or directory", "err");
		return null;
	}
	return node.content || "";
}

// ============================================================================
// Pipeline & Redirection Execution Engine
// ============================================================================

async function executeStage(rawStage, stdinText, captureStdout) {
	const tree = getActiveTree();
	const rawTokens = tokenizeStage(rawStage);
	if (rawTokens.length === 0) {
		return { ok: true, stdout: "" };
	}

	const first = rawTokens[0];
	if (!first.op && !first.quoted && aliases[first.value]) {
		const expanded = tokenizeStage(aliases[first.value]);
		rawTokens.splice(0, 1, ...expanded);
	}

	let redirectOutMode = null;
	let redirectOutFile = null;
	let redirectInFile = null;
	const cleanTokens = [];

	for (let i = 0; i < rawTokens.length; i++) {
		const tok = rawTokens[i];
		if (tok.op && (tok.value === ">" || tok.value === ">>")) {
			redirectOutMode = tok.value;
			const nextTok = rawTokens[i + 1];
			if (!nextTok || nextTok.op) {
				print("bsh: syntax error near unexpected token `newline'", "err");
				return { ok: false, stdout: "" };
			}
			redirectOutFile = nextTok.value;
			i++;
		} else if (tok.op && tok.value === "<") {
			const nextTok = rawTokens[i + 1];
			if (!nextTok || nextTok.op) {
				print("bsh: syntax error near unexpected token `newline'", "err");
				return { ok: false, stdout: "" };
			}
			redirectInFile = nextTok.value;
			i++;
		} else {
			cleanTokens.push(tok.value);
		}
	}

	if (cleanTokens.length === 0) {
		return { ok: true, stdout: "" };
	}

	if (redirectInFile) {
		syncFromBrowOSFiles();
		const inResolved = normalizePath(redirectInFile);
		const inNode = tree[inResolved];
		if (!inNode || inNode.type !== "file") {
			print("bsh: " + redirectInFile + ": No such file or directory", "err");
			return { ok: false, stdout: "" };
		}
		stdinText = inNode.content || "";
	}

	const cmdName = cleanTokens[0].toLowerCase();
	const rawArgs = cleanTokens.slice(1);
	const args = ["grep", "sed", "find", "alias", "export", "calc", "bubble", "vm"].includes(cmdName) ? rawArgs : expandGlobs(rawArgs);

	if (!commands[cmdName] && cleanTokens.length === 1 && /^https?:\/\//i.test(cleanTokens[0])) {
		const ok = await commands.open.run([cleanTokens[0]], stdinText);
		return { ok: Boolean(ok), stdout: "" };
	}

	if (!commands[cmdName]) {
		print(cmdName + ": command not found", "err");
		return { ok: false, stdout: "" };
	}

	const shouldCapture = captureStdout || Boolean(redirectOutMode);
	const capturedLines = [];
	const origAppend = output.appendChild.bind(output);

	if (shouldCapture) {
		output.appendChild = function (el) {
			capturedLines.push(el.textContent || "");
			return el;
		};
	}

	let ok = true;
	try {
		const res = await commands[cmdName].run(args, stdinText);
		ok = res !== false;
	} catch (error) {
		ok = false;
		if (shouldCapture) {
			capturedLines.push(error.message);
		} else {
			print("bsh: " + error.message, "err");
		}
	} finally {
		if (shouldCapture) {
			output.appendChild = origAppend;
		}
	}

	const stdoutStr = capturedLines.length > 0 ? capturedLines.join("\n") + "\n" : "";

	if (redirectOutMode) {
		if (!writeVfsFile(redirectOutFile, stdoutStr, redirectOutMode === ">>")) {
			print("bsh: " + redirectOutFile + ": No such file or directory", "err");
			return { ok: false, stdout: "" };
		}
		return { ok: ok, stdout: "" };
	}

	return { ok: ok, stdout: stdoutStr };
}

async function executePipeline(rawCommand) {
	const stages = splitPipeline(rawCommand);
	let pipeData = null;
	let lastOk = true;

	for (let i = 0; i < stages.length; i++) {
		const isLast = i === stages.length - 1;
		const res = await executeStage(stages[i], pipeData, !isLast);
		pipeData = res.stdout;
		lastOk = res.ok;
	}

	envVars["?"] = lastOk ? "0" : "1";
	return lastOk;
}

async function runPipelineChain(line) {
	const segments = splitChainedCommands(line);
	let lastSucceeded = true;

	for (let i = 0; i < segments.length; i++) {
		const step = segments[i];
		if (step.op === "&&" && !lastSucceeded) {
			continue;
		}
		if (step.op === "||" && lastSucceeded) {
			continue;
		}
		lastSucceeded = await executePipeline(step.raw);
	}

	return lastSucceeded;
}

async function runLine(line) {
	print(getPromptText() + line, "cmd");
	await runPipelineChain(line);
}

// ============================================================================
// Two-Way BrowOS Bubble Action Handler (Runs Commands from Bubble Cards)
// ============================================================================

async function handleBubbleCommandExecution(cmdLine) {
	const trimmed = String(cmdLine || "").trim();
	if (!trimmed) return;

	print(getPromptText() + trimmed + "  [from Bubble]", "cmd");

	const captured = [];
	const origAppend = output.appendChild.bind(output);
	output.appendChild = function (el) {
		captured.push(el.textContent || "");
		return origAppend(el);
	};

	try {
		await runPipelineChain(trimmed);
	} finally {
		output.appendChild = origAppend;
	}

	const outText = captured.join("\n").trim() || "(done)";
	activeBubbleState.lastOutput = outText;

	const api = os(true);
	if (!api || !api.bubble) return;

	// If the card template has a [data-bubble-output] element, update its text in place; otherwise append output block
	let nextHtml = activeBubbleState.templateHtml || "";
	if (nextHtml.includes("data-bubble-output")) {
		const tpl = document.createElement("template");
		tpl.innerHTML = nextHtml;
		const outEl = tpl.content.querySelector("[data-bubble-output]");
		if (outEl) {
			outEl.textContent = outText.slice(0, 420);
		}
		nextHtml = tpl.innerHTML;
	} else {
		nextHtml +=
			'<p style="font-family:monospace;font-size:11.5px;max-height:68px;overflow-y:auto;margin-top:6px;">' +
			escapeHtml(outText.slice(0, 420)) +
			"</p>";
	}

	api.bubble.showCard({
		id: "terminal:main",
		appId: "terminal",
		appName: "Terminal",
		title: activeBubbleState.title || "Terminal",
		html: nextHtml,
	});
}

window.addEventListener("message", function (event) {
	const data = event.data;
	if (!data || data.browos !== 1 || data.event !== "bubble-action") {
		return;
	}
	if ((data.action === "run" || data.action === "send-preset" || data.action === "send-input") && data.value) {
		handleBubbleCommandExecution(data.value);
	}
});

// ============================================================================
// Tab Completion
// ============================================================================

function getPathCompletions(partialPath, dirsOnly) {
	syncFromBrowOSFiles();
	const tree = getActiveTree();
	const raw = partialPath || "";
	let dirPart = "";
	let basePrefix = raw;

	const lastSlash = raw.lastIndexOf("/");
	if (lastSlash !== -1) {
		dirPart = raw.slice(0, lastSlash + 1);
		basePrefix = raw.slice(lastSlash + 1);
	}

	const searchDir = normalizePath(dirPart || envVars.PWD);
	if (!tree[searchDir] || tree[searchDir].type !== "dir") {
		return [];
	}

	return listChildren(searchDir)
		.filter(function (child) {
			if (dirsOnly && child.node.type !== "dir") return false;
			if (!basePrefix && child.name.startsWith(".")) return false;
			return child.name.toLowerCase().startsWith(basePrefix.toLowerCase());
		})
		.map(function (child) {
			return dirPart + child.name + (child.node.type === "dir" ? "/" : "");
		});
}

function handleTabCompletion() {
	if (editorSession) {
		return;
	}

	const value = input.value;
	const pipeSplit = value.split("|");
	const activeSegment = pipeSplit[pipeSplit.length - 1];
	const endsWithSpace = /\s$/.test(activeSegment);
	const parts = activeSegment.trim().length === 0 ? [] : activeSegment.trimStart().split(/\s+/);

	if (parts.length === 0) {
		return;
	}

	function applyCompletion(match, addSpace) {
		if (endsWithSpace) {
			input.value = value + match + (addSpace ? " " : "");
		} else {
			const idx = value.lastIndexOf(parts[parts.length - 1]);
			input.value = value.slice(0, idx) + match + (addSpace ? " " : "");
		}
	}

	if (parts.length === 1 && !endsWithSpace) {
		const prefix = parts[0].toLowerCase();
		const allNames = Array.from(new Set(Object.keys(commands).concat(Object.keys(aliases)))).sort();
		const matches = allNames.filter(function (name) {
			return name.startsWith(prefix);
		});

		if (matches.length === 1) {
			applyCompletion(matches[0], true);
		} else if (matches.length > 1) {
			print(matches.join("   "), "dim");
		}
		return;
	}

	const cmdName = parts[0].toLowerCase();
	const currentArg = endsWithSpace ? "" : parts[parts.length - 1];
	let matches = [];
	let appendSpace = true;

	const subcommands = {
		vm: ["create", "enter", "exit", "list", "delete", "export", "move-out", "visual"],
		bubble: ["show", "html", "shell", "hide", "list"],
		apps: ["list", "running", "open", "close", "info"],
		systemctl: ["status", "list-units", "start", "stop", "restart", "reboot", "poweroff"],
		apt: ["list", "search", "show", "install", "remove"],
		todo: ["add", "list", "done", "rm", "clear"],
		theme: ["dark", "light"],
		wallpaper: ["next"],
	};

	if (subcommands[cmdName] && ((parts.length === 2 && !endsWithSpace) || (parts.length === 1 && endsWithSpace))) {
		matches = subcommands[cmdName].filter(function (s) {
			return s.startsWith(currentArg.toLowerCase());
		});
	} else if (
		cmdName === "vm" &&
		["enter", "start", "use", "switch", "delete", "rm", "remove", "export", "move-out", "pull"].includes((parts[1] || "").toLowerCase())
	) {
		matches = Object.keys(vmStore).filter(function (id) {
			return id.toLowerCase().startsWith(currentArg.toLowerCase());
		});
	} else if (
		["close", "kill", "killall", "pgrep"].includes(cmdName) ||
		(["apps", "systemctl", "apt"].includes(cmdName) &&
			["open", "close", "info", "start", "stop", "restart", "status", "install", "remove", "show"].includes((parts[1] || "").toLowerCase()))
	) {
		const api = getDesktopApi();
		if (api) {
			matches = api
				.listApps()
				.map(function (app) { return app.id; })
				.filter(function (id) { return id.toLowerCase().startsWith(currentArg.toLowerCase()); });
		}
	} else if (cmdName === "open") {
		const api = getDesktopApi();
		const appIds = api ? api.listApps().map(function (a) { return a.id; }) : [];
		const fileMatches = getPathCompletions(currentArg, false);
		matches = Array.from(
			new Set(
				appIds
					.filter(function (id) { return id.toLowerCase().startsWith(currentArg.toLowerCase()); })
					.concat(fileMatches)
			)
		);
		appendSpace = matches.length === 1 && !matches[0].endsWith("/");
	} else if (["help", "man", "which", "type"].includes(cmdName)) {
		matches = Object.keys(commands)
			.sort()
			.filter(function (c) { return c.startsWith(currentArg.toLowerCase()); });
	} else {
		const dirsOnly = cmdName === "cd" || cmdName === "rmdir";
		matches = getPathCompletions(currentArg, dirsOnly);
		appendSpace = matches.length === 1 && !matches[0].endsWith("/");
	}

	if (matches.length === 1) {
		applyCompletion(matches[0], appendSpace);
	} else if (matches.length > 1) {
		print(matches.join("   "), "dim");
	}
}

// ============================================================================
// Keyboard & Focus Event Handlers
// ============================================================================

input.addEventListener("keydown", function (event) {
	if (editorSession) {
		if (event.ctrlKey && event.key.toLowerCase() === "s") {
			event.preventDefault();
			saveNanoBuffer();
			return;
		}
		if (event.ctrlKey && (event.key.toLowerCase() === "x" || event.key.toLowerCase() === "c")) {
			event.preventDefault();
			exitNanoEditor();
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const val = input.value;
			input.value = "";
			handleNanoLine(val);
		}
		return;
	}

	if (event.ctrlKey && event.key.toLowerCase() === "l") {
		event.preventDefault();
		output.innerHTML = "";
		return;
	}

	if (event.ctrlKey && event.key.toLowerCase() === "c") {
		event.preventDefault();
		if (activeAbortController) {
			activeAbortController.abort();
			activeAbortController = null;
		}
		print(getPromptText() + input.value + "^C", "cmd");
		input.value = "";
		return;
	}

	if (event.ctrlKey && event.key.toLowerCase() === "u") {
		event.preventDefault();
		input.value = "";
		return;
	}

	if (event.ctrlKey && event.key.toLowerCase() === "w") {
		event.preventDefault();
		input.value = input.value.replace(/\S+\s*$/, "");
		return;
	}

	if (event.key === "Enter") {
		const line = input.value.trim();
		input.value = "";

		if (!line) {
			print(getPromptText(), "cmd");
			return;
		}

		if (history[history.length - 1] !== line) {
			history.push(line);
			if (history.length > 300) {
				history.shift();
			}
			saveJson(STORAGE_HISTORY_KEY, history);
		}

		historyPosition = history.length;
		runLine(line);
		return;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		if (historyPosition > 0) {
			historyPosition--;
			input.value = history[historyPosition];
		}
		return;
	}

	if (event.key === "ArrowDown") {
		event.preventDefault();
		if (historyPosition < history.length - 1) {
			historyPosition++;
			input.value = history[historyPosition];
		} else {
			historyPosition = history.length;
			input.value = "";
		}
		return;
	}

	if (event.key === "Tab") {
		event.preventDefault();
		handleTabCompletion();
	}
});

term.addEventListener("click", function () {
	if (!window.getSelection().toString()) {
		input.focus();
	}
});

window.addEventListener("focus", function () {
	syncFromBrowOSFiles();
	input.focus();
});

try {
	if (window.parent && window.parent !== window) {
		window.parent.document.addEventListener("files-changed", syncFromBrowOSFiles);
	}
} catch (e) {}

syncFromBrowOSFiles();
updatePromptDisplay();

print("BrowOS Shell (bsh 3.0) - Mounted real BrowOS Files at /files", "accent");
print("Commands: 'vm create <id>' for isolated VMs, 'vm visual' for ephemeral BrowOS GUI, 'bubble shell' for Bubble CLI.", "dim");

input.focus();
