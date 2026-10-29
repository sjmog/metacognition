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
- Yellow: a short note in plain words saying what to do instead. Reply in the box to discuss it, press **Tell Claude** to hand the discussion and the metacognizer's fuller reasoning to the working agent, or **Dismiss** (it won't raise that point again).

Keys: `ctrl+x tab` jumps from the prompt into the band's text box, `Tab` walks to its buttons, `Esc` goes back to the prompt, and `ctrl+x ctrl+a` collapses the band.

## When it runs

- By itself at the working agent's first file edit after each of your prompts, when the plan is set but still cheap to change.
- When the working agent consults it through its `consult` tool, every so often during substantial work. The answer goes back to the agent, and the short note goes in the band.
- When you run `/metacognition now`.

Each check is a full agent that reads code, so it costs tokens. Turn it off for a session with `/metacognition off` (`on` turns it back on, bare `/metacognition` toggles).
