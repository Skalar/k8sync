#!/bin/bash

DOCKER_TAG=${DOCKER_TAG:-latest}

docker build -t k8sync/api:$DOCKER_TAG api
docker build -t k8sync/rsyncd:$DOCKER_TAG rsyncd

docker push k8sync/api:$DOCKER_TAG
docker push k8sync/rsyncd:$DOCKER_TAG