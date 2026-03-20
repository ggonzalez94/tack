# Tack — Pricing Model

x402 per-pin payments. No subscriptions. Price = size × duration × rate.

## Infrastructure

| Component | Choice | Cost |
|-----------|--------|------|
| Cluster | GKE Autopilot (existing) | per-pod only |
| API | Hono + SQLite, StatefulSet, 1 replica | ~$13/mo |
| IPFS | Kubo, StatefulSet, 1 replica | ~$42/mo |
| Storage | PD-Standard (low traffic at launch) | $0.04/GB/mo |
| Ingress | Cloud Load Balancer | free with GKE |
| Future (1TB+) | Migrate to GCS | $0.02/GB/mo |

## Our Costs

| Item | Cost | Notes |
|------|------|-------|
| **Fixed (compute)** | **$55/mo** | GKE Autopilot: API pod + Kubo pod |
| **Storage** | **$0.04/GB/mo** | PD-Standard. Upgrade to PD-Balanced ($0.10) if IOPS becomes a bottleneck |

## What We Charge (per GB-month, paid upfront via x402)

| Price/GB/mo | Margin over storage | Breakeven storage | vs Pinata |
|-------------|--------------------|--------------------|-----------|
| $0.08 | $0.04 (50%) | 1,375 GB | 47% cheaper |
| $0.10 | $0.06 (60%) | 917 GB | 33% cheaper |
| $0.12 | $0.08 (67%) | 688 GB | 20% cheaper |
| $0.15 | $0.11 (73%) | 500 GB | same price |

> **Breakeven formula**: $55 fixed ÷ (price − $0.04 storage cost) = GB needed to cover fixed costs

## Example: User pins 500MB for 3 months

| Price/GB/mo | They pay | Our storage cost | Gross margin |
|-------------|----------|-----------------|--------------|
| $0.08 | $0.12 | $0.06 | $0.06 (50%) |
| $0.10 | $0.15 | $0.06 | $0.09 (60%) |
| $0.12 | $0.18 | $0.06 | $0.12 (67%) |
| $0.15 | $0.225 | $0.06 | $0.165 (73%) |

## Recommendation

**$0.10/GB/month** — 33% cheaper than Pinata, 60% margin over storage, breakeven at 917GB.

At launch volumes (~100–500GB stored), we lose $15–35/mo covering fixed compute. Once we cross ~900GB, every additional GB earns $0.06/mo net.

| Stored | Revenue/mo | Cost/mo | Margin |
|--------|-----------|---------|--------|
| 100 GB | $10 | $59 | -$49 |
| 500 GB | $50 | $75 | -$25 |
| 1 TB | $100 | $95 | +$5 |
| 5 TB | $500 | $255 | +$245 (49%) |

Later, migrating to GCS ($0.02/GB) with the same $0.10 price pushes margin to 80% and breakeven drops to 688GB.
