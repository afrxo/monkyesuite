"""Shared scoring math.

V1 is deliberately statistics-first: transparent, seeded weights over
population-relative features (z-scores / percentile ranks), squashed through a
logistic. Every score is decomposable into named components that the page
renders as text — no opaque numbers.

Trained models replace the seeded weights behind the SAME interface later
(see README "How ML grows in"): a fitted logistic/GBM predicting forward CCU
growth swaps in per job, and the evidence payload keeps carrying the component
breakdown so the surface never regresses to "the model said so".
"""

import math
from collections.abc import Sequence


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def percentile_rank(population: Sequence[float], value: float) -> float:
    """Fraction of the population <= value, in [0, 1]. Empty population -> 0.5
    (no information, not a claim in either direction)."""
    if not population:
        return 0.5
    below = sum(1 for v in population if v <= value)
    return below / len(population)


def zscore(population: Sequence[float], value: float) -> float:
    """Population z-score, 0.0 when variance collapses (thin history)."""
    n = len(population)
    if n < 2:
        return 0.0
    mean = sum(population) / n
    var = sum((v - mean) ** 2 for v in population) / n
    if var <= 0:
        return 0.0
    return (value - mean) / math.sqrt(var)
