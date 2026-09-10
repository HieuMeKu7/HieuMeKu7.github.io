async function findWikidataTask() {
  const { src, dst } = languages();
  const random = await publicGet(`https://${dst}.wikipedia.org/w/api.php`, {
    action: 'query', generator: 'random', grnnamespace: 0, grnlimit: 40,
    prop: 'pageprops', ppprop: 'wikibase_item', format: 'json', formatversion: 2
  });
  const ids = ((random.query && random.query.pages) || [])
    .map(page => page.pageprops && page.pageprops.wikibase_item)
    .filter(Boolean);
  if (!ids.length) return null;

  const data = await publicGet('https://www.wikidata.org/w/api.php', {
    action: 'wbgetentities', ids: ids.join('|'), props: 'descriptions|sitelinks',
    languages: src + '|' + dst, sitefilter: src + 'wiki|' + dst + 'wiki',
    format: 'json', formatversion: 2
  });

  for (const entity of entities(data)) {
    if (!entity || state.seen.has(entity.id)) continue;
    const descriptions = entity.descriptions || {};
    const sitelinks = entity.sitelinks || {};
    const srcDescription = descriptions[src];
    const targetExists = Object.prototype.hasOwnProperty.call(descriptions, dst);
    const srcPage = sitelinks[src + 'wiki'];
    const dstPage = sitelinks[dst + 'wiki'];
    if (srcDescription && srcDescription.value && !targetExists &&
        srcPage && srcPage.title && dstPage && dstPage.title) {
      return {
        kind: 'description', id: entity.id, title: dstPage.title,
        sourceText: srcDescription.value,
        sourceUrl: `https://${src}.wikipedia.org/wiki/${encodeURIComponent(srcPage.title.replace(/ /g, '_'))}`,
        targetUrl: `https://${dst}.wikipedia.org/wiki/${encodeURIComponent(dstPage.title.replace(/ /g, '_'))}`,
        entityUrl: `https://www.wikidata.org/wiki/${encodeURIComponent(entity.id)}`
      };
    }
  }
  return null;
}

async function findCommonsTask() {
  const { src, dst } = languages();
  const api = 'https://commons.wikimedia.org/w/api.php';
  const search = await publicGet(api, {
    action: 'query', generator: 'search',
    gsrsearch: `hascaption:${src} -hascaption:${dst}`,
    gsrnamespace: 6, gsrlimit: 40, prop: 'imageinfo', iiprop: 'url', iiurlwidth: 700,
    format: 'json', formatversion: 2
  });
  const pages = ((search.query && search.query.pages) || [])
    .filter(page => !state.seen.has('M' + page.pageid));
  const ids = pages.map(page => 'M' + page.pageid);
  if (!ids.length) return null;

  const data = await publicGet(api, {
    action: 'wbgetentities', ids: ids.join('|'), props: 'labels',
    languages: src + '|' + dst, format: 'json', formatversion: 2
  });

  for (const entity of entities(data)) {
    if (!entity || state.seen.has(entity.id)) continue;
    const labels = entity.labels || {};
    const sourceLabel = labels[src];
    const targetExists = Object.prototype.hasOwnProperty.call(labels, dst);
    if (!sourceLabel || !sourceLabel.value || targetExists) continue;
    const page = pages.find(p => 'M' + p.pageid === entity.id);
    if (!page) continue;
    const info = page.imageinfo && page.imageinfo[0];
    return {
      kind: 'caption', id: entity.id, title: page.title.replace(/^File:/i, ''),
      sourceText: sourceLabel.value,
      image: info && (info.thumburl || info.url) || '',
      entityUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`
    };
  }
  return null;
}

async function findTask() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const task = cfg().mode === 'wikidata' ? await findWikidataTask() : await findCommonsTask();
    if (task) return task;
  }
  return null;
}

function addLink(label, href) {
  const a = document.createElement('a');
  a.textContent = label;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  el.links.appendChild(a);
}

function renderTask() {
  if (!state.current) {
    el.task.classList.add('hidden');
    el.empty.classList.remove('hidden');
    return;
  }
  const item = state.current;
  const { src, dst } = languages();
  el.kind.textContent = item.kind === 'description'
    ? `Dịch mô tả ${src.toUpperCase()} → ${dst.toUpperCase()}`
    : `Dịch caption ${src.toUpperCase()} → ${dst.toUpperCase()}`;
  el.title.textContent = item.title;
  el.source.textContent = item.sourceText;
  el.answer.value = '';
  el.count.textContent = '0 / 250';
  el.links.innerHTML = '';
  if (item.image) {
    el.image.src = item.image;
    el.image.classList.remove('hidden');
  } else {
    el.image.removeAttribute('src');
    el.image.classList.add('hidden');
  }
  if (item.sourceUrl) addLink(src.toUpperCase() + ' article', item.sourceUrl);
  if (item.targetUrl) addLink(dst.toUpperCase() + ' article', item.targetUrl);
  addLink(item.id, item.entityUrl);
  el.empty.classList.add('hidden');
  el.task.classList.remove('hidden');
  setTimeout(() => el.answer.focus(), 50);
}

async function nextTask() {
  if (state.busy) return;
  try {
    languages();
    setBusy(true);
    state.current = null;
    renderTask();
    setStatus(el.taskStatus, 'Đang tìm micro-edit…');
    const item = await findTask();
    if (!item) throw new Error('Chưa tìm được task phù hợp. Bấm Next thử lại.');
    state.current = item;
    renderTask();
    setStatus(el.taskStatus, 'Task ' + item.id);
  } catch (error) {
    setStatus(el.taskStatus, 'Lỗi: ' + networkHint(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function csrfToken(api) {
  const data = await authGet(api, {
    action: 'query', meta: 'tokens', type: 'csrf', format: 'json', formatversion: 2
  });
  const token = data && data.query && data.query.tokens && data.query.tokens.csrftoken;
  if (!token || token === '+\\') throw new Error('Không lấy được CSRF token.');
  return token;
}

async function recheckTarget(item) {
  const { dst } = languages();
  const api = cfg().api;
  const prop = item.kind === 'description' ? 'descriptions' : 'labels';
  const data = await publicGet(api, {
    action: 'wbgetentities', ids: item.id, props: prop, languages: dst,
    format: 'json', formatversion: 2
  });
  const entity = entities(data)[0];
  if (!entity) throw new Error('Không đọc lại được entity.');
  if (Object.prototype.hasOwnProperty.call(entity[prop] || {}, dst)) {
    throw new Error(`Có người vừa thêm ${dst} rồi; không ghi đè.`);
  }
  return entity.lastrevid;
}

async function publishCurrent() {
  if (!state.current || state.busy) return;
  const value = el.answer.value.trim();
  if (!value) {
    setStatus(el.taskStatus, 'Chưa nhập bản dịch.', 'error');
    return;
  }
  if (!state.token) {
    setStatus(el.taskStatus, 'Test token trước khi publish.', 'error');
    return;
  }
  try {
    setBusy(true);
    setStatus(el.taskStatus, 'Đang kiểm tra target…');
    const item = state.current;
    const { src, dst } = languages();
    const api = cfg().api;
    const baseRev = await recheckTarget(item);
    const csrf = await csrfToken(api);
    await authPost(api, {
      action: item.kind === 'description' ? 'wbsetdescription' : 'wbsetlabel',
      id: item.id, language: dst, value, baserevid: baseRev, token: csrf,
      assert: 'user', maxlag: 5,
      summary: `MicroTranslate web: ${src} → ${dst}`,
      format: 'json', formatversion: 2
    });
    state.seen.add(item.id);
    state.published += 1;
    el.stats.textContent = 'Đã đăng phiên này: ' + state.published;
    setStatus(el.taskStatus, 'Đăng xong ✓', 'ok');
    state.current = null;
    await nextTask();
  } catch (error) {
    setStatus(el.taskStatus, 'Lỗi đăng: ' + networkHint(error), 'error');
  } finally {
    setBusy(false);
  }
}

el.testAuth.addEventListener('click', testToken);
el.clearToken.addEventListener('click', () => {
  state.token = '';
  el.token.value = '';
  el.remember.checked = false;
  try { localStorage.removeItem(SAVED_TOKEN_KEY); } catch (_) {}
  el.authPill.textContent = 'chưa test';
  setStatus(el.authStatus, 'Đã xóa token khỏi trang và browser storage.', 'ok');
});
el.next.addEventListener('click', nextTask);
el.skip.addEventListener('click', async () => {
  if (state.current) state.seen.add(state.current.id);
  state.current = null;
  await nextTask();
});
el.publish.addEventListener('click', publishCurrent);
el.answer.addEventListener('input', () => {
  el.count.textContent = `${el.answer.value.length} / 250`;
});
el.mode.addEventListener('change', () => {
  state.current = null;
  renderTask();
});
