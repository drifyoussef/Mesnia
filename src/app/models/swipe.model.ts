import { Recipe } from './recipe.model';

export interface SwipeSession {
  id: string;
  householdId: string;
  date: Date;
  status: 'active' | 'matched' | 'expired';
  recipes: string[]; // Recipe IDs
  swipes: SwipeVote[];
  matchedRecipeId?: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SwipeVote {
  userId: string;
  recipeId: string;
  direction: 'left' | 'right'; // left = no, right = yes
  timestamp: Date;
}

export interface SwipeCard {
  recipe: Recipe;
  index: number;
  total: number;
}

export interface SwipeResult {
  matched: boolean;
  recipeId?: string;
  allMembersVoted: boolean;
}
