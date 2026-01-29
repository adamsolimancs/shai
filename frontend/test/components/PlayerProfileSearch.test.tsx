import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PlayerProfileSearch from "@/components/PlayerProfileSearch";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("PlayerProfileSearch", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("pushes slugified route on submit", () => {
    render(<PlayerProfileSearch />);

    const input = screen.getByLabelText(/search players/i);
    fireEvent.change(input, { target: { value: "LeBron James" } });
    fireEvent.submit(input.closest("form")!);

    expect(push).toHaveBeenCalledWith("/players/lebron-james");
    expect(window.sessionStorage.getItem("lastPlayerSearch")).toBe("LeBron James");
  });

  it("does not submit empty values", () => {
    render(<PlayerProfileSearch />);
    const input = screen.getByLabelText(/search players/i);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(push).not.toHaveBeenCalled();
  });
});
