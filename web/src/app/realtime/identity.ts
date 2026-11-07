/** How this browser appears to others: a friendly random name and a colour, remembered locally. */
export interface Identity {
  name: string;
  color: string;
}

const KEY = 'collab-board.identity';
const ADJECTIVES = ['Swift', 'Calm', 'Bright', 'Curious', 'Bold', 'Gentle', 'Lucky', 'Clever', 'Brave', 'Happy'];
const ANIMALS = ['Otter', 'Falcon', 'Panda', 'Fox', 'Koala', 'Heron', 'Lynx', 'Dolphin', 'Owl', 'Tiger'];
const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4f46e5'];

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

export function loadIdentity(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage()): Identity {
  try {
    const saved = storage?.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Identity>;
      if (parsed.name && parsed.color) {
        return { name: parsed.name, color: parsed.color };
      }
    }
  } catch {
    // Corrupt or unavailable storage: make a new identity.
  }

  const identity = { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(COLORS) };
  try {
    storage?.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Private browsing may refuse storage; the identity just won't persist.
  }

  return identity;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
