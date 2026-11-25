// Keeps a BrowOS app in step with the desktop theme and accent color,
// and guarantees window.browos is always available (via desktop.browosApi or localStorage fallback).

(function () {
	let desktop = null;

	try {
		if (window.parent && window.parent !== window) {
			void window.parent.document.documentElement;
			desktop = window.parent;
		}
	} catch (error) {
		desktop = null;
	}

	function createLocalStorageFilesFallback() {
		function storageKey() {
			try {
				const meta = JSON.parse(localStorage.getItem("browos-profiles-meta") || "null");
				const id = meta && meta.current ? meta.current : "default";
				return "browos-filestore:" + (id === "default" ? "browos-files" : "browos-files-" + id);
			} catch (e) {
				return "browos-filestore:browos-files";
			}
		}

		function readMap() {
			try {
				return JSON.parse(localStorage.getItem(storageKey()) || "{}") || {};
			} catch (e) {
				return {};
			}
		}

		function writeMap(map) {
			localStorage.setItem(storageKey(), JSON.stringify(map));
			window.dispatchEvent(new Event("files-changed"));
			try {
				if (desktop && desktop.document) {
					desktop.document.dispatchEvent(new Event("files-changed"));
				}
			} catch (e) {}
		}

		function storedToBlob(record) {
			const mime = record.mime || "text/plain";
			if (typeof record.dataUrl === "string" && record.dataUrl.startsWith("data:")) {
				const comma = record.dataUrl.indexOf(",");
				const meta = record.dataUrl.slice(5, comma);
				const body = record.dataUrl.slice(comma + 1);
				if (/;base64$/i.test(meta)) {
					const bin = atob(body);
					const bytes = new Uint8Array(bin.length);
					for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
					return new Blob([bytes], { type: mime });
				}
				return new Blob([decodeURIComponent(body)], { type: mime });
			}
			return new Blob([String(record.text || "")], { type: mime });
		}

		function hydrate(rec) {
			if (!rec) return null;
			if (rec.type === "folder") return Object.assign({}, rec);
			const blob = storedToBlob(rec);
			return Object.assign({}, rec, { blob: blob, size: typeof rec.size === "number" ? rec.size : blob.size });
		}

		function kind(name, mime) {
			const dot = String(name).lastIndexOf(".");
			const ext = dot > 0 ? String(name).slice(dot + 1).toLowerCase() : "";
			if (/^image\//.test(mime || "") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"].includes(ext)) return "image";
			if (mime === "application/pdf" || ext === "pdf") return "pdf";
			if (/^audio\//.test(mime || "") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
			if (/^video\//.test(mime || "") || ["mp4", "webm", "mkv", "mov"].includes(ext)) return "video";
			if (/^text\//.test(mime || "") || ["txt", "md", "json", "js", "ts", "css", "html", "htm", "xml", "csv", "py", "java", "c", "cpp", "h", "go", "rs", "sh", "yml", "yaml", "log", "ini", "sql"].includes(ext)) return "text";
			return "other";
		}

		function list(parent) {
			const items = Object.values(readMap()).filter((n) => n && n.parent === parent).map(hydrate);
			items.sort((a, b) => (a.type !== b.type ? (a.type === "folder" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })));
			return Promise.resolve(items);
		}

		function node(id) {
			if (id === "root" || id === "trash") {
				return Promise.resolve({ id: id, type: "folder", name: id === "root" ? "Files" : "Trash", parent: null });
			}
			return Promise.resolve(hydrate(readMap()[id] || null));
		}

		function read(id) {
			return node(id).then((n) => {
				if (!n || n.type !== "file") throw new Error("File not found.");
				return n;
			});
		}

		function text(id) {
			return read(id).then((n) => n.blob.text());
		}

		function write(parent, name, data, options) {
			const clean = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 120);
			if (!clean) return Promise.reject(new Error("That name can't be used."));
			const isBlob = data && typeof data === "object" && typeof data.arrayBuffer === "function";
			const blob = isBlob ? data : new Blob([String(data)], { type: "text/plain" });
			const overwrite = options && options.overwriteId;

			return new Promise((resolve, reject) => {
				const r = new FileReader();
				r.onload = () => resolve(r.result || "");
				r.onerror = () => reject(r.error);
				r.readAsDataURL(blob);
			}).then((dataUrl) => {
				const map = readMap();
				const id = overwrite || ("f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
				const old = overwrite ? map[overwrite] : null;
				const rec = {
					id: id,
					parent: parent || "root",
					name: clean,
					type: "file",
					mime: blob.type || "text/plain",
					size: blob.size,
					created: old && old.created ? old.created : Date.now(),
					modified: Date.now(),
					dataUrl: dataUrl,
				};
				map[id] = rec;
				writeMap(map);
				return hydrate(rec);
			});
		}

		function search(q) {
			const needle = String(q || "").toLowerCase();
			return Promise.resolve(
				Object.values(readMap())
					.filter((n) => n && n.parent !== "trash" && n.name.toLowerCase().includes(needle))
					.map(hydrate)
					.sort((a, b) => a.name.localeCompare(b.name))
			);
		}

		return {
			kind: kind,
			node: node,
			list: list,
			read: read,
			text: text,
			write: write,
			search: search,
			path: function (id) {
				const parts = [];
				const map = readMap();
				let cur = id;
				while (cur && cur !== "root" && map[cur]) {
					parts.unshift({ id: map[cur].id, name: map[cur].name });
					cur = map[cur].parent;
				}
				return Promise.resolve(parts);
			},
			totalSize: function () {
				return Promise.resolve(Object.values(readMap()).reduce((s, n) => s + (n && n.size ? n.size : 0), 0));
			},
			takeOpenRequest: function () {
				return null;
			},
		};
	}

	if (desktop && desktop.browosApi) {
		window.browos = desktop.browosApi;
	} else {
		window.browos = {
			files: createLocalStorageFilesFallback(),
		};
	}

	if (!desktop) {
		return;
	}

	const desktopRoot = desktop.document.documentElement;

	function sync() {
		const root = document.documentElement;

		root.classList.toggle("light-mode", desktopRoot.classList.contains("light-mode"));

		const accent = desktopRoot.style.getPropertyValue("--accent");

		if (accent) {
			root.style.setProperty("--accent", accent);
		}
	}

	sync();

	new MutationObserver(sync).observe(desktopRoot, {
		attributes: true,
		attributeFilter: ["class", "style"],
	});
})();
