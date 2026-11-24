// Maximize & Triple-Tap True Fullscreen

function syncMaximizedGeometry(appWindow) {
	if (!appWindow) return;

	const shell = document.querySelector(".desktop-shell");
	const shellWidth = shell ? shell.offsetWidth : window.innerWidth;
	const shellHeight = shell ? shell.offsetHeight : window.innerHeight;

	if (appWindow.classList.contains("bos-true-fullscreen")) {
		appWindow.style.top = "0px";
		appWindow.style.left = "0px";
		appWindow.style.width = shellWidth + "px";
		appWindow.style.height = shellHeight + "px";
		appWindow.style.transform = "none";
		return;
	}

	if (!appWindow.classList.contains("maximized")) {
		return;
	}

	const taskbar = document.querySelector(".taskbar");
	const taskbarHidden = document.documentElement.dataset.taskbarHidden === "1";
	const tbScale = parseFloat(localStorage.getItem("browos-taskbar-scale") || "1") || 1;
	const taskbarSpace = !taskbarHidden && taskbar ? Math.round(taskbar.offsetHeight * tbScale) + 12 : 0;

	appWindow.style.top = "0px";
	appWindow.style.left = "0px";
	appWindow.style.width = shellWidth + "px";
	appWindow.style.height = Math.max(240, shellHeight - taskbarSpace) + "px";
	appWindow.style.transform = "none";
}

function syncAllMaximizedWindows() {
	document.querySelectorAll(".app-window.maximized, .app-window.bos-true-fullscreen").forEach(syncMaximizedGeometry);
}

function ensureFullscreenExitButton() {
	let btn = document.getElementById("bosExitWinFullscreenBtn");
	if (btn) return btn;

	btn = document.createElement("button");
	btn.id = "bosExitWinFullscreenBtn";
	btn.type = "button";
	btn.title = "Exit fullscreen";
	btn.setAttribute("aria-label", "Exit fullscreen");
	btn.innerHTML =
		'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
		'<polyline points="4 14 10 14 10 20"></polyline>' +
		'<polyline points="20 10 14 10 14 4"></polyline>' +
		'<line x1="14" y1="10" x2="21" y2="3"></line>' +
		'<line x1="3" y1="21" x2="10" y2="14"></line>' +
		"</svg>";

	btn.addEventListener("click", function (e) {
		e.stopPropagation();
		exitAllWindowFullscreens();
	});

	document.body.appendChild(btn);
	return btn;
}

function enterWindowFullscreen(appWindow) {
	if (!appWindow || appWindow.classList.contains("bos-true-fullscreen")) return;

	// Exit any other fullscreen window first
	exitAllWindowFullscreens();

	if (!appWindow.classList.contains("maximized")) {
		appWindow.dataset.fsPrevTop = appWindow.style.top || "";
		appWindow.dataset.fsPrevLeft = appWindow.style.left || "";
		appWindow.dataset.fsPrevWidth = appWindow.style.width || "";
		appWindow.dataset.fsPrevHeight = appWindow.style.height || "";
		appWindow.dataset.fsPrevTransform = appWindow.style.transform || "";
		appWindow.dataset.fsWasMaximized = "0";
	} else {
		appWindow.dataset.fsWasMaximized = "1";
	}

	appWindow.classList.add("bos-true-fullscreen");
	document.documentElement.dataset.windowFullscreen = "1";
	ensureFullscreenExitButton();
	syncMaximizedGeometry(appWindow);
}

function exitWindowFullscreen(appWindow) {
	if (!appWindow || !appWindow.classList.contains("bos-true-fullscreen")) return;

	appWindow.classList.remove("bos-true-fullscreen");
	delete document.documentElement.dataset.windowFullscreen;

	if (appWindow.dataset.fsWasMaximized === "1") {
		syncMaximizedGeometry(appWindow);
	} else {
		appWindow.style.top = appWindow.dataset.fsPrevTop || "";
		appWindow.style.left = appWindow.dataset.fsPrevLeft || "";
		appWindow.style.width = appWindow.dataset.fsPrevWidth || "";
		appWindow.style.height = appWindow.dataset.fsPrevHeight || "";
		appWindow.style.transform = appWindow.dataset.fsPrevTransform || "";
	}
}

function exitAllWindowFullscreens() {
	document.querySelectorAll(".app-window.bos-true-fullscreen").forEach(exitWindowFullscreen);
}

function toggleMaximize(appWindow) {
	if (appWindow.classList.contains("bos-true-fullscreen")) {
		exitWindowFullscreen(appWindow);
		return;
	}

	const maximizeButton = appWindow.querySelector(".window-maximize");

	if (appWindow.classList.contains("maximized")) {
		appWindow.classList.remove("maximized");
		if (maximizeButton) {
			maximizeButton.textContent = "□";
		}

		appWindow.style.top = appWindow.dataset.prevTop || "";
		appWindow.style.left = appWindow.dataset.prevLeft || "";
		appWindow.style.width = appWindow.dataset.prevWidth || "";
		appWindow.style.height = appWindow.dataset.prevHeight || "";
		appWindow.style.transform = appWindow.dataset.prevTransform || "";
	} else {
		appWindow.dataset.prevTop = appWindow.style.top || "";
		appWindow.dataset.prevLeft = appWindow.style.left || "";
		appWindow.dataset.prevWidth = appWindow.style.width || "";
		appWindow.dataset.prevHeight = appWindow.style.height || "";
		appWindow.dataset.prevTransform = appWindow.style.transform || "";

		appWindow.classList.add("maximized");
		if (maximizeButton) {
			maximizeButton.textContent = "❐";
		}

		syncMaximizedGeometry(appWindow);
	}
}

function addMaximizeButton(appWindow) {
	const controls = appWindow.querySelector(".window-controls");
	const closeButton = appWindow.querySelector(".window-close");

	if (!controls || !closeButton || appWindow.querySelector(".window-maximize")) {
		return;
	}

	const maximizeButton = document.createElement("button");
	maximizeButton.className = "window-maximize";
	maximizeButton.textContent = "□";

	controls.insertBefore(maximizeButton, closeButton);

	maximizeButton.addEventListener("click", function () {
		toggleMaximize(appWindow);
	});

	const header = appWindow.querySelector(".window-header");
	if (header) {
		let tapCount = 0;
		let tapTimer = null;

		header.addEventListener("pointerup", function (event) {
			if (event.target.closest(".window-controls, .window-tools")) {
				return;
			}
			if (event.pointerType === "mouse" && event.button !== 0) {
				return;
			}

			tapCount += 1;
			clearTimeout(tapTimer);

			if (tapCount >= 3) {
				tapCount = 0;
				enterWindowFullscreen(appWindow);
				return;
			}

			tapTimer = setTimeout(function () {
				tapCount = 0;
			}, 520);
		});

		header.addEventListener("dblclick", function (event) {
			if (event.target.closest(".window-controls, .window-tools")) {
				return;
			}
			// Delay slightly so a 3rd tap enters true fullscreen instead of maximizing
			setTimeout(function () {
				if (!appWindow.classList.contains("bos-true-fullscreen")) {
					toggleMaximize(appWindow);
				}
			}, 220);
		});
	}
}

document.querySelectorAll(".app-window").forEach(addMaximizeButton);

document.addEventListener("keydown", function (e) {
	if (e.key === "Escape" && document.documentElement.dataset.windowFullscreen === "1") {
		exitAllWindowFullscreens();
	}
});

window.addEventListener("resize", syncAllMaximizedWindows);
window.addEventListener("orientationchange", function () {
	setTimeout(syncAllMaximizedWindows, 140);
});
document.addEventListener("fullscreenchange", function () {
	setTimeout(syncAllMaximizedWindows, 140);
});

new MutationObserver(syncAllMaximizedWindows).observe(document.documentElement, {
	attributes: true,
	attributeFilter: ["data-taskbar-hidden", "data-window-fullscreen"],
});
