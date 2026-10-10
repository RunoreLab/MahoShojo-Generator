'use client';
import { parseCombatantsFromText as parse, type ParseOptions } from '@mahoshojo/domain/arena-file-parser';
import { MAX_COMBATANTS } from '../types';
export type { ParseOptions } from '@mahoshojo/domain/arena-file-parser';
export const parseCombatantsFromText = (text: string, options: ParseOptions) => parse(text, { ...options, maxCombatants: MAX_COMBATANTS });
