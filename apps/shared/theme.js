// Syncs desktop theme/accent, binds the host's permission-gated browosApiForApp,
// and hooks <input type="file"> and <a download> so all apps use BrowOS Files cleanly.

(function () {
	if (window.__bosThemeAndFilesHooked) {
		return;
	}
	window.__bosThemeAndFilesHooked = true;

	let desktop = null;

	try {
		if (window.parent && window.parent !== window) {
			void window.parent.document.documentElement;
			desktop = window.parent;
		}
	} catch (error) {
		desktop = null;
	}

	function currentAppMeta() {
		try {
			if (window.frameElement) {
				const win = window.frameElement.closest(".app-window");
				if (win && win.dataset.appId) {
					return {
						id: win.dataset.appId,
						name: win.dataset.appName || win.dataset.appId,
					};
				}
			}
		} catch (e) {}
		return { id: "unknown-app", name: "App" };
	}

	const appMeta = currentAppMeta();

	if (desktop) {
		if (typeof desktop.browosApiForApp === "function") {
			try {
				Object.defineProperty(window, "browos", {
					value: desktop.browosApiForApp(appMeta),
					configurable: true,
					writable: false,
				});
			} catch (e) {
				window.browos = desktop.browosApiForApp(appMeta);
			}
		} else if (desktop.browosApi) {
			window.browos = desktop.browosApi;
		}
	} else {
		window.browos = null;
	}

	function getFilesApi() {
		return window.browos && window.browos.files ? window.browos.files : null;
	}

	// Sync theme & accent with desktop
	if (desktop) {
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
	}

	// =========================================================
	// UNIVERSAL FILE PICKER & SAVE BRIDGE (PERMISSION-GATED)
	// =========================================================
	if (appMeta.id === "files" || appMeta.id === "codeeditor") {
		return;
	}

	function matchesAccept(node, acceptAttr) {
		if (!acceptAttr || !acceptAttr.trim() || node.type === "folder") return true;
		const tokens = acceptAttr.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
		if (!tokens.length) return true;

		const nameLower = node.name.toLowerCase();
		const mimeLower = (node.mime || "").toLowerCase();

		return tokens.some(function (tok) {
			if (tok.startsWith(".")) return nameLower.endsWith(tok);
			if (tok.endsWith("/*")) return mimeLower.startsWith(tok.slice(0, -1));
			return mimeLower === tok;
		});
	}

	function injectNodeIntoFileInput(inputEl, node) {
		const mime = node.mime || (node.blob && node.blob.type) || "application/octet-stream";
		const fileObj = new File([node.blob], node.name, {
			type: mime,
			lastModified: node.modified || Date.now(),
		});
		const dt = new DataTransfer();
		dt.items.add(fileObj);
		inputEl.files = dt.files;
		inputEl.dispatchEvent(new Event("input", { bubbles: true }));
		inputEl.dispatchEvent(new Event("change", { bubbles: true }));
	}

	let bypassNativeInput = false;

	async function showUniversalOpenModal(inputEl) {
		const filesApi = getFilesApi();
		if (!filesApi) {
			bypassNativeInput = true;
			inputEl.click();
			bypassNativeInput = false;
			return;
		}

		try {
			await filesApi.list("root");
		} catch (err) {
			bypassNativeInput = true;
			inputEl.click();
			bypassNativeInput = false;
			return;
		}

		let browseFolder = "root";
		let filterByAccept = Boolean(inputEl.accept && inputEl.accept.trim());

		const overlay = document.createElement("div");
		overlay.style.cssText =
			"position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,0.64);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);";

		const dialog = document.createElement("div");
		dialog.style.cssText =
			"width:100%;max-width:460px;max-height:82vh;display:flex;flex-direction:column;border-radius:14px;border:1px solid rgba(255,255,255,0.18);background:#16171f;color:#f3f4f6;box-shadow:0 20px 50px rgba(0,0,0,0.55);overflow:hidden;font-family:system-ui,-apple-system,sans-serif;";

		const header = document.createElement("div");
		header.style.cssText =
			"padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:14px;";
		header.innerHTML = "<span>Open from BrowOS Files</span>";

		const closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.textContent = "×";
		closeBtn.style.cssText = "background:none;border:none;color:inherit;font-size:19px;cursor:pointer;padding:0 4px;";
		closeBtn.onclick = function () { overlay.remove(); };
		header.appendChild(closeBtn);

		const navBar = document.createElement("div");
		navBar.style.cssText =
			"padding:8px 16px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#9ca3af;";

		const pathLabel = document.createElement("span");
		const navRight = document.createElement("div");
		navRight.style.cssText = "display:flex;align-items:center;gap:8px;";

		const filterToggle = document.createElement("label");
		filterToggle.style.cssText = "display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:11.5px;";
		const filterCb = document.createElement("input");
		filterCb.type = "checkbox";
		filterCb.checked = filterByAccept;
		filterCb.onchange = function () {
			filterByAccept = filterCb.checked;
			renderFolder(browseFolder);
		};
		filterToggle.append(filterCb, document.createTextNode("Matching only"));
		if (!inputEl.accept || !inputEl.accept.trim()) {
			filterToggle.style.display = "none";
		}

		const upBtn = document.createElement("button");
		upBtn.type = "button";
		upBtn.textContent = "↑ Up";
		upBtn.style.cssText =
			"background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px;";

		navRight.append(filterToggle, upBtn);
		navBar.append(pathLabel, navRight);

		const listContainer = document.createElement("div");
		listContainer.style.cssText = "flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px;min-height:180px;";

		const footer = document.createElement("div");
		footer.style.cssText =
			"padding:10px 16px;border-top:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:space-between;gap:8px;";

		const deviceBtn = document.createElement("button");
		deviceBtn.type = "button";
		deviceBtn.textContent = "From this device…";
		deviceBtn.style.cssText =
			"background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#e5e7eb;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12.5px;";
		deviceBtn.onclick = function () {
			overlay.remove();
			bypassNativeInput = true;
			inputEl.click();
			bypassNativeInput = false;
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
			const folderNode = await filesApi.node(fId);
			pathLabel.textContent = "Folder: " + (folderNode ? folderNode.name : "Files");
			upBtn.disabled = fId === "root";
			upBtn.style.opacity = fId === "root" ? "0.4" : "1";
			upBtn.onclick = function () {
				renderFolder(folderNode && folderNode.parent ? folderNode.parent : "root");
			};

			const rawItems = await filesApi.list(fId);
			const items = filterByAccept
				? rawItems.filter((it) => it.type === "folder" || matchesAccept(it, inputEl.accept))
				: rawItems;

			listContainer.innerHTML = "";

			if (!items.length) {
				const empty = document.createElement("div");
				empty.textContent = "No matching files in this folder.";
				empty.style.cssText = "padding:24px;text-align:center;color:#9ca3af;font-size:13px;";
				listContainer.appendChild(empty);
				return;
			}

			items.forEach(function (item) {
				const rowBtn = document.createElement("button");
				rowBtn.type = "button";
				rowBtn.style.cssText =
					"display:flex;align-items:center;justify-content:space-between;width:100%;text-align:left;padding:8px 12px;border-radius:8px;border:1px solid transparent;background:rgba(255,255,255,0.04);color:#f3f4f6;cursor:pointer;font-size:13px;";
				rowBtn.onmouseenter = function () { rowBtn.style.background = "rgba(33,150,243,0.24)"; };
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
						const fullNode = await filesApi.read(item.id);
						injectNodeIntoFileInput(inputEl, fullNode);
					}
				};
				listContainer.appendChild(rowBtn);
			});
		}

		renderFolder(browseFolder);
	}

	const origInputClick = HTMLInputElement.prototype.click;
	HTMLInputElement.prototype.click = function () {
		if (!bypassNativeInput && this.type === "file") {
			showUniversalOpenModal(this);
			return;
		}
		return origInputClick.apply(this, arguments);
	};

	document.addEventListener(
		"click",
		function (event) {
			if (bypassNativeInput) return;
			const inputEl = event.target && event.target.closest ? event.target.closest('input[type="file"]') : null;
			if (inputEl) {
				event.preventDefault();
				event.stopImmediatePropagation();
				showUniversalOpenModal(inputEl);
			}
		},
		true
	);

	let bypassNativeDownload = false;

	function showUniversalSaveModal(anchorEl) {
		const filesApi = getFilesApi();
		const href = anchorEl.href;
		const suggestedName = anchorEl.getAttribute("download") || "file.txt";

		if (!filesApi || !href || (!href.startsWith("blob:") && !href.startsWith("data:"))) {
			bypassNativeDownload = true;
			anchorEl.click();
			bypassNativeDownload = false;
			return;
		}

		const overlay = document.createElement("div");
		overlay.style.cssText =
			"position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,0.64);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);";

		const dialog = document.createElement("div");
		dialog.style.cssText =
			"width:100%;max-width:400px;display:flex;flex-direction:column;gap:12px;border-radius:14px;border:1px solid rgba(255,255,255,0.18);background:#16171f;color:#f3f4f6;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,0.55);font-family:system-ui,-apple-system,sans-serif;";

		const title = document.createElement("div");
		title.style.cssText = "font-weight:600;font-size:15px;";
		title.textContent = "Save file";

		const nameInput = document.createElement("input");
		nameInput.type = "text";
		nameInput.value = suggestedName;
		nameInput.style.cssText =
			"width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#0c0d12;color:#fff;font-size:13.5px;outline:none;";

		const status = document.createElement("div");
		status.style.cssText = "font-size:12px;color:#fca5a5;min-height:16px;";

		const btnRow = document.createElement("div");
		btnRow.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;";

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.textContent = "Cancel";
		cancelBtn.style.cssText =
			"background:none;border:1px solid rgba(255,255,255,0.16);color:#9ca3af;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12.5px;";
		cancelBtn.onclick = function () { overlay.remove(); };

		const deviceBtn = document.createElement("button");
		deviceBtn.type = "button";
		deviceBtn.textContent = "Download to device";
		deviceBtn.style.cssText =
			"background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);color:#e5e7eb;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:12.5px;";
		deviceBtn.onclick = function () {
			const clean = nameInput.value.trim() || suggestedName;
			anchorEl.setAttribute("download", clean);
			overlay.remove();
			bypassNativeDownload = true;
			anchorEl.click();
			bypassNativeDownload = false;
		};

		const saveBosBtn = document.createElement("button");
		saveBosBtn.type = "button";
		saveBosBtn.textContent = "Save to BrowOS Files";
		saveBosBtn.style.cssText =
			"background:#2196f3;border:none;color:#fff;font-weight:600;border-radius:8px;padding:7px 13px;cursor:pointer;font-size:12.5px;";
		saveBosBtn.onclick = async function () {
			const clean = nameInput.value.trim() || suggestedName;
			try {
				const resp = await fetch(href);
				const blob = await resp.blob();
				await filesApi.write("root", clean, blob);
				overlay.remove();
				if (window.browos && typeof window.browos.notify === "function") {
					window.browos.notify("Files", "Saved " + clean + " to BrowOS Files");
				}
			} catch (err) {
				status.textContent = err && err.message ? err.message : "Permission denied or failed to save.";
			}
		};

		btnRow.append(cancelBtn, deviceBtn, saveBosBtn);
		dialog.append(title, nameInput, status, btnRow);
		overlay.appendChild(dialog);
		document.body.appendChild(overlay);
		nameInput.focus();
		nameInput.select();
	}

	const origAnchorClick = HTMLAnchorElement.prototype.click;
	HTMLAnchorElement.prototype.click = function () {
		if (!bypassNativeDownload && this.hasAttribute("download")) {
			showUniversalSaveModal(this);
			return;
		}
		return origAnchorClick.apply(this, arguments);
	};

	document.addEventListener(
		"click",
		function (event) {
			if (bypassNativeDownload) return;
			const anchorEl = event.target && event.target.closest ? event.target.closest("a[download]") : null;
			if (anchorEl) {
				event.preventDefault();
				event.stopImmediatePropagation();
				showUniversalSaveModal(anchorEl);
			}
		},
		true
	);

	// Automatic "Open With" support for apps that don't handle open-file manually
	if (appMeta.id !== "unknown-app" && desktop) {
		async function tryAutoLoadPendingFile(id) {
			const filesApi = getFilesApi();
			if (!filesApi || !id) return;
			const inputEl = document.querySelector('input[type="file"]');
			if (!inputEl) return;
			try {
				const node = await filesApi.read(id);
				injectNodeIntoFileInput(inputEl, node);
			} catch (e) {}
		}

		window.addEventListener("load", function () {
			setTimeout(function () {
				const filesApi = getFilesApi();
				if (!filesApi || typeof filesApi.takeOpenRequest !== "function") return;
				const pendingId = filesApi.takeOpenRequest(appMeta.id);
				if (pendingId) {
					tryAutoLoadPendingFile(pendingId);
				}
			}, 120);
		});

		try {
			desktop.document.addEventListener("open-file", function (event) {
				if (event.detail && event.detail.app === appMeta.id) {
					const filesApi = getFilesApi();
					if (filesApi) filesApi.takeOpenRequest(appMeta.id);
					tryAutoLoadPendingFile(event.detail.id);
				}
			});
		} catch (e) {}
	}
})();
