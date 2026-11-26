// Lock screen, hardware fingerprint (WebAuthn platform authenticator), PIN limits, and screensaver

const lockScreenElement = document.getElementById("lockScreen");
const lockTime = document.getElementById("lockTime");
const lockDate = document.getElementById("lockDate");
const lockForm = document.getElementById("lockForm");
const lockPin = document.getElementById("lockPin");
const lockMessage = document.getElementById("lockMessage");

const PIN_KEY = "browos-pin";
const PIN_ITERATIONS = 150000;
const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 128;
const PIN_LIMIT_MODE_KEY = "browos-pin-limit-mode";
const PIN_FAILS_KEY = "browos-pin-fails";
const PIN_LOCKOUT_UNTIL_KEY = "browos-pin-lockout-until";

const BIOMETRIC_CRED_KEY = "browos-biometric-cred";
const BIOMETRIC_AUTO_KEY = "browos-biometric-auto";

// Base64 helpers

function bytesToBase64(bytes) {
	let text = "";

	bytes.forEach(function (byte) {
		text += String.fromCharCode(byte);
	});

	return btoa(text);
}

function base64ToBytes(text) {
	return Uint8Array.from(atob(text), function (character) {
		return character.charCodeAt(0);
	});
}

// PIN (PBKDF2-SHA256)

async function derivePinHash(pin, salt, iterations) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pin),
		"PBKDF2",
		false,
		["deriveBits"]
	);

	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
		key,
		256
	);

	return bytesToBase64(new Uint8Array(bits));
}

function savedPin() {
	try {
		const pin = JSON.parse(localStorage.getItem(PIN_KEY));

		if (pin && typeof pin.salt === "string" && typeof pin.hash === "string") {
			return pin;
		}
	} catch (error) {
		// no PIN
	}

	return null;
}

function hasPin() {
	return savedPin() !== null;
}

async function setPin(pin) {
	const salt = crypto.getRandomValues(new Uint8Array(16));

	localStorage.setItem(
		PIN_KEY,
		JSON.stringify({
			salt: bytesToBase64(salt),
			iterations: PIN_ITERATIONS,
			hash: await derivePinHash(pin, salt, PIN_ITERATIONS),
		})
	);

	resetPinAttemptState();
}

async function checkPin(pin) {
	const saved = savedPin();

	if (!saved) {
		return true;
	}

	const hash = await derivePinHash(pin, base64ToBytes(saved.salt), saved.iterations || PIN_ITERATIONS);

	return hash === saved.hash;
}

// Hardware Fingerprint / Platform Biometrics (WebAuthn)

function savedBiometricCredId() {
	try {
		const raw = localStorage.getItem(BIOMETRIC_CRED_KEY);
		if (raw && typeof raw === "string" && raw.length > 8) {
			return raw;
		}
	} catch (e) {}
	return null;
}

function hasBiometricUnlock() {
	return Boolean(window.PublicKeyCredential && navigator.credentials && savedBiometricCredId());
}

async function enrollBiometricUnlock() {
	if (!window.PublicKeyCredential || !navigator.credentials) {
		throw new Error("Hardware biometrics are not supported in this browser or context (requires HTTPS/localhost).");
	}

	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const userId = crypto.getRandomValues(new Uint8Array(16));

	let profileLabel = "BrowOS User";
	try {
		const meta = JSON.parse(localStorage.getItem("browos-profiles-meta") || "null");
		if (meta && Array.isArray(meta.list)) {
			const cur = meta.list.find(function (p) { return p.id === meta.current; });
			if (cur && cur.name) profileLabel = "BrowOS (" + cur.name + ")";
		}
	} catch (e) {}

	const credential = await navigator.credentials.create({
		publicKey: {
			challenge: challenge,
			rp: {
				name: "BrowOS",
			},
			user: {
				id: userId,
				name: profileLabel,
				displayName: profileLabel,
			},
			pubKeyCredParams: [
				{ type: "public-key", alg: -7 },
				{ type: "public-key", alg: -257 },
			],
			authenticatorSelection: {
				authenticatorAttachment: "platform",
				userVerification: "required",
				residentKey: "preferred",
			},
			timeout: 60000,
			attestation: "none",
		},
	});

	if (!credential || !credential.rawId) {
		throw new Error("Biometric enrollment was cancelled.");
	}

	const credIdBase64 = bytesToBase64(new Uint8Array(credential.rawId));
	localStorage.setItem(BIOMETRIC_CRED_KEY, credIdBase64);
	return true;
}

function removeBiometricUnlock() {
	localStorage.removeItem(BIOMETRIC_CRED_KEY);
	localStorage.removeItem(BIOMETRIC_AUTO_KEY);
}

let biometricPromptInFlight = false;

async function verifyBiometricUnlock() {
	const credId = savedBiometricCredId();
	if (!credId || !window.PublicKeyCredential || !navigator.credentials) {
		return false;
	}
	if (biometricPromptInFlight) {
		return false;
	}

	biometricPromptInFlight = true;
	try {
		const challenge = crypto.getRandomValues(new Uint8Array(32));
		const assertion = await navigator.credentials.get({
			publicKey: {
				challenge: challenge,
				allowCredentials: [
					{
						id: base64ToBytes(credId),
						type: "public-key",
						transports: ["internal"],
					},
				],
				userVerification: "required",
				timeout: 60000,
			},
		});

		if (assertion && assertion.rawId) {
			unlockScreen();
			return true;
		}
	} catch (err) {
		if (lockMessage) {
			showLockMessage("Fingerprint not verified. Use your PIN or try again.");
		}
	} finally {
		biometricPromptInFlight = false;
	}
	return false;
}

// PIN Try Limits (off | normal | strict)

function getPinLimitMode() {
	const mode = localStorage.getItem(PIN_LIMIT_MODE_KEY);
	if (mode === "off" || mode === "normal" || mode === "strict") {
		return mode;
	}
	return "normal";
}

function setPinLimitMode(mode) {
	const valid = mode === "off" || mode === "normal" || mode === "strict" ? mode : "normal";
	localStorage.setItem(PIN_LIMIT_MODE_KEY, valid);
	if (valid === "off") {
		resetPinAttemptState();
	}
}

function getFailedTries() {
	return Math.max(0, parseInt(localStorage.getItem(PIN_FAILS_KEY) || "0", 10) || 0);
}

function setFailedTries(count) {
	localStorage.setItem(PIN_FAILS_KEY, String(Math.max(0, count)));
}

function getLockoutUntil() {
	return Math.max(0, parseInt(localStorage.getItem(PIN_LOCKOUT_UNTIL_KEY) || "0", 10) || 0);
}

function setLockoutUntil(timestampMs) {
	if (timestampMs > 0) {
		localStorage.setItem(PIN_LOCKOUT_UNTIL_KEY, String(timestampMs));
	} else {
		localStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
	}
}

function resetPinAttemptState() {
	localStorage.removeItem(PIN_FAILS_KEY);
	localStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
	clearInterval(lockoutTimer);
	if (lockPin) {
		lockPin.disabled = false;
	}
}

function evaluateFailureLockout(totalFails) {
	const mode = getPinLimitMode();

	if (mode === "off") {
		return { lockoutSeconds: 0, remainingBeforeLock: null };
	}

	if (mode === "strict") {
		if (totalFails === 3) {
			return { lockoutSeconds: 60, remainingBeforeLock: 0 };
		}
		if (totalFails === 5) {
			return { lockoutSeconds: 300, remainingBeforeLock: 0 };
		}
		if (totalFails >= 6) {
			return { lockoutSeconds: 900, remainingBeforeLock: 0 };
		}
		const nextMilestone = totalFails < 3 ? 3 : 5;
		return { lockoutSeconds: 0, remainingBeforeLock: nextMilestone - totalFails };
	}

	// Normal: 5 tries -> 60s (1 minute), then 5 more tries -> 60s, repeating every 5 tries
	if (totalFails > 0 && totalFails % 5 === 0) {
		return { lockoutSeconds: 60, remainingBeforeLock: 0 };
	}
	const rem = 5 - (totalFails % 5);
	return { lockoutSeconds: 0, remainingBeforeLock: rem };
}

function formatDurationSeconds(sec) {
	if (sec >= 60) {
		const mins = Math.floor(sec / 60);
		const remSec = sec % 60;
		if (remSec === 0) {
			return mins + (mins === 1 ? " minute" : " minutes");
		}
		return mins + "m " + remSec + "s";
	}
	return sec + " s";
}

// Lock screen

let locked = false;
let lockedAt = 0;
let lockoutTimer = null;

function updateLockClock() {
	const now = new Date();

	lockTime.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

	lockDate.textContent = now.toLocaleDateString([], {
		weekday: "long",
		day: "numeric",
		month: "long",
	});
}

setInterval(function () {
	if (locked) {
		updateLockClock();
	}
}, 1000);

function showLockMessage(text) {
	if (lockMessage) {
		lockMessage.textContent = text;
	}
}

function lockoutLeft() {
	if (getPinLimitMode() === "off") {
		return 0;
	}
	return Math.max(0, Math.ceil((getLockoutUntil() - Date.now()) / 1000));
}

function showLockout() {
	clearInterval(lockoutTimer);

	function update() {
		const left = lockoutLeft();

		if (left <= 0) {
			clearInterval(lockoutTimer);
			setLockoutUntil(0);
			lockPin.disabled = false;
			showLockMessage("Enter your PIN");
			if (!lockScreenElement.hidden) {
				lockPin.focus();
			}
			return;
		}

		lockPin.disabled = true;
		showLockMessage("Too many tries. Try again in " + formatDurationSeconds(left));
	}

	update();
	lockoutTimer = setInterval(update, 500);
}

function lockScreen() {
	if (locked) {
		return;
	}

	locked = true;

	lockedAt = Date.now();

	sessionStorage.setItem("browos-locked", "1");

	if (typeof closeStartMenu === "function") closeStartMenu();
	if (typeof closeFlyouts === "function") closeFlyouts();

	if (typeof desktopShell !== "undefined" && desktopShell) {
		lockScreenElement.style.backgroundImage = desktopShell.style.backgroundImage;
	}

	updateLockClock();

	lockPin.value = "";

	const withPin = hasPin();
	const withBio = hasBiometricUnlock();

	lockForm.classList.toggle("with-pin", withPin);
	lockScreenElement.classList.toggle("has-biometric", withBio);

	const bioBtn = document.getElementById("bosLockBioBtn");
	if (bioBtn) {
		bioBtn.hidden = !withBio;
	}

	lockScreenElement.hidden = false;

	if (typeof desktopShell !== "undefined" && desktopShell) {
		desktopShell.inert = true;
	}

	if (withPin && lockoutLeft() > 0) {
		showLockout();
	} else {
		lockPin.disabled = false;
		if (withPin && withBio) {
			showLockMessage("Enter PIN or use Fingerprint");
		} else if (withPin) {
			showLockMessage("Enter your PIN");
		} else if (withBio) {
			showLockMessage("Verify Fingerprint to unlock");
		} else {
			showLockMessage("Click or press any key to unlock");
		}

		if (withPin) {
			lockPin.focus();
		} else {
			lockScreenElement.focus();
		}
	}
}

function unlockScreen() {
	locked = false;

	sessionStorage.removeItem("browos-locked");

	resetPinAttemptState();

	lockScreenElement.hidden = true;

	if (typeof desktopShell !== "undefined" && desktopShell) {
		desktopShell.inert = false;
	}
}

lockForm.addEventListener("submit", async function (event) {
	event.preventDefault();

	if (!hasPin() && hasBiometricUnlock()) {
		await verifyBiometricUnlock();
		return;
	}

	if (!hasPin() || lockoutLeft() > 0) {
		return;
	}

	const entered = lockPin.value;

	lockPin.value = "";

	let correct = false;

	try {
		correct = await checkPin(entered);
	} catch (error) {
		showLockMessage("Couldn't check the PIN in this browser");

		return;
	}

	if (correct) {
		unlockScreen();

		return;
	}

	const totalFails = getFailedTries() + 1;
	setFailedTries(totalFails);

	lockScreenElement.classList.remove("shake");

	void lockScreenElement.offsetWidth;

	lockScreenElement.classList.add("shake");

	const result = evaluateFailureLockout(totalFails);

	if (result.lockoutSeconds > 0) {
		setLockoutUntil(Date.now() + result.lockoutSeconds * 1000);
		showLockout();
	} else if (result.remainingBeforeLock !== null) {
		showLockMessage(
			"Wrong PIN (" +
				result.remainingBeforeLock +
				(result.remainingBeforeLock === 1 ? " try left)" : " tries left)")
		);
	} else {
		showLockMessage("Wrong PIN");
	}
});

// Without PIN or Fingerprint, the lock screen is a cover: click or any key opens it
function quickUnlock(event) {
	if (!locked || hasPin() || hasBiometricUnlock() || Date.now() - lockedAt < 500) {
		return;
	}

	if (event.type === "keydown" && ["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
		return;
	}

	unlockScreen();
}

lockScreenElement.addEventListener("pointerdown", quickUnlock);

document.addEventListener("keydown", quickUnlock);

// Enforce 128-character limit without restricting to digits
lockPin.addEventListener("input", function () {
	if (lockPin.value.length > PIN_MAX_LENGTH) {
		lockPin.value = lockPin.value.slice(0, PIN_MAX_LENGTH);
	}
});

// Idle detection and the screensaver

const screensaverElement = document.getElementById("screensaver");
const screensaverCanvas = document.getElementById("screensaverCanvas");
const screensaverClock = document.getElementById("screensaverClock");
const screensaverContext = screensaverCanvas.getContext("2d");

const awakeReasons = new Set();

function idleKeepAwake(key, on) {
	if (on) {
		awakeReasons.add(key);
	} else {
		awakeReasons.delete(key);
	}
}

let lastActivity = Date.now();

function markActive() {
	lastActivity = Date.now();
}

if (typeof onEveryDocument === "function") {
	onEveryDocument(function (doc) {
		["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach(function (name) {
			doc.addEventListener(name, markActive, { passive: true, capture: true });
		});
	});
}

function saverEnabled() {
	return localStorage.getItem("browos-saver") !== "off";
}

function saverMinutes() {
	const minutes = Number(localStorage.getItem("browos-saver-minutes"));

	return minutes >= 1 ? minutes : 10;
}

function saverType() {
	const type = localStorage.getItem("browos-saver-type");

	return ["stars", "logo", "clock"].includes(type) ? type : "stars";
}

let saverRunning = false;
let saverFrame = 0;
let saverStartedAt = 0;
let saverPointer = null;
let saverClockTimer = null;

function stopScreensaver() {
	if (!saverRunning) {
		return;
	}

	saverRunning = false;

	cancelAnimationFrame(saverFrame);

	clearInterval(saverClockTimer);

	screensaverElement.hidden = true;

	lastActivity = Date.now();

	["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach(function (name) {
		window.removeEventListener(name, wakeScreensaver, true);
	});
}

function wakeScreensaver(event) {
	if (Date.now() - saverStartedAt < 600) {
		return;
	}

	if (event.type === "pointermove") {
		if (!saverPointer) {
			saverPointer = { x: event.clientX, y: event.clientY };

			return;
		}

		if (Math.abs(event.clientX - saverPointer.x) + Math.abs(event.clientY - saverPointer.y) < 8) {
			return;
		}
	}

	event.stopPropagation();

	event.preventDefault();

	stopScreensaver();
}

function sizeSaverCanvas() {
	screensaverCanvas.width = window.innerWidth;
	screensaverCanvas.height = window.innerHeight;
}

function runStars() {
	const stars = [];

	for (let i = 0; i < 220; i++) {
		stars.push({
			x: (Math.random() - 0.5) * 2,
			y: (Math.random() - 0.5) * 2,
			z: Math.random(),
		});
	}

	function frame() {
		const width = screensaverCanvas.width;
		const height = screensaverCanvas.height;

		screensaverContext.fillStyle = "#05060a";
		screensaverContext.fillRect(0, 0, width, height);

		stars.forEach(function (star) {
			star.z -= 0.004;

			if (star.z <= 0.01) {
				star.x = (Math.random() - 0.5) * 2;
				star.y = (Math.random() - 0.5) * 2;
				star.z = 1;
			}

			const x = width / 2 + (star.x / star.z) * (width / 4);
			const y = height / 2 + (star.y / star.z) * (height / 4);

			const size = (1 - star.z) * 3 + 0.4;

			screensaverContext.globalAlpha = Math.min(1, (1 - star.z) * 1.5);
			screensaverContext.fillStyle = "white";
			screensaverContext.fillRect(x, y, size, size);
		});

		screensaverContext.globalAlpha = 1;

		saverFrame = requestAnimationFrame(frame);
	}

	frame();
}

function runLogo() {
	const logo = new Image();

	logo.src = "icons/browos-logo.png";

	const size = 110;

	let x = Math.random() * (window.innerWidth - size);
	let y = Math.random() * (window.innerHeight - size);
	let dx = 1.4;
	let dy = 1.1;

	function frame() {
		const width = screensaverCanvas.width;
		const height = screensaverCanvas.height;

		screensaverContext.fillStyle = "#05060a";
		screensaverContext.fillRect(0, 0, width, height);

		x += dx;
		y += dy;

		if (x <= 0 || x >= width - size) {
			dx = -dx;
		}

		if (y <= 0 || y >= height - size) {
			dy = -dy;
		}

		x = Math.max(0, Math.min(width - size, x));
		y = Math.max(0, Math.min(height - size, y));

		if (logo.complete && logo.naturalWidth > 0) {
			screensaverContext.drawImage(logo, x, y, size, size);
		}

		saverFrame = requestAnimationFrame(frame);
	}

	frame();
}

function runClock() {
	screensaverContext.fillStyle = "#05060a";
	screensaverContext.fillRect(0, 0, screensaverCanvas.width, screensaverCanvas.height);

	screensaverClock.hidden = false;

	function tick() {
		screensaverClock.textContent = new Date().toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function move() {
		screensaverClock.style.left = 8 + Math.random() * 50 + "%";
		screensaverClock.style.top = 10 + Math.random() * 65 + "%";
	}

	tick();
	move();

	saverClockTimer = setInterval(function () {
		tick();

		if (new Date().getSeconds() % 20 === 0) {
			move();
		}
	}, 1000);
}

function startScreensaver() {
	if (saverRunning) {
		return;
	}

	saverRunning = true;

	saverStartedAt = Date.now();

	saverPointer = null;

	if (typeof closeStartMenu === "function") closeStartMenu();
	if (typeof closeFlyouts === "function") closeFlyouts();

	if (localStorage.getItem("browos-saver-lock") === "on") {
		lockScreen();
	}

	sizeSaverCanvas();

	screensaverClock.hidden = true;

	screensaverElement.hidden = false;

	if (document.activeElement && document.activeElement.blur) {
		document.activeElement.blur();
	}

	screensaverElement.focus();

	const type = saverType();

	if (type === "logo") {
		runLogo();
	} else if (type === "clock") {
		runClock();
	} else {
		runStars();
	}

	["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach(function (name) {
		window.addEventListener(name, wakeScreensaver, true);
	});
}

window.addEventListener("resize", function () {
	if (saverRunning) {
		sizeSaverCanvas();
	}
});

function checkIdle() {
	if (saverRunning || !saverEnabled()) {
		return;
	}

	if (awakeReasons.size > 0) {
		markActive();

		return;
	}

	const focused = document.activeElement;

	if (
		document.hasFocus() &&
		focused &&
		focused.tagName === "IFRAME" &&
		typeof sameOriginDocument === "function" &&
		!sameOriginDocument(focused)
	) {
		markActive();

		return;
	}

	if (Date.now() - lastActivity >= saverMinutes() * 60000) {
		startScreensaver();
	}
}

setInterval(checkIdle, 5000);

// Settings: Security page

const pinStatus = document.getElementById("pinStatus");
const pinCurrentRow = document.getElementById("pinCurrentRow");
const pinCurrent = document.getElementById("pinCurrent");
const pinNew = document.getElementById("pinNew");
const pinConfirm = document.getElementById("pinConfirm");
const pinSave = document.getElementById("pinSave");
const pinRemove = document.getElementById("pinRemove");
const pinMessage = document.getElementById("pinMessage");

function showPinState() {
	const has = hasPin();

	pinStatus.textContent = has ? "A PIN is set" : "No PIN is set";

	pinCurrentRow.hidden = !has;

	pinRemove.hidden = !has;

	pinSave.textContent = has ? "Change PIN" : "Set PIN";
}

function pinFeedback(text, good) {
	pinMessage.textContent = text;

	pinMessage.className = "pin-message" + (good ? " good" : "");
}

[pinCurrent, pinNew, pinConfirm].forEach(function (field) {
	field.addEventListener("input", function () {
		if (field.value.length > PIN_MAX_LENGTH) {
			field.value = field.value.slice(0, PIN_MAX_LENGTH);
		}
	});
});

pinSave.addEventListener("click", async function () {
	if (hasPin() && !(await checkPin(pinCurrent.value))) {
		pinFeedback("The current PIN is wrong.");

		return;
	}

	if (pinNew.value.length < PIN_MIN_LENGTH || pinNew.value.length > PIN_MAX_LENGTH) {
		pinFeedback("A PIN must be 4 to 128 characters.");

		return;
	}

	if (pinNew.value !== pinConfirm.value) {
		pinFeedback("The two PINs are not the same.");

		return;
	}

	try {
		await setPin(pinNew.value);
	} catch (error) {
		pinFeedback("This browser can't save a PIN here.");

		return;
	}

	pinCurrent.value = "";
	pinNew.value = "";
	pinConfirm.value = "";

	showPinState();

	pinFeedback("PIN saved.", true);
});

pinRemove.addEventListener("click", async function () {
	if (!(await checkPin(pinCurrent.value))) {
		pinFeedback("Enter the current PIN to remove it.");

		return;
	}

	localStorage.removeItem(PIN_KEY);
	resetPinAttemptState();

	pinCurrent.value = "";

	if (!hasBiometricUnlock()) {
		localStorage.setItem("browos-lock-startup", "off");
		lockStartupToggle.checked = false;
	}

	showPinState();

	pinFeedback("PIN removed.", true);
});

// Settings: Hardware Fingerprint Controls
const bioStatusEl = document.getElementById("biometricStatus");
const bioEnrollBtn = document.getElementById("biometricEnrollBtn");
const bioRemoveBtn = document.getElementById("biometricRemoveBtn");
const bioAutoToggle = document.getElementById("biometricAutoToggle");
const bioMessageEl = document.getElementById("biometricMessage");

function refreshBiometricSettingsUI() {
	const enrolled = hasBiometricUnlock();
	if (bioStatusEl) {
		bioStatusEl.textContent = enrolled
			? "Device fingerprint / biometrics enabled"
			: "Not configured (uses device hardware prompt)";
	}
	if (bioEnrollBtn) {
		bioEnrollBtn.textContent = enrolled ? "Re-register Fingerprint" : "Set up Fingerprint";
	}
	if (bioRemoveBtn) {
		bioRemoveBtn.hidden = !enrolled;
	}
	if (bioAutoToggle) {
		bioAutoToggle.checked = enrolled && localStorage.getItem(BIOMETRIC_AUTO_KEY) !== "off";
		bioAutoToggle.disabled = !enrolled;
	}
}

refreshBiometricSettingsUI();

if (bioEnrollBtn) {
	bioEnrollBtn.addEventListener("click", async function () {
		if (bioMessageEl) {
			bioMessageEl.textContent = "Follow your device's fingerprint / biometric prompt…";
			bioMessageEl.className = "pin-message";
		}
		try {
			await enrollBiometricUnlock();
			localStorage.setItem(BIOMETRIC_AUTO_KEY, "on");
			refreshBiometricSettingsUI();
			if (bioMessageEl) {
				bioMessageEl.textContent = "Hardware fingerprint registered.";
				bioMessageEl.className = "pin-message good";
			}
		} catch (err) {
			if (bioMessageEl) {
				bioMessageEl.textContent = err && err.message ? err.message : "Could not register fingerprint.";
				bioMessageEl.className = "pin-message";
			}
		}
	});
}

if (bioRemoveBtn) {
	bioRemoveBtn.addEventListener("click", function () {
		removeBiometricUnlock();
		refreshBiometricSettingsUI();
		if (bioMessageEl) {
			bioMessageEl.textContent = "Fingerprint unlock removed.";
			bioMessageEl.className = "pin-message good";
		}
	});
}

if (bioAutoToggle) {
	bioAutoToggle.addEventListener("change", function () {
		localStorage.setItem(BIOMETRIC_AUTO_KEY, bioAutoToggle.checked ? "on" : "off");
	});
}

const lockStartupToggle = document.getElementById("lockStartupToggle");
const saverToggle = document.getElementById("saverToggle");
const saverMinutesSelect = document.getElementById("saverMinutes");
const saverTypeSelect = document.getElementById("saverType");
const saverLockToggle = document.getElementById("saverLockToggle");

lockStartupToggle.checked = localStorage.getItem("browos-lock-startup") === "on";

lockStartupToggle.addEventListener("change", function () {
	if (lockStartupToggle.checked && !hasPin() && !hasBiometricUnlock()) {
		lockStartupToggle.checked = false;

		pinFeedback("Set a PIN or Fingerprint first.");

		return;
	}

	localStorage.setItem("browos-lock-startup", lockStartupToggle.checked ? "on" : "off");
});

saverToggle.checked = saverEnabled();

saverToggle.addEventListener("change", function () {
	localStorage.setItem("browos-saver", saverToggle.checked ? "on" : "off");
});

saverMinutesSelect.value = String(saverMinutes());

if (saverMinutesSelect.value === "") {
	saverMinutesSelect.value = "10";
}

saverMinutesSelect.addEventListener("change", function () {
	localStorage.setItem("browos-saver-minutes", saverMinutesSelect.value);
});

saverTypeSelect.value = saverType();

saverTypeSelect.addEventListener("change", function () {
	localStorage.setItem("browos-saver-type", saverTypeSelect.value);
});

saverLockToggle.checked = localStorage.getItem("browos-saver-lock") === "on";

saverLockToggle.addEventListener("change", function () {
	localStorage.setItem("browos-saver-lock", saverLockToggle.checked ? "on" : "off");
});

document.getElementById("saverPreview").addEventListener("click", function () {
	startScreensaver();
});

showPinState();

// Startup: stay locked after a refresh, or lock when BrowOS opens
if (
	sessionStorage.getItem("browos-locked") === "1" ||
	((hasPin() || hasBiometricUnlock()) && localStorage.getItem("browos-lock-startup") === "on")
) {
	lockScreen();
}

// Start menu: Lock
document.getElementById("lockMenuItem").addEventListener("click", function () {
	if (typeof closeStartMenu === "function") closeStartMenu();

	lockScreen();
});
