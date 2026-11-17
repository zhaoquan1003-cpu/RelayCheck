export interface GeneratedChallenge {
  id: string
  expected_count: number
  prompt: string
}

export function generateChallenges(count?: number): GeneratedChallenge[]