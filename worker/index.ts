import type { Env } from "./env";

export class PongRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  fetch(): Response {
    return new Response(`Pong room ${this.state.id.toString()}`);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
