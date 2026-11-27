// The BrowOS API
// Host desktop API + per-app permission-gated API factory (browosApiForApp).

(function () {
	const extraApps = [
		{ id: "settings", name: "Settings" },
		{ id: "taskmanager", name: "Task Manager" },
	];

	function allApps() {
		const list = [];

		const ids = installedApps.slice();

		if (!ids.includes("browstore")) {
			ids.unshift("browstore");
		}

		ids.forEach(function (id) {
			const app = getApp(id);

			if (app) {
				list.push({ id: id, name: app.name, installed: true });
			}
		});

		extraApps.forEach(function (app) {
			list.push({ id: app.id, name: app.name, installed: true });
		});

		return list;
	}

	function findApp(query, list) {
		const text = String(query || "").trim().toLowerCase();

		if (!text) {
			return null;
		}

		return (
			list.find(function (app) {
				return app.id.toLowerCase() === text;
			}) ||
			list.find(function (app) {
				return app.name.toLowerCase() === text;
			}) ||
			list.find(function (app) {
				return app.name.toLowerCase().startsWith(text) || app.id.toLowerCase().startsWith(text);
			}) ||
			null
		);
	}

	function running() {
		return Array.from(document.querySelectorAll(".app-window[data-running]")).map(function (appWindow) {
			return {
				id: appWindow.dataset.appId,
				name: appWindow.dataset.appName,
				visible: appWindow.classList.contains("show"),
				window: appWindow,
			};
		});
	}

	function accentIsValid(color) {
		const probe = new Option().style;

		probe.color = color;

		return probe.color !== "";
	}

	// Shared Media Session State (Quick Settings + BrowOS Bubble)
	const mediaState = {
		active: false,
		appId: "",
		appName: "",
		title: "Nothing playing",
		artist: "No active media",
		playing: false,
		canNext: false,
		canPrev: false,
		onAction: null,
	};

	function emitMediaChange() {
		document.dispatchEvent(new CustomEvent("bos-media-changed", { detail: Object.assign({}, mediaState) }));
	}

	// Shared Custom Bubble Cards Registry
	const bubbleCardsMap = new Map();

	function emitBubbleCardsChange() {
		document.dispatchEvent(
			new CustomEvent("bos-bubble-cards-changed", {
				detail: Array.from(bubbleCardsMap.values()),
			})
		);
	}

	// Delegated Bubble action router (handles clicks & Enter inside custom app cards)
	function setupBubbleActionBridge() {
		const bubbleBody = document.getElementById("bosBubbleBody");
		if (!bubbleBody || bubbleBody.dataset.apiBridgeAttached === "1") {
			return;
		}
		bubbleBody.dataset.apiBridgeAttached = "1";

		function resolveActiveCardAppId() {
			const titleEl = document.getElementById("bosBubbleCardTitle");
			const currentTitle = titleEl ? titleEl.textContent.trim() : "";
			const cards = Array.from(bubbleCardsMap.values());
			const exact = cards.find(function (c) { return c.title === currentTitle; });
			if (exact) return exact.appId;
			return cards.length ? cards[0].appId : null;
		}

		function dispatchBubbleSlotAction(slot, action, value) {
			const appId = resolveActiveCardAppId();
			if (!appId) return;

			if (action === "open-app") {
				const backdrop = document.getElementById("bosBubbleBackdrop");
				if (backdrop) backdrop.click();
				if (typeof launchApp === "function") {
					launchApp(appId);
				} else if (window.browosApi) {
					window.browosApi.openApp(appId);
				}
				return;
			}

			if (typeof window.sdkSendBubbleAction === "function") {
				window.sdkSendBubbleAction(appId, action, value);
			}
		}

		bubbleBody.addEventListener("click", function (event) {
			const slot = event.target.closest(".bos-bubble-custom-slot");
			if (!slot) return;
			const btn = event.target.closest("[data-bubble-action]");
			if (!btn) return;

			const action = btn.dataset.bubbleAction;
			const promptInput = slot.querySelector("[data-bubble-input]");
			const value = btn.dataset.bubblePrompt || (promptInput ? promptInput.value.trim() : "");
			if (promptInput && !btn.dataset.bubblePrompt) {
				promptInput.value = "";
			}
			dispatchBubbleSlotAction(slot, action, value);
		});

		bubbleBody.addEventListener("keydown", function (event) {
			if (event.key !== "Enter") return;
			const slot = event.target.closest(".bos-bubble-custom-slot");
			const promptInput = event.target.closest("[data-bubble-input]");
			if (!slot || !promptInput) return;

			event.preventDefault();
			const value = promptInput.value.trim();
			if (!value) return;
			promptInput.value = "";
			dispatchBubbleSlotAction(slot, "send-input", value);
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", setupBubbleActionBridge);
	} else {
		setupBubbleActionBridge();
	}

	const rawApi = {
		notify: notify,

		keepAwake: function (key, on) {
			idleKeepAwake(key, on);
		},

		listApps: allApps,

		runningApps: function () {
			return running().map(function (app) {
				return { id: app.id, name: app.name, visible: app.visible };
			});
		},

		openApp: function (query) {
			const app = findApp(query, allApps());

			if (!app) {
				return null;
			}

			launchApp(app.id);

			return app.name;
		},

		closeApp: function (query) {
			const app = findApp(query, running());

			if (!app) {
				return null;
			}

			closeApp(app.window);

			return app.name;
		},

		setTheme: function (mode) {
			themeSelect.value = mode === "light" ? "light" : "dark";

			themeSelect.dispatchEvent(new Event("change"));
		},

		setAccent: function (color) {
			if (!accentIsValid(color)) {
				return false;
			}

			setAccent(color);

			localStorage.setItem("browos-accent", color);

			return true;
		},

		nextWallpaper: nextWallpaper,

		newNote: function (text) {
			createStickyNote(text);
		},

		lock: lockScreen,

		screensaver: startScreensaver,

		systemInfo: function () {
			return {
				theme: document.documentElement.classList.contains("light-mode") ? "light" : "dark",
				installed: installedApps.length,
				running: running().length,
				desktop: currentDesktop,
				desktops: DESKTOP_COUNT,
				screen: window.innerWidth + " x " + window.innerHeight,
				language: navigator.language,
				online: navigator.onLine,
			};
		},

		notes: noteTools,

		media: {
			get: function () {
				return Object.assign({}, mediaState);
			},
			update: function (info) {
				Object.assign(mediaState, {
					active: true,
					appId: info.appId || mediaState.appId || "system",
					appName: info.appName || mediaState.appName || "Media",
					title: info.title || "Playing media",
					artist: info.artist || info.appName || "BrowOS",
					playing: Boolean(info.playing),
					canNext: info.canNext !== false,
					canPrev: info.canPrev !== false,
					onAction: typeof info.onAction === "function" ? info.onAction : mediaState.onAction,
				});
				idleKeepAwake("bos-media-" + mediaState.appId, mediaState.playing);
				emitMediaChange();
			},
			clear: function (appId) {
				if (appId && mediaState.appId && mediaState.appId !== appId) {
					return;
				}
				if (mediaState.appId) {
					idleKeepAwake("bos-media-" + mediaState.appId, false);
				}
				Object.assign(mediaState, {
					active: false,
					appId: "",
					appName: "",
					title: "Nothing playing",
					artist: "No active media",
					playing: false,
					canNext: false,
					canPrev: false,
					onAction: null,
				});
				emitMediaChange();
			},
			dispatch: function (action) {
				if (action === "stop") {
					if (typeof mediaState.onAction === "function") {
						mediaState.onAction("stop");
					}
					rawApi.media.clear();
					return;
				}
				if (typeof mediaState.onAction === "function") {
					mediaState.onAction(action);
				}
			},
		},

		bubble: {
			listCards: function () {
				return Array.from(bubbleCardsMap.values());
			},
			showCard: function (card) {
				if (!card || !card.id) return;
				setupBubbleActionBridge();
				bubbleCardsMap.set(String(card.id), {
					id: String(card.id),
					appId: String(card.appId || "app"),
					appName: String(card.appName || "App"),
					title: String(card.title || card.appName || "App"),
					html: String(card.html || ""),
				});
				emitBubbleCardsChange();
			},
			hideCard: function (id) {
				if (bubbleCardsMap.delete(String(id))) {
					emitBubbleCardsChange();
				}
			},
		},

		files: {
			kind: fileKind,
			node: fileNodeGet,
			list: fileList,
			path: filePath,
			search: fileSearch,
			totalSize: fileTotalSize,
			mkdir: fileMkdir,
			write: fileWrite,
			read: fileRead,
			text: fileText,
			rename: fileRename,
			move: fileMove,
			remove: fileRemove,
			restore: fileRestore,
			emptyTrash: fileEmptyTrash,
			download: function (id) {
				return fileRead(id).then(downloadFileNode);
			},
			open: openFileById,
			openWith: openFileWith,
			takeOpenRequest: function (appId) {
				const id = pendingFileOpen[appId];

				delete pendingFileOpen[appId];

				return id || null;
			},
		},

		bin: {
			items: function () {
				return binItems.slice();
			},
			restore: binRestore,
			remove: binDelete,
			empty: binEmpty,
		},
	};

	window.browosApi = rawApi;

	// Build a permission-gated API view bound to a specific app window
	window.browosApiForApp = function (appMeta) {
		const app = {
			id: (appMeta && appMeta.id) || "unknown-app",
			name: (appMeta && appMeta.name) || "App",
		};

		const SYSTEM_EXEMPT_APPS = new Set(["files", "settings", "taskmanager", "browstore", "recoverbrow", "modmanager"]);
		const isSystemExempt = SYSTEM_EXEMPT_APPS.has(app.id);

		function requirePerm(feature) {
			if (isSystemExempt) {
				return Promise.resolve();
			}
			if (typeof window.sdkAllowed === "function") {
				return window.sdkAllowed(app, feature).then(function (allowed) {
					if (!allowed) {
						throw new Error("Permission denied: " + app.name + " cannot " + feature + ".");
					}
				});
			}
			return Promise.resolve();
		}

		function gateAsync(feature, fn) {
			return function () {
				const args = arguments;
				return requirePerm(feature).then(function () {
					return fn.apply(null, args);
				});
			};
		}

		const gatedFiles =
			app.id === "files"
				? rawApi.files
				: {
						kind: rawApi.files.kind,
						node: gateAsync("files", rawApi.files.node),
						list: gateAsync("files", rawApi.files.list),
						path: gateAsync("files", rawApi.files.path),
						search: gateAsync("files", rawApi.files.search),
						totalSize: gateAsync("files", rawApi.files.totalSize),
						mkdir: gateAsync("files", rawApi.files.mkdir),
						write: gateAsync("files", rawApi.files.write),
						read: gateAsync("files", rawApi.files.read),
						text: gateAsync("files", rawApi.files.text),
						rename: gateAsync("files", rawApi.files.rename),
						move: gateAsync("files", rawApi.files.move),
						remove: gateAsync("files", rawApi.files.remove),
						restore: gateAsync("files", rawApi.files.restore),
						emptyTrash: gateAsync("files", rawApi.files.emptyTrash),
						download: gateAsync("files", rawApi.files.download),
						open: gateAsync("files", rawApi.files.open),
						openWith: gateAsync("files", rawApi.files.openWith),
						takeOpenRequest: rawApi.files.takeOpenRequest,
				  };

		return {
			listApps: rawApi.listApps,
			runningApps: rawApi.runningApps,
			systemInfo: rawApi.systemInfo,
			files: gatedFiles,

			notify: gateAsync("notify", rawApi.notify),
			openApp: gateAsync("openApp", rawApi.openApp),
			keepAwake: gateAsync("keepAwake", rawApi.keepAwake),

			media: {
				get: rawApi.media.get,
				update: gateAsync("media", function (info) {
					return rawApi.media.update(Object.assign({}, info, { appId: app.id, appName: app.name }));
				}),
				clear: function () {
					return rawApi.media.clear(app.id);
				},
				dispatch: rawApi.media.dispatch,
			},

			bubble: {
				listCards: rawApi.bubble.listCards,
				showCard: gateAsync("bubble", function (card) {
					const rawId = card && card.id ? String(card.id) : app.id + ":main";
					const scopedId = rawId.startsWith(app.id + ":") ? rawId : app.id + ":" + rawId;
					return rawApi.bubble.showCard({
						id: scopedId,
						appId: app.id,
						appName: app.name,
						title: (card && card.title) || app.name,
						html: (card && card.html) || "",
					});
				}),
				hideCard: function (id) {
					const rawId = id ? String(id) : app.id + ":main";
					const scopedId = rawId.startsWith(app.id + ":") ? rawId : app.id + ":" + rawId;
					return rawApi.bubble.hideCard(scopedId);
				},
			},
		};
	};
})();
