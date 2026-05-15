/**
 * GET / — routes a chat/setup/instructions/expired page based on the
 * state machine output. The chat page (state C with no JWT) is
 * served WITHOUT requiring an Access JWT — recruiters must never see
 * a login screen (spec §4 access rules).
 */

import { detectState, State } from "../state/machine";
import type { Env } from "../env";
import {
  renderChatPage,
  renderSetupForm,
  renderSetupInstructions,
  renderExpiredSetup,
  type ChatPageProps,
} from "../views";
import { parseStoredConfig } from "../types/config";
import { verifyAccessJwt } from "../auth/access";
import { resolveJwksSource } from "./jwks-source";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;

/** Default starter questions used when none are configured. */
const DEFAULT_SUGGESTED_QUESTIONS = [
  "Tell me about a hard technical decision you've made.",
  "What's the largest team you've led?",
  "What are your salary expectations?",
];

export async function handleRoot(request: Request, env: Env): Promise<Response> {
  // Best-effort JWT verification. Missing token => unauthenticated path;
  // invalid token => unauthenticated path (verification errors are swallowed
  // here because the chat page must remain public).
  const headerToken = request.headers.get("cf-access-jwt-assertion") ?? "";
  let jwtValid = false;
  let jwtEmail: string | undefined;
  let jwtAud: string | undefined;
  let jwtTeamDomain: string | undefined;

  if (headerToken.length > 0) {
    try {
      const source = await resolveJwksSource(env);
      const id = await verifyAccessJwt(headerToken, source);
      jwtValid = true;
      jwtEmail = id.email;
      jwtAud = id.aud;
      jwtTeamDomain = id.team_domain;
    } catch {
      // Public-safe fallthrough.
    }
  }

  const result = await detectState({
    kv: env.STATE,
    jwtValid,
    jwtEmail,
    jwtAud,
    jwtTeamDomain,
  });

  switch (result.state) {
    case State.A_UNCONFIGURED:
      return new Response(renderSetupInstructions(), { status: 200, headers: HTML_HEADERS });

    case State.B_SETUP_FORM:
      return new Response(
        renderSetupForm({ email: jwtEmail }),
        { status: 200, headers: HTML_HEADERS },
      );

    case State.D_EXPIRED: {
      const start = await env.STATE.get("setup_window_start");
      return new Response(
        renderExpiredSetup({ setupWindowStart: start ?? undefined }),
        { status: 200, headers: HTML_HEADERS },
      );
    }

    case State.C_CONFIGURED: {
      // The chat page is public regardless of JWT state. access_denied
      // only matters for owner routes (/admin), which are handled elsewhere.
      const raw = await env.STATE.get("config");
      if (raw === null) {
        // Race: config disappeared between detectState and now. Fall back
        // to instructions; the next request will re-detect.
        return new Response(renderSetupInstructions(), { status: 200, headers: HTML_HEADERS });
      }
      let parsed: ReturnType<typeof parseStoredConfig>;
      try {
        parsed = parseStoredConfig(JSON.parse(raw));
      } catch {
        parsed = { ok: false, error: "config JSON parse failed" };
      }
      if (!parsed.ok) {
        return new Response(renderSetupInstructions(), { status: 200, headers: HTML_HEADERS });
      }
      const cfg = parsed.value;
      const props: ChatPageProps = {
        display_name: cfg.display_name,
        headline: cfg.about_blurb,
        suggested_questions: DEFAULT_SUGGESTED_QUESTIONS,
      };
      return new Response(renderChatPage(props), { status: 200, headers: HTML_HEADERS });
    }
  }
}
