// File store
// A small file system kept in localStorage, shared by Files, the viewers and the editor.
// Nodes are folders or files. Everything is promise based.
// Root folder id is "root". Removed items go to the Recycle Bin folder ("trash") first.

const FILE_ROOT = "root";
const FILE_TRASH = "trash";

function fileStorageKey() {
	const dbName = typeof profileFilesDatabase === "function" ? profileFilesDatabase() : "browos-files";
	return "browos-filestore:" + dbName;
}

function readAllNodes() {
	try {
		const raw = localStorage.getItem(fileStorageKey());
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch (error) {
		return {};
	}
}

function writeAllNodes(map) {
	try {
		localStorage.setItem(fileStorageKey(), JSON.stringify(map));
	} catch (error) {
		throw new Error("Local storage is full. Delete some files or free up space.");
	}
}

function blobToStoredPayload(blob) {
	return new Promise(function (resolve, reject) {
		const reader = new FileReader();
		reader.onload = function () {
			resolve(reader.result || "");
		};
		reader.onerror = function () {
			reject(reader.error || new Error("Failed to read file data"));
		};
		reader.readAsDataURL(blob);
	});
}

function storedPayloadToBlob(record) {
	const mime = record.mime || "application/octet-stream";

	if (typeof record.dataUrl === "string" && record.dataUrl.startsWith("data:")) {
		const comma = record.dataUrl.indexOf(",");
		const meta = record.dataUrl.slice(5, comma);
		const body = record.dataUrl.slice(comma + 1);
		const isBase64 = /;base64$/i.test(meta);

		if (isBase64) {
			const binary = atob(body);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			return new Blob([bytes], { type: mime });
		}

		return new Blob([decodeURIComponent(body)], { type: mime });
	}

	if (typeof record.text === "string") {
		return new Blob([record.text], { type: record.mime || "text/plain" });
	}

	return new Blob([], { type: mime });
}

function hydrateNode(record) {
	if (!record) return null;
	if (record.type === "folder") {
		return Object.assign({}, record);
	}
	const blob = storedPayloadToBlob(record);
	return {
		id: record.id,
		parent: record.parent,
		trashedFrom: record.trashedFrom,
		name: record.name,
		type: "file",
		mime: record.mime || blob.type || "",
		size: typeof record.size === "number" ? record.size : blob.size,
		created: record.created || Date.now(),
		modified: record.modified || Date.now(),
		blob: blob,
	};
}

function fileId() {
	return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fileExtension(name) {
	const dot = String(name).lastIndexOf(".");

	return dot > 0 ? String(name).slice(dot + 1).toLowerCase() : "";
}

function fileKind(name, mime) {
	const ext = fileExtension(name);

	if (/^image\//.test(mime || "") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"].includes(ext)) {
		return "image";
	}

	if (mime === "application/pdf" || ext === "pdf") {
		return "pdf";
	}

	if (/^audio\//.test(mime || "") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) {
		return "audio";
	}

	if (/^video\//.test(mime || "") || ["mp4", "webm", "mkv", "mov"].includes(ext)) {
		return "video";
	}

	if (
		/^text\//.test(mime || "") ||
		["txt", "md", "json", "js", "ts", "css", "html", "htm", "xml", "csv", "py", "java", "c", "cpp", "h", "go", "rs", "sh", "yml", "yaml", "log", "ini", "sql"].includes(ext)
	) {
		return "text";
	}

	return "other";
}

function fileNodeGet(id) {
	if (id === FILE_ROOT || id === FILE_TRASH) {
		return Promise.resolve({ id: id, type: "folder", name: id === FILE_ROOT ? "Files" : "Trash", parent: null });
	}

	const map = readAllNodes();
	return Promise.resolve(hydrateNode(map[id] || null));
}

function fileList(parent) {
	const map = readAllNodes();
	const items = Object.values(map)
		.filter(function (item) {
			return item && item.parent === parent;
		})
		.map(hydrateNode);

	items.sort(function (a, b) {
		if (a.type !== b.type) {
			return a.type === "folder" ? -1 : 1;
		}

		return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
	});

	return Promise.resolve(items);
}

// a name that is not used yet in that folder: "photo.png", "photo (2).png"
function fileFreeName(parent, wanted) {
	return fileList(parent).then(function (items) {
		const used = new Set(
			items.map(function (item) {
				return item.name.toLowerCase();
			})
		);

		if (!used.has(wanted.toLowerCase())) {
			return wanted;
		}

		const dot = wanted.lastIndexOf(".");

		const base = dot > 0 ? wanted.slice(0, dot) : wanted;
		const ext = dot > 0 ? wanted.slice(dot) : "";

		let n = 2;

		while (used.has((base + " (" + n + ")" + ext).toLowerCase())) {
			n++;
		}

		return base + " (" + n + ")" + ext;
	});
}

function cleanFileName(name) {
	return String(name || "")
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
		.trim()
		.slice(0, 120);
}

function fileMkdir(parent, name) {
	const clean = cleanFileName(name);

	if (!clean) {
		return Promise.reject(new Error("That name can't be used."));
	}

	return fileFreeName(parent, clean).then(function (free) {
		const node = {
			id: fileId(),
			parent: parent,
			name: free,
			type: "folder",
			created: Date.now(),
			modified: Date.now(),
		};

		const map = readAllNodes();
		map[node.id] = node;
		writeAllNodes(map);

		fileChanged();

		return node;
	});
}

// data can be a Blob, File or text
function fileWrite(parent, name, data, options) {
	const clean = cleanFileName(name);

	if (!clean) {
		return Promise.reject(new Error("That name can't be used."));
	}

	// apps run in their own frame, so their Blob and File objects are not instances of this page's Blob
	const isBlob = data && typeof data === "object" && typeof data.arrayBuffer === "function" && typeof data.size === "number";

	const blob = isBlob ? new Blob([data], { type: data.type || "" }) : new Blob([String(data)], { type: "text/plain" });

	const overwrite = options && options.overwriteId;

	const getName = overwrite ? Promise.resolve(clean) : fileFreeName(parent, clean);

	return Promise.all([getName, overwrite ? fileNodeGet(overwrite) : Promise.resolve(null), blobToStoredPayload(blob)]).then(
		function (results) {
			const free = results[0];
			const old = results[1];
			const dataUrl = results[2];

			const id = overwrite || fileId();
			const created = old && old.created ? old.created : Date.now();
			const modified = Date.now();

			const record = {
				id: id,
				parent: parent,
				name: free,
				type: "file",
				mime: blob.type || "",
				size: blob.size,
				created: created,
				modified: modified,
				dataUrl: dataUrl,
			};

			const map = readAllNodes();
			map[id] = record;
			writeAllNodes(map);

			fileChanged();

			return hydrateNode(record);
		}
	);
}

function fileRead(id) {
	return fileNodeGet(id).then(function (node) {
		if (!node || node.type !== "file") {
			throw new Error("File not found.");
		}

		return node;
	});
}

function fileText(id) {
	return fileRead(id).then(function (node) {
		return node.blob.text();
	});
}

function fileRename(id, name) {
	const clean = cleanFileName(name);

	if (!clean) {
		return Promise.reject(new Error("That name can't be used."));
	}

	return fileNodeGet(id).then(function (node) {
		if (!node) {
			throw new Error("Item not found.");
		}

		return fileFreeName(node.parent, clean).then(function (free) {
			const map = readAllNodes();
			const record = map[id];
			if (!record) {
				throw new Error("Item not found.");
			}

			record.name = free === clean || free.toLowerCase() === record.name.toLowerCase() ? clean : free;
			record.modified = Date.now();

			map[id] = record;
			writeAllNodes(map);

			fileChanged();

			return hydrateNode(record);
		});
	});
}

function fileIsInside(id, folderId) {
	// walks up from folderId and reports if id is on the way
	if (folderId === id) {
		return Promise.resolve(true);
	}

	if (!folderId || folderId === FILE_ROOT || folderId === FILE_TRASH) {
		return Promise.resolve(false);
	}

	return fileNodeGet(folderId).then(function (node) {
		return node ? fileIsInside(id, node.parent) : false;
	});
}

function fileMove(id, parent) {
	return fileIsInside(id, parent)
		.then(function (loop) {
			if (loop) {
				throw new Error("A folder can't go inside itself.");
			}

			return fileNodeGet(id);
		})
		.then(function (node) {
			if (!node) {
				throw new Error("Item not found.");
			}

			return fileFreeName(parent, node.name).then(function (free) {
				const map = readAllNodes();
				const record = map[id];
				if (!record) {
					throw new Error("Item not found.");
				}

				record.parent = parent;
				record.name = free;
				record.modified = Date.now();

				map[id] = record;
				writeAllNodes(map);

				fileChanged();

				return hydrateNode(record);
			});
		});
}

function fileDescendants(id) {
	return fileList(id).then(function (children) {
		return Promise.all(
			children.map(function (child) {
				return child.type === "folder" ? fileDescendants(child.id) : [];
			})
		).then(function (nested) {
			return children.concat(nested.flat());
		});
	});
}

// first removal moves to the trash, removing from the trash deletes for good
function fileRemove(id) {
	return fileNodeGet(id).then(function (node) {
		if (!node) {
			return null;
		}

		if (node.parent === FILE_TRASH) {
			return fileDeleteForever(id);
		}

		const map = readAllNodes();
		const record = map[id];
		if (!record) {
			return null;
		}

		record.trashedFrom = record.parent;
		record.parent = FILE_TRASH;
		record.modified = Date.now();

		map[id] = record;
		writeAllNodes(map);

		fileChanged();
		return null;
	});
}

function fileRestore(id) {
	return fileNodeGet(id).then(function (node) {
		if (!node) return null;

		const target = node.trashedFrom || FILE_ROOT;

		return (target === FILE_ROOT ? Promise.resolve({ id: FILE_ROOT }) : fileNodeGet(target)).then(function (folder) {
			return fileMove(id, folder ? target : FILE_ROOT);
		});
	});
}

function fileDeleteForever(id) {
	return fileNodeGet(id).then(function (node) {
		if (!node) {
			return null;
		}

		const gather = node.type === "folder" ? fileDescendants(id) : Promise.resolve([]);

		return gather.then(function (below) {
			const map = readAllNodes();
			delete map[id];

			below.forEach(function (item) {
				delete map[item.id];
			});

			writeAllNodes(map);
			fileChanged();
		});
	});
}

function fileEmptyTrash() {
	return fileList(FILE_TRASH).then(function (items) {
		return Promise.all(
			items.map(function (item) {
				return fileDeleteForever(item.id);
			})
		);
	});
}

// the folders from the root to this node
function filePath(id) {
	const parts = [];

	function walk(current) {
		if (!current || current === FILE_ROOT) {
			return Promise.resolve(parts);
		}

		return fileNodeGet(current).then(function (node) {
			if (!node) {
				return parts;
			}

			parts.unshift({ id: node.id, name: node.name });

			return node.parent && node.parent !== null ? walk(node.parent) : parts;
		});
	}

	return walk(id);
}

function fileTotalSize() {
	const map = readAllNodes();
	const total = Object.values(map).reduce(function (sum, node) {
		return sum + (node && node.size ? node.size : 0);
	}, 0);

	return Promise.resolve(total);
}

function fileSearch(text) {
	const needle = String(text).toLowerCase();
	const map = readAllNodes();

	const results = Object.values(map)
		.filter(function (node) {
			return node && node.parent !== FILE_TRASH && node.name.toLowerCase().includes(needle);
		})
		.map(hydrateNode)
		.sort(function (a, b) {
			return a.name.localeCompare(b.name);
		});

	return Promise.resolve(results);
}

function fileChanged() {
	document.dispatchEvent(new Event("files-changed"));
}

// which app opens which kind of file (apps added later by other features)
const fileOpeners = {
	image: "imageviewer",
	pdf: "pdfviewer",
	text: "codeeditor",
	audio: "recorder",
	video: "recorder",
};

// an open request is kept until the app asks for it (the app may still be loading)
const pendingFileOpen = {};

function openFileWith(appId, id) {
	pendingFileOpen[appId] = id;

	launchApp(appId);

	document.dispatchEvent(new CustomEvent("open-file", { detail: { app: appId, id: id } }));
}

function openFileById(id) {
	return fileRead(id).then(function (node) {
		const kind = fileKind(node.name, node.mime);

		const appId = fileOpeners[kind];

		if (appId && installedApps.includes(appId)) {
			openFileWith(appId, id);

			return node.name;
		}

		downloadFileNode(node);

		return node.name;
	});
}

function downloadFileNode(node) {
	const url = URL.createObjectURL(node.blob);

	const link = document.createElement("a");

	link.href = url;
	link.download = node.name;

	document.body.appendChild(link);

	link.click();

	link.remove();

	setTimeout(function () {
		URL.revokeObjectURL(url);
	}, 2000);
}
