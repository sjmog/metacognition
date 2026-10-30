/** `claude` is the working agent consulting the metacognizer through its tool. */
export type Line = {
  from: "metacognizer" | "you" | "claude";
  /** What the person sees: for the metacognizer, its short plain note. */
  text: string;
  /** The metacognizer's fuller reasoning and evidence, for the working agent only. */
  detail?: string;
  /** Set on an answer to the working agent's consult: the agent was given it in full. */
  isSentToClaude?: true;
};

/** The metacognizer agent at work: a check of the session, a reply to the person, or the working agent consulting it. No agentId while it starts. */
export type Run = { kind: "check" | "reply" | "consult"; agentId?: string };

declare module "claude-code" {
  interface PluginState {
    metacognition: {
      isOn: boolean;
      /** Whether the main loop is mid-turn, so a consult's answer is appended to the turn rather than starting one. */
      isWorking: boolean;
      /** Main-loop tool calls since the person's last prompt (or /loop round); the tenth starts a check. */
      callsSincePrompt: number;
      /** The person's prompts as typed, each once, where it last came: what a brief calls "what the person asked". */
      asks: string[];
      running: Run | null;
      /** Every metacognizer agent this session spawned, so their task notifications never reach the working agent. */
      spawned: string[];
      checkedAt: number | null;
      /** Everything the metacognizer and the person have said this session; the metacognizer is given all of it. */
      thread: Line[];
      /** Where the band's view of the thread starts: Dismiss moves it to the end, so dismissed points are hidden but never forgotten. */
      shownFrom: number;
    };
  }
}
