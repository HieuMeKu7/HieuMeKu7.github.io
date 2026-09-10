/* MicroTranslate v2.1 hotfix: always resolve a numeric baserevid before publish. */
async function recheckTarget(item) {
  const { dst } = languages();
  const api = cfg().api;
  const prop = item.kind === 'description' ? 'descriptions' : 'labels';

  const data = await publicGet(api, {
    action: 'wbgetentities',
    ids: item.id,
    props: prop,
    languages: dst,
    format: 'json',
    formatversion: 2
  });

  const entity = entities(data)[0];
  if (!entity) throw new Error('Không đọc lại được entity.');

  if (Object.prototype.hasOwnProperty.call(entity[prop] || {}, dst)) {
    throw new Error(`Có người vừa thêm ${dst} rồi; không ghi đè.`);
  }

  let revision = Number(entity.lastrevid);
  if (Number.isInteger(revision) && revision > 0) return revision;

  const queryParams = {
    action: 'query',
    prop: 'revisions',
    rvprop: 'ids',
    rvlimit: 1,
    format: 'json',
    formatversion: 2
  };

  if (entity.pageid) {
    queryParams.pageids = entity.pageid;
  } else if (item.kind === 'description') {
    queryParams.titles = item.id;
  } else {
    queryParams.titles = 'File:' + item.title;
  }

  const revisionData = await publicGet(api, queryParams);
  const pages = revisionData && revisionData.query && revisionData.query.pages
    ? revisionData.query.pages
    : [];
  const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
  revision = Number(page && page.revisions && page.revisions[0] && page.revisions[0].revid);

  if (!Number.isInteger(revision) || revision <= 0) {
    throw new Error('Không lấy được revision ID hiện tại; chưa đăng để tránh edit collision.');
  }

  return revision;
}
