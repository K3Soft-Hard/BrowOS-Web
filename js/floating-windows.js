// Floating windows

const hasChromeWindows =
	typeof chrome !== "undefined" &&
	chrome.windows &&
	typeof chrome.windows.getCurrent === "function";

const floatingWindows = {};
const minimizedWithBrowOS = [];

let mainWindowId = null;
let lastMainBounds = null;

function floatingAppId(windowId) {
	return Object.keys(floatingWindows).find(function (appId) {
		return floatingWindows[appId] === windowId;
	});
}

async function browosArea() {
	const main = await chrome.windows.getCurrent();

	const border = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));

	return {
		left: main.left + border,
		top: main.top + (window.outerHeight - window.innerHeight) - border,
		width: window.innerWidth,
		height: window.innerHeight - 90,
	};
}

function fitInArea(bounds, area) {
	const width = Math.min(bounds.width, area.width);

	const height = Math.min(bounds.height, area.height);

	return {
		left: Math.round(
			Math.min(Math.max(bounds.left, area.left), area.left + area.width - width)
		),
		top: Math.round(Math.min(Math.max(bounds.top, area.top), area.top + area.height - height)),
		width: Math.round(width),
		height: Math.round(height),
	};
}

function setFloatingButton(appId, open) {
	const app = getApp(appId);

	if (!app) {
		return;
	}

	let button = getTaskbarButton(appId);

	if (open) {
		button = button || createTaskbarButton(getAppWindow(app));

		button.classList.add("active");
	} else if (button && isPinned(appId)) {
		button.classList.remove("active");
	} else if (button) {
		button.remove();
	}
}

async function openFloatingWindow(app) {
	if (!hasChromeWindows) {
		if (app && app.url) {
			openInBrowserTab(app.url);
		}
		return;
	}

	if (floatingWindows[app.id]) {
		try {
			await chrome.windows.update(floatingWindows[app.id], {
				state: "normal",
				focused: true,
			});

			return;
		} catch (error) {
			delete floatingWindows[app.id];
		}
	}

	const area = await browosArea();

	const width = Math.min(1200, area.width - 60);

	const height = Math.min(800, area.height - 40);

	const created = await chrome.windows.create({
		url: app.url,
		type: "popup",
		left: Math.round(area.left + (area.width - width) / 2),
		top: Math.round(area.top + 20),
		width: Math.round(width),
		height: Math.round(height),
		focused: true,
	});

	floatingWindows[app.id] = created.id;
	setFloatingButton(app.id, true);
}

function closeFloatingWindow(appId) {
	if (!hasChromeWindows) {
		return;
	}

	if (floatingWindows[appId]) {
		chrome.windows.remove(floatingWindows[appId]).catch(function () {});
	}
}

const snapTimers = {};
const ignoreBoundsUntil = {};

const snapTolerance = 16;

async function keepInside(windowId) {
	if (!hasChromeWindows) {
		return;
	}

	let floating;

	try {
		floating = await chrome.windows.get(windowId);
	} catch (error) {
		return;
	}

	if (floating.state === "minimized") {
		return;
	}

	const area = await browosArea();

	if (floating.state === "maximized" || floating.state === "fullscreen") {
		ignoreBoundsUntil[windowId] = Date.now() + 800;

		chrome.windows
			.update(windowId, Object.assign({ state: "normal" }, area))
			.catch(function () {});

		return;
	}

	const fitted = fitInArea(floating, area);

	const outside =
		Math.abs(fitted.left - floating.left) > snapTolerance ||
		Math.abs(fitted.top - floating.top) > snapTolerance;

	const tooBig =
		floating.width > area.width + snapTolerance ||
		floating.height > area.height + snapTolerance;

	if (!outside && !tooBig) {
		return;
	}

	const update = {
		left: fitted.left,
		top: fitted.top,
	};

	if (tooBig) {
		update.width = fitted.width;
		update.height = fitted.height;
	}

	ignoreBoundsUntil[windowId] = Date.now() + 800;

	chrome.windows.update(windowId, update).catch(function () {});
}

if (hasChromeWindows) {
	chrome.windows.onBoundsChanged.addListener(async function (changed) {
		if (changed.id === mainWindowId) {
			const dx = lastMainBounds ? changed.left - lastMainBounds.left : 0;
			const dy = lastMainBounds ? changed.top - lastMainBounds.top : 0;

			lastMainBounds = {
				left: changed.left,
				top: changed.top,
			};

			if (dx === 0 && dy === 0) {
				return;
			}

			for (const windowId of Object.values(floatingWindows)) {
				try {
					const floating = await chrome.windows.get(windowId);

					if (floating.state !== "normal") {
						continue;
					}

					ignoreBoundsUntil[windowId] = Date.now() + 800;

					await chrome.windows.update(windowId, {
						left: floating.left + dx,
						top: floating.top + dy,
					});
				} catch (error) {
					// the window was closed
				}
			}

			return;
		}

		if (!floatingAppId(changed.id)) {
			return;
		}

		if (Date.now() < (ignoreBoundsUntil[changed.id] || 0)) {
			return;
		}

		clearTimeout(snapTimers[changed.id]);

		snapTimers[changed.id] = setTimeout(function () {
			keepInside(changed.id);
		}, 150);
	});

	const lastSeenBounds = {};

	setInterval(async function () {
		if (Object.keys(floatingWindows).length === 0 || mainWindowId === null) {
			return;
		}

		let main;

		try {
			main = await chrome.windows.get(mainWindowId);
		} catch (error) {
			return;
		}

		for (const windowId of Object.values(floatingWindows)) {
			let floating;

			try {
				floating = await chrome.windows.get(windowId);
			} catch (error) {
				continue;
			}

			const floatingButton = getTaskbarButton(floatingAppId(windowId));

			if (floatingButton) {
				floatingButton.classList.toggle("active", floating.state !== "minimized");
			}

			if (main.state === "minimized") {
				if (floating.state !== "minimized") {
					minimizedWithBrowOS.push(windowId);

					chrome.windows.update(windowId, { state: "minimized" }).catch(function () {});
				}

				continue;
			}

			if (minimizedWithBrowOS.includes(windowId)) {
				minimizedWithBrowOS.splice(minimizedWithBrowOS.indexOf(windowId), 1);

				chrome.windows.update(windowId, { state: "normal" }).catch(function () {});

				continue;
			}

			const bounds = [
				floating.left,
				floating.top,
				floating.width,
				floating.height,
				floating.state,
			].join(",");

			if (lastSeenBounds[windowId] === bounds) {
				keepInside(windowId);
			}

			lastSeenBounds[windowId] = bounds;
		}
	}, 250);

	if (chrome.windows.onRemoved) {
		chrome.windows.onRemoved.addListener(function (windowId) {
			const appId = floatingAppId(windowId);

			if (appId) {
				delete floatingWindows[appId];
				setFloatingButton(appId, false);
			}
		});
	}

	document.addEventListener("visibilitychange", function () {
		if (document.hidden) {
			Object.values(floatingWindows).forEach(function (windowId) {
				chrome.windows
					.get(windowId)
					.then(function (floating) {
						if (floating.state !== "minimized") {
							minimizedWithBrowOS.push(windowId);

							chrome.windows.update(windowId, { state: "minimized" });
						}
					})
					.catch(function () {});
			});
		} else {
			minimizedWithBrowOS.splice(0).forEach(function (windowId) {
				chrome.windows.update(windowId, { state: "normal" }).catch(function () {});
			});
		}
	});

	window.addEventListener("pagehide", function () {
		Object.values(floatingWindows).forEach(function (windowId) {
			chrome.windows.remove(windowId).catch(function () {});
		});
	});

	chrome.windows.getCurrent().then(function (main) {
		mainWindowId = main.id;

		lastMainBounds = {
			left: main.left,
			top: main.top,
		};
	});
}
