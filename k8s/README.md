# Kubernetes deployment

This setup deploys the frontend, REST API, WebSocket service, PostgreSQL, Redis, and Prisma migrations. The Ingress routes `/` to the frontend, `/api/v1` to the API, and `/ws` to the WebSocket service. PostgreSQL data is stored in a 5 GiB PVC; Redis is ephemeral.

## Prerequisites

- A Kubernetes cluster with an nginx Ingress controller and a default StorageClass.
- `kubectl`, Kustomize support (`kubectl apply -k`), and Docker.
- A cluster that can access the three application images, either by loading them locally or by pushing them to a container registry.

## Build images

Run these commands from the repository root:

```sh
docker build -f apps/backend/Dockerfile -t teampulse-backend:latest .
docker build -f apps/frontend/Dockerfile -t teampulse-frontend:latest .
docker build -f apps/ws/Dockerfile -t teampulse-websocket:latest .
```

For Minikube, load each image with `minikube image load <image-name>`. For kind, use `kind load docker-image <image-name>`. For a remote cluster, push the images to a registry and update the image names in the Deployment and migration Job manifests.

## Configure and deploy

1. Copy `secret.example.yaml` to `secret.yaml` and edit the PostgreSQL password, matching `DATABASE_URL`, and a long random `JWT_SECRET`. `secret.yaml` is git-ignored. URL-encode special characters in the database password inside `DATABASE_URL`.
2. If using another hostname, update the Ingress host in `ingress.yaml` and the matching origin in `configmap.yaml` (`FRONTEND_URL`). Point that hostname to the Ingress controller's external IP. Add TLS configuration for public deployments.
3. Apply the manifests and wait for migrations and workloads:

```sh
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -k k8s
kubectl wait --namespace teampulse --for=condition=complete job/teampulse-migrate --timeout=180s
kubectl get pods,services,ingress -n teampulse
```

For Minikube, enable its Ingress addon and map the Minikube IP to `teampulse.local` in your machine's hosts file. Then open `http://teampulse.local`.

The frontend calls the API and WebSocket through the same Ingress host, so it does not need cluster-internal DNS. Google OAuth is optional; when enabled, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` on the backend Deployment, using the public Ingress callback URL ending in `/api/v1/auth/google/callback`.

## Jenkins pipeline

The repository-root `Jenkinsfile` builds and scans the backend, frontend, and WebSocket images, pushes them to ECR, and applies the Kubernetes manifests with the build-specific image tags. Before running it, configure:

- An agent with Docker, AWS CLI, `kubectl`, Trivy, and network access to the configured services.
- The Jenkins AWS credentials binding plugin and a credential with ID `aws-ecr-credentials`, authorized to push to the three ECR repositories.
- A Jenkins file credential with ID `teampulse-kubeconfig` for the target cluster.
- A SonarQube server named `SonarQube` and a scanner installation named `SonarScanner` in Jenkins system configuration.
- The `AWS_REGION` and `ECR_REGISTRY` pipeline parameters. Create the ECR repositories `teampulse-backend`, `teampulse-frontend`, and `teampulse-websocket` in that registry.
- The Kubernetes worker nodes need permission to pull images from those ECR repositories.
- The Kubernetes `teampulse` namespace configuration and `teampulse-secrets` secret required by the manifests. Do not use the example secret values in a real deployment.

The pipeline blocks on Trivy HIGH/CRITICAL findings and waits for the migration Job and all three deployments to complete.

## Operations

```sh
kubectl logs -n teampulse job/teampulse-migrate
kubectl logs -n teampulse deploy/backend
kubectl logs -n teampulse deploy/websocket
kubectl delete -k k8s
```

Before reapplying a changed migration Job, delete the old Job first because Kubernetes does not allow changing a Job's pod template:

```sh
kubectl delete job teampulse-migrate -n teampulse --ignore-not-found
kubectl apply -k k8s
```