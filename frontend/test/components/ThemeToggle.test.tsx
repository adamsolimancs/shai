import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ThemeToggle from "@/components/ThemeToggle";

describe("ThemeToggle", () => {
  it("respects stored mode and toggles", async () => {
    window.localStorage.setItem("shai-color-mode", "dark");
    render(<ThemeToggle />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });

    const button = screen.getByRole("button", { name: /switch to light mode/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(window.localStorage.getItem("shai-color-mode")).toBe("light");
    });
  });
});
