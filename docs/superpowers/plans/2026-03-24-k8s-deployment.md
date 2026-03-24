# Tack K8s Deployment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Tack from Railway to GKE Autopilot by cleaning up Railway artifacts in the Tack repo and creating a Helm chart in ecosystem-k8s-configs.

**Architecture:** Two StatefulSets (API + Kubo) with PD-Standard PVCs, Gateway API for external HTTPS, LoadBalancer for IPFS swarm. Single K8s Secret for auth token, ConfigMap for everything else.

**Tech Stack:** Helm v2, GKE Gateway API, PD-Standard storage, Cloud Armor

**Spec:** `docs/superpowers/specs/2026-03-24-k8s-deployment-design.md`

---

## Workstream A: Tack Repo Cleanup (ipfs-manager)

Working directory: `/Users/gustavo/apps/ipfs-manager-worktrees/k8s-deployment`

### Task 1: Update Dockerfile for non-root user

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Add non-root user to Dockerfile runtime stage**

In the runtime stage (after `RUN mkdir -p ./data`), add a non-root user and chown:

```dockerfile
RUN addgroup --gid 1000 tack && \
    adduser --uid 1000 --gid 1000 --disabled-password --gecos "" tack && \
    chown -R tack:tack /app
USER tack
```

This must go after `mkdir -p ./data` and before `EXPOSE 3000`.

- [ ] **Step 2: Verify Docker build still works**

Run: `docker build -t tack:k8s-test .`
Expected: Build succeeds, image created

- [ ] **Step 3: Verify container runs as non-root**

Run: `docker run --rm tack:k8s-test whoami`
Expected: `tack`

Run: `docker run --rm tack:k8s-test id`
Expected: `uid=1000(tack) gid=1000(tack) groups=1000(tack)`

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "fix(docker): run as non-root user for K8s security context"
```

### Task 2: Delete Railway configuration files

**Files:**
- Delete: `railway.json`
- Delete: `kubo/railway.json`
- Delete: `docs/railway-deployment.md`

- [ ] **Step 1: Delete the 3 Railway-specific files**

```bash
rm railway.json kubo/railway.json docs/railway-deployment.md
```

- [ ] **Step 2: Update CLAUDE.md to remove Railway references**

In `CLAUDE.md`:
- Remove the line `  railway-deployment.md       # Railway deployment runbook` from the Project Structure section
- Change `**Production**: Railway (API + Kubo as separate services, persistent volumes)` to `**Production**: GKE Autopilot (API + Kubo as StatefulSets, persistent volumes)`

- [ ] **Step 3: Verify no other stale Railway references remain**

Run: `grep -ri "railway" --include="*.ts" --include="*.json" --include="*.md" --include="*.yml" --include="*.yaml" .`
Expected: No meaningful references (docker-compose.yml mentions are fine)

- [ ] **Step 4: Commit**

```bash
git add -u railway.json kubo/railway.json docs/railway-deployment.md CLAUDE.md
git commit -m "chore: remove Railway deployment configs, update CLAUDE.md

Migrating to GKE Autopilot. Local dev still uses docker-compose."
```

---

## Workstream B: Helm Chart (ecosystem-k8s-configs)

Working directory: `/Users/gustavo/taiko/ecosystem-k8s-configs`

Create a new branch first:
```bash
cd /Users/gustavo/taiko/ecosystem-k8s-configs
git checkout -b tack-helm-chart
```

Reference files to follow conventions from:
- `/Users/gustavo/taiko/ecosystem-k8s-configs/mainnet/facilitator/` — primary reference for all templates

### Task 3: Create Chart.yaml and values.yaml

**Files:**
- Create: `mainnet/tack/Chart.yaml`
- Create: `mainnet/tack/values.yaml`

- [ ] **Step 1: Create chart directory structure**

```bash
mkdir -p mainnet/tack/templates/{statefulset,service,gateway,config}
```

- [ ] **Step 2: Create Chart.yaml**

Create `mainnet/tack/Chart.yaml`:
```yaml
apiVersion: v2
appVersion: "0.1.4"
name: tack
description: A Helm chart for Tack IPFS pinning service with x402 payments
type: application
version: 0.1.0
```

- [ ] **Step 3: Create values.yaml**

Create `mainnet/tack/values.yaml`:
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
  storageClassName: standard-rwo

kubo:
  image: "<registry>/tack-kubo:latest"
  swarmStaticIP: ""
  announceAddress: ""
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 1000m
      memory: 2Gi
  storage: 100Gi
  storageClassName: standard-rwo

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

- [ ] **Step 4: Verify Helm can lint the chart skeleton**

Run: `helm lint mainnet/tack/`
Expected: May warn about missing templates but no errors on Chart.yaml/values.yaml

- [ ] **Step 5: Commit**

```bash
git add mainnet/tack/Chart.yaml mainnet/tack/values.yaml
git commit -m "feat(tack): add Helm chart skeleton with Chart.yaml and values.yaml"
```

### Task 4: Create ConfigMap template

**Files:**
- Create: `mainnet/tack/templates/config/configmap.yaml`

Reference: `mainnet/facilitator/templates/config/configmap.yaml`

- [ ] **Step 1: Create the ConfigMap template**

Create `mainnet/tack/templates/config/configmap.yaml`:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  labels:
    service: tack-api
    app.kubernetes.io/name: "tack"
  namespace: {{$.Release.Namespace}}
  name: tack-config
data:
  PORT: "3000"
  NODE_ENV: "production"
  IPFS_API_URL: "http://tack-kubo:5001"
  DELEGATE_URL: "http://tack-kubo:8080/ipfs"
  IPFS_TIMEOUT_MS: "30000"
  DATABASE_PATH: "/app/data/tack.db"
  PUBLIC_BASE_URL: "https://{{ (index .Values.gateway 0).host }}"
  TRUST_PROXY: "true"
  TRUSTED_PROXY_CIDRS: {{ .Values.config.trustedProxyCidrs | quote }}
  X402_FACILITATOR_URL: "https://facilitator.taiko.xyz"
  X402_NETWORK: "eip155:167000"
  X402_PAY_TO: {{ .Values.config.x402PayTo | quote }}
  X402_USDC_ASSET_ADDRESS: {{ .Values.config.x402UsdcAssetAddress | quote }}
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
```

- [ ] **Step 2: Verify Helm lint passes**

Run: `helm lint mainnet/tack/`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add mainnet/tack/templates/config/configmap.yaml
git commit -m "feat(tack): add ConfigMap for non-sensitive environment config"
```

### Task 5: Create tack-api StatefulSet

**Files:**
- Create: `mainnet/tack/templates/statefulset/tack-api.yaml`

Reference: `mainnet/facilitator/templates/deployment/facilitator.yaml` for label/annotation conventions, `mainnet/rpc/templates/stateful-set/l2-node-debug.yaml` for StatefulSet + volumeClaimTemplates pattern.

- [ ] **Step 1: Create the tack-api StatefulSet template**

Create `mainnet/tack/templates/statefulset/tack-api.yaml`:
```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  labels:
    service: tack-api
    app.kubernetes.io/name: "tack"
  namespace: {{$.Release.Namespace}}
  name: tack-api
spec:
  replicas: 1
  serviceName: tack-api
  selector:
    matchLabels:
      service: tack-api
  template:
    metadata:
      labels:
        service: tack-api
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/config/configmap.yaml") . | sha256sum }}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      containers:
        - name: tack-api
          image: {{ .Values.api.image }}
          imagePullPolicy: Always
          envFrom:
            - configMapRef:
                name: tack-config
          env:
            - name: WALLET_AUTH_TOKEN_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.secret.name }}
                  key: wallet-auth-token-secret
          ports:
            - containerPort: 3000
              name: http
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              cpu: {{ .Values.api.resources.requests.cpu }}
              memory: {{ .Values.api.resources.requests.memory }}
            limits:
              cpu: {{ .Values.api.resources.limits.cpu }}
              memory: {{ .Values.api.resources.limits.memory }}
          volumeMounts:
            - name: tack-data
              mountPath: /app/data
  volumeClaimTemplates:
    - metadata:
        name: tack-data
      spec:
        storageClassName: {{ .Values.api.storageClassName }}
        accessModes:
          - ReadWriteOnce
        resources:
          requests:
            storage: {{ .Values.api.storage }}
```

- [ ] **Step 2: Verify Helm lint passes**

Run: `helm lint mainnet/tack/`
Expected: No errors

- [ ] **Step 3: Verify rendered output looks correct**

Run: `helm template tack mainnet/tack/ --set secret.name=tack --set api.image=test:latest --set kubo.image=test:latest`
Expected: Valid YAML with StatefulSet, no Helm template errors

- [ ] **Step 4: Commit**

```bash
git add mainnet/tack/templates/statefulset/tack-api.yaml
git commit -m "feat(tack): add tack-api StatefulSet with SQLite PVC"
```

### Task 6: Create tack-kubo StatefulSet

**Files:**
- Create: `mainnet/tack/templates/statefulset/tack-kubo.yaml`

- [ ] **Step 1: Create the tack-kubo StatefulSet template**

Create `mainnet/tack/templates/statefulset/tack-kubo.yaml`:
```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  labels:
    service: tack-kubo
    app.kubernetes.io/name: "tack"
  namespace: {{$.Release.Namespace}}
  name: tack-kubo
spec:
  replicas: 1
  serviceName: tack-kubo
  selector:
    matchLabels:
      service: tack-kubo
  template:
    metadata:
      labels:
        service: tack-kubo
    spec:
      securityContext:
        runAsNonRoot: true
        fsGroup: 1000
      containers:
        - name: tack-kubo
          image: {{ .Values.kubo.image }}
          imagePullPolicy: Always
          env:
            - name: IPFS_ANNOUNCE_ADDRESS
              value: {{ .Values.kubo.announceAddress | quote }}
          ports:
            - containerPort: 4001
              name: swarm
              protocol: TCP
            - containerPort: 5001
              name: api
            - containerPort: 8080
              name: gateway
          startupProbe:
            tcpSocket:
              port: 5001
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 30
          livenessProbe:
            tcpSocket:
              port: 5001
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            tcpSocket:
              port: 5001
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              cpu: {{ .Values.kubo.resources.requests.cpu }}
              memory: {{ .Values.kubo.resources.requests.memory }}
            limits:
              cpu: {{ .Values.kubo.resources.limits.cpu }}
              memory: {{ .Values.kubo.resources.limits.memory }}
          volumeMounts:
            - name: tack-ipfs-data
              mountPath: /data/ipfs
  volumeClaimTemplates:
    - metadata:
        name: tack-ipfs-data
      spec:
        storageClassName: {{ .Values.kubo.storageClassName }}
        accessModes:
          - ReadWriteOnce
        resources:
          requests:
            storage: {{ .Values.kubo.storage }}
```

- [ ] **Step 2: Verify Helm lint passes**

Run: `helm lint mainnet/tack/`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add mainnet/tack/templates/statefulset/tack-kubo.yaml
git commit -m "feat(tack): add tack-kubo StatefulSet with IPFS PVC"
```

### Task 7: Create Service templates

**Files:**
- Create: `mainnet/tack/templates/service/tack-api.yaml`
- Create: `mainnet/tack/templates/service/tack-kubo.yaml`
- Create: `mainnet/tack/templates/service/tack-kubo-swarm.yaml`

Reference: `mainnet/facilitator/templates/service/facilitator.yaml`

- [ ] **Step 1: Create tack-api ClusterIP Service**

Create `mainnet/tack/templates/service/tack-api.yaml`:
```yaml
apiVersion: v1
kind: Service
metadata:
  labels:
    service: tack-api
    app.kubernetes.io/name: "tack"
  namespace: {{$.Release.Namespace}}
  name: tack-api
spec:
  ports:
    - name: http
      port: 3000
      targetPort: 3000
  selector:
    service: tack-api
  type: ClusterIP
```

- [ ] **Step 2: Create tack-kubo ClusterIP Service**

Create `mainnet/tack/templates/service/tack-kubo.yaml`:
```yaml
apiVersion: v1
kind: Service
metadata:
  labels:
    service: tack-kubo
    app.kubernetes.io/name: "tack"
  namespace: {{$.Release.Namespace}}
  name: tack-kubo
spec:
  ports:
    - name: api
      port: 5001
      targetPort: 5001
    - name: gateway
      port: 8080
      targetPort: 8080
  selector:
    service: tack-kubo
  type: ClusterIP
```

- [ ] **Step 3: Create tack-kubo-swarm LoadBalancer Service**

Create `mainnet/tack/templates/service/tack-kubo-swarm.yaml`:
```yaml
apiVersion: v1
kind: Service
metadata:
  labels:
    service: tack-kubo
    app.kubernetes.io/name: "tack"
  namespace: {{$.Release.Namespace}}
  name: tack-kubo-swarm
spec:
  ports:
    - name: swarm
      port: 4001
      targetPort: 4001
      protocol: TCP
  selector:
    service: tack-kubo
  loadBalancerIP: {{ .Values.kubo.swarmStaticIP | quote }}
  type: LoadBalancer
```

- [ ] **Step 4: Verify Helm lint passes**

Run: `helm lint mainnet/tack/`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add mainnet/tack/templates/service/
git commit -m "feat(tack): add Service resources (API ClusterIP, Kubo ClusterIP, Swarm LB)"
```

### Task 8: Create Gateway templates

**Files:**
- Create: `mainnet/tack/templates/gateway/gateway-external-http.yaml`
- Create: `mainnet/tack/templates/gateway/httproute-external.yaml`
- Create: `mainnet/tack/templates/gateway/redirect-httproute.yaml`
- Create: `mainnet/tack/templates/gateway/cloud-armor-policy.yaml`

Reference: Copy patterns exactly from `mainnet/facilitator/templates/gateway/`

- [ ] **Step 1: Create Gateway resource**

Create `mainnet/tack/templates/gateway/gateway-external-http.yaml`:
```yaml
{{- range $v := .Values.gateway }}
kind: Gateway
apiVersion: gateway.networking.k8s.io/v1beta1
metadata:
  name: external-http-{{ $v.host | replace "." "-" }}
  namespace: {{$.Release.Namespace}}
spec:
  gatewayClassName: gke-l7-global-external-managed
  listeners:
  - name: http
    protocol: HTTP
    port: 80
    allowedRoutes:
      kinds:
      - kind: HTTPRoute
      namespaces:
        from: Same
  - name: https
    protocol: HTTPS
    port: 443
    allowedRoutes:
      kinds:
      - kind: HTTPRoute
      namespaces:
        from: All
    tls:
      mode: Terminate
      options:
        networking.gke.io/pre-shared-certs: ssl-certificate-{{ $v.host | replace "." "-" }}
  addresses:
  - type: NamedAddress
    value: {{ $v.host | replace "." "-" }}
---
{{- end }}
```

- [ ] **Step 2: Create HTTPRoute for HTTPS**

Create `mainnet/tack/templates/gateway/httproute-external.yaml`:
```yaml
{{- range $v := .Values.gateway }}
kind: HTTPRoute
apiVersion: gateway.networking.k8s.io/v1beta1
metadata:
  name: external-{{ $v.host | replace "." "-" }}
  namespace: {{$.Release.Namespace}}
spec:
  parentRefs:
  - kind: Gateway
    name: external-http-{{ $v.host | replace "." "-" }}
    sectionName: https
  hostnames:
  - {{ $v.host }}
  rules:
  - backendRefs:
    - name: {{ $v.serviceName }}
      port: {{ $v.port }}
---
{{- end }}
```

- [ ] **Step 3: Create HTTP->HTTPS redirect route**

Create `mainnet/tack/templates/gateway/redirect-httproute.yaml`:
```yaml
{{- range $v := .Values.gateway }}
kind: HTTPRoute
apiVersion: gateway.networking.k8s.io/v1beta1
metadata:
  name: redirect-{{ $v.host | replace "." "-" }}
  namespace: {{$.Release.Namespace}}
spec:
  parentRefs:
  - namespace: {{ $.Release.Namespace }}
    name: external-http-{{ $v.host | replace "." "-" }}
    sectionName: http
  rules:
  - filters:
    - type: RequestRedirect
      requestRedirect:
        scheme: https
---
{{- end }}
```

- [ ] **Step 4: Create Cloud Armor backend policy**

Create `mainnet/tack/templates/gateway/cloud-armor-policy.yaml`:
```yaml
{{- range $v := .Values.gateway }}
apiVersion: networking.gke.io/v1
kind: GCPBackendPolicy
metadata:
  name: policy-{{ $v.serviceName }}
  namespace: {{$.Release.Namespace}}
spec:
  default:
    securityPolicy: tack-armor-policy
  targetRef:
    group: ""
    kind: Service
    name: {{ $v.serviceName }}
---
{{- end }}
```

- [ ] **Step 5: Verify Helm lint passes**

Run: `helm lint mainnet/tack/`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add mainnet/tack/templates/gateway/
git commit -m "feat(tack): add Gateway API resources for external HTTPS with Cloud Armor"
```

### Task 9: Final validation — helm template dry run

- [ ] **Step 1: Run full helm template render**

Run: `helm template tack mainnet/tack/ -n qa --set api.image=ghcr.io/test/tack:0.1.4 --set kubo.image=ghcr.io/test/tack-kubo:latest --set kubo.swarmStaticIP=10.0.0.1 --set config.x402PayTo=0xabc --set config.x402UsdcAssetAddress=0xdef`
Expected: Valid YAML output with all resources: 2 StatefulSets, 3 Services, 1 ConfigMap, 1 Gateway, 2 HTTPRoutes, 1 GCPBackendPolicy

- [ ] **Step 2: Verify the rendered YAML has no issues**

Pipe to `kubectl apply --dry-run=client -f -` if a cluster context is available. Otherwise, visually inspect:
- StatefulSets have correct volumeClaimTemplates
- Services have correct selectors and ports
- Gateway references correct SSL cert name
- ConfigMap has all expected keys
- Secret reference uses correct key name

- [ ] **Step 3: Run helm lint one final time**

Run: `helm lint mainnet/tack/ --strict`
Expected: 0 errors, 0 warnings

- [ ] **Step 4: Commit any fixes, then verify clean state**

Run: `git status`
Expected: Clean working tree, all changes committed
