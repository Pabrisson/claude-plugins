// The watch's test type: one step of things from $OSINT_WATCH_ITEMS ({ "<step>": [{ key, … }] }), read as a source,
// counted in a clue, kept as the snapshot named after the step. OSINT_WATCH_THROW=<the case's input> makes it break.
export const commands = {
  collect: {
    help: 'one step of things from OSINT_WATCH_ITEMS',
    flags: { step: 'string' },
    run: async (ctx, args, flags) => {
      const step = flags.step ?? 'quiet'
      if (process.env.OSINT_WATCH_THROW === ctx.input.thing) throw new Error(`${ctx.input.thing} broke`)
      const items = JSON.parse(process.env.OSINT_WATCH_ITEMS ?? '{}')[step] ?? []
      const src = await ctx.source({ url: `https://watched.example/${step}`, body: JSON.stringify(items), contentType: 'application/json', title: `Watched ${step}`, reliability: 'B' })
      ctx.clue(`${items.length} ${step} things`, { status: 'read', sources: [src.id] })
      ctx.snapshot(step, items)
    },
  },
}
