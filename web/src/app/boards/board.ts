import { Shape } from '../board/model/shapes';

/** A board as listed by the API (without its shapes). */
export interface Board {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Who has access; the creator is the owner. */
  members?: BoardMember[];
}

export type BoardRole = 'owner' | 'editor' | 'viewer';

export interface BoardMember {
  userId: string;
  role: BoardRole;
}

/** A board with everything on it. */
export interface BoardContent extends Board {
  version: number;
  shapes: Shape[];
}
