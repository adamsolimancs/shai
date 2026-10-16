import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ThemeToggle from "@/components/ThemeToggle";

describe("ThemeToggle", () => {
  it("respects stored mode and toggles", async () => {
    window.localStorage.setItem("shai-theme-consent", "granted");
    document.cookie = "shai-color-mode=dark; Path=/";
    render(<ThemeToggle />);

    const button = await screen.findByRole("button", { name: /switch to light mode/i });
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(button);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.cookie).toContain("shai-color-mode=light");
    });
  });
});
