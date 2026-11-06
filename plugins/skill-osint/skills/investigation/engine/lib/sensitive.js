// GDPR article 9 data — health, religion or belief, sex life or sexual orientation, political opinions, racial or
// ethnic origin, trade-union membership, genetic and biometric data — is never looked for nor recorded in a person case
// nor in its children; a person case never helps to find, contact or follow a private person, nor looks at a minor.
// Words in English and French, matched on folded text (lower case, no accents). Pure: the dashboard may import it.
// ponytail: a word list, not a classifier — it stops the plain cases (a property named religion, « il est syndiqué »,
// a dating site's account) and names the category; what slips through stays the agent's rule (SKILL.md, method.md).
// (NFKD: full-width letters and ligatures; \p{M} the accents; \p{Cf} the soft hyphen, zero-width spaces and joiners;
// any run of white space, a no-break space or a line break included, is one space)
export const fold = s => String(s ?? '').normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '').toLowerCase().replace(/\s+/g, ' ')

const words = list => new RegExp(`(?<![a-z0-9])(?:${list.join('|')})(?![a-z0-9])`)
export const CATEGORIES = {
  health: {
    label: 'health',
    re: words(['malad(?:e|es|ie|ies)', 'diagnostiqu\\w* (?:de|d\'|avec|a|en)', 'diagnos(?:ed|is) (?:with|as|of)', 'cancer\\w*', 'diabet\\w*', 'chimiotherapie', 'chemotherapy', 'handicap\\w*', 'disabilit\\w*', 'seropositi\\w*', 'vih', 'hiv', 'sida',
      'psychiatr\\w*', 'depressi(?:on|f|ve)', 'sante mentale', 'mental health', 'etat de sante', 'health condition', 'medical (?:condition|record|history)',
      'dossier medical', 'antecedents medicaux', '(?:est|etait|tombee|devenue|serait|reste)(?:-t)?(?:-(?:elle|il))? enceinte', 'grossesse', 'pregnan\\w*', 'illness', 'disease', 'addiction', 'alcoolique', 'alcoholic', 'toxicomane']),
    keys: ['health', 'sante', 'medical', 'diagnosis', 'disability', 'handicap'], values: ['health', 'medical'],
  },
  religion: {
    label: 'religion or belief',
    re: words(['religio\\w*', 'croyant\\w*', 'believer', 'musulman\\w*', 'muslim\\w*', 'islam(?:ique|ic|isme|ism|iste|ist)?', 'chretien\\w*', 'christianity',
      'christianisme', 'juif', 'juive', 'juifs', 'juives', 'jewish', 'judaisme', 'judaism', 'catholi\\w*', 'protestant\\w*', 'evangeli\\w*', 'bouddhis\\w*',
      'buddhis\\w*', 'hindou\\w*', 'hindu\\w*', 'athee', 'athees', 'atheis\\w*', 'pratiquant\\w*', 'mosquee', 'mosque', 'synagogue', 'eglise', 'imam', 'hijab', 'burqa', 'rabbin', 'voile (?:islamique|integral)', '(?:porte|portent|portait|met) (?:le |son )?voile', 'temoin de jehovah', 'jehovah']),
    keys: ['religion', 'belief', 'beliefs', 'croyance', 'confession'], values: ['religion', 'religious'],
  },
  sex: {
    label: 'sex life or sexual orientation',
    re: words(['orientation sexuelle', 'sexual orientation', 'vie sexuelle', 'sex life', 'homosexu\\w*', 'heterosexu\\w*', 'bisexu\\w*', 'lesbien\\w*', 'lesbian\\w*',
      'transgen\\w*', 'lgbt\\w*', 'queer', '(?:est|is|etre|being|[a-z]+[\'’]s) gay', '(?:est|is|etait|was) (?:un |une |a )?(?:homo|trans)', 'gay (?:man|men|woman|women|couple|bar|club|dating)', 'pratiques sexuelles', 'sexual practices',
      'site de rencontres?', 'dating (?:site|app|profile)']),
    keys: ['sexual_orientation', 'orientation_sexuelle', 'sex_life', 'vie_sexuelle', 'sexuality', 'sexualite'], values: ['dating', 'lgbt', 'lgbtq', 'nsfw'],
  },
  politics: {
    label: 'political opinions',
    re: words(['opinions? politiques?', 'political (?:opinions?|views?|leaning|affiliation|party|parties)', 'partis? politiques?', 'militant\\w*', 'sympathisant\\w*',
      "adherent d'un parti", 'membre du parti', 'party member\\w*', 'vote(?:s|d)? (?:pour |for )?(?:le |la |l\'|the )?(?:parti|party|candidat\\w*|rn|fn|lfi|ps|lr|ump|front national|rassemblement national|republicains|ecolo\\w*|labou?r|tor(?:y|ies)|republican\\w*|democrat\\w*)', 'electeur de', 'electrice de', 'extreme[ -](?:droite|gauche)', 'far[ -](?:right|left)']),
    keys: ['political_opinion', 'political_opinions', 'opinion_politique', 'opinions_politiques', 'politics', 'political_party', 'parti_politique'], values: ['political', 'politics'],
  },
  origin: {
    label: 'racial or ethnic origin',
    re: words(['origine (?:ethnique|raciale)', 'ethnic (?:origin|background|group)', 'racial (?:origin|background)', 'ethnie\\w*', 'ethnicit\\w*', 'appartenance raciale', 'race (?:blanche|noire)']),
    keys: ['ethnicity', 'ethnie', 'ethnic_origin', 'origine_ethnique', 'racial_origin', 'origine_raciale', 'race'], values: [],
  },
  union: {
    label: 'trade-union membership',
    re: words(['syndiqu\\w*', 'syndical\\w*', "adherent d'un syndicat", "membre d'un syndicat", 'trade unions?', 'labou?r unions?', '(?:trade|labou?r) union member\\w*']),
    keys: ['trade_union', 'syndicat', 'union_membership'], values: [],
  },
  genetic: {
    label: 'genetic data',
    re: words(['genetiq\\w*', 'genetic\\w*', 'genome\\w*', 'test adn', 'dna test\\w*', 'profil genetique']),
    keys: ['genetic', 'genetique', 'dna', 'adn', 'genome'], values: [],
  },
  biometric: {
    label: 'biometric data',
    re: words(['biometri\\w*', 'empreintes? digitales?', 'reconnaissance faciale', 'facial recognition', 'face recognition', 'faceprint\\w*', 'empreinte vocale', 'voiceprint\\w*', 'iris scan\\w*']),
    keys: ['biometric', 'biometrics', 'biometrie'], values: [],
  },
}
const keyOf = k => fold(k).trim().replace(/[\s-]+/g, '_')
// the names to ignore come out of the text at word limits only (a name never hides a word it merely sits inside)
const esc = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const strip = (s, ignore) => ignore.filter(Boolean).map(n => fold(n).trim()).filter(Boolean).reduce((t, n) => t.replace(new RegExp(`(?<![a-z0-9])${esc(n)}(?![a-z0-9])`, 'g'), ' '), fold(s))
const find = text => Object.entries(CATEGORIES).find(([, c]) => c.re.test(text))?.[0] ?? null
export function sensitiveHit({ text = '', props = {}, ignore = [] } = {}) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === '' || v === false) continue
    const byKey = Object.entries(CATEGORIES).find(([, c]) => c.keys.includes(keyOf(k)))?.[0]
    if (byKey) return { category: byKey, where: `property ${k}` }
    for (const x of [].concat(v)) {
      if (typeof x !== 'string') continue
      const exact = Object.entries(CATEGORIES).find(([, c]) => c.values.includes(fold(x).trim()))?.[0]
      const hit = exact ?? find(strip(x, ignore))
      if (hit) return { category: hit, where: `property ${k}` }
    }
  }
  const hit = find(strip(text, ignore))
  return hit ? { category: hit, where: 'text' } : null
}

// a frame that pursues a private person: to find where they live, contact or follow them (an ex, « où elle habite »)
const PURSUIT = words(['mon ex', 'ma ex', 'my ex', 'ex-?(?:copine|copain|femme|mari|compagne|compagnon|epoux|epouse|petite amie|petit ami|girlfriend|boyfriend|wife|husband|partner)',
  'ou (?:il|elle) (?:habite|vit|loge|dort|travaille maintenant)', 'where (?:he|she|they) (?:lives?|live|sleeps?|stays?)', 'son adresse (?:personnelle|perso)',
  '(?:her|his|their) home address', 'suivre ses deplacements', 'track (?:his|her|their) (?:movements|location|whereabouts)', '(?:le|la) (?:retrouver|localiser)', 'ancien(?:ne)? (?:compagne|compagnon|copine|copain)', 'habite-t-(?:il|elle)', 'ou habite', '(?:trouver|chercher|connaitre|obtenir|retrouver) (?:l\'|la )?adresse (?:de|du|d\')',
  'surveill\\w*', 'espionn\\w*', 'geolocalis\\w*', 'domicile', 'whereabouts',
  'harcel\\w*', 'harass\\w*', 'stalk\\w*', 'le suivre', 'la suivre', 'follow (?:him|her) around'])
export function pursuitHit(text) {
  const m = PURSUIT.exec(fold(text))
  return m ? m[0] : null
}

// may the person be under 18 today? born as yyyy, yyyy-mm or yyyy-mm-dd: the youngest they can be decides
export function isMinor(born, now = new Date()) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(born ?? ''))
  if (!m) return false
  const y = +m[1], mo = m[2] ? +m[2] : 12, d = m[3] ? +m[3] : new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return Date.UTC(y + 18, mo - 1, d) > now.getTime()
}

// WhatsMyName's categories a person case never checks: the account alone would tell art. 9 data
export const SENSITIVE_SITE_CATEGORIES = new Set(['dating', 'health', 'political', 'nsfw'])

// a street address (a person's home is never looked for nor planned): a number, then a street word
const STREET = /(?<![a-z0-9])\d{1,4}\s*(?:bis|ter)?\s*,?\s+(?:rue|avenue|av|bd|boulevard|chemin|impasse|allee|place|route|quai|cours|square|lieu-dit|street|st|road|rd|lane|ln|drive|dr|way)(?![a-z0-9])/
export const isStreetAddress = s => STREET.test(fold(s))
