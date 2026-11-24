// Startup sound

const startupSound = document.getElementById("startup-sound");

startupSound.volume = (localStorage.getItem("volume") || 70) / 100;

if (localStorage.getItem("startupSound") !== "off") {
	startupSound.play().catch(() => {});
}

// Settings

const settingsWindow = document.getElementById("settingsWindow");

// Settings pages

const settingsNavButtons = document.querySelectorAll(".settings-nav");

const settingsPages = document.querySelectorAll(".settings-page");

settingsNavButtons.forEach(function (button) {
	button.addEventListener("click", function () {
		settingsNavButtons.forEach(function (item) {
			item.classList.remove("active");
		});

		settingsPages.forEach(function (page) {
			page.classList.remove("show");
		});

		button.classList.add("active");

		document.getElementById(button.dataset.page).classList.add("show");
	});
});

// Wallpaper

const desktopShell = document.querySelector(".desktop-shell");

const wallpaperOptions = document.querySelectorAll(".wallpaper-option");

function setWallpaper(image) {
	desktopShell.style.backgroundImage = 'url("' + image + '")';

	wallpaperOptions.forEach(function (option) {
		option.classList.remove("selected");

		if (option.dataset.wallpaper === image) {
			option.classList.add("selected");
		}
	});
}

const savedWallpaper = localStorage.getItem("wallpaper") || "wallpapers/wallpaper.jpg";

if (savedWallpaper === "custom") {
	setWallpaper(localStorage.getItem("customWallpaper"));
} else {
	setWallpaper(savedWallpaper);
}

wallpaperOptions.forEach(function (option) {
	option.addEventListener("click", function () {
		setWallpaper(option.dataset.wallpaper);

		localStorage.setItem("wallpaper", option.dataset.wallpaper);
	});
});

// Upload wallpaper

const wallpaperUpload = document.getElementById("wallpaperUpload");

wallpaperUpload.addEventListener("change", function () {
	const file = wallpaperUpload.files[0];

	if (!file) {
		return;
	}

	const reader = new FileReader();

	reader.onload = function () {
		try {
			localStorage.setItem("customWallpaper", reader.result);

			localStorage.setItem("wallpaper", "custom");
		} catch (error) {
			alert("This image is too big, try a smaller one.");

			return;
		}

		setWallpaper(reader.result);

		showCustomTile();
	};

	reader.readAsDataURL(file);
});

// Boot animation

const bootToggle = document.getElementById("bootToggle");

bootToggle.checked = localStorage.getItem("bootAnimation") !== "off";

if (!bootToggle.checked) {
	document.querySelector(".boot-screen").style.display = "none";

	document.querySelector(".boot-input-shield").style.display = "none";

	desktopShell.style.animation = "none";

	desktopShell.style.maskImage = "none";
}

bootToggle.addEventListener("change", function () {
	localStorage.setItem("bootAnimation", bootToggle.checked ? "on" : "off");
});

// Startup sound settings

const soundToggle = document.getElementById("soundToggle");

const volumeSlider = document.getElementById("volumeSlider");

const volumeText = document.getElementById("volumeText");

const testSoundButton = document.getElementById("testSoundButton");

soundToggle.checked = localStorage.getItem("startupSound") !== "off";

volumeSlider.value = localStorage.getItem("volume") || 70;

volumeText.textContent = volumeSlider.value + "%";

soundToggle.addEventListener("change", function () {
	localStorage.setItem("startupSound", soundToggle.checked ? "on" : "off");
});

volumeSlider.addEventListener("input", function () {
	volumeText.textContent = volumeSlider.value + "%";

	startupSound.volume = volumeSlider.value / 100;

	localStorage.setItem("volume", volumeSlider.value);
});

testSoundButton.addEventListener("click", function () {
	startupSound.currentTime = 0;

	startupSound.play();
});

// Clock setting

const clockToggle = document.getElementById("clockToggle");

function updateClockVisibility() {
	let display = "none";

	if (clockToggle.checked) {
		display = "block";
	}

	document.getElementById("clock").style.display = display;

	document.getElementById("date").style.display = display;
}

clockToggle.checked = localStorage.getItem("showClock") === "on";

updateClockVisibility();

clockToggle.addEventListener("change", function () {
	localStorage.setItem("showClock", clockToggle.checked ? "on" : "off");

	updateClockVisibility();
});

// Window bar & buttons size (Personalization)

const windowBarSizeSelect = document.getElementById("windowBarSizeSelect");

const WINDOW_BAR_PRESETS = {
	compact: { bar: "34px", btn: "36px", btnFont: "15px", titleFont: "12px", icon: "16px" },
	normal: { bar: "46px", btn: "46px", btnFont: "18px", titleFont: "13px", icon: "20px" },
	large: { bar: "56px", btn: "56px", btnFont: "21px", titleFont: "14.5px", icon: "23px" },
	xlarge: { bar: "66px", btn: "66px", btnFont: "24px", titleFont: "16px", icon: "26px" },
};

function applyWindowBarSize(presetKey) {
	const preset = WINDOW_BAR_PRESETS[presetKey] || WINDOW_BAR_PRESETS.normal;
	let styleTag = document.getElementById("bosWindowBarOverride");
	if (!styleTag) {
		styleTag = document.createElement("style");
		styleTag.id = "bosWindowBarOverride";
		document.body.appendChild(styleTag);
	}
	styleTag.textContent = `
		.app-window .window-header {
			height: ${preset.bar} !important;
			min-height: ${preset.bar} !important;
		}
		.app-window .window-controls button {
			width: ${preset.btn} !important;
			height: 100% !important;
			font-size: ${preset.btnFont} !important;
		}
		.app-window .window-title {
			font-size: ${preset.titleFont} !important;
		}
		.app-window .window-title img {
			width: ${preset.icon} !important;
			height: ${preset.icon} !important;
		}
	`;
}

const savedWindowBarSize = localStorage.getItem("browos-window-bar-size") || "normal";
applyWindowBarSize(savedWindowBarSize);

if (windowBarSizeSelect) {
	windowBarSizeSelect.value = savedWindowBarSize;
	windowBarSizeSelect.addEventListener("change", function () {
		localStorage.setItem("browos-window-bar-size", windowBarSizeSelect.value);
		applyWindowBarSize(windowBarSizeSelect.value);
	});
}

// Taskbar scale (0.25x - 2.0x) + Reset to 1x

const taskbarScaleSlider = document.getElementById("taskbarScaleSlider");
const taskbarScaleText = document.getElementById("taskbarScaleText");
const taskbarScaleResetBtn = document.getElementById("taskbarScaleResetBtn");

function applyTaskbarScale(scaleVal) {
	const clamped = Math.min(2, Math.max(0.25, parseFloat(scaleVal) || 1));
	document.documentElement.style.setProperty("--taskbar-scale", String(clamped));
	if (taskbarScaleSlider) taskbarScaleSlider.value = String(clamped);
	if (taskbarScaleText) taskbarScaleText.textContent = clamped.toFixed(2).replace(/\.00$/, "") + "x";
	if (typeof syncAllMaximizedWindows === "function") {
		syncAllMaximizedWindows();
	}
}

const savedTaskbarScale = localStorage.getItem("browos-taskbar-scale") || "1";
applyTaskbarScale(savedTaskbarScale);

if (taskbarScaleSlider) {
	taskbarScaleSlider.addEventListener("input", function () {
		localStorage.setItem("browos-taskbar-scale", taskbarScaleSlider.value);
		applyTaskbarScale(taskbarScaleSlider.value);
	});
}

if (taskbarScaleResetBtn) {
	taskbarScaleResetBtn.addEventListener("click", function () {
		localStorage.setItem("browos-taskbar-scale", "1");
		applyTaskbarScale(1);
	});
}

// Taskbar glassy transparency override (separate from windows)

const taskbarGlassOverrideToggle = document.getElementById("taskbarGlassOverrideToggle");
const taskbarGlassRow = document.getElementById("taskbarGlassRow");
const taskbarGlassSlider = document.getElementById("taskbarGlassSlider");
const taskbarGlassText = document.getElementById("taskbarGlassText");

function applyTaskbarGlass(enabled, opacityPct) {
	const pct = Math.min(100, Math.max(0, parseInt(opacityPct, 10) || 0));
	if (taskbarGlassRow) {
		taskbarGlassRow.style.display = enabled ? "flex" : "none";
	}
	if (taskbarGlassText) {
		taskbarGlassText.textContent = pct + "%";
	}
	if (taskbarGlassSlider) {
		taskbarGlassSlider.value = String(pct);
	}

	let tag = document.getElementById("bosTaskbarGlassOverride");
	if (!enabled) {
		delete document.documentElement.dataset.taskbarGlassOverride;
		if (tag) tag.remove();
		return;
	}

	document.documentElement.dataset.taskbarGlassOverride = "1";
	if (!tag) {
		tag = document.createElement("style");
		tag.id = "bosTaskbarGlassOverride";
		document.body.appendChild(tag);
	}
	const alpha = (0.06 + (pct / 100) * 0.9).toFixed(2);
	const blurPx = Math.round(28 - (pct / 100) * 14);
	tag.textContent = `
		.taskbar,
		.taskbar-blur {
			background: rgba(18, 18, 24, ${alpha}) !important;
			backdrop-filter: blur(${blurPx}px) saturate(180%) !important;
			-webkit-backdrop-filter: blur(${blurPx}px) saturate(180%) !important;
			border-color: rgba(255, 255, 255, ${(0.12 + (1 - pct / 100) * 0.16).toFixed(2)}) !important;
		}
	`;
}

const savedTbGlassEnabled = localStorage.getItem("browos-taskbar-glass-override") === "on";
const savedTbGlassPct = localStorage.getItem("browos-taskbar-glass-pct") || "25";

if (taskbarGlassOverrideToggle) {
	taskbarGlassOverrideToggle.checked = savedTbGlassEnabled;
	taskbarGlassOverrideToggle.addEventListener("change", function () {
		const on = taskbarGlassOverrideToggle.checked;
		localStorage.setItem("browos-taskbar-glass-override", on ? "on" : "off");
		applyTaskbarGlass(on, taskbarGlassSlider ? taskbarGlassSlider.value : savedTbGlassPct);
	});
}

if (taskbarGlassSlider) {
	taskbarGlassSlider.addEventListener("input", function () {
		localStorage.setItem("browos-taskbar-glass-pct", taskbarGlassSlider.value);
		applyTaskbarGlass(taskbarGlassOverrideToggle ? taskbarGlassOverrideToggle.checked : true, taskbarGlassSlider.value);
	});
}

applyTaskbarGlass(savedTbGlassEnabled, savedTbGlassPct);

// Hideable taskbar icons (Start, Virtual Desktops, Clipboard, Notifications, Quick Settings)

const TASKBAR_ICON_TOGGLES = [
	{ id: "tbShowStartToggle", key: "browos-tb-show-start", attr: "tbHideStart" },
	{ id: "tbShowDesktopsToggle", key: "browos-tb-show-desktops", attr: "tbHideDesktops" },
	{ id: "tbShowClipboardToggle", key: "browos-tb-show-clipboard", attr: "tbHideClipboard" },
	{ id: "tbShowBellToggle", key: "browos-tb-show-bell", attr: "tbHideBell" },
	{ id: "tbShowQuickToggle", key: "browos-tb-show-quick", attr: "tbHideQuick" },
];

TASKBAR_ICON_TOGGLES.forEach(function (item) {
	const el = document.getElementById(item.id);
	const visible = localStorage.getItem(item.key) !== "off";
	if (visible) {
		delete document.documentElement.dataset[item.attr];
	} else {
		document.documentElement.dataset[item.attr] = "1";
	}
	if (el) {
		el.checked = visible;
		el.addEventListener("change", function () {
			const show = el.checked;
			localStorage.setItem(item.key, show ? "on" : "off");
			if (show) {
				delete document.documentElement.dataset[item.attr];
			} else {
				document.documentElement.dataset[item.attr] = "1";
			}
		});
	}
});

// Taskbar hide button & auto-hide controls (Taskbar settings)

const taskbarHideFeatureToggle = document.getElementById("taskbarHideFeatureToggle");
const taskbarHideButton = document.getElementById("taskbarHideButton");
const taskbarRestoreBox = document.getElementById("taskbarRestoreBox");

function setTaskbarHidden(hidden) {
	if (hidden) {
		document.documentElement.dataset.taskbarHidden = "1";
	} else {
		delete document.documentElement.dataset.taskbarHidden;
	}
	localStorage.setItem("browos-taskbar-hidden", hidden ? "1" : "0");
	if (typeof syncAllMaximizedWindows === "function") {
		syncAllMaximizedWindows();
	}
}

function applyTaskbarHideFeature(enabled) {
	if (enabled) {
		delete document.documentElement.dataset.taskbarHideDisabled;
	} else {
		document.documentElement.dataset.taskbarHideDisabled = "1";
		setTaskbarHidden(false);
	}
}

const taskbarHideFeatureEnabled = localStorage.getItem("browos-taskbar-hide-enabled") !== "off";
applyTaskbarHideFeature(taskbarHideFeatureEnabled);

if (taskbarHideFeatureEnabled && localStorage.getItem("browos-taskbar-hidden") === "1") {
	setTaskbarHidden(true);
}

if (taskbarHideFeatureToggle) {
	taskbarHideFeatureToggle.checked = taskbarHideFeatureEnabled;
	taskbarHideFeatureToggle.addEventListener("change", function () {
		const enabled = taskbarHideFeatureToggle.checked;
		localStorage.setItem("browos-taskbar-hide-enabled", enabled ? "on" : "off");
		applyTaskbarHideFeature(enabled);
	});
}

if (taskbarHideButton) {
	taskbarHideButton.addEventListener("click", function (event) {
		event.stopPropagation();
		setTaskbarHidden(true);
	});
}

if (taskbarRestoreBox) {
	taskbarRestoreBox.addEventListener("click", function (event) {
		event.stopPropagation();
		setTaskbarHidden(false);
	});
}

// Security / Privacy: Lock screen curtain background blur toggle

const lockBlurCurtainToggle = document.getElementById("lockBlurCurtainToggle");

function applyLockCurtainBlur(blurOn) {
	if (blurOn) {
		document.documentElement.dataset.lockCurtainBlur = "1";
	} else {
		delete document.documentElement.dataset.lockCurtainBlur;
	}
}

const savedLockCurtainBlur = localStorage.getItem("browos-lock-curtain-blur") === "on";
applyLockCurtainBlur(savedLockCurtainBlur);

if (lockBlurCurtainToggle) {
	lockBlurCurtainToggle.checked = savedLockCurtainBlur;
	lockBlurCurtainToggle.addEventListener("change", function () {
		const on = lockBlurCurtainToggle.checked;
		localStorage.setItem("browos-lock-curtain-blur", on ? "on" : "off");
		applyLockCurtainBlur(on);
	});
}

// Data page: Refresh updates (clear HTML/CSS/JS cache only) & Reset all data (wipe entire localStorage)

const refreshUpdatesButton = document.getElementById("refreshUpdatesButton");
const resetAllDataButton = document.getElementById("resetAllDataButton");

if (refreshUpdatesButton) {
	refreshUpdatesButton.addEventListener("click", async function () {
		if (!confirm("Are you sure you want to refresh updates? This will delete cached HTML, CSS, and JS files and reload BrowOS, keeping all your apps, notes, PIN, and settings.")) {
			return;
		}
		try {
			if ("serviceWorker" in navigator) {
				const regs = await navigator.serviceWorker.getRegistrations();
				await Promise.all(regs.map((r) => r.unregister()));
			}
			if ("caches" in window) {
				const keys = await caches.keys();
				await Promise.all(keys.map((k) => caches.delete(k)));
			}
		} catch (e) {}
		location.reload();
	});
}

if (resetAllDataButton) {
	resetAllDataButton.addEventListener("click", function () {
		if (!confirm("Are you sure you want to reset ALL data? This will completely erase all localStorage for this website (settings, PIN, notes, files, and installed apps) and start fresh.")) {
			return;
		}
		try {
			localStorage.clear();
			sessionStorage.clear();
		} catch (e) {}
		location.reload();
	});
}

// Reset settings

const resetSettingsButton = document.getElementById("resetSettingsButton");

resetSettingsButton.addEventListener("click", function () {
	if (!confirm("Reset all settings?")) {
		return;
	}

	localStorage.removeItem("wallpaper");
	localStorage.removeItem("customWallpaper");
	localStorage.removeItem("bootAnimation");
	localStorage.removeItem("startupSound");
	localStorage.removeItem("volume");
	localStorage.removeItem("showClock");
	localStorage.removeItem("browos-accent");
	localStorage.removeItem("browos-theme");
	localStorage.removeItem("browos-corners");
	localStorage.removeItem("browos-buttons");
	localStorage.removeItem("browos-transparency");
	localStorage.removeItem("browos-desktop-text-show");
	localStorage.removeItem("browos-desktop-text");
	localStorage.removeItem("browos-taskbar-auto");
	localStorage.removeItem("browos-taskbar-width");
	localStorage.removeItem("browos-taskbar-scale");
	localStorage.removeItem("browos-taskbar-glass-override");
	localStorage.removeItem("browos-taskbar-glass-pct");
	localStorage.removeItem("browos-tb-show-start");
	localStorage.removeItem("browos-tb-show-desktops");
	localStorage.removeItem("browos-tb-show-clipboard");
	localStorage.removeItem("browos-tb-show-bell");
	localStorage.removeItem("browos-tb-show-quick");
	localStorage.removeItem("browos-taskbar-hide-enabled");
	localStorage.removeItem("browos-taskbar-hidden");
	localStorage.removeItem("browos-window-bar-size");
	localStorage.removeItem("browos-lock-curtain-blur");
	localStorage.removeItem("browos-cursor");
	localStorage.removeItem("browos-custom-cursor");
	localStorage.removeItem("browos-cursor-size");
	localStorage.removeItem("browos-theme-pack");
	localStorage.removeItem("browos-ui-sounds");
	localStorage.removeItem("browos-dnd");
	localStorage.removeItem("browos-widgets");
	localStorage.removeItem("browos-hotkeys");
	localStorage.removeItem("browos-saver");
	localStorage.removeItem("browos-saver-minutes");
	localStorage.removeItem("browos-saver-type");
	localStorage.removeItem("browos-saver-lock");
	// the PIN and the lock settings, sticky notes, tasks and the Recycle Bin are not "settings": they stay

	location.reload();
});
