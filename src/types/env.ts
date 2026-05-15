/**
 * Re-export of the Worker Env binding shape. Lives under src/types/
 * so spec-aligned imports (`import type { Env } from "./types/env"`)
 * resolve, while the canonical declaration stays in src/env.ts.
 */
export type { Env } from "../env";
