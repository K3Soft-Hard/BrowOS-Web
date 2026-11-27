// Frame hooks: tracks all same-origin app iframes, binds permission-gated window.browos,
// and blocks app iframes from bypassing permissions via raw localStorage or parent.browosApi.

(function () {
	const documentCallbacks = new Set();
	const hookedFrames = new WeakSet();

	const PRIVILEGED_SYSTEM_APPS = new Set([
		"files",
		"settings",
		"taskmanager",
		"browstore",
		"recoverbrow",
		"modmanager",
	]);

	const PROTECTED_STORAGE_PREFIXES = [
		"browos-filestore:",
		"browos-profiles",
	];

	const PROTECTED_STORAGE_KEYS = new Set([
		"browos-sdk-grants",
		"browos-pin",
		"browos-wipe-pin",
		"browos-os-code",
		"browos-biometric-cred",
		"browos-biometric-auto",
		"browos-pin-fails",
		"browos-pin-lockout-until",
		"browos-pin-limit-mode",
		"browos-master-reset-enabled",
		"browos-wipe-pending-code",
	]);

	function isProtectedStorageKey(key) {
		const k = String(key || "");
		if (PROTECTED_STORAGE_KEYS.has(k)) {
			return true;
		}
		for (let i = 0; i < PROTECTED_STORAGE_PREFIXES.length; i++) {
			if (k.startsWith(PROTECTED_STORAGE_PREFIXES[i])) {
				return true;
			}
		}
		return false;
	}

	function sameOriginDocument(frame) {
		try {
			return frame && frame.contentDocument ? frame.contentDocument : null;
		} catch (e) {
			return null;
		}
	}

	function onEveryDocument(callback) {
		if (typeof callback !== "function") return;
		documentCallbacks.add(callback);
		try {
			callback(document);
		} catch (e) {}
		document.querySelectorAll(".app-window iframe").forEach(function (frame) {
			const doc = sameOriginDocument(frame);
			if (doc) {
				try {
					callback(doc);
				} catch (e) {}
			}
		});
	}

	function hardenIframeWindow(frame) {
		const win = frame && frame.contentWindow;
		const doc = sameOriginDocument(frame);
		if (!win || !doc) return;

		const appWindow = frame.closest(".app-window");
		const appMeta = {
			id: (appWindow && appWindow.dataset.appId) || "unknown-app",
			name: (appWindow && appWindow.dataset.appName) || "App",
		};

		// 1. Bind permission-gated window.browos on the iframe
		if (typeof window.browosApiForApp === "function") {
			try {
				Object.defineProperty(win, "browos", {
					value: window.browosApiForApp(appMeta),
					configurable: true,
					writable: false,
				});
			} catch (e) {
				win.browos = window.browosApiForApp(appMeta);
			}
		}

		// 2. Prevent non-system apps from touching protected OS/Files localStorage keys directly
		if (!PRIVILEGED_SYSTEM_APPS.has(appMeta.id) && win.Storage && win.Storage.prototype) {
			try {
				if (!win.Storage.prototype.__bosGuarded) {
					const origGetItem = win.Storage.prototype.getItem;
					const origSetItem = win.Storage.prototype.setItem;
					const origRemoveItem = win.Storage.prototype.removeItem;
					const origKey = win.Storage.prototype.key;
					const origClear = win.Storage.prototype.clear;

					win.Storage.prototype.getItem = function (k) {
						if (this === win.localStorage && isProtectedStorageKey(k)) {
							return null;
						}
						return origGetItem.apply(this, arguments);
					};

					win.Storage.prototype.setItem = function (k, v) {
						if (this === win.localStorage && isProtectedStorageKey(k)) {
							throw new DOMException("Access to protected BrowOS storage key denied.", "SecurityError");
						}
						return origSetItem.apply(this, arguments);
					};

					win.Storage.prototype.removeItem = function (k) {
						if (this === win.localStorage && isProtectedStorageKey(k)) {
							return;
						}
						return origRemoveItem.apply(this, arguments);
					};

					win.Storage.prototype.key = function (idx) {
						if (this === win.localStorage) {
							const k = origKey.apply(this, arguments);
							return isProtectedStorageKey(k) ? null : k;
						}
						return origKey.apply(this, arguments);
					};

					win.Storage.prototype.clear = function () {
						if (this === win.localStorage) {
							const toRemove = [];
							for (let i = 0; i < this.length; i++) {
								const k = origKey.call(this, i);
								if (k && !isProtectedStorageKey(k)) {
									toRemove.push(k);
								}
							}
							toRemove.forEach((k) => origRemoveItem.call(this, k));
							return;
						}
						return origClear.apply(this, arguments);
					};

					win.Storage.prototype.__bosGuarded = true;
				}
			} catch (e) {}
		}

		// 3.Notify registered document listeners (idle activity, etc.)
		documentCallbacks.forEach(function (cb) {
			try {
				cb(doc);
			} catch (e) {}
		});
	}

	function attachFrameHook(frame) {
		if (!frame || hookedFrames.has(frame)) return;
		hookedFrames.add(frame);

		frame.addEventListener("load", function () {
			hardenIframeWindow(frame);
		});

		if (sameOriginDocument(frame)) {
			hardenIframeWindow(frame);
		}
	}

	function scanAllFrames() {
		document.querySelectorAll(".app-window iframe").forEach(attachFrameHook);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", scanAllFrames);
	} else {
		scanAllFrames();
	}

	new MutationObserver(scanAllFrames).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});

	window.sameOriginDocument = sameOriginDocument;
	window.onEveryDocument = onEveryDocument;
})();
