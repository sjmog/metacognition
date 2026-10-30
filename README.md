# Metacognition

Agents tend to funnel down: they finesse one approach when a simpler move one level up would make most of the work unnecessary. This mod adds a metacognizer, a fresh read-only agent that watches the session and looks for that move.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install metacognition --marketplace sjmog/metacognition
```

Answer `y` to add the marketplace, then pick the user scope. From a shell:

```
claude plugin install metacognition --marketplace sjmog/metacognition
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `sjmog/metacognition`, then Add plugin.

## What you see

A framed band above the prompt.

- Cyan, one line: `◇ Metacognition agrees · 14:52`. Nothing to say.
- Yellow: a short note in plain words saying what to do instead. Reply in the box to discuss it, press **Tell Claude** to hand the discussion and the metacognizer's fuller reasoning to the working agent (the band then clears), or **Dismiss** (it won't raise that point again).

Ask it anything from the prompt with `/meta <question>`; the answer shows in the band. To use the band's own buttons, `ctrl+x tab` moves into it, `Tab` walks its buttons, and `Esc` returns to the prompt.

## When it runs

- By itself at the working agent's tenth tool call after each of your prompts (each `/loop` round counts as a prompt), when it has usually chosen a direction that is still cheap to change.
- When the working agent consults it through its `consult` tool: every so often during substantial work, and before another eval round, a PR stack, or when you push back. The answer goes back to the agent, and the short note goes in the band.
- When you run `/meta now`.

The metacognizer runs on the session's own model and effort. To change either, open `/config` and set **Metacognizer model** (fable, opus, sonnet, haiku) or **Metacognizer effort** (low to max).

Each check is a full agent that reads code, so it costs tokens. Turn it off for a session with `/meta off`, and back on with `/meta on`.
