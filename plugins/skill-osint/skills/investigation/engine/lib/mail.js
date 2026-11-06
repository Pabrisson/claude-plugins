// An email address read the way the mail systems read it: one form for every way it is written, Gmail's equivalent
// addresses (dots and +tags ignored), a role address (a service mailbox, not a person's), a public webmail (the domain
// says nothing of the owner), and the provider an MX or SPF host names. Pure: the email and domain types use it.
export const PROVIDERS = [
  [/(^|\.)google(mail)?\.com$/, 'Google Workspace'], [/(^|\.)(outlook|protection\.outlook)\.com$/, 'Microsoft 365'],
  [/(^|\.)ovh\.(net|com)$/, 'OVHcloud'], [/(^|\.)(protonmail\.ch|proton\.me)$/, 'Proton Mail'], [/(^|\.)zoho\.(com|eu)$/, 'Zoho Mail'],
  [/(^|\.)gandi\.net$/, 'Gandi'], [/(^|\.)ionos\.(com|fr|de)$/, 'IONOS'], [/(^|\.)(icloud|me)\.com$/, 'iCloud Mail'],
  [/(^|\.)yahoodns\.net$/, 'Yahoo Mail'], [/(^|\.)(messagingengine|fastmail)\.com$/, 'Fastmail'], [/(^|\.)orange\.fr$/, 'Orange'],
  [/(^|\.)free\.fr$/, 'Free'], [/(^|\.)laposte\.net$/, 'La Poste'], [/(^|\.)(gmx\.net|web\.de)$/, 'GMX'],
  [/(^|\.)yandex\.(net|ru)$/, 'Yandex'], [/(^|\.)mail\.ru$/, 'Mail.ru'],
]
export const WEBMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr',
  'msn.com', 'yahoo.com', 'yahoo.fr', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.net', 'gmx.fr', 'gmx.de', 'web.de', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'orange.fr', 'wanadoo.fr',
  'free.fr', 'sfr.fr', 'neuf.fr', 'laposte.net', 'bbox.fr', 'tutanota.com', 'tuta.io', 'fastmail.com'])
// RFC 2142 and their usual French and English kin: a shared or service mailbox
export const ROLES = new Set(['abuse', 'accounts', 'accueil', 'admin', 'administrator', 'billing', 'bonjour', 'commercial', 'compta', 'contact',
  'direction', 'facturation', 'hello', 'help', 'hostmaster', 'hr', 'info', 'jobs', 'mail', 'marketing', 'newsletter', 'no-reply', 'noreply',
  'office', 'postmaster', 'press', 'presse', 'recrutement', 'rh', 'sales', 'secretariat', 'security', 'service', 'support', 'team', 'webmaster'])

export function parseAddress(input) {
  let s = String(input ?? '').trim()
  s = (/<([^<>]+)>/.exec(s)?.[1] ?? s).replace(/^mailto:/i, '').replace(/[?#].*$/, '').trim().replace(/\.$/, '')
  const m = /^([^@\s<>()[\]\\,;:"]+)@([^@\s/]+\.[^@\s./]{2,})$/.exec(s)
  if (!m) return null
  let domain
  try { domain = new URL(`http://${m[2]}`).hostname.toLowerCase() } catch { return null }
  const local = m[1].toLowerCase(), plus = local.indexOf('+')
  const user = plus > 0 ? local.slice(0, plus) : local, tag = plus > 0 ? local.slice(plus + 1) : null
  const address = `${local}@${domain}`, isGmail = domain === 'gmail.com' || domain === 'googlemail.com'
  const gmail = isGmail ? `${user.replace(/\./g, '')}@gmail.com` : null
  const aliases = isGmail ? [gmail, gmail.replace(/@gmail\.com$/, '@googlemail.com')].filter(a => a !== address) : []
  return { address, local, user, tag, domain, gmail, aliases, role: ROLES.has(user), webmail: WEBMAIL.has(domain) }
}
export const mailProvider = hosts => hosts.map(h => PROVIDERS.find(([re]) => re.test(String(h).toLowerCase().replace(/\.$/, '')))?.[1]).find(Boolean) ?? null
