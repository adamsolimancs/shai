import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import HeaderNavCluster, { HeaderSearchBar } from "@/components/HeaderNavCluster";

const push = vi.fn();
let pathname = "/";
let queryParam = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
  useSearchParams: () => ({
    get: (key: string) => (key === "q" ? queryParam : null),
  }),
}));

describe("HeaderNavCluster", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
    pathname = "/";
    queryParam = "";
  });

  it("renders nav links", () => {
    render(<HeaderNavCluster />);

    expect(screen.getByText("Teams")).toBeInTheDocument();
    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText("Scores")).toBeInTheDocument();
    expect(screen.getByText("News")).toBeInTheDocument();
  });

  it("hides search bar on home", () => {
    pathname = "/";
    render(<HeaderSearchBar />);
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("prefills query from path and submits", async () => {
    pathname = "/players/jalen-brunson";
    render(<HeaderSearchBar />);

    const input = screen.getByPlaceholderText(/search the league/i) as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe("jalen brunson");
    });

    fireEvent.change(input, { target: { value: "Kevin Durant" } });
    fireEvent.submit(input.closest("form")!);

    expect(push).toHaveBeenCalledWith("/players/kevin-durant");
  });
});
