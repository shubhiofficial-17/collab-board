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

/** A saved copy of a board. Automatic versions have no name. */
export interface VersionSummary {
  id: string;
  name: string | null;
  createdAt: string;
  createdByName: string | null;
  shapeCount: number;
}

export interface VersionDetail {
  id: string;
  name: string | null;
  createdAt: string;
  shapes: Shape[];
}

/** Roles that can be given through a link or changed by the owner. */
export type ShareRole = 'editor' | 'viewer';

export interface ShareLink {
  token: string;
  role: ShareRole;
}

export interface Sharing {
  members: { userId: string; name: string; email: string; role: BoardRole }[];
  links: ShareLink[];
}

/** A board with everything on it. */
export interface BoardContent extends Board {
  version: number;
  shapes: Shape[];
}
