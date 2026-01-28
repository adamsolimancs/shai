import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { LeagueStandings } from "@/components/LeagueStandings";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("LeagueStandings", () => {
  it("renders empty label when no teams", () => {
    render(
      <LeagueStandings
        conferences={[{ id: "east", title: "East", teams: [], emptyLabel: "No data" }]}
      />,
    );

    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders teams with links", () => {
    render(
      <LeagueStandings
        conferences={[
          {
            id: "east",
            title: "East",
            teams: [
              {
                id: 1,
                name: "Knicks",
                record: "10-5",
                standing: "1",
                rank: 1,
                href: "/teams/knicks",
                eliminatedConference: true,
              },
            ],
          },
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: /knicks/i });
    expect(link).toHaveAttribute("href", "/teams/knicks");
    expect(screen.getByText("X")).toBeInTheDocument();
  });
});
