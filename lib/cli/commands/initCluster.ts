import {Apps_v1Api} from '@kubernetes/client-node'
import {CliCommand} from '../../types'

const initCluster: CliCommand = {
  description: 'Install cluster resources',
  help: `\
Creates/updates 'k8sync' DaemonSet. Requires access to hostPath mounts.\
`,
  async handler(config, args, params) {
    const daemonSetSpec = {
      apiVersion: 'apps/v1',
      kind: 'DaemonSet',
      metadata: {
        name: 'k8sync',
      },
      spec: {
        selector: {
          matchLabels: {name: 'k8sync'},
        },
        template: {
          metadata: {
            labels: {name: 'k8sync'},
          },
          spec: {
            // tolerations: [
            //   {
            //     key: 'node-role.kubernetes.io/master',
            //     effect: 'NoSchedule',
            //   },
            // ],
            volumes: [
              {
                name: 'dockersocket',
                hostPath: {
                  path: config.nodeDockerSocketPath,
                },
              },
              {
                name: 'overlay2',
                hostPath: {
                  path: config.nodeOverlay2Path,
                },
              },
            ],

            nodeSelector: {
              'beta.kubernetes.io/os': 'linux',
            },

            containers: [
              {
                name: 'rsyncd',
                image: 'k8sync/rsyncd',
                imagePullPolicy: 'Always',
                ports: [{name: 'rsync', containerPort: 873}],
                resources: {
                  requests: {
                    memory: '100Mi',
                  },
                  limits: {
                    memory: '1Gi',
                    cpu: '800m',
                  },
                },
                volumeMounts: [
                  {
                    name: 'overlay2',
                    mountPath: '/overlay2',
                  },
                ],
                livenessProbe: {
                  tcpSocket: {
                    port: 873,
                  },
                },
                readinessProbe: {
                  tcpSocket: {
                    port: 873,
                  },
                },
              },
              {
                name: 'api',
                image: 'k8sync/api',
                imagePullPolicy: 'Always',
                ports: [{name: 'http', containerPort: 80}],
                resources: {
                  requests: {
                    memory: '64Mi',
                    cpu: '10m',
                  },
                  limits: {
                    memory: '128Mi',
                    cpu: '500m',
                  },
                },
                volumeMounts: [
                  {
                    name: 'dockersocket',
                    mountPath: '/var/run/docker.sock',
                  },
                ],
                livenessProbe: {
                  tcpSocket: {
                    port: 80,
                  },
                },
                readinessProbe: {
                  tcpSocket: {
                    port: 80,
                  },
                },
              },
            ],

            terminationGracePeriodSeconds: 0,
          },
        },
      },
    }

    const cluster = config.kubeConfig.makeApiClient(Apps_v1Api)

    try {
      await cluster.readNamespacedDaemonSet('k8sync', config.daemonSetNamespace)

      cluster.replaceNamespacedDaemonSet(
        'k8sync',
        config.daemonSetNamespace,
        daemonSetSpec as any
      )

      console.log(
        `Updated 'k8sync' DaemonSet (namespace=${config.daemonSetNamespace})`
      )
    } catch (error) {
      cluster.createNamespacedDaemonSet(
        config.daemonSetNamespace,
        daemonSetSpec as any
      )
      console.log(
        `Created 'k8sync' DaemonSet (namespace=${config.daemonSetNamespace})`
      )
    }
  },
}

export default initCluster
