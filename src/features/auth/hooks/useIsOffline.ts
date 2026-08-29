import { useEffect, useState } from 'react';
import * as Network from 'expo-network';

export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const state = await Network.getNetworkStateAsync();
      if (mounted) {
        setOffline(!(state.isConnected && state.isInternetReachable !== false));
      }
    };

    void check();
    const interval = setInterval(() => {
      void check();
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return offline;
}
