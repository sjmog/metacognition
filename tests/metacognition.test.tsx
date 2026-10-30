import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMessage } from 'claude-code'

const BAND = {
  plugin: 'metacognition',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'Export the notes as CSV.', toolUses: [] },
  { role: 'assistant', text: 'I will write a new CSV exporter.', toolUses: [{ tool_use_id: 't1', tool: 'Edit', input: { file_path: 'export.ts' } }] },
]

const calls = async (call: () => Promise<unknown>, n: number) => {
  for (let i = 0; i < n; i++) await call()
}
const read = () => ({ tool: 'Read', file_path: 'a.ts' }) as const

const run = (args: string) =>
  ({ command: 'meta', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } }) as const

function engine(on: On) {
  const spawns: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'meta' } }))
  on('agent.register', () => ({ value: { agent: 'metacognition:metacognizer' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__metacognition__consult' } }))
  on('agent.spawn', (_, e) => {
    spawns.push(e.prompt)
    return { model: 'opus' }
  })
  on('session.messages', () => ({ value: MESSAGES }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: 0 }))
  on('tool.call', () => ({ result: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock: mock.clock(on), spawns }
}

test('the tenth main-loop call after a prompt starts one check', async ($, on) => {
  const { clock, spawns } = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await calls(() => $.tool.call(read()), 9)
  await clock.settle()
  expect(spawns.length).toBe(0)

  await $.tool.call(read())
  await clock.settle()
  expect(spawns.length).toBe(1)

  await calls(() => $.tool.call(read()), 15)
  await clock.settle()
  expect(spawns.length).toBe(1)
})

test("the brief lists the person's own asks once each, and leaves out bare commands and the mod's own messages", async ($, on) => {
  const { clock, spawns } = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const loop = '/loop make the export match the old CSV byte for byte'
  const asLoop = { name: 'loop', args: 'make the export match the old CSV byte for byte' }
  await $.prompt.submit({ text: loop, command: asLoop, origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: '/reload-plugins', command: { name: 'reload-plugins', args: '' }, origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: 'Keep the header row.', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: loop, command: asLoop, origin: { kind: 'scheduled-trigger' }, wait: false })
  await $.prompt.submit({ text: 'The metacognizer answered your consult:\n\nUse the old exporter.', origin: { kind: 'plugin', name: 'metacognition' }, wait: false })
  await $.prompt.submit({ text: 'The metacognizer (a fresh agent watching this session for a higher-level move) and I discussed this: …', origin: { kind: 'composer' }, wait: false })
  await $.command.run(run('now'))
  await clock.settle()

  const asked = (spawns[0] ?? '').split('## What the working agent')[0] ?? ''
  expect(asked.match(/byte for byte/g)?.length).toBe(1)
  expect(asked.indexOf('Keep the header row.')).toBeLessThan(asked.indexOf('byte for byte'))
  expect(asked).not.toMatch(/reload-plugins|old exporter|discussed this/)
  expect(spawns[0]).toMatch(/~\/\.claude\/projects\/\*\/session-1\.jsonl/)
})

test('a burst of parallel calls starts one check', async ($, on) => {
  const { clock, spawns } = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await Promise.all(Array.from({ length: 25 }, () => $.tool.call(read())))
  await clock.settle()
  expect(spawns.length).toBe(1)
})

test('off means no checks and no band', async ($, on) => {
  const { clock, spawns } = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run(run('off'))
  for (let i = 0; i < 25; i++) await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await clock.settle()
  expect(spawns.length).toBe(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Metacognition/ })).toBeUndefined()
  await ui.unmount()
})

test("a consult starts the metacognizer on the working agent's question", async ($, on) => {
  const { spawns } = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__metacognition__consult', question: 'Should I write a new exporter?' })
  expect(spawns[0]).toMatch(/asks: Should I write a new exporter\?/)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the quiet band draws in its frame, on ${surface}`, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/repo', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Metacognition/ }))?.text).toBe('◇ Metacognition watching')
    expect(await ui.find({ key: 'ask' })).toBeDefined()
    await ui.unmount()
  })
}

test('/meta with a question asks the metacognizer from the prompt', async ($, on) => {
  const { spawns } = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const answer = await $.command.run(run('is there a simpler way?'))
  expect(answer.text).toMatch(/Asked the metacognizer/)
  expect(spawns[0]).toMatch(/The person: is there a simpler way\?/)
})
