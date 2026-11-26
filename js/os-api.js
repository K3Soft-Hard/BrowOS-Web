// The BrowOS API
// What apps that run in a frame (Terminal, Pomodoro, Recycle Bin...) can ask the desktop to do.
// They reach it as window.browos, see apps/shared/theme.js.

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

	window.browosApi = {
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
					window.browosApi.media.clear();
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
})();
