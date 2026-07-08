// @vitest-environment jsdom
//
// DOM-level tests for the turn-based board rotation. These drive the real
// src/main.ts renderer so we verify the actual rendered square order, the
// coordinate labels, upright piece labels, and that selection is cleared on the
// flip — not just the pure ordering helper.

import { describe, it, expect, beforeEach, vi } from "vitest";

/** (Re)load a fresh copy of the app into a clean #app container. */
async function loadApp(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  await import("../src/main.ts");
}

function cells(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".cell"));
}
function ariaOf(index: number): string | null {
  const list = cells();
  const el = index < 0 ? list[list.length + index] : list[index];
  return el.getAttribute("aria-label");
}
function colLabels(): string[] {
  return Array.from(document.querySelectorAll(".coord-label.col-label")).map(
    (e) => e.textContent ?? "",
  );
}
function rowLabels(): string[] {
  return Array.from(document.querySelectorAll(".coord-label.row-label")).map(
    (e) => e.textContent ?? "",
  );
}
function clickSquare(alg: string): void {
  document.querySelector<HTMLButtonElement>(`.cell[aria-label="${alg}"]`)!.click();
}

describe("board rotation (rendered DOM)", () => {
  beforeEach(async () => {
    await loadApp();
  });

  it("renders Green's turn with row 1 at the bottom and A→M columns", () => {
    expect(cells()).toHaveLength(169);
    expect(ariaOf(0)).toBe("A13"); // top-left
    expect(ariaOf(-1)).toBe("M1"); // bottom-right (Green home corner)
    expect(colLabels()).toEqual("ABCDEFGHIJKLM".split(""));
    expect(rowLabels()).toEqual(
      ["13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"],
    );
  });

  it("keeps piece labels upright (no board rotation transform)", () => {
    const board = document.querySelector<HTMLElement>("#board")!;
    expect(board.style.transform || "").not.toMatch(/rotate/i);
    expect(board.className).not.toMatch(/rotate/i);
    // A known Green piece renders its normal, unreversed label.
    const g1 = document.querySelector('.cell[aria-label="G1"] .piece-label');
    expect(g1?.textContent).toBe("FB");
  });

  it("flips to Blue after a Green move: row 13 at bottom, M→A columns", () => {
    // Internal coordinates are unchanged regardless of orientation.
    clickSquare("E1"); // select the Green Spy
    expect(document.querySelectorAll(".legal-move, .legal-capture").length)
      .toBeGreaterThan(0);
    clickSquare("E3"); // legal move — turn passes to Blue

    expect(ariaOf(0)).toBe("M1"); // top-left after 180° rotation
    expect(ariaOf(-1)).toBe("A13"); // bottom-right (Blue home corner)
    expect(colLabels()).toEqual("MLKJIHGFEDCBA".split(""));
    expect(rowLabels()).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"],
    );

    // Selection and highlights are cleared when the turn changes.
    expect(document.querySelectorAll(".selected").length).toBe(0);
    expect(document.querySelectorAll(".legal-move, .legal-capture").length).toBe(0);
  });

  it("the moved Green Spy keeps its internal coordinate (E3) after the flip", () => {
    clickSquare("E1");
    clickSquare("E3");
    // The piece is addressable by its true internal coordinate, not a mirrored one.
    const moved = document.querySelector('.cell[aria-label="E3"] .piece.green');
    expect(moved).not.toBeNull();
  });

  it("undo restores Green orientation", () => {
    clickSquare("E1");
    clickSquare("E3");
    expect(ariaOf(0)).toBe("M1"); // Blue view
    document.querySelector<HTMLButtonElement>("#btn-undo")!.click();
    expect(ariaOf(0)).toBe("A13"); // back to Green view
    expect(rowLabels()[rowLabels().length - 1]).toBe("1");
  });

  it("restart and new game return to Green orientation", () => {
    clickSquare("E1");
    clickSquare("E3");
    expect(ariaOf(0)).toBe("M1"); // Blue view

    document.querySelector<HTMLButtonElement>("#btn-restart")!.click();
    expect(ariaOf(0)).toBe("A13");

    clickSquare("E1");
    clickSquare("E3");
    document.querySelector<HTMLButtonElement>("#btn-new")!.click();
    expect(ariaOf(0)).toBe("A13");
  });
});

describe("promotion boundary lines (rendered DOM)", () => {
  beforeEach(async () => {
    await loadApp();
  });

  function rowsWithClass(cls: string): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>(`.${cls}`)).map(
      (el) => el.dataset.row ?? "",
    );
  }

  it("draws the green line at the board 8/9 boundary (not 9/10) on Green's turn", () => {
    // Green view: top-edge line sits on board row 8 (data-row 7) = the 8/9 line.
    const rows = rowsWithClass("boundary-green");
    expect(rows).toHaveLength(13); // one per column
    expect(rows.every((r) => r === "7")).toBe(true);
    // The 9/10 boundary would be a boundary-green on a row-9 cell (data-row 8).
    const c9 = document.querySelector('.cell[aria-label="C9"]')!;
    expect(c9.classList.contains("boundary-green")).toBe(false);
  });

  it("keeps the green line at the 8/9 boundary after the board rotates to Blue", () => {
    clickSquare("E1");
    clickSquare("E3"); // legal Green move -> flips to Blue's orientation
    const rows = rowsWithClass("boundary-green");
    expect(rows).toHaveLength(13);
    // Blue view: row 8 is above row 9, so the top-edge line sits on board row 9
    // (data-row 8) — still the same logical 8/9 boundary.
    expect(rows.every((r) => r === "8")).toBe(true);
  });

  it("leaves the blue promotion boundary unchanged in both orientations", () => {
    expect(rowsWithClass("boundary-blue").every((r) => r === "5")).toBe(true);
    clickSquare("E1");
    clickSquare("E3"); // rotate to Blue
    expect(rowsWithClass("boundary-blue").every((r) => r === "5")).toBe(true);
  });
});

describe("last-move indicator (rendered DOM)", () => {
  beforeEach(async () => {
    await loadApp();
  });

  it("marks the origin and destination by logical coordinate, surviving rotation", () => {
    // No indicator before any move.
    expect(document.querySelectorAll(".last-move-from, .last-move-to")).toHaveLength(0);
    clickSquare("E1");
    clickSquare("E3"); // completes a Green move; board flips to Blue

    const from = document.querySelector('.cell[aria-label="E1"]')!;
    const to = document.querySelector('.cell[aria-label="E3"]')!;
    expect(from.classList.contains("last-move-from")).toBe(true);
    expect(to.classList.contains("last-move-to")).toBe(true);
    // Exactly one origin and one destination square are marked.
    expect(document.querySelectorAll(".last-move-from")).toHaveLength(1);
    expect(document.querySelectorAll(".last-move-to")).toHaveLength(1);
  });
});
