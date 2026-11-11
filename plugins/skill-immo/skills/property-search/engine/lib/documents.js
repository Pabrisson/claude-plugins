// The documents a buyer gets for a property, each document of a conversation one of these types (`documents[].type`);
// the dashboard's « Demande de documents » lists them too. `types`: the property types it is for; `request`: its words
// in a request (false: never asked for); `on`: ticked to begin with in a request.
const ALL = ['flat', 'house', 'land', 'parking', 'premises'], HOME = ['flat', 'house'], BUILT = ['flat', 'house', 'premises'], COPRO = ['flat', 'parking', 'premises']

export const DOC_GROUPS = [['diagnostics', 'Diagnostics'], ['copro', 'Copropriété'], ['property', 'Le bien'], ['other', 'Autre']]
export const DOC_TYPES = [
  { key: 'ddt', group: 'diagnostics', label: 'Dossier de diagnostics (DDT)', types: BUILT, request: false },
  { key: 'dpe', group: 'diagnostics', label: 'DPE', request: 'DPE complet', types: BUILT, on: true },
  { key: 'asbestos', group: 'diagnostics', label: 'Amiante', types: BUILT, on: true },
  { key: 'lead', group: 'diagnostics', label: 'Plomb (CREP)', types: HOME, on: true },
  { key: 'electricity', group: 'diagnostics', label: 'Électricité', types: HOME, on: true },
  { key: 'gas', group: 'diagnostics', label: 'Gaz', types: HOME, on: true },
  { key: 'termites', group: 'diagnostics', label: 'Termites', types: BUILT, on: true },
  { key: 'risks', group: 'diagnostics', label: 'État des risques (ERP)', types: ALL, on: true },
  { key: 'carrez', group: 'diagnostics', label: 'Mesurage loi Carrez', types: ['flat', 'premises'], on: true },
  { key: 'sanitation', group: 'diagnostics', label: 'Assainissement', types: ['house'], on: true },
  { key: 'minutes', group: 'copro', label: "PV d'AG", request: 'PV des 3 dernières AG', types: COPRO, on: true },
  { key: 'charges', group: 'copro', label: 'Relevé de charges', request: 'Relevé des charges des 2 dernières années', types: COPRO, on: true },
  { key: 'pre_sale', group: 'copro', label: 'Pré-état daté', types: COPRO, on: true },
  { key: 'rules', group: 'copro', label: 'Règlement de copropriété', request: 'Règlement de copropriété et état descriptif', types: COPRO },
  { key: 'summary', group: 'copro', label: 'Fiche synthétique', types: COPRO },
  { key: 'logbook', group: 'copro', label: "Carnet d'entretien", types: COPRO },
  { key: 'works_plan', group: 'copro', label: 'Plan pluriannuel de travaux', request: 'Plan pluriannuel de travaux (PPT, DTG)', types: COPRO },
  { key: 'tax', group: 'property', label: 'Taxe foncière', request: 'Avis de taxe foncière', types: ALL, on: true },
  { key: 'deed', group: 'property', label: 'Titre de propriété', types: ALL },
  { key: 'plans', group: 'property', label: 'Plans', types: BUILT },
  { key: 'invoices', group: 'property', label: 'Factures de travaux', types: BUILT },
  { key: 'energy_bills', group: 'property', label: "Factures d'énergie", types: HOME },
  { key: 'urbanism', group: 'property', label: "Certificat d'urbanisme", types: ['land'], on: true },
  { key: 'boundary', group: 'property', label: 'Bornage', types: ['land'], on: true },
  { key: 'other', group: 'other', label: 'Autre', types: ALL, request: false },
]
export const isDocType = k => DOC_TYPES.some(d => d.key === k)

// a file's type from its name, the first that matches (the precise ones before the wide ones: « diagnostic » last)
/** @type {[string, RegExp][]} */
const NAMES = [
  ['pre_sale', /pre ?etat|etat date/], ['works_plan', /\bppt\b|\bdtg\b|pluriannuel|technique global/], ['energy_bills', /factur.*(energ|edf|engie|electri|gaz|chauffage)/],
  ['minutes', /\bpv\b|proces ?verbal|assemblee|\bag[eo]?\b/], ['charges', /charges/], ['rules', /reglement|etat descriptif|\bedd\b/], ['summary', /fiche synth/],
  ['logbook', /carnet/], ['tax', /\btax|foncier/], ['deed', /titre|\bacte\b/], ['invoices', /factur|devis/], ['plans', /\bplans?\b/], ['urbanism', /urbanisme|\bcu\b/],
  ['boundary', /bornage|geometre/], ['dpe', /\bdpe\b|performance energ/], ['asbestos', /amiante/], ['lead', /plomb|\bcrep\b/], ['electricity', /electri/],
  ['gas', /\bgaz\b/], ['termites', /termite/], ['risks', /\berp\b|\besris\b|\bernmt\b|risques/], ['carrez', /carrez|mesurage|boutin/],
  ['sanitation', /assainissement|\bspanc\b/], ['ddt', /\bddt\b|diagnostic/],
]
export function docTypeOf(name) {
  const n = String(name ?? '').replace(/\.[a-z0-9]+$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_.\-'’]+/g, ' ')
  return NAMES.find(([, re]) => re.test(n))?.[0] ?? 'other'
}
