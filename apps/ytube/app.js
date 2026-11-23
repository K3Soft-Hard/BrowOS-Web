(() => {
	"use strict";

	const STORAGE_KEYS = {
		HISTORY: "browos_ytube_history_v1",
		SAVED: "browos_ytube_saved_v1",
		SEARCHES: "browos_ytube_searches_v1",
		SETTINGS: "browos_ytube_settings_v1",
	};

	const MAX_HISTORY_ITEMS = 120;
	const MAX_RECENT_SEARCHES = 12;

	// Public Invidious and Piped endpoints used as fallback search backends
	const PUBLIC_SEARCH_NODES = [
		{ type: "invidious", base: "https://yewtu.be" },
		{ type: "invidious", base: "https://yt.artemislena.eu" },
		{ type: "invidious", base: "https://invidious.flokinet.to" },
		{ type: "piped", base: "https://pipedapi.kavin.rocks" },
		{ type: "piped", base: "https://pipedapi.leptons.xyz" },
		{ type: "piped", base: "https://pipedapi.adminforge.de" },
	];

	const defaultSettings = {
		customInstance: "",
		ytApiKey: "",
		autoplay: true,
		nocookie: true,
	};

	const state = {
		history: loadJson(STORAGE_KEYS.HISTORY, []),
		saved: loadJson(STORAGE_KEYS.SAVED, []),
		recentSearches: loadJson(STORAGE_KEYS.SEARCHES, []),
		settings: { ...defaultSettings, ...loadJson(STORAGE_KEYS.SETTINGS, {}) },
		activeTab: "history",
		currentVideo: null,
		searchResults: [],
	};

	// DOM Elements
	const el = {
		homeBtn: document.getElementById("homeBtn"),
		searchForm: document.getElementById("searchForm"),
		queryInput: document.getElementById("queryInput"),
		clearInputBtn: document.getElementById("clearInputBtn"),
		submitBtn: document.getElementById("submitBtn"),
		settingsToggleBtn: document.getElementById("settingsToggleBtn"),

		playerSection: document.getElementById("playerSection"),
		ytPlayer: document.getElementById("ytPlayer"),
		nowPlayingTitle: document.getElementById("nowPlayingTitle"),
		nowPlayingChannel: document.getElementById("nowPlayingChannel"),
		nowPlayingId: document.getElementById("nowPlayingId"),
		bookmarkBtn: document.getElementById("bookmarkBtn"),
		copyLinkBtn: document.getElementById("copyLinkBtn"),
		closePlayerBtn: document.getElementById("closePlayerBtn"),

		statusBanner: document.getElementById("statusBanner"),
		resultsHeading: document.getElementById("resultsHeading"),
		apiSourceBadge: document.getElementById("apiSourceBadge"),
		recentSearchesBar: document.getElementById("recentSearchesBar"),
		resultsGrid: document.getElementById("resultsGrid"),

		tabHistory: document.getElementById("tabHistory"),
		tabSaved: document.getElementById("tabSaved"),
		historyCount: document.getElementById("historyCount"),
		savedCount: document.getElementById("savedCount"),
		sidebarFilter: document.getElementById("sidebarFilter"),
		clearListBtn: document.getElementById("clearListBtn"),
		sidebarList: document.getElementById("sidebarList"),
		exportFilesBtn: document.getElementById("exportFilesBtn"),

		settingsModal: document.getElementById("settingsModal"),
		closeSettingsBtn: document.getElementById("closeSettingsBtn"),
		customInstanceInput: document.getElementById("customInstanceInput"),
		ytApiKeyInput: document.getElementById("ytApiKeyInput"),
		autoplayCheckbox: document.getElementById("autoplayCheckbox"),
		nocookieCheckbox: document.getElementById("nocookieCheckbox"),
		saveSettingsBtn: document.getElementById("saveSettingsBtn"),
		exportJsonDownloadBtn: document.getElementById("exportJsonDownloadBtn"),
		importJsonInput: document.getElementById("importJsonInput"),
	};

	// --- BrowOS SDK Integration ---
	if (typeof BrowOS !== "undefined" && BrowOS.available) {
		BrowOS.ready
			.then((info) => {
				if (info && info.theme) {
					document.body.dataset.theme = info.theme;
				}
				if (info && info.accent) {
					document.documentElement.style.setProperty("--accent", info.accent);
				}
			})
			.catch(() => {});
	}

	async function sendBrowOSNotification(title, message) {
		if (typeof BrowOS !== "undefined" && BrowOS.available) {
			await BrowOS.notify(title, message).catch(() => {});
		}
	}

	// --- Storage Helpers ---
	function loadJson(key, fallback) {
		try {
			const raw = localStorage.getItem(key);
			return raw ? JSON.parse(raw) : fallback;
		} catch {
			return fallback;
		}
	}

	function saveJson(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch (err) {
			showBanner("Local storage quota reached. Consider clearing old history.", true);
		}
	}

	// --- Video ID Extraction ---
	function extractVideoId(rawInput) {
		const input = (rawInput || "").trim();
		if (!input) return null;

		// Exact 11-character YouTube Video ID
		if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
			return input;
		}

		// Standard URLs: watch?v=, youtu.be/, embed/, shorts/, live/
		const patterns = [
			/(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
			/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
			/(?:youtube(?:-nocookie)?\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
			/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
			/(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
		];

		for (const regex of patterns) {
			const match = input.match(regex);
			if (match && match[1]) {
				return match[1];
			}
		}

		return null;
	}

	function getThumbnailUrl(videoId) {
		return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
	}

	function formatDuration(seconds) {
		const total = Number(seconds);
		if (!Number.isFinite(total) || total <= 0) return "";
		const hrs = Math.floor(total / 3600);
		const mins = Math.floor((total % 3600) / 60);
		const secs = Math.floor(total % 60);
		if (hrs > 0) {
			return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
		}
		return `${mins}:${String(secs).padStart(2, "0")}`;
	}

	function formatRelativeTime(timestamp) {
		if (!timestamp) return "";
		const diffSec = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
		if (diffSec < 60) return "Just now";
		const mins = Math.floor(diffSec / 60);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	// --- Metadata Enrichment (No-Key oEmbed) ---
	async function fetchVideoOEmbed(videoId) {
		const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
		const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 5000);

		try {
			const res = await fetch(endpoint, { signal: controller.signal });
			if (!res.ok) return null;
			const data = await res.json();
			return {
				title: data.title || `Video (${videoId})`,
				channel: data.author_name || "YouTube",
				thumbnail: data.thumbnail_url || getThumbnailUrl(videoId),
			};
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}

	// --- Playback & Local Watch History ---
	async function playVideo(videoObj) {
		const id = videoObj.id;
		if (!id) return;

		hideBanner();

		const domain = state.settings.nocookie ? "https://www.youtube-nocookie.com" : "https://www.youtube.com";
		const autoplayParam = state.settings.autoplay ? "1" : "0";
		el.ytPlayer.src = `${domain}/embed/${encodeURIComponent(id)}?autoplay=${autoplayParam}&rel=0`;

		const initialRecord = {
			id,
			title: videoObj.title || `Video (${id})`,
			channel: videoObj.channel || "YouTube",
			thumbnail: videoObj.thumbnail || getThumbnailUrl(id),
			duration: videoObj.duration || "",
			watchedAt: Date.now(),
		};

		state.currentVideo = initialRecord;
		el.playerSection.hidden = false;
		updatePlayerHeader(initialRecord);
		upsertHistory(initialRecord);

		// If opened directly via raw ID/URL without title metadata, resolve via oEmbed
		if (!videoObj.title || videoObj.title === `Video (${id})`) {
			const meta = await fetchVideoOEmbed(id);
			if (meta && state.currentVideo && state.currentVideo.id === id) {
				const enriched = {
					...initialRecord,
					title: meta.title,
					channel: meta.channel,
					thumbnail: meta.thumbnail,
				};
				state.currentVideo = enriched;
				updatePlayerHeader(enriched);
				upsertHistory(enriched);
			}
		}
	}

	function updatePlayerHeader(video) {
		el.nowPlayingTitle.textContent = video.title;
		el.nowPlayingChannel.textContent = video.channel;
		el.nowPlayingId.textContent = video.id;

		const isSaved = state.saved.some((item) => item.id === video.id);
		el.bookmarkBtn.textContent = isSaved ? "Saved ✓" : "Save";
	}

	function upsertHistory(video) {
		state.history = [
			video,
			...state.history.filter((item) => item.id !== video.id),
		].slice(0, MAX_HISTORY_ITEMS);

		saveJson(STORAGE_KEYS.HISTORY, state.history);
		renderSidebar();
	}

	function toggleSaveCurrentVideo() {
		if (!state.currentVideo) return;
		const id = state.currentVideo.id;
		const exists = state.saved.some((item) => item.id === id);

		if (exists) {
			state.saved = state.saved.filter((item) => item.id !== id);
		} else {
			state.saved = [
				{ ...state.currentVideo, savedAt: Date.now() },
				...state.saved,
			];
		}

		saveJson(STORAGE_KEYS.SAVED, state.saved);
		updatePlayerHeader(state.currentVideo);
		renderSidebar();
	}

	// --- Search Engine (YouTube API v3 -> Custom Instance -> Public Invidious/Piped Pool) ---
	async function searchVideos(query) {
		const trimmed = query.trim();
		if (!trimmed) return;

		hideBanner();
		recordRecentSearch(trimmed);
		el.submitBtn.disabled = true;
		el.submitBtn.textContent = "Searching...";
		el.resultsHeading.textContent = `Results for "${trimmed}"`;
		el.apiSourceBadge.textContent = "Querying...";

		try {
			// 1. Official YouTube Data API v3 if user supplied an API key
			if (state.settings.ytApiKey.trim()) {
				const results = await searchViaYouTubeApi(trimmed, state.settings.ytApiKey.trim());
				renderSearchResults(results, "YouTube API v3");
				return;
			}

			// 2. Build ordered list of nodes (custom instance first, then public pool)
			const nodes = [];
			const custom = state.settings.customInstance.trim().replace(/\/+$/, "");
			if (custom) {
				nodes.push({ type: "auto", base: custom });
			}
			nodes.push(...PUBLIC_SEARCH_NODES);

			let lastError = null;
			for (const node of nodes) {
				try {
					const results = await querySearchNode(node, trimmed);
					if (results && results.length > 0) {
						const host = new URL(node.base).hostname;
						renderSearchResults(results, host);
						return;
					}
				} catch (err) {
					lastError = err;
				}
			}

			throw lastError || new Error("No search instances responded.");
		} catch (err) {
			el.apiSourceBadge.textContent = "Search unavailable";
			showBanner(
				"Public search instances are currently busy or blocked. You can still paste any YouTube Video ID or URL directly above, or add a custom instance / YouTube API key in Settings.",
				true
			);
		} finally {
			el.submitBtn.disabled = false;
			el.submitBtn.textContent = "Search / Play";
		}
	}

	async function searchViaYouTubeApi(query, apiKey) {
		const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=16&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
		const res = await fetchWithTimeout(url, 6000);
		if (!res.ok) throw new Error(`YouTube API HTTP ${res.status}`);
		const data = await res.json();

		return (data.items || [])
			.filter((item) => item.id && item.id.videoId)
			.map((item) => ({
				id: item.id.videoId,
				title: decodeHtmlEntities(item.snippet.title),
				channel: item.snippet.channelTitle || "YouTube",
				thumbnail:
					(item.snippet.thumbnails &&
						(item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url)) ||
					getThumbnailUrl(item.id.videoId),
				duration: "",
				viewsText: "",
			}));
	}

	async function querySearchNode(node, query) {
		if (node.type === "invidious") {
			return await fetchInvidiousSearch(node.base, query);
		}
		if (node.type === "piped") {
			return await fetchPipedSearch(node.base, query);
		}
		// Auto-detect for custom user-configured instance
		try {
			return await fetchInvidiousSearch(node.base, query);
		} catch {
			return await fetchPipedSearch(node.base, query);
		}
	}

	async function fetchInvidiousSearch(baseUrl, query) {
		const url = `${baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
		const res = await fetchWithTimeout(url, 5500);
		if (!res.ok) throw new Error(`Invidious HTTP ${res.status}`);
		const items = await res.json();
		if (!Array.isArray(items)) throw new Error("Invalid Invidious payload");

		return items
			.filter((item) => item.type === "video" && item.videoId)
			.slice(0, 18)
			.map((item) => ({
				id: item.videoId,
				title: item.title || item.videoId,
				channel: item.author || "YouTube",
				thumbnail: getThumbnailUrl(item.videoId),
				duration: formatDuration(item.lengthSeconds),
				viewsText: item.viewCountText || "",
			}));
	}

	async function fetchPipedSearch(baseUrl, query) {
		const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&filter=videos`;
		const res = await fetchWithTimeout(url, 5500);
		if (!res.ok) throw new Error(`Piped HTTP ${res.status}`);
		const data = await res.json();
		const items = data.items || [];
		if (!Array.isArray(items)) throw new Error("Invalid Piped payload");

		return items
			.map((item) => {
				const vid = extractVideoId(item.url || "");
				if (!vid) return null;
				return {
					id: vid,
					title: item.title || vid,
					channel: item.uploaderName || "YouTube",
					thumbnail: item.thumbnail || getThumbnailUrl(vid),
					duration: formatDuration(item.duration),
					viewsText: item.views ? `${Number(item.views).toLocaleString()} views` : "",
				};
			})
			.filter(Boolean)
			.slice(0, 18);
	}

	async function fetchWithTimeout(url, timeoutMs) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, { signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
	}

	function decodeHtmlEntities(str) {
		const txt = document.createElement("textarea");
		txt.innerHTML = str || "";
		return txt.value;
	}

	// --- Rendering ---
	function renderSearchResults(results, sourceLabel) {
		state.searchResults = results;
		el.apiSourceBadge.textContent = sourceLabel;
		el.resultsGrid.innerHTML = "";

		if (!results.length) {
			el.resultsGrid.innerHTML = `<div class="empty-state"><p>No matching videos found.</p></div>`;
			return;
		}

		for (const video of results) {
			const card = document.createElement("article");
			card.className = "video-card";
			card.tabIndex = 0;

			const thumbWrap = document.createElement("div");
			thumbWrap.className = "thumb-wrap";

			const img = document.createElement("img");
			img.src = video.thumbnail || getThumbnailUrl(video.id);
			img.alt = video.title;
			img.loading = "lazy";
			thumbWrap.appendChild(img);

			if (video.duration) {
				const dur = document.createElement("span");
				dur.className = "duration-tag";
				dur.textContent = video.duration;
				thumbWrap.appendChild(dur);
			}

			const body = document.createElement("div");
			body.className = "card-body";

			const title = document.createElement("div");
			title.className = "card-title";
			title.textContent = video.title;

			const meta = document.createElement("div");
			meta.className = "card-meta";
			meta.textContent = [video.channel, video.viewsText].filter(Boolean).join(" • ");

			body.appendChild(title);
			body.appendChild(meta);
			card.appendChild(thumbWrap);
			card.appendChild(body);

			const openHandler = () => playVideo(video);
			card.addEventListener("click", openHandler);
			card.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					openHandler();
				}
			});

			el.resultsGrid.appendChild(card);
		}
	}

	function renderSidebar() {
		el.historyCount.textContent = String(state.history.length);
		el.savedCount.textContent = String(state.saved.length);

		el.tabHistory.classList.toggle("active", state.activeTab === "history");
		el.tabSaved.classList.toggle("active", state.activeTab === "saved");

		const sourceList = state.activeTab === "history" ? state.history : state.saved;
		const filterQuery = el.sidebarFilter.value.trim().toLowerCase();

		const filtered = filterQuery
			? sourceList.filter(
					(item) =>
						(item.title && item.title.toLowerCase().includes(filterQuery)) ||
						(item.channel && item.channel.toLowerCase().includes(filterQuery)) ||
						item.id.toLowerCase().includes(filterQuery)
			  )
			: sourceList;

		el.sidebarList.innerHTML = "";

		if (!filtered.length) {
			const empty = document.createElement("div");
			empty.className = "empty-state";
			empty.textContent =
				state.activeTab === "history"
					? "No locally saved watch history yet."
					: "No pinned videos yet.";
			el.sidebarList.appendChild(empty);
			return;
		}

		for (const item of filtered) {
			const row = document.createElement("div");
			row.className = "history-item";
			if (state.currentVideo && state.currentVideo.id === item.id) {
				row.classList.add("active");
			}

			const thumb = document.createElement("img");
			thumb.className = "history-thumb";
			thumb.src = item.thumbnail || getThumbnailUrl(item.id);
			thumb.alt = "";
			thumb.loading = "lazy";

			const info = document.createElement("div");
			info.className = "history-info";

			const title = document.createElement("div");
			title.className = "history-title";
			title.textContent = item.title || item.id;

			const sub = document.createElement("div");
			sub.className = "history-sub";
			const timeStr = formatRelativeTime(item.watchedAt || item.savedAt);
			sub.textContent = [item.channel, timeStr].filter(Boolean).join(" • ");

			info.appendChild(title);
			info.appendChild(sub);

			const removeBtn = document.createElement("button");
			removeBtn.type = "button";
			removeBtn.className = "history-remove";
			removeBtn.title = "Remove item";
			removeBtn.textContent = "×";
			removeBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				removeSidebarItem(item.id);
			});

			row.appendChild(thumb);
			row.appendChild(info);
			row.appendChild(removeBtn);

			row.addEventListener("click", () => playVideo(item));
			el.sidebarList.appendChild(row);
		}
	}

	function removeSidebarItem(videoId) {
		if (state.activeTab === "history") {
			state.history = state.history.filter((item) => item.id !== videoId);
			saveJson(STORAGE_KEYS.HISTORY, state.history);
		} else {
			state.saved = state.saved.filter((item) => item.id !== videoId);
			saveJson(STORAGE_KEYS.SAVED, state.saved);
			if (state.currentVideo && state.currentVideo.id === videoId) {
				updatePlayerHeader(state.currentVideo);
			}
		}
		renderSidebar();
	}

	function recordRecentSearch(term) {
		state.recentSearches = [
			term,
			...state.recentSearches.filter((q) => q.toLowerCase() !== term.toLowerCase()),
		].slice(0, MAX_RECENT_SEARCHES);
		saveJson(STORAGE_KEYS.SEARCHES, state.recentSearches);
		renderRecentSearches();
	}

	function renderRecentSearches() {
		if (!state.recentSearches.length) {
			el.recentSearchesBar.hidden = true;
			return;
		}
		el.recentSearchesBar.hidden = false;
		el.recentSearchesBar.innerHTML = "";

		for (const term of state.recentSearches) {
			const chip = document.createElement("button");
			chip.type = "button";
			chip.className = "chip-btn";
			chip.textContent = term;
			chip.addEventListener("click", () => {
				el.queryInput.value = term;
				el.clearInputBtn.hidden = false;
				searchVideos(term);
			});
			el.recentSearchesBar.appendChild(chip);
		}
	}

	function showBanner(text, isError = false) {
		el.statusBanner.textContent = text;
		el.statusBanner.classList.toggle("error", isError);
		el.statusBanner.hidden = false;
	}

	function hideBanner() {
		el.statusBanner.hidden = true;
	}

	// --- Backup & Import ---
	function buildBackupPayload() {
		return JSON.stringify(
			{
				app: "ViewTube-BrowOS",
				exportedAt: new Date().toISOString(),
				history: state.history,
				saved: state.saved,
				recentSearches: state.recentSearches,
			},
			null,
			2
		);
	}

	async function backupToBrowOSFiles() {
		const payload = buildBackupPayload();
		const filename = `viewtube-backup-${new Date().toISOString().slice(0, 10)}.json`;

		if (typeof BrowOS !== "undefined" && BrowOS.available && BrowOS.files) {
			try {
				await BrowOS.files.write(filename, payload);
				showBanner(`Saved ${filename} to BrowOS Files.`);
				await sendBrowOSNotification("ViewTube", `Exported ${filename} to Files.`);
				return;
			} catch {
				// Fallback to standard browser download if BrowOS.files is unavailable
			}
		}

		downloadJsonFile(filename, payload);
		showBanner(`Downloaded ${filename}.`);
	}

	function downloadJsonFile(filename, text) {
		const blob = new Blob([text], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	// --- Event Listeners ---
	el.searchForm.addEventListener("submit", (e) => {
		e.preventDefault();
		const raw = el.queryInput.value.trim();
		if (!raw) return;

		const directId = extractVideoId(raw);
		if (directId) {
			playVideo({ id: directId });
		} else {
			searchVideos(raw);
		}
	});

	el.queryInput.addEventListener("input", () => {
		el.clearInputBtn.hidden = el.queryInput.value.length === 0;
	});

	el.clearInputBtn.addEventListener("click", () => {
		el.queryInput.value = "";
		el.clearInputBtn.hidden = true;
		el.queryInput.focus();
	});

	el.homeBtn.addEventListener("click", () => {
		el.ytPlayer.src = "";
		el.playerSection.hidden = true;
		state.currentVideo = null;
		hideBanner();
		renderSidebar();
	});

	el.closePlayerBtn.addEventListener("click", () => {
		el.ytPlayer.src = "";
		el.playerSection.hidden = true;
		state.currentVideo = null;
		renderSidebar();
	});

	el.bookmarkBtn.addEventListener("click", toggleSaveCurrentVideo);

	el.copyLinkBtn.addEventListener("click", async () => {
		if (!state.currentVideo) return;
		const url = `https://www.youtube.com/watch?v=${state.currentVideo.id}`;
		try {
			await navigator.clipboard.writeText(url);
			el.copyLinkBtn.textContent = "Copied!";
			setTimeout(() => {
				el.copyLinkBtn.textContent = "Copy Link";
			}, 1500);
		} catch {
			showBanner(`Video URL: ${url}`);
		}
	});

	el.tabHistory.addEventListener("click", () => {
		state.activeTab = "history";
		renderSidebar();
	});

	el.tabSaved.addEventListener("click", () => {
		state.activeTab = "saved";
		renderSidebar();
	});

	el.sidebarFilter.addEventListener("input", renderSidebar);

	el.clearListBtn.addEventListener("click", () => {
		if (state.activeTab === "history") {
			state.history = [];
			saveJson(STORAGE_KEYS.HISTORY, []);
		} else {
			state.saved = [];
			saveJson(STORAGE_KEYS.SAVED, []);
			if (state.currentVideo) updatePlayerHeader(state.currentVideo);
		}
		renderSidebar();
	});

	el.exportFilesBtn.addEventListener("click", backupToBrowOSFiles);

	// Settings Modal
	el.settingsToggleBtn.addEventListener("click", () => {
		el.customInstanceInput.value = state.settings.customInstance;
		el.ytApiKeyInput.value = state.settings.ytApiKey;
		el.autoplayCheckbox.checked = Boolean(state.settings.autoplay);
		el.nocookieCheckbox.checked = Boolean(state.settings.nocookie);
		el.settingsModal.hidden = false;
	});

	el.closeSettingsBtn.addEventListener("click", () => {
		el.settingsModal.hidden = true;
	});

	el.settingsModal.addEventListener("click", (e) => {
		if (e.target === el.settingsModal) {
			el.settingsModal.hidden = true;
		}
	});

	el.saveSettingsBtn.addEventListener("click", () => {
		state.settings = {
			customInstance: el.customInstanceInput.value.trim(),
			ytApiKey: el.ytApiKeyInput.value.trim(),
			autoplay: el.autoplayCheckbox.checked,
			nocookie: el.nocookieCheckbox.checked,
		};
		saveJson(STORAGE_KEYS.SETTINGS, state.settings);
		el.settingsModal.hidden = true;
		showBanner("Settings saved locally.");
	});

	el.exportJsonDownloadBtn.addEventListener("click", () => {
		const filename = `viewtube-backup-${new Date().toISOString().slice(0, 10)}.json`;
		downloadJsonFile(filename, buildBackupPayload());
	});

	el.importJsonInput.addEventListener("change", (e) => {
		const file = e.target.files && e.target.files[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = () => {
			try {
				const parsed = JSON.parse(String(reader.result));
				if (Array.isArray(parsed.history)) {
					state.history = parsed.history.slice(0, MAX_HISTORY_ITEMS);
					saveJson(STORAGE_KEYS.HISTORY, state.history);
				}
				if (Array.isArray(parsed.saved)) {
					state.saved = parsed.saved;
					saveJson(STORAGE_KEYS.SAVED, state.saved);
				}
				if (Array.isArray(parsed.recentSearches)) {
					state.recentSearches = parsed.recentSearches.slice(0, MAX_RECENT_SEARCHES);
					saveJson(STORAGE_KEYS.SEARCHES, state.recentSearches);
				}
				renderSidebar();
				renderRecentSearches();
				el.settingsModal.hidden = true;
				showBanner("History and saved videos imported.");
			} catch {
				showBanner("Invalid JSON backup file.", true);
			}
		};
		reader.readAsText(file);
		e.target.value = "";
	});

	// Initial Render
	renderSidebar();
	renderRecentSearches();
})();
