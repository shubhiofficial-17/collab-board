import { Shape } from '../board/model/shapes';

/** A board as listed by the API (without its shapes). */
export interface Board {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A board with everything on it. */
export interface BoardContent extends Board {
  version: number;
  shapes: Shape[];
}
