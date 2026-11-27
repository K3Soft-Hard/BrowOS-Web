// Code Editor: syntax-highlighted editor using BrowOS permission-gated Files API

(function () {
	const APP_ID = "codeeditor";

	const text = document.getElementById("text");
	const highlight = document.getElementById("highlight");
	const lines = document.getElementById("lines");
	const nameEl = document.getElementById("name");
	const statusEl = document.getElementById("status");
	const wrap = document.getElementById("wrap");
	const fileInput = document.getElementById("fileInput");
	const root = document.querySelector(".ce");

	let fileId = null;
	let currentFolderId = "root";
	let fileName = "Untitled.txt";
	let saved = "";

	function getFilesApi() {
		return window.browos && window.browos.files ? window.browos.files : null;
	}

	function escapeHtml(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	}

	function dirty() {
		return text.value !== saved;
	}

	function paint() {
		if (typeof BrowHighlight !== "undefined" && typeof BrowHighlight.colorize === "function") {
			highlight.innerHTML = BrowHighlight.colorize(text.value, fileName) + "\n";
		} else {
			highlight.innerHTML = escapeHtml(text.value) + "\n";
		}

		const count = text.value.split("\n").length;
		let numbers = "";
		for (let i = 1; i <= count; i++) {
			numbers += i + "\n";
		}
		lines.textContent = numbers;

		nameEl.textContent = fileName;
		nameEl.classList.toggle("dirty", dirty());

		position();
	}

	function position() {
		const before = text.value.slice(0, text.selectionStart).split("\n");
		const lang =
			typeof BrowHighlight !== "undefined" && typeof BrowHighlight.languageFor === "function"
				? BrowHighlight.languageFor(fileName) || "text"
				: "text";

		statusEl.textContent =
			"Line " +
			before.length +
			", column " +
			(before[before.length - 1].length + 1) +
			" · " +
			text.value.length +
			" characters · " +
			lang;
	}

	function fit() {
		text.style.height = "0";
		text.style.height = Math.max(text.scrollHeight, text.parentElement.clientHeight) + "px";
		highlight.style.height = text.style.height;
	}

	function setText(value, name, id, folderId) {
		text.value = value;
		saved = value;
		fileName = name;
		fileId = id;
		if (folderId) {
			currentFolderId = folderId;
		}
		paint();
		fit();
	}

	function confirmDiscard() {
		return !dirty() || confirm("Discard the changes to " + fileName + "?");
	}

	text.addEventListener("input", function () {
		paint();
		fit();
	});

	text.addEventListener("keyup", position);
	text.addEventListener("click", position);

	text.addEventListener("keydown", function (event) {
		if (event.key === "Tab" && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			document.execCommand("insertText", false, "\t");
		}
	});

	if (wrap) {
		wrap.addEventListener("change", function () {
			if (root) root.classList.toggle("wrapping", wrap.checked);
			fit();
		});
	}

	window.addEventListener("resize", fit);

	function downloadToDeviceFallback() {
		const blob = new Blob([text.value], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName || "Untitled.txt";
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
		saved = text.value;
		paint();
		statusEl.textContent = "Downloaded " + a.download + " to device";
	}

	// =========================================================
	// In-App Save Modal (Gated by BrowOS Files Permission)
	// =========================================================
	async function openSaveDialog() {
		const files = getFilesApi();
		if (!files) {
			downloadToDeviceFallback();
			return;
		}

		try {
			await files.list("root");
		} catch (err) {
			statusEl.textContent = err && err.message ? err.message : "File permission denied.";
			return;
		}

		let targetFolder = currentFolderId || "root";

		const overlay = document.createElement("div");
		overlay.style.cssText =
			"position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(8px);";

		const dialog = document.createElement("div");
		dialog.style.cssText =
			"width:100%;max-width:420px;display:flex;flex-direction:column;gap:12px;border-radius:14px;border:1px solid rgba(255,255,255,0.18);background:#16171f;color:#f3f4f6;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,0.55);font-family:inherit;";

		const header = document.createElement("div");
		header.style.cssText = "display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:14.5px;";
		header.textContent = "Save to BrowOS Files";

		const navRow = document.createElement("div");
		navRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#9ca3af;";
		const folderLabel = document.createElement("span");
		const upBtn = document.createElement("button");
		upBtn.type = "button";
		upBtn.textContent = "↑ Up";
		upBtn.style.cssText =
			"background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#fff;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px;";
		navRow.append(folderLabel, upBtn);

		const folderList = document.createElement("div");
		folderList.style.cssText =
			"max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:6px;border-radius:9px;background:#0d0e14;border:1px solid rgba(255,255,255,0.1);";

		const nameInput = document.createElement("input");
		nameInput.type = "text";
		nameInput.value = fileName || "Untitled.txt";
		nameInput.placeholder = "File name (e.g. script.js)";
		nameInput.style.cssText =
			"width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.22);background:#0c0d12;color:#fff;font-size:13.5px;outline:none;";

		const errText = document.createElement("div");
		errText.style.cssText = "font-size:12px;color:#fca5a5;min-height:16px;";

		const btnRow = document.createElement("div");
		btnRow.style.cssText = "display:flex;justify-content:space-between;gap:8px;";

		const deviceSaveBtn = document.createElement("button");
		deviceSaveBtn.type = "button";
		deviceSaveBtn.textContent = "Download to device";
		deviceSaveBtn.style.cssText =
			"background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#e5e7eb;border-radius:8px;padding:7px 11px;cursor:pointer;font-size:12px;";
		deviceSaveBtn.onclick = function () {
			fileName = nameInput.value.trim() || fileName;
			overlay.remove();
			downloadToDeviceFallback();
		};

		const rightBtns = document.createElement("div");
		rightBtns.style.cssText = "display:flex;gap:8px;";

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.textContent = "Cancel";
		cancelBtn.style.cssText =
			"background:none;border:1px solid rgba(255,255,255,0.16);color:#9ca3af;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12.5px;";
		cancelBtn.onclick = function () { overlay.remove(); };

		const confirmBtn = document.createElement("button");
		confirmBtn.type = "button";
		confirmBtn.textContent = "Save";
		confirmBtn.style.cssText =
			"background:#2196f3;border:none;color:#fff;font-weight:600;border-radius:8px;padding:7px 16px;cursor:pointer;font-size:12.5px;";

		async function commitSave() {
			const wantedName = nameInput.value.trim();
			if (!wantedName) {
				errText.textContent = "Enter a file name.";
				return;
			}
			confirmBtn.disabled = true;
			try {
				const node = await files.write(
					targetFolder,
					wantedName,
					new Blob([text.value], { type: "text/plain" }),
					undefined
				);
				fileId = node.id;
				fileName = node.name;
				currentFolderId = node.parent || targetFolder;
				saved = text.value;
				paint();
				statusEl.textContent = "Saved to BrowOS Files as " + node.name;
				overlay.remove();
			} catch (err) {
				confirmBtn.disabled = false;
				errText.textContent = err && err.message ? err.message : "Could not save file.";
			}
		}

		confirmBtn.onclick = commitSave;
		nameInput.addEventListener("keydown", function (e) {
			if (e.key === "Enter") {
				e.preventDefault();
				commitSave();
			} else if (e.key === "Escape") {
				overlay.remove();
			}
		});

		async function renderSaveFolder(fId) {
			targetFolder = fId;
			const fNode = await files.node(fId);
			folderLabel.textContent = "Folder: " + (fNode ? fNode.name : "Files");
			upBtn.disabled = fId === "root";
			upBtn.style.opacity = fId === "root" ? "0.4" : "1";
			upBtn.onclick = function () {
				renderSaveFolder(fNode && fNode.parent ? fNode.parent : "root");
			};

			const items = await files.list(fId);
			const folders = items.filter(function (it) { return it.type === "folder"; });
			folderList.innerHTML = "";

			if (!folders.length) {
				const hint = document.createElement("div");
				hint.style.cssText = "font-size:12px;color:#9ca3af;padding:8px;text-align:center;";
				hint.textContent = "No subfolders here";
				folderList.appendChild(hint);
				return;
			}

			folders.forEach(function (sub) {
				const row = document.createElement("button");
				row.type = "button";
				row.textContent = "📁 " + sub.name;
				row.style.cssText =
					"text-align:left;padding:6px 8px;border-radius:6px;border:none;background:rgba(255,255,255,0.04);color:#f3f4f6;cursor:pointer;font-size:12.5px;";
				row.onclick = function () { renderSaveFolder(sub.id); };
				folderList.appendChild(row);
			});
		}

		rightBtns.append(cancelBtn, confirmBtn);
		btnRow.append(deviceSaveBtn, rightBtns);
		dialog.append(header, navRow, folderList, nameInput, errText, btnRow);
		overlay.appendChild(dialog);
		document.body.appendChild(overlay);

		renderSaveFolder(targetFolder);
		setTimeout(function () {
			nameInput.focus();
			nameInput.select();
		}, 20);
	}

	async function save(asNew) {
		const files = getFilesApi();
		if (!files) {
			downloadToDeviceFallback();
			return;
		}

		if (asNew || !fileId) {
			openSaveDialog();
			return;
		}

		try {
			const node = await files.write(
				currentFolderId || "root",
				fileName,
				new Blob([text.value], { type: "text/plain" }),
				{ overwriteId: fileId }
			);
			fileId = node.id;
			fileName = node.name;
			currentFolderId = node.parent || currentFolderId || "root";
			saved = text.value;
			paint();
			statusEl.textContent = "Saved to BrowOS Files as " + node.name;
		} catch (error) {
			statusEl.textContent = error && error.message ? error.message : "Could not save file.";
		}
	}

	// =========================================================
	// In-App Open Modal (Gated by BrowOS Files Permission)
	// =========================================================
	async function openBrowOSFilePicker() {
		const files = getFilesApi();
		if (!files) {
			if (fileInput) fileInput.click();
			return;
		}

		try {
			await files.list("root");
		} catch (err) {
			statusEl.textContent = err && err.message ? err.message : "File permission denied.";
			if (fileInput) fileInput.click();
			return;
		}

		let browseFolder = currentFolderId || "root";

		const overlay = document.createElement("div");
		overlay.style.cssText =
			"position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(8px);";

		const dialog = document.createElement("div");
		dialog.style.cssText =
			"width:100%;max-width:460px;max-height:80vh;display:flex;flex-direction:column;border-radius:14px;border:1px solid rgba(255,255,255,0.18);background:#16171f;color:#f3f4f6;box-shadow:0 20px 50px rgba(0,0,0,0.55);overflow:hidden;font-family:inherit;";

		const header = document.createElement("div");
		header.style.cssText =
			"padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:14px;";
		header.innerHTML = "<span>Open from BrowOS Files</span>";

		const closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.textContent = "×";
		closeBtn.style.cssText = "background:none;border:none;color:inherit;font-size:18px;cursor:pointer;padding:0 4px;";
		closeBtn.onclick = function () { overlay.remove(); };
		header.appendChild(closeBtn);

		const navBar = document.createElement("div");
		navBar.style.cssText =
			"padding:8px 16px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#9ca3af;";

		const pathLabel = document.createElement("span");
		const upBtn = document.createElement("button");
		upBtn.type = "button";
		upBtn.textContent = "↑ Up";
		upBtn.style.cssText =
			"background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px;";
		navBar.append(pathLabel, upBtn);

		const listContainer = document.createElement("div");
		listContainer.style.cssText =
			"flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px;min-height:180px;";

		const footer = document.createElement("div");
		footer.style.cssText =
			"padding:10px 16px;border-top:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;gap:8px;";

		const deviceBtn = document.createElement("button");
		deviceBtn.type = "button";
		deviceBtn.textContent = "Import from device…";
		deviceBtn.style.cssText =
			"background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#e5e7eb;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12.5px;";
		deviceBtn.onclick = function () {
			overlay.remove();
			if (fileInput) fileInput.click();
		};

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.textContent = "Cancel";
		cancelBtn.style.cssText =
			"background:none;border:1px solid rgba(255,255,255,0.16);color:#9ca3af;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12.5px;";
		cancelBtn.onclick = function () { overlay.remove(); };

		footer.append(deviceBtn, cancelBtn);
		dialog.append(header, navBar, listContainer, footer);
		overlay.appendChild(dialog);
		document.body.appendChild(overlay);

		async function renderFolder(fId) {
			browseFolder = fId;
			const folderNode = await files.node(fId);
			pathLabel.textContent = "Folder: " + (folderNode ? folderNode.name : "Files");
			upBtn.disabled = fId === "root";
			upBtn.style.opacity = fId === "root" ? "0.4" : "1";
			upBtn.onclick = function () {
				renderFolder(folderNode && folderNode.parent ? folderNode.parent : "root");
			};

			const items = await files.list(fId);
			listContainer.innerHTML = "";

			if (!items.length) {
				const empty = document.createElement("div");
				empty.textContent = "No files in this folder.";
				empty.style.cssText = "padding:24px;text-align:center;color:#9ca3af;font-size:13px;";
				listContainer.appendChild(empty);
				return;
			}

			items.forEach(function (item) {
				const rowBtn = document.createElement("button");
				rowBtn.type = "button";
				rowBtn.style.cssText =
					"display:flex;align-items:center;justify-content:space-between;width:100%;text-align:left;padding:8px 12px;border-radius:8px;border:1px solid transparent;background:rgba(255,255,255,0.04);color:#f3f4f6;cursor:pointer;font-size:13px;";
				rowBtn.onmouseenter = function () { rowBtn.style.background = "rgba(33,150,243,0.22)"; };
				rowBtn.onmouseleave = function () { rowBtn.style.background = "rgba(255,255,255,0.04)"; };

				const left = document.createElement("span");
				left.textContent = (item.type === "folder" ? "📁 " : "📄 ") + item.name;

				const right = document.createElement("span");
				right.style.cssText = "font-size:11.5px;color:#9ca3af;";
				right.textContent = item.type === "folder" ? "Folder" : (item.size || 0) + " B";

				rowBtn.append(left, right);
				rowBtn.onclick = async function () {
					if (item.type === "folder") {
						renderFolder(item.id);
					} else {
						overlay.remove();
						await loadFromFiles(item.id);
					}
				};
				listContainer.appendChild(rowBtn);
			});
		}

		await renderFolder(browseFolder);
	}

	async function loadFromFiles(id) {
		const files = getFilesApi();
		if (!files) return;
		try {
			const node = await files.read(id);
			const content = await node.blob.text();
			setText(content, node.name, id, node.parent || "root");
			statusEl.textContent = "Opened " + node.name + " from BrowOS Files";
		} catch (err) {
			statusEl.textContent = err && err.message ? err.message : "Could not open file.";
		}
	}

	const saveBtn = document.getElementById("saveButton");
	const saveAsBtn = document.getElementById("saveAsButton");
	const newBtn = document.getElementById("newButton");
	const openBtn = document.getElementById("openButton");

	if (saveBtn) saveBtn.addEventListener("click", function () { save(false); });
	if (saveAsBtn) saveAsBtn.addEventListener("click", function () { save(true); });

	if (newBtn) {
		newBtn.addEventListener("click", function () {
			if (confirmDiscard()) {
				setText("", "Untitled.txt", null, "root");
			}
		});
	}

	if (openBtn) {
		openBtn.addEventListener("click", function () {
			if (confirmDiscard()) {
				openBrowOSFilePicker();
			}
		});
	}

	if (fileInput) {
		fileInput.addEventListener("change", async function () {
			const file = fileInput.files && fileInput.files[0];
			if (file) {
				setText(await file.text(), file.name, null, "root");
			}
			fileInput.value = "";
		});
	}

	document.addEventListener("keydown", function (event) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			save(event.shiftKey);
		}
	});

	window.addEventListener("beforeunload", function (event) {
		if (dirty()) {
			event.preventDefault();
		}
	});

	const initialApi = getFilesApi();
	if (initialApi && typeof initialApi.takeOpenRequest === "function") {
		const first = initialApi.takeOpenRequest(APP_ID);
		if (first) {
			loadFromFiles(first);
		}
	}

	try {
		if (window.parent && window.parent !== window) {
			window.parent.document.addEventListener("open-file", function (event) {
				if (event.detail && event.detail.app === APP_ID) {
					const fApi = getFilesApi();
					if (fApi && typeof fApi.takeOpenRequest === "function") {
						fApi.takeOpenRequest(APP_ID);
					}
					if (confirmDiscard()) {
						loadFromFiles(event.detail.id);
					}
				}
			});
		}
	} catch (e) {}

	paint();
	fit();
})();
