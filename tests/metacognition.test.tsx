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
  on('tool.call', () => ({ result: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock: mock.clock(on), spawns }
}

test("the first edit after a prompt starts a fresh check that sees the person's words", async ($, on) => {
  const { clock, spawns } = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  await clock.settle()
  expect(spawns.length).toBe(0)

  await $.tool.call({ tool: 'Edit', file_path: 'export.ts', old_string: 'a', new_string: 'b' })
  await clock.settle()
  expect(spawns.length).toBe(1)
  expect(spawns[0]).toMatch(/What the person asked[\s\S]*Export the notes as CSV[\s\S]*Edit export.ts/)

  await $.tool.call({ tool: 'Edit', file_path: 'export.ts', old_string: 'b', new_string: 'c' })
  await clock.settle()
  expect(spawns.length).toBe(1)
})

test('a burst of parallel edits starts one check', async ($, on) => {
  const { clock, spawns } = engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await Promise.all(Array.from({ length: 5 }, () => $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })))
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
