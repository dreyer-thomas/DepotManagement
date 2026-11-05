#!/usr/bin/env python3
"""
Independent reference for src/core/technical.ts (story 11.2).

Generates a synthetic, anonymised series of 300 business-day closes (Mon-Fri, no holidays) and computes
the technical signals with plain float textbook formulas, written without looking at the TypeScript code:

- SMA(n): arithmetic mean of the last n closes.
- Trend: last close / SMA200 - 1; "up" when close > SMA200 and SMA200 > SMA200 20 closes earlier,
  "down" when close < SMA200 and SMA200 < SMA200 20 closes earlier, else "sideways".
- EMA(n): k = 2 / (n + 1), seeded with the SMA of the first n available values,
  then ema = ema_prev + k * (x - ema_prev).
- RSI(14), Wilder: changes d_i = c_i - c_{i-1}; first average gain/loss = mean of the first 14 gains/losses,
  then avg = (avg_prev * 13 + x) / 14; RSI = 100 - 100 / (1 + avgGain / avgLoss) (avgLoss 0: 100, both 0: 50).
  "overbought" >= 70, "oversold" <= 30.
- MACD(12, 26, 9): MACD = EMA12(close) - EMA26(close); signal = EMA9(MACD); histogram = MACD - signal.
  A cross at close i = (MACD > signal) differs between i-1 and i; a cross among the last 5 closes appends
  "-turning-up" / "-turning-down" to "positive" / "negative".
- TSI(25, 13, 7): m = c_i - c_{i-1}; TSI = 100 * EMA13(EMA25(m)) / EMA13(EMA25(|m|)); signal = EMA7(TSI).
  TSI >= 0: "positive" when TSI > signal else "fading"; TSI < 0: "turning" when TSI > signal else "negative".
- 52 weeks: window today-364 .. today; high/low = max/min close (tie -> later date);
  distanceToHigh = last / high - 1; "near-high" when last >= 0.95 * high, "near-low" when last <= 1.05 * low.

Run: python3 test/fixtures/technical/reference.py > test/fixtures/technical/reference-series.json
"""
import json
import math
from datetime import date, timedelta

N = 300
START = date(2025, 8, 4)  # a Monday
CHECKPOINTS = [14, 25, 33, 43, 60, 120, 199, 219, 250, 280, 299]


def lcg(seed):
    """Deterministic pseudo-random numbers in [0, 1) (Numerical Recipes LCG)."""
    state = seed
    while True:
        state = (1664525 * state + 1013904223) % (2 ** 32)
        yield state / 2 ** 32


def make_series():
    rand = lcg(20261105)
    dates = []
    d = START
    while len(dates) < N:
        if d.weekday() < 5:
            dates.append(d)
        d += timedelta(days=1)
    closes = []
    price = 100.0
    for i in range(N):
        # Regimes: rise, fall, sideways, rise; plus noise.
        drift = 0.004 if i < 90 else -0.005 if i < 170 else 0.0005 if i < 230 else 0.006
        price *= 1 + drift + (next(rand) - 0.5) * 0.04
        closes.append(round(price, 2))
    return [d.isoformat() for d in dates], closes


def ema(values, n):
    k = 2 / (n + 1)
    out = [None] * len(values)
    seen = []
    prev = None
    for i, x in enumerate(values):
        if x is None:
            continue
        if prev is None:
            seen.append(x)
            if len(seen) == n:
                prev = sum(seen) / n
                out[i] = prev
        else:
            prev = prev + k * (x - prev)
            out[i] = prev
    return out


def rsi(closes, n=14):
    out = [None] * len(closes)
    gains = [max(closes[i] - closes[i - 1], 0) for i in range(1, len(closes))]
    losses = [max(closes[i - 1] - closes[i], 0) for i in range(1, len(closes))]
    if len(gains) < n:
        return out
    ag = sum(gains[:n]) / n
    al = sum(losses[:n]) / n

    def value(ag, al):
        if al == 0:
            return 50.0 if ag == 0 else 100.0
        return 100 - 100 / (1 + ag / al)

    out[n] = value(ag, al)
    for j in range(n, len(gains)):
        ag = (ag * (n - 1) + gains[j]) / n
        al = (al * (n - 1) + losses[j]) / n
        out[j + 1] = value(ag, al)
    return out


def sma_at(closes, i, n):
    return sum(closes[i - n + 1:i + 1]) / n


def main():
    dates, closes = make_series()
    today = dates[-1]
    last = N - 1

    rsi_s = rsi(closes)
    e12, e26 = ema(closes, 12), ema(closes, 26)
    macd = [a - b if a is not None and b is not None else None for a, b in zip(e12, e26)]
    signal = ema(macd, 9)
    hist = [a - b if a is not None and b is not None else None for a, b in zip(macd, signal)]
    m = [None] + [closes[i] - closes[i - 1] for i in range(1, N)]
    am = [None if x is None else abs(x) for x in m]
    ds, dsa = ema(ema(m, 25), 13), ema(ema(am, 25), 13)
    tsi = [None if a is None else (0.0 if b == 0 else 100 * a / b) for a, b in zip(ds, dsa)]
    tsi_signal = ema(tsi, 7)

    sma_now = sma_at(closes, last, 200)
    sma_then = sma_at(closes, last - 20, 200)
    c = closes[last]
    trend_key = "up" if c > sma_now and sma_now > sma_then else "down" if c < sma_now and sma_now < sma_then else "sideways"
    r = rsi_s[last]
    rsi_key = "overbought" if r >= 70 else "oversold" if r <= 30 else "neutral"
    above = [None if a is None or b is None else a > b for a, b in zip(macd, signal)]
    crossed = any(above[i] is not None and above[i - 1] is not None and above[i] != above[i - 1] for i in range(last - 4, last + 1))
    macd_key = ("positive" if above[last] else "negative") + (("-turning-up" if above[last] else "-turning-down") if crossed else "")
    t, ts = tsi[last], tsi_signal[last]
    tsi_key = ("positive" if t > ts else "fading") if t >= 0 else ("turning" if t > ts else "negative")

    start = (date.fromisoformat(today) - timedelta(days=364)).isoformat()
    window = [(d, p) for d, p in zip(dates, closes) if start <= d <= today]
    high = low = window[0]
    for d, p in window:  # ascending dates, so ">=" / "<=" keep the later date on a tie
        if p >= high[1]:
            high = (d, p)
        if p <= low[1]:
            low = (d, p)
    wk_key = "near-high" if c >= 0.95 * high[1] else "near-low" if c <= 1.05 * low[1] else "between"

    out = {
        "description": "Synthetic closes and float reference values; generated by reference.py",
        "today": today,
        "closes": [{"date": d, "price": f"{p:.2f}"} for d, p in zip(dates, closes)],
        "expected": {
            "trend": {"value": c / sma_now - 1, "sma200": sma_now, "key": trend_key},
            "rsi": {"value": r, "key": rsi_key},
            "macd": {"value": macd[last], "signal": signal[last], "histogram": hist[last], "key": macd_key},
            "tsi": {"value": t, "signal": ts, "key": tsi_key},
            "fiftyTwoWeeks": {
                "value": c / high[1] - 1,
                "high": {"date": high[0], "price": f"{high[1]:.2f}"},
                "low": {"date": low[0], "price": f"{low[1]:.2f}"},
                "key": wk_key,
            },
        },
        "checkpoints": [
            {
                "index": i,
                "date": dates[i],
                "rsi": rsi_s[i],
                "macd": macd[i],
                "macdSignal": signal[i],
                "macdHistogram": hist[i],
                "tsi": tsi[i],
                "tsiSignal": tsi_signal[i],
            }
            for i in CHECKPOINTS
        ],
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
