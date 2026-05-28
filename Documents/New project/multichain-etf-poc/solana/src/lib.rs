#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AllocationTarget {
    pub symbol: String,
    pub weight_bps: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub symbol: String,
    pub quantity_e6: u64,
    pub price_e6: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwapInstruction {
    pub from: String,
    pub to: String,
    pub amount_e6: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Treasury {
    pub cash_usdc_e6: u64,
    pub positions: Vec<Position>,
}

impl Treasury {
    pub fn new(cash_usdc_e6: u64, positions: Vec<Position>) -> Self {
        Self {
            cash_usdc_e6,
            positions,
        }
    }

    pub fn nav_e6(&self) -> u64 {
        let position_value = self
            .positions
            .iter()
            .map(|position| {
                let numerator = u128::from(position.quantity_e6) * u128::from(position.price_e6);
                (numerator / 1_000_000) as u64
            })
            .sum::<u64>();

        self.cash_usdc_e6 + position_value
    }

    pub fn mark_prices(&mut self, new_prices_e6: &[(&str, u64)]) {
        for (symbol, new_price) in new_prices_e6 {
            if let Some(position) = self.positions.iter_mut().find(|position| position.symbol == *symbol) {
                position.price_e6 = *new_price;
            }
        }
    }

    pub fn allocate_cash(&mut self, targets: &[AllocationTarget]) -> Vec<SwapInstruction> {
        let starting_cash = self.cash_usdc_e6;
        let mut spent_total = 0_u64;
        let mut instructions = Vec::with_capacity(targets.len());

        for (index, target) in targets.iter().enumerate() {
            let spend_e6 = if index + 1 == targets.len() {
                starting_cash.saturating_sub(spent_total)
            } else {
                (u128::from(starting_cash) * u128::from(target.weight_bps) / 10_000) as u64
            };

            spent_total = spent_total.saturating_add(spend_e6);

            if let Some(position) = self.positions.iter_mut().find(|position| position.symbol == target.symbol) {
                let quantity_delta = (u128::from(spend_e6) * 1_000_000 / u128::from(position.price_e6)) as u64;
                position.quantity_e6 = position.quantity_e6.saturating_add(quantity_delta);
            }

            instructions.push(SwapInstruction {
                from: "USDC".to_string(),
                to: target.symbol.clone(),
                amount_e6: spend_e6,
            });
        }

        self.cash_usdc_e6 = self.cash_usdc_e6.saturating_sub(spent_total);
        instructions
    }

    pub fn liquidate_pro_rata(&mut self, amount_e6: u64) -> Vec<SwapInstruction> {
        let nav_before = self.nav_e6();
        assert!(amount_e6 <= nav_before, "liquidation exceeds nav");

        if amount_e6 <= self.cash_usdc_e6 {
            self.cash_usdc_e6 = self.cash_usdc_e6.saturating_sub(amount_e6);
            return Vec::new();
        }

        let mut cash_needed = amount_e6.saturating_sub(self.cash_usdc_e6);
        let position_nav = self.nav_e6().saturating_sub(self.cash_usdc_e6);
        let mut instructions = Vec::new();

        for index in 0..self.positions.len() {
            let is_last = index + 1 == self.positions.len();
            let position_value = {
                let position = &self.positions[index];
                (u128::from(position.quantity_e6) * u128::from(position.price_e6) / 1_000_000) as u64
            };

            let value_to_sell = if is_last {
                cash_needed
            } else {
                (u128::from(cash_needed) * u128::from(position_value) / u128::from(position_nav)) as u64
            };

            let quantity_to_sell = {
                let position = &self.positions[index];
                (u128::from(value_to_sell) * 1_000_000 / u128::from(position.price_e6)) as u64
            };

            let position = &mut self.positions[index];
            position.quantity_e6 = position.quantity_e6.saturating_sub(quantity_to_sell);

            instructions.push(SwapInstruction {
                from: position.symbol.clone(),
                to: "USDC".to_string(),
                amount_e6: value_to_sell,
            });

            self.cash_usdc_e6 = self.cash_usdc_e6.saturating_add(value_to_sell);
            cash_needed = cash_needed.saturating_sub(value_to_sell);
        }

        instructions
    }

    pub fn withdraw_cash(&mut self, amount_e6: u64) {
        assert!(amount_e6 <= self.cash_usdc_e6, "insufficient usdc cash");
        self.cash_usdc_e6 = self.cash_usdc_e6.saturating_sub(amount_e6);
    }
}

#[cfg(test)]
mod tests {
    use super::{AllocationTarget, Position, Treasury};

    fn sample_targets() -> Vec<AllocationTarget> {
        vec![
            AllocationTarget {
                symbol: "AAPLx".to_string(),
                weight_bps: 4_000,
            },
            AllocationTarget {
                symbol: "TSLAx".to_string(),
                weight_bps: 3_000,
            },
            AllocationTarget {
                symbol: "NVDAx".to_string(),
                weight_bps: 3_000,
            },
        ]
    }

    fn sample_treasury(cash_usdc_e6: u64) -> Treasury {
        Treasury::new(
            cash_usdc_e6,
            vec![
                Position {
                    symbol: "AAPLx".to_string(),
                    quantity_e6: 0,
                    price_e6: 1_000_000,
                },
                Position {
                    symbol: "TSLAx".to_string(),
                    quantity_e6: 0,
                    price_e6: 1_000_000,
                },
                Position {
                    symbol: "NVDAx".to_string(),
                    quantity_e6: 0,
                    price_e6: 1_000_000,
                },
            ],
        )
    }

    #[test]
    fn allocate_cash_matches_target_weights() {
        let mut treasury = sample_treasury(1_000_000_000);
        let swaps = treasury.allocate_cash(&sample_targets());

        assert_eq!(swaps.len(), 3);
        assert_eq!(swaps[0].amount_e6, 400_000_000);
        assert_eq!(swaps[1].amount_e6, 300_000_000);
        assert_eq!(swaps[2].amount_e6, 300_000_000);
        assert_eq!(treasury.cash_usdc_e6, 0);
        assert_eq!(treasury.nav_e6(), 1_000_000_000);
    }

    #[test]
    fn mark_to_market_updates_nav() {
        let mut treasury = sample_treasury(1_000_000_000);
        treasury.allocate_cash(&sample_targets());
        treasury.mark_prices(&[
            ("AAPLx", 1_050_000),
            ("TSLAx", 1_100_000),
            ("NVDAx", 1_150_000),
        ]);

        assert_eq!(treasury.nav_e6(), 1_095_000_000);
    }

    #[test]
    fn liquidate_pro_rata_raises_cash_for_redeem() {
        let mut treasury = sample_treasury(1_000_000_000);
        treasury.allocate_cash(&sample_targets());
        treasury.mark_prices(&[
            ("AAPLx", 1_050_000),
            ("TSLAx", 1_100_000),
            ("NVDAx", 1_150_000),
        ]);

        let liquidation = treasury.liquidate_pro_rata(328_500_000);
        assert_eq!(liquidation.len(), 3);
        assert!(treasury.cash_usdc_e6 >= 328_500_000);

        treasury.withdraw_cash(328_500_000);
        assert!(treasury.nav_e6() < 1_095_000_000);
    }
}
