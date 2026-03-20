# Tack — GCP Deployment Architecture & Cost Model

## TL;DR

**Our cost**: ~$55/mo fixed (compute) + $0.04/GB/mo storage (PD-Standard). At 1TB that's $95/mo total.

**Our price**: $5/mo base + $0.08/GB/mo storage + $0.05/GB retrieval. Profitable at ~1.2TB stored.

**vs Pinata**: ~40% cheaper at scale ($0.08/GB vs $0.10–0.15/GB).

**Key limitations**:
- SQLite forces 1 API replica → 30–90s downtime on pod reschedule. Fix: migrate to Cloud SQL Postgres (~$10/mo).
- Kubo needs a persistent volume (ReadWriteOnce) → no horizontal scaling of IPFS node. Fix: IPFS Cluster (complex, skip for MVP).
- Storage is zonal → zone outage = downtime. Fix: cross-zone snapshots.
- Small disk = low IOPS → use PD-Balanced if under 500GB.
- At 1TB+, migrate Kubo blockstore to GCS ($0.02/GB, ~2–3 days of work, 20–80ms latency hit mitigated by existing content cache).

**Architecture**: GKE Autopilot (existing cluster) → 2 StatefulSet pods (API + Kubo) → Persistent Disk for storage → Cloud Load Balancer for ingress.

---

## Architecture

```
Internet → Cloud Load Balancer (free with GKE)
                    │
              GKE Autopilot Cluster (shared, already running)
                    │
         ┌──────────┴──────────┐
         │                     │
   ┌─────┴──────┐      ┌──────┴──────┐
   │  API Pod   │─HTTP─▶│  Kubo Pod   │
   │ (Hono+SQLite)│  RPC │ (IPFS node) │
   │ StatefulSet │      │ StatefulSet  │
   └─────┬──────┘      └──────┬──────┘
         │                     │
    PD-Balanced 10GB      PD-Standard
    (SQLite, tiny)       (IPFS blockstore)
```

### Component Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Cluster | GKE Autopilot (existing) | No cluster mgmt fee — just pay per pod |
| API | StatefulSet, 1 replica | SQLite single-writer constraint. Move to Cloud SQL Postgres later for horizontal scaling |
| Kubo | StatefulSet, 1 replica | Needs stable PV for blockstore |
| IPFS storage | Persistent Disk Standard | $0.040/GB/mo — simplest, Kubo reads/writes natively |
| SQLite storage | PD-Balanced 10GB | $1/mo, fast enough for metadata |
| Ingress | GKE managed Ingress + Cloud Armor | Free TLS, DDoS protection |

---

## Deep Dive: API + Kubo Constraints

### SQLite Single-Writer

The API stores all pin metadata in SQLite (`./data/tack.db`). The code enables WAL mode for concurrent reads, but writes are still serialized to a single process. This means:

- **Max 1 API pod**. A second replica would corrupt the database or hit `SQLITE_BUSY`.
- **Downtime on pod reschedule**. If the node dies, GKE reschedules the StatefulSet pod to another node. The PV (ReadWriteOnce) must detach and reattach — expect **30–90 seconds of downtime**.
- **No zero-downtime deploys**. Rolling updates require the old pod to release the PV before the new one can mount it.

**Mitigation path**: Move to Cloud SQL (PostgreSQL). Cost: ~$7–15/mo for `db-f1-micro`. This unlocks:
- Multiple API replicas behind a Service (horizontal scaling)
- Zero-downtime rolling deploys
- Managed backups, point-in-time recovery
- The schema is simple (2 tables, 7 indexes) — migration is trivial

### Kubo Statefulness

Kubo stores data in `/data/ipfs/` inside the container:

```
/data/ipfs/
├── blocks/          # flatfs — the actual content blocks (this is where the GBs live)
├── datastore/       # leveldb metadata index
├── config           # node identity, swarm key, API settings
└── keystore/        # node's private key (identity)
```

Constraints:
- **Node identity is tied to the keystore**. If the PV is lost, the node gets a new PeerID. Existing pins still work (content-addressed), but peers that knew the old ID lose the connection.
- **Blockstore I/O pattern**: flatfs creates one file per block (~256KB each). 1TB of content = ~4 million files. This is heavy on metadata IOPS — PD-Standard provides only **0.75 read IOPS per GB** and **1.5 write IOPS per GB**.
  - At 100GB disk: 75 read IOPS, 150 write IOPS — fine for low traffic
  - At 1TB disk: 750 read IOPS, 1500 write IOPS — comfortable
  - At 100GB disk with high traffic: **bottleneck**. Upgrade to PD-Balanced ($0.10/GB) or PD-SSD ($0.17/GB)
- **Memory**: Kubo's bitswap engine and DHT routing table grow with peer connections. 2GB is minimum; if the node joins the public DHT with many peers, budget 4GB.
- **Single replica only**: Running 2 Kubo pods with the same content would require cluster pinning coordination (IPFS Cluster), which adds significant operational complexity. Not worth it for MVP.

### API ↔ Kubo Communication

The API talks to Kubo via HTTP RPC on port 5001 (`/api/v0/*`). Currently:

```
API Pod ──HTTP POST──▶ Kubo Pod:5001/api/v0/pin/add?arg={cid}
                       /api/v0/add (upload content)
                       /api/v0/cat?arg={cid} (retrieve)
                       /api/v0/pin/rm?arg={cid} (unpin)
```

On GKE, this becomes a ClusterIP Service. Latency: <1ms within the same cluster. The 30s timeout in `ipfs-rpc-client.ts` is already configured for slow pin operations (fetching content from the IPFS network can take time).

**Risk**: If the Kubo pod restarts while the API is mid-request, the operation fails with `UpstreamServiceError`. The API already handles this — pins get status `failed` and the caller can retry. No data corruption risk since Kubo's blockstore is append-only.

---

## Deep Dive: Where Are Files Stored?

### Current State (Railway)

```
Railway Service: API
  └── Persistent Volume → ./data/tack.db (SQLite)

Railway Service: Kubo
  └── Persistent Volume → /data/ipfs/ (blockstore, ~all the GBs)
```

Railway persistent volumes are **local disk on the Railway node** with replication within their infrastructure. This works but has limitations:
- No snapshot/backup API
- Volume size limits (varies by plan)
- If Railway has an outage, both services go down together
- No way to independently scale storage

### Proposed State (GKE + PD-Standard)

```
GKE Pod: API (StatefulSet)
  └── PVC → PD-Balanced 10GB → tack.db (zonal, replicated within zone)

GKE Pod: Kubo (StatefulSet)
  └── PVC → PD-Standard → /data/ipfs/ (zonal, replicated within zone)
```

**Are files stored "in the cluster"?** No — Persistent Disks are **independent GCP resources**. They exist outside the cluster and are attached to nodes via the CSI driver. If you delete the GKE cluster, the PDs survive (if `reclaimPolicy: Retain`). This is a significant improvement over Railway.

### Limitations of Persistent Disk

| Limitation | Impact | Severity |
|-----------|--------|----------|
| **ReadWriteOnce** | Only 1 pod can mount the PV. No horizontal scaling of Kubo. | Medium — acceptable for MVP |
| **Zonal** | PD is bound to one zone (e.g., `us-central1-a`). Zone outage = downtime. | Medium — mitigate with snapshots |
| **IOPS scales with size** | Small disk = low IOPS. 100GB PD-Standard = 75 read IOPS. | High at small scale — start with PD-Balanced if <500GB |
| **Max size 64TB** | Won't hit this for a long time. | None |
| **No concurrent access** | Can't have a backup process reading while Kubo writes (same PV). | Low — use snapshots for backups |
| **Resize is grow-only** | Can expand online, cannot shrink. Over-provisioning wastes money. | Low — start small, grow as needed |

**Is this a good idea?** Yes, for 0–2TB. Persistent Disk is the standard choice for stateful workloads on GKE. The limitations only matter at scale, and by then you should migrate to GCS.

---

## Deep Dive: Migration to Cloud Storage (GCS)

### Three Options

#### Option A: `go-ds-s3` Plugin (Recommended)

Kubo's datastore is pluggable. The `go-ds-s3` plugin supports any S3-compatible backend, and GCS provides S3 compatibility via its XML API.

**What changes:**
1. Build a custom Kubo Docker image with `go-ds-s3` compiled in
2. Update Kubo's config to point the flatfs datastore to a GCS bucket
3. Migrate existing blocks from local flatfs to GCS (one-time `ipfs-ds-convert` or scripted copy)

**Kubo config change** (conceptual):
```json
{
  "Datastore": {
    "Spec": {
      "type": "mount",
      "mounts": [
        {
          "mountpoint": "/blocks",
          "type": "s3ds",
          "region": "us-central1",
          "bucket": "tack-ipfs-blocks",
          "endpoint": "https://storage.googleapis.com"
        }
      ]
    }
  }
}
```

**Effort**: ~2–3 days
- Day 1: Build custom Kubo image with go-ds-s3, test locally
- Day 2: Migrate existing blocks, validate reads/writes
- Day 3: Deploy, monitor latency, tune caching

**Performance impact:**
| Operation | PD-Standard | GCS | Delta |
|-----------|-------------|-----|-------|
| Pin add (local content) | <10ms | 20–50ms | Acceptable |
| Pin add (fetch from network) | 1–30s (network-bound) | 1–30s + 20ms | Negligible |
| Cat (retrieve content) | <5ms | 20–80ms | Noticeable, mitigate with cache |
| Unpin | <5ms | 10–30ms | Acceptable |

The content cache in `content-cache.ts` (in-memory LRU) already mitigates retrieval latency for hot content.

#### Option B: GCS FUSE (Not Recommended)

Mount a GCS bucket as a local filesystem via `gcsfuse`. Kubo sees a regular directory.

**Why not**: flatfs creates millions of tiny files (~256KB). gcsfuse translates each file operation to HTTP requests. Listing directories with 100K+ files becomes extremely slow. Random write patterns perform poorly. This path leads to cascading timeouts.

#### Option C: Hybrid PD + GCS (Over-Engineered for Now)

Keep PD for hot data, async-replicate to GCS. Custom code needed. Only worth it if you need sub-millisecond reads AND cheap archival. Skip for MVP.

### Cost Impact of GCS Migration

| Scale | PD-Standard | GCS Standard | GCS Operations Cost | Total GCS | Savings |
|-------|-------------|-------------|---------------------|-----------|---------|
| 1 TB (~4M blocks) | $40/mo | $20/mo | ~$2/mo | $22/mo | 45% |
| 5 TB (~20M blocks) | $200/mo | $100/mo | ~$5/mo | $105/mo | 47% |
| 10 TB (~40M blocks) | $400/mo | $200/mo | ~$8/mo | $208/mo | 48% |

GCS operation costs: $0.005/1K Class A (writes), $0.0004/1K Class B (reads). At steady state most operations are reads.

### Recommended Migration Trigger

**Migrate to GCS when storage exceeds 1TB or monthly storage cost exceeds $40.** Below that, the operational simplicity of PD-Standard isn't worth trading for a $20/mo saving.

---

## Cost Breakdown

### Fixed Costs (Compute)

GKE Autopilot pricing — pay per pod resource request:

| Pod | vCPU | RAM | Monthly Cost |
|-----|------|----|-------------|
| API (Hono) | 0.25 | 512MB | ~$13 |
| Kubo | 1.0 | 2GB | ~$42 |
| **Total compute** | | | **~$55/mo** |

### Variable Costs (Per GB Stored)

| Cost Type | $/GB/month |
|-----------|-----------|
| PD-Standard storage | $0.040 |
| Network egress (retrieval) | $0.12/GB transferred |

### Total Cost at Scale

| Stored | Compute | Storage | Total/mo | Effective $/GB |
|--------|---------|---------|----------|----------------|
| 100 GB | $55 | $4 | **$59** | $0.59/GB |
| 500 GB | $55 | $20 | **$75** | $0.15/GB |
| 1 TB | $55 | $40 | **$95** | $0.09/GB |
| 5 TB | $55 | $200 | **$255** | $0.05/GB |
| 10 TB | $55 | $400 | **$455** | $0.045/GB |

---

## Pinata Comparison

Pinata pricing (Professional plan): 250GB for $65/mo ($0.26/GB), overage at ~$0.10–0.15/GB.

| Scale | Tack (PD-Standard) | Pinata (est.) | Tack Advantage |
|-------|---------------------|---------------|----------------|
| 500 GB | $75/mo | ~$90/mo | 17% cheaper |
| 1 TB | $95/mo | ~$140/mo | 32% cheaper |
| 5 TB | $255/mo | ~$565/mo | 55% cheaper |

**Breakeven: ~500GB** — below that, fixed compute costs make us more expensive per-GB.

---

## Future Optimization: GCS-Backed Datastore

Cloud Storage Standard at **$0.020/GB/month** (half of PD-Standard). Kubo supports S3-compatible datastores via `go-ds-s3`, and GCS exposes an S3-compatible XML API.

| Stored | With PD-Standard | With GCS | Savings |
|--------|------------------|----------|---------|
| 1 TB | $95/mo | $75/mo | 21% |
| 5 TB | $255/mo | $155/mo | 39% |
| 10 TB | $455/mo | $255/mo | 44% |

**Tradeoff**: Higher per-operation latency (10–50ms vs <1ms). Acceptable for pinning (write once, read occasionally).

**Migration plan**: Start with PD-Standard for simplicity. Migrate Kubo datastore to GCS when storage exceeds ~1TB.

---

## Recommended Pricing

Linear pricing model covering cost + margin while undercutting Pinata:

| Fee | Amount | Rationale |
|-----|--------|-----------|
| Base fee | $5/mo | Covers minimum compute allocation |
| Storage | $0.08/GB/month | 2× margin over PD-Standard, ~40% cheaper than Pinata |
| Retrieval | $0.05/GB transferred | Margin over $0.12 egress (batched/cached) |

### Revenue vs Cost at Scale

| Stored | Revenue/mo | Cost/mo | Margin |
|--------|-----------|---------|--------|
| 100 GB | $13 | $59 | -$46 (loss) |
| 500 GB | $45 | $75 | -$30 (loss) |
| 1 TB | $87 | $95 | -$8 (near break-even) |
| 2 TB | $165 | $135 | +$30 (22%) |
| 5 TB | $405 | $255 | +$150 (37%) |
| 10 TB | $805 | $455 | +$350 (43%) |

**Unit economics turn positive at ~1.2TB stored.**

---

## Migration Path from Railway

1. Create GKE manifests (StatefulSet for API + Kubo, PVC, Ingress)
2. Deploy to existing GKE Autopilot cluster
3. Migrate SQLite data (pg_dump equivalent: copy `.sqlite` file)
4. Point DNS to new Cloud Load Balancer
5. Decommission Railway services
