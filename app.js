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
  EUR: { symbol: "€", rate: 0.92, decimals: 2 },
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
      subtitle: "Local signal room · Online",
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
      subtitle: "Mesh node · Active",
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

function hydrateState() {
  const session = loadJson(STORAGE_KEYS.session, null);
  const savedProfile = loadJson(STORAGE_KEYS.profile, null);
  const savedWallet = loadJson(STORAGE_KEYS.wallet, null);
  const savedStatuses = loadJson(STORAGE_KEYS.statuses, []);
  const savedFeed = loadJson(STORAGE_KEYS.feed, []);
  const savedChats = loadJson(STORAGE_KEYS.chats, null);
  const savedTheme = localStorage.getItem(STORAGE_KEYS.chatTheme) || "midnight";

  state.authenticated = Boolean(session && session.signedIn);

  const mergedName = savedProfile?.displayName;
  const mergedHandle = savedProfile?.handle;
  const normalizedName =
    !mergedName || mergedName.trim().toLowerCase() === "member" ? "Scott" : mergedName;
  const normalizedHandle =
    !mergedHandle || mergedHandle.trim().toLowerCase() === "@member" ? "@scott" : mergedHandle;

  state.profile = {
    ...DEFAULT_PROFILE,
    ...(savedProfile || {}),
    displayName: normalizedName,
    handle: normalizedHandle,
    email: session?.email || savedProfile?.email || "",
  };
  saveJson(STORAGE_KEYS.profile, state.profile);

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
              ? "Scott"
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
  if (email) {
    state.profile.email = email;
  }
  saveJson(STORAGE_KEYS.session, {
    signedIn,
    email: state.profile.email || email || "",
  });
  saveJson(STORAGE_KEYS.profile, state.profile);
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

function renderChatsTab() {
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
                <span>${escapeHtml(m.time || "")}${m.viewOnce ? " · 1x" : ""}</span>
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
    tokenLine.innerHTML = `${sgtFormatted} SGT tokens · <span id="wallet-rewards-text">${pendingFormatted}</span> pending rewards · +$0.50/min live`;
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
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
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
      ? `${state.profile.displayName} · ScottGrid Member`
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

// --- EVENT WIRING ---
function bindEvents() {
  const statusNote = document.getElementById("auth-status");
  const emailInput = document.getElementById("email");
  const passInput = document.getElementById("password");

  document.getElementById("sign-in-btn")?.addEventListener("click", () => {
    const email = (emailInput?.value || "").trim();
    if (!email) {
      if (statusNote) statusNote.textContent = "Enter your email to sign in.";
      return;
    }
    setAuthState(true, email);
  });

  document.getElementById("sign-up-btn")?.addEventListener("click", () => {
    const email = (emailInput?.value || "").trim();
    if (!email) {
      if (statusNote) statusNote.textContent = "Enter an email to create your account.";
      return;
    }
    setAuthState(true, email);
  });

  document.getElementById("google-signin-btn")?.addEventListener("click", () => {
    const email = (emailInput?.value || "scott@scottgrid.app").trim();
    setAuthState(true, email);
  });

  document.getElementById("top-bell-btn")?.addEventListener("click", () => switchTab("feed"));
  document.getElementById("top-grid-btn")?.addEventListener("click", () => switchTab("nearby"));
  document.getElementById("top-compose-btn")?.addEventListener("click", () => switchTab("chats"));

  document.getElementById("sg-search-input")?.addEventListener("input", (e) => {
    state.searchQuery = (e.target.value || "").trim();
    if (state.activeTab === "chats") renderChatsTab();
    if (state.activeTab === "status") renderStatusTab();
    if (state.activeTab === "feed") renderFeedTab();
  });

  document.querySelectorAll(".sg-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) switchTab(tab);
    });
  });

  const statusMediaInput = document.getElementById("status-media-input");
  const statusDraftCard = document.getElementById("status-draft-card");
  const statusPreviewBox = document.getElementById("status-media-preview");
  const statusCaptionInput = document.getElementById("status-caption-input");

  const resetStatusDraft = () => {
    state.pendingStatusMedia = null;
    if (statusMediaInput) statusMediaInput.value = "";
    if (statusCaptionInput) statusCaptionInput.value = "";
    if (statusPreviewBox) statusPreviewBox.innerHTML = "";
    if (statusDraftCard) statusDraftCard.style.display = "none";
  };

  statusMediaInput?.addEventListener("change", () => {
    const file = statusMediaInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const isVideo = file.type.startsWith("video/");
      const dataUrl = String(reader.result || "");
      state.pendingStatusMedia = {
        mediaUrl: dataUrl,
        mediaType: isVideo ? "video" : "image",
      };

      if (statusPreviewBox) {
        statusPreviewBox.innerHTML = isVideo
          ? `<video src="${escapeHtml(dataUrl)}" class="sg-story-preview-media" controls playsinline></video>`
          : `<img src="${escapeHtml(dataUrl)}" alt="Selected story" class="sg-story-preview-media" />`;
      }
      if (statusDraftCard) statusDraftCard.style.display = "block";
      if (statusCaptionInput) statusCaptionInput.value = "";
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("cancel-status-btn")?.addEventListener("click", resetStatusDraft);

  document.getElementById("publish-status-btn")?.addEventListener("click", () => {
    if (!state.pendingStatusMedia?.mediaUrl) return;
    const caption = (statusCaptionInput?.value || "").trim();
    const author = state.profile.displayName || state.profile.handle || "Scott";

    state.statuses.unshift({
      id: `st-${Date.now()}`,
      author,
      caption,
      mediaUrl: state.pendingStatusMedia.mediaUrl,
      mediaType: state.pendingStatusMedia.mediaType,
      createdAt: Date.now(),
      timeLabel: "Just now",
    });

    saveJson(STORAGE_KEYS.statuses, state.statuses);
    resetStatusDraft();
    renderStatusTab();
  });

  document.getElementById("close-story-btn")?.addEventListener("click", closeStoryModal);
  document.getElementById("story-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "story-modal") closeStoryModal();
  });

  document.getElementById("chat-theme-select")?.addEventListener("change", (e) => {
    const theme = e.target.value || "midnight";
    localStorage.setItem(STORAGE_KEYS.chatTheme, theme);
    document.getElementById("tab-chats")?.setAttribute("data-chat-theme", theme);
  });

  document.querySelectorAll("[data-chat-filter]").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.chatFilter = pill.getAttribute("data-chat-filter") || "all";
      document.querySelectorAll("[data-chat-filter]").forEach((p) => {
        p.classList.toggle("is-active", p === pill);
      });
      renderChatsTab();
    });
  });

  document.getElementById("chat-back-btn")?.addEventListener("click", () => {
    state.activeChatId = null;
    renderChatsTab();
  });

  document.getElementById("chat-text-input")?.addEventListener("input", syncComposerActionButtons);

  document.getElementById("chat-media-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingChatMedia = {
        mediaUrl: String(reader.result || ""),
        mediaType: file.type.startsWith("video/") ? "video" : "image",
      };
      syncComposerActionButtons();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("record-voice-btn")?.addEventListener("click", async () => {
    const thread = state.chats.find((t) => t.id === state.activeChatId);
    if (!thread) return;

    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      state.mediaRecorder.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioChunks = [];
      const recorder = new MediaRecorder(stream);
      state.mediaRecorder = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) state.audioChunks.push(ev.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(state.audioChunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          thread.messages.push({
            id: `msg-${Date.now()}`,
            sender: state.profile.displayName || "Scott",
            text: "Voice note",
            audioUrl: String(reader.result || ""),
            time: "Just now",
            outgoing: true,
          });
          thread.lastTime = "Now";
          saveJson(STORAGE_KEYS.chats, state.chats);
          renderChatsTab();
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
    } catch {
      thread.messages.push({
        id: `msg-${Date.now()}`,
        sender: state.profile.displayName || "Scott",
        text: "[Voice note]",
        time: "Just now",
        outgoing: true,
      });
      thread.lastTime = "Now";
      saveJson(STORAGE_KEYS.chats, state.chats);
      renderChatsTab();
    }
  });

  document.getElementById("chat-composer-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const thread = state.chats.find((t) => t.id === state.activeChatId);
    if (!thread) return;

    const input = document.getElementById("chat-text-input");
    const viewOnceCheck = document.getElementById("chat-view-once");
    const text = (input?.value || "").trim();
    const media = state.pendingChatMedia;
    if (!text && !media) return;

    thread.messages.push({
      id: `msg-${Date.now()}`,
      sender: state.profile.displayName || "Scott",
      text,
      mediaUrl: media?.mediaUrl || "",
      mediaType: media?.mediaType || "",
      viewOnce: Boolean(viewOnceCheck?.checked),
      time: "Just now",
      outgoing: true,
    });
    thread.lastTime = "Now";

    if (input) input.value = "";
    if (viewOnceCheck) viewOnceCheck.checked = false;
    state.pendingChatMedia = null;
    syncComposerActionButtons();

    saveJson(STORAGE_KEYS.chats, state.chats);
    renderChatsTab();
  });

  document.getElementById("start-video-call-btn")?.addEventListener("click", () => openCallModal("video"));
  document.getElementById("start-voice-call-btn")?.addEventListener("click", () => openCallModal("voice"));
  document.getElementById("end-call-btn")?.addEventListener("click", closeCallModal);

  document.getElementById("toggle-mic-btn")?.addEventListener("click", (e) => {
    state.micEnabled = !state.micEnabled;
    if (state.callStream) {
      state.callStream.getAudioTracks().forEach((t) => (t.enabled = state.micEnabled));
    }
    e.currentTarget.textContent = state.micEnabled ? "Mic On" : "Mic Off";
  });

  document.getElementById("toggle-cam-btn")?.addEventListener("click", (e) => {
    state.camEnabled = !state.camEnabled;
    if (state.callStream) {
      state.callStream.getVideoTracks().forEach((t) => (t.enabled = state.camEnabled));
    }
    e.currentTarget.textContent = state.camEnabled ? "Cam On" : "Cam Off";
  });

  const feedMediaInput = document.getElementById("feed-media-input");
  const feedMediaLabel = document.getElementById("feed-media-preview-label");

  feedMediaInput?.addEventListener("change", () => {
    const file = feedMediaInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingFeedMedia = {
        mediaUrl: String(reader.result || ""),
        mediaType: file.type.startsWith("video/") ? "video" : "image",
      };
      if (feedMediaLabel) feedMediaLabel.textContent = `Attached: ${file.name}`;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("feed-post-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const textInput = document.getElementById("feed-post-input");
    const feedStatus = document.getElementById("feed-status");
    const text = (textInput?.value || "").trim();
    if (!text && !state.pendingFeedMedia) return;

    state.feed.unshift({
      id: `fd-${Date.now()}`,
      author: state.profile.displayName || state.profile.handle || "Scott",
      text,
      mediaUrl: state.pendingFeedMedia?.mediaUrl || "",
      mediaType: state.pendingFeedMedia?.mediaType || "",
      timeLabel: "Just now",
    });

    saveJson(STORAGE_KEYS.feed, state.feed);
    if (textInput) textInput.value = "";
    if (feedMediaInput) feedMediaInput.value = "";
    if (feedMediaLabel) feedMediaLabel.textContent = "";
    if (feedStatus) feedStatus.textContent = "Broadcast sent.";
    state.pendingFeedMedia = null;
    renderFeedTab();
  });

  const sendPanel = document.getElementById("send-tokens-panel");
  const withdrawPanel = document.getElementById("withdraw-panel");
  const walletNote = document.getElementById("wallet-note");

  document.getElementById("send-tokens-btn")?.addEventListener("click", () => {
    if (sendPanel) sendPanel.style.display = "block";
    if (withdrawPanel) withdrawPanel.style.display = "none";
  });

  document.getElementById("cancel-send-btn")?.addEventListener("click", () => {
    if (sendPanel) sendPanel.style.display = "none";
  });

  document.getElementById("withdraw-tokens-btn")?.addEventListener("click", () => {
    if (withdrawPanel) withdrawPanel.style.display = "block";
    if (sendPanel) sendPanel.style.display = "none";
  });

  document.getElementById("cancel-withdraw-btn")?.addEventListener("click", () => {
    if (withdrawPanel) withdrawPanel.style.display = "none";
  });

  document.getElementById("confirm-send-btn")?.addEventListener("click", () => {
    const recipient = (document.getElementById("send-recipient")?.value || "").trim();
    const amount = Number(document.getElementById("send-amount")?.value || 0);
    const memo = (document.getElementById("send-memo")?.value || "").trim();

    if (!recipient || amount <= 0) {
      if (walletNote) walletNote.textContent = "Enter a valid recipient and token amount.";
      return;
    }
    if (amount > Number(state.wallet.sgtTokens || 0)) {
      if (walletNote) walletNote.textContent = "Insufficient SGT token balance.";
      return;
    }

    state.wallet.sgtTokens = Number((Number(state.wallet.sgtTokens) - amount).toFixed(4));
    state.wallet.transactions.unshift({
      id: `tx-${Date.now()}`,
      label: `Sent ${amount.toFixed(2)} SGT`,
      detail: `To ${recipient}${memo ? ` · ${memo}` : ""}`,
      timeLabel: "Just now",
    });

    saveJson(STORAGE_KEYS.wallet, state.wallet);
    if (sendPanel) sendPanel.style.display = "none";
    if (walletNote) walletNote.textContent = `Sent ${amount.toFixed(2)} SGT to ${recipient}.`;
    renderWalletTab();
  });

  document.getElementById("confirm-withdraw-btn")?.addEventListener("click", async () => {
    const method = document.getElementById("withdraw-method")?.value || "mobile";
    const destination = (document.getElementById("withdraw-destination")?.value || "").trim();
    const amountUsd = Number(document.getElementById("withdraw-amount-usd")?.value || 0);

    if (!destination || amountUsd <= 0) {
      if (walletNote) walletNote.textContent = "Enter a valid payout destination and USD amount.";
      return;
    }
    if (amountUsd > Number(state.wallet.usdBalance || 0)) {
      if (walletNote) walletNote.textContent = "Insufficient balance for this cash-out.";
      return;
    }

    state.wallet.usdBalance = Number((Number(state.wallet.usdBalance) - amountUsd).toFixed(4));
    state.wallet.transactions.unshift({
      id: `tx-${Date.now()}`,
      label: `Withdraw $${amountUsd.toFixed(2)}`,
      detail: `${method.toUpperCase()} · ${destination}`,
      timeLabel: "Just now",
    });

    saveJson(STORAGE_KEYS.wallet, state.wallet);
    if (withdrawPanel) withdrawPanel.style.display = "none";
    renderWalletTab();

    const apiResult = await submitWithdrawalToApi({
      method,
      destination,
      amountUsd,
      handle: state.profile.handle,
    });
    if (walletNote) {
      walletNote.textContent = apiResult.ok
        ? `Withdrawal of $${amountUsd.toFixed(2)} submitted.`
        : `Recorded $${amountUsd.toFixed(2)} withdrawal locally (connect /api/payouts/withdraw for live settlement).`;
    }
  });

  document.getElementById("avatar-photo-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.profile.avatarDataUrl = String(reader.result || "");
      saveJson(STORAGE_KEYS.profile, state.profile);
      renderHeaderAndNearby();
      renderStatusTab();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("profile-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const handleVal = (document.getElementById("handle")?.value || "@scott").trim();
    const nameVal = (document.getElementById("display-name")?.value || "").trim();
    const bioVal = (document.getElementById("bio")?.value || "").trim();
    const ghostVal = Boolean(document.getElementById("ghost-mode")?.checked);
    const currencyVal = document.getElementById("display-currency")?.value || "USD";

    state.profile.handle = handleVal.startsWith("@") ? handleVal : `@${handleVal}`;
    state.profile.displayName = nameVal || "Scott";
    state.profile.bio = bioVal;
    state.profile.ghostMode = ghostVal;
    state.profile.displayCurrency = currencyVal;

    saveJson(STORAGE_KEYS.profile, state.profile);
    const profStatus = document.getElementById("profile-status");
    if (profStatus) profStatus.textContent = "Profile changes saved.";
    renderHeaderAndNearby();
    renderStatusTab();
    renderWalletTab();
    renderMeTab();
  });

  document.getElementById("sign-out-btn")?.addEventListener("click", () => {
    setAuthState(false);
    if (passInput) passInput.value = "";
  });
}

// --- SERVICE WORKER & LIVE LEDGER TICK ---
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  hydrateState();
  bindEvents();
  renderAll();
  registerServiceWorker();

  setInterval(() => {
    if (!state.authenticated) return;
    syncWalletTicks(Date.now());
    if (state.activeTab === "wallet") {
      renderWalletTab();
    }
  }, 5000);
});