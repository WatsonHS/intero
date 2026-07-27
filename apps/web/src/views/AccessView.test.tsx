import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignInView } from "./AccessView.js";

describe("access view keyboard hierarchy", () => {
  it("places password sign-in before Passkey and exposes an accessible eye toggle", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const output = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SignInView />
      </QueryClientProvider>,
    );

    const email = output.indexOf('data-testid="sign-in-email"');
    const password = output.indexOf('data-testid="sign-in-password"');
    const toggle = output.indexOf('data-testid="sign-in-password-toggle"');
    const submit = output.indexOf('data-testid="sign-in-password-submit"');
    const passkey = output.indexOf('data-testid="sign-in-passkey"');

    expect(email).toBeGreaterThan(-1);
    expect(email).toBeLessThan(password);
    expect(password).toBeLessThan(toggle);
    expect(toggle).toBeLessThan(submit);
    expect(submit).toBeLessThan(passkey);
    expect(output).toContain('type="submit"');
    expect(output).toContain('aria-label="显示密码"');
    expect(output).toContain('autoComplete="current-password"');
    expect(output).not.toContain("Magic Link");
  });
});
