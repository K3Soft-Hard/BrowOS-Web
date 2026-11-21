// Start

renderAppsPanel();
renderDesktop();
renderPins();

// Discover should show the third-party apps already listed in the catalog instead
// of an empty "coming soon" grid. Built-in apps stay in the BrowOS Apps tab.
if (typeof appsForTab === "function" && typeof renderStore === "function") {
	const catalogAppsForTab = appsForTab;

	appsForTab = function () {
		const activeTab = document.querySelector(".store-nav.active");

		if (activeTab && activeTab.dataset.tab === "discover") {
			return appCatalog.filter(function (app) {
				return !app.builtIn;
			});
		}

		return catalogAppsForTab();
	};

	renderStore();
}

// The window manager already uses Pointer Events for mouse, pen and touch.
// Disable browser panning only on title bars so a finger drag moves the window.
const touchWindowStyles = document.createElement("style");
touchWindowStyles.textContent = `
	.window-header {
		touch-action: none;
		-webkit-user-select: none;
		user-select: none;
	}

	.window-controls button {
		min-width: 46px;
		min-height: 46px;
	}
`;
document.head.appendChild(touchWindowStyles);
