const MIN_ALLOWED_BALANCE = -20;
const WITHDRAW_MIN_BALANCE = 0;
const WITHDRAW_REQUEST_MIN_AMOUNT = 100;

const WALLET_LEDGER_SOURCES = {
  PAYMENT_SETTLEMENT: "payment_settlement",
  PLATFORM_COMMISSION: "platform_commission",
  WITHDRAWAL: "withdrawal",
  REVERSAL: "reversal",
  PENALTY: "penalty",
  CORRECTION: "correction",
  RECHARGE: "recharge",
};

export {
  MIN_ALLOWED_BALANCE,
  WITHDRAW_MIN_BALANCE,
  WITHDRAW_REQUEST_MIN_AMOUNT,
  WALLET_LEDGER_SOURCES,
};
