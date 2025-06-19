import { simulateDirection } from "../src/index";

describe("simulateDirection", () => {
  it("should compute profit for a simple arbitrage", () => {
    const result = simulateDirection({
      startAmount: 10,
      poolA: { token0: "0xA", token1: "0xB", price: 1.01 },
      poolB: { token0: "0xB", token1: "0xA", price: 0.99 },
      swapFeeA: 0.0005,
      swapFeeB: 0.0005,
      bridgeCostA: 0.1,
      bridgeCostB: 0.1,
      directionLabel: "A→B→A",
      tokenIn: "0xA",
      tokenOut: "0xA",
      minAmountOutFactor: 0.995,
    });
    expect(result.finalAmount).toBeGreaterThan(0);
    expect(typeof result.profit).toBe("number");
  });
});
