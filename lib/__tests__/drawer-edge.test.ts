import { describe, expect, it } from 'vitest';
import { DRAWER_EDGE_DP, edgeSwipeOpensDrawer } from '@/lib/drawerEdge';

describe('edgeSwipeOpensDrawer', () => {
  it('ouvre quand le doigt part du bord et va vers la droite', () => {
    expect(edgeSwipeOpensDrawer({ x0: 4, dx: 40, dy: 2 })).toBe(true);
    expect(edgeSwipeOpensDrawer({ x0: DRAWER_EDGE_DP, dx: 13, dy: 0 })).toBe(true);
  });

  it('ignore un tap', () => {
    expect(edgeSwipeOpensDrawer({ x0: 2, dx: 3, dy: 1 })).toBe(false);
    expect(edgeSwipeOpensDrawer({ x0: 8, dx: 12, dy: 0 })).toBe(false);
  });

  it('ignore un geste surtout vertical', () => {
    expect(edgeSwipeOpensDrawer({ x0: 6, dx: 20, dy: 40 })).toBe(false);
  });

  it('ignore un départ plus loin que le bandeau', () => {
    expect(edgeSwipeOpensDrawer({ x0: DRAWER_EDGE_DP + 1, dx: 80, dy: 0 })).toBe(false);
  });

  it('n’ouvre pas une deuxième fois si le tiroir est déjà ouvert', () => {
    expect(edgeSwipeOpensDrawer({ x0: 4, dx: 40, dy: 0, drawerOpen: true })).toBe(false);
  });
});
