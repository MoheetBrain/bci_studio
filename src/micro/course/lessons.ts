// The eight lessons of "Explore my chip", in order. Each lesson: 2–4 steps rendered by one Body component (so its
// widget state survives moving between its steps) and one optional multiple-choice check.
import type { ComponentType } from 'react';
import { LESSON1 } from './L1Gates';
import { LESSON2 } from './L2Register';
import { LESSON3 } from './L3Mux';
import { LESSON4 } from './L4State';
import { LESSON5 } from './L5Threshold';
import { LESSON6 } from './L6Biquad';
import { LESSON7 } from './L7Records';
import { LESSON8 } from './L8Decoder';

export interface CheckDef {
  q: string;
  options: { text: string; correct?: boolean; why: string }[];
}

export interface LessonDef {
  id: string;
  title: string;
  steps: string[];
  Body: ComponentType<{ step: number }>;
  check: CheckDef;
}

export const LESSONS: LessonDef[] = [LESSON1, LESSON2, LESSON3, LESSON4, LESSON5, LESSON6, LESSON7, LESSON8];
