import { HEADQUARTERS_FIXED_STORE_CODES } from "@jingshu/contracts";

export function canonicalHeadquartersStores<T>(
  stores: ReadonlyArray<T>,
  getCode: (store: T) => string,
) {
  const byCode = new Map(stores.map((store) => [getCode(store), store]));
  return HEADQUARTERS_FIXED_STORE_CODES.flatMap((code) => {
    const store = byCode.get(code);
    return store ? [store] : [];
  });
}
