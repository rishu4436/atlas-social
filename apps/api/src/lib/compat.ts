import { marketByAsset as m, tokenBySymbol } from "@atlas/shared-types";
export const marketByAsset = m;
export function isTokenAllowlisted(asset: string) {
  const mk = m(asset);
  return !!mk && !!tokenBySymbol(mk.base);
}
