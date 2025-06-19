import { getPriceFromSqrtPriceX96BigInt } from "../src/index";

describe("getPriceFromSqrtPriceX96BigInt", () => {
  it("should compute price correctly for 1:1 pool with 6 decimals", () => {
    // sqrtPriceX96 for price=1 is 2**96
    const sqrtPriceX96 = 2n ** 96n;
    const price = getPriceFromSqrtPriceX96BigInt(sqrtPriceX96, 6, 6);
    expect(price).toBeCloseTo(1, 6);
  });
});
