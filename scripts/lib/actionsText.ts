import type { Config } from '../../src/types';

// The ACTIONS REFERENCE printed on every captain mat and in the rulebook — one source
// so the two can't disagree. Costs come from config; the free-with-a-refit note names
// the refit whose card makes the action cost nothing.
export interface ActionLine { name: string; cost: number; where: string; does: string; freeWith?: string }

export function actionLines(cfg: Config): ActionLine[] {
  const c = cfg.actionCost;
  const free = (type: string) => cfg.upgrades.catalog.find((u) => u.freeAction === type)?.label;
  const al = cfg.flags.alignment;
  const lines: ActionLine[] = [
    { name: 'Steam', cost: c.STEAM, where: 'anywhere', does: `Move to a space next door (${cfg.map.fuelPerStep} fuel a lane). A bigger engine reaches 2 spaces.` },
    { name: 'Drop', cost: c.DROP, where: 'fishing ground', does: 'Set a pot here from your hand. A ground only takes so many pots, all captains counted.', freeWith: free('DROP') },
    { name: 'Haul', cost: c.HAUL, where: 'your ripe pot', does: 'Take the space\'s seeded pile, then draw from the bag by the pot\'s stage. Choose what you keep. The pot returns to your hand.', freeWith: free('HAUL') },
    { name: 'Steal', cost: c.STEAL, where: 'a rival\'s ripe pot', does: `Haul a rival's ripe pot as your own.${al ? ' A crime.' : ''} The owner gets the empty pot back.`, freeWith: free('STEAL') },
    { name: 'Sell', cost: c.SELL, where: 'market port', does: `Sell your whole hold, once a day, best lobster first as the price steps down.${al ? ' With stars, the warden checks you first.' : ''}`, freeWith: free('SELL') },
    { name: 'Refuel', cost: c.REFUEL, where: 'any port', does: 'Buy fuel at this port\'s price, up to your tank.', freeWith: free('REFUEL') },
    { name: 'Report', cost: c.REPORT, where: 'any port', does: 'Report a theft against you: take a bounty; the thief takes the heat.', freeWith: free('REPORT') },
    { name: 'Buy a refit', cost: c.BUY_UPGRADE, where: 'market port', does: `Install a face-up refit in an empty slot.${al ? ' Shady or darker: the black market too.' : ''}` },
    { name: 'Berth', cost: c.BERTH, where: 'any port that will have you', does: 'End your day here. The order captains berth is tomorrow\'s turn order.' },
    { name: 'Bribe', cost: c.BRIBE, where: 'any port', does: al ? `Shady or darker only: pay ${cfg.bribeMoneyCost}, step darker, take tomorrow's first slot, and berth.` : `Pay ${cfg.bribeMoneyCost} to take tomorrow's first slot, and berth.` },
    { name: 'Pass', cost: c.PASS, where: 'anywhere', does: 'End your turn. Unspent actions are lost.' },
  ];
  return lines;
}
