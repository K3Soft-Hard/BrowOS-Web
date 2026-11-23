// Maximize

function syncMaximizedGeometry(appWindow) {
	if (!appWindow || !appWindow.classList.contains("maximized")) {
		return;
	}

	const shell = document.querySelector(".desktop-shell");
	const taskbar = document.querySelector(".taskbar");
	const taskbarHidden = document.documentElement.dataset.taskbarHidden === "1";

	const shellWidth = shell ? shell.offsetWidth : window.innerWidth;
	const shellHeight = shell ? shell.offsetHeight : window.innerHeight;
	const taskbarSpace = !taskbarHidden && taskbar ? taskbar.offsetHeight + 12 : 0;

	appWindow.style.top = "0px";
	appWindow.style.left = "0px";
	appWindow.style.width = shellWidth + "px";
	appWindow.style.height = Math.max(240, shellHeight - taskbarSpace) + "px";
	appWindow.style.transform = "none";
}

function syncAllMaximizedWindows() {
	document.querySelectorAll(".app-window.maximized").forEach(syncMaximizedGeometry);
}

function toggleMaximize(appWindow) {
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
		header.addEventListener("dblclick", function (event) {
			if (event.target.closest(".window-controls, .window-tools")) {
				return;
			}
			toggleMaximize(appWindow);
		});
	}
}

document.querySelectorAll(".app-window").forEach(addMaximizeButton);

window.addEventListener("resize", syncAllMaximizedWindows);
window.addEventListener("orientationchange", function () {
	setTimeout(syncAllMaximizedWindows, 140);
});
document.addEventListener("fullscreenchange", function () {
	setTimeout(syncAllMaximizedWindows, 140);
});

new MutationObserver(syncAllMaximizedWindows).observe(document.documentElement, {
	attributes: true,
	attributeFilter: ["data-taskbar-hidden"],
});
