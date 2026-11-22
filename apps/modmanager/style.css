<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>BrowOS Root &amp; Mod Manager</title>
	<link rel="stylesheet" href="style.css">
	<script src="../../sdk/browos-sdk.js"></script>
</head>
<body>
	<div class="app">
		<header class="topbar">
			<div class="brand">
				<div class="status-dot" id="statusDot"></div>
				<div>
					<h1>Root &amp; Mod Manager</h1>
					<p id="statusText">Checking PWA Offline Cache…</p>
				</div>
			</div>

			<div class="top-actions">
				<button class="btn secondary" id="backupFilesBtn" title="Save mods to BrowOS Files">Sync Files</button>
				<button class="btn danger" id="unrootBtn" disabled>Unroot</button>
				<button class="btn primary" id="applyBtn">Patch &amp; Reboot</button>
			</div>
		</header>

		<div class="banner" id="banner" hidden></div>

		<main class="workspace">
			<!-- Left: Installed Mods -->
			<aside class="sidebar">
				<div class="sidebar-header">
					<span>Modules</span>
					<button class="btn small primary" id="newModBtn">+ New</button>
				</div>
				<div class="mod-list" id="modList"></div>

				<div class="sidebar-footer">
					<div class="info-line"><span>PWA Cache:</span> <strong id="cacheName">—</strong></div>
					<div class="info-line"><span>SDK Bridge:</span> <strong id="sdkStatus">—</strong></div>
					<div class="info-line"><span>Safe Mode:</span> <code>?safemode=1</code></div>
				</div>
			</aside>

			<!-- Right: Mod Editor -->
			<section class="editor-panel" id="editorPanel">
				<div class="editor-header">
					<input type="text" id="modNameInput" placeholder="Module name" spellcheck="false">
					<label class="toggle">
						<input type="checkbox" id="modEnabledInput">
						<span>Enabled</span>
					</label>
					<button class="btn small danger" id="deleteModBtn">Delete</button>
				</div>

				<div class="tabs">
					<button class="tab active" data-tab="js">JavaScript (inject)</button>
					<button class="tab" data-tab="css">CSS (style override)</button>
				</div>

				<textarea id="codeEditor" spellcheck="false" placeholder="// Write JavaScript or CSS to inject into BrowOS offline PWA..."></textarea>

				<div class="editor-footer">
					<span id="editorHint">Runs at BrowOS startup after DOM is ready.</span>
					<button class="btn small secondary" id="saveModBtn">Save Draft</button>
				</div>
			</section>
		</main>
	</div>

	<script src="app.js"></script>
</body>
</html>
