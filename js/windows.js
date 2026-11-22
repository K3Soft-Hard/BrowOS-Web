// Window manager

let highestWindowZ = 100;

function bringToFront(windowElement) {
	highestWindowZ++;

	windowElement.style.zIndex = highestWindowZ;
}

// Snapping
const SNAP_EDGE = 8;

function snapArea() {
	return { width: window.innerWidth, height: window.innerHeight - 90 };
}

function snapZoneAt(x, y) {
	if (y <= SNAP_EDGE) {
		return "max";
	}

	if (x <= SNAP_EDGE) {
		return "left";
	}

	if (x >= window.innerWidth - SNAP_EDGE) {
		return "right";
	}

	return null;
}

function snapRect(zone) {
	const area = snapArea();

	if (zone === "max") {
		return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
	}

	const half = Math.floor(area.width / 2);

	return {
		left: zone === "left" ? 0 : half,
		top: 0,
		width: half,
		height: area.height,
	};
}

let snapPreview = null;

function showSnapPreview(zone) {
	if (!snapPreview) {
		snapPreview = document.createElement("div");

		snapPreview.className = "snap-preview";
		snapPreview.style.pointerEvents = "none";

		const shell = document.querySelector(".desktop-shell");
		if (shell) {
			shell.appendChild(snapPreview);
		}
	}

	if (!zone) {
		snapPreview.classList.remove("show");

		return;
	}

	const rect = snapRect(zone);

	snapPreview.style.left = rect.left + "px";
	snapPreview.style.top = rect.top + "px";
	snapPreview.style.width = rect.width + "px";
	snapPreview.style.height = rect.height + "px";

	snapPreview.classList.add("show");
}

function setWindowRectImportant(win, left, top, width, height) {
	win.style.setProperty("transform", "none", "important");
	win.style.setProperty("translate", "none", "important");
	win.style.setProperty("margin", "0", "important");
	win.style.setProperty("right", "auto", "important");
	win.style.setProperty("bottom", "auto", "important");
	win.style.setProperty("position", "fixed", "important");

	if (left !== null && left !== undefined) {
		win.style.setProperty("left", Math.round(left) + "px", "important");
	}
	if (top !== null && top !== undefined) {
		win.style.setProperty("top", Math.round(top) + "px", "important");
	}
	if (width !== null && width !== undefined) {
		win.style.setProperty("width", Math.round(width) + "px", "important");
		win.style.setProperty("min-width", "240px", "important");
		win.style.setProperty("max-width", "100vw", "important");
	}
	if (height !== null && height !== undefined) {
		win.style.setProperty("height", Math.round(height) + "px", "important");
		win.style.setProperty("min-height", "180px", "important");
		win.style.setProperty("max-height", "100vh", "important");
	}
}

function makeWindowFloatingDefault(win) {
	win.classList.remove("maximized");
	delete win.dataset.snapped;
	delete win.dataset.beforeSnap;

	const isMobile = window.innerWidth <= 820;
	const targetW = isMobile
		? Math.max(260, Math.min(460, window.innerWidth - 28))
		: Math.min(820, window.innerWidth - 60);
	const targetH = isMobile
		? Math.max(240, Math.min(460, window.innerHeight - 130))
		: Math.min(580, window.innerHeight - 130);

	const left = Math.max(8, Math.round((window.innerWidth - targetW) / 2));
	const top = Math.max(12, Math.round((window.innerHeight - 90 - targetH) / 2));

	setWindowRectImportant(win, left, top, targetW, targetH);
}

function detachCentering(appWindow) {
	const rect = appWindow.getBoundingClientRect();
	setWindowRectImportant(appWindow, rect.left, rect.top, rect.width, rect.height);
	return appWindow.getBoundingClientRect();
}

function snapWindow(appWindow, zone) {
	if (zone === "restore") {
		unsnapWindow(appWindow);

		return;
	}

	if (zone === "max") {
		if (!appWindow.dataset.beforeSnap) {
			const r = appWindow.getBoundingClientRect();
			appWindow.dataset.beforeSnap = JSON.stringify({
				width: r.width + "px",
				height: r.height + "px",
			});
		}

		appWindow.classList.add("maximized");
		appWindow.dataset.snapped = "max";
		setWindowRectImportant(appWindow, 0, 0, window.innerWidth, window.innerHeight - 54);
		bringToFront(appWindow);
		return;
	}

	appWindow.classList.remove("maximized");

	if (!appWindow.dataset.snapped) {
		const r = appWindow.getBoundingClientRect();
		appWindow.dataset.beforeSnap = JSON.stringify({
			width: r.width + "px",
			height: r.height + "px",
		});
	}

	const rect = snapRect(zone);
	setWindowRectImportant(appWindow, rect.left, rect.top, rect.width, rect.height);
	appWindow.dataset.snapped = zone;

	bringToFront(appWindow);
}

function unsnapWindow(appWindow) {
	const wasMaximized = appWindow.classList.contains("maximized");
	appWindow.classList.remove("maximized");

	let targetW = null;
	let targetH = null;

	if (appWindow.dataset.snapped) {
		try {
			const before = JSON.parse(appWindow.dataset.beforeSnap);
			targetW = parseInt(before.width, 10) || null;
			targetH = parseInt(before.height, 10) || null;
		} catch (error) {}

		delete appWindow.dataset.snapped;
		delete appWindow.dataset.beforeSnap;
	}

	const currentRect = appWindow.getBoundingClientRect();
	if (!targetW || targetW >= window.innerWidth - 10) {
		targetW = window.innerWidth <= 820
			? Math.max(260, Math.min(460, window.innerWidth - 28))
			: Math.min(820, window.innerWidth - 60);
	}
	if (!targetH || targetH >= window.innerHeight - 80) {
		targetH = window.innerWidth <= 820
			? Math.max(240, Math.min(460, window.innerHeight - 130))
			: Math.min(580, window.innerHeight - 130);
	}

	if (wasMaximized || currentRect.width >= window.innerWidth - 10) {
		setWindowRectImportant(appWindow, currentRect.left, currentRect.top, targetW, targetH);
	}
}

// Fullscreen toggle (works both for the app/browser viewport and individual windows)
function isBrowserFullscreen() {
	return Boolean(
		document.fullscreenElement ||
		document.webkitFullscreenElement ||
		document.documentElement.classList.contains("browos-pseudo-fullscreen")
	);
}

function toggleBrowserFullscreen() {
	if (document.fullscreenElement || document.webkitFullscreenElement) {
		if (document.exitFullscreen) {
			document.exitFullscreen().catch(function () {});
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}
		document.documentElement.classList.remove("browos-pseudo-fullscreen");
		return;
	}

	if (document.documentElement.classList.contains("browos-pseudo-fullscreen")) {
		document.documentElement.classList.remove("browos-pseudo-fullscreen");
		return;
	}

	const el = document.documentElement;
	if (el.requestFullscreen) {
		el.requestFullscreen().catch(function () {
			el.classList.add("browos-pseudo-fullscreen");
		});
	} else if (el.webkitRequestFullscreen) {
		try {
			el.webkitRequestFullscreen();
		} catch (e) {
			el.classList.add("browos-pseudo-fullscreen");
		}
	} else {
		el.classList.add("browos-pseudo-fullscreen");
	}
}

function toggleWindowFullscreen(appWindow) {
	if (!appWindow) return;
	const isMax =
		appWindow.classList.contains("maximized") ||
		appWindow.getBoundingClientRect().width >= window.innerWidth - 8;

	if (isMax) {
		unsnapWindow(appWindow);
		const r = appWindow.getBoundingClientRect();
		const left = Math.max(8, Math.round((window.innerWidth - r.width) / 2));
		const top = Math.max(12, Math.round((window.innerHeight - 90 - r.height) / 2));
		setWindowRectImportant(appWindow, left, top, r.width, r.height);
	} else {
		snapWindow(appWindow, "max");
	}
}

// Long-press / Context menu with Fullscreen option (works on webpage AND installed PWA)
let fullscreenContextMenu = null;

function hideFullscreenContextMenu() {
	if (fullscreenContextMenu) {
		fullscreenContextMenu.remove();
		fullscreenContextMenu = null;
	}
}

function showFullscreenContextMenu(x, y, targetWindow) {
	hideFullscreenContextMenu();

	const menu = document.createElement("div");
	menu.className = "browos-fs-context-menu";
	menu.style.cssText = [
		"position: fixed",
		"z-index: 999999",
		"min-width: 190px",
		"background: rgba(24, 24, 30, 0.96)",
		"backdrop-filter: blur(14px)",
		"-webkit-backdrop-filter: blur(14px)",
		"border: 1px solid rgba(255, 255, 255, 0.14)",
		"border-radius: 12px",
		"padding: 6px",
		"box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5)",
		"color: #f4f4f6",
		"font-family: system-ui, -apple-system, sans-serif",
		"font-size: 14px",
		"user-select: none",
	].join(";");

	function addMenuRow(label, onClick) {
		const item = document.createElement("div");
		item.textContent = label;
		item.style.cssText = [
			"padding: 10px 12px",
			"border-radius: 8px",
			"cursor: pointer",
			"display: flex",
			"align-items: center",
			"justify-content: space-between",
		].join(";");

		item.addEventListener("pointerenter", function () {
			item.style.background = "rgba(255, 255, 255, 0.12)";
		});
		item.addEventListener("pointerleave", function () {
			item.style.background = "transparent";
		});
		item.addEventListener("click", function (e) {
			e.stopPropagation();
			hideFullscreenContextMenu();
			onClick();
		});

		menu.appendChild(item);
	}

	const appFsActive = isBrowserFullscreen();
	addMenuRow(
		appFsActive ? "Exit Fullscreen (App)" : "Fullscreen (App)",
		function () {
			toggleBrowserFullscreen();
		}
	);

	if (targetWindow) {
		const winMax =
			targetWindow.classList.contains("maximized") ||
			targetWindow.getBoundingClientRect().width >= window.innerWidth - 8;

		addMenuRow(
			winMax ? "Restore Window Size" : "Maximize Window",
			function () {
				toggleWindowFullscreen(targetWindow);
			}
		);
	}

	document.body.appendChild(menu);
	fullscreenContextMenu = menu;

	const menuRect = menu.getBoundingClientRect();
	const posX = Math.min(window.innerWidth - menuRect.width - 10, Math.max(10, x));
	const posY = Math.min(window.innerHeight - menuRect.height - 10, Math.max(10, y));
	menu.style.left = posX + "px";
	menu.style.top = posY + "px";
}

document.addEventListener("pointerdown", function (e) {
	if (fullscreenContextMenu && !fullscreenContextMenu.contains(e.target)) {
		hideFullscreenContextMenu();
	}
});

// Long-press on desktop / background (550ms) to open Fullscreen menu
(function setupGlobalLongPress() {
	let lpTimer = null;
	let lpStartX = 0;
	let lpStartY = 0;

	document.addEventListener(
		"touchstart",
		function (e) {
			if (e.touches.length !== 1) return;
			const t = e.touches[0];
			lpStartX = t.clientX;
			lpStartY = t.clientY;

			// Do not override app icons or inputs
			if (e.target.closest("input, textarea, button, .desktop-icon, .desktop-folder, .taskbar, .start-menu, .apps-panel")) {
				return;
			}

			const win = e.target.closest(".app-window, .explorer-window");

			clearTimeout(lpTimer);
			lpTimer = setTimeout(function () {
				showFullscreenContextMenu(lpStartX, lpStartY, win);
			}, 550);
		},
		{ passive: true }
	);

	document.addEventListener(
		"touchmove",
		function (e) {
			if (!lpTimer || e.touches.length === 0) return;
			const t = e.touches[0];
			if (Math.abs(t.clientX - lpStartX) > 10 || Math.abs(t.clientY - lpStartY) > 10) {
				clearTimeout(lpTimer);
				lpTimer = null;
			}
		},
		{ passive: true }
	);

	document.addEventListener("touchend", function () {
		clearTimeout(lpTimer);
		lpTimer = null;
	});

	document.addEventListener("touchcancel", function () {
		clearTimeout(lpTimer);
		lpTimer = null;
	});

	document.addEventListener("contextmenu", function (e) {
		if (e.target.closest(".window-header")) {
			e.preventDefault();
			const win = e.target.closest(".app-window, .explorer-window");
			showFullscreenContextMenu(e.clientX, e.clientY, win);
		}
	});
})();

function setupWindow(appWindow) {
	const header = appWindow.querySelector(".window-header");

	const closeButton = appWindow.querySelector(".window-close");

	const minimizeButton = appWindow.querySelector(".window-minimize");

	if (!header) {
		return;
	}

	// Ensure windows start non-fullscreen (floating) by default on mobile & PWA
	const observer = new MutationObserver(function () {
		const isVisible =
			appWindow.classList.contains("show") ||
			appWindow.classList.contains("open") ||
			(appWindow.style.display && appWindow.style.display !== "none");

		if (isVisible && !appWindow.dataset.initializedFloating) {
			appWindow.dataset.initializedFloating = "true";
			makeWindowFloatingDefault(appWindow);
		} else if (!isVisible) {
			delete appWindow.dataset.initializedFloating;
		}
	});
	observer.observe(appWindow, { attributes: true, attributeFilter: ["class", "style"] });

	header.style.touchAction = "none";
	header.style.userSelect = "none";
	header.style.webkitUserSelect = "none";

	let dragging = false;
	let offsetX = 0;
	let offsetY = 0;
	let snapZone = null;
	let startX = 0;
	let startY = 0;
	let needsUnmaximize = false;

	appWindow.addEventListener("pointerdown", function () {
		bringToFront(appWindow);
	});

	if (closeButton) {
		closeButton.addEventListener("click", function () {
			closeApp(appWindow);
		});
	}

	if (minimizeButton) {
		minimizeButton.addEventListener("click", function () {
			minimizeApp(appWindow);
		});
	}

	function beginDrag(clientX, clientY, target) {
		if (target && target.closest(".window-controls, .window-tools, button")) {
			return false;
		}

		dragging = true;
		startX = clientX;
		startY = clientY;

		bringToFront(appWindow);

		const rect = appWindow.getBoundingClientRect();
		const isFullWidth = rect.width >= window.innerWidth - 8;

		needsUnmaximize =
			appWindow.classList.contains("maximized") ||
			Boolean(appWindow.dataset.snapped) ||
			isFullWidth;

		if (!needsUnmaximize) {
			const cleanRect = detachCentering(appWindow);
			offsetX = clientX - cleanRect.left;
			offsetY = clientY - cleanRect.top;
		} else {
			offsetX = clientX - rect.left;
			offsetY = clientY - rect.top;
		}

		appWindow.querySelectorAll("iframe").forEach(function (frame) {
			frame.style.pointerEvents = "none";
		});

		return true;
	}

	function moveDrag(clientX, clientY) {
		if (!dragging) {
			return;
		}

		if (Math.abs(clientX - startX) > 6 || Math.abs(clientY - startY) > 6) {
			hideFullscreenContextMenu();
		}

		if (needsUnmaximize) {
			if (Math.abs(clientX - startX) < 6 && Math.abs(clientY - startY) < 6) {
				return;
			}

			needsUnmaximize = false;

			unsnapWindow(appWindow);

			const widthNow = appWindow.getBoundingClientRect().width;
			offsetX = Math.round(widthNow / 2);
			offsetY = 20;
		}

		const maxLeft = Math.max(0, window.innerWidth - 60);
		const maxTop = Math.max(0, window.innerHeight - 90);

		const nextLeft = Math.min(maxLeft, Math.max(-appWindow.offsetWidth + 60, clientX - offsetX));
		const nextTop = Math.min(maxTop, Math.max(0, clientY - offsetY));

		setWindowRectImportant(appWindow, nextLeft, nextTop, null, null);

		snapZone = snapZoneAt(clientX, clientY);
		showSnapPreview(snapZone);
	}

	function finishDrag(cancelled) {
		if (!dragging) {
			return;
		}

		dragging = false;
		needsUnmaximize = false;
		showSnapPreview(null);

		appWindow.querySelectorAll("iframe").forEach(function (frame) {
			frame.style.pointerEvents = "";
		});

		if (snapZone && !cancelled) {
			snapWindow(appWindow, snapZone);
		}

		snapZone = null;
	}

	// Mouse / Pen events
	header.addEventListener("pointerdown", function (event) {
		if (event.pointerType === "touch") return;
		if (event.button !== undefined && event.button !== 0) return;

		if (beginDrag(event.clientX, event.clientY, event.target)) {
			try {
				header.setPointerCapture(event.pointerId);
			} catch (e) {}
		}
	});

	window.addEventListener("pointermove", function (event) {
		if (event.pointerType === "touch" || !dragging) return;
		moveDrag(event.clientX, event.clientY);
	});

	window.addEventListener("pointerup", function (event) {
		if (event.pointerType === "touch" || !dragging) return;
		finishDrag(false);
	});

	window.addEventListener("pointercancel", function (event) {
		if (event.pointerType === "touch" || !dragging) return;
		finishDrag(true);
	});

	// Touch events (Android PWA & mobile)
	header.addEventListener(
		"touchstart",
		function (event) {
			if (event.touches.length !== 1) return;
			const touch = event.touches[0];
			if (beginDrag(touch.clientX, touch.clientY, event.target)) {
				event.preventDefault();
			}
		},
		{ passive: false }
	);

	window.addEventListener(
		"touchmove",
		function (event) {
			if (!dragging || event.touches.length === 0) return;
			event.preventDefault();
			const touch = event.touches[0];
			moveDrag(touch.clientX, touch.clientY);
		},
		{ passive: false }
	);

	window.addEventListener("touchend", function () {
		if (!dragging) return;
		finishDrag(false);
	});

	window.addEventListener("touchcancel", function () {
		if (!dragging) return;
		finishDrag(true);
	});
}

document.querySelectorAll(".app-window").forEach(setupWindow);

// Resizable windows

function makeResizable(windowElement) {
	const directions = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

	directions.forEach(function (direction) {
		const handle = document.createElement("div");

		handle.className = "resize-handle " + direction;
		handle.style.touchAction = "none";

		windowElement.appendChild(handle);

		function startResizeAt(clientX, clientY) {
			const rect = detachCentering(windowElement);

			delete windowElement.dataset.snapped;
			delete windowElement.dataset.beforeSnap;

			windowElement.querySelectorAll("iframe").forEach(function (frame) {
				frame.style.pointerEvents = "none";
			});

			const startWidth = rect.width;
			const startHeight = rect.height;
			const startLeft = rect.left;
			const startTop = rect.top;
			const minWidth = Math.min(260, window.innerWidth - 20);
			const minHeight = 180;

			function applyResize(curX, curY) {
				const deltaX = curX - clientX;
				const deltaY = curY - clientY;

				let newWidth = startWidth;
				let newHeight = startHeight;
				let newLeft = startLeft;
				let newTop = startTop;

				if (direction.includes("e")) {
					newWidth = Math.max(minWidth, startWidth + deltaX);
				}
				if (direction.includes("w")) {
					newWidth = Math.max(minWidth, startWidth - deltaX);
					newLeft = startLeft + (startWidth - newWidth);
				}
				if (direction.includes("s")) {
					newHeight = Math.max(minHeight, startHeight + deltaY);
				}
				if (direction.includes("n")) {
					newHeight = Math.max(minHeight, startHeight - deltaY);
					newTop = startTop + (startHeight - newHeight);
				}

				setWindowRectImportant(windowElement, newLeft, newTop, newWidth, newHeight);
			}

			function onMouseMove(e) {
				if (e.pointerType === "touch") return;
				applyResize(e.clientX, e.clientY);
			}

			function onTouchMove(e) {
				if (e.touches.length === 0) return;
				e.preventDefault();
				applyResize(e.touches[0].clientX, e.touches[0].clientY);
			}

			function endResize() {
				windowElement.querySelectorAll("iframe").forEach(function (frame) {
					frame.style.pointerEvents = "";
				});
				window.removeEventListener("pointermove", onMouseMove);
				window.removeEventListener("pointerup", endResize);
				window.removeEventListener("pointercancel", endResize);
				window.removeEventListener("touchmove", onTouchMove);
				window.removeEventListener("touchend", endResize);
				window.removeEventListener("touchcancel", endResize);
			}

			window.addEventListener("pointermove", onMouseMove);
			window.addEventListener("pointerup", endResize);
			window.addEventListener("pointercancel", endResize);
			window.addEventListener("touchmove", onTouchMove, { passive: false });
			window.addEventListener("touchend", endResize);
			window.addEventListener("touchcancel", endResize);
		}

		handle.addEventListener("pointerdown", function (event) {
			if (event.pointerType === "touch") return;
			event.preventDefault();
			event.stopPropagation();
			startResizeAt(event.clientX, event.clientY);
		});

		handle.addEventListener(
			"touchstart",
			function (event) {
				if (event.touches.length !== 1) return;
				event.preventDefault();
				event.stopPropagation();
				startResizeAt(event.touches[0].clientX, event.touches[0].clientY);
			},
			{ passive: false }
		);
	});
}

document.querySelectorAll(".app-window, .explorer-window").forEach(function (windowElement) {
	makeResizable(windowElement);
});
