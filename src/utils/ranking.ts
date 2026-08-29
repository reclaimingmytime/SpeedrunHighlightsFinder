export function getRankFromElo(elo: number | null) {
  if (elo === null) return { rankName: '—', rankIndex: 0, rankEmoji: '' };
  if (elo <= 599) return { rankName: 'Coal', rankIndex: 1, rankEmoji: '🪨' };
  if (elo <= 899) return { rankName: 'Iron', rankIndex: 2, rankEmoji: '⛓️' };
  if (elo <= 1199) return { rankName: 'Gold', rankIndex: 3, rankEmoji: '🥇' };
  if (elo <= 1499) return { rankName: 'Emerald', rankIndex: 4, rankEmoji: '🟢' };
  if (elo <= 1999) return { rankName: 'Diamond', rankIndex: 5, rankEmoji: '💎' };
  return { rankName: 'Netherite', rankIndex: 6, rankEmoji: '🟣' };
}
