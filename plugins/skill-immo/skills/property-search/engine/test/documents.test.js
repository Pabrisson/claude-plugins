import assert from 'node:assert/strict'
import test from 'node:test'
import { DOC_TYPES, docTypeOf } from '../lib/documents.js'

test("a document's type from its file name: the precise ones before « diagnostic », else other", () => {
  const names = {
    'PV AG 2025.pdf': 'minutes', 'Diagnostics DDT.pdf': 'ddt', 'Relevé de charges 2024-2025.pdf': 'charges', 'Pré-état daté.pdf': 'pre_sale',
    'Avis_taxe_fonciere_2025.pdf': 'tax', 'Diagnostic de performance énergétique.pdf': 'dpe', 'DTG 2023.pdf': 'works_plan', 'Etat des risques.pdf': 'risks',
    'Facture EDF mars.pdf': 'energy_bills', 'Devis toiture.pdf': 'invoices', 'Règlement copro.pdf': 'rules', 'Acte de vente.pdf': 'deed', 'scan001.pdf': 'other', 'page.png': 'other',
  }
  for (const [n, k] of Object.entries(names)) assert.equal(docTypeOf(n), k, n)
  // every type a name can give is one of the list
  assert.ok(Object.values(names).every(k => DOC_TYPES.some(d => d.key === k)))
})
