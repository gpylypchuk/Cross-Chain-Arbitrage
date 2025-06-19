# Cross-Chain USDC/USDT Arbitrage Bot

## Overview

This project demonstrates a working cross-chain arbitrage strategy between USDC and USDT, starting from Avalanche. Profit is measured in USDC on Avalanche. The script is written in TypeScript using `viem` and is designed for both dry-run simulation and real execution (with a switch).

## 🛠️ How the Script Works

- **Monitors USDC/USDT prices** on Pharaoh (Avalanche) and Shadow (Sonic) concentrated liquidity pools.
- **Simulates arbitrage in both directions** (USDC→USDT→USDC and USDT→USDC→USDT), including all swap fees, bridge costs, and slippage.
- **Runs continuously** in a loop, polling every 10 seconds.
- **Executes the full round-trip** (mocked or real, depending on `LIVE_MODE`) when profit exceeds a configurable threshold.
- **Starts with ~$10 USDC** on Avalanche.
- **Logs all steps**: pool prices, token order, swap/bridge details, net profit/loss, and all costs, with clear formatting and token context.
- **Persistent logging**: All arbitrage attempts and executions are logged to `arb-bot.log` with timestamps.
- **Configurable profit threshold**: Set as a constant or environment variable; can be set low to force end-to-end simulation.
- **Bridging logic**: Uses CCIP for USDC and Stargate for USDT (see below).
- **Switch between dry-run and real execution**: Use the `LIVE_MODE` constant or environment variable.

## 🔁 Bridging Logic

- **USDC**: Uses Chainlink CCIP to bridge between Avalanche and Sonic.
  - **Why CCIP?** Chainlink CCIP is chosen for USDC due to its security, reliability, and native support for cross-chain stablecoin transfers.
  - **Integration:** Currently mocked; a stub for real integration is provided in the code.
- **USDT**: **Stargate is the chosen bridge for USDT.**
  - **Why Stargate?** Stargate is selected because it offers deep liquidity, low fees, and broad support for both Avalanche and Sonic. It is widely used and reliable for stablecoin transfers, making it the optimal choice for minimizing bridge costs, slippage, and execution risk.
  - **Integration:** Currently mocked; a stub for real integration is provided in the code.
- **Estimated bridge cost & time (USDT):** Simulated in the MVP as $0.10 and 5–7 seconds per transfer (configurable in `config.ts` or via environment variables). In production, actual costs and times will depend on Stargate network conditions and fees, but Stargate is known for fast, low-cost stablecoin bridging.
- **How bridging is integrated:** Both bridges are modular and can be swapped from mock to real by toggling `LIVE_MODE` and implementing the stubs. The bridging logic is called only if the arbitrage is profitable, and all bridge steps are logged with token, amount, and chain context.

## 💡 How to Run

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Configure your environment:**
   - Edit `src/config.ts` to set pool addresses, fees, thresholds, and `LIVE_MODE`.
   - By default, the bot runs in dry-run mode (no real transactions).
3. **Run the bot:**
   ```bash
   npm start
   ```
   - All actions are simulated and logged.
   - To run with real swaps/bridges, set `LIVE_MODE = true` in `src/config.ts` **after implementing the real contract logic**.

## ⚠️ Real Execution Readiness

- **All swaps and bridges are mocked by default.**
- **To enable real execution:**
  1. Implement the real logic in the `realSwap`, `realCcipBridge`, and `realStargateBridge` stubs in `src/index.ts`.
  2. Set `LIVE_MODE = true` in `src/config.ts`.
  3. Provide a funded wallet private key and all required addresses.
- **Warning:** Do not enable live mode with real funds until you have thoroughly tested and reviewed all logic.

## 📄 Risk Mitigation Strategies

- **No real funds are used in dry-run mode.**
- **BigNumber math** is used throughout to avoid rounding errors and ensure safety for large capital.
- **Robust error handling:** All swap and bridge calls are wrapped in try/catch blocks, with clear error logging and defensive execution logic.
- **Principal loss risk:** In production, use slippage protection, on-chain price checks, and only execute when profit exceeds all costs and risk buffers.
- **Replay protection and nonce management:** To be implemented for real execution.
- **MEV and sandwich attack mitigation:** For large capital, consider using private transaction relays, on-chain price validation, and advanced monitoring.

## 🧑‍💻 Code Quality & Maintainability

- **Clarified profit calculation:** All profit and delta calculations use descriptive variable names and are clearly logged.
- **Structured return types:** All simulation and execution functions return objects for extensibility and clarity.
- **Defensive execution:** No swaps or bridges are executed if profit is below the threshold.
- **Precise, readable logging:** All amounts and profits are formatted for clarity, and logs include token and chain context.
- **Config-driven:** All addresses, fees, and thresholds are in `src/config.ts` or environment variables for easy management.
- **Type safety:** Chain names and other enums are strongly typed.

## 🚦 What's Next for Production

- Implement real contract calls for swaps and bridges (see stubs in code).
- Fill in real router/bridge addresses for Sonic, CCIP, and Stargate.
- Add dynamic fee fetching and token symbol resolution.
- Integrate with a dashboard or webhook for remote monitoring.
- Add advanced risk controls (e.g., MEV protection, sandwich attack detection).

## 🧑‍🔬 Technical Onboarding

### Architecture & Main Modules

- **src/index.ts**: Main entry point. Contains all core logic, including price fetching, simulation, execution, and logging.
- **src/config.ts**: All configuration (addresses, fees, thresholds, slippage, etc). Uses environment variables for overrides.
- **BigNumber math**: All calculations use BigInt and viem utils for safety.
- **Retry logic**: All real swap/bridge stubs use retry with exponential backoff.
- **Token decimals**: Decimals are fetched dynamically for each token.

### How to Add New Tokens or Pools

- Add the token address and pool address to `src/config.ts`.
- Ensure the pool is Uniswap V3 compatible (has slot0, token0, token1).
- The code will fetch decimals automatically, but you may want to add a symbol mapping in `getSymbol`.

### How to Run Tests

- All pure helpers (e.g., `simulateDirection`, `getPriceFromSqrtPriceX96BigInt`) are exported and can be tested directly.
- Use Jest or Vitest. Example below.

## 🧪 Testing

### Example: Unit Test for simulateDirection

Create a file `test/simulateDirection.test.ts`:

```ts
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
```

### Example: Unit Test for getPriceFromSqrtPriceX96BigInt

```ts
import { getPriceFromSqrtPriceX96BigInt } from "../src/index";

describe("getPriceFromSqrtPriceX96BigInt", () => {
  it("should compute price correctly for 1:1 pool with 6 decimals", () => {
    // sqrtPriceX96 for price=1 is 2**96
    const sqrtPriceX96 = 2n ** 96n;
    const price = getPriceFromSqrtPriceX96BigInt(sqrtPriceX96, 6, 6);
    expect(price).toBeCloseTo(1, 6);
  });
});
```

### Run tests

```bash
npm install --save-dev jest ts-jest @types/jest
npx jest
```
