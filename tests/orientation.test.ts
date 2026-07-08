import { describe, it, expect } from "vitest";
import {
  getBoardDisplayModel,
  getDisplayColumns,
  getDisplayRows,
} from "../src/ui/orientation.ts";
import { GameSession } from "../src/game/session.ts";
import { toCoord } from "../src/game/coords.ts";
import type { GameState } from "../src/game/types.ts";

function idAt(s: GameState, square: string): string {
  const c = toCoord(square);
  return s.pieces.find((p) => p.col === c.col && p.row === c.row)!.id;
}

const ALL = Array.from({ length: 13 }, (_, i) => i);

describe("board orientation helper", () => {
  it("Green: row 1 at the bottom, columns A→M", () => {
    const rows = getDisplayRows("green");
    expect(rows[rows.length - 1]).toBe(0); // internal row 0 = row 1 at bottom
    expect(rows[0]).toBe(12); // row 13 at top
    expect(getDisplayColumns("green")).toEqual(ALL); // A..M

    const model = getBoardDisplayModel("green");
    expect(model.rowLabels[model.rowLabels.length - 1]).toBe("1");
    expect(model.rowLabels[0]).toBe("13");
    expect(model.columnLabels[0]).toBe("A");
    expect(model.columnLabels[12]).toBe("M");
  });

  it("Blue: row 13 at the bottom, columns M→A", () => {
    const rows = getDisplayRows("blue");
    expect(rows[rows.length - 1]).toBe(12); // row 13 at bottom
    expect(rows[0]).toBe(0); // row 1 at top
    expect(getDisplayColumns("blue")).toEqual(ALL.slice().reverse()); // M..A

    const model = getBoardDisplayModel("blue");
    expect(model.rowLabels[model.rowLabels.length - 1]).toBe("13");
    expect(model.rowLabels[0]).toBe("1");
    expect(model.columnLabels[0]).toBe("M");
    expect(model.columnLabels[12]).toBe("A");
  });

  it("Blue is a 180° rotation: both axes reversed vs Green", () => {
    expect(getDisplayRows("blue")).toEqual(getDisplayRows("green").slice().reverse());
    expect(getDisplayColumns("blue")).toEqual(
      getDisplayColumns("green").slice().reverse(),
    );
  });

  it("only permutes internal indices (coordinate system intact)", () => {
    for (const player of ["green", "blue"] as const) {
      expect(getDisplayRows(player).slice().sort((a, b) => a - b)).toEqual(ALL);
      expect(getDisplayColumns(player).slice().sort((a, b) => a - b)).toEqual(ALL);
    }
  });
});

describe("orientation follows the active player through the session", () => {
  it("flips to Blue after a Green move and back on undo", () => {
    const session = new GameSession();
    expect(session.state.current).toBe("green");
    expect(getDisplayRows(session.state.current)[12]).toBe(0); // row 1 bottom

    session.move({ pieceId: idAt(session.state, "E1"), to: toCoord("E3") });
    expect(session.state.current).toBe("blue");
    expect(getDisplayRows(session.state.current)[12]).toBe(12); // row 13 bottom

    session.undo();
    expect(session.state.current).toBe("green");
    expect(getDisplayRows(session.state.current)[12]).toBe(0);
  });

  it("restart and new game return to Green orientation", () => {
    const session = new GameSession();
    session.move({ pieceId: idAt(session.state, "E1"), to: toCoord("E3") });
    expect(session.state.current).toBe("blue");

    session.restart();
    expect(session.state.current).toBe("green");

    session.move({ pieceId: idAt(session.state, "E1"), to: toCoord("E3") });
    session.newGame();
    expect(session.state.current).toBe("green");
  });
});
