import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AwardsAccordion from "@/components/AwardsAccordion";

describe("AwardsAccordion", () => {
  it("toggles panel height", async () => {
    render(
      <AwardsAccordion
        awards={[{ season: "2023-24", description: "All-NBA", team: "NYK" }]}
      />,
    );

    const button = screen.getByRole("button", { name: /full award log/i });
    const panel = button.nextElementSibling as HTMLDivElement;
    Object.defineProperty(panel, "scrollHeight", { value: 200, configurable: true });

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(panel.style.maxHeight).toBe("0px");

    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(panel.style.maxHeight).toBe("200px");
    });

    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(panel.style.maxHeight).toBe("0px");
    });
  });
});
