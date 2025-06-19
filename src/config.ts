export enum ChainName {
  Avalanche = "Avalanche",
  Sonic = "Sonic",
}

export const ROUTERS = {
  PHARAOH:
    process.env.PHARAOH_ROUTER || "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", // Uniswap Universal Router (Avalanche)
  SHADOW: process.env.SHADOW_ROUTER || "", // Set for Sonic
  CCIP: process.env.CCIP_ROUTER || "",
  STARGATE: process.env.STARGATE_ROUTER || "",
};

export const FEES = {
  PHARAOH: parseFloat(process.env.PHARAOH_SWAP_FEE || "0.00005"),
  SHADOW: parseFloat(process.env.SHADOW_SWAP_FEE || "0.0001"),
  BRIDGE_USDT: parseFloat(process.env.BRIDGE_COST_USDT || "0.1"),
  BRIDGE_USDC: parseFloat(process.env.BRIDGE_COST_USDC || "0.1"),
};

export const PROFIT_THRESHOLD = parseFloat(
  process.env.PROFIT_THRESHOLD || "0.01"
);
export const START_USDC = parseFloat(process.env.START_USDC || "10");

export const LIVE_MODE = process.env.LIVE_MODE === "true" ? true : false;

export const WALLET_PRIVATE_KEY = process.env.PRIVATE_KEY || "";
