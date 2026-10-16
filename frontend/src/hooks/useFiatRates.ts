/**
 * useFiatRates.ts
 *
 * Fiat rates for components (issue #76). Returns whatever is known right now —
 * `{}` until a rate arrives, and `{}` forever if the feed is unavailable.
 *
 * There is no error state to surface on purpose: a missing estimate is not a
 * failure the user can act on, so a component renders nothing rather than an
 * error message (see `lib/prices.ts`). The first render also reads the cache
 * synchronously, so a rate already fetched by another component does not
 * flash as absent.
 */

import { useEffect, useState } from "react";
import { cachedFiatRates, getFiatRates, type FiatRates } from "../lib/prices";

export function useFiatRates(): FiatRates {
  const [rates, setRates] = useState<FiatRates>(() => cachedFiatRates());

  useEffect(() => {
    let active = true;
    // Never rejects — see `getFiatRates` — so there is no catch branch here.
    void getFiatRates().then((next) => {
      if (active) setRates(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return rates;
}
