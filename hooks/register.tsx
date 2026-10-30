import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage, ToolUseSummary } from 'claude-code'

import type { Line, Run } from '../types'

const COMMAND = 'meta'
const AGENT = 'metacognition:metacognizer'
const TOOL = 'mcp__metacognition__consult'
const TIP_EVERY_PROMPTS = 10
const CHECK_AFTER_CALLS = 10

const isOn = atom({ plugin: 'metacognition', key: 'isOn' } as const, true)
const isWorking = atom({ plugin: 'metacognition', key: 'isWorking' } as const, false)
const callsSincePrompt = atom({ plugin: 'metacognition', key: 'callsSincePrompt' } as const, 0)
const asks = atom({ plugin: 'metacognition', key: 'asks' } as const, [])
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

Then check the yardstick: what the session measures, tests against or will call done. Is that what the person cares about? A gold set the person never judged, a merged change with no check that the real number moved, or a monitor watching the wrong signal all mean the outcome is framed wrong.

Before you claim something is unexplained, unplanned or not yet tried, grep the session's transcript for it. A bug or gap the working agent has already reported is not a new move.

If the session's direction is already the simple, high-level one, or you would not bet that your point changes what the person does, your final message is exactly: ${AGREE}

Otherwise your final message opens with what the person will read: at most three short sentences and under 50 words, in words someone outside the code would follow, addressed to the person as you, saying what to do instead and why it is simpler. Start straight in with the point itself: no heading, label, numbering, jargon, code names, lists or file paths.
After that, a line holding only ---, and below it, for the working agent: your fuller reasoning, the evidence you found (files, commands, what they showed) and the first cheap step that would confirm the move.

For example:
Measure where the time goes before adding parallel searches. A one-line change may remove the wait entirely, with far less to build.
---
(the reasoning, evidence and first step)`

const REPLY = `The person is talking to you, not to the agent doing the work. Reply to their last message as the metacognizer in two or three short sentences of very plain words. Look at the code if it helps you answer.`

// A Workflow's input has none of the usual fields; its script opens with its name and description.
const call = (use: ToolUseSummary) => {
  const { file_path, command, pattern, description } = use.input
  const what = String(file_path ?? command ?? pattern ?? description ?? JSON.stringify(use.input)).replace(/\s+/g, ' ')
  return `- ${use.tool} ${what.slice(0, 120)}`
}

const clipped = (text: string, n: number) => (text.length <= n ? text : `${text.slice(0, n / 2)}\n…\n${text.slice(-n / 2)}`)

// What was asked and what was done, but little of the session's reasoning,
// so the metacognizer isn't pulled down the same funnel.
function session(asked: string[], messages: SessionMessage[], cwd: string, id: string, now: number) {
  const said = messages
    .filter(m => m.role === 'assistant' && m.text.trim() !== '')
    .map(m => m.text.trim())
    .join('\n\n')
    .slice(-6000)
  const calls = messages.flatMap(m => m.toolUses).slice(-40).map(call)
  return [
    `## What the person asked, in order\n\n${asked.map(text => clipped(text, 6000)).join('\n\n---\n\n')}`,
    `## What the working agent says it is doing (its own words, latest last; it may be heading the wrong way)\n\n${said}`,
    `## Its latest tool calls\n\n${calls.join('\n')}`,
    `Now: ${new Date(now).toISOString()}. Working directory: ${cwd}; the tool calls above show which directories and files the work touched, so look there for the change. The session's full transcript, with timestamps and anything asked before this list began, is ~/.claude/projects/*/${id}.jsonl.`,
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

// Earlier points go to a check as their short notes only: their old evidence anchored later runs.
function task(kind: Run['kind'], lines: Line[]) {
  if (kind === 'reply') return `## Your conversation with the person\n\n${transcript(lines)}\n\n${REPLY}`
  if (lines.length === 0) return CHECK
  const notes = lines.map(l => `${SPEAKER[l.from]}: ${l.text}`).join('\n\n')
  return `## What you have already raised, and the replies\n\n${notes}\n\nDon't repeat a point the person dismissed or the working agent tested and answered. You may come back to a point it took up only in part. If the session is now building a move you proposed, check what that move shifts load or risk onto before you agree.\n\n${CHECK}`
}

const CONSULT = `Consult the metacognizer: a fresh agent that reads this session (the person's own words, what you have done, the diff so far) and looks for a higher-level move you are missing, one that would make much of the current approach unnecessary or show the outcome is framed wrong. It answers ${AGREE}, or with the move, its reasoning and a cheap step to confirm it. It works in the background: its answer is added to this conversation a minute or two later, so carry on meanwhile. Call it every so often during substantial work, roughly every 10 to 20 turns judged by where you are, and especially: before you launch another eval round, workflow or batch of subagents; before you open a PR or a stack; when a change is growing far bigger than the idea behind it; when you have fixed the same thing twice; and when the person pushes back on your direction. Not for routine steps. Weigh what it says: if it holds, change course; if not, say why in a line.`

const FOR_CLAUDE = 'The metacognizer (a fresh agent watching this session for a higher-level move) and I discussed this:'

const forClaude = (lines: Line[]) =>
  `${FOR_CLAUDE}\n\n${transcript(lines)}\n\nRun the cheap check it names before deciding. If it holds, change course; if not, say why in a line.`

const say = ($: EngineInterface, line: Line) => update($, thread, lines => [...lines, line])

async function start($: EngineInterface, kind: Run['kind'], question?: string) {
  // update() may run its function more than once, so who won is read from its last run.
  let isMine = false
  await update($, running, run => {
    isMine = run === null
    return run ?? { kind }
  })
  if (!isMine) return false
  const brief = session(await read($, asks), await $.session.messages(), await $.session.cwd(), await $.session.id(), await $.clock.now())
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

const append = ($: EngineInterface, text: string) => $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })

// Mid-turn the working agent reads an appended row at its next step; idle, only a prompt reaches it.
async function deliver($: EngineInterface, text: string) {
  if (await read($, isWorking)) await append($, text)
  else await $.prompt.submit({ text })
}

async function finish($: EngineInterface, kind: Run['kind'], answer: string | null) {
  await update($, running, () => null)
  const text = answer?.trim() ?? ''
  if (kind !== 'reply' && answer !== null) {
    const now = await $.clock.now()
    await update($, checkedAt, () => now)
  }
  if (text !== '' && !(kind !== 'reply' && text.startsWith(AGREE)))
    await say($, kind === 'consult' ? { ...point(text), isSentToClaude: true } : point(text))
  // A bare AGREE read as an endorsement of the agent's design, and woke an idle agent for one word.
  if (kind === 'consult' && text.startsWith(AGREE))
    await append($, 'The metacognizer found no higher-level move. That is not a review of your design or your numbers; weigh those yourself.')
  else if (kind === 'consult' && text !== '') await deliver($, `The metacognizer answered your consult:\n\n${text}`)
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
      description: 'Ask the metacognizer a question, or: on, off, now (check at once).',
      argumentHint: '[question|on|off|now]',
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
    if (arg === 'on' || arg === 'off') {
      await update($, isOn, () => arg === 'on')
      return { text: `Metacognition ${arg} for this session.` }
    }
    if (!(await read($, isOn))) return { text: 'Metacognition is off for this session. /meta on to turn it on.' }
    if (arg === '') return { text: 'Metacognition is on. /meta <question> asks it, /meta now checks at once, /meta off turns it off.' }
    if (arg === 'now') {
      checkSoon($)
      return { text: 'Metacognition is checking.' }
    }
    await discuss($, arg)
    return { text: 'Asked the metacognizer. Its answer will show in the band.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const ids = await read($, spawned)
      if (ids.some(id => e.text.includes(id))) return { drop: 'a metacognition agent finished; its answer is in the band' }
    }
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'scheduled-trigger') {
      await update($, callsSincePrompt, () => 0)
      // A bare command (/effort, /reload-plugins) asks nothing; Tell Claude's text is the mod's own thread.
      const isAsk = !(e.command !== undefined && e.command.args.trim() === '') && !e.text.startsWith(FOR_CLAUDE)
      if (isAsk) await update($, asks, list => [...list.filter(text => text !== e.text), e.text])
    }
    return next(e)
  })

  // Ten main-loop calls after a prompt the agent has usually chosen a direction, and is still cheap to turn,
  // whether it then edits (often through Bash), delegates or investigates. Subagents' calls don't count:
  // they work inside a direction the main loop chose. update() resolves what it wrote, so one call sees 10.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || !(await read($, isOn))) return result
    if ((await update($, callsSincePrompt, n => n + 1)) === CHECK_AFTER_CALLS) checkSoon($)
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
    // Read so each turn's start and end redraws the band; the tip shows at startup and every tenth prompt.
    await read($, isWorking)
    const showsTip = (await $.session.turns()) % TIP_EVERY_PROMPTS === 0

    if (lines.length === 0) {
      const status = thinking
        ? 'thinking…'
        : at === null
          ? 'watching'
          : `agrees · ${new Date(at).toTimeString().slice(0, 5)}`
      return (
        <Box flexDirection="row" columnGap={2} borderStyle="round" borderColor="cyan" borderDimColor paddingX={1}>
          <Text color="cyan">◇ Metacognition {status}</Text>
          <Input key="ask" autoFocus placeholder={showsTip ? 'Tip: click here to ask the metacognizer, or type /meta <your question>' : undefined} submitLabel="ask" onSubmit={text => void discuss($, text)} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={1}>
        <Text bold color="yellow">
          ◆ Metacognition{thinking ? <Text dimColor> thinking…</Text> : ''}
        </Text>
        {lines.map(l =>
          l.from !== 'metacognizer' ? (
            <Text dimColor>› {l.from === 'claude' ? 'Claude asked: ' : ''}{l.text}</Text>
          ) : l.isSentToClaude ? (
            <Box flexDirection="column">
              <Markdown text={l.text} />
              <Text dimColor>✓ Claude has the full answer</Text>
            </Box>
          ) : (
            <Markdown text={l.text} />
          ),
        )}
        <Box flexDirection="row" columnGap={2}>
          <Input key="reply" autoFocus placeholder="click here to reply, or type /meta <your reply>" submitLabel="send" onSubmit={text => void discuss($, text)} />
          <Button key="tell" label="Tell Claude" onPress={() => void $.prompt.fill({ text: forClaude(lines), mode: 'insert' })} />
          <Button key="dismiss" label="Dismiss" onPress={() => void update($, shownFrom, () => all.length)} />
        </Box>
      </Box>
    )
  })
}
