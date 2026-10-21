/** 24 dp, comme le bandeau de Hubera Docs. */
export const DRAWER_EDGE_DP = 24;

/** Déplacement horizontal minimum pour ouvrir, en dp. */
export const DRAWER_EDGE_OPEN_DX = 12;

export type EdgeDrag = {
  x0: number;
  dx: number;
  dy: number;
  drawerOpen?: boolean;
};

/**
 * Vrai seulement pour un glissement vers la droite qui part du bord gauche.
 * Un tap, un geste vertical, ou un tiroir déjà ouvert ne l’ouvrent pas.
 */
export function edgeSwipeOpensDrawer(drag: EdgeDrag): boolean {
  if (drag.drawerOpen) return false;
  if (!(drag.x0 <= DRAWER_EDGE_DP)) return false;
  if (!(Math.abs(drag.dx) > Math.abs(drag.dy))) return false;
  return drag.dx > DRAWER_EDGE_OPEN_DX;
}
