/**
 * The measured geometry of the paraphrase fixture, recorded so the recall
 * number can be replayed offline. **Generated — do not hand-edit.**
 *
 *   npx tsx scripts/eval-053-semantic-resonance.ts
 *
 * Each row is a 19-dimensional vector whose pairwise cosines reproduce what
 * `qwen3-embedding` actually returned for these 19 texts on the local endpoint,
 * to within 6.7e-7. It is a Cholesky factor of the measured
 * cosine matrix, not a projection: the geometry is exact, only the ambient
 * dimension is smaller. A test that embeds these rows measures the REAL model's
 * ranking without a network call and without committing 19 x 4096 floats.
 *
 * Two limits, both from ticket 007's eval. The endpoint is deterministic for a
 * FIXED BATCH COMPOSITION and wobbles in the third decimal with batch size, so
 * this is one measurement rather than the platonic one — which is exactly why
 * the channel ranks instead of cutting, since a rank survives that wobble and
 * an absolute cut does not. And these are short first-person belief statements
 * (82 chars mean); an essay sentence sits in a lower background.
 *
 * Recorded 2026-08-02 against qwen3-embedding.
 */

export const MODEL = "qwen3-embedding";

/** Text → its recorded vector. Keys are verbatim from `paraphrase-pairs.ts`. */
export const RECORDED_VECTORS: Record<string, number[]> = {
  "I default to hedging in whichever direction is socially cheaper":
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "I only finish things when someone else is waiting on them":
    [0.423496, 0.905898, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "My best thinking happens in the first hour after waking, before I have spoken to anyone":
    [0.416853, 0.340993, 0.84259, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "I confuse being busy with being useful":
    [0.476531, 0.420932, 0.221759, 0.739295, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "I avoid conflict by agreeing early and resenting it later":
    [0.56748, 0.314871, 0.231671, 0.115592, 0.715395, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Teaching something is the only way I find out whether I understand it":
    [0.417219, 0.391076, 0.242809, 0.133954, 0.050768, 0.770397, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "I write to find out what I think, not to report what I already decided":
    [0.447346, 0.307913, 0.394512, 0.151465, 0.121633, 0.188876, 0.689943, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "I trust my gut on people and my spreadsheet on everything else":
    [0.542842, 0.294187, 0.226764, 0.141926, 0.118421, 0.08526, 0.09649, 0.718755, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "When more people agree with a claim, I make it sound more certain than I actually feel inside":
    [0.506695, 0.293795, 0.172615, 0.086355, 0.192778, 0.16811, 0.135885, 0.147109, 0.71705, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Left alone with a project nothing ever ships; give me a person expecting it and the work closes itself":
    [0.428802, 0.610078, 0.115124, 0.057799, 0.035713, 0.03103, 0.004646, 0.076174, -0.000097, 0.647516, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "By lunchtime my head is mush; whatever real ideas arrive show up at dawn while the house is quiet":
    [0.33082, 0.353098, 0.565016, 0.093703, 0.017516, -0.03433, -0.004339, -0.020539, 0.00483, -0.002381, 0.660228, 0, 0, 0, 0, 0, 0, 0, 0],
  "A full calendar reassures me the day mattered, which is not the same as anything of value coming out of it":
    [0.364425, 0.347049, 0.20616, 0.332028, 0.050239, 0.061905, 0.093114, 0.092142, 0.050801, 0.053066, 0.037502, 0.750791, 0, 0, 0, 0, 0, 0, 0],
  "Saying yes in the room is cheap; the cost arrives a week on, as a grudge nobody was told about":
    [0.518405, 0.267448, 0.104755, 0.066374, 0.293643, 0.01477, 0.009265, 0.027527, 0.054074, 0.135207, 0.049497, 0.108072, 0.722306, 0, 0, 0, 0, 0, 0],
  "Until forced to explain a topic to a beginner, my grasp of it is untested and probably fake":
    [0.457353, 0.359042, 0.258955, 0.111663, 0.092894, 0.45213, 0.075123, 0.023742, 0.111222, 0.045668, -0.003459, 0.016889, 0.052078, 0.587935, 0, 0, 0, 0, 0],
  "The page is where a position gets formed; if the conclusion were known beforehand there would be no reason to draft anything":
    [0.400657, 0.259763, 0.155148, 0.077844, 0.062662, 0.149007, 0.270275, -0.001722, 0.018193, 0.155932, 0.045281, 0.069665, 0.09287, 0.070799, 0.772981, 0, 0, 0, 0],
  "Numbers settle the money questions, but who to work with is a feeling read off the first ten minutes":
    [0.452137, 0.208052, 0.177285, 0.093806, 0.03823, 0.018575, 0.017271, 0.287094, -0.018911, 0.106516, 0.016783, 0.020266, 0.128845, 0.033664, 0.104764, 0.765783, 0, 0, 0],
  "my hedges track my actual confidence, not how popular a claim is":
    [0.683765, 0.185089, 0.176199, 0.119701, 0.091708, 0.131618, 0.150705, 0.193885, 0.234823, -0.003147, -0.03024, 0.039261, -0.03308, 0.04742, 0.018546, -0.043411, 0.551015, 0, 0],
  "I keep a notebook by the bed for the sentences that arrive at 3am":
    [0.419528, 0.352395, 0.41892, 0.066725, 0.079979, -0.014059, 0.099899, 0.046556, -0.042433, -0.00718, 0.161827, 0.023961, 0.015064, 0.015011, 0.01649, -0.050777, -0.008191, 0.684939, 0],
  "The work I am proudest of took twice as long as I told anyone":
    [0.427175, 0.45201, 0.193956, 0.154131, 0.070277, 0.041962, 0.017441, 0.043158, 0.096126, 0.131149, -0.006411, 0.062851, 0.071434, 0.014681, -0.048806, 0.02109, 0.052263, -0.005511, 0.708257],
};
