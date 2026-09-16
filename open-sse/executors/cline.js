import { DefaultExecutor } from "./default.js";

/**
 * ClineExecutor — talks to https://api.cline.bot/api/v1/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as CodeBuddy:
 * free-tier models (cline-free/*, *-free, z-ai/*) only serve SSE upstream
 * and return empty body on non-streaming calls. Force stream:true here so
 * chatCore re-aggregates SSE into a JSON response for non-streaming clients.
 */
export class ClineExecutor extends DefaultExecutor {
  constructor() {
    super("cline");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;
    return transformed;
  }
}

export default ClineExecutor;
