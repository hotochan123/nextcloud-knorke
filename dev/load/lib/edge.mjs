// SPDX-FileCopyrightText: 2026 hotochan123
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Copied for SPEC-M1 §8.7 (load run S1–SC, [D]) from the spike,
// knorke-spike/poll/load/edge.mjs (10.10.2026), where verify-edge.sh confirmed
// it against a real traefik:3.6.0 (ERGEBNIS: S2 6745 vs. 6743 rejections,
// S4/E3 0 vs. 0). The code below is unchanged; only this paragraph was
// added and the host names in the comments were made neutral (public tree).
// dev/selftest/loadParsers.test.mjs pins it on a fixed arrival trace.
//
// Model of the production edge's per-IP rate limits, so a recorded load trace
// can be judged the way the edge would judge it.
//
// Source: _edge-vps/edge/data/traefik/dynamic_conf/http.routers.nextcloud.yml
// (Traefik 3.6.0). Router `nextcloud` (everything on the public Nextcloud host)
// carries `ratelimit-global` {average 200, period 1s, burst 400}; router
// `nextcloud-login` (PathPrefix /login or /index.php/login, priority 100)
// carries `ratelimit-login` {average 2, period 1s, burst 10}. The home
// Traefik (the LAN host name of Nextcloud) has no rate limit at all.
//
// Traefik keeps one golang.org/x/time/rate token bucket per source IP. It
// refills at `average / period` tokens per second up to `burst`. Each request
// reserves one token. If none is there, the request may wait for the next
// token, but only up to maxDelay = 1 s / (2 · rate): 2.5 ms at 200/s, 250 ms
// at 2/s. Beyond that the reservation is cancelled, so a rejected request
// costs no token, and the client gets 429. The limit is therefore NOT "never
// more than 200 requests in any second". Up to `burst` requests above the
// average pass, and only a sustained excess drains the bucket.
// verify-edge.sh checks this model against the real traefik:3.6.0 binary.

export const EDGE_GLOBAL = { name: 'ratelimit-global', average: 200, periodS: 1, burst: 400 }
export const EDGE_LOGIN = { name: 'ratelimit-login', average: 2, periodS: 1, burst: 10 }

// Traefik: maxDelay = time.Second / (time.Duration(rate) * 2), 500 ms below 1/s.
export function maxDelayMs(rate) {
	return rate < 1 ? 500 : 1000 / (2 * Math.trunc(rate))
}

// starts: request arrival times in ms (any order, any origin).
// Returns how many requests the bucket would reject (429), how many would be
// delayed by up to maxDelay, and the lowest bucket level reached (= burst
// headroom that was left; negative only within the maxDelay tolerance).
export function replayBucket(starts, { average = 200, periodS = 1, burst = 400 } = {}) {
	const rate = average / periodS
	const t = Float64Array.from(starts).sort()
	const need = 1 - (rate * maxDelayMs(rate)) / 1000
	let tokens = burst
	let last = t.length ? t[0] : 0
	let rejected = 0
	let delayed = 0
	let minTokens = burst
	let firstRejectMs = null
	for (const ts of t) {
		tokens = Math.min(burst, tokens + ((ts - last) * rate) / 1000)
		last = ts
		if (tokens >= need) {
			if (tokens < 1) delayed++
			tokens -= 1
			if (tokens < minTokens) minTokens = tokens
		} else {
			rejected++
			if (firstRejectMs === null) firstRejectMs = ts - t[0]
		}
	}
	return {
		requests: t.length,
		rejected,
		rejectedShare: t.length ? Math.round((rejected / t.length) * 10000) / 10000 : 0,
		delayed,
		minTokens: Math.round(minTokens * 10) / 10,
		firstRejectAfterS: firstRejectMs === null ? null : Math.round(firstRejectMs / 100) / 10,
	}
}

// Highest request rate over any window of `windowMs` (sliding), in req/s.
export function slidingMaxRate(starts, windowMs) {
	const t = Float64Array.from(starts).sort()
	let best = 0
	let j = 0
	for (let i = 0; i < t.length; i++) {
		while (t[i] - t[j] >= windowMs) j++
		if (i - j + 1 > best) best = i - j + 1
	}
	return Math.round((best / (windowMs / 1000)) * 10) / 10
}

// Full verdict for one trace against the global limit. `rps` is the mean over
// the window. Long-run rule: a mean above `average` drains any burst within
// burst / (mean - average) seconds and then rejects about 1 - average/mean of
// all requests. A workshop lasts hours, not 90 s, so the mean decides.
export function edgeVerdict(starts, rps, cfg = EDGE_GLOBAL) {
	const r = replayBucket(starts, cfg)
	const limit = cfg.average / cfg.periodS
	return {
		model: `Traefik rateLimit token bucket ${limit}/s, burst ${cfg.burst}, maxDelay ${maxDelayMs(limit)} ms`,
		...r,
		meanRps: Math.round(rps * 10) / 10,
		max1sRps: slidingMaxRate(starts, 1000),
		max10sRps: slidingMaxRate(starts, 10000),
		meanHeadroom: Math.round((limit / rps - 1) * 1000) / 1000,
		longRunRejectShare: rps > limit ? Math.round((1 - limit / rps) * 1000) / 1000 : 0,
		drainSecs: rps > limit ? Math.round(cfg.burst / (rps - limit)) : null,
	}
}

// Arrival times (ms, window-relative) of the measurement-window rows of a
// load.mjs report: rows are logged at response end, so start = tMs - ms.
export function windowStarts(rep) {
	const s = rep && rep.samples
	if (!s || !Array.isArray(s.rows)) return null
	const ci = Object.fromEntries(s.columns.map((c, i) => [c, i]))
	const out = []
	for (const row of s.rows) if (row[ci.phase] === 'measure') out.push(row[ci.tMs] - row[ci.ms])
	return out
}
