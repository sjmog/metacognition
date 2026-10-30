/** `claude` is the working agent consulting the metacognizer through its tool. */
export type Line = {
  from: "metacognizer" | "you" | "claude";
  /** What the person sees: for the metacognizer, its short plain note. */
  text: string;
  /** The metacognizer's fuller reasoning and evidence, for the working agent only. */
  detail?: string;
  /** Set on an answer to the working agent's consult: the agent was given it in full. */
  isSentToClaude?: true;
  /** How many session messages there were when this note went up: the work after that is what can overtake it. */
  seen?: number;
};

/** What a metacognizer agent was started for: a check of the session, a reply to the person, or the working agent consulting it. */
export type RunKind = "check" | "reply" | "consult";

/** A metacognizer agent: what it was for, and how many session messages its brief was built from. */
export type Run = { kind: RunKind; seen: number };

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
      /** Every metacognizer agent this session started, by agent id: whether one is still at work is the engine's agent list's to say. */
      started: Record<string, Run>;
      checkedAt: number | null;
      /** Everything the metacognizer and the person have said this session; the metacognizer is given all of it. */
      thread: Line[];
      /** Where the band's view of the thread starts: Dismiss moves it to the end, so dismissed points are hidden but never forgotten. */
      shownFrom: number;
    };
  }
}
