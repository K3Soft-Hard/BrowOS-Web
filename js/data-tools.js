// Complete Backup Export & Import (all localStorage keys, app folders, settings, and IndexedDB snapshots)

(function () {
	const exportButton = document.getElementById("exportButton");
	const importInput = document.getElementById("importInput");
	const dataMessage = document.getElementById("dataMessage");

	function showDataStatus(text, isGood) {
		if (!dataMessage) return;
		dataMessage.textContent = text;
		dataMessage.style.color = isGood ? "#4ade80" : "#f87171";
	}

	async function dumpAllIndexedDB() {
		const result = {};
		if (!window.indexedDB || typeof indexedDB.databases !== "function") {
			return result;
		}

		const dbInfos = await indexedDB.databases();
		for (let i = 0; i < dbInfos.length; i++) {
			const info = dbInfos[i];
			if (!info || !info.name) continue;

			try {
				const db = await new Promise(function (resolve, reject) {
					const req = indexedDB.open(info.name);
					req.onsuccess = function () { resolve(req.result); };
					req.onerror = function () { reject(req.error); };
				});

				const storeNames = Array.from(db.objectStoreNames || []);
				if (!storeNames.length) {
					db.close();
					continue;
				}

				result[info.name] = {
					version: db.version,
					stores: {},
				};

				for (let s = 0; s < storeNames.length; s++) {
					const storeName = storeNames[s];
					const entries = await new Promise(function (resolve) {
						try {
							const tx = db.transaction(storeName, "readonly");
							const store = tx.objectStore(storeName);
							const items = [];
							const cursorReq = store.openCursor();
							cursorReq.onsuccess = function (e) {
								const cursor = e.target.result;
								if (cursor) {
									items.push({
										key: cursor.key,
										value: cursor.value,
									});
									cursor.continue();
								} else {
									resolve(items);
								}
							};
							cursorReq.onerror = function () { resolve(items); };
						} catch (e) {
							resolve([]);
						}
					});
					result[info.name].stores[storeName] = entries;
				}

				db.close();
			} catch (e) {}
		}

		return result;
	}

	async function restoreAllIndexedDB(idbDump) {
		if (!idbDump || typeof idbDump !== "object" || !window.indexedDB) {
			return;
		}

		const dbNames = Object.keys(idbDump);
		for (let i = 0; i < dbNames.length; i++) {
			const dbName = dbNames[i];
			const spec = idbDump[dbName];
			if (!spec || typeof spec.stores !== "object") continue;

			const storeNames = Object.keys(spec.stores);
			if (!storeNames.length) continue;

			await new Promise(function (resolve) {
				const delReq = indexedDB.deleteDatabase(dbName);
				delReq.onsuccess = delReq.onerror = delReq.onblocked = resolve;
			});

			await new Promise(function (resolve) {
				const openReq = indexedDB.open(dbName, spec.version || 1);
				openReq.onupgradeneeded = function () {
					const db = openReq.result;
					storeNames.forEach(function (sName) {
						if (!db.objectStoreNames.contains(sName)) {
							db.createObjectStore(sName);
						}
					});
				};
				openReq.onsuccess = function () {
					const db = openReq.result;
					try {
						const validStores = storeNames.filter(function (s) {
							return db.objectStoreNames.contains(s);
						});
						if (!validStores.length) {
							db.close();
							resolve();
							return;
						}
						const tx = db.transaction(validStores, "readwrite");
						validStores.forEach(function (sName) {
							const os = tx.objectStore(sName);
							const list = Array.isArray(spec.stores[sName]) ? spec.stores[sName] : [];
							list.forEach(function (entry) {
								if (entry && entry.key !== undefined) {
									try {
										os.put(entry.value, entry.key);
									} catch (e) {}
								}
							});
						});
						tx.oncomplete = tx.onerror = tx.onabort = function () {
							db.close();
							resolve();
						};
					} catch (e) {
						db.close();
						resolve();
					}
				};
				openReq.onerror = function () {
					resolve();
				};
			});
		}
	}

	if (exportButton) {
		exportButton.addEventListener("click", async function () {
			try {
				showDataStatus("Preparing full backup…", true);

				// Flush active profile state to IndexedDB if profiles.js helper exists
				if (typeof saveCurrentProfileSnapshot === "function") {
					try {
						await saveCurrentProfileSnapshot();
					} catch (e) {}
				}

				const localDump = {};
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k !== null) {
						localDump[k] = localStorage.getItem(k);
					}
				}

				const idbDump = await dumpAllIndexedDB();

				const payload = {
					app: "BrowOS",
					backupVersion: 2,
					exportedAt: new Date().toISOString(),
					localStorageCount: Object.keys(localDump).length,
					data: localDump,
					indexedDB: idbDump,
				};

				const jsonStr = JSON.stringify(payload, null, 2);
				const blob = new Blob([jsonStr], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				const stamp = new Date().toISOString().slice(0, 10);
				a.href = url;
				a.download = "browos-full-backup-" + stamp + ".json";
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(function () {
					URL.revokeObjectURL(url);
				}, 2000);

				showDataStatus(
					"Exported " + Object.keys(localDump).length + " storage items, app folders, and all settings.",
					true
				);
			} catch (err) {
				showDataStatus("Export failed: " + (err && err.message ? err.message : "Unknown error"), false);
			}
		});
	}

	if (importInput) {
		importInput.addEventListener("change", async function () {
			const file = importInput.files && importInput.files[0];
			importInput.value = "";
			if (!file) return;

			if (!confirm("Import this backup? Current settings, files, and app data will be replaced and BrowOS will reload.")) {
				return;
			}

			try {
				const rawText = await file.text();
				const parsed = JSON.parse(rawText);
				const records = parsed && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : parsed;

				if (!records || typeof records !== "object" || Array.isArray(records)) {
					throw new Error("Invalid BrowOS backup format.");
				}

				localStorage.clear();
				Object.keys(records).forEach(function (k) {
					if (typeof records[k] === "string") {
						localStorage.setItem(k, records[k]);
					}
				});

				if (parsed && parsed.indexedDB && typeof parsed.indexedDB === "object") {
					await restoreAllIndexedDB(parsed.indexedDB);
				}

				showDataStatus("Backup restored. Reloading BrowOS…", true);
				setTimeout(function () {
					location.reload();
				}, 600);
			} catch (err) {
				showDataStatus("Import failed: " + (err && err.message ? err.message : "Invalid file"), false);
			}
		});
	}
})();
