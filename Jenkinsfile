pipeline {
    agent any

    environment {
        AWS_DEFAULT_REGION = 'us-west-2'
        AWS_REGION   = 'us-west-2'
        AWS_ACCOUNT  = '900532378485'
        ECR_REGISTRY = "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
        BACKEND_REPO = 'teampulse-backend'
        WS_REPO      = 'teampulse-websocket'
        CLUSTER      = 'teampulse-cluster'
        K8S_NS       = 'teampulse'                 // must match k8s/namespace.yaml
        GIT_REPO_URL = 'https://github.com/bravvee19-oss/teamPulse.git'   // CHANGE THIS
    }

    stages {
        stage('Checkout') {
            steps {
                cleanWs()
                git url: "${GIT_REPO_URL}", branch: 'main'
                // private repo? use this instead:
                // git url: "${GIT_REPO_URL}", branch: 'main', credentialsId: 'github-creds'
                script {
                    env.IMAGE_TAG = sh(script: 'git rev-parse --short=7 HEAD', returnStdout: true).trim()
                }
            }
        }

        stage('Trivy FS scan') {
            steps {
                sh 'trivy fs --exit-code 0 --severity HIGH,CRITICAL --skip-dirs node_modules,apps/frontend/dist .'
            }
        }

        stage('Build images') {
            steps {
                sh """
                  docker build -t ${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG} -f apps/backend/Dockerfile .
                  docker build -t ${ECR_REGISTRY}/${WS_REPO}:${IMAGE_TAG}      -f apps/ws/Dockerfile .
                """
            }
        }

        stage('Push to ECR') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'aws-ecr-push',
                                  usernameVariable: 'AWS_ACCESS_KEY_ID',
                                  passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                    sh """
                      aws ecr get-login-password --region ${AWS_REGION} | \
                        docker login --username AWS --password-stdin ${ECR_REGISTRY}
                      docker push ${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG}
                      docker push ${ECR_REGISTRY}/${WS_REPO}:${IMAGE_TAG}
                    """
                }
            }
        }

        stage('Deploy to EKS') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'aws-ecr-push',
                                                  usernameVariable: 'AWS_ACCESS_KEY_ID',
                                                  passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                    sh """
                      export AWS_DEFAULT_REGION=${AWS_REGION}
                      aws eks update-kubeconfig --name ${CLUSTER} --region ${AWS_REGION}

                      # Jobs are immutable, so remove the old migration job first
                      kubectl -n ${K8S_NS} delete job migration --ignore-not-found

                      cd k8s
                      kustomize edit set image \
                        teampulse-backend=${ECR_REGISTRY}/${BACKEND_REPO}:${IMAGE_TAG} \
                        teampulse-ws=${ECR_REGISTRY}/${WS_REPO}:${IMAGE_TAG}
                      kubectl apply -k .

                      kubectl -n ${K8S_NS} wait --for=condition=complete job/migration --timeout=180s
                      kubectl -n ${K8S_NS} rollout status deploy/backend   --timeout=180s
                      kubectl -n ${K8S_NS} rollout status deploy/websocket --timeout=180s
                    """
                }
            }
        }
    }
}