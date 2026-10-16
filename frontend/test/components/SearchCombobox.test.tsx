import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SearchCombobox, { type SearchSuggestion } from "@/components/SearchCombobox";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const suggestions: SearchSuggestion[] = [
  {
    type: "player",
    id: 2544,
    name: "LeBron James",
    subtitle: "LAL",
    url: "/players/2544",
  },
  {
    type: "team",
    id: 1610612747,
    name: "Los Angeles Lakers",
    subtitle: "LAL",
    url: "/teams/los-angeles-lakers",
  },
];

const successfulResponse = (data: SearchSuggestion[]) => ({
  ok: true,
  status: 200,
  json: async () => data,
});

describe("SearchCombobox", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for two characters and debounces suggestion requests", async () => {
    const fetchSpy = vi.fn(async () => successfulResponse(suggestions));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SearchCombobox />);

    const input = screen.getByRole("combobox", { name: /search players and teams/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "l" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/type one more character/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "le" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(174);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("q=le&limit=8"),
      expect.any(Object),
    );
    expect(screen.getByRole("listbox", { name: /search suggestions/i })).toBeInTheDocument();
  });

  it("does not request suggestions for an unfocused initial value", async () => {
    const fetchSpy = vi.fn(async () => successfulResponse(suggestions));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SearchCombobox initialValue="LeBron James" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.focus(screen.getByRole("combobox", { name: /search players and teams/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(175);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("supports listbox keyboard navigation and canonical result URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => successfulResponse(suggestions)));
    render(<SearchCombobox />);

    const input = screen.getByRole("combobox", { name: /search players and teams/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "la" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(175);
    });

    expect(input).toHaveAttribute("aria-expanded", "true");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/teams/los-angeles-lakers");
  });

  it("aborts an in-flight request when the query changes", async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchSpy = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        firstSignal = init.signal as AbortSignal;
        return new Promise(() => undefined);
      })
      .mockResolvedValueOnce(successfulResponse([]));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SearchCombobox />);

    const input = screen.getByRole("combobox", { name: /search players and teams/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "le" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(175);
    });
    expect(firstSignal?.aborted).toBe(false);

    fireEvent.change(input, { target: { value: "lebron" } });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(175);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
