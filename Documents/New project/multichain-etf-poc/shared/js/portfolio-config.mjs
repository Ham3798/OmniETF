export const portfolioConfig = {
  symbol: "mETF",
  baseAsset: "USDC",
  weights: [
    { symbol: "AAPLx", weightBps: 4000 },
    { symbol: "TSLAx", weightBps: 3000 },
    { symbol: "NVDAx", weightBps: 3000 }
  ],
  initialPrices: {
    AAPLx: 1.0,
    TSLAx: 1.0,
    NVDAx: 1.0
  },
  marketScenarios: {
    calm: {
      AAPLx: 1.02,
      TSLAx: 1.03,
      NVDAx: 1.01
    },
    bull: {
      AAPLx: 1.05,
      TSLAx: 1.10,
      NVDAx: 1.15
    },
    rotation: {
      AAPLx: 0.98,
      TSLAx: 1.22,
      NVDAx: 1.08
    }
  }
};
