import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HostPage } from "../src/components/host-page";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HostPage", () => {
  it("keeps the host signed in when the quiz list request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/session")) {
        return new Response(JSON.stringify({ email: "hello@gelolaus.com", sub: "host" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/quizzes")) {
        return new Response(JSON.stringify({ error: "unavailable" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    render(<HostPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /pick a quiz/i })).toBeVisible();
    });
    expect(screen.getByText(/signed in as hello@gelolaus.com/i)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.queryByRole("link", { name: /continue with google/i })).toBeNull();
  });
});
