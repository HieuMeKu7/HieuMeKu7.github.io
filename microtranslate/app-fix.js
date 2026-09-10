/* MicroTranslate v2.2 hotfix.
 * Final guard against invalid optional baserevid values.
 */

// Keep the target-language collision check, but do not invent a revision ID.
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

  const revision = Number(entity.lastrevid);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
}

// app-main v2 can still pass baserevid:null/undefined. Strip it at the last
// possible point before URLSearchParams serializes it into the literal string
// "undefined". baserevid is optional in Wikibase edit modules.
const mtOriginalAuthPostV22 = authPost;
authPost = async function (api, params) {
  const clean = Object.assign({}, params || {});
  const revision = Number(clean.baserevid);

  if (Number.isInteger(revision) && revision > 0) {
    clean.baserevid = revision;
  } else {
    delete clean.baserevid;
  }

  return mtOriginalAuthPostV22(api, clean);
};
