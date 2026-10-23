// A single session rule is sufficient because uploads are processed serially.
const RULE_ID = 1;

export function sourceRule(info, extensionId) {
  const source = new URL(info.srcUrl);
  if (!['http:', 'https:'].includes(source.protocol)) return null;
  source.hash = '';
  let referer = source.origin + '/';
  try {
    const page = new URL(info.frameUrl || info.pageUrl);
    // Use only the origin to avoid sending private page paths or query strings.
    if (['http:', 'https:'].includes(page.protocol)) referer = page.origin + '/';
  } catch { /* Direct-image contexts can omit the page URL. */ }
  // Do not send an HTTPS page's origin to an HTTP image server.
  if (source.protocol === 'http:' && referer.startsWith('https:')) referer = source.origin + '/';
  return {
    id:RULE_ID,
    priority:1,
    action:{type:'modifyHeaders', requestHeaders:[{header:'Referer', operation:'set', value:referer}]},
    condition:{
      regexFilter:'^' + source.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
      isUrlFilterCaseSensitive:true,
      initiatorDomains:[extensionId],
      resourceTypes:['xmlhttprequest'],
      requestMethods:['get']
    }
  };
}

export async function withSourceReferer(info, task, api = chrome) {
  const rule = sourceRule(info, api.runtime.id);
  // Also clear any rule left by an interrupted previous task.
  await api.declarativeNetRequest.updateSessionRules({removeRuleIds:[RULE_ID], addRules:rule ? [rule] : []});
  try { return await task(); }
  finally { await api.declarativeNetRequest.updateSessionRules({removeRuleIds:[RULE_ID]}); }
}
