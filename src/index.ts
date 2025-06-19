import axios from "axios";
import { createPublicClient, http } from "viem";
import { parseUnits, formatUnits } from "viem/utils";
import fs from "fs";
import {
  ROUTERS,
  FEES,
  PROFIT_THRESHOLD,
  START_USDC,
  LIVE_MODE,
  WALLET_PRIVATE_KEY,
  ChainName,
} from "./config";

export const POOL_FEES = {
  PHARAOH: 0.0005,
  SHADOW: 0.0005,
};

// Uniswap V3 Pool minimal ABI for slot0 and token0/token1
const UNISWAP_V3_POOL_ABI = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
      { internalType: "int24", name: "tick", type: "int24" },
      { internalType: "uint16", name: "observationIndex", type: "uint16" },
      {
        internalType: "uint16",
        name: "observationCardinality",
        type: "uint16",
      },
      {
        internalType: "uint16",
        name: "observationCardinalityNext",
        type: "uint16",
      },
      { internalType: "uint8", name: "feeProtocol", type: "uint8" },
      { internalType: "bool", name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token0",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

// Avalanche RPC (Pharaoh)
const AVALANCHE_RPC = "https://api.avax.network/ext/bc/C/rpc";
// Sonic RPC (Shadow) - placeholder, replace with actual endpoint
const SONIC_RPC = "https://rpc.soniclabs.com";

// USDC/USDT pool addresses
const PHARAOH_POOL = "0x184b487c7e811f1d9734d49e78293e00b3768079"; // Avalanche
const SHADOW_POOL = "0x9053fe060f412ad5677f934f89e07524343ee8e7"; // Sonic

// USDC/USDT token addresses (Avalanche and Sonic)
const USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
const USDT = "0xc7198437980c041c805A1EDcbA50c1Ce5db95118";

// Create and reuse public clients
const avalancheClient = createPublicClient({
  chain: {
    id: 43114,
    name: "Avalanche",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [AVALANCHE_RPC] } },
  },
  transport: http(),
});
const sonicClient = createPublicClient({
  chain: {
    id: 64165,
    name: "Sonic",
    nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
    rpcUrls: { default: { http: [SONIC_RPC] } },
  },
  transport: http(),
});

// --- BigNumber Math Helpers ---
function bn(num: number | string, decimals = 6) {
  return parseUnits(num.toString(), decimals);
}
function bnToNum(bnVal: bigint, decimals = 6) {
  return Number(formatUnits(bnVal, decimals));
}
function bnMul(a: bigint, b: bigint, decimals = 6) {
  return (a * b) / parseUnits("1", decimals);
}
function bnDiv(a: bigint, b: bigint, decimals = 6) {
  return (a * parseUnits("1", decimals)) / b;
}

// --- Persistent Logging ---
function logToFile(message: string) {
  const now = new Date().toISOString();
  fs.appendFile("arb-bot.log", `[${now}] ${message}\n`, (err) => {
    if (err) console.error("File log error:", err);
  });
}

// --- Retry Helper ---
async function retryAsync<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      console.error(`[RETRY] Attempt ${attempt} failed:`, err);
      if (attempt > maxRetries) throw err;
      await sleep(baseDelay * 2 ** (attempt - 1));
    }
  }
}

// Helper to compute price from sqrtPriceX96 using BigInt
export function getPriceFromSqrtPriceX96BigInt(
  sqrtPriceX96: bigint,
  decimalsToken0: number = 6,
  decimalsToken1: number = 6
): number {
  // price = (sqrtPriceX96 ** 2 * 10**(decimalsToken0 - decimalsToken1)) / 2**192
  const numerator =
    sqrtPriceX96 ** 2n * 10n ** BigInt(decimalsToken0 - decimalsToken1);
  const denominator = 1n << 192n;
  const price = Number(numerator) / Number(denominator);
  return price;
}

// Helper to fetch token decimals
export async function getTokenDecimals(
  client: any,
  tokenAddress: string
): Promise<number> {
  return await client.readContract({
    address: tokenAddress,
    abi: [
      {
        name: "decimals",
        type: "function",
        stateMutability: "view",
        outputs: [{ type: "uint8" }],
      },
    ],
    functionName: "decimals",
  });
}

// Fetch token0/token1 and price from a Uniswap V3 pool
async function getPoolInfo(client: any, poolAddress: string) {
  const [token0, token1, slot0] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "token0",
    }) as Promise<string>,
    client.readContract({
      address: poolAddress,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "token1",
    }) as Promise<string>,
    client.readContract({
      address: poolAddress,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: "slot0",
    }) as Promise<[bigint, number, number, number, number, number, boolean]>,
  ]);
  const sqrtPriceX96 = slot0[0];
  return { token0, token1, sqrtPriceX96 };
}

// Fetch price from Pharaoh (Avalanche)
export async function getPharaohPrice(): Promise<{
  price: number;
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
}> {
  const { token0, token1, sqrtPriceX96 } = await getPoolInfo(
    avalancheClient,
    PHARAOH_POOL
  );
  const decimals0 = await getTokenDecimals(avalancheClient, token0);
  const decimals1 = await getTokenDecimals(avalancheClient, token1);
  const price = getPriceFromSqrtPriceX96BigInt(
    sqrtPriceX96,
    decimals0,
    decimals1
  );
  return { price, token0, token1, decimals0, decimals1 };
}

// Fetch price from Shadow (Sonic)
export async function getShadowPrice(): Promise<{
  price: number;
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
}> {
  const { token0, token1, sqrtPriceX96 } = await getPoolInfo(
    sonicClient,
    SHADOW_POOL
  );
  const decimals0 = await getTokenDecimals(sonicClient, token0);
  const decimals1 = await getTokenDecimals(sonicClient, token1);
  const price = getPriceFromSqrtPriceX96BigInt(
    sqrtPriceX96,
    decimals0,
    decimals1
  );
  return { price, token0, token1, decimals0, decimals1 };
}

// Helper to apply swap fee
function applySwapFee(amount: number, fee: number): number {
  return amount * (1 - fee);
}

// Helper to get token symbol
const getSymbol = (address: string) => {
  if (address.toLowerCase() === USDC.toLowerCase()) return "USDC";
  if (address.toLowerCase() === USDT.toLowerCase()) return "USDT";
  return "UNKNOWN";
};

// Helper to log pool info with symbols
function logPoolInfo(
  label: string,
  token0: string,
  token1: string,
  price: number
) {
  console.log(`--- ${label} Pool ---`);
  console.log(`token0: ${token0} (${getSymbol(token0)})`);
  console.log(`token1: ${token1} (${getSymbol(token1)})`);
  if (token0.toLowerCase() === USDC.toLowerCase()) {
    console.log(`Price: ${price} USDT per USDC`);
  } else if (token0.toLowerCase() === USDT.toLowerCase()) {
    console.log(`Price: ${price} USDC per USDT`);
  } else {
    console.log(`Price: ${price} (unknown token order)`);
  }
}

// Abstracted arbitrage direction logic
export function simulateDirection({
  startAmount,
  poolA,
  poolB,
  swapFeeA,
  swapFeeB,
  bridgeCostA,
  bridgeCostB,
  directionLabel,
  tokenIn,
  tokenOut,
  decimalsIn = 6,
  decimalsOut = 6,
  minAmountOutFactor = 0.995,
}: {
  startAmount: number;
  poolA: { token0: string; token1: string; price: number };
  poolB: { token0: string; token1: string; price: number };
  swapFeeA: number;
  swapFeeB: number;
  bridgeCostA: number;
  bridgeCostB: number;
  directionLabel: string;
  tokenIn: string;
  tokenOut: string;
  decimalsIn?: number;
  decimalsOut?: number;
  minAmountOutFactor?: number;
}) {
  // Swap on poolA
  let afterSwapA: number;
  if (poolA.token0.toLowerCase() === tokenIn.toLowerCase()) {
    afterSwapA = applySwapFee(startAmount * poolA.price, swapFeeA);
  } else {
    afterSwapA = applySwapFee(startAmount / poolA.price, swapFeeA);
  }
  // Bridge
  let afterBridgeA = afterSwapA - bridgeCostA;
  // Swap on poolB
  let afterSwapB: number;
  if (poolB.token0.toLowerCase() === tokenOut.toLowerCase()) {
    afterSwapB = applySwapFee(afterBridgeA / poolB.price, swapFeeB);
  } else {
    afterSwapB = applySwapFee(afterBridgeA * poolB.price, swapFeeB);
  }
  // Bridge back
  let finalAmount = afterSwapB - bridgeCostB;
  let profit = finalAmount - startAmount;
  // minAmountOut check (simulate slippage protection)
  const minAmountOut = startAmount * minAmountOutFactor;
  return {
    directionLabel,
    startAmount,
    finalAmount,
    profit,
    minAmountOut,
    tokenIn: getSymbol(tokenIn),
    tokenOut: getSymbol(tokenOut),
  };
}

// --- Mock Bridge and Swap Functions ---
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function mockCcipBridge({
  fromChain,
  toChain,
  amount,
  token,
  simulatedCost = 0.1,
  simulatedDelay = 5000,
}: {
  fromChain: string;
  toChain: string;
  amount: number;
  token: string;
  simulatedCost?: number;
  simulatedDelay?: number;
}) {
  const logMsg = `[BRIDGE][CCIP] Initiating CCIP bridge for ${amount} ${getSymbol(
    token
  )} from ${fromChain} to ${toChain}...\n  Simulated cost: $${simulatedCost}, estimated time: ${
    simulatedDelay / 1000
  }s`;
  console.log(logMsg);
  logToFile(logMsg);
  await sleep(simulatedDelay);
  const completeMsg = `[BRIDGE][CCIP] Bridge complete: ${
    amount - simulatedCost
  } ${getSymbol(token)} received on ${toChain}`;
  console.log(completeMsg);
  logToFile(completeMsg);
  return { amountReceived: amount - simulatedCost, txHash: "0xmockccip" };
}

// --- USDT Bridging ---
// I use Stargate for USDT bridging due to its deep liquidity, low cost, and broad support across chains.

async function mockStargateBridge({
  fromChain,
  toChain,
  amount,
  token,
  simulatedCost = 0.1,
  simulatedDelay = 7000,
}: {
  fromChain: string;
  toChain: string;
  amount: number;
  token: string;
  simulatedCost?: number;
  simulatedDelay?: number;
}) {
  // This function simulates a Stargate bridge
  const logMsg = `[BRIDGE][Stargate] Initiating Stargate bridge for ${amount} ${getSymbol(
    token
  )} from ${fromChain} to ${toChain}...\n  Simulated cost: $${simulatedCost}, estimated time: ${
    simulatedDelay / 1000
  }s`;
  console.log(logMsg);
  logToFile(logMsg);
  await sleep(simulatedDelay);
  const completeMsg = `[BRIDGE][Stargate] Bridge complete: ${
    amount - simulatedCost
  } ${getSymbol(token)} received on ${toChain}`;
  console.log(completeMsg);
  logToFile(completeMsg);
  return { amountReceived: amount - simulatedCost, txHash: "0xmockstargate" };
}

async function mockSwap({
  dex,
  chain,
  fromToken,
  toToken,
  amountIn,
  price,
  fee,
  simulatedSlippage = 0.0005,
}: {
  dex: string;
  chain: string;
  fromToken: string;
  toToken: string;
  amountIn: number;
  price: number;
  fee: number;
  simulatedSlippage?: number;
}) {
  // This function simulates a swap
  const decimals = 6;
  const amountInBN = bn(amountIn, decimals);
  const priceBN = bn(price, decimals);
  let amountOutBeforeFeeBN: bigint;
  if (fromToken.toLowerCase() === toToken.toLowerCase()) {
    amountOutBeforeFeeBN = amountInBN;
  } else if (fromToken.toLowerCase() === USDC.toLowerCase()) {
    amountOutBeforeFeeBN = bnMul(amountInBN, priceBN, decimals);
  } else {
    amountOutBeforeFeeBN = bnDiv(amountInBN, priceBN, decimals);
  }
  const feeBN = bn(1 - fee, decimals);
  const amountOutAfterFeeBN = bnMul(amountOutBeforeFeeBN, feeBN, decimals);
  const slippageBN = bnMul(
    amountOutAfterFeeBN,
    bn(simulatedSlippage, decimals),
    decimals
  );
  const finalAmountOutBN = amountOutAfterFeeBN - slippageBN;
  const txHash = "0x" + Math.floor(Math.random() * 1e16).toString(16);
  const logMsg = `[SWAP][${dex}] Swapping ${amountIn} ${getSymbol(
    fromToken
  )} for ${getSymbol(toToken)} on ${chain}\n  Price: ${price}, Fee: ${
    fee * 100
  }%\n  Amount out (after fee, before slippage): ${bnToNum(
    amountOutAfterFeeBN,
    decimals
  )}\n  Simulated slippage: ${bnToNum(
    slippageBN,
    decimals
  )}\n  Final amount out: ${bnToNum(
    finalAmountOutBN,
    decimals
  )}\n  Simulated tx hash: ${txHash}`;
  console.log(logMsg);
  logToFile(logMsg);
  return { amountOut: bnToNum(finalAmountOutBN, decimals), txHash };
}

// --- Real Swap/Bridge Stubs ---
async function realSwap({
  router,
  fromToken,
  toToken,
  amountIn,
  minAmountOut,
  slippage,
  chain,
  wallet,
}: {
  router: string;
  fromToken: string;
  toToken: string;
  amountIn: bigint;
  minAmountOut: bigint;
  slippage: number;
  chain: string;
  wallet: any;
}): Promise<never> {
  return retryAsync(async () => {
    // TODO: Implement real swap logic here
    throw new Error("realSwap not implemented");
  });
}

async function realCcipBridge({
  fromChain,
  toChain,
  amount,
  token,
  wallet,
}: {
  fromChain: string;
  toChain: string;
  amount: bigint;
  token: string;
  wallet: any;
}): Promise<never> {
  return retryAsync(async () => {
    // TODO: Implement real CCIP bridge logic here
    throw new Error("realCcipBridge not implemented");
  });
}

async function realStargateBridge({
  fromChain,
  toChain,
  amount,
  token,
  wallet,
}: {
  fromChain: string;
  toChain: string;
  amount: bigint;
  token: string;
  wallet: any;
}): Promise<never> {
  return retryAsync(async () => {
    // TODO: Implement real Stargate bridge logic here

    throw new Error("realStargateBridge not implemented");
  });
}

// --- Simulated Execution Pipeline ---
async function simulateExecution(
  direction: "USDC" | "USDT",
  pharaoh: any,
  shadow: any
) {
  if (!LIVE_MODE) {
    console.log(
      "[DRY RUN] All swaps and bridges are simulated. Set LIVE_MODE=true in config for real execution."
    );
  }
  if (direction === "USDC") {
    // USDC (Avalanche) -> USDT (Pharaoh) -> USDT (Sonic) -> USDC (Shadow) -> USDC (Avalanche)
    let usdc = START_USDC;
    // Swap USDC->USDT on Pharaoh (Avalanche)
    const swap1 = LIVE_MODE
      ? await realSwap({
          router: ROUTERS.PHARAOH,
          fromToken: USDC,
          toToken: USDT,
          amountIn: bn(usdc, 6),
          minAmountOut: bn(0, 6), // TODO: set real minAmountOut
          slippage: 0.001,
          chain: "Avalanche",
          wallet: WALLET_PRIVATE_KEY,
        })
      : await mockSwap({
          dex: "Pharaoh",
          chain: "Avalanche",
          fromToken: USDC,
          toToken: USDT,
          amountIn: usdc,
          price: pharaoh.price,
          fee: FEES.PHARAOH,
        });
    // Bridge USDT to Sonic (Stargate)
    const bridge1 = LIVE_MODE
      ? await realStargateBridge({
          fromChain: "Avalanche",
          toChain: "Sonic",
          amount: bn(swap1.amountOut, 6),
          token: USDT,
          wallet: WALLET_PRIVATE_KEY,
        })
      : await mockStargateBridge({
          fromChain: "Avalanche",
          toChain: "Sonic",
          amount: swap1.amountOut,
          token: USDT,
        });
    // Swap USDT->USDC on Shadow (Sonic)
    const swap2 = LIVE_MODE
      ? await realSwap({
          router: ROUTERS.SHADOW,
          fromToken: USDT,
          toToken: USDC,
          amountIn: bn(bridge1.amountReceived, 6),
          minAmountOut: bn(0, 6), // TODO: set real minAmountOut
          slippage: 0.001,
          chain: "Sonic",
          wallet: WALLET_PRIVATE_KEY,
        })
      : await mockSwap({
          dex: "Shadow",
          chain: "Sonic",
          fromToken: USDT,
          toToken: USDC,
          amountIn: bridge1.amountReceived,
          price: shadow.price,
          fee: FEES.SHADOW,
        });
    // Bridge USDC back to Avalanche (CCIP)
    const bridge2 = LIVE_MODE
      ? await realCcipBridge({
          fromChain: "Sonic",
          toChain: "Avalanche",
          amount: bn(swap2.amountOut, 6),
          token: USDC,
          wallet: WALLET_PRIVATE_KEY,
        })
      : await mockCcipBridge({
          fromChain: "Sonic",
          toChain: "Avalanche",
          amount: swap2.amountOut,
          token: USDC,
        });
    // Log final result
    console.log(
      `[EXECUTION][USDC] Round-trip complete. Started with ${START_USDC} USDC, ended with ${
        bridge2.amountReceived
      } USDC. Net profit: ${(bridge2.amountReceived - START_USDC).toFixed(
        6
      )} USDC.`
    );
  } else {
    // USDT (Avalanche) -> USDC (Pharaoh) -> USDC (Sonic) -> USDT (Shadow) -> USDT (Avalanche)
    let usdt = START_USDC;
    // Swap USDT->USDC on Pharaoh (Avalanche)
    const swap1 = LIVE_MODE
      ? await realSwap({
          router: ROUTERS.PHARAOH,
          fromToken: USDT,
          toToken: USDC,
          amountIn: bn(usdt, 6),
          minAmountOut: bn(0, 6), // Test minAmountOut
          slippage: 0.001,
          chain: "Avalanche",
          wallet: WALLET_PRIVATE_KEY,
        })
      : await mockSwap({
          dex: "Pharaoh",
          chain: "Avalanche",
          fromToken: USDT,
          toToken: USDC,
          amountIn: usdt,
          price: pharaoh.price,
          fee: FEES.PHARAOH,
        });
    // Bridge USDC to Sonic (CCIP)
    const bridge1 = LIVE_MODE
      ? await realCcipBridge({
          fromChain: "Avalanche",
          toChain: "Sonic",
          amount: bn(swap1.amountOut, 6),
          token: USDC,
          wallet: WALLET_PRIVATE_KEY,
        })
      : await mockCcipBridge({
          fromChain: "Avalanche",
          toChain: "Sonic",
          amount: swap1.amountOut,
          token: USDC,
        });
    // Swap USDC->USDT on Shadow (Sonic)
    const swap2 = LIVE_MODE
      ? await realSwap({
          router: ROUTERS.SHADOW,
          fromToken: USDC,
          toToken: USDT,
          amountIn: bn(bridge1.amountReceived, 6),
          minAmountOut: bn(0, 6), // TestminAmountOut
          slippage: 0.001,
          chain: "Sonic",
          wallet: WALLET_PRIVATE_KEY,
        })
      : await mockSwap({
          dex: "Shadow",
          chain: "Sonic",
          fromToken: USDC,
          toToken: USDT,
          amountIn: bridge1.amountReceived,
          price: shadow.price,
          fee: FEES.SHADOW,
        });
    // Bridge USDT back to Avalanche (Stargate)
    const bridge2 = LIVE_MODE
      ? await realStargateBridge({
          fromChain: "Sonic",
          toChain: "Avalanche",
          amount: bn(swap2.amountOut, 6),
          token: USDT,
          wallet: WALLET_PRIVATE_KEY,
        })
      : await mockStargateBridge({
          fromChain: "Sonic",
          toChain: "Avalanche",
          amount: swap2.amountOut,
          token: USDT,
        });
    // Log final result
    console.log(
      `[EXECUTION][USDT] Round-trip complete. Started with ${START_USDC} USDT, ended with ${
        bridge2.amountReceived
      } USDT. Net profit: ${(bridge2.amountReceived - START_USDC).toFixed(
        6
      )} USDT.`
    );
  }
}

// Simulate arbitrage in both directions
async function simulateArbitrage() {
  try {
    const pharaoh = await getPharaohPrice();
    const shadow = await getShadowPrice();

    logPoolInfo("Pharaoh", pharaoh.token0, pharaoh.token1, pharaoh.price);
    logPoolInfo("Shadow", shadow.token0, shadow.token1, shadow.price);

    // USDC (Avalanche) -> USDT (Pharaoh) -> USDT (Sonic) -> USDC (Shadow) -> USDC (Avalanche)
    const dir1 = simulateDirection({
      startAmount: START_USDC,
      poolA: pharaoh,
      poolB: shadow,
      swapFeeA: FEES.PHARAOH,
      swapFeeB: FEES.SHADOW,
      bridgeCostA: FEES.BRIDGE_USDT,
      bridgeCostB: FEES.BRIDGE_USDC,
      directionLabel: "USDC→USDT→USDC",
      tokenIn: USDC,
      tokenOut: USDC,
    });

    // USDT (Avalanche) -> USDC (Pharaoh) -> USDC (Sonic) -> USDT (Shadow) -> USDT (Avalanche)
    const dir2 = simulateDirection({
      startAmount: START_USDC,
      poolA: pharaoh,
      poolB: shadow,
      swapFeeA: FEES.PHARAOH,
      swapFeeB: FEES.SHADOW,
      bridgeCostA: FEES.BRIDGE_USDC,
      bridgeCostB: FEES.BRIDGE_USDT,
      directionLabel: "USDT→USDC→USDT",
      tokenIn: USDT,
      tokenOut: USDT,
    });

    // --- Logging ---
    const now = new Date().toISOString();
    console.log(`\n[${now}] --- Arbitrage Simulation Results ---`);
    for (const dir of [dir1, dir2]) {
      console.log(`Direction: ${dir.directionLabel}`);
      console.log(`  Start: ${dir.startAmount.toFixed(6)} ${dir.tokenIn}`);
      console.log(`  End:   ${dir.finalAmount.toFixed(6)} ${dir.tokenOut}`);
      console.log(`  Net profit: ${dir.profit.toFixed(6)} ${dir.tokenOut}`);
    }

    // --- Profit threshold check ---
    if (dir1.profit > PROFIT_THRESHOLD) {
      console.log(
        `[${now}] ✅ Profitable opportunity in Direction 1! (Profit: ${dir1.profit.toFixed(
          6
        )} USDC)`
      );
      await simulateExecution("USDC", pharaoh, shadow);
    } else if (dir2.profit > PROFIT_THRESHOLD) {
      console.log(
        `[${now}] ✅ Profitable opportunity in Direction 2! (Profit: ${dir2.profit.toFixed(
          6
        )} USDT)`
      );
      await simulateExecution("USDT", pharaoh, shadow);
    } else {
      console.log(`[${now}] No profitable arbitrage opportunity found.`);
    }
  } catch (err) {
    const now = new Date().toISOString();
    console.error(`[${now}] Error in simulateArbitrage:`, err);
  }
}

// Main loop
async function main() {
  if (!LIVE_MODE) {
    console.log(
      "[WARNING] Running in DRY RUN mode. No real swaps or bridges will be executed."
    );
  }
  while (true) {
    await simulateArbitrage();
    await new Promise((r) => setTimeout(r, 10000)); // Poll every 10s
  }
}

main().catch(console.error);
