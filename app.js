import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://yjcxhhzpfrezpxnxmvxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_k745t00MV8hDHJS_mUAAew_By13JCjF';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const VALID_THEMES = ['midnight', 'emerald', 'obsidian', 'amber'];

const DEFAULT_THREADS = [
  {
    id: 'grid-broadcast',
    title: 'Grid Broadcasts',
    subtitle: 'Encrypted mesh · Official ScottGrid room',
    avatar: 'SG',
    lastMessage: 'Welcome to ScottGrid mesh chat',
    lastTime: 'Now',
    unread: 1,
    favorite: true,
    isGroup: true,
    messages: [
      {
        sender: '@scottgrid',
        text: 'Welcome to ScottGrid! Pick a chat thread or switch themes in Chats.',
        time: 'Now',
        viewOnce: false,
        outgoing: false
      }
    ]
  },
  {
    id: 'mesh-builders',
    title: 'Kampala Mesh Builders',
    subtitle: '4 members · Live grid channel',
    avatar: 'MB',
    lastMessage: '🎙 Voice note (0:12)',
    lastTime: '7:45 PM',
    unread: 0,
    favorite: false,
    isGroup: true,
    messages: [
      {
        sender: '@builder',
        text: '🎙 Voice note (0:12)',
        time: '7:45 PM',
        viewOnce: false,
        outgoing: false
      }
    ]
  },
  {
    id: 'direct-signal',
    title: 'Direct Signal Desk',
    subtitle: 'Encrypted 1:1 channel',
    avatar: 'DS',
    lastMessage: 'Tap to send a message or voice note',
    lastTime: '6:30 PM',
    unread: 0,
    favorite: true,
    isGroup: false,
    messages: []
  }
];

const state = {
  user: null,
  profile: {
    id: null,
    display_name: 'ScottGrid Member',
    handle: '@member',
    bio: ''
  },
  posts: [],
  threads: DEFAULT_THREADS.map((t) => ({ ...t, messages: [...t.messages] })),
  activeThreadId: null,
  chatFilter: 'all',
  searchQuery: '',
  selectedBand: 'ALL',
  feedChannel: null,
  chatTheme: 'midnight',
  mediaRecorder: null,
  audioChunks: []
};

const signInBtn = document.getElementById('sign-in-btn');
const signUpBtn = document.getElementById('sign-up-btn');
const emailInput =
  document.getElementById('email') ||
  document.getElementById('auth-email') ||
  document.querySelector('input[type="email"]');
const passwordInput =
  document.getElementById('password') ||
  document.getElementById('auth-password') ||
  document.querySelector('input[type="password"]');

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');

const els = {
  authBanner: document.getElementById('auth-status'),
  googleSignInBtn: document.getElementById('google-signin-btn'),
  signOutBtn: document.getElementById('sign-out-btn'),

  // Bottom navigation & tab views
  tabButtons: document.querySelectorAll('[data-tab]'),
  tabPanels: document.querySelectorAll('.sg-tab-pane'),
  searchInput: document.getElementById('sg-search-input'),

  // Chat list & thread controls
  tabChats: document.getElementById('tab-chats'),
  chatThemeSelect: document.getElementById('chat-theme-select'),
  chatListView: document.getElementById('chat-list-view'),
  chatThreadView: document.getElementById('chat-thread-view'),
  chatFilterPills: document.querySelectorAll('[data-chat-filter]'),
  chatThreadList: document.getElementById('chat-thread-list'),
  chatBackBtn: document.getElementById('chat-back-btn'),
  chatTotalUnread: document.getElementById('chat-total-unread'),
  chatActiveAvatar: document.getElementById('chat-active-avatar'),
  chatActiveTitle: document.getElementById('chat-active-title'),
  chatPeerSub: document.getElementById('chat-peer-sub'),
  chatComposerForm: document.getElementById('chat-composer-form'),
  chatTextInput: document.getElementById('chat-text-input'),
  chatSendBtn: document.getElementById('chat-send-btn'),
  recordVoiceBtn: document.getElementById('record-voice-btn'),
  chatMediaInput: document.getElementById('chat-media-input'),
  chatViewOnce: document.getElementById('chat-view-once'),
  chatMessagesBox: document.getElementById('chat-messages-box'),
  chatsEmpty: document.getElementById('chats-empty'),

  // Feed & Frequency controls
  bandFilterSelect: document.getElementById('feed-band-filter'),
  bandChips: document.querySelectorAll('[data-band]'),
  feedForm: document.getElementById('feed-post-form'),
  feedBandInput: document.getElementById('feed-post-band'),
  feedTextInput: document.getElementById('feed-post-input'),
  feedPublishBtn: document.getElementById('feed-publish-btn'),
  feedStatus: document.getElementById('feed-status'),
  feedEmpty: document.getElementById('feed-empty'),
  feedList: document.getElementById('feed-items'),

  // Me / Profile controls
  profileBadgeName: document.getElementById('nav-display-name'),
  profileBadgeHandle: document.getElementById('me-handle-heading'),
  profileBadgeBio: document.getElementById('me-subtitle'),
  profileForm: document.getElementById('profile-form'),
  saveProfileBtn: document.getElementById('save-profile-btn'),
  handleInput: document.getElementById('handle'),
  displayNameInput: document.getElementById('display-name'),
  bioInput: document.getElementById('bio'),
  profileStatus: document.getElementById('profile-status')
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeHandle(rawHandle, fallbackEmail = '') {
  const cleaned = (rawHandle || '').trim();
  if (!cleaned) {
    const localPart = (fallbackEmail.split('@')[0] || 'member').replace(/[^a-zA-Z0-9_]/g, '');
    return `@${localPart || 'member'}`;
  }
  return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
}

function setStatus(el, message, isError = false) {
  if (el) {
    el.textContent = message;
    el.style.color = isError ? '#ff6b6b' : '#4ade80';
  } else if (message) {
    console[isError ? 'error' : 'log'](message);
  }
}

function getActiveThread() {
  return state.threads.find((t) => t.id === state.activeThreadId) || state.threads[0];
}

function getTotalUnreadCount() {
  return state.threads.reduce((sum, t) => sum + (Number(t.unread) || 0), 0);
}

function renderChatThreadList() {
  if (!els.chatThreadList) return;

  const q = (state.searchQuery || '').trim().toLowerCase();
  const filtered = state.threads.filter((t) => {
    if (state.chatFilter === 'unread' && !(t.unread > 0)) return false;
    if (state.chatFilter === 'favorites' && !t.favorite) return false;
    if (state.chatFilter === 'groups' && !t.isGroup) return false;
    if (q) {
      const hay = `${t.title} ${t.lastMessage}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    els.chatThreadList.innerHTML = `<div class="sg-empty-state" style="padding: 20px 8px;">No chats match this filter.</div>`;
    return;
  }

  els.chatThreadList.innerHTML = filtered
    .map((thread) => {
      const badgeHtml =
        thread.unread > 0 ? `<span class="sg-wa-unread-badge">${escapeHtml(thread.unread)}</span>` : '';
      return `
        <button type="button" class="sg-wa-thread-row" data-thread-id="${escapeHtml(thread.id)}">
          <div class="sg-wa-avatar">${escapeHtml(thread.avatar)}</div>
          <div class="sg-wa-thread-meta">
            <div class="sg-wa-thread-top">
              <span class="sg-wa-name">${escapeHtml(thread.title)}</span>
              <span class="sg-wa-time ${thread.unread > 0 ? 'is-unread' : ''}">${escapeHtml(thread.lastTime)}</span>
            </div>
            <div class="sg-wa-thread-bottom">
              <span class="sg-wa-preview">${escapeHtml(thread.lastMessage)}</span>
              ${badgeHtml}
            </div>
          </div>
        </button>
      `;
    })
    .join('');
}

function renderActiveThreadMessages() {
  const thread = getActiveThread();
  if (!thread || !els.chatMessagesBox) return;

  if (els.chatActiveAvatar) els.chatActiveAvatar.textContent = thread.avatar;
  if (els.chatActiveTitle) els.chatActiveTitle.textContent = thread.title;
  if (els.chatPeerSub) els.chatPeerSub.textContent = thread.subtitle;
  if (els.chatTotalUnread) els.chatTotalUnread.textContent = String(getTotalUnreadCount());

  if (!thread.messages.length) {
    els.chatMessagesBox.innerHTML = `
      <div id="chats-empty" class="sg-empty-state" style="margin-top: 24px;">
        No messages in this chat yet. Send a message or voice note below.
      </div>
    `;
    return;
  }

  els.chatMessagesBox.innerHTML = thread.messages
    .map((msg) => {
      const onceTag = msg.viewOnce ? ' · 1x View Once' : '';
      return `
        <div class="sg-chat-bubble ${msg.outgoing ? 'is-outgoing' : ''}">
          <div class="sg-chat-meta">
            <strong>${escapeHtml(msg.sender)}</strong>
            <span>${escapeHtml(msg.time)}${escapeHtml(onceTag)}</span>
          </div>
          <div class="sg-chat-body">${escapeHtml(msg.text)}</div>
        </div>
      `;
    })
    .join('');

  els.chatMessagesBox.scrollTop = els.chatMessagesBox.scrollHeight;
}

function openChatThread(threadId) {
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return;

  state.activeThreadId = thread.id;
  thread.unread = 0;

  if (els.chatListView) els.chatListView.style.display = 'none';
  if (els.chatThreadView) els.chatThreadView.style.display = 'block';

  renderChatThreadList();
  renderActiveThreadMessages();
}

function showChatList() {
  state.activeThreadId = null;
  if (els.chatThreadView) els.chatThreadView.style.display = 'none';
  if (els.chatListView) els.chatListView.style.display = 'block';
  renderChatThreadList();
}

function syncComposerActionButton() {
  const hasText = Boolean((els.chatTextInput?.value || '').trim());
  const hasMedia = Boolean(els.chatMediaInput?.files && els.chatMediaInput.files.length > 0);
  const showSend = hasText || hasMedia;

  if (els.chatSendBtn) {
    els.chatSendBtn.style.display = showSend ? 'inline-flex' : 'none';
  }
  if (els.recordVoiceBtn) {
    els.recordVoiceBtn.style.display = showSend ? 'none' : 'inline-flex';
  }
}

function pushMessageToActiveThread({ text, viewOnce = false }) {
  const thread = getActiveThread();
  if (!thread) return;

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sender = normalizeHandle(state.profile.handle, state.user?.email);

  thread.messages.push({
    sender,
    text,
    time: now,
    viewOnce,
    outgoing: true
  });
  thread.lastMessage = viewOnce ? '1x View Once' : text;
  thread.lastTime = now;

  renderActiveThreadMessages();
  renderChatThreadList();
}

function handleChatSubmit(event) {
  if (event) event.preventDefault();

  const textVal = (els.chatTextInput?.value || '').trim();
  const file = els.chatMediaInput?.files?.[0];
  const viewOnce = Boolean(els.chatViewOnce?.checked);

  if (!textVal && !file) return;

  let composedText = textVal;
  if (file) {
    const mediaLabel = `[Media: ${file.name}]`;
    composedText = composedText ? `${composedText} ${mediaLabel}` : mediaLabel;
  }

  pushMessageToActiveThread({ text: composedText, viewOnce });

  if (els.chatTextInput) els.chatTextInput.value = '';
  if (els.chatMediaInput) els.chatMediaInput.value = '';
  if (els.chatViewOnce) els.chatViewOnce.checked = false;
  syncComposerActionButton();
}

async function handleVoiceButtonClick() {
  const viewOnce = Boolean(els.chatViewOnce?.checked);

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    pushMessageToActiveThread({ text: '🎙 Voice message (0:02)', viewOnce });
    if (els.chatViewOnce) els.chatViewOnce.checked = false;
    return;
  }

  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.stop();
    els.recordVoiceBtn.textContent = '🎙';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    const recorder = new MediaRecorder(stream);
    state.mediaRecorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const seconds = Math.max(1, Math.round(state.audioChunks.length * 0.5));
      pushMessageToActiveThread({
        text: `🎙 Voice message (0:0${Math.min(9, seconds)})`,
        viewOnce
      });
      if (els.chatViewOnce) els.chatViewOnce.checked = false;
      state.mediaRecorder = null;
    };

    recorder.start();
    els.recordVoiceBtn.textContent = '⏹';
  } catch (_) {
    pushMessageToActiveThread({ text: '🎙 Voice message (0:02)', viewOnce });
    if (els.chatViewOnce) els.chatViewOnce.checked = false;
  }
}

function applyChatTheme(themeName) {
  const chosen = VALID_THEMES.includes(themeName) ? themeName : 'midnight';
  state.chatTheme = chosen;

  if (els.tabChats) {
    els.tabChats.setAttribute('data-chat-theme', chosen);
  }
  if (els.chatThemeSelect && els.chatThemeSelect.value !== chosen) {
    els.chatThemeSelect.value = chosen;
  }

  try {
    localStorage.setItem('scottgrid_chat_theme', chosen);
  } catch (_) {}
}

async function loadAndApplyUserTheme(user) {
  const metaTheme = user?.user_metadata?.chat_theme;
  let localTheme = null;
  try {
    localTheme = localStorage.getItem('scottgrid_chat_theme');
  } catch (_) {}

  applyChatTheme(metaTheme || localTheme || 'midnight');
}

function switchTab(tabName) {
  els.tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
    btn.classList.toggle('is-active', btn.dataset.tab === tabName);
  });

  const panelById = document.getElementById(`tab-${tabName}`);
  if (panelById) {
    document.querySelectorAll('.sg-tab-pane').forEach((pane) => {
      pane.style.display = pane === panelById ? 'block' : 'none';
      pane.classList.toggle('active', pane === panelById);
      pane.hidden = pane !== panelById;
    });
    if (tabName === 'chats') {
      showChatList();
    }
  }
}

function renderAuthState() {
  const signedIn = Boolean(state.user);

  if (appView) {
    appView.style.display = signedIn ? 'block' : 'none';
    appView.hidden = !signedIn;
  }
  if (authView) {
    authView.style.display = signedIn ? 'none' : 'flex';
    authView.hidden = signedIn;
  }

  if (els.authBanner) {
    if (signedIn) {
      const displayHandle = normalizeHandle(state.profile.handle, state.user.email);
      els.authBanner.textContent = `Connected as ${displayHandle} (${state.user.email || 'Authenticated'})`;
    } else {
      els.authBanner.textContent = 'Sign in to enter ScottGrid';
    }
  }

  if (els.googleSignInBtn) els.googleSignInBtn.hidden = signedIn;
  if (els.signOutBtn) els.signOutBtn.hidden = !signedIn;
}

function renderProfile() {
  const displayName = state.profile.display_name || 'ScottGrid Member';
  const handle = normalizeHandle(state.profile.handle, state.user?.email);
  const bio = state.profile.bio || '';

  if (els.profileBadgeName) els.profileBadgeName.textContent = displayName;
  if (els.profileBadgeHandle) els.profileBadgeHandle.textContent = handle;
  if (els.profileBadgeBio) {
    els.profileBadgeBio.textContent = bio ? `${displayName} · ${bio}` : displayName;
  }

  if (els.handleInput && document.activeElement !== els.handleInput) {
    els.handleInput.value = handle;
  }
  if (els.displayNameInput && document.activeElement !== els.displayNameInput) {
    els.displayNameInput.value = displayName;
  }
  if (els.bioInput && document.activeElement !== els.bioInput) {
    els.bioInput.value = bio;
  }
}

async function loadProfile(user) {
  if (!user) {
    state.profile = {
      id: null,
      display_name: 'ScottGrid Member',
      handle: '@member',
      bio: ''
    };
    renderProfile();
    renderAuthState();
    return;
  }

  const fallbackHandle = normalizeHandle(
    user.user_metadata?.user_name || user.user_metadata?.name,
    user.email
  );
  const fallbackName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    fallbackHandle.replace(/^@/, '');

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, handle, bio')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Error loading profile:', error.message);
    state.profile = {
      id: user.id,
      display_name: fallbackName,
      handle: fallbackHandle,
      bio: ''
    };
    renderProfile();
    renderAuthState();
    return;
  }

  state.profile = data
    ? {
        id: data.id,
        display_name: data.display_name || fallbackName,
        handle: normalizeHandle(data.handle, user.email),
        bio: data.bio || ''
      }
    : {
        id: user.id,
        display_name: fallbackName,
        handle: fallbackHandle,
        bio: ''
      };

  renderProfile();
  renderAuthState();
}

async function saveProfile(event) {
  if (event) event.preventDefault();
  if (!state.user) {
    setStatus(els.profileStatus, 'Please sign in first before saving your profile.', true);
    return;
  }

  const handle = normalizeHandle(els.handleInput?.value, state.user.email);
  const display_name = (els.displayNameInput?.value || '').trim() || handle.replace(/^@/, '');
  const bio = (els.bioInput?.value || '').trim();

  setStatus(els.profileStatus, 'Saving...');

  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: state.user.id,
        display_name,
        handle,
        bio
      },
      { onConflict: 'id' }
    )
    .select('id, display_name, handle, bio')
    .single();

  if (error) {
    console.error('Profile save error:', error.message);
    setStatus(els.profileStatus, `Could not save: ${error.message}`, true);
    return;
  }

  state.profile = {
    id: data.id,
    display_name: data.display_name || display_name,
    handle: normalizeHandle(data.handle, state.user.email),
    bio: data.bio || ''
  };

  renderProfile();
  renderAuthState();
  setStatus(els.profileStatus, 'Saved!');
}

async function handleSignIn(event) {
  if (event) event.preventDefault();

  const email = (emailInput?.value || '').trim();
  const password = passwordInput?.value || '';

  if (!email || !password) {
    setStatus(els.authBanner, 'Enter both your email and password.', true);
    return;
  }

  if (signInBtn) signInBtn.disabled = true;
  setStatus(els.authBanner, 'Entering ScottGrid...');

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (signInBtn) signInBtn.disabled = false;

  if (error) {
    console.error('Sign in failed:', error.message);
    setStatus(els.authBanner, `Sign in failed: ${error.message}`, true);
    return;
  }

  state.user = data.user || data.session?.user || null;
  await loadAndApplyUserTheme(state.user);
  await loadProfile(state.user);
  await loadFeedPosts();
  subscribeToLiveFeed();
}

async function handleSignUp(event) {
  if (event) event.preventDefault();

  const email = (emailInput?.value || '').trim();
  const password = passwordInput?.value || '';

  if (!email || !password) {
    setStatus(els.authBanner, 'Enter an email and password to create an account.', true);
    return;
  }

  if (signUpBtn) signUpBtn.disabled = true;
  setStatus(els.authBanner, 'Creating account...');

  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });

  if (signUpBtn) signUpBtn.disabled = false;

  if (error) {
    console.error('Sign up failed:', error.message);
    setStatus(els.authBanner, `Sign up failed: ${error.message}`, true);
    return;
  }

  if (data.session?.user) {
    state.user = data.session.user;
    await loadAndApplyUserTheme(state.user);
    await loadProfile(state.user);
    await loadFeedPosts();
    subscribeToLiveFeed();
  } else {
    setStatus(els.authBanner, 'Account created! Check your email or click Enter ScottGrid.');
  }
}

function getVisiblePosts() {
  if (!state.selectedBand || state.selectedBand === 'ALL') {
    return state.posts;
  }
  return state.posts.filter(
    (post) => (post.band || '').toLowerCase() === state.selectedBand.toLowerCase()
  );
}

function formatTimestamp(isoString) {
  if (!isoString) return 'Just now';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderFeed() {
  if (!els.feedList) return;

  const visiblePosts = getVisiblePosts();

  if (!visiblePosts.length) {
    const scopeText =
      state.selectedBand && state.selectedBand !== 'ALL'
        ? ` on frequency "${state.selectedBand}"`
        : '';
    if (els.feedEmpty) els.feedEmpty.style.display = 'block';
    els.feedList.innerHTML = `<div class="feed-empty">No Feed posts yet${escapeHtml(scopeText)}. Broadcast the first update above.</div>`;
    return;
  }

  if (els.feedEmpty) els.feedEmpty.style.display = 'none';

  els.feedList.innerHTML = visiblePosts
    .map((post) => {
      const replies = Array.isArray(post.replies) ? post.replies : [];
      const boostCount = Number.isFinite(Number(post.boosts)) ? Number(post.boosts) : 0;

      const repliesHtml = replies.length
        ? `<div class="feed-replies">
            ${replies
              .map(
                (r) => `
              <div class="feed-reply-item">
                <strong>${escapeHtml(r.author_handle || '@member')}</strong>: ${escapeHtml(r.text || '')}
              </div>`
              )
              .join('')}
          </div>`
        : '';

      return `
        <article class="feed-card" data-post-id="${escapeHtml(post.id)}">
          <div class="feed-card-header">
            <span class="feed-author">${escapeHtml(post.author_handle || '@member')}</span>
            <span class="feed-band">${escapeHtml(post.band || 'General')}</span>
            <span class="feed-time">${escapeHtml(formatTimestamp(post.created_at))}</span>
          </div>
          <p class="feed-text">${escapeHtml(post.text || '')}</p>
          <div class="feed-actions">
            <button type="button" class="btn-boost" data-action="boost" data-id="${escapeHtml(post.id)}">
              ⚡ Boost (${boostCount})
            </button>
            <button type="button" class="btn-reply-toggle" data-action="toggle-reply" data-id="${escapeHtml(post.id)}">
              💬 Reply (${replies.length})
            </button>
          </div>
          <form class="feed-reply-form" data-reply-form="${escapeHtml(post.id)}" hidden>
            <input type="text" name="replyText" placeholder="Write a reply on this frequency..." maxlength="280" required />
            <button type="submit">Send</button>
          </form>
          ${repliesHtml}
        </article>
      `;
    })
    .join('');
}

async function loadFeedPosts() {
  const { data, error } = await supabase
    .from('pulses')
    .select('id, author_id, author_handle, band, text, boosts, replies, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Failed to load Feed:', error.message);
    setStatus(els.feedStatus, `Feed load error: ${error.message}`, true);
    return;
  }

  state.posts = Array.isArray(data) ? data : [];
  renderFeed();
}

function upsertLocalPost(incomingPost) {
  if (!incomingPost || !incomingPost.id) return;
  const idx = state.posts.findIndex((p) => String(p.id) === String(incomingPost.id));
  if (idx >= 0) {
    state.posts[idx] = { ...state.posts[idx], ...incomingPost };
  } else {
    state.posts = [incomingPost, ...state.posts];
  }
  state.posts.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  renderFeed();
}

function removeLocalPost(postId) {
  state.posts = state.posts.filter((p) => String(p.id) !== String(postId));
  renderFeed();
}

async function handleCreateFeedPost(event) {
  if (event) event.preventDefault();
  if (!state.user) {
    setStatus(els.feedStatus, 'Sign in first to post to the Feed.', true);
    return;
  }

  const text = (els.feedTextInput?.value || '').trim();
  const band = (els.feedBandInput?.value || state.selectedBand || 'General').trim() || 'General';

  if (!text) {
    setStatus(els.feedStatus, 'Enter a message before posting to the Feed.', true);
    return;
  }

  const author_handle = normalizeHandle(state.profile.handle, state.user.email);
  setStatus(els.feedStatus, `Broadcasting on ${band}...`);

  const { data, error } = await supabase
    .from('pulses')
    .insert({
      author_id: state.user.id,
      author_handle,
      band,
      text,
      boosts: 0,
      replies: []
    })
    .select('id, author_id, author_handle, band, text, boosts, replies, created_at')
    .single();

  if (error) {
    console.error('Error posting to Feed:', error.message);
    setStatus(els.feedStatus, `Post failed: ${error.message}`, true);
    return;
  }

  if (data) {
    upsertLocalPost(data);
  }

  if (els.feedTextInput) els.feedTextInput.value = '';
  setStatus(els.feedStatus, `Live on ${band}`);
}

async function handleBoostPost(postId) {
  if (!state.user) {
    setStatus(els.feedStatus, 'Sign in to boost Feed posts.', true);
    return;
  }

  const target = state.posts.find((p) => String(p.id) === String(postId));
  if (!target) return;

  const nextBoosts = (Number(target.boosts) || 0) + 1;
  upsertLocalPost({ ...target, boosts: nextBoosts });

  const { data, error } = await supabase
    .from('pulses')
    .update({ boosts: nextBoosts })
    .eq('id', postId)
    .select('id, author_id, author_handle, band, text, boosts, replies, created_at')
    .single();

  if (error) {
    console.error('Error boosting post:', error.message);
    upsertLocalPost(target);
    setStatus(els.feedStatus, `Boost failed: ${error.message}`, true);
    return;
  }

  if (data) upsertLocalPost(data);
}

async function handleReplySubmit(postId, replyText, formEl) {
  if (!state.user) {
    setStatus(els.feedStatus, 'Sign in to reply on the Feed.', true);
    return;
  }

  const cleanReply = (replyText || '').trim();
  if (!cleanReply) return;

  const target = state.posts.find((p) => String(p.id) === String(postId));
  if (!target) return;

  const existingReplies = Array.isArray(target.replies) ? target.replies : [];
  const nextReplies = [
    ...existingReplies,
    {
      author_id: state.user.id,
      author_handle: normalizeHandle(state.profile.handle, state.user.email),
      text: cleanReply,
      created_at: new Date().toISOString()
    }
  ];

  const { data, error } = await supabase
    .from('pulses')
    .update({ replies: nextReplies })
    .eq('id', postId)
    .select('id, author_id, author_handle, band, text, boosts, replies, created_at')
    .single();

  if (error) {
    console.error('Error sending reply:', error.message);
    setStatus(els.feedStatus, `Reply failed: ${error.message}`, true);
    return;
  }

  if (data) upsertLocalPost(data);
  if (formEl) {
    formEl.reset();
    formEl.hidden = true;
  }
}

function subscribeToLiveFeed() {
  if (state.feedChannel) {
    supabase.removeChannel(state.feedChannel);
    state.feedChannel = null;
  }

  state.feedChannel = supabase
    .channel('scottgrid-feed-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pulses' },
      (payload) => {
        if (payload?.new) upsertLocalPost(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'pulses' },
      (payload) => {
        if (payload?.new) upsertLocalPost(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'pulses' },
      (payload) => {
        if (payload?.old?.id) removeLocalPost(payload.old.id);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setStatus(els.feedStatus, 'Live frequency connected');
      }
    });
}

function setSelectedBand(bandValue) {
  state.selectedBand = bandValue || 'ALL';

  if (els.bandFilterSelect && els.bandFilterSelect.value !== state.selectedBand) {
    els.bandFilterSelect.value = state.selectedBand;
  }

  if (
    els.feedBandInput &&
    state.selectedBand !== 'ALL' &&
    Array.from(els.feedBandInput.options).some((opt) => opt.value === state.selectedBand)
  ) {
    els.feedBandInput.value = state.selectedBand;
  }

  els.bandChips.forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.band === state.selectedBand);
  });

  renderFeed();
}

function bindEvents() {
  els.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      switchTab(targetTab);
      if (targetTab === 'feed') {
        loadFeedPosts();
      }
    });
  });

  els.searchInput?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value || '';
    renderChatThreadList();
  });

  els.chatFilterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      state.chatFilter = pill.dataset.chatFilter || 'all';
      els.chatFilterPills.forEach((p) => p.classList.toggle('is-active', p === pill));
      renderChatThreadList();
    });
  });

  els.chatThreadList?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-thread-id]');
    if (!row) return;
    openChatThread(row.dataset.threadId);
  });

  els.chatBackBtn?.addEventListener('click', showChatList);

  els.chatTextInput?.addEventListener('input', syncComposerActionButton);
  els.chatMediaInput?.addEventListener('change', syncComposerActionButton);
  els.chatComposerForm?.addEventListener('submit', handleChatSubmit);
  els.recordVoiceBtn?.addEventListener('click', handleVoiceButtonClick);

  els.chatThemeSelect?.addEventListener('change', async (e) => {
    const chosen = e.target.value;
    applyChatTheme(chosen);

    if (state.user) {
      const { error } = await supabase.auth.updateUser({
        data: { chat_theme: chosen }
      });
      if (error) {
        console.error('Could not sync chat theme:', error.message);
      }
    }
  });

  signInBtn?.addEventListener('click', handleSignIn);
  signUpBtn?.addEventListener('click', handleSignUp);

  passwordInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleSignIn(e);
    }
  });

  els.googleSignInBtn?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) {
      console.error('Google sign-in error:', error.message);
    }
  });

  els.signOutBtn?.addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  els.profileForm?.addEventListener('submit', saveProfile);
  els.saveProfileBtn?.addEventListener('click', saveProfile);

  els.feedForm?.addEventListener('submit', handleCreateFeedPost);
  els.feedPublishBtn?.addEventListener('click', handleCreateFeedPost);

  els.bandFilterSelect?.addEventListener('change', (e) => {
    setSelectedBand(e.target.value);
  });

  els.bandChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      setSelectedBand(chip.dataset.band);
    });
  });

  els.feedList?.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;

    const action = actionBtn.dataset.action;
    const postId = actionBtn.dataset.id;

    if (action === 'boost') {
      handleBoostPost(postId);
    } else if (action === 'toggle-reply') {
      const replyForm = els.feedList.querySelector(`[data-reply-form="${CSS.escape(postId)}"]`);
      if (replyForm) {
        replyForm.hidden = !replyForm.hidden;
        if (!replyForm.hidden) {
          replyForm.querySelector('input[name="replyText"]')?.focus();
        }
      }
    }
  });

  els.feedList?.addEventListener('submit', (event) => {
    const replyForm = event.target.closest('[data-reply-form]');
    if (!replyForm) return;
    event.preventDefault();

    const postId = replyForm.dataset.replyForm;
    const input = replyForm.querySelector('input[name="replyText"]');
    handleReplySubmit(postId, input?.value || '', replyForm);
  });
}

async function initApp() {
  bindEvents();
  syncComposerActionButton();
  renderChatThreadList();
  switchTab('feed');

  const {
    data: { session }
  } = await supabase.auth.getSession();

  state.user = session?.user || null;
  await loadAndApplyUserTheme(state.user);
  await loadProfile(state.user);
  await loadFeedPosts();
  subscribeToLiveFeed();

  supabase.auth.onAuthStateChange(async (event, nextSession) => {
    if (event === 'INITIAL_SESSION') return;
    state.user = nextSession?.user || null;
    await loadAndApplyUserTheme(state.user);
    await loadProfile(state.user);
    await loadFeedPosts();
  });

  window.addEventListener('beforeunload', () => {
    if (state.feedChannel) {
      supabase.removeChannel(state.feedChannel);
    }
  });
}

initApp();