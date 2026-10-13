// Code pasted into the prompt box lands wrapped in a ```lang fence. The rewrite is made on the
// edit's input before `next`, so md-prompt (which paints whatever text `next` resolves to) draws
// the fenced text as a code card whichever of the two loads first. Pastes only: typing is never touched.

import type { Register } from 'claude-code'

const SHEBANG: [RegExp, string][] = [
  [/python/, 'python'], [/node|deno|bun/, 'javascript'], [/php/, 'php'], [/ruby/, 'ruby'], [/perl/, 'perl'],
]

// First match wins: surest signatures first. Every tag is one md-prompt highlights.
// `^[ \t]*`, never `^\s*`: under /m, \s spans newlines and a run of blank lines is rescanned from
// every line start, which froze the hooks worker for seconds on a large paste.
const RULES: [string, RegExp][] = [
  ['php', /^<\?php|\$this->|^[ \t]*namespace [\w\\]+;|^[ \t]*(public|private|protected)( static)? function |^[ \t]*use [A-Z]\w*\\[\w\\]+;/m],
  ['html', /^\s*<(!doctype html|html|head|body|div|span|template|section|main|nav|form|table|ul|ol|p|a|button|input|img|script|style)[\s>/]/i],
  ['xml', /^\s*<(\?xml|[\w:-]+[\s>])/],
  ['dockerfile', /^FROM \S+[^]*^(RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|ENV) /m],
  // ponytail: O(lines × size) on a paste of hundreds of KB whose lines all open with a SQL verb, cap the text read if it bites
  ['sql', /^[ \t]*(SELECT\b[^]*\bFROM|INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE (TABLE|INDEX|VIEW)|ALTER TABLE|DROP TABLE)\b/m],
  ['sql', /^[ \t]*(select|insert into|update|delete from|create table|alter table)\b[^;]*;\s*$/im],
  ['python', /^[ \t]*(def \w+\(.*\)( -> .+)?:|class \w+(\(.*\))?:|from [\w.]+ import |import \w+(\.\w+)*$|elif |if __name__)/m],
  ['go', /^package \w+$|^func (\(\w+ \*?\w+\) )?\w+\(/m],
  ['rust', /^[ \t]*(pub )?fn \w+|let mut |^[ \t]*impl\b|^[ \t]*use \w+::|#\[derive/m],
  ['java', /^[ \t]*(public|private|protected) (static |final |abstract )*(class|interface|enum|void|[\w<>[\], ]+ \w+\()/m],
  ['typescript', /^[ \t]*(export )?(interface \w+|type \w+(<.*>)? =|enum \w+)|\w\??:\s*(string|number|boolean|void|unknown|any)\b|^import type /m],
  ['javascript', /^[ \t]*(const|let|var) [\w{}[\], ]+=|\)\s*=>|=>\s*\{|^[ \t]*import .+ from |^[ \t]*export (default|const|function|class) |function\s*\w*\(|console\.log|require\(/m],
  ['css', /(?<![^])(?=[^]*\{[ \t]*$)(?=[^]*^[ \t]*[\w-]+[ \t]*:[^;{}\n]+;[ \t]*$)/m], // (?<![^]): tried at the start only
  ['bash', /^[ \t]*(\$ |sudo |npm |npx |yarn |pnpm |git |cd |ls |echo |export \w+=|brew |docker |kubectl |curl |composer |php artisan |chmod |mkdir |rm )/m],
]

// Every line a key, a list item or a comment, with some nesting: `Objet: x\nDate: y` stays prose.
function isYaml(code: string) {
  const lines = code.split('\n').filter((l) => l.trim())
  return lines.length > 1 && /^[ \t]+\S|^- /m.test(code) && lines.every((l) => /^\s*(- |#|[\w.-]+:(\s|$))/.test(l))
}

/** The fence tag for `code`: a language, '' for code of no known language, null for prose. */
export function detect(code: string): string | null {
  const shebang = /^#!.*/.exec(code)?.[0]
  if (shebang) return SHEBANG.find(([re]) => re.test(shebang))?.[1] ?? 'bash'
  if (/^[{[]/.test(code)) {
    try {
      JSON.parse(code)
      return 'json'
    } catch {}
  }
  if (isYaml(code)) return 'yaml'
  const rule = RULES.find(([, re]) => re.test(code))
  if (rule) return rule[0]
  // ponytail: line-ending heuristic for unknown languages, a real classifier if it misfires on prose
  const lines = code.split('\n').filter((l) => l.trim())
  return lines.filter((l) => /[;{}]\s*$/.test(l)).length / lines.length >= 0.3 ? '' : null
}

/** What a paste of `code` at `start` in `text` becomes, or null to let it land as is. */
export function fence(text: string, start: number, code: string): string | null {
  if (!code.includes('\n') || code.includes('```')) return null
  if ((text.slice(0, start).match(/^[ \t]*```/gm) ?? []).length % 2) return null // inside an open fence
  const body = code.replace(/^\s*\n/, '').trimEnd()
  const lang = detect(body)
  if (lang === null) return null
  const nl = start > 0 && text[start - 1] !== '\n' ? '\n' : ''
  return `${nl}\`\`\`${lang}\n${body}\n\`\`\`\n`
}

export const register: Register = (on) => {
  on('prompt.edit', async ($, e, next) => {
    if (e.key) return next(e) // a key press, not a paste
    // terminal only: the desktop (an SDK host, no REPL) never lists `terminal`
    if (!(await $.session.surfaces()).includes('terminal')) return next(e)
    const inputText = fence(e.text, e.start, e.inputText)
    return next(inputText === null ? e : { ...e, inputText })
  })
}
