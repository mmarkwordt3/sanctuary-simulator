// In-app rules reference content and per-piece summaries. Pure data so it can
// be rendered by the UI without pulling rules logic into the view.

import type { PieceType } from "../game/types.ts";

export interface RulesSection {
  title: string;
  body: string[];
}

export const RULES_SECTIONS: RulesSection[] = [
  {
    title: "Objective",
    body: [
      "Retrieve the neutral flag from the central Sanctuary with your Flag Bearer and carry it back to your home base. Green wins by returning the flag to G1; Blue wins by returning it to G13.",
    ],
  },
  {
    title: "Setup & sides",
    body: [
      "Each side has 1 Flag Bearer, 1 Engineer, 2 Spies, 2 Spears, 2 Guards and 1 Horse.",
      "Green starts at the top and advances toward higher row numbers; Blue starts at the bottom and advances toward lower row numbers. Green moves first. Each turn is exactly one move.",
      "Opening restriction: On Green's first turn, Green may not move the Engineer or Flag Bearer.",
    ],
  },
  {
    title: "Board geography",
    body: [
      "The 13×13 board (A–M, 1–13) has a central 3×3 inner circle (Sanctuary) around G7, surrounded by 12 permanent ring-wall squares that no piece may enter or pass. The Horse may jump over walls but never land on them.",
      "Only Flag Bearers may enter gates or the inner circle. All other pieces treat those squares as impassable.",
    ],
  },
  {
    title: "Gates & walls",
    body: [
      "Four gates border the Sanctuary: North (G5), South (G9), West (E7) and East (I7). North and South begin open; West and East begin blocked by walls.",
      "A Flag Bearer may enter through any open gate, but may leave the inner circle only through the open West or East gate — North and South are entrance-only. A closed gate is impassable even to a Flag Bearer. Once a wall is removed it never returns.",
    ],
  },
  {
    title: "Cannon zones",
    body: [
      "The West Cannon (A6–A8) and East Cannon (M6–M8) are board areas, not pieces. The effect is cross-map: an Engineer ending its move in the West Cannon removes the East Wall (I7); ending in the East Cannon removes the West Wall (E7).",
      "Opening the first wall routes the Engineer to its start. Opening the second wall removes BOTH Engineers from the game immediately.",
    ],
  },
  {
    title: "Routing",
    body: [
      "Flag Bearers and Engineers are never captured permanently — they are routed to their home square (Green Flag Bearer G1, Green Engineer G3, Blue Engineer G11, Blue Flag Bearer G13). Spies, Assassins, Spears, Guards and Horses are removed permanently when captured.",
    ],
  },
  {
    title: "Flag & extraction countdown",
    body: [
      "Landing on G7 while the flag is present takes it and ends the move, and starts a 3-turn extraction countdown for that player. The pickup turn does not count; thereafter every completed turn by the carrier's owner spends one countdown turn, no matter which friendly piece moves. Opponent turns never affect it.",
      "The carrier (moving one square per turn) must reach the West (E7) or East (I7) gate within those three turns. If it fails — or the carrier is routed — the flag returns to G7 and the carrier is routed home.",
      "Reaching a side gate clears the countdown but triggers forced departure: on the owner's next turn the only legal move is the carrier stepping off the gate (E7 → D6/D7/D8, I7 → J6/J7/J8), never back into the circle. If every outward square is blocked, the flag resets and the carrier is routed. The opposing Flag Bearer may still capture the carrier while it sits on the gate.",
    ],
  },
  {
    title: "Flag Bearer",
    body: [
      "Unladen: 1–2 squares orthogonally or diagonally. Laden: exactly 1 square. Cannot jump.",
      "Cannot attack ordinary pieces or Engineers. May capture only the opposing Flag Bearer while it is carrying the flag, and never while either Bearer is inside the inner circle.",
      "Inner circle: at most one Flag Bearer may be inside at a time, and the opponent cannot enter while your Bearer's Sanctuary sequence is active.",
    ],
  },
  {
    title: "Unladen Sanctuary (buffer & decision)",
    body: [
      "When an unladen Flag Bearer enters the inner circle it gets a grace period: the entry turn, then one normal buffer turn, then one normal decision turn. During the buffer and decision turns you may move ANY friendly piece — you are never forced to move the Bearer.",
      "At any point you may step the Bearer onto G7 to collect the flag (which starts the laden extraction) or move it completely out through any open gate to retreat safely. Ending merely on a gate tile is not a complete retreat.",
      "If, after your decision turn, the Bearer has neither collected the flag nor fully left the Sanctuary, it is automatically routed home (Green to G1, Blue to G13) and the flag is left untouched at G7.",
      "Unladen retreat may use ANY open gate, including North (G5) and South (G9). A laden carrier is different: it may only extract through an open West (E7) or East (I7) gate.",
    ],
  },
  {
    title: "Engineer",
    body: [
      "Moves 1–2 squares orthogonally or diagonally and cannot attack. Opens walls via the Cannon zones. When attacked, it is routed to its start.",
    ],
  },
  {
    title: "Spy & Assassin",
    body: [
      "Spy: moves and captures 1–2 squares orthogonally or diagonally. A Green Spy ending on rows 9–10 promotes to an Assassin; a Blue Spy on rows 4–5.",
      "Assassin: moves up to 4 squares within its territory (Green rows 9–13, Blue rows 1–5). Crossing back over its boundary demotes it to a Spy, ending on the first square across the line (which may be a capture).",
    ],
  },
  {
    title: "Horse",
    body: [
      "Moves like a chess knight, jumping over anything in between. It cannot land on a friendly piece, a permanent wall, a gate, the inner circle, or a reserved home square. Captures by landing on an enemy.",
    ],
  },
  {
    title: "Guard",
    body: [
      "Moves exactly 1 square orthogonally to an empty square, and captures exactly 1 square diagonally. It cannot move diagonally to an empty square nor capture orthogonally.",
    ],
  },
  {
    title: "Spear",
    body: [
      "Moves or captures exactly 1 square horizontally or diagonally (never straight forward or backward).",
      "Flank Charge: starting on a flank column (A, B, L or M) it may make a forward orthogonal charge-capture against the first enemy up to 4 squares ahead in the same column, provided the path is clear. While on a flank column it may not move or capture backward.",
    ],
  },
  {
    title: "Winning",
    body: [
      "Return your Flag Bearer carrying the flag to your home base (Green G1, Blue G13) to win.",
    ],
  },
];

export const PIECE_SUMMARY: Record<PieceType, string> = {
  flagBearer:
    "Moves 1–2 (1 while laden). Enters the Sanctuary only when the flag is at G7 and it is empty. Once inside (unladen) it gets a grace period (a buffer turn, then a decision turn) during which any friendly piece may move; it may collect the flag at G7 or fully exit at any point, and is auto-routed home if it does neither by the end of the decision turn.",
  engineer:
    "Moves 1–2, cannot attack. Opens the cross-map walls from the Cannon zones.",
  spy: "Moves/captures 1–2. Promotes to Assassin on the far promotion rows.",
  assassin:
    "Moves up to 4 within its territory; demotes to a Spy on the first square across its boundary.",
  spear:
    "Moves/captures 1 horizontally or diagonally; charge-captures forward up to 4 from a flank column.",
  guard: "Moves 1 orthogonally; captures 1 diagonally only.",
  horse: "Knight jumps; captures by landing on an enemy.",
};
