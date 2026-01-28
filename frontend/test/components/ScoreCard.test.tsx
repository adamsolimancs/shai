import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import ScoreCard from "@/components/ScoreCard";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("ScoreCard", () => {
  it("renders fallback labels", () => {
    render(
      <ScoreCard
        variant="scoreboard"
        home={{}}
        away={{}}
        timeLabel="7:00 PM"
        status="Final"
      />,
    );

    expect(screen.getByText("Away")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders link when href provided", () => {
    render(
      <ScoreCard
        href="/scores/1"
        home={{ name: "Knicks", score: 110 }}
        away={{ name: "Celtics", score: 108 }}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/scores/1");
  });

  it("applies winner tone on scoreboard variant", () => {
    render(
      <ScoreCard
        variant="scoreboard"
        winner="home"
        home={{ name: "Knicks", score: 110 }}
        away={{ name: "Celtics", score: 108 }}
      />,
    );

    const awayRow = screen.getByText("Celtics").closest("div");
    const homeRow = screen.getByText("Knicks").closest("div");
    expect(awayRow?.className).toMatch(/red-500/);
    expect(homeRow?.className).toMatch(/emerald-400/);
  });
});
