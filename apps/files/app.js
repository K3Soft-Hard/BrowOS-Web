// Files: a file manager for the BrowOS file store (kept in this browser's localStorage)

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const pathEl = document.getElementById("path");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const dropEl = document.getElementById("drop");
const mainEl = document.getElementById("main");
const fileInput = document.getElementById("fileInput");
const trashButton = document.getElementById("trashButton");
const emptyTrashButton = document.getElementById("emptyTrashButton");

let folder = "root";
let selected = null;
let renaming = null;
let searching = "";
let renderRun = 0;

// Direct localStorage fallback if parent frame API isn't attached yet or opened standalone
const localFallbackFilesApi = (function () {
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
			if (window.parent && window.parent !== window) {
				window.parent.document.dispatchEvent(new Event("files-changed"));
			}
		} catch (e) {}
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

	function cleanName(name) {
		return String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 120);
	}

	function list(parent) {
		const map = readMap();
		const items = Object.values(map).filter((n) => n && n.parent === parent);
		items.sort((a, b) => (a.type !== b.type ? (a.type === "folder" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })));
		return Promise.resolve(items);
	}

	function freeName(parent, wanted) {
		return list(parent).then((items) => {
			const used = new Set(items.map((i) => i.name.toLowerCase()));
			if (!used.has(wanted.toLowerCase())) return wanted;
			const dot = wanted.lastIndexOf(".");
			const base = dot > 0 ? wanted.slice(0, dot) : wanted;
			const ext = dot > 0 ? wanted.slice(dot) : "";
			let n = 2;
			while (used.has((base + " (" + n + ")" + ext).toLowerCase())) n++;
			return base + " (" + n + ")" + ext;
		});
	}

	function node(id) {
		if (id === "root" || id === "trash") {
			return Promise.resolve({ id: id, type: "folder", name: id === "root" ? "Files" : "Trash", parent: null });
		}
		return Promise.resolve(readMap()[id] || null);
	}

	function mkdir(parent, name) {
		const clean = cleanName(name);
		if (!clean) return Promise.reject(new Error("That name can't be used."));
		return freeName(parent, clean).then((free) => {
			const item = { id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), parent: parent, name: free, type: "folder", created: Date.now(), modified: Date.now() };
			const map = readMap();
			map[item.id] = item;
			writeMap(map);
			return item;
		});
	}

	function write(parent, name, data) {
		const clean = cleanName(name);
		if (!clean) return Promise.reject(new Error("That name can't be used."));
		const isBlob = data && typeof data === "object" && typeof data.arrayBuffer === "function";
		const blob = isBlob ? data : new Blob([String(data)], { type: "text/plain" });
		return Promise.all([
			freeName(parent, clean),
			new Promise((resolve, reject) => {
				const r = new FileReader();
				r.onload = () => resolve(r.result || "");
				r.onerror = () => reject(r.error);
				r.readAsDataURL(blob);
			}),
		]).then(([free, dataUrl]) => {
			const item = {
				id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
				parent: parent,
				name: free,
				type: "file",
				mime: blob.type || "",
				size: blob.size,
				created: Date.now(),
				modified: Date.now(),
				dataUrl: dataUrl,
			};
			const map = readMap();
			map[item.id] = item;
			writeMap(map);
			return item;
		});
	}

	function rename(id, name) {
		const clean = cleanName(name);
		if (!clean) return Promise.reject(new Error("That name can't be used."));
		const map = readMap();
		const item = map[id];
		if (!item) return Promise.reject(new Error("Item not found."));
		return freeName(item.parent, clean).then((free) => {
			item.name = free === clean || free.toLowerCase() === item.name.toLowerCase() ? clean : free;
			item.modified = Date.now();
			writeMap(map);
			return item;
		});
	}

	function move(id, parent) {
		const map = readMap();
		const item = map[id];
		if (!item || id === parent) return Promise.resolve(item);
		return freeName(parent, item.name).then((free) => {
			item.parent = parent;
			item.name = free;
			item.modified = Date.now();
			writeMap(map);
			return item;
		});
	}

	function deleteForever(id) {
		const map = readMap();
		const toDelete = new Set([id]);
		let added = true;
		while (added) {
			added = false;
			Object.values(map).forEach((n) => {
				if (n && toDelete.has(n.parent) && !toDelete.has(n.id)) {
					toDelete.add(n.id);
					added = true;
				}
			});
		}
		toDelete.forEach((delId) => delete map[delId]);
		writeMap(map);
		return Promise.resolve();
	}

	function remove(id) {
		const map = readMap();
		const item = map[id];
		if (!item) return Promise.resolve();
		if (item.parent === "trash") return deleteForever(id);
		item.trashedFrom = item.parent;
		item.parent = "trash";
		item.modified = Date.now();
		writeMap(map);
		return Promise.resolve();
	}

	function restore(id) {
		const map = readMap();
		const item = map[id];
		if (!item) return Promise.resolve();
		const target = item.trashedFrom && map[item.trashedFrom] ? item.trashedFrom : "root";
		return move(id, target);
	}

	function emptyTrash() {
		return list("trash").then((items) => Promise.all(items.map((i) => deleteForever(i.id))));
	}

	function path(id) {
		const parts = [];
		const map = readMap();
		let cur = id;
		while (cur && cur !== "root" && map[cur]) {
			parts.unshift({ id: map[cur].id, name: map[cur].name });
			cur = map[cur].parent;
		}
		return Promise.resolve(parts);
	}

	function totalSize() {
		const map = readMap();
		return Promise.resolve(Object.values(map).reduce((sum, n) => sum + (n && n.size ? n.size : 0), 0));
	}

	function search(text) {
		const needle = String(text).toLowerCase();
		const map = readMap();
		return Promise.resolve(
			Object.values(map)
				.filter((n) => n && n.parent !== "trash" && n.name.toLowerCase().includes(needle))
				.sort((a, b) => a.name.localeCompare(b.name))
		);
	}

	function download(id) {
		const item = readMap()[id];
		if (!item) return;
		const a = document.createElement("a");
		a.href = item.dataUrl || "data:text/plain;charset=utf-8," + encodeURIComponent(item.text || "");
		a.download = item.name;
		document.body.appendChild(a);
		a.click();
		a.remove();
	}

	function open(id) {
		download(id);
		return Promise.resolve();
	}

	return { kind, list, node, mkdir, write, rename, move, remove, restore, emptyTrash, path, totalSize, search, download, open };
})();

function api() {
	if (window.browos && window.browos.files) {
		return window.browos.files;
	}
	try {
		if (window.parent && window.parent !== window && window.parent.browosApi && window.parent.browosApi.files) {
			return window.parent.browosApi.files;
		}
	} catch (e) {}
	return localFallbackFilesApi;
}

function iconFor(node) {
	if (node.type === "folder") {
		return "📁";
	}

	return { image: "🖼️", pdf: "📕", audio: "🎵", video: "🎞️", text: "📄", other: "📦" }[api().kind(node.name, node.mime)];
}

function sizeText(bytes) {
	if (bytes < 1024) {
		return bytes + " B";
	}

	if (bytes < 1048576) {
		return (bytes / 1024).toFixed(1) + " KB";
	}

	return (bytes / 1048576).toFixed(1) + " MB";
}

function say(text) {
	statusEl.textContent = text;
}

function fail(error) {
	say(error && error.message ? error.message : "Something went wrong.");
}

function renderPath(run) {
	pathEl.innerHTML = "";

	function crumb(label, id) {
		const button = document.createElement("button");

		button.textContent = label;

		button.addEventListener("click", function () {
			go(id);
		});

		pathEl.appendChild(button);
	}

	if (searching) {
		crumb("Search: " + searching, folder);

		return Promise.resolve();
	}

	crumb(folder === "trash" ? "Trash" : "Files", "root");

	if (folder === "trash") {
		return Promise.resolve();
	}

	return api().path(folder).then(function (parts) {
		if (run !== renderRun) {
			return;
		}

		parts.forEach(function (part) {
			const sep = document.createElement("span");

			sep.className = "sep";
			sep.textContent = "›";

			pathEl.appendChild(sep);

			crumb(part.name, part.id);
		});
	});
}

function go(id) {
	folder = id;
	selected = null;
	renaming = null;
	searching = "";
	searchEl.value = "";

	render();
}

function render() {
	const filesApi = api();
	if (!filesApi) {
		emptyEl.hidden = false;
		emptyEl.textContent = "The BrowOS desktop isn't reachable from here.";

		return;
	}

	const inTrash = folder === "trash";

	trashButton.textContent = inTrash ? "Back to files" : "Trash";
	emptyTrashButton.hidden = !inTrash;

	const run = ++renderRun;

	const load = searching ? filesApi.search(searching) : filesApi.list(folder);

	Promise.all([load, renderPath(run), filesApi.totalSize()])
		.then(function (results) {
			if (run !== renderRun) {
				return;
			}

			const items = results[0];

			listEl.innerHTML = "";

			emptyEl.hidden = items.length > 0;
			emptyEl.textContent = searching ? "Nothing found." : inTrash ? "The trash is empty." : "This folder is empty. Upload files or drop them here.";

			items.forEach(function (node) {
				listEl.appendChild(row(node, inTrash));
			});

			say(items.length + (items.length === 1 ? " item" : " items") + " · " + sizeText(results[2]) + " stored in this browser");
		})
		.catch(fail);
}

function row(node, inTrash) {
	const item = document.createElement("li");

	item.className = "fm-item" + (selected === node.id ? " selected" : "");
	item.draggable = !inTrash;

	const icon = document.createElement("span");
	icon.className = "fm-icon";
	icon.textContent = iconFor(node);

	let name;

	if (renaming === node.id) {
		name = document.createElement("input");
		name.className = "fm-rename";
		name.value = node.name;

		let done = false;

		function commit(save) {
			if (done) {
				return;
			}

			done = true;
			renaming = null;

			if (save && name.value.trim() && name.value !== node.name) {
				api().rename(node.id, name.value).then(render).catch(function (error) {
					fail(error);
					render();
				});
			} else {
				render();
			}
		}

		name.addEventListener("keydown", function (event) {
			if (event.key === "Enter") {
				commit(true);
			} else if (event.key === "Escape") {
				commit(false);
			}

			event.stopPropagation();
		});

		name.addEventListener("blur", function () {
			commit(true);
		});

		setTimeout(function () {
			name.focus();
			name.select();
		}, 0);
	} else {
		name = document.createElement("span");
		name.className = "fm-name";
		name.textContent = node.name;
	}

	const meta = document.createElement("span");
	meta.className = "fm-meta muted";
	meta.textContent = node.type === "folder" ? "" : sizeText(node.size || 0);

	const when = document.createElement("span");
	when.className = "fm-when muted";
	when.textContent = new Date(node.modified).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

	const actions = document.createElement("span");
	actions.className = "fm-row-actions";

	function action(label, handler) {
		const button = document.createElement("button");

		button.textContent = label;

		button.addEventListener("click", function (event) {
			event.stopPropagation();
			handler();
		});

		actions.appendChild(button);
	}

	if (inTrash) {
		action("Restore", function () {
			api().restore(node.id).then(render).catch(fail);
		});

		action("Delete", function () {
			if (confirm("Delete " + node.name + " for good?")) {
				api().remove(node.id).then(render).catch(fail);
			}
		});
	} else {
		if (node.type === "file") {
			action("Download", function () {
				api().download(node.id);
			});
		}

		action("Rename", function () {
			renaming = node.id;
			render();
		});

		action("Trash", function () {
			api().remove(node.id).then(render).catch(fail);
		});
	}

	item.append(icon, name, meta, when, actions);

	item.addEventListener("click", function () {
		selected = node.id;

		listEl.querySelectorAll(".fm-item").forEach(function (other) {
			other.classList.remove("selected");
		});

		item.classList.add("selected");
	});

	item.addEventListener("dblclick", function () {
		if (inTrash) {
			return;
		}

		if (node.type === "folder") {
			go(node.id);
		} else {
			api().open(node.id).catch(fail);
		}
	});

	// drag an item onto a folder to move it
	item.addEventListener("dragstart", function (event) {
		event.dataTransfer.setData("text/x-browos-file", node.id);
	});

	if (node.type === "folder" && !inTrash) {
		item.addEventListener("dragover", function (event) {
			if (event.dataTransfer.types.includes("text/x-browos-file")) {
				event.preventDefault();
				item.classList.add("drop-target");
			}
		});

		item.addEventListener("dragleave", function () {
			item.classList.remove("drop-target");
		});

		item.addEventListener("drop", function (event) {
			const id = event.dataTransfer.getData("text/x-browos-file");

			item.classList.remove("drop-target");

			if (id) {
				event.preventDefault();
				event.stopPropagation();

				api().move(id, node.id).then(render).catch(fail);
			}
		});
	}

	return item;
}

function upload(files) {
	const list = Array.from(files).filter(function (file) {
		return file.size >= 0;
	});

	if (!list.length || folder === "trash") {
		return;
	}

	say("Uploading " + list.length + (list.length === 1 ? " file…" : " files…"));

	list
		.reduce(function (chain, file) {
			return chain.then(function () {
				return api().write(folder, file.name, file);
			});
		}, Promise.resolve())
		.then(render)
		.catch(fail);
}

document.getElementById("uploadButton").addEventListener("click", function () {
	fileInput.click();
});

fileInput.addEventListener("change", function () {
	upload(fileInput.files);

	fileInput.value = "";
});

document.getElementById("newFolderButton").addEventListener("click", function () {
	if (folder === "trash") {
		return;
	}

	api().mkdir(folder, "New folder").then(function (node) {
		renaming = node.id;
		render();
	}).catch(fail);
});

document.getElementById("newFileButton").addEventListener("click", function () {
	if (folder === "trash") {
		return;
	}

	api().write(folder, "Untitled.txt", "").then(function (node) {
		renaming = node.id;
		render();
	}).catch(fail);
});

document.getElementById("upButton").addEventListener("click", function () {
	if (folder === "root" || searching) {
		go(searching ? folder : "root");

		return;
	}

	if (folder === "trash") {
		go("root");

		return;
	}

	api().node(folder).then(function (node) {
		go(node && node.parent ? node.parent : "root");
	});
});

trashButton.addEventListener("click", function () {
	go(folder === "trash" ? "root" : "trash");
});

emptyTrashButton.addEventListener("click", function () {
	if (confirm("Delete everything in the trash for good?")) {
		api().emptyTrash().then(render).catch(fail);
	}
});

let searchTimer = null;

searchEl.addEventListener("input", function () {
	clearTimeout(searchTimer);

	searchTimer = setTimeout(function () {
		searching = searchEl.value.trim();
		render();
	}, 200);
});

// drop files from the computer
mainEl.addEventListener("dragover", function (event) {
	if (event.dataTransfer.types.includes("Files")) {
		event.preventDefault();
		dropEl.hidden = false;
	}
});

mainEl.addEventListener("dragleave", function (event) {
	if (!mainEl.contains(event.relatedTarget)) {
		dropEl.hidden = true;
	}
});

mainEl.addEventListener("drop", function (event) {
	dropEl.hidden = true;

	if (event.dataTransfer.files.length) {
		event.preventDefault();
		upload(event.dataTransfer.files);
	} else {
		// an item dropped on empty space moves to the current folder
		const id = event.dataTransfer.getData("text/x-browos-file");

		if (id && folder !== "trash") {
			event.preventDefault();
			api().move(id, folder).then(render).catch(fail);
		}
	}
});

document.addEventListener("keydown", function (event) {
	if (renaming || event.target.closest("input")) {
		return;
	}

	if (event.key === "Delete" && selected) {
		api().remove(selected).then(function () {
			selected = null;
			render();
		}).catch(fail);
	} else if (event.key === "F2" && selected) {
		renaming = selected;
		render();
	} else if (event.key === "Enter" && selected && folder !== "trash") {
		api().node(selected).then(function (node) {
			if (node.type === "folder") {
				go(node.id);
			} else {
				api().open(node.id).catch(fail);
			}
		});
	} else if (event.key === "Backspace") {
		document.getElementById("upButton").click();
	}
});

try {
	if (window.parent && window.parent !== window) {
		window.parent.document.addEventListener("files-changed", function () {
			if (!renaming) {
				render();
			}
		});
	}
} catch (e) {}

window.addEventListener("files-changed", function () {
	if (!renaming) {
		render();
	}
});

render();
