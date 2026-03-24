# Tack K8s Deployment Design

Migrate Tack (API + Kubo) from Railway to GKE Autopilot in the Taiko mainnet cluster. Helm chart in `ecosystem-k8s-configs/mainnet/tack/`.

## Architecture

Two StatefulSets, both single-replica, both with PD-Standard persistent volumes:

```
                   internet
                      |
              [GKE Gateway API]
              tack.taiko.xyz:443
                      |
           [GCPBackendPolicy / Cloud Armor]
                      |
              [tack-api ClusterIP]
                  port 3000
                      |
            +---------+---------+
            |                   |
    [tack-kubo ClusterIP]   [SQLite PVC]
    ports 5001, 8080         10Gi PD-Std
            |
    [Kubo IPFS PVC]
     100Gi PD-Std
            |
    [tack-kubo-swarm LB]
       port 4001 (public)
       IPFS DHT discovery
```

## Tack Repo Changes

Delete 3 Railway-specific files:

- `railway.json`
- `kubo/railway.json`
- `docs/railway-deployment.md`

One Dockerfile change: add non-root user and `chown` the data directory so the container runs as UID 1000 matching the K8s `securityContext`.

Files kept as-is: `kubo/Dockerfile`, `kubo/configure-announce.sh`, `docker-compose.yml` (local dev), `.env.example`.

## Chart.yaml

```yaml
apiVersion: v2
appVersion: "0.1.4"
name: tack
description: A Helm chart for Tack IPFS pinning service with x402 payments
type: application
version: 0.1.0
```

## Helm Chart Structure

```
mainnet/tack/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── statefulset/
│   │   ├── tack-api.yaml
│   │   └── tack-kubo.yaml
│   ├── service/
│   │   ├── tack-api.yaml
│   │   ├── tack-kubo.yaml
│   │   └── tack-kubo-swarm.yaml
│   ├── gateway/
│   │   ├── gateway-external-http.yaml
│   │   ├── httproute-external.yaml
│   │   ├── redirect-httproute.yaml
│   │   └── cloud-armor-policy.yaml
│   └── config/
│       └── configmap.yaml
```

## StatefulSets

### tack-api

- Image: built from `Dockerfile`, pushed to a container registry (TBD — GHCR or Artifact Registry)
- imagePullPolicy: Always
- Replicas: 1 (SQLite single-writer constraint)
- Port: 3000
- Volume: 10Gi PD-Standard at `/app/data` (SQLite DB)
- Resources: requests 250m/256Mi, limits 500m/512Mi
- Security: runAsNonRoot, runAsUser/Group 1000, fsGroup 1000
- Env: ConfigMap (via envFrom), Secret `tack` for `WALLET_AUTH_TOKEN_SECRET`
- Annotation: checksum/config for automatic redeployment on ConfigMap change
- Liveness probe:
  - httpGet `/health` port 3000
  - initialDelaySeconds: 10, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3
- Readiness probe:
  - httpGet `/health` port 3000
  - initialDelaySeconds: 5, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3

### tack-kubo

- Image: built from `kubo/Dockerfile` (ipfs/kubo:latest + announce script)
- imagePullPolicy: Always
- Replicas: 1
- Ports: 4001 (swarm), 5001 (RPC), 8080 (gateway)
- Volume: 100Gi PD-Standard at `/data/ipfs` (IPFS blocks)
- Resources: requests 500m/1Gi, limits 1000m/2Gi
- Security: runAsNonRoot (Kubo image runs as user `kubo`, UID 1000 by default), fsGroup 1000
- Env: `IPFS_ANNOUNCE_ADDRESS` from values for DHT discoverability
- Startup probe (IPFS init/migration can be slow):
  - tcpSocket port 5001
  - initialDelaySeconds: 10, periodSeconds: 5, failureThreshold: 30 (up to ~2.5min)
- Liveness probe:
  - tcpSocket port 5001
  - periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3
- Readiness probe:
  - tcpSocket port 5001
  - initialDelaySeconds: 5, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3

## Services

### tack-api (ClusterIP)

- Port 3000 -> 3000
- Selector: `service: tack-api`
- Internal only; Gateway routes external traffic to it

### tack-kubo (ClusterIP)

- Port 5001 -> 5001 (RPC), 8080 -> 8080 (gateway)
- Selector: `service: tack-kubo`
- Internal only; only tack-api connects

### tack-kubo-swarm (LoadBalancer)

- Port 4001 -> 4001 (TCP)
- `spec.loadBalancerIP: {{ .Values.kubo.swarmStaticIP }}` — regional static IP
- Selector: `service: tack-kubo`
- Public; required for IPFS DHT peer discovery

## Gateway (External HTTPS)

Following facilitator conventions exactly:

- `gatewayClassName: gke-l7-global-external-managed`
- Listeners: HTTP (80) + HTTPS (443) with pre-shared SSL cert
- HTTPRoute: `tack.taiko.xyz` -> `tack-api:3000`
- Redirect HTTPRoute: HTTP -> HTTPS
- GCPBackendPolicy: attaches Cloud Armor security policy to tack-api service
- Static IP provisioned via `gcloud compute addresses create tack-taiko-xyz --global`
- SSL cert via `gcloud compute ssl-certificates create ssl-certificate-tack-taiko-xyz --domains=tack.taiko.xyz`

## ConfigMap

All non-sensitive configuration:

```yaml
data:
  PORT: "3000"
  NODE_ENV: "production"
  IPFS_API_URL: "http://tack-kubo:5001"
  DELEGATE_URL: "http://tack-kubo:8080/ipfs"
  IPFS_TIMEOUT_MS: "30000"
  DATABASE_PATH: "/app/data/tack.db"
  PUBLIC_BASE_URL: "https://tack.taiko.xyz"
  TRUST_PROXY: "true"
  TRUSTED_PROXY_CIDRS: "35.191.0.0/16,130.211.0.0/22"
  X402_FACILITATOR_URL: "https://facilitator.taiko.xyz"
  X402_NETWORK: "eip155:167000"
  X402_PAY_TO: "<receiving-wallet-address>"
  X402_USDC_ASSET_ADDRESS: "<usdc-contract-on-taiko>"
  X402_USDC_ASSET_DECIMALS: "6"
  X402_USDC_DOMAIN_NAME: "USD Coin"
  X402_USDC_DOMAIN_VERSION: "2"
  X402_RATE_PER_GB_MONTH_USD: "0.10"
  X402_MIN_PRICE_USD: "0.001"
  X402_MAX_PRICE_USD: "50.0"
  X402_DEFAULT_DURATION_MONTHS: "1"
  X402_MAX_DURATION_MONTHS: "24"
  UPLOAD_MAX_SIZE_BYTES: "104857600"
  GATEWAY_MAX_CONTENT_SIZE_BYTES: "52428800"
  GATEWAY_CACHE_MAX_SIZE_BYTES: "104857600"
  GATEWAY_CACHE_CONTROL_MAX_AGE_SECONDS: "31536000"
  RATE_LIMIT_REQUESTS_PER_MINUTE: "120"
  WALLET_AUTH_TOKEN_ISSUER: "tack"
  WALLET_AUTH_TOKEN_AUDIENCE: "tack-owner-api"
  WALLET_AUTH_TOKEN_TTL_SECONDS: "900"
  # Replication intentionally omitted for single-node MVP.
  # To enable, add PIN_REPLICA_IPFS_API_URLS and PIN_REPLICA_DELEGATE_URLS.
```

Actual wallet/contract addresses provided in `values.yaml` and overridden at deploy time.

## Secret

Single K8s Secret `tack`, created outside Helm:

```bash
kubectl create secret generic tack \
  -n <namespace> \
  --from-literal=wallet-auth-token-secret='<strong-random-32+-char-string>'
```

Referenced in tack-api StatefulSet as:
```yaml
- name: WALLET_AUTH_TOKEN_SECRET
  valueFrom:
    secretKeyRef:
      name: tack
      key: wallet-auth-token-secret
```

## values.yaml

```yaml
api:
  image: "<registry>/tack:0.1.4"
  resources:
    requests:
      cpu: 250m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
  storage: 10Gi

kubo:
  image: "<registry>/tack-kubo:latest"
  swarmStaticIP: ""  # regional IP provisioned via gcloud
  announceAddress: ""  # /ip4/<static-ip>/tcp/4001
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 1000m
      memory: 2Gi
  storage: 100Gi

config:
  x402PayTo: "0x..."
  x402UsdcAssetAddress: "0x..."
  trustedProxyCidrs: "35.191.0.0/16,130.211.0.0/22"

gateway:
  - host: tack.taiko.xyz
    externalStaticIPAddress: ""
    serviceName: tack-api
    port: 3000

secret:
  name: tack
```

## Deployment Prerequisites

Before first `helm install`:

1. Build and push images to container registry
2. Provision static IPs:
   - `gcloud compute addresses create tack-taiko-xyz --global` (Gateway)
   - `gcloud compute addresses create tack-kubo-swarm --region=<region>` (LoadBalancer)
3. Create DNS A record: `tack.taiko.xyz` -> global static IP
4. Create SSL cert: `gcloud compute ssl-certificates create ssl-certificate-tack-taiko-xyz --domains=tack.taiko.xyz`
5. Create Cloud Armor security policy (or reference existing shared policy)
6. Create K8s secret: `kubectl create secret generic tack -n <ns> --from-literal=wallet-auth-token-secret='...'`
7. `helm install tack ./mainnet/tack -n <namespace>`

## Cost Estimate (from pricing-model.md)

- API pod: ~$13/mo (GKE Autopilot)
- Kubo pod: ~$42/mo (GKE Autopilot)
- Storage: $0.04/GB/mo (PD-Standard)
- Load Balancer: free with GKE
- Total fixed: ~$55/mo + storage
