# BrowOS

A client-side desktop operating system built as a static Progressive Web App (PWA) using vanilla HTML, CSS, and JavaScript. Designed to run locally in any modern browser—across desktop monitors, Samsung DeX, tablets, and mobile portrait screens—with offline caching, multi-profile support, and a `localStorage`-backed virtual file system.

---

## Key Features

### Adaptive Desktop & Window Management
- **Portrait & Small-Viewport Scaling:** Automatically scales the virtual desktop shell (`760px` portrait / `960px` landscape baseline) so full desktop workflows remain usable on phones and split-screen windows.
- **Window Controls & True Fullscreen:** Full-height window maximization, Windows or Mac window button layouts, selectable title bar sizes (`34px` to `66px`), and **triple-tap on any window title bar** to enter borderless `F11`-style fullscreen (`Esc` or top-right button to exit).
- **Personalization:** Dark and Light themes, custom accent colors, theme packs, rounded or square corners, window transparency slider, live wallpaper effects, custom cursors, and custom wallpaper uploads.

### Taskbar, Widgets & Sticky Notes
- **Customizable Taskbar:** Proportional scaling (`0.25x` to `2.0x` with a `1x` reset), independent glassy opacity slider, hideable taskbar with a bottom restore pill, and individual visibility toggles for Start, Virtual Desktops, Clipboard, Notifications, Quick Settings, and Clock.
- **Desktop Widgets & Notes:** Frosted-glass desktop widgets (Clock, Calendar, Weather, Quote of the Day, System Info) synced to taskbar transparency variables, plus draggable colorful sticky notes.

### First-Boot Setup, Lock Screen & Privacy Controls
- **Animated Setup Wizard (OOBE):** Guides first-time setup with a live mini-desktop preview for wallpapers, window transparency, taskbar glass opacity, theme/accent, and PIN configuration (with a **Skip all** option).
- **Two-Stage Lock Screen:** Displays an unblurred wallpaper curtain with clock and date (optional background blur toggle in **Settings → Security**), transitioning to a blurred authentication card with a profile switcher and **Back** button.
- **Local PBKDF2-SHA256 Encryption:** Supports 4–128 character PINs or passwords hashed locally with PBKDF2-SHA256 (`150,000` iterations + random 16-byte salt) and configurable failed-attempt lockout policies (`Off`, `Normal`, `Strict`).
- **Administrator & Duress Protections:**
  - Role separation between the **Main (Administrator)** profile and secondary profiles.
  - Unique 5-digit **OS Security Code** generated on first boot for recovery verification.
  - Optional **Duress (Instant Wipe) PIN** that triggers a 0.5-second strobe flash, wipes all website storage, and requires the previous 5-digit OS Security Code before setup can continue.

### Local Storage File System & App SDK
- **Virtual File Store:** `localStorage`-backed file and folder manager (**Files**) with Trash/Restore, drag-and-drop uploads, and full JSON backup export/import.
- **Universal App File Bridge:** Automatically intercepts `<input type="file">` and `<a download>` across built-in apps so files can be opened from or saved directly to **BrowOS Files** as well as the host device.
- **Permission-Gated Web App SDK:** Sandboxed web apps installed via **BrowStore** communicate with the desktop through `postMessage` (`sdk/browos-sdk.js` ↔ `js/sdk-bridge.js`) with per-app permission prompts.

### Recovery & Offline PWA Maintenance
- **Standalone Recovery Console (`recovery.html`):** Works independently of the main desktop shell to reboot to `index.html`, refresh cached HTML/CSS/JS assets without losing user data, export/import JSON backups, remove a forgotten PIN using the time-based master password + 5-digit OS Security Code, run a factory reset, or open temporary scratch notes and a test WebView.
- **Recover Brow & Cache Manager:** Built-in utilities for generating time-based recovery credentials, rebooting to recovery, and inspecting or patching Service Worker (`sw.js`) caches.

---

## Project Structure

```text
BrowOS-Web/
├── index.html                 # Main OS shell, OOBE wizard, Lock Screen, Settings UI
├── recovery.html              # Standalone recovery and maintenance console
├── manifest.webmanifest       # PWA manifest
├── sw.js                      # Offline Service Worker cache
├── css/                       # Modular stylesheets (desktop, taskbar, windows, lock, settings, etc.)
├── js/
│   ├── filestore.js           # localStorage-backed virtual file system
│   ├── lock.js                # PBKDF2-SHA256 PIN crypto, lockout timers, lock screen & screensaver
│   ├── maximize.js            # Window maximize geometry & triple-tap fullscreen
│   ├── settings.js            # Settings navigation, personalization, taskbar & data reset controls
│   ├── frame-hooks.js         # Cross-frame event & shared bridge injection
│   ├── os-api.js              # Desktop API exposed to built-in app frames
│   ├── sdk-bridge.js          # Permission-gated postMessage bridge for external/store apps
│   └── ...                    # Profiles, BrowStore, Task Manager, widgets, hotkeys, sync
├── apps/
│   ├── shared/theme.js        # Theme sync & universal file picker/save hooks for iframes
│   ├── files/                 # Virtual File Manager
│   ├── codeeditor/            # Syntax-highlighted Code Editor
│   ├── recoverbrow/           # Recovery password & cache refresh utility
│   ├── modmanager/            # Root & offline PWA cache inspector/patcher
│   └── ...                    # Notepad, Calculator, Calendar, Weather, games & tools
├── sdk/
│   └── browos-sdk.js          # Client SDK script for third-party BrowOS web apps
├── icons/                     # System and application icons
├── wallpapers/                # Built-in desktop wallpapers
└── sounds/                    # Startup and UI audio effects
