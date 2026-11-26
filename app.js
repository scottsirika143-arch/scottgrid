// ScottGrid Core Application Module

const STORAGE_KEYS = {
  session: "scottgrid.session.v1",
  profile: "scottgrid.profile.v1",
  wallet: "scottgrid.wallet.v1",
  statuses: "scottgrid.statuses.v1",
  feed: "scottgrid.feed.v1",
  chats: "scottgrid.chats.v1",
  chatTheme: "scottgrid.chatTheme.v1",
};

const MIN_BASELINE_USD = 0.84;
const EARN_PER_MINUTE = 0.5;
const SGT_PER_MINUTE = 1.0;

const CURRENCY_RATES = {
  USD: { symbol: "$", rate: 1, decimals: 2 },
  UGX: { symbol: "UGX ", rate: 3700, decimals: 0 },
  EUR: { symbol: "â‚¬", rate: 0.92, decimals: 2 },
};

const DEFAULT_PROFILE = {
  email: "",
  handle: "@scott",
  displayName: "Scott",
  bio: "",
  ghostMode: false,
  displayCurrency: "USD",
  avatarDataUrl: "",
};

function createDefaultWallet(now = Date.now()) {
  return {
    usdBalance: MIN_BASELINE_USD,
    sgtTokens: MIN_BASELINE_USD,
    pendingRewards: MIN_BASELINE_USD,
    lastEarnedAt: now,
    transactions: [],
  };
}

function createDefaultChats() {
  return [
    {
      id: "mesh-lobby",
      name: "Grid Mesh",
      subtitle: "Local signal room Â· Online",
      avatar: "GM",
      unread: 1,
      favorite: true,
      isGroup: true,
      lastTime: "Now",
      messages: [
        {
          id: "m-1",
          sender: "Grid Mesh",
          text: "Welcome to ScottGrid. Mesh signal is live.",
          time: "Just now",
          outgoing: false,
        },
      ],
    },
    {
      id: "signal-ops",
      name: "Signal Relay",
      subtitle: "Mesh node Â· Active",
      avatar: "SR",
      unread: 0,
      favorite: false,
      isGroup: false,
      lastTime: "2m",
      messages: [
        {
          id: "m-2",
          sender: "Signal Relay",
          text: "Peer discovery ready when nearby nodes come online.",
          time: "2m ago",
          outgoing: false,
        },
      ],
    },
  ];
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors on large media
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getInitials(nameOrHandle) {
  const raw = String(nameOrHandle || "").trim();
  const clean = raw.replace(/^@+/, "").trim();
  if (!clean || clean.toLowerCase() === "member") return "S";
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 1).toUpperCase();
}

function formatMoney(usdAmount, currencyCode = "USD") {
  const cfg = CURRENCY_RATES[currencyCode] || CURRENCY_RATES.USD;
  const converted = Number(usdAmount || 0) * cfg.rate;
  const formatted =
    cfg.decimals === 0
      ? Math.round(converted).toLocaleString("en-US")
      : converted.toLocaleString("en-US", {
          minimumFractionDigits: cfg.decimals,
          maximumFractionDigits: cfg.decimals,
        });
  return `${cfg.symbol}${formatted}`;
}

const state = {
  authenticated: false,
  activeTab: "nearby",
  searchQuery: "",
  profile: { ...DEFAULT_PROFILE },
  wallet: createDefaultWallet(),
  statuses: [],
  feed: [],
  chats: createDefaultChats(),
  activeChatId: null,
  chatFilter: "all",
  pendingStatusMedia: null,
  pendingFeedMedia: null,
  pendingChatMedia: null,
  callStream: null,
  micEnabled: true,
  camEnabled: true,
  mediaRecorder: null,
  audioChunks: [],
};

// --- SESSION & PERSISTENCE ---
function syncWalletTicks(now = Date.now()) {
  const last = Number(state.wallet.lastEarnedAt || now);
  const elapsedMs = Math.max(0, now - last);
  const elapsedMinutes = elapsedMs / 60000;

  if (Number(state.wallet.usdBalance || 0) < MIN_BASELINE_USD) {
    state.wallet.usdBalance = MIN_BASELINE_USD;
  }
  if (Number(state.wallet.sgtTokens || 0) < MIN_BASELINE_USD) {
    state.wallet.sgtTokens = MIN_BASELINE_USD;
  }
  if (Number(state.wallet.pendingRewards || 0) < MIN_BASELINE_USD) {
    state.wallet.pendingRewards = MIN_BASELINE_USD;
  }

  if (elapsedMinutes > 0 && state.authenticated) {
    const earnedUsd = elapsedMinutes * EARN_PER_MINUTE;
    const earnedSgt = elapsedMinutes * SGT_PER_MINUTE;
    state.wallet.usdBalance = Number((Number(state.wallet.usdBalance || 0) + earnedUsd).toFixed(4));
    state.wallet.sgtTokens = Number((Number(state.wallet.sgtTokens || 0) + earnedSgt).toFixed(4));
    state.wallet.pendingRewards = Number(
      (Number(state.wallet.pendingRewards || 0) + earnedUsd).toFixed(4)
    );
  }

  state.wallet.lastEarnedAt = now;
  saveJson(STORAGE_KEYS.wallet, state.wallet);
}

function deriveIdentityFromEmail(email) {
  const clean = String(email || "").trim().toLowerCase();
  const localPart = clean.includes("@") ? clean.split("@")[0] : clean;
  const tokens = localPart.split(/[^a-z0-9]+/).filter(Boolean);
  const displayName = tokens.length
    ? tokens.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : "Member";
  const handleBase = tokens.join("").replace(/[^a-z0-9_]/g, "") || "member";
  return {
    displayName,
    handle: `@${handleBase}`,
    email: clean,
  };
}

function getProfileStorageKey(email) {
  const clean = String(email || "").trim().toLowerCase();
  return clean ? `${STORAGE_KEYS.profile}:${clean}` : STORAGE_KEYS.profile;
}

function hydrateState() {
  const session = loadJson(STORAGE_KEYS.session, null);
  const activeEmail = String(session?.email || "").trim().toLowerCase();
  const scopedProfile = activeEmail ? loadJson(getProfileStorageKey(activeEmail), null) : null;
  const fallbackProfile = loadJson(STORAGE_KEYS.profile, null);
  const savedProfile = scopedProfile || (!activeEmail ? fallbackProfile : null);
  const savedWallet = loadJson(STORAGE_KEYS.wallet, null);
  const savedStatuses = loadJson(STORAGE_KEYS.statuses, []);
  const savedFeed = loadJson(STORAGE_KEYS.feed, []);
  const savedChats = loadJson(STORAGE_KEYS.chats, null);
  const savedTheme = localStorage.getItem(STORAGE_KEYS.chatTheme) || "midnight";

  state.authenticated = Boolean(session && session.signedIn);

  const derived = activeEmail ? deriveIdentityFromEmail(activeEmail) : null;
  const rawName = savedProfile?.displayName || derived?.displayName || "";
  const rawHandle = savedProfile?.handle || derived?.handle || "";
  const normalizedName =
    !rawName || rawName.trim().toLowerCase() === "member" ? "Member" : rawName;
  const normalizedHandle =
    !rawHandle || rawHandle.trim().toLowerCase() === "@member" ? "@member" : rawHandle;

  state.profile = {
    ...DEFAULT_PROFILE,
    ...(savedProfile || {}),
    displayName: normalizedName,
    handle: normalizedHandle,
    email: activeEmail || savedProfile?.email || "",
  };
  saveJson(getProfileStorageKey(state.profile.email), state.profile);

  const now = Date.now();
  const baseWallet = createDefaultWallet(now);
  state.wallet = {
    ...baseWallet,
    ...(savedWallet || {}),
    usdBalance: Math.max(MIN_BASELINE_USD, Number(savedWallet?.usdBalance ?? MIN_BASELINE_USD)),
    sgtTokens: Math.max(MIN_BASELINE_USD, Number(savedWallet?.sgtTokens ?? MIN_BASELINE_USD)),
    pendingRewards: Math.max(
      MIN_BASELINE_USD,
      Number(savedWallet?.pendingRewards ?? MIN_BASELINE_USD)
    ),
    lastEarnedAt: Number(savedWallet?.lastEarnedAt || now),
  };

  const dayAgo = now - 24 * 60 * 60 * 1000;
  state.statuses = Array.isArray(savedStatuses)
    ? savedStatuses
        .filter((item) => Number(item.createdAt || 0) >= dayAgo)
        .map((item) => ({
          ...item,
          author:
            !item.author || String(item.author).trim().toLowerCase() === "member"
              ? state.profile.displayName
              : item.author,
        }))
    : [];

  state.feed = Array.isArray(savedFeed) ? savedFeed : [];
  state.chats = Array.isArray(savedChats) && savedChats.length ? savedChats : createDefaultChats();

  const chatSection = document.getElementById("tab-chats");
  const themeSelect = document.getElementById("chat-theme-select");
  if (chatSection) chatSection.setAttribute("data-chat-theme", savedTheme);
  if (themeSelect) themeSelect.value = savedTheme;

  if (state.authenticated) {
    syncWalletTicks(now);
  }
}

function setAuthState(signedIn, email = "") {
  state.authenticated = signedIn;
  const cleanEmail = String(email || state.profile.email || "").trim().toLowerCase();
  if (cleanEmail) {
    const existingForEmail = loadJson(getProfileStorageKey(cleanEmail), null);
    const derived = deriveIdentityFromEmail(cleanEmail);
    state.profile = {
      ...DEFAULT_PROFILE,
      ...(existingForEmail || {}),
      displayName: existingForEmail?.displayName || derived.displayName,
      handle: existingForEmail?.handle || derived.handle,
      email: cleanEmail,
    };
  }
  saveJson(STORAGE_KEYS.session, {
    signedIn,
    email: cleanEmail,
  });
  saveJson(getProfileStorageKey(cleanEmail), state.profile);
  state.wallet.lastEarnedAt = Date.now();
  saveJson(STORAGE_KEYS.wallet, state.wallet);
  renderAll();
}

// --- NAVIGATION & TABS ---
function switchTab(tabName) {
  const validTabs = ["nearby", "chats", "status", "feed", "wallet", "me"];
  if (!validTabs.includes(tabName)) return;
  state.activeTab = tabName;

  document.querySelectorAll(".sg-tab-pane").forEach((pane) => {
    pane.style.display = pane.id === `tab-${tabName}` ? "block" : "none";
  });

  document.querySelectorAll(".sg-nav-btn").forEach((btn) => {
    const isCurrent = btn.getAttribute("data-tab") === tabName;
    btn.classList.toggle("is-active", isCurrent);
    btn.classList.toggle("active", isCurrent);
  });

  if (tabName === "chats") {
    renderChatsTab();
  } else if (tabName === "status") {
    renderStatusTab();
  } else if (tabName === "feed") {
    renderFeedTab();
  } else if (tabName === "wallet") {
    syncWalletTicks(Date.now());
    renderWalletTab();
  } else if (tabName === "me") {
    renderMeTab();
  }
}

// --- RENDERERS ---
function applyAvatarElement(el, initials, avatarDataUrl) {
  if (!el) return;
  if (el.tagName === "IMG") {
    if (avatarDataUrl) {
      el.src = avatarDataUrl;
      el.style.display = "block";
    } else {
      el.removeAttribute("src");
      el.style.display = "none";
    }
    return;
  }

  if (avatarDataUrl) {
    el.innerHTML = `<img src="${escapeHtml(avatarDataUrl)}" alt="Avatar" style="width:100%;height:100%;border-radius:999px;object-fit:cover;display:block;" />`;
  } else {
    el.textContent = initials;
  }
}

function renderHeaderAndNearby() {
  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");

  if (!state.authenticated) {
    if (authView) authView.style.display = "flex";
    if (appView) appView.style.display = "none";
    return;
  }

  if (authView) authView.style.display = "none";
  if (appView) appView.style.display = "block";

  const labelSource = state.profile.displayName || state.profile.handle || "Scott";
  const initials = getInitials(labelSource);
  const avatarUrl = state.profile.avatarDataUrl || "";

  applyAvatarElement(document.getElementById("radar-avatar"), initials, avatarUrl);
  applyAvatarElement(document.getElementById("status-avatar"), initials, avatarUrl);
  applyAvatarElement(document.getElementById("me-avatar"), initials, avatarUrl);
  applyAvatarElement(document.getElementById("me-avatar-img"), initials, avatarUrl);

  const meAvatarSpan = document.getElementById("me-avatar");
  const meAvatarImg = document.getElementById("me-avatar-img");
  if (meAvatarSpan && meAvatarImg) {
    if (avatarUrl) {
      meAvatarSpan.style.display = "none";
      meAvatarImg.style.display = "block";
      meAvatarImg.src = avatarUrl;
    } else {
      meAvatarImg.style.display = "none";
      meAvatarSpan.style.display = "flex";
      meAvatarSpan.textContent = initials;
    }
  }

  const radarLabel = document.getElementById("radar-you-label");
  if (radarLabel) {
    radarLabel.textContent = state.profile.ghostMode ? "You (Ghost)" : "You";
  }

  const meshPill = document.getElementById("mesh-status-pill");
  if (meshPill) {
    meshPill.innerHTML = state.profile.ghostMode
      ? `<span class="sg-dot"></span> Ghost Mode`
      : `<span class="sg-dot"></span> Mesh Active`;
  }

  const nearbyCountPill = document.getElementById("nearby-count-pill");
  if (nearbyCountPill) {
    nearbyCountPill.textContent = "0 People Nearby";
  }

  const navName = document.getElementById("nav-display-name");
  const navHandle = document.getElementById("nav-handle");
  if (navName) navName.textContent = state.profile.displayName || "Scott";
  if (navHandle) navHandle.textContent = state.profile.handle || "@scott";
}

function renderStatusTab() {
  const strip = document.getElementById("status-circles-strip");
  if (!strip) return;

  const initials = getInitials(state.profile.displayName || state.profile.handle || "Scott");
  const avatarUrl = state.profile.avatarDataUrl || "";
  const myAvatarInner = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="My story" class="sg-status-ring-avatar" />`
    : `<div id="status-avatar" class="sg-status-ring-avatar">${escapeHtml(initials)}</div>`;

  const myStoryItemHtml = `
    <div class="sg-story-item sg-story-ring-item ${state.statuses.length ? "has-story" : ""}" id="my-story-trigger">
      <div class="sg-status-mine">
        ${myAvatarInner}
        <button
          id="add-status-btn"
          type="button"
          class="sg-status-plus"
          title="Pick Photo or Video"
          aria-label="Pick Photo or Video"
        >+</button>
      </div>
      <span class="sg-story-label">My story</span>
    </div>
  `;

  const visibleStatuses = state.statuses.filter((s) => {
    if (!state.searchQuery) return true;
    const q = state.searchQuery.toLowerCase();
    return (
      String(s.caption || "").toLowerCase().includes(q) ||
      String(s.author || "").toLowerCase().includes(q)
    );
  });

  const ringsHtml = visibleStatuses
    .map((st, idx) => {
      const bubbleContent =
        st.mediaType === "image" && st.mediaUrl
          ? `<img src="${escapeHtml(st.mediaUrl)}" alt="Story" class="sg-status-ring-avatar" />`
          : `<div class="sg-status-ring-avatar">${escapeHtml(getInitials(st.author || "Scott"))}</div>`;
      return `
        <div class="sg-story-item sg-story-ring-item has-story" data-story-index="${idx}">
          <div class="sg-status-mine">
            ${bubbleContent}
          </div>
          <span class="sg-story-label">${escapeHtml(st.caption || "Scott")}</span>
        </div>
      `;
    })
    .join("");

  strip.innerHTML = myStoryItemHtml + ringsHtml;

  const addBtn = document.getElementById("add-status-btn");
  const mediaInput = document.getElementById("status-media-input");
  addBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!mediaInput) return;
    mediaInput.value = "";
    mediaInput.click();
  });

  document.getElementById("my-story-trigger")?.addEventListener("click", () => {
    if (state.statuses.length > 0) {
      openStoryModal(state.statuses[0]);
    } else if (mediaInput) {
      mediaInput.value = "";
      mediaInput.click();
    }
  });

  strip.querySelectorAll("[data-story-index]").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = Number(el.getAttribute("data-story-index"));
      if (visibleStatuses[idx]) openStoryModal(visibleStatuses[idx]);
    });
  });
}

function openStoryModal(story) {
  const modal = document.getElementById("story-modal");
  const authorEl = document.getElementById("story-viewer-author");
  const bodyEl = document.getElementById("story-viewer-body");
  if (!modal || !authorEl || !bodyEl) return;

  authorEl.textContent = story.author || "Scott";
  const mediaHtml =
    story.mediaType === "video"
      ? `<video src="${escapeHtml(story.mediaUrl)}" class="sg-story-preview-media" controls autoplay playsinline></video>`
      : story.mediaUrl
      ? `<img src="${escapeHtml(story.mediaUrl)}" alt="Story" class="sg-story-preview-media" />`
      : "";

  bodyEl.innerHTML = `
    ${mediaHtml}
    ${story.caption ? `<p class="sg-mt-10">${escapeHtml(story.caption)}</p>` : ""}
    <p class="sg-muted-caption sg-mt-10">${escapeHtml(story.timeLabel || "Active 24h status")}</p>
  `;
  modal.style.display = "flex";
}

function closeStoryModal() {
  const modal = document.getElementById("story-modal");
  if (modal) modal.style.display = "none";
}

// --- CHATS & CALLS ---
function getTotalUnread() {
  return state.chats.reduce((sum, t) => sum + Number(t.unread || 0), 0);
}

function normalizeMeshMessage(row) { const currentName = (state.profile?.displayName || "Scott").trim(); const sender = String(row?.sender || "Grid Node").trim(); const createdTime = row?.created_at ? new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now"; return { id: row?.id || `mesh-${Date.now()}`, sender, handle: String(row?.handle || "").trim(), text: String(row?.text || ""), time: createdTime, outgoing: sender.toLowerCase() === currentName.toLowerCase() }; } async function syncMeshLobbyMessages(roomId = "mesh-lobby") { const thread = state.chats.find((t) => t.id === roomId); if (!thread) return; try { const res = await fetch(`/api/mesh/messages?roomId=${encodeURIComponent(roomId)}`); const data = await res.json().catch(() => ({})); if (!res.ok || !data.ok || !Array.isArray(data.messages)) return; thread.messages = data.messages.map(normalizeMeshMessage); if (thread.messages.length > 0) { const lastMsg = thread.messages[thread.messages.length - 1]; thread.lastMessage = lastMsg.text || "Mesh signal"; thread.lastTime = lastMsg.time || "Now"; } saveJson(STORAGE_KEYS.chats, state.chats); if (state.activeTab === "chats" && state.activeChatId === roomId) { renderChatsTab(); } } catch {} } async function postMeshLobbyMessage({ text, sender, handle = "", roomId = "mesh-lobby" }) { const res = await fetch("/api/mesh/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, sender, handle, roomId }) }); const data = await res.json().catch(() => ({})); if (!res.ok || !data.ok || !data.message) { throw new Error(data?.error || "Failed to send mesh message"); } return normalizeMeshMessage(data.message); } function renderChatsTab() {
  const listView = document.getElementById("chat-list-view");
  const threadView = document.getElementById("chat-thread-view");
  const threadListEl = document.getElementById("chat-thread-list");
  const totalUnreadEl = document.getElementById("chat-total-unread");
  if (!listView || !threadView) return;

  if (totalUnreadEl) {
    totalUnreadEl.textContent = String(getTotalUnread());
  }

  if (!state.activeChatId) {
    listView.style.display = "block";
    threadView.style.display = "none";

    const filteredThreads = state.chats.filter((t) => {
      if (state.chatFilter === "unread" && Number(t.unread || 0) <= 0) return false;
      if (state.chatFilter === "favorites" && !t.favorite) return false;
      if (state.chatFilter === "groups" && !t.isGroup) return false;
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const lastMsg = t.messages?.[t.messages.length - 1]?.text || "";
        return (
          t.name.toLowerCase().includes(q) || lastMsg.toLowerCase().includes(q)
        );
      }
      return true;
    });

    if (threadListEl) {
      threadListEl.innerHTML = filteredThreads
        .map((t) => {
          const lastMsg = t.messages?.[t.messages.length - 1];
          const preview = lastMsg ? lastMsg.text : "Tap to start chatting";
          const hasUnread = Number(t.unread || 0) > 0;
          return `
            <button type="button" class="sg-wa-thread-row" data-open-thread="${escapeHtml(t.id)}">
              <div class="sg-wa-avatar">${escapeHtml(t.avatar || getInitials(t.name))}</div>
              <div class="sg-wa-thread-meta">
                <div class="sg-wa-thread-top">
                  <span class="sg-wa-name">${escapeHtml(t.name)}</span>
                  <span class="sg-wa-time ${hasUnread ? "is-unread" : ""}">${escapeHtml(t.lastTime || "")}</span>
                </div>
                <div class="sg-wa-thread-bottom">
                  <span class="sg-wa-preview">${escapeHtml(preview)}</span>
                  ${hasUnread ? `<span class="sg-wa-unread-badge">${escapeHtml(t.unread)}</span>` : ""}
                </div>
              </div>
            </button>
          `;
        })
        .join("");

      threadListEl.querySelectorAll("[data-open-thread]").forEach((btn) => {
        btn.addEventListener("click", () => {
          openChatThread(btn.getAttribute("data-open-thread"));
        });
      });
    }
    return;
  }

  const thread = state.chats.find((t) => t.id === state.activeChatId);
  if (!thread) {
    state.activeChatId = null;
    renderChatsTab();
    return;
  }

  listView.style.display = "none";
  threadView.style.display = "block";

  const avatarEl = document.getElementById("chat-active-avatar");
  const titleEl = document.getElementById("chat-active-title");
  const subEl = document.getElementById("chat-peer-sub");
  const messagesBox = document.getElementById("chat-messages-box");

  if (avatarEl) avatarEl.textContent = thread.avatar || getInitials(thread.name);
  if (titleEl) titleEl.textContent = thread.name;
  if (subEl) subEl.textContent = thread.subtitle || "Encrypted mesh";

  if (messagesBox) {
    if (!thread.messages || thread.messages.length === 0) {
      messagesBox.innerHTML = `<div id="chats-empty" class="sg-empty-state sg-mt-24">No messages in this chat yet.</div>`;
    } else {
      messagesBox.innerHTML = thread.messages
        .map((m) => {
          const mediaPart = m.mediaUrl
            ? m.mediaType === "video"
              ? `<video src="${escapeHtml(m.mediaUrl)}" class="sg-story-preview-media sg-mt-10" controls playsinline></video>`
              : `<img src="${escapeHtml(m.mediaUrl)}" alt="Attachment" class="sg-story-preview-media sg-mt-10" />`
            : "";
          const audioPart = m.audioUrl
            ? `<audio src="${escapeHtml(m.audioUrl)}" controls class="sg-mt-10" style="width:100%;max-height:32px;"></audio>`
            : "";
          return `
            <div class="sg-chat-bubble ${m.outgoing ? "is-outgoing" : ""}">
              <div class="sg-chat-meta">
                <strong>${escapeHtml(m.sender || "You")}</strong>
                <span>${escapeHtml(m.time || "")}${m.viewOnce ? " Â· 1x" : ""}</span>
              </div>
              ${m.text ? `<div>${escapeHtml(m.text)}</div>` : ""}
              ${mediaPart}
              ${audioPart}
            </div>
          `;
        })
        .join("");
      messagesBox.scrollTop = messagesBox.scrollHeight;
    }
  }
}

function openChatThread(threadId) {
  const thread = state.chats.find((t) => t.id === threadId);
  if (!thread) return;
  thread.unread = 0;
  state.activeChatId = threadId;
  saveJson(STORAGE_KEYS.chats, state.chats);
  renderChatsTab();
  if (threadId === "mesh-lobby" && typeof syncMeshLobbyMessages === "function") {
    syncMeshLobbyMessages(threadId);
  }
}

function syncComposerActionButtons() {
  const input = document.getElementById("chat-text-input");
  const voiceBtn = document.getElementById("record-voice-btn");
  const sendBtn = document.getElementById("chat-send-btn");
  const hasContent = Boolean((input?.value || "").trim() || state.pendingChatMedia);

  if (voiceBtn) voiceBtn.style.display = hasContent ? "none" : "inline-flex";
  if (sendBtn) sendBtn.style.display = hasContent ? "inline-flex" : "none";
}

async function openCallModal(mode) {
  const modal = document.getElementById("call-modal");
  const titleEl = document.getElementById("call-modal-title");
  const placeholderEl = document.getElementById("call-placeholder");
  const videoEl = document.getElementById("local-call-video");
  if (!modal) return;

  modal.style.display = "flex";
  if (titleEl) {
    titleEl.textContent = mode === "video" ? "Grid Video Call" : "Grid Voice Call";
  }

  stopCallStream();

  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === "video",
      });
      state.callStream = stream;
      state.micEnabled = true;
      state.camEnabled = mode === "video";
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.style.display = mode === "video" ? "block" : "none";
      }
      if (placeholderEl) {
        placeholderEl.style.display = mode === "video" ? "none" : "block";
        placeholderEl.textContent = "Voice call connected.";
      }
    } else if (placeholderEl) {
      placeholderEl.textContent = "Call room active.";
    }
  } catch {
    if (placeholderEl) {
      placeholderEl.style.display = "block";
      placeholderEl.textContent = "Call connected (camera/mic unavailable or denied).";
    }
  }
}

function stopCallStream() {
  if (state.callStream) {
    state.callStream.getTracks().forEach((track) => track.stop());
    state.callStream = null;
  }
  const videoEl = document.getElementById("local-call-video");
  if (videoEl) videoEl.srcObject = null;
}

function closeCallModal() {
  stopCallStream();
  const modal = document.getElementById("call-modal");
  if (modal) modal.style.display = "none";
}

// --- FEED ---
function renderFeedTab() {
  const emptyEl = document.getElementById("feed-empty");
  const itemsEl = document.getElementById("feed-items");
  if (!emptyEl || !itemsEl) return;

  const filtered = state.feed.filter((item) => {
    if (!state.searchQuery) return true;
    const q = state.searchQuery.toLowerCase();
    return (
      String(item.text || "").toLowerCase().includes(q) ||
      String(item.author || "").toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) {
    emptyEl.style.display = "block";
    itemsEl.innerHTML = "";
    return;
  }

  emptyEl.style.display = "none";
  itemsEl.innerHTML = filtered
    .map((item) => {
      const mediaHtml =
        item.mediaType === "video"
          ? `<video src="${escapeHtml(item.mediaUrl)}" class="sg-story-preview-media sg-mt-10" controls playsinline></video>`
          : item.mediaUrl
          ? `<img src="${escapeHtml(item.mediaUrl)}" alt="Pulse media" class="sg-story-preview-media sg-mt-10" />`
          : "";
      return `
        <article class="sg-feed-card">
          <div class="sg-chat-meta">
            <strong>${escapeHtml(item.author || "Scott")}</strong>
            <span>${escapeHtml(item.timeLabel || "Just now")}</span>
          </div>
          ${item.text ? `<p class="sg-token-sub sg-mt-10" style="color:var(--sg-text);">${escapeHtml(item.text)}</p>` : ""}
          ${mediaHtml}
        </article>
      `;
    })
    .join("");
}

// --- WALLET & PAYOUTS ---
function renderWalletTab() {
  const currency = state.profile.displayCurrency || "USD";
  const badge = document.getElementById("wallet-currency-badge");
  const balanceText = document.getElementById("wallet-balance-text");
  const tokenLine = document.getElementById("wallet-token-line");
  const activityEmpty = document.getElementById("wallet-activity-empty");
  const activityList = document.getElementById("wallet-activity-list");

  const activeUsd = Math.max(MIN_BASELINE_USD, Number(state.wallet.usdBalance || MIN_BASELINE_USD));

  if (badge) badge.textContent = currency;
  if (balanceText) balanceText.textContent = formatMoney(activeUsd, currency);
  if (tokenLine) {
    const sgtFormatted = Math.max(MIN_BASELINE_USD, Number(state.wallet.sgtTokens || activeUsd)).toFixed(2);
    const pendingFormatted = Math.max(
      MIN_BASELINE_USD,
      Number(state.wallet.pendingRewards || activeUsd)
    ).toFixed(2);
    tokenLine.innerHTML = `${sgtFormatted} SGT tokens Â· <span id="wallet-rewards-text">${pendingFormatted}</span> pending rewards Â· +$0.50/min live`;
  }

  const txList = Array.isArray(state.wallet.transactions) ? state.wallet.transactions : [];
  if (activityEmpty && activityList) {
    if (txList.length === 0) {
      activityEmpty.style.display = "block";
      activityList.innerHTML = "";
    } else {
      activityEmpty.style.display = "none";
      activityList.innerHTML = txList
        .map(
          (tx) => `
            <div class="sg-panel-card sg-mt-10">
              <div class="sg-chat-meta">
                <strong>${escapeHtml(tx.label || "Activity")}</strong>
                <span>${escapeHtml(tx.timeLabel || "Just now")}</span>
              </div>
              <div class="sg-token-sub">${escapeHtml(tx.detail || "")}</div>
            </div>
          `
        )
        .join("");
    }
  }
}

async function submitWithdrawalToApi(payload) {
  try {
    const res = await fetch("/api/payouts/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network/API route unavailable" };
  }
}

// --- ME / PROFILE ---
function renderMeTab() {
  const handleHeading = document.getElementById("me-handle-heading");
  const subtitleEl = document.getElementById("me-subtitle");
  const handleInput = document.getElementById("handle");
  const nameInput = document.getElementById("display-name");
  const bioInput = document.getElementById("bio");
  const ghostInput = document.getElementById("ghost-mode");
  const currencySelect = document.getElementById("display-currency");

  const cleanHandle = state.profile.handle
    ? state.profile.handle.startsWith("@")
      ? state.profile.handle
      : `@${state.profile.handle}`
    : "@scott";

  if (handleHeading) handleHeading.textContent = cleanHandle;
  if (subtitleEl) {
    subtitleEl.textContent = state.profile.displayName
      ? `${state.profile.displayName} Â· ScottGrid Member`
      : "ScottGrid Member";
  }
  if (handleInput) handleInput.value = cleanHandle;
  if (nameInput) nameInput.value = state.profile.displayName || "Scott";
  if (bioInput) bioInput.value = state.profile.bio || "";
  if (ghostInput) ghostInput.checked = Boolean(state.profile.ghostMode);
  if (currencySelect) currencySelect.value = state.profile.displayCurrency || "USD";
}

function renderAll() {
  renderHeaderAndNearby();
  renderStatusTab();
  renderChatsTab();
  renderFeedTab();
  renderWalletTab();
  renderMeTab();
  switchTab(state.activeTab);
}


function handleAuthSubmit(mode = "signin") {
  const emailEl = document.getElementById("email");
  const passEl = document.getElementById("password");
  const statusEl = document.getElementById("auth-status");

  const email = emailEl ? String(emailEl.value || "").trim().toLowerCase() : "";
  const password = passEl ? String(passEl.value || "").trim() : "";

  if (!email) {
    if (statusEl) statusEl.textContent = "Enter an email to continue.";
    return;
  }

  if (mode === "signup" && password && password.length < 4) {
    if (statusEl) statusEl.textContent = "Use at least 4 characters for password.";
    return;
  }

  if (statusEl) {
    statusEl.textContent = mode === "signup" ? "Creating ScottGrid account..." : "Entering ScottGrid...";
  }

  setAuthState(true, email);
}

function bindAuthEvents() {
  const signInBtn = document.getElementById("sign-in-btn");
  const signUpBtn = document.getElementById("sign-up-btn");
  const googleBtn = document.getElementById("google-signin-btn");

  if (signInBtn) {
    signInBtn.addEventListener("click", () => handleAuthSubmit("signin"));
  }

  if (signUpBtn) {
    signUpBtn.addEventListener("click", () => handleAuthSubmit("signup"));
  }

  if (googleBtn) {
    googleBtn.addEventListener("click", () => {
      const emailEl = document.getElementById("email");
      const currentEmail = emailEl ? String(emailEl.value || "").trim().toLowerCase() : "";
      setAuthState(true, currentEmail || "scott@scottgrid.app");
    });
  }
}

hydrateState();
bindAuthEvents();
renderAll();

function bindNavEvents() {
  document.querySelectorAll(".sg-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.getAttribute("data-tab");
      if (tabName) switchTab(tabName);
    });
  });
}

bindNavEvents();

function bindStatusUpload() {
  const mediaInput = document.getElementById("status-media-input");
  const strip = document.getElementById("status-circles-strip");

  if (strip && mediaInput) {
    strip.addEventListener("click", (e) => {
      const addBtn = e.target.closest("#add-status-btn");
      if (!addBtn) return;
      e.stopPropagation();
      mediaInput.value = "";
      mediaInput.click();
    });
  }

  if (mediaInput && !mediaInput.dataset.sgBound) {
    mediaInput.dataset.sgBound = "1";
    mediaInput.addEventListener("change", () => {
      const file = mediaInput.files && mediaInput.files[0];
      if (!file) return;

      const isVideo = String(file.type || "").startsWith("video/");
      const reader = new FileReader();
      reader.onload = () => {
        const mediaUrl = String(reader.result || "");
        if (!mediaUrl) return;

        const newStatus = {
          id: `st-${Date.now()}`,
          author: state.profile.displayName || "Scott",
          caption: file.name || "Status",
          mediaType: isVideo ? "video" : "image",
          mediaUrl,
          timeLabel: "Just now",
          createdAt: Date.now(),
        };

        state.statuses = [newStatus, ...(Array.isArray(state.statuses) ? state.statuses : [])];
        saveJson(STORAGE_KEYS.statuses, state.statuses);
        renderStatusTab();
      };
      reader.readAsDataURL(file);
    });
  }
}

bindStatusUpload();

function bindStoryModalClose() {
  const modal = document.getElementById("story-modal");
  if (!modal || modal.dataset.sgCloseBound) return;
  modal.dataset.sgCloseBound = "1";

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeStoryModal();
      return;
    }
    const closeEl = e.target.closest("#close-story-modal, [data-close-story], button");
    if (closeEl && closeEl.textContent.trim().toLowerCase() === "close") {
      closeStoryModal();
      return;
    }
    if (closeEl && (closeEl.id === "close-story-modal" || closeEl.hasAttribute("data-close-story"))) {
      closeStoryModal();
    }
  });
}

bindStoryModalClose();

function playIphoneNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const notes = [
      { freq: 1046.5, start: 0.0, duration: 0.09, peak: 0.16 },
      { freq: 1318.5, start: 0.085, duration: 0.09, peak: 0.16 },
      { freq: 1567.98, start: 0.17, duration: 0.24, peak: 0.18 },
    ];

    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.start);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime + n.start);
      gain.gain.exponentialRampToValueAtTime(n.peak, ctx.currentTime + n.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.start + n.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + n.start);
      osc.stop(ctx.currentTime + n.start + n.duration + 0.02);
    });
  } catch {}
}

function bindTopHeaderActions() {
  const bellBtn = document.getElementById("top-bell-btn");
  const gridBtn = document.getElementById("top-grid-btn");
  const composeBtn = document.getElementById("top-compose-btn");

  if (bellBtn && !bellBtn.dataset.sgBound) {
    bellBtn.dataset.sgBound = "1";
    bellBtn.addEventListener("click", () => {
      playIphoneNotificationSound();
      switchTab("feed");
    });
  }

  if (gridBtn && !gridBtn.dataset.sgBound) {
    gridBtn.dataset.sgBound = "1";
    gridBtn.addEventListener("click", () => {
      switchTab("nearby");
    });
  }

  if (composeBtn && !composeBtn.dataset.sgBound) {
    composeBtn.dataset.sgBound = "1";
    composeBtn.addEventListener("click", () => {
      switchTab("chats");
    });
  }
}

bindTopHeaderActions();

function bindFeedComposer() {
  const form = document.getElementById("feed-post-form");
  const inputEl = document.getElementById("feed-post-input");
  const mediaInput = document.getElementById("feed-media-input");
  const previewLabel = document.getElementById("feed-media-preview-label");
  const statusEl = document.getElementById("feed-status");

  if (mediaInput && !mediaInput.dataset.sgBound) {
    mediaInput.dataset.sgBound = "1";
    mediaInput.addEventListener("change", () => {
      const file = mediaInput.files && mediaInput.files[0];
      if (!file) {
        state.pendingFeedMedia = null;
        if (previewLabel) previewLabel.textContent = "";
        return;
      }

      const isVideo = String(file.type || "").startsWith("video/");
      const reader = new FileReader();
      reader.onload = () => {
        const mediaUrl = String(reader.result || "");
        if (!mediaUrl) return;
        state.pendingFeedMedia = {
          mediaUrl,
          mediaType: isVideo ? "video" : "image",
          name: file.name || "Media",
        };
        if (previewLabel) {
          previewLabel.textContent = `Attached: ${file.name}`;
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (form && !form.dataset.sgBound) {
    form.dataset.sgBound = "1";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = inputEl ? String(inputEl.value || "").trim() : "";
      const media = state.pendingFeedMedia;

      if (!text && !media) {
        if (statusEl) statusEl.textContent = "Write a pulse or attach media first.";
        return;
      }

      const newPulse = {
        id: `pulse-${Date.now()}`,
        author: state.profile.displayName || "Scott",
        text,
        mediaUrl: media ? media.mediaUrl : "",
        mediaType: media ? media.mediaType : "",
        timeLabel: "Just now",
        createdAt: Date.now(),
      };

      state.feed = [newPulse, ...(Array.isArray(state.feed) ? state.feed : [])];
      state.pendingFeedMedia = null;
      saveJson(STORAGE_KEYS.feed, state.feed);

      if (inputEl) inputEl.value = "";
      if (mediaInput) mediaInput.value = "";
      if (previewLabel) previewLabel.textContent = "";
      if (statusEl) statusEl.textContent = "Pulse broadcast to the grid.";

      renderFeedTab();
    });
  }
}

bindFeedComposer();
(function stabilizeScottGridLayout() {
  const styleId = "sg-layout-stabilizer";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      html {
        scrollbar-gutter: stable;
        overflow-y: scroll;
      }
      body, #app-view, .sg-shell-inner, #home-panel, .sg-tab-pane {
        overflow-x: hidden;
        max-width: 100%;
      }
      #home-panel {
        min-height: calc(100dvh - 165px);
      }
      .sg-icon-btn, .sg-nav-btn, button, a, label {
        transform: none !important;
        -webkit-tap-highlight-color: transparent;
      }
      .sg-icon-btn:active, .sg-nav-btn:active, button:active {
        transform: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  const subtitleEl = document.getElementById("me-subtitle");
  if (subtitleEl && subtitleEl.textContent.includes("Â·")) {
    subtitleEl.textContent = subtitleEl.textContent.replace(/Â·/g, "·");
  }
})();

function openGridCall(mode) {
  const modal = document.getElementById("call-modal");
  const titleEl = document.getElementById("call-modal-title");
  const placeholderEl = document.getElementById("call-placeholder");
  const videoEl = document.getElementById("local-call-video");
  const micBtn = document.getElementById("toggle-mic-btn");
  const camBtn = document.getElementById("toggle-cam-btn");

  stopCallStream();

  const isVideo = mode === "video";
  state.micEnabled = true;
  state.camEnabled = isVideo;

  if (titleEl) {
    titleEl.textContent = isVideo ? "Video Call · Mesh" : "Voice Call · Mesh";
  }
  if (placeholderEl) {
    placeholderEl.style.display = "block";
    placeholderEl.textContent = isVideo
      ? "Starting camera & microphone..."
      : "Connecting voice channel...";
  }
  if (videoEl) {
    videoEl.style.display = isVideo ? "block" : "none";
  }
  if (micBtn) micBtn.textContent = "Mic On";
  if (camBtn) {
    camBtn.textContent = isVideo ? "Cam On" : "Cam Off";
  }
  if (modal) {
    modal.style.display = "flex";
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: isVideo })
      .then((stream) => {
        state.callStream = stream;
        if (videoEl && isVideo) {
          videoEl.srcObject = stream;
          videoEl.style.display = "block";
        }
        if (placeholderEl) {
          placeholderEl.textContent = isVideo
            ? "Live video & voice active"
            : "Voice call connected";
          if (isVideo) placeholderEl.style.display = "none";
        }
      })
      .catch(() => {
        if (placeholderEl) {
          placeholderEl.style.display = "block";
          placeholderEl.textContent = isVideo
            ? "Camera/mic blocked or unavailable — preview mode active"
            : "Mic blocked or unavailable — voice call standby";
        }
      });
  } else if (placeholderEl) {
    placeholderEl.textContent = isVideo
      ? "Video call preview ready"
      : "Voice call ready";
  }
}

function appendVoiceNoteToActiveThread(audioUrl) {
  const targetId = state.activeChatId || (state.chats[0] && state.chats[0].id);
  const thread = Array.isArray(state.chats)
    ? state.chats.find((t) => t.id === targetId) || state.chats[0]
    : null;
  if (!thread) return;

  if (!Array.isArray(thread.messages)) thread.messages = [];
  const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  thread.messages.push({
    id: `vn-${Date.now()}`,
    sender: state.profile.displayName || "Scott",
    text: "Voice note",
    audioUrl,
    time: timeStr,
    outgoing: true,
  });
  thread.lastMessage = "Voice note";
  thread.lastTime = timeStr;

  saveJson(STORAGE_KEYS.chats, state.chats);
  if (typeof renderChatsTab === "function") {
    renderChatsTab();
  }
}

function bindCallsAndVoiceNote() {
  const voiceCallBtn = document.getElementById("start-voice-call-btn");
  const videoCallBtn = document.getElementById("start-video-call-btn");
  const endCallBtn = document.getElementById("end-call-btn");
  const micBtn = document.getElementById("toggle-mic-btn");
  const camBtn = document.getElementById("toggle-cam-btn");
  const voiceNoteBtn = document.getElementById("record-voice-btn");

  if (voiceCallBtn && !voiceCallBtn.dataset.sgBound) {
    voiceCallBtn.dataset.sgBound = "1";
    voiceCallBtn.addEventListener("click", () => openGridCall("voice"));
  }

  if (videoCallBtn && !videoCallBtn.dataset.sgBound) {
    videoCallBtn.dataset.sgBound = "1";
    videoCallBtn.addEventListener("click", () => openGridCall("video"));
  }

  if (endCallBtn && !endCallBtn.dataset.sgBound) {
    endCallBtn.dataset.sgBound = "1";
    endCallBtn.addEventListener("click", () => {
      if (typeof closeCallModal === "function") {
        closeCallModal();
      } else {
        stopCallStream();
        const modal = document.getElementById("call-modal");
        if (modal) modal.style.display = "none";
      }
    });
  }

  if (micBtn && !micBtn.dataset.sgBound) {
    micBtn.dataset.sgBound = "1";
    micBtn.addEventListener("click", () => {
      state.micEnabled = !state.micEnabled;
      if (state.callStream) {
        state.callStream.getAudioTracks().forEach((track) => {
          track.enabled = state.micEnabled;
        });
      }
      micBtn.textContent = state.micEnabled ? "Mic On" : "Mic Muted";
    });
  }

  if (camBtn && !camBtn.dataset.sgBound) {
    camBtn.dataset.sgBound = "1";
    camBtn.addEventListener("click", () => {
      state.camEnabled = !state.camEnabled;
      if (state.callStream) {
        state.callStream.getVideoTracks().forEach((track) => {
          track.enabled = state.camEnabled;
        });
      }
      const videoEl = document.getElementById("local-call-video");
      if (videoEl) {
        videoEl.style.display = state.camEnabled ? "block" : "none";
      }
      camBtn.textContent = state.camEnabled ? "Cam On" : "Cam Off";
    });
  }

  if (voiceNoteBtn && !voiceNoteBtn.dataset.sgBound) {
    voiceNoteBtn.dataset.sgBound = "1";
    voiceNoteBtn.addEventListener("click", async () => {
      if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
        state.mediaRecorder.stop();
        voiceNoteBtn.classList.remove("is-recording");
        voiceNoteBtn.title = "Voice Note";
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
        appendVoiceNoteToActiveThread("");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.audioChunks = [];
        const recorder = new MediaRecorder(stream);
        state.mediaRecorder = recorder;

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            state.audioChunks.push(ev.data);
          }
        };

        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(state.audioChunks, { type: recorder.mimeType || "audio/webm" });
          const reader = new FileReader();
          reader.onload = () => {
            appendVoiceNoteToActiveThread(String(reader.result || ""));
          };
          reader.readAsDataURL(blob);
          state.mediaRecorder = null;
          state.audioChunks = [];
        };

        recorder.start();
        voiceNoteBtn.classList.add("is-recording");
        voiceNoteBtn.title = "Stop Recording";
      } catch {
        appendVoiceNoteToActiveThread("");
      }
    });
  }
}

bindCallsAndVoiceNote();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

(() => {
function syncVideoCallModal() {
document.querySelectorAll(".sg-modal-backdrop").forEach((backdrop) => {
  const hasVideo = Boolean(backdrop.querySelector("video"));
  const hasCallText = /video call/i.test(backdrop.textContent || "");
  backdrop.classList.toggle("is-video-call", hasVideo || hasCallText);
});
}
const obs = new MutationObserver(syncVideoCallModal);
obs.observe(document.body, { childList: true, subtree: true });
syncVideoCallModal();
})();

(() => {
  function getWalletElements() {
    const balanceEl = document.querySelector(".sg-balance-amount");
    const subEl = document.querySelector(".sg-token-sub");
    const cards = Array.from(document.querySelectorAll(".sg-panel-card"));
    const txCard = cards.find((c) => /transaction|no transactions yet/i.test(c.textContent || "")) || null;
    return { balanceEl, subEl, txCard };
  }

  function parseCurrentSgt(subText) {
    const match = (subText || "").match(/([\d.]+)\s*SGT/i);
    return match ? parseFloat(match[1]) : 18.13;
  }

  function applyWalletUpdate(deltaSgt, description) {
    const { balanceEl, subEl, txCard } = getWalletElements();
    const currentSgt = parseCurrentSgt(subEl ? subEl.textContent : "");
    const nextSgt = Math.max(0, Number((currentSgt + deltaSgt).toFixed(2)));
    const nextUsd = (nextSgt * 0.5234).toFixed(2);

    if (balanceEl) {
      balanceEl.textContent = `$${nextUsd}`;
    }
    if (subEl) {
      subEl.textContent = `${nextSgt} SGT tokens \u2022 $${nextUsd} pending rewards \u2022 +$0.50/min live`;
    }
    if (txCard) {
      if (/no transactions yet/i.test(txCard.textContent || "")) {
        txCard.innerHTML = "";
      }
      const item = document.createElement("div");
      item.style.padding = "6px 0";
      item.style.borderBottom = "1px solid rgba(255,255,255,0.08)";
      item.textContent = `${description} \u2014 ${Math.abs(deltaSgt).toFixed(2)} SGT`;
      txCard.prepend(item);
    }
  }

  function wireWalletButtons() {
    document.querySelectorAll("button").forEach((btn) => {
      if (btn.dataset.sgWalletReady === "1") return;
      const label = (btn.textContent || "").trim().toLowerCase();

      if (label === "send tokens") {
        btn.dataset.sgWalletReady = "1";
        btn.addEventListener("click", () => {
          const recipient = window.prompt("Recipient username or wallet ID:", "@scottgrid_peer");
          if (!recipient || !recipient.trim()) return;
          const raw = window.prompt("Amount of SGT to send:", "2.50");
          const amount = parseFloat(raw || "0");
          if (!amount || amount <= 0) return;
          applyWalletUpdate(-amount, `Sent to ${recipient.trim()}`);
          window.alert(`Sent ${amount.toFixed(2)} SGT to ${recipient.trim()}.`);
        });
      }

      if (label === "withdraw") {
        btn.dataset.sgWalletReady = "1";
        btn.addEventListener("click", () => {
          const raw = window.prompt("Amount of SGT to withdraw:", "5.00");
          const amount = parseFloat(raw || "0");
          if (!amount || amount <= 0) return;
          applyWalletUpdate(-amount, "Withdrew SGT");
          window.alert(`Withdrew ${amount.toFixed(2)} SGT.`);
        });
      }
    });
  }

  const walletObserver = new MutationObserver(wireWalletButtons);
  walletObserver.observe(document.body, { childList: true, subtree: true });
  wireWalletButtons();
})();

(() => {
  function showMissedCallBanner(callerName = "Grid Mesh") {
    const target =
      document.querySelector("#tab-chats") ||
      document.querySelector("#chat-thread") ||
      document.querySelector(".sg-shell-inner") ||
      document.body;
    if (!target) return;

    let banner = document.getElementById("sg-missed-call-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "sg-missed-call-banner";
      banner.className = "sg-missed-call-banner";
      target.prepend(banner);
    }
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    banner.textContent = `Missed call from ${callerName} • ${timeStr}`;
  }

  window.triggerMissedCall = showMissedCallBanner;

  function syncCallModalFullscreen() {
    const modal = document.getElementById("call-modal");
    if (!modal) return;
    const styleDisplay = window.getComputedStyle(modal).display;
    const isVisible = styleDisplay !== "none" && modal.style.display !== "none";
    const isVideo = /video/i.test(
      (document.getElementById("call-modal-title")?.textContent || "") + " " + (modal.textContent || "")
    );
    modal.classList.toggle("is-fullscreen-call", isVisible && isVideo);
  }

  const origOpenCallModal = typeof openCallModal === "function" ? openCallModal : null;
  if (origOpenCallModal) {
    window.openCallModal = async function (mode, ...rest) {
      const res = await origOpenCallModal.apply(this, [mode, ...rest]);
      syncCallModalFullscreen();
      return res;
    };
  }

  const origCloseCallModal = typeof closeCallModal === "function" ? closeCallModal : null;
  if (origCloseCallModal) {
    window.closeCallModal = function (...rest) {
      const modal = document.getElementById("call-modal");
      const title = document.getElementById("call-modal-title")?.textContent || "Grid Mesh";
      const wasOpen = modal && modal.style.display !== "none";
      const res = origCloseCallModal.apply(this, rest);
      if (modal) modal.classList.remove("is-fullscreen-call");
      if (wasOpen && modal?.dataset.sgCallAnswered !== "1") {
        showMissedCallBanner(title.replace(/^Grid\s+(Video|Voice)\s+Call\s*[-–•]?\s*/i, "") || "Grid Mesh");
      }
      if (modal) delete modal.dataset.sgCallAnswered;
      return res;
    };
  }

  function recordWalletTx(type, amountSgt, note) {
    if (typeof state === "undefined" || !state.wallet) return false;
    const amt = Number(amountSgt);
    if (!Number.isFinite(amt) || amt <= 0) return false;

    const currentSgt = Number(state.wallet.sgtTokens || 0);
    if (amt > currentSgt) {
      window.alert(`Insufficient SGT balance. You currently have ${currentSgt.toFixed(2)} SGT.`);
      return false;
    }

    const rate =
      typeof CURRENCY_RATES !== "undefined" &&
      state.wallet.currency &&
      CURRENCY_RATES[state.wallet.currency]?.rate
        ? CURRENCY_RATES[state.wallet.currency].rate
        : 0.5234;

    const nextSgt = Number((currentSgt - amt).toFixed(4));
    const nextUsd = Math.max(0, Number((nextSgt * rate).toFixed(4)));

    state.wallet.sgtTokens = nextSgt;
    state.wallet.usdBalance = nextUsd;
    state.wallet.lastEarnedAt = Date.now();
    state.wallet.transactions = Array.isArray(state.wallet.transactions) ? state.wallet.transactions : [];
    state.wallet.transactions.unshift({
      id: `tx_${Date.now()}`,
      type,
      amountSgt: amt,
      note,
      timestamp: Date.now(),
      status: "Completed",
    });

    if (typeof STORAGE_KEYS !== "undefined" && typeof saveJson === "function") {
      saveJson(STORAGE_KEYS.wallet, state.wallet);
    }
    if (typeof renderWalletTab === "function") {
      renderWalletTab();
    } else if (typeof renderAll === "function") {
      renderAll();
    }
    return true;
  }

  function bindWalletControls() {
    document.querySelectorAll("button").forEach((btn) => {
      if (btn.dataset.sgWalletBound === "1") return;
      const label = (btn.textContent || "").trim().toLowerCase();

      if (label === "send tokens") {
        btn.dataset.sgWalletBound = "1";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const recipient = window.prompt("Send SGT to (username or wallet ID):", "@scottgrid_peer");
          if (!recipient || !recipient.trim()) return;
          const rawAmt = window.prompt("Amount of SGT to send:", "2.50");
          const amt = parseFloat(rawAmt || "");
          if (recordWalletTx("send", amt, `Sent to ${recipient.trim()}`)) {
            window.alert(`Sent ${amt.toFixed(2)} SGT to ${recipient.trim()}.`);
          }
        });
      } else if (label === "withdraw") {
        btn.dataset.sgWalletBound = "1";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const rawAmt = window.prompt("Amount of SGT to withdraw:", "5.00");
          const amt = parseFloat(rawAmt || "");
          if (recordWalletTx("withdraw", amt, "Wallet withdrawal")) {
            window.alert(`Withdrew ${amt.toFixed(2)} SGT.`);
          }
        });
      }
    });
  }

  const domObserver = new MutationObserver(() => {
    syncCallModalFullscreen();
    bindWalletControls();
  });
  domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });

  syncCallModalFullscreen();
  bindWalletControls();
})();

(() => {
  function showMissedCallBanner(callerName = "Grid Mesh") {
    const target =
      document.querySelector("#tab-chats") ||
      document.querySelector("#chat-thread") ||
      document.querySelector(".sg-shell-inner") ||
      document.body;
    if (!target) return;

    let banner = document.getElementById("sg-missed-call-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "sg-missed-call-banner";
      banner.className = "sg-missed-call-banner";
      target.prepend(banner);
    }
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    banner.textContent = `Missed call from ${callerName} • ${timeStr}`;
  }

  window.triggerMissedCall = showMissedCallBanner;

  function syncCallModalFullscreen() {
    const modal = document.getElementById("call-modal");
    if (!modal) return;
    const styleDisplay = window.getComputedStyle(modal).display;
    const isVisible = styleDisplay !== "none" && modal.style.display !== "none";
    const isVideo = /video/i.test(
      (document.getElementById("call-modal-title")?.textContent || "") + " " + (modal.textContent || "")
    );
    modal.classList.toggle("is-fullscreen-call", isVisible && isVideo);
  }

  const origOpenCallModal = typeof openCallModal === "function" ? openCallModal : null;
  if (origOpenCallModal) {
    window.openCallModal = async function (mode, ...rest) {
      const res = await origOpenCallModal.apply(this, [mode, ...rest]);
      syncCallModalFullscreen();
      return res;
    };
  }

  const origCloseCallModal = typeof closeCallModal === "function" ? closeCallModal : null;
  if (origCloseCallModal) {
    window.closeCallModal = function (...rest) {
      const modal = document.getElementById("call-modal");
      const title = document.getElementById("call-modal-title")?.textContent || "Grid Mesh";
      const wasOpen = modal && modal.style.display !== "none";
      const res = origCloseCallModal.apply(this, rest);
      if (modal) modal.classList.remove("is-fullscreen-call");
      if (wasOpen && modal?.dataset.sgCallAnswered !== "1") {
        showMissedCallBanner(title.replace(/^Grid\s+(Video|Voice)\s+Call\s*[-–•]?\s*/i, "") || "Grid Mesh");
      }
      if (modal) delete modal.dataset.sgCallAnswered;
      return res;
    };
  }

  function recordWalletTx(type, amountSgt, note) {
    if (typeof state === "undefined" || !state.wallet) return false;
    const amt = Number(amountSgt);
    if (!Number.isFinite(amt) || amt <= 0) return false;

    const currentSgt = Number(state.wallet.sgtTokens || 0);
    if (amt > currentSgt) {
      window.alert(`Insufficient SGT balance. You currently have ${currentSgt.toFixed(2)} SGT.`);
      return false;
    }

    const rate =
      typeof CURRENCY_RATES !== "undefined" &&
      state.wallet.currency &&
      CURRENCY_RATES[state.wallet.currency]?.rate
        ? CURRENCY_RATES[state.wallet.currency].rate
        : 0.5234;

    const nextSgt = Number((currentSgt - amt).toFixed(4));
    const nextUsd = Math.max(0, Number((nextSgt * rate).toFixed(4)));

    state.wallet.sgtTokens = nextSgt;
    state.wallet.usdBalance = nextUsd;
    state.wallet.lastEarnedAt = Date.now();
    state.wallet.transactions = Array.isArray(state.wallet.transactions) ? state.wallet.transactions : [];
    state.wallet.transactions.unshift({
      id: `tx_${Date.now()}`,
      type,
      amountSgt: amt,
      note,
      timestamp: Date.now(),
      status: "Completed",
    });

    if (typeof STORAGE_KEYS !== "undefined" && typeof saveJson === "function") {
      saveJson(STORAGE_KEYS.wallet, state.wallet);
    }
    if (typeof renderWalletTab === "function") {
      renderWalletTab();
    } else if (typeof renderAll === "function") {
      renderAll();
    }
    return true;
  }

  function bindWalletControls() {
    document.querySelectorAll("button").forEach((btn) => {
      if (btn.dataset.sgWalletBound === "1") return;
      const label = (btn.textContent || "").trim().toLowerCase();

      if (label === "send tokens") {
        btn.dataset.sgWalletBound = "1";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const recipient = window.prompt("Send SGT to (username or wallet ID):", "@scottgrid_peer");
          if (!recipient || !recipient.trim()) return;
          const rawAmt = window.prompt("Amount of SGT to send:", "2.50");
          const amt = parseFloat(rawAmt || "");
          if (recordWalletTx("send", amt, `Sent to ${recipient.trim()}`)) {
            window.alert(`Sent ${amt.toFixed(2)} SGT to ${recipient.trim()}.`);
          }
        });
      } else if (label === "withdraw") {
        btn.dataset.sgWalletBound = "1";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const rawAmt = window.prompt("Amount of SGT to withdraw:", "5.00");
          const amt = parseFloat(rawAmt || "");
          if (recordWalletTx("withdraw", amt, "Wallet withdrawal")) {
            window.alert(`Withdrew ${amt.toFixed(2)} SGT.`);
          }
        });
      }
    });
  }

  const domObserver = new MutationObserver(() => {
    syncCallModalFullscreen();
    bindWalletControls();
  });
  domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });

  syncCallModalFullscreen();
  bindWalletControls();
})();
