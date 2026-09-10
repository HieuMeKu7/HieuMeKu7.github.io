'use strict';

const $ = (s) => document.querySelector(s);
const el = {
  where: $('#where'),
  authPill: $('#auth-pill'),
  token: $('#token'),
  remember: $('#remember-token'),
  testAuth: $('#test-auth'),
  clearToken: $('#clear-token'),
  authStatus: $('#auth-status'),
  mode: $('#mode'),
  src: $('#src'),
  dst: $('#dst'),
  next: $('#next'),
  empty: $('#empty'),
  task: $('#task'),
  kind: $('#kind'),
  title: $('#title'),
  image: $('#image'),
  source: $('#source'),
  links: $('#links'),
  answer: $('#answer'),
  count: $('#count'),
  skip: $('#skip'),
  publish: $('#publish'),
  taskStatus: $('#task-status'),
  stats: $('#stats')
};

const state = {
  token: '',
  current: null,
  busy: false,
  seen: new Set(),
  published: 0
};

const SAVED_TOKEN_KEY = 'microtranslate.oauth2.ownerOnlyToken';

try {
  const savedToken = localStorage.getItem(SAVED_TOKEN_KEY);
  if (savedToken) {
    el.token.value = savedToken;
    state.token = savedToken;
    el.remember.checked = true;
    el.authPill.textContent = 'token đã lưu';
    setStatus(el.authStatus, 'Đã nạp token lưu trên thiết bị. Bấm “Test token” để kiểm tra.');
  }
} catch (_) {}

el.where.textContent = location.hostname.includes('github.io') ? 'GitHub Pages' : location.protocol.replace(':','');

function cfg() {
  return el.mode.value === 'commons'
    ? { mode: 'commons', api: 'https://commons.wikimedia.org/w/api.php' }
    : { mode: 'wikidata', api: 'https://www.wikidata.org/w/api.php' };
}

function languages() {
  const src = el.src.value.trim().toLowerCase();
  const dst = el.dst.value.trim().toLowerCase();
  const re = /^[a-z][a-z0-9-]{1,14}$/i;
  if (!re.test(src) || !re.test(dst)) throw new Error('Mã ngôn ngữ không hợp lệ.');
  if (src === dst) throw new Error('Source và target đang giống nhau.');
  return { src, dst };
}

function setStatus(node, text, type = '') {
  node.textContent = text;
  node.className = 'status' + (type ? ' ' + type : '');
}

function networkHint(error) {
  const msg = error && error.message ? error.message : String(error);
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(msg)) {
    return msg + '\n\nSafari/WebView có thể đang chặn fetch. Token chưa chắc có vấn đề.';
  }
  return msg;
}

function setBusy(value) {
  state.busy = value;
  [el.mode, el.src, el.dst, el.next, el.skip, el.publish, el.answer]
    .forEach(node => node.disabled = value);
}

async function publicGet(api, params) {
  const url = new URL(api);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  url.searchParams.set('origin', '*');
  const response = await fetch(url.toString(), { method: 'GET', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  if (data.error) throw new Error(data.error.info || data.error.code || 'API error');
  return data;
}

function oauthUrl(api, params = {}) {
  const url = new URL(api);
  url.searchParams.set('crossorigin', '');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url;
}

function normalizeToken(raw) {
  let token = String(raw || '').trim();
  token = token.replace(/^Bearer\s+/i, '').trim();
  if ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1).trim();
  }
  return token;
}

function authHeaders() {
  if (!state.token) throw new Error('Chưa Test token.');
  return { Authorization: 'Bearer ' + state.token };
}

async function readResponse(response) {
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!response.ok) {
    const detail =
      (data && data.error && (data.error.info || data.error.code)) ||
      (data && (data.error_description || data.message || data.error)) ||
      text || ('HTTP ' + response.status);
    throw new Error('HTTP ' + response.status + ': ' + String(detail).slice(0, 500));
  }
  if (data && data.error) throw new Error(data.error.info || data.error.code || 'API error');
  return data !== null ? data : text;
}

async function authGet(api, params) {
  const response = await fetch(oauthUrl(api, params).toString(), {
    method: 'GET', headers: authHeaders(), credentials: 'omit', cache: 'no-store'
  });
  return await readResponse(response);
}

async function authPost(api, params) {
  const url = oauthUrl(api);
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => body.set(k, String(v)));
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    credentials: 'omit', cache: 'no-store', body
  });
  return await readResponse(response);
}

function entities(data) {
  if (!data || !data.entities) return [];
  return Array.isArray(data.entities) ? data.entities : Object.values(data.entities);
}

async function testToken() {
  const typed = normalizeToken(el.token.value);
  if (!typed) {
    setStatus(el.authStatus, 'Chưa paste token.', 'error');
    return;
  }
  state.token = typed;
  el.token.value = typed;
  el.testAuth.disabled = true;
  try {
    setStatus(el.authStatus, '1/2 — đang test access token trên Meta…');
    const profileResponse = await fetch('https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile', {
      method: 'GET', headers: authHeaders(), credentials: 'omit', cache: 'no-store'
    });
    const profile = await readResponse(profileResponse);
    const profileName = profile && (profile.username || profile.name);
    setStatus(el.authStatus,
      '1/2 Meta OAuth OK' + (profileName ? ' — ' + profileName : '') +
      '\n2/2 — đang test Wikidata Action API…');
    const data = await authGet('https://www.wikidata.org/w/api.php', {
      action: 'query', meta: 'userinfo', uiprop: 'groups|rights', format: 'json', formatversion: 2
    });
    const info = data && data.query && data.query.userinfo;
    if (!info || !info.name || info.anon) throw new Error('Wikidata Action API vẫn xem request là anonymous.');
    el.authPill.textContent = info.name;
    if (el.remember.checked) {
      try { localStorage.setItem(SAVED_TOKEN_KEY, state.token); } catch (_) {}
    } else {
      try { localStorage.removeItem(SAVED_TOKEN_KEY); } catch (_) {}
    }
    setStatus(el.authStatus,
      'OAuth OK — ' + info.name + '\nMeta profile + Wikidata Action API đều pass.', 'ok');
  } catch (error) {
    state.token = '';
    el.authPill.textContent = 'lỗi';
    setStatus(el.authStatus,
      'OAuth test fail:\n' + networkHint(error) +
      '\n\nĐừng gửi access token; chỉ cần gửi nguyên phần lỗi này.', 'error');
  } finally {
    el.testAuth.disabled = false;
  }
}
