// node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parse, render, problems, newFragment, milestoneState, loadConfig, readEntries } from '../scripts/progress.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'progress.mjs')
const config = {
  title: 'Demo', dir: 'progress', out: 'PROGRESS.md',
  milestones: [{ id: 'M0', name: 'Skeleton', demo: 'it starts' }, { id: 'M1', name: 'Reads', demo: 'it reads' }],
  checks: ['tests', 'lint'],
}
const frag = (meta, body = '**Did:** a thing.\n**Next:** the next thing.\n**Blockers:** nothing') =>
  `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}\n`

test('parse reads front matter, ignores trailing comments, keeps the body', () => {
  const e = parse('---\nat: 2026-01-02T03:04:05Z\nagent: claude\ntests: green   # ran npm test\n---\n\n**Did:** x', 'a.md')
  assert.equal(e.meta.at, '2026-01-02T03:04:05Z')
  assert.equal(e.meta.tests, 'green')
  assert.equal(e.body, '**Did:** x')
})

test('a file without front matter is kept as a body, and reported', () => {
  const e = parse('just words', 'b.md')
  assert.deepEqual(e.meta, {})
  assert.ok(problems([e], config).some(p => p.includes('no "at:"')))
})

test('render: newest entry drives "Now"; newest fragment per milestone drives the table', () => {
  const entries = [
    parse(frag({ at: '2026-01-03T00:00:00Z', agent: 'codex', milestone: 'M1', tests: 'red', lint: 'green' },
      '**Did:** started reading.\n**Next:** fix the parser.\n**Blockers:** an API key from a person'), '3.md'),
    parse(frag({ at: '2026-01-02T00:00:00Z', agent: 'claude', milestone: 'M0', done: 'true', tests: 'green', lint: 'green' }), '2.md'),
    parse(frag({ at: '2026-01-01T00:00:00Z', agent: 'claude', milestone: 'M0', tests: 'red', lint: 'not-applicable' }), '1.md'),
  ]
  const out = render(entries, config)
  assert.match(out, /\*\*Next action:\*\* fix the parser\./)
  assert.match(out, /\*\*Blocked on:\*\* an API key from a person/)
  assert.match(out, /\| M0 \| Skeleton \| it starts \| ✅ done \| 🟢 green \| 🟢 green \|/)
  assert.match(out, /\| M1 \| Reads \| it reads \| in progress \| 🔴 red \| 🟢 green \|/)
  assert.match(out, /3 entries, newest first/)
  assert.ok(out.indexOf('2026-01-03') < out.indexOf('2026-01-01'), 'newest first in the log')
})

test('done with a red check is not done', () => {
  const e = parse(frag({ at: 'x', agent: 'a', milestone: 'M0', done: 'true', tests: 'red', lint: 'green' }), 'f.md')
  assert.equal(milestoneState(e, config), 'in progress (a check is red)')
  assert.equal(milestoneState(undefined, config), 'not started')
})

test('problems: unknown milestone, missing and misspelt checks, missing Did/Next', () => {
  const e = parse(frag({ at: 'x', agent: 'a', milestone: 'M9', tests: 'gren' }, 'nothing useful'), 'bad.md')
  const p = problems([e], config).join('\n')
  assert.match(p, /unknown milestone "M9"/)
  assert.match(p, /check "tests" is "gren"/)
  assert.match(p, /check "lint" is not stated/)
  assert.match(p, /no \*\*Did:\*\* line/)
  assert.match(p, /no \*\*Next:\*\* line/)
})

test('problems: a fragment from "new" that nobody filled in is reported, a filled-in one is not', () => {
  const meta = { at: 'x', agent: 'a', milestone: 'M0', tests: 'green', lint: 'green' }
  const empty = parse(frag(meta, '**Did:** \n**Next:** \n**Blockers:** nothing'), 'empty.md')
  const p = problems([empty], config)
  assert.deepEqual(p, ['empty.md: **Did:** is empty', 'empty.md: **Next:** is empty'])
  // only Next empty: the Blockers line must not be read as its value
  const half = parse(frag(meta, '**Did:** a thing.\n**Next:**\n**Blockers:** nothing'), 'half.md')
  assert.deepEqual(problems([half], config), ['half.md: **Next:** is empty'])
  // a value that runs over several lines, and Windows line ends, are fine
  const long = parse(frag(meta, '**Did:** a thing,\nand another.\r\n**Next:** more.\r\n**Blockers:** nothing'), 'long.md')
  assert.deepEqual(problems([long], config), [])
  assert.match(render([long], config), /\*\*Next action:\*\* more\./)
})

test('new: writes a fragment with a UTC stamp and never overwrites one', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'progress-'))
  const now = new Date('2026-05-06T07:08:09.123Z')
  const a = newFragment(['--agent', 'claude', '--milestone', 'M0', '--tests', 'green'], config, cwd, now)
  const b = newFragment(['--agent', 'claude'], config, cwd, now)
  assert.match(a, /20260506T070809Z-claude\.md$/)
  assert.match(b, /20260506T070809Z-claude-2\.md$/)
  const text = readFileSync(a, 'utf8')
  assert.match(text, /^---\nat: 2026-05-06T07:08:09Z\nagent: claude\nmilestone: M0\ntests: green\nlint: not-applicable\n---/)
  assert.throws(() => newFragment(['--agent', '../x'], config, cwd, now), /--agent/)
  assert.throws(() => newFragment(['--agent', 'a', '--tests', 'maybe'], config, cwd, now), /--tests must be/)
})

test('command line: generate, then --check passes; a new fragment makes --check fail until regenerated', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'progress-cli-'))
  writeFileSync(join(cwd, 'progress.config.json'), JSON.stringify(config))
  mkdirSync(join(cwd, 'progress'))
  writeFileSync(join(cwd, 'progress', '20260101T000000Z-claude.md'),
    frag({ at: '2026-01-01T00:00:00Z', agent: 'claude', milestone: 'M0', tests: 'green', lint: 'green' }))
  const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd, encoding: 'utf8' })
  assert.equal(run().status, 0)
  assert.equal(run('--check').status, 0)
  const made = run('new', '--agent', 'human', '--milestone', 'M1')
  assert.equal(made.status, 0)
  assert.equal(readdirSync(join(cwd, 'progress')).length, 2)
  assert.equal(run('--check').status, 1, 'stale, and the new fragment has an empty Did/Next')
  assert.equal(readEntries(loadConfig(cwd), cwd).length, 2)
})

test('without a config file there is no milestone table and no checks', () => {
  const out = render([parse(frag({ at: 'x', agent: 'a' }), 'f.md')], { title: 'Progress', dir: 'progress', out: 'PROGRESS.md', milestones: [], checks: [] })
  assert.doesNotMatch(out, /## Milestones/)
  assert.match(out, /1 entry, newest first/)
})
