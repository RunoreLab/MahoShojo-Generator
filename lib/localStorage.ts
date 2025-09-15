// localStorage utilities for tracking likes and usage
const STORAGE_KEYS = {
  LIKED_CARDS: 'mahoshojo_liked_cards',
  USED_CARDS: 'mahoshojo_used_cards'
};

export interface CardInteraction {
  cardId: string;
  timestamp: number;
}

// Get liked cards from localStorage
export function getLikedCards(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.LIKED_CARDS);
    if (stored) {
      const interactions: CardInteraction[] = JSON.parse(stored);
      return new Set(interactions.map(item => item.cardId));
    }
  } catch (error) {
    console.error('Error reading liked cards from localStorage:', error);
  }
  
  return new Set();
}

// Get used cards from localStorage
export function getUsedCards(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.USED_CARDS);
    if (stored) {
      const interactions: CardInteraction[] = JSON.parse(stored);
      return new Set(interactions.map(item => item.cardId));
    }
  } catch (error) {
    console.error('Error reading used cards from localStorage:', error);
  }
  
  return new Set();
}

// Add a card to liked list
export function addLikedCard(cardId: string): boolean {
  if (typeof window === 'undefined') return false;
  
  try {
    const likedCards = getLikedCards();
    if (likedCards.has(cardId)) {
      return false; // Already liked
    }
    
    const stored = localStorage.getItem(STORAGE_KEYS.LIKED_CARDS);
    const interactions: CardInteraction[] = stored ? JSON.parse(stored) : [];
    
    interactions.push({
      cardId,
      timestamp: Date.now()
    });
    
    localStorage.setItem(STORAGE_KEYS.LIKED_CARDS, JSON.stringify(interactions));
    return true;
  } catch (error) {
    console.error('Error adding liked card to localStorage:', error);
    return false;
  }
}

// Add a card to used list
export function addUsedCard(cardId: string): boolean {
  if (typeof window === 'undefined') return false;
  
  try {
    const usedCards = getUsedCards();
    if (usedCards.has(cardId)) {
      return false; // Already used
    }
    
    const stored = localStorage.getItem(STORAGE_KEYS.USED_CARDS);
    const interactions: CardInteraction[] = stored ? JSON.parse(stored) : [];
    
    interactions.push({
      cardId,
      timestamp: Date.now()
    });
    
    localStorage.setItem(STORAGE_KEYS.USED_CARDS, JSON.stringify(interactions));
    return true;
  } catch (error) {
    console.error('Error adding used card to localStorage:', error);
    return false;
  }
}

// Check if a card is liked
export function isCardLiked(cardId: string): boolean {
  const likedCards = getLikedCards();
  return likedCards.has(cardId);
}

// Check if a card is used
export function isCardUsed(cardId: string): boolean {
  const usedCards = getUsedCards();
  return usedCards.has(cardId);
}