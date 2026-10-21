import { useEffect, useRef } from 'react';
import { DeviceEventEmitter, PanResponder, View } from 'react-native';
import { useAccountDrawer } from '@/context/AccountDrawerContext';
import { edgeSwipeOpensDrawer, DRAWER_EDGE_DP } from '@/lib/drawerEdge';

/**
 * Bande collée au bord gauche. Le critère est `edgeSwipeOpensDrawer`.
 * Le natif émet `huberaFuelOpenDrawer` quand le geste système mangerait le bord.
 */
export function DrawerEdgeBand() {
  const { open, openDrawer } = useAccountDrawer();
  const openRef = useRef(open);
  openRef.current = open;
  const openDrawerRef = useRef(openDrawer);
  openDrawerRef.current = openDrawer;
  const opened = useRef(false);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('huberaFuelOpenDrawer', () => {
      if (openRef.current) return;
      openDrawerRef.current();
    });
    return () => sub.remove();
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !openRef.current,
      onMoveShouldSetPanResponder: () => !openRef.current,
      onPanResponderGrant: () => {
        opened.current = false;
      },
      onPanResponderMove: (_event, gesture) => {
        if (opened.current || openRef.current) return;
        if (
          edgeSwipeOpensDrawer({
            x0: gesture.x0,
            dx: gesture.dx,
            dy: gesture.dy,
            drawerOpen: false,
          })
        ) {
          opened.current = true;
          openDrawerRef.current();
        }
      },
    })
  ).current;

  if (open) return null;
  return (
    <View
      collapsable={false}
      pointerEvents="box-only"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: DRAWER_EDGE_DP,
        zIndex: 80,
        elevation: 80,
      }}
      {...pan.panHandlers}
    />
  );
}
