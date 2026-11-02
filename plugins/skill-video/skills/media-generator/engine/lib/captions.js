// Words with their times (ElevenLabs' voices, transcripts and alignments) made into captions: a cue at most 42
// characters and 5 s, closed after a sentence's end, a pause of more than 0.6 s or a change of speaker
const time = s => new Date(Math.max(0, +s || 0) * 1000).toISOString().slice(11, 23).replace('.', ',')

export function srt(words) {
  const cues = []
  for (const w of words.filter(x => String(x.text ?? '').trim())) {
    const cue = cues.at(-1), last = cue?.words.at(-1)
    const fits = cue && w.speaker === cue.speaker && w.start - last.end <= 0.6 && w.end - cue.words[0].start <= 5
      && [...cue.words, w].map(x => x.text).join(' ').length <= 42 && !/[.!?…]["»”)]?$/.test(last.text)
    if (fits) cue.words.push(w)
    else cues.push({ speaker: w.speaker, words: [w] })
  }
  return cues.map((c, i) => `${i + 1}\n${time(c.words[0].start)} --> ${time(c.words.at(-1).end)}\n${c.words.map(x => x.text).join(' ')}\n`).join('\n')
}

// a voice's character timings (the timed text to speech) made into words; its audio tags ([whispers]) left out. A
// dialogue's lines follow each other with no space between them (2026-11-02): its segments start a word, each its line
export function wordsOf(alignment, segments = []) {
  const { characters: ch = [], character_start_times_seconds: a = [], character_end_times_seconds: b = [] } = alignment ?? {}, words = []
  const line = new Map(segments.map(s => [s.character_start_index, s.dialogue_input_index]))
  let w = null, speaker
  ch.forEach((c, i) => {
    if (line.has(i)) [w, speaker] = [null, line.get(i)]
    if (/\s/.test(c)) return (w = null)
    if (!w) words.push((w = { text: '', start: a[i], end: b[i], ...(speaker != null ? { speaker } : {}) }))
    w.text += c
    w.end = b[i]
  })
  return words.filter(x => !/^\[[^\]]*\]$/.test(x.text))
}
