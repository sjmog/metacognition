import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage, ToolUseSummary } from 'claude-code'

import type { Line, Run } from '../types'

const COMMAND = 'metacognition'
const AGENT = 'metacognition:metacognizer'
const TOOL = 'mcp__metacognition__consult'
const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']

const isOn = atom({ plugin: 'metacognition', key: 'isOn' } as const, true)
const isWorking = atom({ plugin: 'metacognition', key: 'isWorking' } as const, false)
const checkedSincePrompt = atom({ plugin: 'metacognition', key: 'checkedSincePrompt' } as const, false)
const running = atom({ plugin: 'metacognition', key: 'running' } as const, null)
const spawned = atom({ plugin: 'metacognition', key: 'spawned' } as const, [])
const checkedAt = atom({ plugin: 'metacognition', key: 'checkedAt' } as const, null)
const thread = atom({ plugin: 'metacognition', key: 'thread' } as const, [])
const shownFrom = atom({ plugin: 'metacognition', key: 'shownFrom' } as const, 0)

const AGREE = 'AGREE'

const SYSTEM = `You are the metacognizer. You watch another Claude session from above, with fresh eyes: you were not there for its reasoning, and that is the point. You never do its work and never change anything. You read code and run read-only commands (git status, git diff, git log, grep, ls, cat) to check your ideas.

Your one job is to catch the session missing the forest for the trees: working hard down one path when a higher-level move would make most of that work unnecessary, or when the outcome itself is framed wrong.

Ignore code quality, style, bugs, naming, missing tests and next steps along the current path. Others own those.`

const CHECK = `Start from the person's own words, not the working agent's restatement of them. What outcome do they actually want?

Before judging the current approach, list for yourself two or three other ways to get that outcome, at different levels: something that already exists, a different layer or owner, a change to data or config instead of code, deleting instead of adding, not doing it at all, or a different outcome that would serve them better. Check the promising ones against the code. Then compare them with the whole path the session is on, including the signs of working at the wrong level: a diff far bigger than the idea behind it, special cases piling up, the same thing fixed again and again, fighting the tools, guards and checks multiplying.

If the session's direction is already the simple, high-level one, or you would not bet that your point changes what the person does, your final message is exactly: ${AGREE}

Otherwise your final message has two parts and nothing else:
1. For the person: two or three short sentences in very plain words. Say what to do instead and why it is simpler. No jargon, no lists, no file paths unless one is the point.
2. A line holding only ---, then for the working agent: your fuller reasoning, the evidence you found (files, commands, what they showed) and the first cheap step that would confirm the move.`

const REPLY = `The person is talking to you, not to the agent doing the work. Reply to their last message as the metacognizer in two or three short sentences of very plain words. Look at the code if it helps you answer.`

const stripped = (text: string) =>
  text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .trim()

const call = (use: ToolUseSummary) => {
  const { file_path, command, pattern, description } = use.input
  const what = String(file_path ?? command ?? pattern ?? description ?? '').replace(/\s+/g, ' ')
  return `- ${use.tool} ${what.slice(0, 120)}`
}

// What was asked and what was done, but little of the session's reasoning,
// so the metacognizer isn't pulled down the same funnel.
function session(messages: SessionMessage[], cwd: string) {
  const asks = messages
    .filter(m => m.role === 'user' && (m.toolResults ?? []).length === 0)
    .map(m => stripped(m.text).slice(0, 4000))
    .filter(text => text !== '')
  const said = messages
    .filter(m => m.role === 'assistant' && m.text.trim() !== '')
    .map(m => m.text.trim())
    .join('\n\n')
    .slice(-6000)
  const calls = messages.flatMap(m => m.toolUses).slice(-40).map(call)
  return [
    `## What the person asked, in order\n\n${asks.join('\n\n---\n\n')}`,
    `## What the working agent says it is doing (its own words, latest last; it may be heading the wrong way)\n\n${said}`,
    `## Its latest tool calls\n\n${calls.join('\n')}`,
    `Working directory: ${cwd}. Run git status and git diff there to see the change so far.`,
  ].join('\n\n')
}

const SPEAKER = { you: 'The person', claude: 'The working agent', metacognizer: 'You (metacognizer)' } as const

const transcript = (lines: Line[]) =>
  lines.map(l => `${SPEAKER[l.from]}: ${l.text}${l.detail === undefined ? '' : `\n\n${l.detail}`}`).join('\n\n')

// The note before a --- line is the person's; what follows is the working agent's.
function point(answer: string): Line {
  const [text = '', ...rest] = answer.split(/^-{3,}\s*$/m)
  const detail = rest.join('---').trim()
  return { from: 'metacognizer', text: text.trim(), ...(detail === '' ? {} : { detail }) }
}

function task(kind: Run['kind'], lines: Line[]) {
  if (kind === 'reply') return `## Your conversation with the person\n\n${transcript(lines)}\n\n${REPLY}`
  if (lines.length === 0) return CHECK
  return `## What you have already raised, and the person's replies\n\n${transcript(lines)}\n\nThe person has seen all of these. Never raise any of them, or a variant of them, again: raise only a move that is new.\n\n${CHECK}`
}

const CONSULT = `Consult the metacognizer: a fresh agent that reads this session (the person's own words, what you have done, the diff so far) and looks for a higher-level move you are missing, one that would make much of the current approach unnecessary or show the outcome is framed wrong. It answers ${AGREE}, or with the move, its reasoning and a cheap step to confirm it. It works in the background: its answer is added to this conversation a minute or two later, so carry on meanwhile. Call it every so often during substantial work: roughly every 10 to 20 turns, judged by where you are. Call it sooner when you are about to commit to an approach, when a change is growing far bigger than the idea behind it, or when you have fixed the same thing twice; later during routine steps. Weigh what it says: if it holds, change course; if not, say why in a line.`

const forClaude = (lines: Line[]) =>
  `The metacognizer (a fresh agent watching this session for a higher-level move) and I discussed this:\n\n${transcript(lines)}\n\nRun the cheap check it names before deciding. If it holds, change course; if not, say why in a line.`

const say = ($: EngineInterface, line: Line) => update($, thread, lines => [...lines, line])

async function start($: EngineInterface, kind: Run['kind'], question?: string) {
  // update() may run its function more than once, so who won is read from its last run.
  let isMine = false
  await update($, running, run => {
    isMine = run === null
    return run ?? { kind }
  })
  if (!isMine) return false
  const brief = session(await $.session.messages(), await $.session.cwd())
  const asked = question === undefined ? '' : `The working agent is consulting you and asks: ${question}\n\n`
  const prompt = `${brief}\n\n${asked}${task(kind, await read($, thread))}`
  const spawn = await $.agent.spawn({ subagentType: AGENT, prompt, description: `Metacognition ${kind}` })
  const agentId = spawn.agentId
  if (agentId === undefined) {
    await update($, running, () => null)
    $.ui.toast(`Metacognition could not start: ${spawn.deny ?? 'no agent'}`)
    return false
  }
  await update($, spawned, ids => [...ids, agentId])
  await update($, running, () => ({ kind, agentId }))
  return true
}

// Mid-turn the working agent reads an appended row at its next step; idle, only a prompt reaches it.
async function deliver($: EngineInterface, text: string) {
  if (await read($, isWorking)) await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  else await $.prompt.submit({ text })
}

async function finish($: EngineInterface, kind: Run['kind'], answer: string | null) {
  await update($, running, () => null)
  const text = answer?.trim() ?? ''
  if (kind !== 'reply' && answer !== null) {
    const now = await $.clock.now()
    await update($, checkedAt, () => now)
  }
  if (text !== '' && !(kind !== 'reply' && text.startsWith(AGREE))) await say($, point(text))
  if (kind === 'consult' && text !== '') await deliver($, `The metacognizer answered your consult:\n\n${text}`)
  if ((await read($, thread)).at(-1)?.from === 'you') await start($, 'reply')
}

async function discuss($: EngineInterface, text: string) {
  if (text.trim() === '') return
  await say($, { from: 'you', text })
  await start($, 'reply')
}

const checkSoon = ($: EngineInterface) => $.clock.after(0, () => void start($, 'check'))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'consult',
      description: CONSULT,
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'What you want it to look at. Leave it out to have it judge the session as a whole.' },
        },
      },
      isDeferred: false,
    })
    await $.agent.register({
      name: 'metacognizer',
      description: 'Watches a session from above for a higher-level move it is missing. Started by the metacognition mod only.',
      prompt: SYSTEM,
      tools: ['Read', 'Bash'],
    })
    await $.command.register({
      name: COMMAND,
      description: 'Metacognition mode: on, off, or now to check at once. Bare toggles it.',
      argumentHint: '[on|off|now]',
      immediate: true,
    })
    return next(e)
  })

  on('agent.offer', { agent: AGENT }, () => ({ isOffered: false }))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (!(await read($, isOn))) return { result: 'Metacognition is off for this session. Carry on.' }
    const question = typeof e.question === 'string' ? e.question : undefined
    if (!(await start($, 'consult', question)))
      return { result: 'The metacognizer could not start (it may be busy with another check). Carry on; consult again later if it still matters.' }
    if (question !== undefined) await say($, { from: 'claude', text: question })
    return { result: 'The metacognizer is looking. Its answer will be added to this conversation in a minute or two; carry on meanwhile.' }
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'now') {
      if (!(await read($, isOn))) return { text: 'Metacognition is off. /metacognition on first.' }
      checkSoon($)
      return { text: 'Metacognition is checking.' }
    }
    const turnOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, isOn))
    await update($, isOn, () => turnOn)
    return { text: turnOn ? 'Metacognition on for this session.' : 'Metacognition off for this session.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const ids = await read($, spawned)
      if (ids.some(id => e.text.includes(id))) return { drop: 'a metacognition agent finished; its answer is in the band' }
    }
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') await update($, checkedSincePrompt, () => false)
    return next(e)
  })

  // The main loop's first edit after a prompt is when the plan is set but still cheap to change.
  // Subagents' edits don't count: they work inside a direction the main loop chose.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || !EDIT_TOOLS.includes(String(e.tool)) || !(await read($, isOn))) return result
    let isFirstEdit = false
    await update($, checkedSincePrompt, checked => {
      isFirstEdit = !checked
      return true
    })
    if (isFirstEdit) checkSoon($)
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, isWorking, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await update($, isWorking, () => false)
    const run = await read($, running)
    if (run === null || run.agentId === undefined || e.agentId !== run.agentId) return result
    if (e.reason !== 'answer') $.ui.toast(`Metacognition ${run.kind} ended: ${e.reason}`)
    await finish($, run.kind, e.reason === 'answer' ? e.answer : null)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'mobile' || e.surface === 'vscode') return next(e)
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)
    const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
    const all = await read($, thread)
    const lines = all.slice(await read($, shownFrom))
    const thinking = (await read($, running)) !== null
    const at = await read($, checkedAt)

    if (lines.length === 0) {
      const status = thinking
        ? 'thinking…'
        : at === null
          ? 'watching'
          : `agrees · ${new Date(at).toTimeString().slice(0, 5)}`
      return (
        <Box flexDirection="row" columnGap={2} borderStyle="round" borderColor="cyan" borderDimColor paddingX={1}>
          <Text color="cyan">◇ Metacognition {status}</Text>
          <Input key="ask" autoFocus placeholder="ask the metacognizer" submitLabel="ask" onSubmit={text => void discuss($, text)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={1}>
        <Text bold color="yellow">
          ◆ Metacognition{thinking ? <Text dimColor> thinking…</Text> : ''}
        </Text>
        {lines.map(l =>
          l.from === 'metacognizer' ? <Markdown text={l.text} /> : <Text dimColor>› {l.from === 'claude' ? 'Claude asked: ' : ''}{l.text}</Text>,
        )}
        <Box flexDirection="row" columnGap={2}>
          <Input key="reply" autoFocus placeholder="reply to the metacognizer" submitLabel="send" onSubmit={text => void discuss($, text)} />
          <Button key="tell" label="Tell Claude" onPress={() => void $.prompt.fill({ text: forClaude(lines), mode: 'insert' })} />
          <Button key="dismiss" label="Dismiss" onPress={() => void update($, shownFrom, () => all.length)} />
        </Box>
      </Box>
    )
  })
}
