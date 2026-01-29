import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import HeroSearch from "@/components/HeroSearch";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/components/TextType", () => ({
  default: ({ text }: { text: string | string[] }) => (
    <div data-testid="text-type">{Array.isArray(text) ? text[0] : text}</div>
  ),
}));

describe("HeroSearch", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("shows typewriter before interaction", () => {
    render(<HeroSearch />);
    expect(screen.getByTestId("text-type")).toBeInTheDocument();
  });

  it("hides typewriter after focus", () => {
    render(<HeroSearch />);
    const input = screen.getByLabelText(/search players/i);
    fireEvent.focus(input);
    expect(screen.queryByTestId("text-type")).not.toBeInTheDocument();
  });

  it("submits a normalized route", () => {
    render(<HeroSearch />);
    const input = screen.getByLabelText(/search players/i);
    fireEvent.change(input, { target: { value: "Shai Gilgeous-Alexander" } });
    fireEvent.submit(input.closest("form")!);

    expect(push).toHaveBeenCalledWith("/players/shai-gilgeous-alexander");
    expect(window.sessionStorage.getItem("lastPlayerSearch")).toBe(
      "Shai Gilgeous-Alexander",
    );
  });
});
