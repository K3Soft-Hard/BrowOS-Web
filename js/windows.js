// Window manager

let highestWindowZ = 100;

function bringToFront(windowElement) {
	highestWindowZ++;

	windowElement.style.zIndex = highestWindowZ;
}

// Helper for virtual desktop zoom scale in index.html
function getZoomScale() {
	const z = parseFloat(document.documentElement.style.zoom);
	return z && z > 0 ? z : 1;
}

function getLogicalViewport() {
	const scale = getZoomScale();
	return {
		width: Math.round(window.innerWidth / scale),
		height: Math.round(window.innerHeight / scale),
	};
}

// Snapping
const SNAP_EDGE = 8;

function snapArea() {
	const vp = getLogicalViewport();
	return { width: vp.width, height: vp.height - 90 };
}

function snapZoneAt(logicalX, logicalY) {
	const vp = getLogicalViewport();

	if (logicalY <= SNAP_EDGE) {
		return "max";
	}

	if (logicalX <= SNAP_EDGE) {
		return "left";
	}

	if (logicalX >= vp.width - SNAP_EDGE) {
		return "right";
	}

	return null;
}

function snapRect(zone) {
	const vp = getLogicalViewport();
	const area = snapArea();

	if (zone === "max") {
		return { left: 0, top: 0, width: vp.width, height: vp.height };
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

function snapWindow(appWindow, zone) {
	if (zone === "restore") {
		unsnapWindow(appWindow);

		return;
	}

	if (zone === "max") {
		unsnapWindow(appWindow);

		if (!appWindow.classList.contains("maximized")) {
			toggleMaximize(appWindow);
		}

		return;
	}

	if (appWindow.classList.contains("maximized")) {
		toggleMaximize(appWindow);
	}

	if (!appWindow.dataset.snapped) {
		appWindow.dataset.beforeSnap = JSON.stringify({
			width: appWindow.style.width,
			height: appWindow.style.height,
		});
	}

	const rect = snapRect(zone);

	appWindow.style.transform = "none";
	appWindow.style.translate = "none";
	appWindow.style.margin = "0";
	appWindow.style.left = rect.left + "px";
	appWindow.style.top = rect.top + "px";
	appWindow.style.width = rect.width + "px";
	appWindow.style.height = rect.height + "px";

	appWindow.dataset.snapped = zone;

	bringToFront(appWindow);
}

function unsnapWindow(appWindow) {
	if (appWindow.classList.contains("maximized")) {
		toggleMaximize(appWindow);
	}

	if (!appWindow.dataset.snapped) {
		return;
	}

	try {
		const before = JSON.parse(appWindow.dataset.beforeSnap);

		appWindow.style.width = before.width;
		appWindow.style.height = before.height;
	} catch (error) {
		appWindow.style.width = "";
		appWindow.style.height = "";
	}

	delete appWindow.dataset.snapped;
	delete appWindow.dataset.beforeSnap;
}

// Fullscreen toggle integrated into #desktopMenu
function toggleAppFullscreen() {
	if (document.fullscreenElement || document.webkitFullscreenElement) {
		if (document.exitFullscreen) {
			document.exitFullscreen().catch(function () {});
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}
	} else {
		const el = document.documentElement;
		if (el.requestFullscreen) {
			el.requestFullscreen({ navigationUI: "hide" }).catch(function () {});
		} else if (el.webkitRequestFullscreen) {
			el.webkitRequestFullscreen();
		}
	}
}

function updateDesktopFullscreenLabel() {
	const item = document.querySelector('#desktopMenu [data-action="fullscreen"]');
	if (!item) return;
	const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
	item.textContent = isFs ? "Exit fullscreen" : "Fullscreen";
}

document.addEventListener("fullscreenchange", updateDesktopFullscreenLabel);
document.addEventListener("webkitfullscreenchange", updateDesktopFullscreenLabel);

document.addEventListener("click", function (event) {
	const fsItem = event.target.closest('#desktopMenu [data-action="fullscreen"]');
	if (!fsItem) return;

	const desktopMenu = document.getElementById("desktopMenu");
	if (desktopMenu) {
		desktopMenu.classList.remove("show");
	}
	toggleAppFullscreen();
});

function setupWindow(appWindow) {
	const header = appWindow.querySelector(".window-header");

	const closeButton = appWindow.querySelector(".window-close");

	const minimizeButton = appWindow.querySelector(".window-minimize");

	if (!header) {
		return;
	}

	header.style.touchAction = "none";
	header.style.userSelect = "none";
	header.style.webkitUserSelect = "none";

	let dragging = false;
	let offsetX = 0;
	let offsetY = 0;
	let snapZone = null;
	let startX = 0;
	let startY = 0;

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

		const scale = getZoomScale();
		const lx = clientX / scale;
		const ly = clientY / scale;

		dragging = true;
		startX = lx;
		startY = ly;

		bringToFront(appWindow);

		const rect = appWindow.getBoundingClientRect();
		const winLeft = rect.left / scale;
		const winTop = rect.top / scale;

		offsetX = lx - winLeft;
		offsetY = ly - winTop;

		appWindow.style.transform = "none";
		appWindow.style.translate = "none";
		appWindow.style.margin = "0";
		appWindow.style.left = winLeft + "px";
		appWindow.style.top = winTop + "px";

		appWindow.querySelectorAll("iframe").forEach(function (frame) {
			frame.style.pointerEvents = "none";
		});

		return true;
	}

	function moveDrag(clientX, clientY) {
		if (!dragging) {
			return;
		}

		const scale = getZoomScale();
		const lx = clientX / scale;
		const ly = clientY / scale;
		const vp = getLogicalViewport();

		const wasMaximized = appWindow.classList.contains("maximized");

		if (wasMaximized || appWindow.dataset.snapped) {
			if (Math.abs(lx - startX) < 6 && Math.abs(ly - startY) < 6) {
				return;
			}

			const widthBefore = appWindow.getBoundingClientRect().width / scale;
			const grabbedAt = widthBefore > 0 ? offsetX / widthBefore : 0.5;

			unsnapWindow(appWindow);

			const widthNow = appWindow.getBoundingClientRect().width / scale;
			offsetX = Math.max(30, Math.min(widthNow - 30, grabbedAt * widthNow));
		}

		const winWidth = appWindow.offsetWidth || 300;
		const maxLeft = Math.max(0, vp.width - 60);
		const maxTop = Math.max(0, vp.height - 90);

		const nextLeft = Math.min(maxLeft, Math.max(-winWidth + 60, lx - offsetX));
		const nextTop = Math.min(maxTop, Math.max(0, ly - offsetY));

		appWindow.style.left = nextLeft + "px";
		appWindow.style.top = nextTop + "px";

		snapZone = snapZoneAt(lx, ly);
		showSnapPreview(snapZone);
	}

	function finishDrag(cancelled) {
		if (!dragging) {
			return;
		}

		dragging = false;
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
			const scale = getZoomScale();
			const rect = windowElement.getBoundingClientRect();

			delete windowElement.dataset.snapped;
			delete windowElement.dataset.beforeSnap;

			const startLeft = rect.left / scale;
			const startTop = rect.top / scale;
			const startWidth = rect.width / scale;
			const startHeight = rect.height / scale;

			windowElement.style.transform = "none";
			windowElement.style.translate = "none";
			windowElement.style.margin = "0";
			windowElement.style.left = startLeft + "px";
			windowElement.style.top = startTop + "px";

			windowElement.querySelectorAll("iframe").forEach(function (frame) {
				frame.style.pointerEvents = "none";
			});

			const startX = clientX / scale;
			const startY = clientY / scale;
			const minWidth = 320;
			const minHeight = 220;

			function applyResize(curClientX, curClientY) {
				const deltaX = curClientX / scale - startX;
				const deltaY = curClientY / scale - startY;

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

				windowElement.style.width = newWidth + "px";
				windowElement.style.height = newHeight + "px";
				windowElement.style.left = newLeft + "px";
				windowElement.style.top = newTop + "px";
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
