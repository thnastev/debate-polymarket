/**
 * The server raises short machine codes; traders get sentences. Anything not
 * in this table is shown raw rather than swallowed — an unexplained failure at
 * a tournament is worse than an ugly one.
 */
const MESSAGES: Record<string, string> = {
  not_authenticated: 'You are signed out. Sign in again to bet.',
  market_not_found: 'That market no longer exists.',
  market_not_open: 'Betting on this market has closed.',
  market_closed_by_time: 'Betting closed before this went through.',
  account_suspended: 'Your account is suspended. Talk to the game maker.',
  account_not_approved: 'Your account is waiting for the game maker to approve it.',
  insufficient_balance: 'You do not have enough bisers for that stake.',
  insufficient_shares: 'You do not hold that many shares.',
  bad_stake: 'Enter a stake above zero.',
  bad_share_count: 'Enter a share count above zero.',
  bad_outcome_index: 'That outcome is not on this market.',
  stake_too_large_for_b: 'That stake is too large for this market.',
  rate_limited: 'Slow down — 30 bets a minute is the limit.',
  judge_cannot_bet_on_own_room:
    'You are judging this room, so you cannot bet on it.',
  debater_cannot_bet_on_own_room:
    'You are debating in this room, so you cannot bet on it.',
  forbidden_not_game_maker: 'Only the game maker can do that.',
  already_settled: 'This market has already been settled.',
  bad_winner_index: 'That outcome is not on this market.',
  void_would_overdraw:
    'Voiding would take back more than a trader now holds. Adjust their balance first.',
  market_has_no_outcomes: 'That market has no outcomes yet.',
};

export function friendlyError(e: unknown): string {
  const raw =
    typeof e === 'string' ? e
    : e && typeof e === 'object' && 'message' in e ? String((e as Error).message)
    : 'Something went wrong.';
  for (const [code, text] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return text;
  }
  if (/fetch|network|Failed to fetch/i.test(raw)) {
    return 'No connection. Your bet is queued and will send when you are back online.';
  }
  return raw;
}
