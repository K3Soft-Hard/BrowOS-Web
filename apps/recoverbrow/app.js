// BrowChat: Multi-provider AI assistant for BrowOS with frosted glass design,
// guided Add-Provider workflow (starts with 0 added providers), multi-skill selection / disable-all,
// server-side web search, skill & file uploads, chat history/export, and BrowOS Bubble integration.

(function () {
	const STORAGE_CONFIG_KEY = "browchat-config-v2";
	const STORAGE_CHATS_KEY = "browchat-chats-v1";

	const PROVIDER_PRESETS = {
		openrouter: {
			name: "OpenRouter",
			baseUrl: "https://openrouter.ai/api/v1",
			defaultModels: [
				{ id: "openrouter/auto", name: "Auto (Best Available)", visible: true },
				{ id: "openrouter/free", name: "Free Models Router", visible: true },
				{ id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", visible: true },
				{ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", visible: true },
			],
		},
		gemini: {
			name: "Google Gemini",
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			defaultModels: [
				{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", visible: true },
				{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", visible: true },
			],
		},
		groq: {
			name: "Groq",
			baseUrl: "https://api.groq.com/openai/v1",
			defaultModels: [
				{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", visible: true },
				{ id: "qwen-qwq-32b", name: "Qwen QwQ 32B", visible: true },
			],
		},
		openai: {
			name: "OpenAI",
			baseUrl: "https://api.openai.com/v1",
			defaultModels: [
				{ id: "gpt-4o-mini", name: "GPT-4o Mini", visible: true },
				{ id: "gpt-4o", name: "GPT-4o", visible: true },
			],
		},
		ollama: {
			name: "Ollama (Local)",
			baseUrl: "http://localhost:11434/v1",
			defaultModels: [
				{ id: "qwen2.5:7b", name: "Qwen 2.5 7B", visible: true },
			],
		},
	};

	const DEFAULT_SKILLS = [
		{
			id: "skill-concise",
			name: "Concise & Direct",
			prompt: "Be concise, direct, and clear. Lead with the answer without introductory fluff.",
		},
		{
			id: "skill-coder",
			name: "Code & Debugging",
			prompt: "Provide complete, working code without placeholders and explain root causes clearly.",
		},
	];

	function loadJson(key, fallback) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return fallback;
			const parsed = JSON.parse(raw);
			return parsed !== null ? parsed : fallback;
		} catch (e) {
			return fallback;
		}
	}

	function saveJson(key, val) {
		try {
			localStorage.setItem(key, JSON.stringify(val));
		} catch (e) {}
	}

	// Starts with 0 added providers so user adds only the ones they want
	let config = (function initConfig() {
		const saved = loadJson(STORAGE_CONFIG_KEY, null);
		const base = {
			providers: [],
			selectedModel: "",
			webSearch: false,
			skills: JSON.parse(JSON.stringify(DEFAULT_SKILLS)),
			activeSkillIds: [],
			bubbleAutoSync: true,
			bubblePresets: ["Summarize this", "Explain simply", "Fix my code"],
		};
		if (saved && typeof saved === "object") {
			if (Array.isArray(saved.providers)) base.providers = saved.providers;
			if (typeof saved.selectedModel === "string") base.selectedModel = saved.selectedModel;
			if (typeof saved.webSearch === "boolean") base.webSearch = saved.webSearch;
			if (Array.isArray(saved.skills)) base.skills = saved.skills;
			if (Array.isArray(saved.activeSkillIds)) base.activeSkillIds = saved.activeSkillIds;
			if (typeof saved.bubbleAutoSync === "boolean") base.bubbleAutoSync = saved.bubbleAutoSync;
			if (Array.isArray(saved.bubblePresets)) base.bubblePresets = saved.bubblePresets;
		}
		return base;
	})();

	let chats = loadJson(STORAGE_CHATS_KEY, []);
	if (!Array.isArray(chats) || !chats.length) {
		chats = [
			{
				id: "chat-" + Date.now(),
				title: "New Chat",
				updatedAt: Date.now(),
				messages: [],
			},
		];
		saveJson(STORAGE_CHATS_KEY, chats);
	}

	let activeChatId = chats[0].id;
	let pendingAttachments = [];
	let activeAbort = null;
	let lastBubbleReply = "";

	// Provider form draft state
	let draftProviderId = null;
	let draftProviderModels = [];
	let editingSkillId = null;

	// DOM Elements
	const sidebarEl = document.getElementById("sidebar");
	const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
	const newChatBtn = document.getElementById("newChatBtn");
	const historySearch = document.getElementById("historySearch");
	const chatListEl = document.getElementById("chatList");
	const modelSelect = document.getElementById("modelSelect");
	const skillsDropdownBtn = document.getElementById("skillsDropdownBtn");
	const skillsPopover = document.getElementById("skillsPopover");
	const skillsPopoverList = document.getElementById("skillsPopoverList");
	const messagesContainer = document.getElementById("messagesContainer");
	const attachmentsBar = document.getElementById("attachmentsBar");
	const promptInput = document.getElementById("promptInput");
	const attachFileBtn = document.getElementById("attachFileBtn");
	const hiddenFileInput = document.getElementById("hiddenFileInput");
	const webSearchToggleBtn = document.getElementById("webSearchToggleBtn");
	const sendBtn = document.getElementById("sendBtn");
	const stopBtn = document.getElementById("stopBtn");

	function persistConfig() {
		saveJson(STORAGE_CONFIG_KEY, config);
	}

	function persistChats() {
		saveJson(STORAGE_CHATS_KEY, chats);
	}

	function getActiveChat() {
		return chats.find(function (c) { return c.id === activeChatId; }) || chats[0];
	}

	function escapeHtml(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function renderMarkdown(rawText) {
		const text = String(rawText || "");
		const blocks = text.split(/```/);
		let html = "";

		for (let i = 0; i < blocks.length; i++) {
			if (i % 2 === 1) {
				const firstNewline = blocks[i].indexOf("\n");
				const codeBody = firstNewline !== -1 ? blocks[i].slice(firstNewline + 1) : blocks[i];
				html += "<pre><code>" + escapeHtml(codeBody) + "</code></pre>";
			} else {
				const escaped = escapeHtml(blocks[i]);
				const withInline = escaped
					.replace(/`([^`]+)`/g, "<code>$1</code>")
					.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
					.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
				const paras = withInline.split(/\n{2,}/);
				paras.forEach(function (p) {
					const trimmed = p.trim();
					if (trimmed) {
						html += "<p>" + trimmed.replace(/\n/g, "<br>") + "</p>";
					}
				});
			}
		}
		return html || "<p></p>";
	}

	// =========================================================
	// BrowOS SDK Theme & Bubble Integration
	// =========================================================
	function buildBubbleCardHtml() {
		const presets = (config.bubblePresets || []).slice(0, 3);
		const presetButtonsHtml = presets
			.map(function (p) {
				return (
					'<button type="button" data-bubble-action="send-preset" data-bubble-prompt="' +
					escapeHtml(p) +
					'" style="font-size:11px;padding:4px 8px;">' +
					escapeHtml(p) +
					"</button>"
				);
			})
			.join(" ");

		const replySnippet = lastBubbleReply
			? '<p style="max-height:76px;overflow-y:auto;margin:6px 0;font-size:12px;">' + escapeHtml(lastBubbleReply.slice(0, 320)) + "</p>"
			: "<p>Ask a quick question or pick a preset below.</p>";

		return (
			'<div>' +
			replySnippet +
			'<div style="display:flex;gap:6px;margin-bottom:6px;">' +
			'<input type="text" data-bubble-input placeholder="Ask BrowChat..." style="flex:1;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.25);color:inherit;font-size:12px;">' +
			'<button type="button" data-bubble-action="send-input">Ask</button>' +
			"</div>" +
			'<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;justify-content:space-between;">' +
			'<div style="display:flex;flex-wrap:wrap;gap:4px;">' + presetButtonsHtml + "</div>" +
			'<button type="button" data-bubble-action="open-app" style="background:rgba(255,255,255,0.14);">Open App</button>' +
			"</div>" +
			"</div>"
		);
	}

	async function syncBubbleCard(forceShow) {
		if (!config.bubbleAutoSync && !forceShow) return;
		const html = buildBubbleCardHtml();
		if (typeof BrowOS !== "undefined" && BrowOS.available && BrowOS.bubble) {
			await BrowOS.bubble.showCard({ id: "main", title: "BrowChat", html: html }).catch(function () {});
		}
	}

	async function hideBubbleCard() {
		if (typeof BrowOS !== "undefined" && BrowOS.available && BrowOS.bubble) {
			await BrowOS.bubble.hideCard("main").catch(function () {});
		}
	}

	if (typeof BrowOS !== "undefined" && BrowOS.available) {
		BrowOS.ready
			.then(function (info) {
				if (info && info.theme) {
					document.documentElement.classList.toggle("light-mode", info.theme === "light");
				}
				if (info && info.accent) {
					document.documentElement.style.setProperty("--accent", info.accent);
				}
			})
			.catch(function () {});

		if (BrowOS.bubble && typeof BrowOS.bubble.onAction === "function") {
			BrowOS.bubble.onAction(function (action, value) {
				if ((action === "send-preset" || action === "send-input") && value) {
					lastBubbleReply = "Thinking...";
					syncBubbleCard(true);
					sendMessage(value, true);
				}
			});
		}
	}

	// =========================================================
	// Top Bar: Models Dropdown & Multi-Skill Selector
	// =========================================================
	function renderModelDropdown() {
		modelSelect.innerHTML = "";
		let count = 0;

		config.providers.forEach(function (prov) {
			if (!prov.enabled) return;
			const visibleModels = (prov.models || []).filter(function (m) { return m.visible; });
			if (!visibleModels.length) return;

			const group = document.createElement("optgroup");
			group.label = prov.name;

			visibleModels.forEach(function (m) {
				const opt = document.createElement("option");
				opt.value = prov.id + "::" + m.id;
				opt.textContent = m.name || m.id;
				group.appendChild(opt);
				count++;
			});

			modelSelect.appendChild(group);
		});

		if (!count) {
			const emptyOpt = document.createElement("option");
			emptyOpt.value = "";
			emptyOpt.textContent = "+ Add a provider first...";
			modelSelect.appendChild(emptyOpt);
			config.selectedModel = "";
		} else {
			modelSelect.value = config.selectedModel;
			if (modelSelect.selectedIndex === -1 && modelSelect.options.length) {
				modelSelect.selectedIndex = 0;
				config.selectedModel = modelSelect.value;
				persistConfig();
			}
		}
	}

	function renderSkillsControls() {
		const activeSet = new Set(config.activeSkillIds || []);
		const activeCount = config.skills.filter(function (s) { return activeSet.has(s.id); }).length;
		skillsDropdownBtn.textContent = activeCount === 0 ? "Skills: Off" : "Skills (" + activeCount + ")";

		skillsPopoverList.innerHTML = "";
		if (!config.skills.length) {
			const none = document.createElement("div");
			none.className = "status-text";
			none.style.padding = "6px 8px";
			none.textContent = "No skills created yet.";
			skillsPopoverList.appendChild(none);
			return;
		}

		config.skills.forEach(function (sk) {
			const row = document.createElement("label");
			row.className = "skills-popover-item";

			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.checked = activeSet.has(sk.id);
			cb.onchange = function () {
				const next = new Set(config.activeSkillIds || []);
				if (cb.checked) next.add(sk.id);
				else next.delete(sk.id);
				config.activeSkillIds = Array.from(next);
				persistConfig();
				renderSkillsControls();
				renderSkillsModal();
			};

			const span = document.createElement("span");
			span.textContent = sk.name;
			row.append(cb, span);
			skillsPopoverList.appendChild(row);
		});
	}

	skillsDropdownBtn.onclick = function (e) {
		e.stopPropagation();
		skillsPopover.hidden = !skillsPopover.hidden;
		if (!skillsPopover.hidden) {
			renderSkillsControls();
		}
	};

	document.addEventListener("click", function (e) {
		if (!skillsPopover.hidden && !e.target.closest(".skills-picker-wrap")) {
			skillsPopover.hidden = true;
		}
	});

	document.getElementById("disableAllSkillsBtn").onclick = function () {
		config.activeSkillIds = [];
		persistConfig();
		renderSkillsControls();
		renderSkillsModal();
	};

	document.getElementById("manageSkillsFromPopoverBtn").onclick = function () {
		skillsPopover.hidden = true;
		renderSkillsModal();
		skillsModal.hidden = false;
	};

	// =========================================================
	// Chat History & Messages
	// =========================================================
	function renderChatList() {
		const filter = (historySearch.value || "").trim().toLowerCase();
		chatListEl.innerHTML = "";

		chats
			.filter(function (c) {
				return !filter || c.title.toLowerCase().includes(filter);
			})
			.forEach(function (chat) {
				const row = document.createElement("div");
				row.className = "chat-item" + (chat.id === activeChatId ? " active" : "");

				const titleSpan = document.createElement("span");
				titleSpan.className = "chat-item-title";
				titleSpan.textContent = chat.title || "Untitled";
				titleSpan.onclick = function () {
					activeChatId = chat.id;
					renderChatList();
					renderMessages();
				};

				const delBtn = document.createElement("button");
				delBtn.type = "button";
				delBtn.className = "chat-item-del";
				delBtn.textContent = "×";
				delBtn.title = "Delete chat";
				delBtn.onclick = function (e) {
					e.stopPropagation();
					chats = chats.filter(function (c) { return c.id !== chat.id; });
					if (!chats.length) {
						chats.push({ id: "chat-" + Date.now(), title: "New Chat", updatedAt: Date.now(), messages: [] });
					}
					if (activeChatId === chat.id) {
						activeChatId = chats[0].id;
					}
					persistChats();
					renderChatList();
					renderMessages();
				};

				row.append(titleSpan, delBtn);
				chatListEl.appendChild(row);
			});
	}

	function renderMessages() {
		const chat = getActiveChat();
		messagesContainer.innerHTML = "";

		if (!chat || !chat.messages.length) {
			const empty = document.createElement("div");
			empty.className = "empty-state";

			if (!config.providers.length) {
				empty.innerHTML =
					"<h2>Welcome to BrowChat</h2>" +
					"<p>No AI providers added yet. Add OpenRouter, Google Gemini, Groq, OpenAI, or Ollama to get started.</p>";
				const cta = document.createElement("button");
				cta.type = "button";
				cta.className = "btn primary";
				cta.textContent = "+ Add Provider";
				cta.onclick = function () { openProvidersModal(true); };
				empty.appendChild(cta);
			} else {
				empty.innerHTML =
					"<h2>BrowChat</h2>" +
					"<p>Select one or more <strong>Skills</strong> (or disable all), toggle <strong>Web Search</strong> for live answers, or attach files.</p>";
			}

			messagesContainer.appendChild(empty);
			return;
		}

		chat.messages.forEach(function (msg) {
			const card = document.createElement("article");
			card.className = "msg " + msg.role;

			const meta = document.createElement("div");
			meta.className = "msg-meta";
			const label = document.createElement("span");
			label.textContent = msg.role === "user" ? "You" : (msg.modelLabel || "Assistant");

			const copyBtn = document.createElement("button");
			copyBtn.type = "button";
			copyBtn.className = "msg-copy";
			copyBtn.textContent = "Copy";
			copyBtn.onclick = function () {
				navigator.clipboard.writeText(msg.content || "").catch(function () {});
				copyBtn.textContent = "Copied";
				setTimeout(function () { copyBtn.textContent = "Copy"; }, 1200);
			};

			meta.append(label, copyBtn);
			card.appendChild(meta);

			if (Array.isArray(msg.attachments) && msg.attachments.length) {
				const attWrap = document.createElement("div");
				attWrap.className = "msg-attachments";
				msg.attachments.forEach(function (att) {
					const pill = document.createElement("span");
					pill.className = "msg-att-pill";
					pill.textContent = att.name;
					attWrap.appendChild(pill);
				});
				card.appendChild(attWrap);
			}

			const body = document.createElement("div");
			body.className = "msg-content";
			body.innerHTML = renderMarkdown(msg.content);
			card.appendChild(body);

			if (Array.isArray(msg.sources) && msg.sources.length) {
				const srcWrap = document.createElement("div");
				srcWrap.className = "msg-sources";
				msg.sources.forEach(function (src) {
					const a = document.createElement("a");
					a.className = "source-link";
					a.href = src.url;
					a.target = "_blank";
					a.rel = "noopener";
					a.textContent = src.title || src.url;
					srcWrap.appendChild(a);
				});
				card.appendChild(srcWrap);
			}

			messagesContainer.appendChild(card);
		});

		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}

	function renderAttachments() {
		attachmentsBar.innerHTML = "";
		attachmentsBar.hidden = pendingAttachments.length === 0;

		pendingAttachments.forEach(function (att, idx) {
			const chip = document.createElement("span");
			chip.className = "att-chip";
			chip.textContent = att.name + " ";

			const rm = document.createElement("button");
			rm.type = "button";
			rm.textContent = "×";
			rm.onclick = function () {
				pendingAttachments.splice(idx, 1);
				renderAttachments();
			};
			chip.appendChild(rm);
			attachmentsBar.appendChild(chip);
		});
	}

	// =========================================================
	// Sending & Streaming AI Requests
	// =========================================================
	function buildCombinedSkillPrompt() {
		const activeSet = new Set(config.activeSkillIds || []);
		const activeList = config.skills.filter(function (s) { return activeSet.has(s.id) && s.prompt; });
		if (!activeList.length) return "";
		if (activeList.length === 1) return activeList[0].prompt;
		return activeList
			.map(function (s) {
				return "[" + s.name + "]\n" + s.prompt;
			})
			.join("\n\n");
	}

	async function sendMessage(overrideText, fromBubble) {
		const rawText = typeof overrideText === "string" ? overrideText.trim() : promptInput.value.trim();
		if (!rawText && !pendingAttachments.length) return;
		if (activeAbort) return;

		if (!config.selectedModel || !config.providers.length) {
			const errNotice = "Add a provider and select a model first.";
			if (fromBubble) {
				lastBubbleReply = errNotice;
				syncBubbleCard(true);
			} else {
				openProvidersModal(true);
			}
			return;
		}

		const sepIdx = config.selectedModel.indexOf("::");
		const provId = config.selectedModel.slice(0, sepIdx);
		const modelId = config.selectedModel.slice(sepIdx + 2);
		const provider = config.providers.find(function (p) { return p.id === provId; });
		if (!provider) return;

		const chat = getActiveChat();
		const combinedSystemPrompt = buildCombinedSkillPrompt();

		const userAttachments = pendingAttachments.slice();
		pendingAttachments = [];
		renderAttachments();
		if (!overrideText) {
			promptInput.value = "";
			promptInput.style.height = "auto";
		}

		chat.messages.push({
			role: "user",
			content: rawText,
			attachments: userAttachments.map(function (a) { return { name: a.name }; }),
		});

		if (chat.title === "New Chat" && rawText) {
			chat.title = rawText.slice(0, 38);
		}
		chat.updatedAt = Date.now();

		const assistantMsg = {
			role: "assistant",
			modelLabel: modelId + " (" + provider.name + ")",
			content: "",
			sources: [],
		};
		chat.messages.push(assistantMsg);
		persistChats();
		renderChatList();
		renderMessages();

		sendBtn.hidden = true;
		stopBtn.hidden = false;
		activeAbort = new AbortController();

		try {
			const formattedHistory = chat.messages.slice(0, -1).map(function (m, idx) {
				let content = m.content || "";
				if (idx === chat.messages.length - 2 && userAttachments.length) {
					const filesBlock = userAttachments
						.map(function (att) {
							return "\n\n--- Attached File: " + att.name + " ---\n" + att.content;
						})
						.join("");
					content += filesBlock;
				}
				return { role: m.role, content: content };
			});

			if (provider.type === "gemini") {
				await callGeminiApi(provider, modelId, combinedSystemPrompt, formattedHistory, assistantMsg, activeAbort.signal, fromBubble);
			} else {
				await callOpenAICompatibleApi(provider, modelId, combinedSystemPrompt, formattedHistory, assistantMsg, activeAbort.signal, fromBubble);
			}
		} catch (err) {
			if (err.name === "AbortError") {
				assistantMsg.content += "\n\n*(Stopped)*";
			} else {
				assistantMsg.content = "Error: " + (err && err.message ? err.message : "Request failed.");
			}
			renderMessages();
			if (fromBubble) {
				lastBubbleReply = assistantMsg.content;
				syncBubbleCard(true);
			}
		} finally {
			activeAbort = null;
			sendBtn.hidden = false;
			stopBtn.hidden = true;
			persistChats();
			if (config.bubbleAutoSync || fromBubble) {
				lastBubbleReply = assistantMsg.content;
				syncBubbleCard(fromBubble);
			}
		}
	}

	async function callOpenAICompatibleApi(provider, modelId, systemPrompt, messages, assistantMsg, signal, fromBubble) {
		const apiMessages = [];
		if (systemPrompt) {
			apiMessages.push({ role: "system", content: systemPrompt });
		}
		messages.forEach(function (m) {
			apiMessages.push({ role: m.role, content: m.content });
		});

		const body = {
			model: modelId,
			messages: apiMessages,
			stream: true,
		};

		if (provider.type === "openrouter" && config.webSearch) {
			body.plugins = [{ id: "web", max_results: 5 }];
		}

		const headers = {
			"Content-Type": "application/json",
		};
		if (provider.apiKey) {
			headers["Authorization"] = "Bearer " + provider.apiKey;
		}
		if (provider.type === "openrouter") {
			headers["HTTP-Referer"] = window.location.origin;
			headers["X-Title"] = "BrowChat";
		}

		const response = await fetch(provider.baseUrl.replace(/\/$/, "") + "/chat/completions", {
			method: "POST",
			headers: headers,
			body: JSON.stringify(body),
			signal: signal,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error("HTTP " + response.status + ": " + errText.slice(0, 240));
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (payload === "[DONE]") continue;

				try {
					const json = JSON.parse(payload);
					const choice = json.choices && json.choices[0];
					const delta = choice && choice.delta;
					if (delta && typeof delta.content === "string") {
						assistantMsg.content += delta.content;
						renderMessages();
					}
					const annotations = (delta && delta.annotations) || (choice && choice.message && choice.message.annotations);
					if (Array.isArray(annotations)) {
						annotations.forEach(function (ann) {
							if (ann.type === "url_citation" && ann.url_citation && ann.url_citation.url) {
								if (!assistantMsg.sources.some(function (s) { return s.url === ann.url_citation.url; })) {
									assistantMsg.sources.push({
										title: ann.url_citation.title || ann.url_citation.url,
										url: ann.url_citation.url,
									});
								}
							}
						});
					}
				} catch (e) {}
			}
		}

		if (fromBubble) {
			lastBubbleReply = assistantMsg.content;
			syncBubbleCard(true);
		}
	}

	async function callGeminiApi(provider, modelId, systemPrompt, messages, assistantMsg, signal, fromBubble) {
		const contents = messages.map(function (m) {
			return {
				role: m.role === "assistant" ? "model" : "user",
				parts: [{ text: m.content }],
			};
		});

		const body = {
			contents: contents,
		};

		if (systemPrompt) {
			body.systemInstruction = { parts: [{ text: systemPrompt }] };
		}

		if (config.webSearch) {
			body.tools = [{ google_search: {} }];
		}

		const url =
			provider.baseUrl.replace(/\/$/, "") +
			"/models/" +
			encodeURIComponent(modelId) +
			":generateContent?key=" +
			encodeURIComponent(provider.apiKey);

		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: signal,
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error("Gemini HTTP " + response.status + ": " + errText.slice(0, 240));
		}

		const data = await response.json();
		const cand = data.candidates && data.candidates[0];
		const parts = (cand && cand.content && cand.content.parts) || [];
		assistantMsg.content = parts.map(function (p) { return p.text || ""; }).join("");

		const chunks = cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks;
		if (Array.isArray(chunks)) {
			chunks.forEach(function (ch) {
				if (ch.web && ch.web.uri) {
					assistantMsg.sources.push({
						title: ch.web.title || ch.web.uri,
						url: ch.web.uri,
					});
				}
			});
		}

		renderMessages();
		if (fromBubble) {
			lastBubbleReply = assistantMsg.content;
			syncBubbleCard(true);
		}
	}

	// =========================================================
	// Export Chat (Markdown / JSON -> triggers universal BrowOS Save modal)
	// =========================================================
	function triggerFileSave(filename, mime, content) {
		const blob = new Blob([content], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
	}

	document.getElementById("exportMdBtn").onclick = function () {
		const chat = getActiveChat();
		const md =
			"# " + chat.title + "\n\n" +
			chat.messages
				.map(function (m) {
					return "### " + (m.role === "user" ? "User" : m.modelLabel || "Assistant") + "\n\n" + m.content;
				})
				.join("\n\n---\n\n");
		const safeName = (chat.title || "browchat").replace(/[^a-z0-9-_]+/gi, "_").toLowerCase() + ".md";
		triggerFileSave(safeName, "text/markdown", md);
	};

	document.getElementById("exportJsonBtn").onclick = function () {
		const chat = getActiveChat();
		const safeName = (chat.title || "browchat").replace(/[^a-z0-9-_]+/gi, "_").toLowerCase() + ".json";
		triggerFileSave(safeName, "application/json", JSON.stringify(chat, null, 2));
	};

	// =========================================================
	// Providers Manager Modal (List View -> + Add Provider -> Edit/Save)
	// =========================================================
	const providersModal = document.getElementById("providersModal");
	const providersModalTitle = document.getElementById("providersModalTitle");
	const providersListView = document.getElementById("providersListView");
	const addedProvidersList = document.getElementById("addedProvidersList");
	const providerEditorView = document.getElementById("providerEditorView");

	const provTypeSelect = document.getElementById("provTypeSelect");
	const provNameInput = document.getElementById("provNameInput");
	const provBaseUrlInput = document.getElementById("provBaseUrlInput");
	const provApiKeyInput = document.getElementById("provApiKeyInput");
	const providerFormStatus = document.getElementById("providerFormStatus");
	const customModelIdInput = document.getElementById("customModelIdInput");
	const searchProviderModelsInput = document.getElementById("searchProviderModelsInput");
	const providerModelsChecklist = document.getElementById("providerModelsChecklist");

	function openProvidersModal(startInAddForm) {
		if (startInAddForm) {
			openProviderEditorForm(null);
		} else {
			showProvidersListView();
		}
		providersModal.hidden = false;
	}

	function showProvidersListView() {
		providersModalTitle.textContent = "Providers & Models";
		providersListView.hidden = false;
		providerEditorView.hidden = true;
		renderAddedProvidersList();
	}

	function renderAddedProvidersList() {
		addedProvidersList.innerHTML = "";

		if (!config.providers.length) {
			const empty = document.createElement("div");
			empty.className = "status-text";
			empty.style.cssText = "padding:18px;text-align:center;border:1px dashed var(--border-strong);border-radius:12px;";
			empty.textContent = "No providers added yet. Click \"+ Add Provider\" above to connect OpenRouter, Gemini, Groq, OpenAI, or Ollama.";
			addedProvidersList.appendChild(empty);
			return;
		}

		config.providers.forEach(function (prov) {
			const row = document.createElement("div");
			row.className = "provider-card-row";

			const info = document.createElement("div");
			info.className = "provider-card-info";

			const visibleCount = (prov.models || []).filter(function (m) { return m.visible; }).length;
			const nameEl = document.createElement("div");
			nameEl.className = "provider-card-name";
			nameEl.textContent = prov.name + (prov.enabled ? "" : " (Disabled)");

			const subEl = document.createElement("div");
			subEl.className = "provider-card-sub";
			subEl.textContent = prov.baseUrl + " · " + visibleCount + " visible model" + (visibleCount === 1 ? "" : "s");

			info.append(nameEl, subEl);

			const actions = document.createElement("div");
			actions.className = "provider-card-actions";

			const toggleBtn = document.createElement("button");
			toggleBtn.type = "button";
			toggleBtn.className = "btn";
			toggleBtn.textContent = prov.enabled ? "Disable" : "Enable";
			toggleBtn.onclick = function () {
				prov.enabled = !prov.enabled;
				persistConfig();
				renderModelDropdown();
				renderAddedProvidersList();
			};

			const editBtn = document.createElement("button");
			editBtn.type = "button";
			editBtn.className = "btn";
			editBtn.textContent = "Edit";
			editBtn.onclick = function () {
				openProviderEditorForm(prov.id);
			};

			const delBtn = document.createElement("button");
			delBtn.type = "button";
			delBtn.className = "btn danger";
			delBtn.textContent = "Delete";
			delBtn.onclick = function () {
				config.providers = config.providers.filter(function (p) { return p.id !== prov.id; });
				persistConfig();
				renderModelDropdown();
				renderAddedProvidersList();
				renderMessages();
			};

			actions.append(toggleBtn, editBtn, delBtn);
			row.append(info, actions);
			addedProvidersList.appendChild(row);
		});
	}

	function openProviderEditorForm(existingId) {
		providersListView.hidden = true;
		providerEditorView.hidden = false;
		providerFormStatus.textContent = "";
		searchProviderModelsInput.value = "";

		if (existingId) {
			const existing = config.providers.find(function (p) { return p.id === existingId; });
			if (existing) {
				draftProviderId = existing.id;
				providersModalTitle.textContent = "Edit Provider";
				provTypeSelect.value = existing.type || "openrouter";
				provNameInput.value = existing.name || "";
				provBaseUrlInput.value = existing.baseUrl || "";
				provApiKeyInput.value = existing.apiKey || "";
				draftProviderModels = JSON.parse(JSON.stringify(existing.models || []));
				renderDraftModelsChecklist();
				return;
			}
		}

		draftProviderId = null;
		providersModalTitle.textContent = "Add Provider";
		provTypeSelect.value = "openrouter";
		applyProviderTypeDefaults("openrouter");
	}

	function applyProviderTypeDefaults(typeKey) {
		const preset = PROVIDER_PRESETS[typeKey] || PROVIDER_PRESETS.openrouter;
		provNameInput.value = preset.name;
		provBaseUrlInput.value = preset.baseUrl;
		provApiKeyInput.value = "";
		draftProviderModels = JSON.parse(JSON.stringify(preset.defaultModels));
		renderDraftModelsChecklist();
	}

	provTypeSelect.onchange = function () {
		if (!draftProviderId) {
			applyProviderTypeDefaults(provTypeSelect.value);
		} else {
			const preset = PROVIDER_PRESETS[provTypeSelect.value];
			if (preset) {
				provBaseUrlInput.value = preset.baseUrl;
			}
		}
	};

	function renderDraftModelsChecklist() {
		const q = (searchProviderModelsInput.value || "").trim().toLowerCase();
		providerModelsChecklist.innerHTML = "";

		const filtered = draftProviderModels.filter(function (m) {
			return !q || m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q);
		});

		if (!filtered.length) {
			const empty = document.createElement("div");
			empty.className = "status-text";
			empty.style.padding = "10px";
			empty.textContent = "No models match your search.";
			providerModelsChecklist.appendChild(empty);
			return;
		}

		filtered.forEach(function (m) {
			const row = document.createElement("div");
			row.className = "model-check-row";

			const lbl = document.createElement("label");
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.checked = Boolean(m.visible);
			cb.onchange = function () {
				m.visible = cb.checked;
			};

			const span = document.createElement("span");
			span.textContent = m.name && m.name !== m.id ? m.name + " (" + m.id + ")" : m.id;
			lbl.append(cb, span);

			const rmBtn = document.createElement("button");
			rmBtn.type = "button";
			rmBtn.className = "chat-item-del";
			rmBtn.textContent = "×";
			rmBtn.onclick = function () {
				draftProviderModels = draftProviderModels.filter(function (x) { return x.id !== m.id; });
				renderDraftModelsChecklist();
			};

			row.append(lbl, rmBtn);
			providerModelsChecklist.appendChild(row);
		});
	}

	searchProviderModelsInput.oninput = renderDraftModelsChecklist;

	document.getElementById("addManualModelBtn").onclick = function () {
		const val = customModelIdInput.value.trim();
		if (!val) return;
		if (!draftProviderModels.some(function (m) { return m.id === val; })) {
			draftProviderModels.unshift({ id: val, name: val, visible: true });
			renderDraftModelsChecklist();
		}
		customModelIdInput.value = "";
	};

	document.getElementById("fetchProviderModelsBtn").onclick = async function () {
		const type = provTypeSelect.value;
		const baseUrl = provBaseUrlInput.value.trim().replace(/\/$/, "");
		const apiKey = provApiKeyInput.value.trim();

		if (!baseUrl) {
			providerFormStatus.textContent = "Enter API Base URL first.";
			return;
		}

		providerFormStatus.textContent = "Fetching models...";
		try {
			let fetched = [];
			if (type === "gemini") {
				if (!apiKey) throw new Error("Enter Gemini API key first.");
				const res = await fetch(baseUrl + "/models?key=" + encodeURIComponent(apiKey));
				if (!res.ok) throw new Error("HTTP " + res.status);
				const data = await res.json();
				fetched = (data.models || [])
					.filter(function (m) { return (m.supportedGenerationMethods || []).includes("generateContent"); })
					.map(function (m) {
						const cleanId = m.name.replace(/^models\//, "");
						return { id: cleanId, name: m.displayName || cleanId };
					});
			} else {
				const headers = {};
				if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
				const res = await fetch(baseUrl + "/models", { headers: headers });
				if (!res.ok) throw new Error("HTTP " + res.status);
				const data = await res.json();
				fetched = (data.data || []).map(function (m) {
					return { id: m.id, name: m.name || m.id };
				});
			}

			const existingMap = new Map(draftProviderModels.map(function (m) { return [m.id, m]; }));
			fetched.forEach(function (item) {
				if (!existingMap.has(item.id)) {
					existingMap.set(item.id, { id: item.id, name: item.name, visible: false });
				}
			});
			draftProviderModels = Array.from(existingMap.values());
			renderDraftModelsChecklist();
			providerFormStatus.textContent = "Loaded " + fetched.length + " models. Search & check the ones you want.";
		} catch (err) {
			providerFormStatus.textContent = "Failed: " + (err && err.message ? err.message : "Error");
		}
	};

	document.getElementById("saveProviderFormBtn").onclick = function () {
		const type = provTypeSelect.value;
		const name = provNameInput.value.trim() || (PROVIDER_PRESETS[type] && PROVIDER_PRESETS[type].name) || "Provider";
		const baseUrl = provBaseUrlInput.value.trim();
		const apiKey = provApiKeyInput.value.trim();

		if (!baseUrl) {
			providerFormStatus.textContent = "API Base URL is required.";
			return;
		}

		if (draftProviderId) {
			const existing = config.providers.find(function (p) { return p.id === draftProviderId; });
			if (existing) {
				existing.type = type;
				existing.name = name;
				existing.baseUrl = baseUrl;
				existing.apiKey = apiKey;
				existing.models = draftProviderModels;
			}
		} else {
			const newId = "prov-" + Date.now();
			config.providers.push({
				id: newId,
				type: type,
				name: name,
				enabled: true,
				baseUrl: baseUrl,
				apiKey: apiKey,
				models: draftProviderModels,
			});
			const firstVis = draftProviderModels.find(function (m) { return m.visible; });
			if (firstVis) {
				config.selectedModel = newId + "::" + firstVis.id;
			}
		}

		persistConfig();
		renderModelDropdown();
		renderMessages();
		showProvidersListView();
	};

	document.getElementById("showAddProviderFormBtn").onclick = function () {
		openProviderEditorForm(null);
	};

	document.getElementById("cancelProviderFormBtn").onclick = showProvidersListView;

	// =========================================================
	// Skills (Multi-Select + Disable All) & Bubble Modal
	// =========================================================
	const skillsModal = document.getElementById("skillsModal");
	const skillsListEl = document.getElementById("skillsList");
	const skillEditor = document.getElementById("skillEditor");
	const skillNameInput = document.getElementById("skillNameInput");
	const skillPromptInput = document.getElementById("skillPromptInput");
	const bubbleAutoSyncToggle = document.getElementById("bubbleAutoSyncToggle");
	const bubblePresetsInput = document.getElementById("bubblePresetsInput");

	function renderSkillsModal() {
		bubbleAutoSyncToggle.checked = Boolean(config.bubbleAutoSync);
		bubblePresetsInput.value = (config.bubblePresets || []).join(", ");

		const activeSet = new Set(config.activeSkillIds || []);
		skillsListEl.innerHTML = "";

		config.skills.forEach(function (sk) {
			const row = document.createElement("div");
			row.className = "skill-row";

			const lbl = document.createElement("label");
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.checked = activeSet.has(sk.id);
			cb.onchange = function () {
				const next = new Set(config.activeSkillIds || []);
				if (cb.checked) next.add(sk.id);
				else next.delete(sk.id);
				config.activeSkillIds = Array.from(next);
				persistConfig();
				renderSkillsControls();
			};

			const title = document.createElement("span");
			title.textContent = sk.name;
			lbl.append(cb, title);

			const btns = document.createElement("div");
			btns.style.display = "flex";
			btns.style.gap = "6px";

			const editBtn = document.createElement("button");
			editBtn.type = "button";
			editBtn.className = "btn";
			editBtn.textContent = "Edit";
			editBtn.onclick = function () {
				editingSkillId = sk.id;
				skillNameInput.value = sk.name;
				skillPromptInput.value = sk.prompt;
				skillEditor.hidden = false;
			};

			const delBtn = document.createElement("button");
			delBtn.type = "button";
			delBtn.className = "btn danger";
			delBtn.textContent = "Delete";
			delBtn.onclick = function () {
				config.skills = config.skills.filter(function (x) { return x.id !== sk.id; });
				config.activeSkillIds = (config.activeSkillIds || []).filter(function (id) { return id !== sk.id; });
				persistConfig();
				renderSkillsControls();
				renderSkillsModal();
			};

			btns.append(editBtn, delBtn);
			row.append(lbl, btns);
			skillsListEl.appendChild(row);
		});
	}

	document.getElementById("disableAllSkillsModalBtn").onclick = function () {
		config.activeSkillIds = [];
		persistConfig();
		renderSkillsControls();
		renderSkillsModal();
	};

	document.getElementById("saveBubblePrefsBtn").onclick = function () {
		config.bubbleAutoSync = bubbleAutoSyncToggle.checked;
		config.bubblePresets = bubblePresetsInput.value
			.split(",")
			.map(function (s) { return s.trim(); })
			.filter(Boolean)
			.slice(0, 3);
		persistConfig();
		if (config.bubbleAutoSync) syncBubbleCard(true);
		else hideBubbleCard();
	};

	document.getElementById("hideBubbleCardBtn").onclick = hideBubbleCard;

	document.getElementById("newSkillBtn").onclick = function () {
		editingSkillId = null;
		skillNameInput.value = "";
		skillPromptInput.value = "";
		skillEditor.hidden = false;
	};

	document.getElementById("cancelSkillBtn").onclick = function () {
		skillEditor.hidden = true;
	};

	document.getElementById("saveSkillBtn").onclick = function () {
		const name = skillNameInput.value.trim();
		const prompt = skillPromptInput.value.trim();
		if (!name || !prompt) return;

		if (editingSkillId) {
			const target = config.skills.find(function (s) { return s.id === editingSkillId; });
			if (target) {
				target.name = name;
				target.prompt = prompt;
			}
		} else {
			const newId = "skill-" + Date.now();
			config.skills.push({ id: newId, name: name, prompt: prompt });
			config.activeSkillIds = Array.from(new Set((config.activeSkillIds || []).concat(newId)));
		}
		skillEditor.hidden = true;
		persistConfig();
		renderSkillsControls();
		renderSkillsModal();
	};

	document.getElementById("uploadSkillBtn").onclick = function () {
		document.getElementById("skillFileInput").click();
	};

	document.getElementById("skillFileInput").onchange = async function (e) {
		const file = e.target.files && e.target.files[0];
		e.target.value = "";
		if (!file) return;
		const content = await file.text();
		const cleanName = file.name.replace(/\.[^.]+$/, "");
		const newId = "skill-" + Date.now();
		config.skills.push({ id: newId, name: cleanName, prompt: content });
		config.activeSkillIds = Array.from(new Set((config.activeSkillIds || []).concat(newId)));
		persistConfig();
		renderSkillsControls();
		renderSkillsModal();
	};

	// =========================================================
	// General Event Wiring
	// =========================================================
	toggleSidebarBtn.onclick = function () {
		sidebarEl.classList.toggle("collapsed");
	};

	newChatBtn.onclick = function () {
		const newChat = {
			id: "chat-" + Date.now(),
			title: "New Chat",
			updatedAt: Date.now(),
			messages: [],
		};
		chats.unshift(newChat);
		activeChatId = newChat.id;
		persistChats();
		renderChatList();
		renderMessages();
	};

	historySearch.oninput = renderChatList;

	modelSelect.onchange = function () {
		if (!modelSelect.value) {
			openProvidersModal(true);
			return;
		}
		config.selectedModel = modelSelect.value;
		persistConfig();
	};

	webSearchToggleBtn.classList.toggle("active", Boolean(config.webSearch));
	webSearchToggleBtn.onclick = function () {
		config.webSearch = !config.webSearch;
		webSearchToggleBtn.classList.toggle("active", config.webSearch);
		persistConfig();
	};

	attachFileBtn.onclick = function () {
		hiddenFileInput.click();
	};

	hiddenFileInput.onchange = async function () {
		const files = Array.from(hiddenFileInput.files || []);
		hiddenFileInput.value = "";
		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			const text = await f.text();
			pendingAttachments.push({ name: f.name, content: text.slice(0, 60000) });
		}
		renderAttachments();
	};

	promptInput.addEventListener("input", function () {
		promptInput.style.height = "auto";
		promptInput.style.height = Math.min(150, promptInput.scrollHeight) + "px";
	});

	promptInput.addEventListener("keydown", function (e) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	sendBtn.onclick = function () { sendMessage(); };
	stopBtn.onclick = function () {
		if (activeAbort) activeAbort.abort();
	};

	document.getElementById("syncBubbleBtn").onclick = function () { syncBubbleCard(true); };
	document.getElementById("openProvidersBtn").onclick = function () { openProvidersModal(false); };
	document.getElementById("openSkillsBtn").onclick = function () {
		renderSkillsModal();
		skillsModal.hidden = false;
	};

	document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
		btn.onclick = function () {
			const target = document.getElementById(btn.dataset.closeModal);
			if (target) target.hidden = true;
		};
	});

	// Initial Render
	renderModelDropdown();
	renderSkillsControls();
	renderChatList();
	renderMessages();
	if (config.bubbleAutoSync) {
		syncBubbleCard(false);
	}
})();
