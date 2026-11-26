// BrowOS SDK bridge
// Websites running in a window (BrowStore apps) can't touch the desktop directly. With the small
// script in sdk/browos-sdk.js they can ask through postMessage. Each app has to be allowed per
// feature, the first time it asks. Apps that come with BrowOS don't need this, they have the full API.

const SDK_GRANTS_KEY = "browos-sdk-grants";
const SDK_STORAGE_PREFIX = "browos-sdk-fs:";

const SDK_FEATURES = {
	notify: "Show notifications",
	openApp: "Open other apps",
	keepAwake: "Keep the screen from locking or sleeping",
	files: "Save and read data in local storage",
	media: "Control and display media playback in Quick Settings & BrowOS Bubble",
	bubble: "Show a custom card in BrowOS Bubble",
};

function sdkGrants() {
	try {
		return JSON.parse(localStorage.getItem(SDK_GRANTS_KEY)) || {};
	} catch (error) {
		return {};
	}
}

function sdkSaveGrants(grants) {
	localStorage.setItem(SDK_GRANTS_KEY, JSON.stringify(grants));

	document.dispatchEvent(new Event("sdk-grants-changed"));
}

function sdkAppOf(source) {
	const frame = Array.from(document.querySelectorAll(".app-window iframe")).find(function (item) {
		try {
			return item.contentWindow === source || (source && item.contentWindow === source.parent);
		} catch (e) {
			return false;
		}
	});

	if (!frame) {
		return null;
	}

	const appWindow = frame.closest(".app-window");

	if (!appWindow) {
		return null;
	}

	return {
		id: appWindow.dataset.appId || "unknown-app",
		name: appWindow.dataset.appName || "App",
		icon: appWindow.dataset.appIcon || "icons/browos-logo.png",
		frame: frame,
	};
}

let sdkAsking = Promise.resolve();

function sdkAllowed(app, feature) {
	const grants = sdkGrants();

	if (grants[app.id] && typeof grants[app.id][feature] === "boolean") {
		return Promise.resolve(grants[app.id][feature]);
	}

	const asked = sdkAsking.then(function () {
		const again = sdkGrants();

		if (again[app.id] && typeof again[app.id][feature] === "boolean") {
			return again[app.id][feature];
		}

		return new Promise(function (resolve) {
			const overlay = document.createElement("div");

			overlay.className = "overlay show";
			overlay.setAttribute("role", "alertdialog");
			overlay.setAttribute("aria-label", "Permission request");

			const box = document.createElement("div");

			box.className = "palette-box sdk-ask";

			const text = document.createElement("div");

			text.textContent = app.name + " wants to: " + SDK_FEATURES[feature].toLowerCase() + ".";

			const row = document.createElement("div");

			row.className = "sdk-ask-row";

			function answer(yes) {
				const next = sdkGrants();

				next[app.id] = Object.assign(next[app.id] || {}, { [feature]: yes });

				sdkSaveGrants(next);

				overlay.remove();

				resolve(yes);
			}

			const allow = document.createElement("button");

			allow.className = "primary";
			allow.textContent = "Allow";

			allow.addEventListener("click", function () {
				answer(true);
			});

			const deny = document.createElement("button");

			deny.textContent = "Don't allow";

			deny.addEventListener("click", function () {
				answer(false);
			});

			row.append(deny, allow);

			box.append(text, row);

			overlay.appendChild(box);

			document.body.appendChild(overlay);

			deny.focus();
		});
	});

	sdkAsking = asked.catch(function () {});

	return asked;
}

// Per-app localStorage store
function sdkCleanKey(rawName) {
	const name = String(rawName == null ? "" : rawName).trim();
	if (!name) {
		throw new Error("Invalid file or key name");
	}
	return name.slice(0, 160);
}

function sdkReadAppStore(appId) {
	try {
		const raw = localStorage.getItem(SDK_STORAGE_PREFIX + appId);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch (e) {
		return {};
	}
}

function sdkWriteAppStore(appId, storeObj) {
	try {
		localStorage.setItem(SDK_STORAGE_PREFIX + appId, JSON.stringify(storeObj));
	} catch (e) {
		throw new Error("Local storage quota exceeded");
	}
}

function sdkMirrorToVirtualFiles(app, fileName, content, remove) {
	try {
		if (typeof fileList !== "function" || typeof fileMkdir !== "function") {
			return;
		}
		fileList("root")
			.then(function (items) {
				return items.find((n) => n.type === "folder" && n.name === "Apps") || fileMkdir("root", "Apps");
			})
			.then(function (appsFolder) {
				return fileList(appsFolder.id).then(function (items) {
					return items.find((n) => n.type === "folder" && n.name === app.name) || fileMkdir(appsFolder.id, app.name);
				});
			})
			.then(function (appFolder) {
				return fileList(appFolder.id).then(function (items) {
					const clean = typeof cleanFileName === "function" ? cleanFileName(fileName) : fileName;
					const existing = items.find((n) => n.type === "file" && n.name === clean);
					if (remove) {
						if (existing && typeof fileDelete === "function") {
							return fileDelete(existing.id);
						}
						return null;
					}
					if (typeof fileWrite === "function") {
						return fileWrite(
							appFolder.id,
							fileName,
							new Blob([content], { type: "text/plain" }),
							existing ? { overwriteId: existing.id } : undefined
						);
					}
					return null;
				});
			})
			.catch(function () {});
	} catch (e) {}
}

// Send media control commands back to the active app frame
window.sdkSendMediaAction = function (appId, action) {
	const frame = Array.from(document.querySelectorAll(".app-window iframe")).find(function (item) {
		const win = item.closest(".app-window");
		return win && win.dataset.appId === appId;
	});
	if (!frame || !frame.contentWindow) {
		return false;
	}
	try {
		frame.contentWindow.postMessage({ browos: 1, event: "media-action", action: action }, "*");
		return true;
	} catch (e) {
		return false;
	}
};

const sdkMethods = {
	hello: function () {
		return {
			version: 2,
			theme: document.documentElement.classList.contains("light-mode") ? "light" : "dark",
			accent: document.documentElement.style.getPropertyValue("--accent") || "",
			features: Object.keys(SDK_FEATURES),
		};
	},

	notify: {
		feature: "notify",
		run: function (app, args) {
			notify(String(args[0] || app.name).slice(0, 80), String(args[1] || "").slice(0, 200));
			return true;
		},
	},

	openApp: {
		feature: "openApp",
		run: function (app, args) {
			return window.browosApi.openApp(String(args[0] || ""));
		},
	},

	keepAwake: {
		feature: "keepAwake",
		run: function (app, args) {
			idleKeepAwake("sdk-" + app.id, Boolean(args[0]));
			return true;
		},
	},

	// Media playback bridge (Quick Settings + BrowOS Bubble)
	"media.update": {
		feature: "media",
		run: function (app, args) {
			const info = args[0] && typeof args[0] === "object" ? args[0] : {};
			if (window.browosApi && window.browosApi.media) {
				window.browosApi.media.update({
					appId: app.id,
					appName: app.name,
					title: String(info.title || app.name).slice(0, 90),
					artist: String(info.artist || app.name).slice(0, 90),
					playing: Boolean(info.playing),
					canNext: info.canNext !== false,
					canPrev: info.canPrev !== false,
					onAction: function (act) {
						window.sdkSendMediaAction(app.id, act);
					},
				});
			}
			return true;
		},
	},

	"media.stop": {
		feature: "media",
		run: function (app) {
			if (window.browosApi && window.browosApi.media) {
				window.browosApi.media.clear(app.id);
			}
			return true;
		},
	},

	// BrowOS Bubble custom HTML card bridge
	"bubble.showCard": {
		feature: "bubble",
		run: function (app, args) {
			const spec = args[0] && typeof args[0] === "object" ? args[0] : {};
			if (window.browosApi && window.browosApi.bubble) {
				window.browosApi.bubble.showCard({
					id: app.id + ":" + String(spec.id || "main").slice(0, 40),
					appId: app.id,
					appName: app.name,
					title: String(spec.title || app.name).slice(0, 50),
					html: String(spec.html || "").slice(0, 6000),
				});
			}
			return true;
		},
	},

	"bubble.hideCard": {
		feature: "bubble",
		run: function (app, args) {
			const cardKey = app.id + ":" + String(args[0] || "main").slice(0, 40);
			if (window.browosApi && window.browosApi.bubble) {
				window.browosApi.bubble.hideCard(cardKey);
			}
			return true;
		},
	},

	"files.write": {
		feature: "files",
		run: function (app, args) {
			const name = sdkCleanKey(args[0]);
			const value = String(args[1] == null ? "" : args[1]);
			const store = sdkReadAppStore(app.id);
			store[name] = value;
			sdkWriteAppStore(app.id, store);
			sdkMirrorToVirtualFiles(app, name, value, false);
			return name;
		},
	},

	"files.read": {
		feature: "files",
		run: function (app, args) {
			const name = sdkCleanKey(args[0]);
			const store = sdkReadAppStore(app.id);
			return Object.prototype.hasOwnProperty.call(store, name) ? store[name] : null;
		},
	},

	"files.list": {
		feature: "files",
		run: function (app) {
			const store = sdkReadAppStore(app.id);
			return Object.keys(store);
		},
	},

	"files.delete": {
		feature: "files",
		run: function (app, args) {
			const name = sdkCleanKey(args[0]);
			const store = sdkReadAppStore(app.id);
			if (Object.prototype.hasOwnProperty.call(store, name)) {
				delete store[name];
				sdkWriteAppStore(app.id, store);
				sdkMirrorToVirtualFiles(app, name, "", true);
				return true;
			}
			return false;
		},
	},

	"storage.set": {
		feature: "files",
		run: function (app, args) {
			const key = sdkCleanKey(args[0]);
			const value = typeof args[1] === "string" ? args[1] : JSON.stringify(args[1] == null ? null : args[1]);
			const store = sdkReadAppStore(app.id);
			store[key] = value;
			sdkWriteAppStore(app.id, store);
			return true;
		},
	},

	"storage.get": {
		feature: "files",
		run: function (app, args) {
			const key = sdkCleanKey(args[0]);
			const store = sdkReadAppStore(app.id);
			return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
		},
	},

	"storage.remove": {
		feature: "files",
		run: function (app, args) {
			const key = sdkCleanKey(args[0]);
			const store = sdkReadAppStore(app.id);
			delete store[key];
			sdkWriteAppStore(app.id, store);
			return true;
		},
	},

	"storage.keys": {
		feature: "files",
		run: function (app) {
			return Object.keys(sdkReadAppStore(app.id));
		},
	},

	"storage.clear": {
		feature: "files",
		run: function (app) {
			localStorage.removeItem(SDK_STORAGE_PREFIX + app.id);
			return true;
		},
	},
};

window.addEventListener("message", function (event) {
	const message = event.data;

	if (!message || message.browos !== 1 || typeof message.id !== "number" || typeof message.method !== "string" || !event.source) {
		return;
	}

	const app = sdkAppOf(event.source);

	function reply(ok, value) {
		const targetOrigin = !event.origin || event.origin === "null" ? "*" : event.origin;
		const payload = { browos: 1, id: message.id, ok: ok, [ok ? "result" : "error"]: value };
		try {
			event.source.postMessage(payload, targetOrigin);
		} catch (error) {
			try {
				event.source.postMessage(payload, "*");
			} catch (e) {}
		}
	}

	if (!app) {
		return;
	}

	const method = Object.prototype.hasOwnProperty.call(sdkMethods, message.method) ? sdkMethods[message.method] : null;

	if (!method) {
		reply(false, "Unknown method");

		return;
	}

	if (typeof method === "function") {
		reply(true, method(app, message.args || []));

		return;
	}

	sdkAllowed(app, method.feature).then(function (yes) {
		if (!yes) {
			reply(false, "Permission denied");

			return;
		}

		return Promise.resolve(method.run(app, Array.isArray(message.args) ? message.args : [])).then(
			function (result) {
				reply(true, result === undefined ? null : result);
			},
			function (error) {
				reply(false, error && error.message ? error.message : "Failed");
			}
		);
	});
});
