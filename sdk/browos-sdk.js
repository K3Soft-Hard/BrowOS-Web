// BrowOS Client SDK (sdk/browos-sdk.js)
// Include in any BrowStore or standalone app to communicate with BrowOS over postMessage.

(function () {
	if (window.BrowOS) {
		return;
	}

	let nextId = 1;
	const pending = new Map();
	const mediaListeners = new Set();
	const bubbleListeners = new Set();

	const inFrame = (function () {
		try {
			return window.parent && window.parent !== window;
		} catch (e) {
			return true;
		}
	})();

	function call(method, args) {
		if (!inFrame) {
			return Promise.reject(new Error("BrowOS desktop not detected"));
		}

		const id = nextId++;
		return new Promise(function (resolve, reject) {
			const timer = setTimeout(function () {
				pending.delete(id);
				reject(new Error("BrowOS SDK request timed out"));
			}, 15000);

			pending.set(id, {
				resolve: function (val) {
					clearTimeout(timer);
					resolve(val);
				},
				reject: function (err) {
					clearTimeout(timer);
					reject(err);
				},
			});

			window.parent.postMessage(
				{
					browos: 1,
					id: id,
					method: method,
					args: args || [],
				},
				"*"
			);
		});
	}

	window.addEventListener("message", function (event) {
		const data = event.data;
		if (!data || data.browos !== 1) {
			return;
		}

		if (typeof data.id === "number" && pending.has(data.id)) {
			const entry = pending.get(data.id);
			pending.delete(data.id);
			if (data.ok) {
				entry.resolve(data.result);
			} else {
				entry.reject(new Error(data.error || "SDK error"));
			}
			return;
		}

		if (data.event === "media-action" && typeof data.action === "string") {
			mediaListeners.forEach(function (fn) {
				try {
					fn(data.action);
				} catch (e) {}
			});
			return;
		}

		if (data.event === "bubble-action" && typeof data.action === "string") {
			bubbleListeners.forEach(function (fn) {
				try {
					fn(data.action, data.value || "");
				} catch (e) {}
			});
		}
	});

	const readyPromise = inFrame
		? call("hello", []).catch(function () {
				return null;
		  })
		: Promise.resolve(null);

	window.BrowOS = {
		available: inFrame,
		ready: readyPromise,

		notify: function (title, message) {
			return call("notify", [title, message]);
		},

		openApp: function (appIdOrName) {
			return call("openApp", [appIdOrName]);
		},

		keepAwake: function (enabled) {
			return call("keepAwake", [Boolean(enabled)]);
		},

		media: {
			update: function (info) {
				return call("media.update", [info || {}]);
			},
			stop: function () {
				return call("media.stop", []);
			},
			onAction: function (callback) {
				if (typeof callback === "function") {
					mediaListeners.add(callback);
				}
				return function () {
					mediaListeners.delete(callback);
				};
			},
		},

		bubble: {
			showCard: function (card) {
				return call("bubble.showCard", [card || {}]);
			},
			hideCard: function (cardId) {
				return call("bubble.hideCard", [cardId || "main"]);
			},
			onAction: function (callback) {
				if (typeof callback === "function") {
					bubbleListeners.add(callback);
				}
				return function () {
					bubbleListeners.delete(callback);
				};
			},
		},

		files: {
			write: function (name, content) {
				return call("files.write", [name, content]);
			},
			read: function (name) {
				return call("files.read", [name]);
			},
			list: function () {
				return call("files.list", []);
			},
			delete: function (name) {
				return call("files.delete", [name]);
			},
		},

		storage: {
			set: function (key, value) {
				return call("storage.set", [key, value]);
			},
			get: function (key) {
				return call("storage.get", [key]);
			},
			remove: function (key) {
				return call("storage.remove", [key]);
			},
			keys: function () {
				return call("storage.keys", []);
			},
			clear: function () {
				return call("storage.clear", []);
			},
		},
	};
})();
