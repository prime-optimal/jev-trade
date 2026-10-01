import { activateProgram, DEFAULT_PROGRAM } from "./jev-program";
import { deepFreeze, type ActiveProgram, type EvaluationProvider, type ProgramDefinition } from "./jev-evidence";
import type { LifecycleControl } from "./settings-runtime";

const TAPE_PROGRAM: ProgramDefinition = deepFreeze({
  ...DEFAULT_PROGRAM,
  questions: [...DEFAULT_PROGRAM.questions, {
    key: "tapeDirection", type: "choice", role: "observational",
    instructions: { question: "Does the selected tape favor rising or falling prices?" },
    criteria: { rising: "Buying pressure", falling: "Selling pressure" },
  }],
  groups: [
    { id: "trade", features: ["coin", "mid", "returnsBps", "trades", "position", "maxLeverage"], questions: DEFAULT_PROGRAM.projection.keys },
    { id: "tape", features: ["mid", "trades", "recentTrades"], questions: ["tapeDirection"] },
  ],
});

/** One instance per execution runtime; definitions never cross visitor workers. */
export class ProgramRuntime {
  private current: ActiveProgram;
  readonly presets;

  constructor(private readonly lifecycle: Pick<LifecycleControl, "snapshot">, readonly provider: EvaluationProvider) {
    this.current = activateProgram(DEFAULT_PROGRAM, provider);
    this.presets = deepFreeze([
      { id: "default", name: "Default", description: "All catalog inputs and required trading questions.", definition: DEFAULT_PROGRAM },
      { id: "tape", name: "Tape focus", description: "Selected price and tape inputs with a supplemental direction question.", definition: TAPE_PROGRAM },
    ].map((preset) => ({ ...preset, definition: activateProgram(preset.definition, provider).definition })));
  }

  active = (): ActiveProgram => this.current;

  snapshot() {
    return { definition: this.current.definition, revision: this.current.revision };
  }

  apply(definition: unknown) {
    const status = this.lifecycle.snapshot().status;
    if (status !== "off" && status !== "expired") throw new Error("Stop trading before changing the Jev program");
    this.current = activateProgram(definition, this.provider);
    return this.snapshot();
  }
}
