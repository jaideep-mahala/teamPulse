# TeamPulse

TeamPulse is a collaborative team workspace for organizing work by organization and board. Teams can create organizations, manage membership, and track issues across shared boards. Board updates are persisted in PostgreSQL, while a WebSocket service reports who is currently viewing a board.

## What you can do

- Create an account with email and password, or sign in with Google OAuth when configured.
- Create and manage organizations with administrator and member roles.
- Work from Frontend, Backend, and DevOps boards. Each board groups issues into **Upcoming**, **In Progress**, and **Done** sections.
- Create issues, move them through the workflow, and discuss work with comments.
- Invite organization members and accept invitations.
- See active board presence over WebSockets, with Redis Pub/Sub supporting presence and events across service instances.

## Technology

| Area | Technologies |
| --- | --- |
| Monorepo and runtime | Bun workspaces, Turborepo, TypeScript |
| Web application | React 19, React Router, Axios, Framer Motion, Lucide |
| REST API | Express 5, Zod, JWT, bcrypt |
| Realtime | WebSocket (`ws`), Redis (`ioredis`) |
| Data | PostgreSQL, Prisma 6, `@prisma/adapter-pg` |
| Integrations | Google OAuth (optional); Resend helper is present but email sending is not currently connected to the invitation route |

## Repository layout

```text
apps/
	frontend/   React single-page application
	backend/    Express REST API (port 4000)
	ws/         Authenticated board-presence WebSocket server (port 5000)
packages/
	db/         Prisma schema, migrations, generated client, PostgreSQL adapter
	redis/      Redis client, Pub/Sub, realtime events, and board presence
	ui/         Shared UI package
	eslint-config/       Shared lint configuration
	typescript-config/   Shared TypeScript configurations
```

## Prerequisites

- Git
- [Bun 1.4.0](https://bun.sh/) (the version declared by this repository)
- [Node.js 24 or newer](https://nodejs.org/) (the root package declares this engine requirement)
- PostgreSQL
- Redis for cross-instance realtime events and board presence
- Docker, if you want to run PostgreSQL and Redis in containers

Windows users can run the commands from PowerShell with Bun installed, or use WSL. The examples below use paths that work in Bash and PowerShell.

## Get the project

```sh
git clone https://github.com/jaideep-mahala/teamPulse-fullstack.git
cd teamPulse-fullstack
bun install
```

Install dependencies once from the repository root. Bun installs dependencies for all workspaces using `bun.lock`.

## Start the supporting services

Start PostgreSQL and Redis locally, or use Docker. These example containers publish the default ports used by the app:

```sh
docker run --name teampulse-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=teampulse -p 5432:5432 -d postgres:16-alpine
docker run --name teampulse-redis -p 6379:6379 -d redis:7-alpine
```

If you already have PostgreSQL or Redis running, use those services instead. The PostgreSQL database must exist and be reachable before applying migrations.

## Configure environment

Create `packages/db/.env` for Prisma CLI commands:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/teampulse?schema=public"
```

Create `apps/backend/.env`:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/teampulse?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
FRONTEND_URL="http://localhost:3000"
```

Use the same `JWT_SECRET` in the backend and WebSocket service. Update `DATABASE_URL` in all three files if your database credentials, host, port, or database name differ. Bun loads environment variables from the app's working directory, so the backend and WebSocket `.env` files are needed even though the Prisma CLI has its own file. Do not commit real secrets.

Google sign-in is optional. To enable it, add these values to `apps/backend/.env` and configure the same callback URL in your Google OAuth client:

```dotenv
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:4000/api/v1/auth/google/callback"
```

The frontend currently targets `http://localhost:4000` for API requests, `http://localhost:3000` for its development origin, and port `5000` for WebSockets. Keep those ports unless you also update the corresponding frontend configuration and API CORS origin.

Create `apps/ws/.env`:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/teampulse?schema=public"
JWT_SECRET="replace-with-the-same-long-random-secret-used-by-the-backend"
REDIS_URL="redis://localhost:6379"
```

## Prepare the database

From the repository root, run Prisma generation and apply the checked-in migrations:

```sh
cd packages/db
bunx prisma generate
bunx prisma migrate dev
cd ../..
```

Run migrations again after pulling schema changes that add a new migration. For a clean local database, `migrate dev` applies the existing migration history and creates the development database schema.

## Run with Docker

From the repository root, copy `.env.example` to `.env` and replace the example secrets. Then run:

```sh
docker compose up --build -d
```

Compose builds the frontend, API, and WebSocket images, starts the official PostgreSQL and Redis images, and applies database migrations. Open `http://localhost:3000`; the API and WebSocket ports are `4000` and `5000`. PostgreSQL data is stored in a named Docker volume. Stop the stack with `docker compose down`.

The current frontend and API are configured for local development URLs and CORS. Before deploying this stack on EC2 for public access, configure the frontend API/WebSocket URLs and the API's allowed origin for your domain. Do not use the example secrets in a public deployment.

## Run the application

Start each process in its own terminal from the repository root. The API has no `dev` script, so start it directly with Bun.

**Terminal 1: REST API**

```sh
cd apps/backend
bun run index.ts
```

The API listens on `http://localhost:4000`. Check it at `http://localhost:4000/health`.

**Terminal 2: WebSocket service**

```sh
cd apps/ws
bun run dev
```

The WebSocket service listens on port `5000` by default.

**Terminal 3: Frontend**

```sh
cd apps/frontend
bun run dev
```

Open the local URL printed by Bun (normally `http://localhost:3000`). Sign up, create an organization, and open a board to try the workflow.

Stop any process with `Ctrl+C`. To restart Docker dependencies later:

```sh
docker start teampulse-postgres teampulse-redis
```

## Useful commands

Run these from the repository root unless noted otherwise:

| Command | Purpose |
| --- | --- |
| `bun install` | Install all workspace dependencies |
| `cd packages/db && bunx prisma generate` | Generate the Prisma client |
| `cd packages/db && bunx prisma migrate dev` | Apply migrations in development |
| `cd apps/backend && bun run index.ts` | Start the REST API |
| `cd apps/ws && bun run dev` | Start the WebSocket service |
| `cd apps/frontend && bun run dev` | Start the frontend development server |
| `cd apps/frontend && bun run build` | Build the frontend for production |

The root `bun run dev` command uses Turborepo, but it does not start the backend because the backend workspace does not currently define a `dev` script. Use the three-terminal instructions above for a complete local development setup.

## API overview

The Express API is rooted at `/api/v1` and uses JWT authentication for protected operations. It includes routes for:

- Signup, signin, Google OAuth, and the current user's profile
- Organization creation, lookup, update, and deletion
- Membership invitations and invitation acceptance
- Board creation, lookup, updates, and deletion
- Section and issue management, including moving issues between sections
- Issue comments

`GET /health` is an unauthenticated health check. The frontend and API are configured for local development; production deployments need the frontend API/WebSocket URLs, CORS origin, OAuth callback, and secrets configured for their deployment environment.

## Troubleshooting

- **Database connection errors:** Confirm PostgreSQL is running, the database exists, and each `DATABASE_URL` points to it. Check the `.env` file for the process you are starting.
- **Prisma migration errors:** Run `bun install`, then run `bunx prisma generate` and `bunx prisma migrate dev` from `packages/db`.
- **Authentication or presence failures:** Confirm `JWT_SECRET` is set and identical in `apps/backend/.env` and `apps/ws/.env`.
- **No active-user count or Redis warnings:** Confirm Redis is reachable at `REDIS_URL` (default `redis://localhost:6379`).
- **Frontend cannot reach the API:** Ensure the API uses port `4000` and the frontend is opened at `http://localhost:3000`, the origin allowed by the API's CORS configuration.
- **Google sign-in fails:** Verify all three Google OAuth variables and ensure the callback URL exactly matches the URL registered with Google.


# TeamPulse — Complete AWS Deployment Guide (Console + CLI)

A from-scratch, end-to-end guide to deploying **TeamPulse** (real-time kanban board: React/Vite frontend, Express/Bun backend, Bun WebSocket server, PostgreSQL, Redis) on AWS.

If you follow this top to bottom you will end up with:

- Frontend on **S3 + CloudFront + Route 53** (HTTPS, custom domain)
- Backend and WebSocket on **Amazon EKS**, exposed through **NGINX Ingress behind an AWS NLB**
- Database on **Amazon RDS PostgreSQL** in private subnets
- Images in **Amazon ECR**
- CI/CD with **Jenkins on EC2**
- A security baseline (IAM, security groups, secrets, TLS)

> **How to read this guide.** Every step has a **Console** path (click-by-click) and a **CLI** equivalent. Use whichever you prefer. Values in `<ANGLE_BRACKETS>` are placeholders you must replace. Values like `teampulse-cluster` and `jaideepmahala.online` are the ones used in this project; change them for your own setup.

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Conventions and variables](#2-conventions-and-variables)
3. [Prerequisites and tooling](#3-prerequisites-and-tooling)
4. [IAM: users, permissions, CLI login](#4-iam-users-permissions-cli-login)
5. [Networking: VPC, subnets, security groups](#5-networking-vpc-subnets-security-groups)
6. [Frontend: S3, ACM, CloudFront, Route 53](#6-frontend-s3-acm-cloudfront-route-53)
7. [ECR: container registry](#7-ecr-container-registry)
8. [RDS PostgreSQL](#8-rds-postgresql)
9. [EKS cluster setup](#9-eks-cluster-setup)
10. [Cluster add-ons: NGINX Ingress and NLB](#10-cluster-add-ons-nginx-ingress-and-nlb)
11. [Kubernetes workloads](#11-kubernetes-workloads)
12. [API domain and TLS](#12-api-domain-and-tls)
13. [Wire the frontend to the API](#13-wire-the-frontend-to-the-api)
14. [CI/CD with Jenkins on EC2](#14-cicd-with-jenkins-on-ec2)
15. [Security hardening checklist](#15-security-hardening-checklist)
16. [Verification checklist](#16-verification-checklist)
17. [Troubleshooting](#17-troubleshooting)
18. [Cost control and teardown](#18-cost-control-and-teardown)

---

## 1. Architecture

```
                         Users (browser)
                               |
                          Route 53 (DNS)
              +----------------+------------------+
              |                                   |
   jaideepmahala.online                 api.jaideepmahala.online
              |                                   |
        CloudFront (HTTPS)                  AWS NLB (public)
              |                                   |
        S3 bucket (private,                 NGINX Ingress Controller
        React build via OAC)                (inside EKS)
                                                  |
                         +------------------------+--------------------+
                         | /api/v1                | /ws                |
                   backend :4000            websocket :5000            |
                         |                        |                    |
                         +-----------+------------+                    |
                                     |                                 |
                         Redis (pub/sub, cache)                        |
                                     |                                 |
                         RDS PostgreSQL (private subnets) <------------+

 ECR (private) <-- Jenkins (EC2) builds images, pushes, then kubectl apply to EKS
```

**Key decisions made in this project**

| Decision | Choice |
|---|---|
| Frontend hosting | S3 (private) + CloudFront + Route 53 |
| Backend and WebSocket | EKS (namespace `teampulse`) |
| Database | RDS PostgreSQL, private subnets (not in-cluster Postgres) |
| Redis | In-cluster, applied from repo `k8s/` folder |
| Ingress | NGINX ingress controller behind an AWS NLB (not AWS Load Balancer Controller/ALB) |
| Region | `us-west-2` |
| CI/CD | Jenkins on an EC2 instance |

---

## 2. Conventions and variables

Set these once in your shell so every command below works by copy-paste.

```bash
export AWS_REGION=us-west-2
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export CLUSTER_NAME=teampulse-cluster
export NAMESPACE=teampulse
export DOMAIN=jaideepmahala.online
export API_DOMAIN=api.$DOMAIN
export BUCKET=teampulse-frontend
export DB_ID=teampulse-db
export ECR_REGISTRY=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

> CloudFront certificates **must** live in `us-east-1`, no matter which region the rest of your stack uses. Everything else here uses `us-west-2`.

---

## 3. Prerequisites and tooling

You need an AWS account, a registered domain (this project uses a domain registered outside or inside Route 53; both work), and a Linux/WSL/macOS machine.

### Install the tools

```bash
# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip awscliv2.zip && sudo ./aws/install
aws --version

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl
kubectl version --client

# eksctl
curl -sL "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp
sudo mv /tmp/eksctl /usr/local/bin
eksctl version

# Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version

# Docker (Ubuntu)
sudo apt-get update && sudo apt-get install -y docker.io
sudo usermod -aG docker $USER   # log out and back in afterwards
```

---

## 4. IAM: users, permissions, CLI login

### 4.1 Never work as the root user

**Console:** IAM → Users → Create user → name it (this project uses `for-local-machine`) → attach permissions (see below) → Create.

### 4.2 Permissions

For learning, attach `AdministratorAccess`. For production, use least privilege. The services this guide touches:

- EC2, VPC, ELB
- EKS, ECR
- RDS
- S3, CloudFront, ACM, Route 53
- CloudFormation (eksctl uses it)
- IAM (eksctl creates roles; restrict this in production)
- Secrets Manager (optional)

### 4.3 Create access keys and log in

**Console:** IAM → Users → your user → Security credentials → Create access key → "Command Line Interface (CLI)".

```bash
aws configure
# AWS Access Key ID:     <KEY>
# AWS Secret Access Key: <SECRET>
# Default region name:   us-west-2
# Default output format: json

aws sts get-caller-identity     # confirms who you are
```

### 4.4 Turn on MFA for every human user

**Console:** IAM → Users → your user → Security credentials → Assign MFA device.

---

## 5. Networking: VPC, subnets, security groups

This project reuses an **existing VPC** with **two public subnets** in different AZs. RDS needs **private subnets** (or at least a DB subnet group spanning 2 AZs).

### 5.1 Inspect what you have

```bash
aws ec2 describe-vpcs --query "Vpcs[].{Id:VpcId,Cidr:CidrBlock,Default:IsDefault}" --output table
aws ec2 describe-subnets --filters Name=vpc-id,Values=<VPC_ID> \
  --query "Subnets[].{Id:SubnetId,AZ:AvailabilityZone,Cidr:CidrBlock,PublicIP:MapPublicIpOnLaunch}" --output table
```

### 5.2 Create private subnets for RDS (Console)

VPC → Subnets → Create subnet:

1. Select your VPC.
2. Create two subnets, e.g. `teampulse-private-a` in `us-west-2a` and `teampulse-private-b` in `us-west-2b`, with non-overlapping CIDRs.
3. Do **not** enable auto-assign public IPv4.
4. The route table for these subnets must **not** have a route to an Internet Gateway (a route table with only the local route is fine).

**CLI:**

```bash
aws ec2 create-subnet --vpc-id <VPC_ID> --cidr-block <CIDR_A> --availability-zone us-west-2a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=teampulse-private-a}]'
aws ec2 create-subnet --vpc-id <VPC_ID> --cidr-block <CIDR_B> --availability-zone us-west-2b \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=teampulse-private-b}]'
```

### 5.3 Security groups (the firewall rules)

Principle: **each tier only accepts traffic from the tier in front of it.**

| Security group | Inbound rule |
|---|---|
| `teampulse-rds-sg` | TCP 5432 **from the EKS node/cluster security group only** |
| `jenkins-sg` | TCP 22 from **your IP only**, TCP 8080 from your IP only |
| NLB | Managed by Kubernetes Service; public 80/443 |

```bash
# RDS security group
aws ec2 create-security-group --group-name teampulse-rds-sg \
  --description "RDS access from EKS" --vpc-id <VPC_ID>

# Allow Postgres from the EKS cluster security group
aws ec2 authorize-security-group-ingress --group-id <RDS_SG_ID> \
  --protocol tcp --port 5432 --source-group <EKS_CLUSTER_SG_ID>
```

Find the EKS cluster security group after the cluster exists:

```bash
aws eks describe-cluster --name $CLUSTER_NAME \
  --query "cluster.resourcesVpcConfig.clusterSecurityGroupId" --output text
```

---

## 6. Frontend: S3, ACM, CloudFront, Route 53

### 6.1 Create the S3 bucket (private)

**Console:** S3 → Create bucket → name `teampulse-frontend` → Region `us-west-2` → **keep "Block all public access" ON** → Create.

```bash
aws s3api create-bucket --bucket $BUCKET --region $AWS_REGION \
  --create-bucket-configuration LocationConstraint=$AWS_REGION
aws s3api put-public-access-block --bucket $BUCKET \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

The bucket stays private. CloudFront reads it through **Origin Access Control (OAC)**.

### 6.2 Request the TLS certificate (ACM, must be us-east-1)

**Console:** switch region to **N. Virginia (us-east-1)** → Certificate Manager → Request → Public certificate → add `jaideepmahala.online` and `*.jaideepmahala.online` → DNS validation → Request.

Then open the certificate and click **Create records in Route 53** (if your DNS is in Route 53). Wait for status **Issued**.

```bash
aws acm request-certificate --region us-east-1 \
  --domain-name $DOMAIN --subject-alternative-names "*.$DOMAIN" \
  --validation-method DNS
aws acm describe-certificate --region us-east-1 --certificate-arn <CERT_ARN> \
  --query "Certificate.DomainValidationOptions[].ResourceRecord"
```

### 6.3 Route 53 hosted zone

**Console:** Route 53 → Hosted zones → Create hosted zone → name `jaideepmahala.online` → Public.

If the domain is registered elsewhere, copy the 4 **NS records** from the hosted zone into your registrar's nameserver settings. DNS propagation can take minutes to hours.

```bash
aws route53 create-hosted-zone --name $DOMAIN --caller-reference $(date +%s)
aws route53 list-hosted-zones
```

### 6.4 Create the CloudFront distribution

**Console:** CloudFront → Create distribution:

1. **Origin domain:** pick the S3 bucket `teampulse-frontend`.
2. **Origin access:** Origin access control settings (recommended) → Create new OAC → keep defaults.
3. **Viewer protocol policy:** Redirect HTTP to HTTPS.
4. **Default root object:** `index.html`.
5. **Alternate domain names (CNAMEs):** `jaideepmahala.online` (and `www.` if you want it).
6. **Custom SSL certificate:** choose the ACM certificate from us-east-1.
7. Create the distribution.

CloudFront then shows a banner with a **bucket policy** to copy. Go to S3 → bucket → Permissions → Bucket policy → paste it. It looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipal",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::teampulse-frontend/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
      }
    }
  }]
}
```

### 6.5 Fix React Router (SPA) deep links like `/login`

Without this, opening `https://yourdomain/login` directly returns an S3 `AccessDenied`/404 because there is no file called `login` in the bucket.

**Console:** CloudFront → your distribution → **Error pages** → Create custom error response, twice:

| HTTP error code | Customize response | Response page path | HTTP response code |
|---|---|---|---|
| 403 | Yes | `/index.html` | 200 |
| 404 | Yes | `/index.html` | 200 |

### 6.6 Point the domain at CloudFront (Route 53)

**Console:** Route 53 → Hosted zone → Create record:

- Record name: empty (apex) → Record type **A** → toggle **Alias** → "Alias to CloudFront distribution" → pick your distribution.
- Repeat with record type **AAAA** if IPv6 is enabled on the distribution.

```bash
# change-batch.json
cat > change-batch.json <<EOF
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "$DOMAIN",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "Z2FDTNDATAQYW2",
        "DNSName": "<DISTRIBUTION_DOMAIN>.cloudfront.net",
        "EvaluateTargetHealth": false
      }
    }
  }]
}
EOF
aws route53 change-resource-record-sets --hosted-zone-id <HOSTED_ZONE_ID> --change-batch file://change-batch.json
```

(`Z2FDTNDATAQYW2` is the fixed hosted zone ID used for every CloudFront alias.)

### 6.7 Build and deploy the frontend

```bash
cd ~/teamPulse/apps/frontend
bun install
bun run build                     # produces dist/

aws s3 sync dist/ s3://$BUCKET --delete
aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID> --paths "/*"
```

Cache tip: upload hashed assets (`assets/*`) with long cache headers and `index.html` with `no-cache`:

```bash
aws s3 sync dist/ s3://$BUCKET --delete --exclude index.html \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://$BUCKET/index.html --cache-control "no-cache"
```

---

## 7. ECR: container registry

This project uses a **private** ECR in `us-west-2` for the EKS deployment.

### 7.1 Create repositories

**Console:** ECR → Private registry → Repositories → Create repository (`teampulse-backend`, `teampulse-websocket`, `teampulse-migrate` if you use a separate migration image). Enable **Scan on push**.

```bash
for repo in teampulse-backend teampulse-websocket teampulse-migrate; do
  aws ecr create-repository --repository-name $repo --region $AWS_REGION \
    --image-scanning-configuration scanOnPush=true
done
```

### 7.2 Log in, build, tag, push

```bash
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $ECR_REGISTRY

# Backend
docker build -t teampulse-backend -f apps/backend/Dockerfile .
docker tag teampulse-backend:latest $ECR_REGISTRY/teampulse-backend:latest
docker push $ECR_REGISTRY/teampulse-backend:latest

# WebSocket
docker build -t teampulse-websocket -f apps/ws/Dockerfile .
docker tag teampulse-websocket:latest $ECR_REGISTRY/teampulse-websocket:latest
docker push $ECR_REGISTRY/teampulse-websocket:latest
```

> Build from the **repo root** so the monorepo `packages/db` is in the Docker context.

> Earlier in this project a **public** ECR repo (`public.ecr.aws/...`) was used for the backend. Public repos are fine for learning; use private for real workloads. Public ECR logins use `aws ecr-public get-login-password --region us-east-1`.

### 7.3 Let EKS nodes pull from ECR

Managed node groups created by `eksctl` already attach `AmazonEC2ContainerRegistryReadOnly` to the node role, so no `imagePullSecrets` are needed for same-account private ECR.

---

## 8. RDS PostgreSQL

### 8.1 Create the DB subnet group

**Console:** RDS → Subnet groups → Create DB subnet group → pick your VPC → add the two private subnets across 2 AZs.

```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name teampulse-db-subnets \
  --db-subnet-group-description "TeamPulse private subnets" \
  --subnet-ids <PRIVATE_SUBNET_A> <PRIVATE_SUBNET_B>
```

### 8.2 Create the database

**Console:** RDS → Create database:

| Setting | Value |
|---|---|
| Creation method | Standard create |
| Engine | PostgreSQL |
| Template | Free tier / Dev-Test (Production for real workloads) |
| DB instance identifier | `teampulse-db` |
| Master username | e.g. `postgres` (choose your own) |
| Credentials | Self managed (type a strong password) or Secrets Manager |
| Instance class | `db.t4g.micro` / `db.t3.micro` for dev |
| Storage | gp3, 20 GiB |
| VPC | your VPC |
| DB subnet group | `teampulse-db-subnets` |
| **Public access** | **No** |
| VPC security group | `teampulse-rds-sg` |
| Initial database name | `teampulse` (under Additional configuration) |
| Backups | Enabled (7 days) |
| Encryption | Enabled |

```bash
aws rds create-db-instance \
  --db-instance-identifier $DB_ID \
  --engine postgres \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 --storage-type gp3 \
  --master-username <DB_USER> --master-user-password '<DB_PASSWORD>' \
  --db-name teampulse \
  --db-subnet-group-name teampulse-db-subnets \
  --vpc-security-group-ids <RDS_SG_ID> \
  --no-publicly-accessible \
  --backup-retention-period 7 \
  --storage-encrypted

aws rds wait db-instance-available --db-instance-identifier $DB_ID
aws rds describe-db-instances --db-instance-identifier $DB_ID \
  --query "DBInstances[0].Endpoint.Address" --output text
```

The endpoint looks like `teampulse-db.xxxxxxxx.us-west-2.rds.amazonaws.com`.

### 8.3 Connection string

```
DATABASE_URL=postgresql://<DB_USER>:<URL_ENCODED_PASSWORD>@<RDS_ENDPOINT>:5432/teampulse
```

If the password has special characters (`@ : / # ?`), URL-encode them.

### 8.4 Test connectivity from inside the cluster

RDS is private, so test from a pod:

```bash
kubectl run pgtest -n $NAMESPACE --rm -it --image=postgres:16-alpine --restart=Never -- \
  psql "postgresql://<DB_USER>:<PASSWORD>@<RDS_ENDPOINT>:5432/teampulse" -c "\dt"
```

---

## 9. EKS cluster setup

### 9.1 Cluster config file

This project created `teampulse-cluster` in `us-west-2` with `eksctl`, using an **existing VPC and two public subnets**, and a managed node group of 2 × `m7i-flex.large`.

Create `cluster.yaml`:

```yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: teampulse-cluster
  region: us-west-2

vpc:
  id: <VPC_ID>
  subnets:
    public:
      us-west-2a: { id: <PUBLIC_SUBNET_A> }
      us-west-2b: { id: <PUBLIC_SUBNET_B> }

managedNodeGroups:
  - name: ng-1
    instanceType: m7i-flex.large
    desiredCapacity: 2
    minSize: 2
    maxSize: 3
    volumeSize: 30
    privateNetworking: false
    labels: { role: workers }
```

```bash
eksctl create cluster -f cluster.yaml      # takes roughly 15–20 minutes
```

**Simple alternative (eksctl creates its own VPC):**

```bash
eksctl create cluster --name $CLUSTER_NAME --region $AWS_REGION \
  --nodegroup-name ng-1 --node-type m7i-flex.large --nodes 2
```

**Console equivalent:** EKS → Create cluster → name, Kubernetes version, cluster IAM role → networking (VPC, subnets, security group) → endpoint access → Create. Then Compute → Add node group (node IAM role needs `AmazonEKSWorkerNodePolicy`, `AmazonEKS_CNI_Policy`, `AmazonEC2ContainerRegistryReadOnly`). `eksctl` does all of this for you, which is why it is preferred.

### 9.2 Connect kubectl

```bash
aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION
kubectl get nodes
kubectl get pods -A
```

### 9.3 Give other identities access (Jenkins, teammates)

The identity that **created** the cluster is its first admin. To let another IAM user or role in:

**Console:** EKS → your cluster → **Access** tab → IAM access entries → Create access entry → pick the IAM principal → attach an access policy such as `AmazonEKSClusterAdminPolicy` (or `AmazonEKSEditPolicy` scoped to the `teampulse` namespace).

```bash
aws eks create-access-entry --cluster-name $CLUSTER_NAME \
  --principal-arn arn:aws:iam::$ACCOUNT_ID:user/<IAM_USER>
aws eks associate-access-policy --cluster-name $CLUSTER_NAME \
  --principal-arn arn:aws:iam::$ACCOUNT_ID:user/<IAM_USER> \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster
```

(Older clusters use the `aws-auth` ConfigMap instead: `kubectl edit configmap aws-auth -n kube-system`.)

### 9.4 Create the namespace

```bash
kubectl create namespace $NAMESPACE
```

---

## 10. Cluster add-ons: NGINX Ingress and NLB

The NGINX ingress controller creates a Kubernetes `Service` of type `LoadBalancer`, which makes AWS provision a **Network Load Balancer (NLB)** automatically.

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"=nlb
```

Wait for the NLB hostname:

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller -w
# EXTERNAL-IP column becomes something like xxxx.elb.us-west-2.amazonaws.com
```

Save it: this is the target for your `api.` DNS record in section 12.

> WebSockets work through NGINX, but long-lived connections need longer timeouts. These are set as Ingress annotations in section 11.5.

---

## 11. Kubernetes workloads

Apply order matters: **secrets → redis → migration → backend/websocket → ingress**.

### 11.1 Secrets (never commit these)

Create a `secret.yaml` kept **out of Git** (add it to `.gitignore`), or use `kubectl create secret`:

```bash
kubectl create secret generic teampulse-secrets -n $NAMESPACE \
  --from-literal=DATABASE_URL='postgresql://<DB_USER>:<PASSWORD>@<RDS_ENDPOINT>:5432/teampulse' \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=REDIS_URL='redis://redis:6379'
```

Verify (this shows keys, not values):

```bash
kubectl describe secret teampulse-secrets -n $NAMESPACE
```

### 11.2 Redis (in-cluster)

Applied from the repo's `k8s/` folder:

```bash
kubectl apply -n $NAMESPACE -f k8s/redis.yaml
kubectl get pods -n $NAMESPACE
```

### 11.3 Run Prisma migrations against RDS

Run migrations as a one-shot **Job** using the migration/backend image:

```yaml
# migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: teampulse-migrate
  namespace: teampulse
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: <ACCOUNT_ID>.dkr.ecr.us-west-2.amazonaws.com/teampulse-backend:latest
          command: ["bunx", "prisma", "migrate", "deploy"]
          envFrom:
            - secretRef:
                name: teampulse-secrets
```

> Adjust `command` to match your Prisma setup (this project runs Prisma 8 RC, whose CLI differs from 6.x docs; check `bunx prisma --help` in your image).

```bash
kubectl apply -f migrate-job.yaml
kubectl logs -n $NAMESPACE job/teampulse-migrate -f
kubectl delete job teampulse-migrate -n $NAMESPACE     # clean up before re-running
```

### 11.4 Backend and WebSocket deployments

```yaml
# backend.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: teampulse
spec:
  replicas: 2
  selector:
    matchLabels: { app: backend }
  template:
    metadata:
      labels: { app: backend }
    spec:
      containers:
        - name: backend
          image: <ACCOUNT_ID>.dkr.ecr.us-west-2.amazonaws.com/teampulse-backend:latest
          ports:
            - containerPort: 4000
          envFrom:
            - secretRef: { name: teampulse-secrets }
          readinessProbe:
            tcpSocket: { port: 4000 }
            initialDelaySeconds: 5
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { cpu: 500m, memory: 512Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: teampulse
spec:
  selector: { app: backend }
  ports:
    - port: 4000
      targetPort: 4000
```

```yaml
# websocket.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: websocket
  namespace: teampulse
spec:
  replicas: 2
  selector:
    matchLabels: { app: websocket }
  template:
    metadata:
      labels: { app: websocket }
    spec:
      containers:
        - name: websocket
          image: <ACCOUNT_ID>.dkr.ecr.us-west-2.amazonaws.com/teampulse-websocket:latest
          ports:
            - containerPort: 5000
          envFrom:
            - secretRef: { name: teampulse-secrets }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: websocket
  namespace: teampulse
spec:
  selector: { app: websocket }
  ports:
    - port: 5000
      targetPort: 5000
```

```bash
kubectl apply -f backend.yaml -f websocket.yaml
kubectl get pods,svc -n $NAMESPACE
kubectl logs -n $NAMESPACE deploy/backend --tail=50
```

> With more than one websocket replica, Redis pub/sub (already part of this architecture) is what keeps broadcasts consistent across pods.

### 11.5 Ingress rules

Production host is `api.jaideepmahala.online`. (Locally the repo used host `teampulse.local`.) Only the API paths go to the cluster because the frontend lives on CloudFront.

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: teampulse-ingress
  namespace: teampulse
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  ingressClassName: nginx
  rules:
    - host: api.jaideepmahala.online
      http:
        paths:
          - path: /api/v1
            pathType: Prefix
            backend:
              service: { name: backend, port: { number: 4000 } }
          - path: /ws
            pathType: Prefix
            backend:
              service: { name: websocket, port: { number: 5000 } }
```

```bash
kubectl apply -f ingress.yaml
kubectl get ingress -n $NAMESPACE
```

---

## 12. API domain and TLS

Browsers on an `https://` site will block calls to a plain `http://` API (mixed content) and plain `ws://`. The API needs HTTPS and the WebSocket needs `wss://`.

### 12.1 DNS: point `api.` at the NLB

**Console:** Route 53 → Hosted zone → Create record:

- Name: `api` → Type **A** → **Alias** on → "Alias to Network Load Balancer" → region `us-west-2` → select the NLB.

```bash
NLB_HOST=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo $NLB_HOST

# Find the NLB's canonical hosted zone ID
aws elbv2 describe-load-balancers --region $AWS_REGION \
  --query "LoadBalancers[?DNSName=='$NLB_HOST'].CanonicalHostedZoneId" --output text
```

```bash
cat > api-record.json <<EOF
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "$API_DOMAIN",
      "Type": "A",
      "AliasTarget": {
        "HostedZoneId": "<NLB_CANONICAL_HOSTED_ZONE_ID>",
        "DNSName": "$NLB_HOST",
        "EvaluateTargetHealth": false
      }
    }
  }]
}
EOF
aws route53 change-resource-record-sets --hosted-zone-id <HOSTED_ZONE_ID> --change-batch file://api-record.json
```

Check: `dig +short $API_DOMAIN` and `curl -i http://$API_DOMAIN/api/v1/<health-or-any-route>`.

### 12.2 TLS: choose ONE of these

**Option 1 — cert-manager + Let's Encrypt (certificate lives in the cluster, NGINX terminates TLS):**

```bash
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace \
  --set crds.enabled=true
```

```yaml
# cluster-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <YOUR_EMAIL>
    privateKeySecretRef: { name: letsencrypt-prod }
    solvers:
      - http01:
          ingress: { ingressClassName: nginx }
```

Add to the Ingress:

```yaml
metadata:
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts: [api.jaideepmahala.online]
      secretName: teampulse-api-tls
```

**Option 2 — ACM certificate terminated at the NLB:** request a certificate for `api.jaideepmahala.online` in **us-west-2** (ACM → Request, DNS validation), then set these annotations on the ingress-nginx controller Service so the NLB terminates TLS on 443:

```
service.beta.kubernetes.io/aws-load-balancer-ssl-cert: <ACM_CERT_ARN>
service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "443"
service.beta.kubernetes.io/aws-load-balancer-backend-protocol: tcp
```

### 12.3 Verify

```bash
curl -i https://$API_DOMAIN/api/v1/<route>
# WebSocket test (install wscat: npm i -g wscat)
wscat -c wss://$API_DOMAIN/ws
```

### 12.4 CORS

The backend must allow the frontend origin. In the backend config allow `https://jaideepmahala.online` (and your CloudFront URL while testing). A CORS failure shows in the browser console, not in the server logs.

---

## 13. Wire the frontend to the API

The frontend originally used a relative base URL (`"/api/v1"` in `src/api.ts`), which only works when the API shares the site's origin. With the API on its own subdomain, use environment-driven absolute URLs.

```ts
// src/api.ts
export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "/api/v1";

// websocket hook
export const WS_URL =
  import.meta.env.VITE_WS_URL ?? `${location.origin.replace(/^http/, "ws")}/ws`;
```

`.env.production`:

```
VITE_API_URL=https://api.jaideepmahala.online/api/v1
VITE_WS_URL=wss://api.jaideepmahala.online/ws
```

Rebuild and redeploy (section 6.7):

```bash
bun run build
aws s3 sync dist/ s3://$BUCKET --delete
aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID> --paths "/*"
```

---

## 14. CI/CD with Jenkins on EC2

Jenkins builds the images, pushes them to ECR, and deploys to EKS.

### 14.1 Launch the EC2 instance

**Console:** EC2 → Launch instance → Ubuntu 22.04/24.04 → `t3.medium` or larger → key pair → security group `jenkins-sg` (SSH 22 and Jenkins 8080 from **your IP only**) → 30 GiB gp3 → Launch.

### 14.2 Install Jenkins, Docker, AWS CLI, kubectl

```bash
sudo apt-get update
sudo apt-get install -y fontconfig openjdk-17-jre docker.io unzip curl git

# Jenkins
sudo wget -O /usr/share/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key
echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" | \
  sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
sudo apt-get update && sudo apt-get install -y jenkins

# Let Jenkins use Docker
sudo usermod -aG docker jenkins
sudo systemctl restart jenkins

# AWS CLI v2 and kubectl: same install commands as section 3
```

Get the first-login password and open `http://<EC2_PUBLIC_IP>:8080`:

```bash
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
```

Install suggested plugins, then add: **Pipeline**, **Git**, **Credentials Binding**, **Docker Pipeline**.

### 14.3 Give Jenkins AWS access

This project configured the `jenkins` Linux user with the IAM user `for-local-machine`:

```bash
sudo -u jenkins aws configure
sudo -u jenkins aws sts get-caller-identity
sudo -u jenkins aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION
sudo -u jenkins kubectl get nodes
```

The IAM principal also needs an EKS **access entry** (section 9.3).

> **Better practice:** attach an **IAM instance profile (role)** to the EC2 instance instead of storing long-lived access keys on the box.

### 14.4 Where manifests live on the Jenkins box

This project copies `backend.yaml` and `websocket.yaml` to `/var/lib/jenkins/k8s` and applies from there:

```bash
sudo mkdir -p /var/lib/jenkins/k8s
sudo cp backend.yaml websocket.yaml /var/lib/jenkins/k8s/
sudo chown -R jenkins:jenkins /var/lib/jenkins/k8s
```

### 14.5 Example Jenkinsfile (repo root)

```groovy
pipeline {
  agent any
  environment {
    AWS_REGION   = 'us-west-2'
    ACCOUNT_ID   = '<ACCOUNT_ID>'
    ECR_REGISTRY = "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    CLUSTER_NAME = 'teampulse-cluster'
    NAMESPACE    = 'teampulse'
    TAG          = "${env.BUILD_NUMBER}"
  }
  stages {
    stage('Checkout') { steps { checkout scm } }

    stage('ECR Login') {
      steps {
        sh 'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY'
      }
    }

    stage('Build and Push') {
      steps {
        sh '''
          docker build -t $ECR_REGISTRY/teampulse-backend:$TAG   -f apps/backend/Dockerfile .
          docker build -t $ECR_REGISTRY/teampulse-websocket:$TAG -f apps/ws/Dockerfile .
          docker push $ECR_REGISTRY/teampulse-backend:$TAG
          docker push $ECR_REGISTRY/teampulse-websocket:$TAG
        '''
      }
    }

    stage('Deploy to EKS') {
      steps {
        sh '''
          aws eks update-kubeconfig --name $CLUSTER_NAME --region $AWS_REGION
          kubectl set image deployment/backend   backend=$ECR_REGISTRY/teampulse-backend:$TAG     -n $NAMESPACE
          kubectl set image deployment/websocket websocket=$ECR_REGISTRY/teampulse-websocket:$TAG -n $NAMESPACE
          kubectl rollout status deployment/backend   -n $NAMESPACE --timeout=180s
          kubectl rollout status deployment/websocket -n $NAMESPACE --timeout=180s
        '''
      }
    }
  }
  post {
    failure { sh 'kubectl get pods -n $NAMESPACE || true' }
  }
}
```

Create the job: Jenkins → New Item → **Pipeline** → Pipeline script from SCM → Git → repo URL → branch → script path `Jenkinsfile` → Save → Build Now.

> First deploy: apply `backend.yaml` and `websocket.yaml` once (section 11.4) so the Deployments exist; afterwards the pipeline only updates their images.

---

## 15. Security hardening checklist

**Identity**
- [ ] Root account has MFA and no access keys
- [ ] Day-to-day work uses IAM users/roles with MFA
- [ ] Jenkins uses an instance role or a dedicated least-privilege IAM identity
- [ ] Access keys rotated; none committed to Git (`git log -p | grep -i AKIA` to check)

**Network**
- [ ] RDS is **not** publicly accessible; its SG allows 5432 only from the EKS cluster SG
- [ ] Jenkins SG allows 22 and 8080 only from your IP (or use SSM Session Manager and close 22)
- [ ] EKS API endpoint access restricted if possible (EKS → Networking → Manage → restrict public access CIDRs)
- [ ] Only the NLB is internet-facing for the API

**Data**
- [ ] RDS storage encryption on; automated backups on
- [ ] S3 "Block all public access" ON; access only through CloudFront OAC
- [ ] S3 versioning on for the frontend bucket (easy rollback)

**Secrets**
- [ ] Secrets only in Kubernetes Secrets / Secrets Manager; `secret.yaml` is in `.gitignore`
- [ ] Strong random `JWT_SECRET`; DB password not reused anywhere
- [ ] Consider encrypting Kubernetes Secrets with a KMS key (EKS → Overview → Secrets encryption)

**Transport**
- [ ] HTTPS everywhere; CloudFront redirects HTTP to HTTPS; API served over TLS; WebSocket over `wss://`

**Containers**
- [ ] ECR scan-on-push enabled; review findings
- [ ] Use pinned image tags (build number or git SHA) in production instead of `latest`
- [ ] Set resource requests/limits on all pods

**Observability and edge (recommended next)**
- [ ] CloudWatch alarms (CPU, RDS storage/connections) with SNS email notifications
- [ ] EKS control-plane logging enabled
- [ ] AWS WAF on CloudFront (and rate limiting on the API)
- [ ] CloudTrail enabled for audit history

---

## 16. Verification checklist

| Check | Command | Expected |
|---|---|---|
| CLI identity | `aws sts get-caller-identity` | Your IAM user/role |
| Nodes ready | `kubectl get nodes` | 2 nodes `Ready` |
| Pods running | `kubectl get pods -n teampulse` | backend, websocket, redis `Running` |
| DB reachable | pod `psql ... -c "\dt"` | Tables listed (this project has 9) |
| Ingress | `kubectl get ingress -n teampulse` | Address = NLB hostname |
| DNS | `dig +short api.jaideepmahala.online` | NLB IPs |
| API | `curl -i https://api.jaideepmahala.online/api/v1/...` | 2xx/expected status |
| WebSocket | `wscat -c wss://api.jaideepmahala.online/ws` | Connects |
| Frontend | open `https://jaideepmahala.online` | App loads; `/login` works on refresh |
| Real-time | open two tabs on a board | Active user count updates live |

---

## 17. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `kubectl` says `Unauthorized` / `You must be logged in` | IAM identity has no EKS access entry | Section 9.3; check `aws sts get-caller-identity` |
| Pods `ImagePullBackOff` | Wrong image URI/tag, or ECR login/permissions | `kubectl describe pod`; check ECR URI and region; node role has ECR read policy |
| Pods `CrashLoopBackOff` | Missing env vars, bad `DATABASE_URL` | `kubectl logs <pod> -n teampulse`; check `teampulse-secrets` keys |
| Cannot reach RDS from pods | RDS SG does not allow the cluster SG; wrong subnet group/VPC | Section 5.3; confirm RDS and EKS are in the same VPC |
| Prisma connection error with special characters | Password not URL-encoded | Encode `@ : / # ?` in the password |
| NLB `EXTERNAL-IP` stays `<pending>` | Subnets missing the right tags, or quota issue | Public subnets need tag `kubernetes.io/role/elb=1`; check `kubectl describe svc` |
| 404 from NGINX | Host or path mismatch in Ingress | Ensure you call `api.jaideepmahala.online` and the path prefix matches |
| WebSocket disconnects after ~60 s | Proxy timeout | Increase `proxy-read-timeout` / `proxy-send-timeout` (section 11.5); add client heartbeats |
| Mixed-content errors in browser | Frontend on HTTPS calling `http://` or `ws://` | Section 12 and 13: use `https://` and `wss://` |
| CORS errors | Backend does not allow the frontend origin | Add the origin to backend CORS config |
| `/login` returns 403/404 on refresh | Missing CloudFront SPA error responses | Section 6.5 |
| Old frontend after deploy | CloudFront cache | `aws cloudfront create-invalidation --paths "/*"` |
| CloudFront cannot use my certificate | Cert not in us-east-1 or not Issued | Re-request the certificate in us-east-1 |
| Docker `permission denied` in Jenkins | `jenkins` not in `docker` group | `sudo usermod -aG docker jenkins && sudo systemctl restart jenkins` |

Useful debugging commands:

```bash
kubectl get events -n teampulse --sort-by=.lastTimestamp
kubectl describe pod <pod> -n teampulse
kubectl logs deploy/backend -n teampulse --tail=100 -f
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller --tail=100
kubectl exec -it deploy/backend -n teampulse -- sh
```

---

## 18. Cost control and teardown

Running costs to be aware of: EKS control plane (about $0.10/hour), 2 worker nodes, the NLB, RDS, NAT gateways (if any), the Jenkins EC2 instance, and data transfer.

### Pause costs without deleting everything

```bash
eksctl scale nodegroup --cluster $CLUSTER_NAME --name ng-1 --nodes 0 --nodes-min 0 --region $AWS_REGION
aws rds stop-db-instance --db-instance-identifier $DB_ID      # auto-restarts after 7 days
aws ec2 stop-instances --instance-ids <JENKINS_INSTANCE_ID>
```

### Full teardown (reverse order)

```bash
# 1. Remove Kubernetes resources (this also deletes the NLB)
kubectl delete namespace $NAMESPACE
helm uninstall ingress-nginx -n ingress-nginx

# 2. Delete the cluster
eksctl delete cluster --name $CLUSTER_NAME --region $AWS_REGION

# 3. Delete RDS (take a final snapshot unless you are sure)
aws rds delete-db-instance --db-instance-identifier $DB_ID \
  --final-db-snapshot-identifier teampulse-final-snapshot

# 4. ECR
for repo in teampulse-backend teampulse-websocket teampulse-migrate; do
  aws ecr delete-repository --repository-name $repo --force --region $AWS_REGION
done

# 5. Frontend
aws s3 rm s3://$BUCKET --recursive
aws s3api delete-bucket --bucket $BUCKET
#    Disable then delete the CloudFront distribution from the console
#    Delete Route 53 records, the hosted zone (if no longer needed), and ACM certificates

# 6. Jenkins EC2 instance, security groups, leftover volumes/snapshots, unused Elastic IPs
```

Always check **Billing → Cost Explorer** the next day to confirm nothing is still running.

---

### Order-of-operations summary

1. IAM user, CLI, MFA
2. Subnets and security groups
3. S3 bucket → ACM cert (us-east-1) → Route 53 zone → CloudFront (OAC, SPA error pages) → DNS alias
4. ECR repos, build and push images
5. RDS (private) and its security group
6. EKS cluster, kubeconfig, access entries, namespace
7. NGINX ingress + NLB
8. Secrets → Redis → migrations → backend/websocket → ingress
9. `api.` DNS record + TLS
10. Frontend env vars (`VITE_API_URL`, `VITE_WS_URL`), rebuild, upload, invalidate
11. Jenkins CI/CD
12. Security checklist, verification, monitoring

