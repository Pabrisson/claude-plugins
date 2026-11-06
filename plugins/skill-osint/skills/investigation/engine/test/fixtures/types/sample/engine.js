// items from $OSINT_SAMPLE_ITEMS, recorded as a source, entities and a snapshot
export const commands = {
  collect: {
    help: 'items from OSINT_SAMPLE_ITEMS',
    flags: { loud: 'boolean' },
    run: async (ctx, args, flags) => {
      const items = JSON.parse(process.env.OSINT_SAMPLE_ITEMS ?? '[]')
      const src = await ctx.source({ url: 'https://sample.example/items', body: JSON.stringify(items), contentType: 'application/json', title: 'Sample items', reliability: 'B' })
      for (const it of items) ctx.entity('domain', it.key, { sources: [src.id] })
      ctx.progress(1, 1, flags.loud ? 'loud' : 'quiet')
      ctx.timeline(items.map(it => ({ date: it.date ?? '2026-01-01', label: it.key, ref: src.id })))
      ctx.snapshot('items', items)
    },
  },
  py: { help: 'a GeoINT script through ctx.python', raw: true, run: async (ctx, args) => { const r = await ctx.python(args[0], args.slice(1)); ctx.log(`exit ${r.code}, ${r.produced.length} files`) } },
  overall: { help: 'a command about every case of the type', global: true, flags: {}, run: async c => console.log(`${c.manifest.id} cases: ${c.cases().map(x => x.slug).join(', ')}`) },
}
