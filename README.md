# k8sync

Watch and sync local files to kubernetes pods using watchman and rsync.

Heavily inspired by [ksync](https://github.com/vapor-ware/ksync).


> Work In Progress
>
> WARNING: Only meant to be used in development clusters - anyone with access to the DaemonSet pods have write access to all overlay2 filesystems, on all cluster nodes.

## Getting started

### Dependencies

* [NodeJS](https://nodejs.org/en/)
* [watchman](https://facebook.github.io/watchman/docs/install.html)
* [rsync >= 3.0.0](https://rsync.samba.org/)

### Install k8sync

```shell
npm -g install k8sync
```

### Configure k8sync for project

Create a `k8sync.yaml` in your project root.
```yaml
namespace: mynamespace
daemonSetNamespace: kube-system

sync:
  api:
    localPath: api
    containerPath: /src
    podSelector:
      labelSelector: 'app=myapp-api'
    excludeDirs:
      - node_modules

  webapp-poller:
    localPath: webapp
    containerPath: /src
    podSelector:
      labelSelector: 'app=myapp-webapp'
    excludeDirs:
      - node_modules
```

### Install cluster-side components

```shell
k8sync cluster:init
```

### Watch and sync local files to cluster

```shell
k8sync sync
```

### Retart containers while retaining synced files

```shell
k8sync restart api
```

### Remove cluster-side components

```shell
k8sync cluster:clean
```
